import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeOAuth, GMAIL_SCOPES } from "../plugins/inbox/server/oauth.mjs";
import { makeGmail } from "../plugins/inbox/server/gmail.mjs";
import { makeVault } from "../plugins/inbox/server/vault.mjs";
import { withMcp } from "./support/mcp.mjs";

test("OAuth uses PKCE, least privilege, private files, and disconnect cancels pending consent", { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "inbox-oauth-review-"));
  let consent;
  let releaseExchange;
  const exchanging = new Promise((resolve) => { releaseExchange = resolve; });
  let entered;
  const enteredExchange = new Promise((resolve) => { entered = resolve; });
  const oauth = makeOAuth({ dataDir: root, fetchImpl: async (url, options) => {
    if (String(url).endsWith("/token")) {
      const body = options.body;
      assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), consent.searchParams.get("code_challenge"));
      entered(); await exchanging;
      return { ok: true, json: async () => ({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 }) };
    }
    return { ok: true, json: async () => ({ emailAddress: "fixture@example.test" }) };
  } });
  try {
    assert.deepEqual(GMAIL_SCOPES, ["https://www.googleapis.com/auth/gmail.readonly"]);
    oauth.storeCredentials({ clientId: "123-test.apps.googleusercontent.com", clientSecret: "fixture-secret-only" });
    if (process.platform !== "win32") assert.equal(statSync(join(root, "oauth-credentials.json")).mode & 0o777, 0o600);
    const begun = await oauth.beginFlow(); consent = new URL(begun.consentUrl);
    assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
    assert.match(begun.redirectUri, /^http:\/\/127\.0\.0\.1:/);
    const wrong = await fetch(begun.redirectUri + "/?code=bad&state=wrong");
    assert.equal(wrong.status, 400); await wrong.text();
    const callback = fetch(begun.redirectUri + "/?code=fixture&state=" + consent.searchParams.get("state"));
    await enteredExchange;
    oauth.disconnect(); releaseExchange();
    const response = await callback; await response.text();
    assert.equal(oauth.status().connected, false);
    assert.equal(existsSync(join(root, "oauth-tokens.json")), false, "late callback cannot reconnect after disconnect");
  } finally { releaseExchange(); oauth.disconnect(); rmSync(root, { recursive: true, force: true }); }
});

test("Gmail cannot mutate mail and bounds invalid pagination; vault dedupes renamed files", async () => {
  const client = makeGmail({ accessToken: async () => "fixture", fetchImpl: async (_url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ messages: [], nextPageToken: "repeated" }) };
  } });
  assert.equal(client.modifyLabels, undefined);
  await assert.rejects(client.listAll({ max: 10 }), /repeated page token/);
  const root = mkdtempSync(join(tmpdir(), "inbox-vault-review-"));
  try {
    const vault = makeVault(root);
    const first = vault.store({ buffer: Buffer.from("fixture"), filename: "a.txt", from: "Sender@Example.test" });
    const second = vault.store({ buffer: Buffer.from("fixture"), filename: "b.txt" });
    assert.equal(second.path, first.path);
    assert.equal(vault.search({ from: "sender@example.test" }).length, 1);
    if (process.platform !== "win32") assert.equal(statSync(first.path).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("MCP connected journey: digest, answered debt, sent-only waiting, attachments, disconnect", { timeout: 30000 }, async () => {
  const messages = {};
  const make = (id, threadId, from, to, outgoing, text, days = 3) => ({
    id, threadId, internalDate: String(Date.now() - days * 86400000), labelIds: outgoing ? ["SENT"] : ["INBOX", "UNREAD"],
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: "Project question" }], body: { data: Buffer.from(text).toString("base64url") } },
  });
  messages.in1 = make("in1", "answered", "human@example.test", "me@example.test", false, "Can you confirm the report?");
  messages.out1 = make("out1", "answered", "me@example.test", "human@example.test", true, "Confirmed. Thank you.", 2);
  messages.out2 = make("out2", "waiting", "me@example.test", "other@example.test", true, "Can you send the invoice?", 5);
  const seen = [];
  const server = createServer(async (req, res) => {
    seen.push([req.method, req.url]);
    const url = new URL(req.url, "http://fixture");
    let body = {};
    if (url.pathname === "/oauth2/v4/token") body = { access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 };
    else if (url.pathname === "/v3/userinfo") body = { emailAddress: "me@example.test" };
    else if (url.pathname.endsWith("/messages")) {
      const query = url.searchParams.get("q") ?? "";
      const selected = query.includes("{in:inbox in:sent}") ? Object.values(messages) : query.includes("in:sent") ? [messages.out1, messages.out2] : [messages.in1];
      body = { messages: selected.map(({ id, threadId }) => ({ id, threadId })) };
    } else if (url.pathname.includes("/threads/")) body = { messages: Object.values(messages).filter((m) => m.threadId === url.pathname.split("/").at(-1)) };
    else if (url.pathname.includes("/messages/")) body = messages[url.pathname.split("/").at(-1)] ?? {};
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await withMcp("inbox", async ({ tool, call, dataDir }) => {
      await tool("auth_store_credentials", { clientId: "123-test.apps.googleusercontent.com", clientSecret: "fixture-secret-only" });
      const begun = await tool("auth_begin"); const state = new URL(begun.consentUrl).searchParams.get("state");
      const callback = await fetch(`${begun.redirectUri}/?code=fixture&state=${state}`); assert.equal(callback.status, 200); await callback.text();
      assert.equal((await tool("auth_status")).connected, true);
      if (process.platform !== "win32") assert.equal(statSync(join(dataDir, "oauth-tokens.json")).mode & 0o777, 0o600);
      assert.ok((await tool("digest")).rows.length > 0);
      const loops = await tool("loops_scan");
      assert.equal(loops.replyDebt.length, 0, "answered inbox message is not reply debt");
      assert.ok(loops.waitingOn.some((row) => row.threadId === "waiting"), "sent-only thread must surface");
      assert.ok((await tool("search", { query: "in:inbox" })).count > 0);
      assert.match((await tool("read", { messageId: "in1" })).text, /confirm/);
      await tool("graph_stats"); await tool("cleanup_scan"); await tool("documents_scan"); await tool("vault_search");
      assert.match(await tool("vault_fetch", { messageId: "in1" }), /No matching attachment/);
      assert.ok(!(await call("tools/list")).result.tools.some((t) => t.name === "label_apply"));
      await tool("auth_disconnect"); assert.equal((await tool("auth_status")).connected, false);
      assert.equal(existsSync(join(dataDir, "oauth-tokens.json")), false);
    }, { INBOX_API_BASE: origin, INBOX_AUTH_BASE: origin });
    assert.ok(seen.every(([method, path]) => method === "GET" || path === "/oauth2/v4/token"));
  } finally { server.close(); await once(server, "close"); }
});
