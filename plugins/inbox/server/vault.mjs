/**
 * Local attachment vault: downloaded attachments filed by content hash
 * under the plugin data directory with a JSON index (filename, sender,
 * date, Gmail ids) so "the PDF María sent in March" is one lookup.
 * Downloading is explicit — nothing is fetched behind the user's back.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function makeVault(dataDir) {
  const vaultDir = join(dataDir, "vault");
  const indexPath = join(vaultDir, "index.json");
  mkdirSync(vaultDir, { recursive: true });

  function loadIndex() {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return [];
    }
  }

  function saveIndex(items) {
    writeFileSync(indexPath, JSON.stringify({ items }, null, 2));
  }

  return {
    store({ buffer, filename, mimeType, from, date, messageId }) {
      const hash = createHash("sha256").update(buffer).digest("hex");
      const safeName = String(filename ?? "attachment").replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 80);
      const storedAs = join(vaultDir, `${hash.slice(0, 16)}-${safeName}`);
      writeFileSync(storedAs, buffer);
      const items = loadIndex();
      const existing = items.find((item) => item.hash === hash);
      if (existing === undefined) {
        items.push({
          hash,
          storedAs,
          filename: safeName,
          mimeType: mimeType ?? "application/octet-stream",
          sizeBytes: buffer.length,
          from: from ?? null,
          date: date ?? null,
          messageId: messageId ?? null,
          savedAt: new Date().toISOString(),
        });
        saveIndex(items);
      }
      return { path: storedAs, hash, sizeBytes: buffer.length, duplicate: existing !== undefined };
    },

    search({ query, from, after } = {}) {
      const items = loadIndex();
      const terms = String(query ?? "")
        .toLowerCase()
        .split(/\s+/u)
        .filter((term) => term.length > 0);
      return items.filter((item) => {
        if (from !== undefined && from !== null && !(item.from ?? "").includes(String(from).toLowerCase())) return false;
        if (after !== undefined && after !== null && (item.date ?? "") < String(after)) return false;
        const haystack = `${item.filename} ${item.from ?? ""}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    },

    stats() {
      const items = loadIndex();
      return {
        files: items.length,
        totalBytes: items.reduce((a, item) => a + (item.sizeBytes ?? 0), 0),
        byType: tally(items.map((item) => (item.mimeType ?? "other").split("/")[0])),
      };
    },
  };
}

function tally(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}
