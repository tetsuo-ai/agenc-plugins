/**
 * Yahoo Finance v8 chart client for daily OHLCV bars — keyless JSON used
 * by most open-source finance tooling. Treated as an unofficial API: the
 * plugin reads it read-only with a descriptive user agent and cache TTLs,
 * and Stooq remains the fallback when Yahoo throttles.
 */

export function makeYahoo({ fetchImpl = globalThis.fetch } = {}) {
  async function dailyBars(symbol, { months = 24 } = {}) {
    const range = monthsToRange(months);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=${range}&interval=1d&includePrePost=false`;
    const response = await fetchImpl(url, {
      headers: { "user-agent": "stonks-copilot (+github.com/tetsuo-ai/agenc-plugins)" },
    });
    if (!response.ok) throw new Error(`yahoo chart request failed: HTTP ${response.status}`);
    const body = await response.json();
    const result = body?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const quote = result?.indicators?.quote?.[0];
    if (!Array.isArray(timestamps) || quote === undefined) {
      throw new Error(`yahoo chart returned no series for ${symbol}`);
    }
    const bars = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const close = quote.close?.[i];
      if (close === null || close === undefined || !Number.isFinite(close)) continue;
      bars.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        open: finiteOrNull(quote.open?.[i]) ?? close,
        high: finiteOrNull(quote.high?.[i]) ?? close,
        low: finiteOrNull(quote.low?.[i]) ?? close,
        close,
        volume: finiteOrNull(quote.volume?.[i]) ?? 0,
      });
    }
    if (bars.length === 0) throw new Error(`yahoo chart series for ${symbol} was empty`);
    return bars;
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
