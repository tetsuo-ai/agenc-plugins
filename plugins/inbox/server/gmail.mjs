/**
 * Minimal Gmail API client over plain fetch: search/list, message fetch
 * (format=full so the MIME tree is pre-parsed), labels and
 * attachment download. Read-only — never send, never
 * delete. Base URLs injectable for offline testing.
 */

export function makeGmail({
  accessToken,
  fetchImpl = globalThis.fetch,
  apiBase = "https://gmail.googleapis.com",
} = {}) {
  async function call(path, { method = "GET", query, body } = {}) {
    const token = await accessToken();
    if (token === null) {
      throw new Error("Gmail is not connected. Run auth_begin and complete the consent flow first.");
    }
    const url = new URL(`${apiBase}/gmail/v1/users/me/${path.replace(/^\//u, "")}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url.href, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`Gmail API request failed: HTTP ${response.status}`);
    }
    if (response.status === 204) return {};
    return await response.json();
  }

  return {
    /** Search/list messages. `query` is native Gmail search syntax. */
    async listMessages({ query, labelIds, maxResults = 25, pageToken } = {}) {
      return await call("messages", {
        query: { q: query, labelIds, maxResults, pageToken },
      });
    },

    async listAll({ query, max = 100 } = {}) {
      max = Math.floor(Math.min(500, Math.max(1, Number.isFinite(max) ? max : 100)));
      const out = [];
      const seen = new Set();
      let pageToken;
      do {
        const page = await call("messages", {
          query: { q: query, maxResults: Math.min(max - out.length, 100) || 1, pageToken },
        });
        out.push(...(page.messages ?? []));
        pageToken = page.nextPageToken;
        if (pageToken && seen.has(pageToken)) throw new Error("Gmail returned a repeated page token");
        seen.add(pageToken);
      } while (pageToken !== undefined && out.length < max);
      return out.slice(0, max);
    },

    async getMessage(id, { format = "full" } = {}) {
      return await call(`messages/${encodeURIComponent(id)}`, { query: { format } });
    },

    async getThread(id) {
      return await call(`threads/${encodeURIComponent(id)}`);
    },

    async getProfile() {
      return await call("profile");
    },

    async listLabels() {
      return await call("labels");
    },

    async getAttachment(messageId, attachmentId) {
      return await call(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    },
  };
}
