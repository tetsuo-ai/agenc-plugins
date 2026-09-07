/**
 * Gmail OAuth2 with a local loopback redirect — no third-party cloud, no
 * browser embedded: the plugin opens the consent URL, Google redirects to
 * http://localhost:<port> on this machine, and the code exchanges there.
 * Tokens live only in the plugin data directory. Endpoints are injectable
 * so the whole flow is testable against a local mock.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GMAIL_SCOPES = [
  // Read-only on mail; label modify for triage. No send, no delete.
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
];

export const DEFAULT_AUTH_BASE = "https://accounts.google.com";
export const DEFAULT_API_BASE = "https://gmail.googleapis.com";

export function makeOAuth({
  dataDir,
  fetchImpl = globalThis.fetch,
  authBase = DEFAULT_AUTH_BASE,
  profileUrl = "https://www.googleapis.com/oauth2/v3/userinfo",
  consoleUrl = "https://console.cloud.google.com/apis/credentials",
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const tokenPath = join(dataDir, "oauth-tokens.json");
  const credentialsPath = join(dataDir, "oauth-credentials.json");
  /** Pending loopback flow state, in-process only. */
  let pending = null;

  function loadJson(path, fallback) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return fallback;
    }
  }

  function saveJson(path, value) {
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
    renameSync(`${path}.tmp`, path);
  }

  function storeCredentials({ clientId, clientSecret }) {
    if (typeof clientId !== "string" || !/^[0-9A-Za-z-]+[0-9A-Za-z._-]*\.apps\.googleusercontent\.com$/u.test(clientId.trim())) {
      return { error: "clientId must look like <id>.apps.googleusercontent.com (Google Cloud → APIs & Services → Credentials → OAuth client, application type Desktop)" };
    }
    if (typeof clientSecret !== "string" || clientSecret.trim().length < 10) {
      return { error: "clientSecret is required (Desktop OAuth clients always have one)" };
    }
    saveJson(credentialsPath, { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    return { stored: true };
  }

  function credentials() {
    return loadJson(credentialsPath, null);
  }

  function tokens() {
    return loadJson(tokenPath, null);
  }

  function status() {
    const creds = credentials();
    const tok = tokens();
    return {
      credentialsStored: creds !== null,
      connected: tok?.refreshToken !== undefined,
      email: tok?.email ?? null,
      scopes: tok?.scope ?? null,
      tokenExpiresAt: tok?.accessTokenExpiresAt ?? null,
      consentUrl: pending?.consentUrl ?? null,
      pendingSince: pending?.startedAt ?? null,
      setupHint: creds === null
        ? `Create a Desktop OAuth client in ${consoleUrl}, enable the Gmail API for the project, then call auth_store_credentials. Keep the Google Cloud app in Testing mode with yourself as test user.`
        : null,
    };
  }

  /**
   * Begin the consent flow: spin up the loopback listener, return the URL
   * for the user to open. Completion happens in the background; poll with
   * auth_status.
   */
  async function beginFlow() {
    const creds = credentials();
    if (creds === null) {
      return { error: status().setupHint };
    }
    if (pending !== null) {
      return { consentUrl: pending.consentUrl, alreadyPending: true };
    }
    const port = await freePort();
    const redirectUri = `http://localhost:${port}`;
    const state = randomBytes(16).toString("hex");
    const consentUrl = new URL(`${authBase}/o/oauth2/v2/auth`);
    consentUrl.searchParams.set("client_id", creds.clientId);
    consentUrl.searchParams.set("redirect_uri", redirectUri);
    consentUrl.searchParams.set("response_type", "code");
    consentUrl.searchParams.set("scope", GMAIL_SCOPES.join(" "));
    consentUrl.searchParams.set("access_type", "offline");
    consentUrl.searchParams.set("prompt", "consent");
    consentUrl.searchParams.set("state", state);

    pending = { consentUrl: consentUrl.href, startedAt: new Date().toISOString(), port, state, server: null };
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, redirectUri);
      const respond = (title, detail) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:3rem"><h2>${title}</h2><p>${detail}</p><p>You can close this tab and return to your agent.</p></body>`);
      };
      if (url.pathname !== "/" || !url.searchParams.has("code")) {
        respond("Nothing here", "This page expects the Google OAuth redirect.");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        respond("State mismatch", "The OAuth state does not match this flow; restart the setup.");
        return;
      }
      try {
        const exchanged = await exchangeCode(url.searchParams.get("code"), creds, redirectUri);
        const profile = await fetchProfile(exchanged.accessToken);
        saveJson(tokenPath, {
          ...exchanged,
          email: profile?.email ?? null,
          savedAt: new Date().toISOString(),
        });
        pending.completed = true;
        respond("Inbox connected", `Gmail access stored locally for ${profile?.email ?? "your account"}.`);
      } catch (error) {
        pending.error = String(error instanceof Error ? error.message : error);
        respond("Connection failed", pending.error);
      } finally {
        // One redirect per flow: close the loopback once the browser got
        // its confirmation (or the failure note).
        setTimeout(() => {
          try {
            server.close();
          } catch {
            // already closed
          }
          if (pending !== null && pending.server === server) pending = null;
        }, 1000).unref();
      }
    });
    pending.server = server;
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    // Auto-close the listener after 10 minutes of waiting.
    setTimeout(() => {
      if (pending !== null && !pending.completed) {
        server.close();
        pending = null;
      }
    }, 10 * 60 * 1000).unref();
    return { consentUrl: consentUrl.href, redirectUri, note: "Open the URL, sign in, and the tab will confirm. Poll auth_status until connected:true." };
  }

  async function exchangeCode(code, creds, redirectUri) {
    const response = await fetchImpl(`${authBase}/oauth2/v4/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`token exchange failed: HTTP ${response.status}`);
    const body = await response.json();
    if (body.refresh_token === undefined) throw new Error("Google returned no refresh_token; retry after revoking app access or keep prompt=consent");
    return {
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      accessTokenExpiresAt: Date.now() + body.expires_in * 1000,
      scope: body.scope ?? GMAIL_SCOPES.join(" "),
    };
  }

  async function fetchProfile(accessToken) {
    try {
      const response = await fetchImpl(profileUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      const body = await response.json();
      return { email: body.email ?? null };
    } catch {
      return null;
    }
  }

  /** Valid access token, refreshing transparently when expired. */
  async function accessToken() {
    const tok = tokens();
    if (tok?.refreshToken === undefined) return null;
    if (tok.accessTokenExpiresAt - 60_000 > Date.now()) return tok.accessToken;
    const creds = credentials();
    const response = await fetchImpl(`${authBase}/oauth2/v4/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: tok.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error(`token refresh failed: HTTP ${response.status} — if the app is in Testing mode the refresh token expires weekly; reconnect with auth_begin`);
    const body = await response.json();
    const updated = {
      ...tok,
      accessToken: body.access_token,
      accessTokenExpiresAt: Date.now() + body.expires_in * 1000,
    };
    saveJson(tokenPath, updated);
    return updated.accessToken;
  }

  function disconnect() {
    try {
      writeFileSync(tokenPath, "{}");
    } catch {
      // best-effort
    }
    return { disconnected: true };
  }

  return { storeCredentials, credentials, tokens, status, beginFlow, accessToken, disconnect };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.once("error", reject);
  });
}
