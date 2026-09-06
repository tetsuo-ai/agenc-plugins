/**
 * Pure technical-analysis math over daily OHLCV bars. No I/O, no state:
 * every function here is directly unit-testable and shared by the analyzer
 * scorecard and the price chart builder.
 */

/** @typedef {{date: string, open: number, high: number, low: number, close: number, volume: number}} Bar */

export function sma(values, period) {
  if (!Number.isInteger(period) || period <= 0 || values.length < period || !values.slice(-period).every(Number.isFinite)) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
  return sum / period;
}

export function emaSeries(values, period) {
  if (!Number.isInteger(period) || period <= 0 || values.length < period || !values.every(Number.isFinite)) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI over the last `period` changes. */
export function rsi(closes, period = 14) {
  if (!Number.isInteger(period) || period <= 0 || closes.length < period + 1 || !closes.every(Number.isFinite)) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (![fast, slow, signalPeriod].every((period) => Number.isInteger(period) && period > 0) || fast >= slow || closes.length < slow + signalPeriod - 1 || !closes.every(Number.isFinite)) return null;
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (fastEma[i] !== undefined && slowEma[i] !== undefined) {
      macdLine[i] = fastEma[i] - slowEma[i];
    }
  }
  const defined = macdLine.filter((v) => v !== undefined);
  const signalEma = emaSeries(defined, signalPeriod);
  const signal = signalEma[signalEma.length - 1];
  const value = macdLine[macdLine.length - 1];
  const prev = macdLine[macdLine.length - 2];
  const prevSignal = signalEma[signalEma.length - 2];
  if (value === undefined || signal === undefined) return null;
  return {
    macd: value,
    signal,
    histogram: value - signal,
    crossedUp: prev !== undefined && prevSignal !== undefined && prev <= prevSignal && value > signal,
  };
}

/** Bollinger %B (0 = lower band, 1 = upper band) over the last 20 closes. */
export function bollingerPercentB(closes, period = 20, mult = 2) {
  if (!Number.isInteger(period) || period <= 0 || !Number.isFinite(mult) || mult <= 0 || closes.length < period || !closes.slice(-period).every(Number.isFinite)) return null;
  const window = closes.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + mult * sd;
  const lower = mean - mult * sd;
  const last = closes[closes.length - 1];
  if (upper === lower) return 0.5;
  return (last - lower) / (upper - lower);
}

/** Local-extrema pivots: swing highs/lows over the trailing window. */
export function pivots(bars, lookback = 180, neighbours = 3) {
  const window = bars.slice(-lookback);
  const highs = [];
  const lows = [];
  for (let i = neighbours; i < window.length - neighbours; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - neighbours; j <= i + neighbours; j += 1) {
      if (j === i) continue;
      if (window[j].high >= window[i].high) isHigh = false;
      if (window[j].low <= window[i].low) isLow = false;
    }
    if (isHigh) highs.push(window[i].high);
    if (isLow) lows.push(window[i].low);
  }
  return { highs, lows };
}

/**
 * Cluster pivot levels so near-identical swings collapse into one zone.
 * Returns levels sorted by strength (how many pivots merged into it).
 */
export function levelZones(levels, tolerancePercent = 1.5) {
  const sorted = [...levels].sort((a, b) => a - b);
  const zones = [];
  for (const level of sorted) {
    const last = zones[zones.length - 1];
    if (last && Math.abs(level - last.level) / last.level * 100 <= tolerancePercent) {
      last.level = (last.level * last.count + level) / (last.count + 1);
      last.count += 1;
    } else {
      zones.push({ level, count: 1 });
    }
  }
  return zones.sort((a, b) => b.count - a.count);
}

/**
 * Full technical snapshot with a scored verdict. Each signal maps to
 * -1 (bearish), 0 (neutral) or +1 (bullish) with a human reason; the score
 * is the mean mapped to 0-100.
 * @param {Bar[]} bars
 */
