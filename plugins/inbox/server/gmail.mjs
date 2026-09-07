/**
 * Minimal Gmail API client over plain fetch: search/list, message fetch
 * (format=full so the MIME tree is pre-parsed), labels, label modify, and
 * attachment download. Read-only plus label mutations — never send, never
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
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gmail API ${path} failed: HTTP ${response.status} ${detail.slice(0, 200)}`);
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
      const out = [];
      let pageToken;
      do {
        const page = await call("messages", {
          query: { q: query, maxResults: Math.min(max - out.length, 100) || 1, pageToken },
        });
        out.push(...(page.messages ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken !== undefined && out.length < max);
      return out.slice(0, max);
    },

    async getMessage(id, { format = "full" } = {}) {
      return await call(`messages/${id}`, { query: { format } });
    },

    async getThread(id) {
      return await call(`threads/${id}`);
    },

    async getProfile() {
      return await call("profile");
    },

    async listLabels() {
      return await call("labels");
    },

    /** Non-destructive triage: only add/remove labels. */
    async modifyLabels(messageId, { addLabelIds = [], removeLabelIds = [] } = {}) {
      return await call(`messages/${messageId}/modify`, {
        method: "POST",
        body: { addLabelIds, removeLabelIds },
      });
    },

    async getAttachment(messageId, attachmentId) {
      return await call(`messages/${messageId}/attachments/${attachmentId}`);
    },
  };
}
