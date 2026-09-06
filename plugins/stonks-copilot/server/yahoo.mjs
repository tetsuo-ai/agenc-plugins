/**
 * Yahoo Finance v8 chart client for daily OHLCV bars — keyless JSON used
 * by most open-source finance tooling. Treated as an unofficial API: the
 * plugin reads it read-only with a descriptive user agent and cache TTLs,
 * and Stooq remains the fallback when Yahoo throttles.
 */

import { fetchPublic } from "./http.mjs";

export function makeYahoo({ fetchImpl = globalThis.fetch } = {}) {
  async function dailyBars(symbol, { months = 24 } = {}) {
    const range = monthsToRange(months);
    const ticker = String(symbol).trim().toUpperCase().replace(/^([A-Z]+)\.([A-Z])$/u, "$1-$2");
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&includePrePost=false`;
    const body = await fetchPublic(url, { fetchImpl,
      headers: { "user-agent": "stonks-copilot (+github.com/tetsuo-ai/agenc-plugins)" },
    });
    const result = body?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const quote = result?.indicators?.quote?.[0];
    if (!Array.isArray(timestamps) || quote === undefined) {
      throw new Error(`yahoo chart returned no series for ${symbol}`);
    }
    const currency = result.meta?.currency ?? null;
    if (currency !== "USD") throw new Error(`unsupported or unknown quote currency for ${symbol}: ${currency ?? "unavailable"}; USD prices required`);
    const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: result.meta?.exchangeTimezoneName ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    const bars = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const close = quote.close?.[i];
      const open = finiteOrNull(quote.open?.[i]);
      const high = finiteOrNull(quote.high?.[i]);
      const low = finiteOrNull(quote.low?.[i]);
      if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)
        || high < Math.max(open, close, low) || low > Math.min(open, close, high)
        || !Number.isFinite(timestamps[i])) continue;
      bars.push({
        date: dateFormatter.format(new Date(timestamps[i] * 1000)),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(quote.volume?.[i]) && quote.volume[i] >= 0 ? quote.volume[i] : null,
        source: "Yahoo Finance chart (unofficial)",
        currency,
        priceBasis: "provider daily OHLC close; dividends excluded",
      });
    }
    if (bars.length === 0) throw new Error(`yahoo chart series for ${symbol} was empty`);
    return [...new Map(bars.map((bar) => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  return { dailyBars };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function monthsToRange(months) {
  if (months <= 1) return "1mo";
  if (months <= 3) return "3mo";
  if (months <= 6) return "6mo";
  if (months <= 12) return "1y";
  if (months <= 24) return "2y";
  if (months <= 60) return "5y";
  return "10y";
}