export function technicalSnapshot(bars) {
  if (!Array.isArray(bars) || bars.length === 0 || !bars.every((bar) => Number.isFinite(bar.close))) throw new Error("technical analysis requires finite daily closes");
  const closes = bars.map((bar) => bar.close);
  const last = closes[closes.length - 1];
  const signals = [];
  const add = (name, value, verdict, reason) =>
    signals.push({ name, value, verdict, reason });

  for (const period of [50, 200]) {
    const value = sma(closes, period);
    if (value === null) continue;
    const above = last > value;
    add(
      `sma${period}`,
      round2(value),
      last === value ? 0 : above ? 1 : -1,
      last === value ? `price equals SMA${period}` : above ? `price ${round2(last)} is above SMA${period}` : `price ${round2(last)} is below SMA${period}`,
    );
  }
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  if (sma50 !== null && sma200 !== null) {
    const golden = sma50 > sma200;
    add(
      "sma_cross",
      sma50 === sma200 ? "equal" : golden ? "golden" : "death",
      sma50 === sma200 ? 0 : golden ? 1 : -1,
      sma50 === sma200 ? "SMA50 equals SMA200" : golden ? "SMA50 above SMA200 (golden cross regime)" : "SMA50 below SMA200 (death cross regime)",
    );
  }

  const rsiValue = rsi(closes, 14);
  if (rsiValue !== null) {
    const verdict = rsiValue >= 70 ? -1 : rsiValue <= 30 ? 1 : 0;
    const reason =
      rsiValue >= 70
        ? "RSI14 is overbought (>=70)"
        : rsiValue <= 30
          ? "RSI14 is oversold (<=30)"
          : "RSI14 is neutral";
    add("rsi14", round2(rsiValue), verdict, reason);
  }

  const macdValue = macd(closes);
  if (macdValue !== null) {
    const verdict = macdValue.histogram > 0 ? 1 : macdValue.histogram < 0 ? -1 : 0;
    add(
      "macd",
      round2(macdValue.histogram),
      verdict,
      `MACD histogram is ${macdValue.histogram > 0 ? "positive" : macdValue.histogram < 0 ? "negative" : "flat"}${macdValue.crossedUp ? " with a fresh bullish crossover" : ""}`,
    );
  }

  const percentB = bollingerPercentB(closes);
  if (percentB !== null) {
    const verdict = percentB > 1 ? -1 : percentB < 0 ? 1 : 0;
    add(
      "bollinger",
      round2(percentB),
      verdict,
      percentB > 1
        ? "price closed above the upper Bollinger band (stretched)"
        : percentB < 0
          ? "price closed below the lower Bollinger band (stretched)"
          : "price is inside the Bollinger bands",
    );
  }

  const year = bars.slice(-252);
  if (year.length === 252 && year.every((bar) => Number.isFinite(bar.high) && Number.isFinite(bar.low))) {
    const high = Math.max(...year.map((bar) => bar.high));
    const low = Math.min(...year.map((bar) => bar.low));
    const drawdown = (last / high - 1) * 100;
    add(
      "range_52w",
      `${round2(low)}–${round2(high)}`,
      drawdown > -8 ? 1 : drawdown < -30 ? -1 : 0,
      `${round2(drawdown)}% below the 52-week high of ${round2(high)}`,
    );
  }

  if (bars.length >= 21) {
    const volumes = bars.slice(-21, -1).map((bar) => bar.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const lastVolume = bars[bars.length - 1].volume;
    if (volumes.every((volume) => Number.isFinite(volume) && volume >= 0) && Number.isFinite(lastVolume) && lastVolume >= 0 && avgVolume > 0) {
      const ratio = lastVolume / avgVolume;
      add(
        "volume",
        `${round2(ratio)}x`,
        ratio >= 1.5 ? 1 : 0,
        `last volume is ${round2(ratio)}x the 20-day average`,
      );
    }
  }

  const { lows, highs } = pivots(bars);
  const supports = levelZones(lows).filter((zone) => zone.level < last).slice(0, 3).map((zone) => ({
    level: round2(zone.level),
    touches: zone.count,
  }));
  const resistances = levelZones(highs)
    .filter((zone) => zone.level > last)
    .slice(0, 3)
    .map((zone) => ({ level: round2(zone.level), touches: zone.count }));

  const score = signals.length === 0
    ? 50
    : Math.round(((signals.reduce((a, s) => a + s.verdict, 0) / signals.length) + 1) * 50);

  return {
    lastClose: round2(last),
    asOf: bars[bars.length - 1].date,
    barsAnalyzed: bars.length,
    warnings: bars.length < 252 ? [`Only ${bars.length} daily bars available; indicators requiring longer history are omitted.`] : [],
    score,
    signals,
    supports,
    resistances,
  };
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}
