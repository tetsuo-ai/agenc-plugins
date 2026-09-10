/** Desktop OAuth: loopback + PKCE, read-only Gmail and private local storage. */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
export const DEFAULT_AUTH_BASE = "https://accounts.google.com";
export const DEFAULT_API_BASE = "https://gmail.googleapis.com";

export function makeOAuth({ dataDir, fetchImpl = globalThis.fetch, authBase = DEFAULT_AUTH_BASE,
  tokenUrl = "https://oauth2.googleapis.com/token",
  profileUrl = "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  consoleUrl = "https://console.cloud.google.com/apis/credentials" } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tokenPath = join(dataDir, "oauth-tokens.json");
  const credentialsPath = join(dataDir, "oauth-credentials.json");
  let pending = null;
  let lastError = null;
  let generation = 0;
  let refreshing = null;

  function loadJson(path) {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw new Error("Cannot read local OAuth state; original file preserved"); }
  }
  function saveJson(path, value) {
    const temporary = path + "." + randomBytes(12).toString("hex") + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
    } finally { rmSync(temporary, { force: true }); }
  }
  const credentials = () => loadJson(credentialsPath);
  const tokens = () => loadJson(tokenPath);
  function cancelPending() {
    if (!pending) return;
    pending.controller.abort();
    clearTimeout(pending.timer);
    pending.server?.close();
    pending = null;
  }
  function disconnect() {
    generation += 1;
    cancelPending();
    rmSync(tokenPath, { force: true });
    return { disconnected: true, note: "Local tokens removed. Revoke Google account access separately if desired." };
  }
  function storeCredentials({ clientId, clientSecret }) {
    if (typeof clientId !== "string" || !/^[0-9A-Za-z-]+[0-9A-Za-z._-]*\.apps\.googleusercontent\.com$/u.test(clientId.trim())) return { error: "clientId must be a Google Desktop OAuth client ID (*.apps.googleusercontent.com)" };
    if (typeof clientSecret !== "string" || clientSecret.trim().length < 10) return { error: "clientSecret is required for the Desktop OAuth client" };
    disconnect();
    saveJson(credentialsPath, { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    return { stored: true };
  }
  function status() {
    const creds = credentials(); const tok = tokens();
    return { credentialsStored: creds !== null, connected: typeof tok?.refreshToken === "string" && tok.refreshToken.length > 0,
      email: tok?.email ?? null, scopes: tok?.scope ?? null, tokenExpiresAt: tok?.accessTokenExpiresAt ?? null,
      consentUrl: pending?.consentUrl ?? null, pendingSince: pending?.startedAt ?? null, lastError,
      setupHint: creds === null ? "Create a Desktop OAuth client in " + consoleUrl + ", enable Gmail API, then use auth_store_credentials. Testing-mode apps require periodic reauthorization." : null };
  }
  async function requestToken(body, signal) {
    const response = await fetchImpl(tokenUrl, { method: "POST", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    if (!response.ok) throw new Error("Google token request failed: HTTP " + response.status + "; reconnect if access expired or was revoked");
    const value = await response.json();
    if (typeof value.access_token !== "string" || !value.access_token || !Number.isFinite(Number(value.expires_in)) || Number(value.expires_in) <= 0) throw new Error("Google returned an invalid token response");
    return value;
  }
  async function beginFlow() {
    const creds = credentials();
    if (!creds) return { error: status().setupHint };
    if (pending) return { consentUrl: pending.consentUrl, alreadyPending: true };
    lastError = null;
    const flowGeneration = generation;
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const flow = { startedAt: new Date().toISOString(), controller: new AbortController(), claimed: false };
    pending = flow;
    let redirectUri;
    const server = createServer(async (req, res) => {
      const respond = (statusCode, message) => {
        res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(message);
      };
      const url = new URL(req.url, redirectUri);
      if (req.method !== "GET" || url.pathname !== "/") return respond(404, "Not found");
      if (url.searchParams.get("state") !== state) return respond(400, "OAuth state mismatch");
      if (pending !== flow || flow.claimed) return respond(409, "This consent flow is no longer active");
      if (url.searchParams.has("error")) { lastError = "Google consent was denied. Start auth_begin to retry."; respond(400, lastError); cancelPending(); return; }
      const code = url.searchParams.get("code");
      if (!code) return respond(400, "Missing authorization code");
      flow.claimed = true;
      try {
        const body = await requestToken({ code, client_id: creds.clientId, client_secret: creds.clientSecret,
          redirect_uri: redirectUri, code_verifier: verifier, grant_type: "authorization_code" }, flow.controller.signal);
        if (typeof body.refresh_token !== "string" || !body.refresh_token) throw new Error("Google returned no refresh token; reconnect with consent");
        const profileResponse = await fetchImpl(profileUrl, { headers: { authorization: "Bearer " + body.access_token }, redirect: "error", signal: AbortSignal.any([flow.controller.signal, AbortSignal.timeout(15000)]) });
        if (!profileResponse.ok) throw new Error("Gmail profile failed: HTTP " + profileResponse.status);
        const profile = await profileResponse.json();
        if (pending !== flow || generation !== flowGeneration) throw new Error("Consent was cancelled");
        saveJson(tokenPath, { refreshToken: body.refresh_token, accessToken: body.access_token,
          accessTokenExpiresAt: Date.now() + Number(body.expires_in) * 1000, scope: body.scope ?? GMAIL_SCOPES.join(" "),
          email: profile.emailAddress ?? profile.email ?? null, savedAt: new Date().toISOString() });
        respond(200, "Inbox connected. You can close this tab and return to the app.");
      } catch (error) {
        lastError = error instanceof Error ? error.message : "OAuth connection failed";
        respond(400, lastError);
      } finally { if (pending === flow) cancelPending(); }
    });
    flow.server = server;
    try {
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    } catch (error) { cancelPending(); throw error; }
    redirectUri = "http://127.0.0.1:" + server.address().port;
    const consentUrl = new URL(authBase + "/o/oauth2/v2/auth");
    for (const [key, value] of Object.entries({ client_id: creds.clientId, redirect_uri: redirectUri, response_type: "code",
      scope: GMAIL_SCOPES.join(" "), access_type: "offline", prompt: "consent", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })) consentUrl.searchParams.set(key, value);
    flow.consentUrl = consentUrl.href;
    flow.timer = setTimeout(() => { if (pending === flow) { lastError = "Consent timed out. Start auth_begin to retry."; cancelPending(); } }, 600000).unref();
    return { consentUrl: consentUrl.href, redirectUri, note: "Open in your system browser; poll auth_status. Gmail access is read-only." };
  }
  async function accessToken() {
    const tok = tokens();
    if (!tok?.refreshToken) return null;
    if (tok.accessToken && tok.accessTokenExpiresAt - 60000 > Date.now()) return tok.accessToken;
    if (refreshing) return refreshing;
    const currentGeneration = generation;
    refreshing = (async () => {
      const creds = credentials();
      if (!creds) throw new Error("Missing OAuth credentials; reconnect Gmail");
      const body = await requestToken({ refresh_token: tok.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "refresh_token" });
      if (generation !== currentGeneration) throw new Error("Gmail was disconnected while refreshing");
      const updated = { ...tok, accessToken: body.access_token, accessTokenExpiresAt: Date.now() + Number(body.expires_in) * 1000 };
      saveJson(tokenPath, updated);
      return updated.accessToken;
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }
  return { storeCredentials, credentials, tokens, status, beginFlow, accessToken, disconnect };
}
