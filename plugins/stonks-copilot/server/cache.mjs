/**
 * TTL JSON cache under the plugin data directory (AGENC_PLUGIN_DATA when
 * launched by AgenC, a local fallback during development). Network fetchers
 * route every request through here so repeat analysis stays fast and
 * polite to public endpoints.
 */
import { createHash } from "node:crypto";
import { makeDataFiles } from "./stores.mjs";

export function makeCache(dataDir) {
  const files = makeDataFiles(dataDir, "cache");
  const pathFor = (key) => `${createHash("sha256").update(key).digest("hex")}.json`;
  return {
    get(key, maxAgeMs) {
      try {
        const parsed = JSON.parse(files.read(pathFor(key), 32 * 1024 * 1024) ?? "null");
        if (parsed === null || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || !Number.isFinite(parsed.storedAt)
            || parsed.storedAt > Date.now() || Date.now() - parsed.storedAt > maxAgeMs
            || !Object.hasOwn(parsed, "value")) {
          return null;
        }
        return parsed.value;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        files.write(pathFor(key), JSON.stringify({ storedAt: Date.now(), value }), 32 * 1024 * 1024);
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
