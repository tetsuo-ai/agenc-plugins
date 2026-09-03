/**
 * Daily-bar market data with source fallback: Yahoo v8 chart first
 * (keyless JSON), Stooq CSV second (keyless, occasionally bot-challenged
 * on datacenter IPs). Both are read-only public endpoints; every response
 * is TTL-cached so repeat analysis is instant and polite.
 */
import { makeCache, TTL } from "./cache.mjs";
import { makeStooq } from "./stooq.mjs";
import { makeYahoo } from "./yahoo.mjs";

export function makeMarketData({ cache = makeCache("/tmp/stonks-copilot"), fetchImpl } = {}) {
  const yahoo = makeYahoo({ fetchImpl });
  const stooq = makeStooq({ cache, fetchImpl });

  async function dailyBars(symbol, { months = 24 } = {}) {
    const normalized = String(symbol).trim().toUpperCase();
    const cacheKey = `bars-${normalized}-${months}m`;
    const cached = cache.get(cacheKey, TTL.DAILY_BARS);
    if (cached !== null) return cached;

    const errors = [];
    for (const [source, fetchBars] of [
      ["yahoo", () => yahoo.dailyBars(normalized, { months })],
      ["stooq", () => stooq.dailyBars(normalized, { months })],
    ]) {
      try {
        const bars = await fetchBars();
        cache.set(cacheKey, bars);
        return bars;
      } catch (error) {
        errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`no market data source could serve ${normalized} (${errors.join("; ")})`);
  }

  return { dailyBars };
}
