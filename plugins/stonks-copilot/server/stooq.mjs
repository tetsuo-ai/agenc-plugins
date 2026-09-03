/**
 * Stooq public CSV endpoint client for daily OHLCV bars. No API key, no
 * auth; politeness comes from the shared TTL cache. Bare US tickers are
 * suffixed with `.us` per Stooq's convention.
 */

export function makeStooq({ cache, fetchImpl = globalThis.fetch, baseUrl = "https://stooq.com" } = {}) {
  async function dailyBars(symbol, { months = 24 } = {}) {
    const stooqSymbol = normalizeSymbol(symbol);
    const cacheKey = `stooq-${stooqSymbol}-${months}m`;
    const cached = cache?.get(cacheKey, 12 * 3600 * 1000);
    if (cached !== null) return cached;
    const d1 = isoDaysAgo(months * 31 + 31);
    const d2 = isoDaysAgo(0);
    const url = `${baseUrl}/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${d1}&d2=${d2}&i=d`;
    const response = await fetchImpl(url, { headers: { "user-agent": "stonks-copilot (+github.com/tetsuo-ai/agenc-plugins)" } });
    if (!response.ok) throw new Error(`stooq request failed: HTTP ${response.status}`);
    const text = await response.text();
    const bars = parseStooqCsv(text);
    if (bars.length === 0) throw new Error(`stooq returned no rows for ${symbol} (unknown symbol or rate limit)`);
    cache?.set(cacheKey, bars);
    return bars;
  }
  return { dailyBars };
}

export function normalizeSymbol(symbol) {
  const cleaned = String(symbol).trim().toUpperCase();
  if (cleaned.includes(".")) return cleaned.toLowerCase();
  return `${cleaned.toLowerCase()}.us`;
}

export function parseStooqCsv(text) {
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length < 2 || !/^Date,/iu.test(lines[0])) return [];
  const bars = [];
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(",");
    const bar = {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
    if (bar.date && Number.isFinite(bar.close) && bar.close > 0) bars.push(bar);
  }
  return bars;
}

function isoDaysAgo(days) {
  const date = new Date(Date.now() - days * 24 * 3600 * 1000);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}
