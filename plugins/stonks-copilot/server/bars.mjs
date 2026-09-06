/**
 * Daily-bar market data with source fallback: Yahoo v8 chart first
 * (keyless JSON), Stooq CSV second (keyless, occasionally bot-challenged
 * on datacenter IPs). Both are read-only public endpoints; every response
 * is TTL-cached so repeat analysis is instant and polite.
 */
import { makeCache, TTL } from "./cache.mjs";
import { makeStooq } from "./stooq.mjs";
import { makeYahoo } from "./yahoo.mjs";

export function makeMarketData({ cache = makeCache("/tmp/stonks-copilot"), fetchImpl, now = Date.now } = {}) {
  const yahoo = makeYahoo({ fetchImpl });
  const stooq = makeStooq({ cache, fetchImpl });

  async function dailyBars(symbol, { months = 24 } = {}) {
    const normalized = String(symbol).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,11}$/u.test(normalized)) throw new Error("invalid market-data symbol");
    if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("months must be an integer from 1 to 120");
    const cacheKey = `bars-v2-${normalized}-${months}m`;
    const cached = cache.get(cacheKey, TTL.DAILY_BARS);
    const fresh = (bars) => Array.isArray(bars) && bars.length > 0
      && bars.every((bar, index) => bar && typeof bar.date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(bar.date)
        && Number.isFinite(Date.parse(bar.date)) && new Date(bar.date).toISOString().slice(0, 10) === bar.date
        && bar.currency === "USD" && [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)
        && bar.high >= Math.max(bar.open, bar.low, bar.close) && bar.low <= Math.min(bar.open, bar.high, bar.close)
        && (bar.volume === null || Number.isFinite(bar.volume) && bar.volume >= 0)
        && (index === 0 || bar.date > bars[index - 1].date))
      && Number.isFinite(Date.parse(bars.at(-1).date))
      && now() - Date.parse(bars.at(-1).date) <= 7 * 86400000
      && Date.parse(bars.at(-1).date) <= now() + 86400000;
    if (fresh(cached)) return cached;

    const errors = [];
    for (const [source, fetchBars] of [
      ["yahoo", () => yahoo.dailyBars(normalized, { months })],
      ["stooq", () => stooq.dailyBars(normalized, { months })],
    ]) {
      try {
        const received = await fetchBars();
        const cutoff = new Date(now());
        cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
        const start = cutoff.toISOString().slice(0, 10);
        const end = new Date(now()).toISOString().slice(0, 10);
        const bars = received.filter((bar) => bar.date >= start && bar.date <= end);
        if (!fresh(bars)) throw new Error("latest daily bar is missing, invalid or more than seven calendar days old");
        bars.at(-1).fetchedAt = new Date(now()).toISOString();
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
