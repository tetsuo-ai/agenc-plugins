/**
 * Stooq public CSV endpoint client for daily OHLCV bars. No API key, no
 * auth; politeness comes from the shared TTL cache. Bare US tickers are
 * suffixed with `.us` per Stooq's convention.
 */

import { fetchPublic } from "./http.mjs";

export function makeStooq({ cache, fetchImpl = globalThis.fetch, baseUrl = "https://stooq.com" } = {}) {
  async function dailyBars(symbol, { months = 24 } = {}) {
    const stooqSymbol = normalizeSymbol(symbol);
    if (!stooqSymbol.endsWith(".us")) throw new Error("Stooq fallback supports US listings only");
    const cacheKey = `stooq-v2-${stooqSymbol}-${months}m`;
    const cached = cache?.get(cacheKey, 12 * 3600 * 1000);
    if (cached != null) return cached;
    const d1 = isoDaysAgo(months * 31 + 31);
    const d2 = isoDaysAgo(0);
    const url = `${baseUrl}/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${d1}&d2=${d2}&i=d`;
    const text = await fetchPublic(url, { fetchImpl, format: "text", headers: { "user-agent": "stonks-copilot (+github.com/tetsuo-ai/agenc-plugins)" } });
    const bars = parseStooqCsv(text).map((bar) => ({ ...bar, source: "Stooq", currency: "USD", priceBasis: "provider daily OHLC close; adjustment policy unverified" }));
    if (bars.length === 0) throw new Error(`stooq returned no rows for ${symbol} (unknown symbol or rate limit)`);
    cache?.set(cacheKey, bars);
    return bars;
  }
  return { dailyBars };
}

export function normalizeSymbol(symbol) {
  const cleaned = String(symbol).trim().toUpperCase();
  if (/^[A-Z]+[.-][A-Z]$/u.test(cleaned)) return `${cleaned.replace(".", "-").toLowerCase()}.us`;
  if (cleaned.includes(".")) return cleaned.toLowerCase();
  return `${cleaned.toLowerCase()}.us`;
}

export function parseStooqCsv(text) {
  const lines = text.replace(/^\uFEFF/u, "").trim().split(/\r?\n/u);
  if (lines.length < 2 || !/^Date,/iu.test(lines[0])) return [];
  const bars = [];
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(",");
    const bar = {
      date,
      open: numberCell(open),
      high: numberCell(high),
      low: numberCell(low),
      close: numberCell(close),
      volume: numberCell(volume),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date ?? "") || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) continue;
    if (![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)) continue;
    if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) continue;
    if (bar.volume !== null && bar.volume < 0) bar.volume = null;
    bars.push(bar);
  }
  return [...new Map(bars.map((bar) => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

function numberCell(value) {
  if (value === undefined || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoDaysAgo(days) {
  const date = new Date(Date.now() - days * 24 * 3600 * 1000);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}
