/**
 * Inbox contract tests: the deterministic layers against fixtures — MIME
 * walking, the compact date engine, the trust graph and digest rules,
 * loops (waiting-on, reply debt, commitment candidates), cleanup
 * archaeology, the vault, OAuth URL/expiry logic with a mocked token
 * endpoint, the Gmail client with a mocked fetch, and the MCP server as
 * a real child process (unauthenticated paths). No network.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachments,
  bodyText,
  decodeQuotedPrintable,
  emailAddress,
  htmlToText,
  listUnsubscribe,
} from "../plugins/inbox/server/mime.mjs";
import { extractDates } from "../plugins/inbox/server/dates.mjs";
import { buildGraph, digestRows } from "../plugins/inbox/server/graph.mjs";
import { commitmentCandidates, replyDebtRows, waitingOnRows } from "../plugins/inbox/server/loops.mjs";
import { cleanupRows } from "../plugins/inbox/server/cleanup.mjs";
import { makeVault } from "../plugins/inbox/server/vault.mjs";
import { makeOAuth } from "../plugins/inbox/server/oauth.mjs";
import { makeGmail } from "../plugins/inbox/server/gmail.mjs";
import { documentRows, eventRows } from "../plugins/inbox/server/bridge.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "inbox", "server", "main.mjs");

function payloadFixture({ headers = [], text = "", html = null, files = [] } = {}) {
  const parts = [];
  if (text !== "") {
    parts.push({
      partId: "1",
      mimeType: "text/plain",
      filename: undefined,
      headers: [],
      body: { data: Buffer.from(text, "utf8").toString("base64"), size: text.length },
    });
  }
  if (html !== null) {
    parts.push({
      partId: "2",
      mimeType: "text/html",
      filename: undefined,
      headers: [],
      body: { data: Buffer.from(html, "utf8").toString("base64"), size: html.length },
    });
  }
  for (const file of files) {
    parts.push({
      partId: `a${parts.length}`,
      mimeType: file.mimeType ?? "application/pdf",
      filename: file.filename,
      headers: [],
      body: { size: file.size ?? 1024, attachmentId: file.attachmentId ?? `att-${file.filename}` },
    });
  }
  return { headers, mimeType: "multipart/alternative", parts, body: {} };
}

test("mime: plain preferred over html, html stripped cleanly, qp decoded", () => {
  const both = payloadFixture({
    text: "Versión en texto plano.",
    html: "<p>Versi&oacute;n <b>HTML</b> con <a href='https://x.ejemplo/doc'>documento</a></p>",
  });
  assert.equal(bodyText(both), "Versión en texto plano.");
  const onlyHtml = payloadFixture({ text: "", html: "<p>Hola<br/>Mundo &amp; más</p>" });
  assert.equal(bodyText(onlyHtml), "Hola\nMundo & más");
  const link = htmlToText('<a href="https://ejemplo.com/factura">la factura</a>');
  assert.equal(link, "la factura (https://ejemplo.com/factura)");
  // Soft line break after '=' is consumed; =C3=A9 is the UTF-8 'é'.
  assert.equal(decodeQuotedPrintable("caf=C3=A9=\r\nsiguiente"), "cafésiguiente");
});

test("mime: attachments and List-Unsubscribe harvesting", () => {
  const payload = payloadFixture({
    headers: [
      { name: "List-Unsubscribe", value: "<https://ejemplo.com/u/123>, <mailto:unsub@ejemplo.com>" },
    ],
    files: [{ filename: "poliza-2026.pdf", mimeType: "application/pdf", size: 2048 }],
  });
  const files = attachments(payload);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, "poliza-2026.pdf");
  assert.equal(files[0].attachmentId, "att-poliza-2026.pdf");
  const unsub = listUnsubscribe(payload);
  assert.equal(unsub.mailto, "unsub@ejemplo.com");
  assert.equal(unsub.url, "https://ejemplo.com/u/123");
  assert.equal(listUnsubscribe(payloadFixture({})), null);
  assert.equal(emailAddress('"María López" <maria@ejemplo.com>'), "maria@ejemplo.com");
  assert.equal(emailAddress("carlos@EJEMPLO.com"), "carlos@ejemplo.com");
});

test("dates: es/en prose dates land on the right ISO day (paper-radar engine)", () => {
  const found = extractDates("te envío el informe antes del 15 de octubre de 2026. Also due September 30, 2026. Numérico: 03/11/2026");
  const isos = found.map((entry) => entry.iso);
  assert.ok(isos.includes("2026-10-15"), `long Spanish form (${isos})`);
  assert.ok(isos.includes("2026-09-30"), `US form (${isos})`);
  assert.ok(isos.includes("2026-11-03"), `numeric day-first under Spanish bias (${isos})`);
});

function graphRecordsFixture() {
  const records = [];
  const push = (direction, from, tos, date, bulk = false) => records.push({ direction, from, tos, date, bulk });
  // María: strong two-way.
  for (let i = 0; i < 6; i += 1) push("in", "maria@ejemplo.com", [], `2026-09-0${(i % 6) + 1}`);
  for (let i = 0; i < 5; i += 1) push("out", "paul@ejemplo.com", ["maria@ejemplo.com"], `2026-09-0${(i % 6) + 1}`);
  // Carlos: one-way in (no replies from me yet).
  push("in", "carlos@ejemplo.com", [], "2026-09-05");
  push("in", "carlos@ejemplo.com", [], "2026-09-02");
  // Newsletter: bulk flag from List-Unsubscribe.
  for (let i = 0; i < 8; i += 1) push("in", "news@boletin.io", [], `2026-09-0${(i % 6) + 1}`, true);
  return records;
}

test("graph: tiers come from relationships, not content", () => {
  const graph = buildGraph(graphRecordsFixture());
  const byAddress = Object.fromEntries(graph.map((entry) => [entry.address, entry]));
  assert.equal(byAddress["maria@ejemplo.com"].tier, "inner");
  assert.equal(byAddress["carlos@ejemplo.com"].tier, "personal");
  assert.equal(byAddress["news@boletin.io"].tier, "bulk");
  assert.ok(byAddress["maria@ejemplo.com"].score > byAddress["carlos@ejemplo.com"].score);
  // Notification locals are bulk even without List-Unsubscribe.
  const graph2 = buildGraph([{ direction: "in", from: "noreply@accounts.google.com", tos: [], date: "2026-09-01", bulk: false }]);
  assert.equal(graph2[0].tier, "bulk");
});

test("digest: inner humans rank above bulk; security bulk still surfaces; noise suppressed", () => {
  const messages = [
    {
      messageId: "m1", threadId: "t1", from: "maria@ejemplo.com", senderTier: "inner", subject: "Propuesta",
      date: "2026-09-07", text: "¿Puedes revisar la propuesta antes del viernes? Adjunto el documento.", unread: true,
      attachments: [{ filename: "propuesta.pdf" }], dates: [{ iso: "2026-09-11" }],
    },
    {
      messageId: "m2", threadId: "t2", from: "news@boletin.io", senderTier: "bulk", subject: "Ofertas!!",
      date: "2026-09-07", text: "descuentos descuentos descuentos", unread: true, attachments: [], dates: [],
    },
    {
      messageId: "m3", threadId: "t3", from: "noreply@accounts.google.com", senderTier: "bulk",
      subject: "Security alert: new sign-in", date: "2026-09-07", text: "A new sign-in on your account.",
      unread: true, attachments: [], dates: [],
    },
  ];
  const rows = digestRows(messages, { limit: 5 });
  assert.ok(rows.some((row) => row.messageId === "m1"), "inner human surfaces");
  assert.equal(rows.find((row) => row.messageId === "m2"), undefined, "plain newsletter suppressed");
  assert.ok(rows.some((row) => row.messageId === "m3"), "security bulk surfaces");
  assert.equal(rows[0].messageId, "m1", "inner human ranks first");
  assert.ok(rows[0].reasons.some((r) => r.includes("asks") || r.includes("question") || r.includes("date")), "reasons are quoted");
});

test("loops: waiting-on aging, reply debt, and promise candidates with dates", () => {
  const threads = [
    {
      threadId: "t-carlos", subject: "Factura pendiente", lastDirection: "out",
      lastContact: "carlos@ejemplo.com", lastSenderTier: "personal",
      lastText: "Carlos, ¿me pasas la factura del proyecto cuando puedas?", lastDate: "2026-08-30",
    },
    {
      threadId: "t-maria", subject: "Café", lastDirection: "in",
      lastContact: "maria@ejemplo.com", lastSenderTier: "inner",
      lastText: "Perfecto, nos vemos ahí", lastDate: "2026-09-05",
    },
  ];
  const waiting = waitingOnRows(threads, { now: new Date("2026-09-07T00:00:00Z") });
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].threadId, "t-carlos");
  assert.equal(waiting[0].daysWaiting, 8);

  const debt = replyDebtRows(
    [
      {
        messageId: "m-debt", direction: "in", from: "maria@ejemplo.com", senderTier: "inner",
        subject: "¿Y lo tuyo?", date: "2026-09-04", text: "¿Cómo va lo que te pedí?", answered: false,
      },
      {
        messageId: "m-bulk", direction: "in", from: "news@boletin.io", senderTier: "bulk",
        subject: "oferta", date: "2026-09-04", text: "compra ya?", answered: false,
      },
    ],
    { now: new Date("2026-09-07T00:00:00Z") },
  );
  assert.equal(debt.length, 1);
  assert.equal(debt[0].messageId, "m-debt");

  const promises = commitmentCandidates(
    [
      {
        messageId: "m-out", threadId: "t-out", direction: "out", to: "maria@ejemplo.com",
        subject: "Re: informe", date: "2026-09-01",
        text: "Hola María, te envío el informe antes del 15 de octubre de 2026. I will also call the bank.",
      },
    ],
    { extractDatesImpl: extractDates },
  );
  assert.equal(promises.length, 1);
  assert.match(promises[0].promise, /env/iu);
  assert.ok(promises[0].dueDates.includes("2026-10-15"), `due date extracted (${promises[0].dueDates})`);
});

test("cleanup: kill-list is evidence (volume + unsubscribe route)", () => {
  const records = [];
  for (let i = 0; i < 6; i += 1) {
    records.push({
      direction: "in", from: "news@boletin.io", subject: `Oferta ${i}`, date: `2026-08-2${i % 8}`,
      unsubscribe: { raw: "<mailto:unsub@boletin.io>", mailto: "unsub@boletin.io" },
    });
  }
  for (let i = 0; i < 4; i += 1) {
    records.push({ direction: "in", from: "maria@ejemplo.com", subject: `Re: trabajo ${i}`, date: "2026-09-01", unsubscribe: null });
  }
  const rows = cleanupRows(records);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, "news@boletin.io");
  assert.equal(rows[0].total, 6);
  assert.equal(rows[0].canUnsubscribe, true);
  assert.equal(rows[0].unsubscribe.mailto, "unsub@boletin.io");
});

test("vault: hash dedupe, metadata search, stats", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-test-"));
  const vault = makeVault(dir);
  const stored = vault.store({
    buffer: Buffer.from("%PDF-1.4 poliza"),
    filename: "poliza 2026.pdf",
    mimeType: "application/pdf",
    from: "seguros@mapfre.ejemplo",
    date: "2026-03-15",
    messageId: "m-doc",
  });
  assert.match(stored.path, /[0-9a-f]{16}-poliza_2026\.pdf$/u);
  const again = vault.store({
    buffer: Buffer.from("%PDF-1.4 poliza"),
    filename: "poliza 2026.pdf",
    mimeType: "application/pdf",
    from: "seguros@mapfre.ejemplo",
    date: "2026-03-15",
    messageId: "m-doc2",
  });
  assert.equal(again.duplicate, true);
  assert.equal(vault.search({ query: "poliza maria" }).length, 0);
  assert.equal(vault.search({ query: "poliza" }).length, 1);
  assert.equal(vault.search({ from: "mapfre", query: "" }).length, 1);
  assert.equal(vault.search({ query: "poliza", after: "2026-04-01" }).length, 0);
  assert.equal(vault.stats().files, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("bridge: renewal mail becomes paper-radar ingestText; events extract dates", () => {
  const messages = [
    {
      messageId: "m-doc", threadId: "t-doc", from: "seguros@mapfre.ejemplo", subject: "Tu póliza se renueva",
      date: "2026-09-01",
      text: "La póliza se renovará el 15 de octubre de 2026. Prima anual: 412,50 €. Preaviso de 30 días.",
      attachments: [{ filename: "poliza-2026.pdf", mimeType: "application/pdf", sizeBytes: 2048, attachmentId: "a1" }],
    },
    {
      messageId: "m-norm", threadId: "t-norm", from: "maria@ejemplo.com", subject: "Re: café",
      date: "2026-09-02", text: "Nos vemos", attachments: [],
    },
    {
      messageId: "m-fly", threadId: "t-fly", from: "reservas@vuelos.ejemplo", subject: "Confirmación de reserva vuelo",
      date: "2026-09-03", text: "Su vuelo despega el 20 de diciembre de 2026.", attachments: [],
    },
  ];
  const docs = documentRows(messages);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].suggestedCategory, "insurance");
  assert.match(docs[0].ingestText, /ATTACHMENT: poliza-2026\.pdf/u);
  assert.match(docs[0].ingestText, /renovará el 15 de octubre de 2026/u);
  const events = eventRows(messages, { extractDatesImpl: extractDates });
  assert.equal(events.length, 1);
  assert.equal(events[0].dates[0].iso, "2026-12-20");
});

test("oauth: consent URL shape, token exchange and refresh against a mock endpoint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oauth-test-"));
  const tokenRequests = [];
  const fetchMock = async (url, options) => {
    if (String(url).endsWith("/oauth2/v4/token")) {
      tokenRequests.push(new URLSearchParams(options.body).get("grant_type"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "at-1",
          expires_in: 3600,
          refresh_token: "rt-1",
          scope: "s",
        }),
      };
    }
    if (String(url).endsWith("/v3/userinfo")) {
      return { ok: true, status: 200, json: async () => ({ email: "paul@ejemplo.com" }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const oauth = makeOAuth({ dataDir: dir, fetchImpl: fetchMock, authBase: "https://auth.mock", profileUrl: "https://auth.mock/v3/userinfo" });
  const bad = oauth.storeCredentials({ clientId: "nope", clientSecret: "short" });
  assert.ok(bad.error !== undefined);
  oauth.storeCredentials({ clientId: "1234-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-supersecret" });

  // Drive the loopback flow like a browser would.
  const begun = await oauth.beginFlow();
  assert.match(begun.consentUrl, /https:\/\/auth\.mock\/o\/oauth2\/v2\/auth/u);
  assert.match(begun.consentUrl, /access_type=offline/u);
  const consentUrl = new URL(begun.consentUrl);
  const state = consentUrl.searchParams.get("state");
  const redirectUri = new URL(begun.redirectUri);
  const browserGet = await fetch(`${redirectUri.origin}/?code=4/0AbCdEf&state=${state}`);
  await browserGet.text();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const status = oauth.status();
  assert.equal(status.connected, true);
  assert.equal(status.email, "paul@ejemplo.com");

  // First token use, then force-expire and refresh.
  const token1 = await oauth.accessToken();
  assert.equal(token1, "at-1");
  const tokens = JSON.parse(readFileSync(join(dir, "oauth-tokens.json"), "utf8"));
  tokens.accessTokenExpiresAt = Date.now() - 1000;
  const { writeFileSync, renameSync } = await import("node:fs");
  writeFileSync(join(dir, "oauth-tokens.json"), JSON.stringify(tokens));
  void renameSync;
  const token2 = await oauth.accessToken();
  assert.equal(token2, "at-1");
  assert.deepEqual(tokenRequests, ["authorization_code", "refresh_token"]);
  rmSync(dir, { recursive: true, force: true });
});

test("gmail client: request construction against a mocked fetch, graceful unauth", async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? "GET" });
    if (String(url).includes("/messages")) {
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "m1", threadId: "t1" }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const client = makeGmail({ accessToken: async () => "tok", fetchImpl: fetchMock, apiBase: "https://api.mock" });
  await client.listMessages({ query: "from:maria newer_than:7d", maxResults: 10 });
  assert.match(calls[0].url, /api\.mock\/gmail\/v1\/users\/me\/messages\?/u);
  assert.match(calls[0].url, /from%3Amaria\+newer_than%3A7d/u);

  const unauth = makeGmail({ accessToken: async () => null, fetchImpl: fetchMock, apiBase: "https://api.mock" });
  await assert.rejects(() => unauth.listMessages({}), /not connected/u);
});

test("mcp server: handshake, catalog, unauthenticated behavior — as a real child process", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "inbox-mcp-"));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGENC_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const responses = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      responses.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  const tool = (name, args) =>
    call("tools/call", { name, arguments: args }).then(
      (r) => r.result?.structuredContent ?? r.result?.content?.[0]?.text ?? r.error,
    );
  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "inbox");
    const catalog = await call("tools/list");
    const names = catalog.result.tools.map((t) => t.name);
    for (const expected of [
      "auth_store_credentials", "auth_begin", "auth_status", "auth_disconnect",
      "digest", "search", "read", "loops_scan", "graph_stats",
      "cleanup_scan", "documents_scan", "vault_fetch", "vault_search", "label_apply",
    ]) {
      assert.ok(names.includes(expected), `tool ${expected} listed`);
    }
    const status = await tool("auth_status", {});
    assert.equal(status.connected, false);
    assert.match(status.setupHint, /console\.cloud\.google\.com/u);
    const digest = await tool("digest", {});
    assert.match(JSON.stringify(digest), /not connected|auth_begin/ui);
    const badCreds = await tool("auth_store_credentials", { clientId: "x", clientSecret: "y" });
    assert.match(badCreds, /Invalid credentials/u);
    const unknown = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(unknown.error.code, -32602);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(responses.every((m) => m.id !== undefined), "no response to notifications");
  } finally {
    child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  }
});
