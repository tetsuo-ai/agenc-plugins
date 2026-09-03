/**
 * TTL JSON cache under the plugin data directory (AGENC_PLUGIN_DATA when
 * launched by AgenC, a local fallback during development). Network fetchers
 * route every request through here so repeat analysis stays fast and
 * polite to public endpoints.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function makeCache(dataDir) {
  const dir = join(dataDir, "cache");
  mkdirSync(dir, { recursive: true });
  const pathFor = (key) => join(dir, `${key.replace(/[^a-z0-9._-]/giu, "_")}.json`);
  return {
    get(key, maxAgeMs) {
      try {
        const parsed = JSON.parse(readFileSync(pathFor(key), "utf8"));
        if (typeof parsed.storedAt !== "number" || Date.now() - parsed.storedAt > maxAgeMs) {
          return null;
        }
        return parsed.value;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        writeFileSync(pathFor(key), JSON.stringify({ storedAt: Date.now(), value }));
      } catch {
        // cache writes are best-effort
      }
    },
  };
}

export const TTL = {
  /** Daily bars: refresh at most twice a day. */
  DAILY_BARS: 12 * 3600 * 1000,
  /** Fundamentals: annual filings, day granularity is plenty. */
  FUNDAMENTALS: 24 * 3600 * 1000,
  /** Ticker→CIK map: monthly. */
  TICKER_MAP: 30 * 24 * 3600 * 1000,
  /** N-PORT constituents: quarterly filings. */
  NPORT: 90 * 24 * 3600 * 1000,
};
