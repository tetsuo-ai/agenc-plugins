/**
 * Zero-dependency chart rendering: standalone SVG artifacts (price chart
 * with moving averages and portfolio treemap), plus a future typed chart
 * payload. Pure functions, no I/O.
 */

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** Preserve complete OHLC bars when a long history needs fewer chart points. */
export function chartBars(bars, maxPoints = 600) {
  if (bars.length <= maxPoints) return { bars, indices: bars.map((_, i) => i), period: "daily" };
  const weeks = [];
  let group = [];
  let previousWeek = null;
  for (let i = 0; i < bars.length; i += 1) {
    const date = new Date(`${bars[i].date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const week = date.toISOString().slice(0, 10);
    if (week !== previousWeek && group.length > 0) weeks.push(group);
    if (week !== previousWeek) group = [];
    group.push(i);
    previousWeek = week;
  }
  if (group.length > 0) weeks.push(group);
  const span = Math.ceil(weeks.length / maxPoints);
  const groups = [];
  for (let i = 0; i < weeks.length; i += span) groups.push(weeks.slice(i, i + span).flat());
  return {
    bars: groups.map((indices) => {
      const batch = indices.map((index) => bars[index]);
      return {
        date: batch.at(-1).date,
        open: batch[0].open,
        high: Math.max(...batch.map((bar) => bar.high)),
        low: Math.min(...batch.map((bar) => bar.low)),
        close: batch.at(-1).close,
        volume: batch.every((bar) => Number.isFinite(bar.volume))
          ? batch.reduce((sum, bar) => sum + bar.volume, 0) : null,
      };
    }),
    indices: groups.map((indices) => indices.at(-1)),
    period: span === 1 ? "weekly" : `${span}-week`,
  };
}

/** AgenC chat chart format v1. Moving averages remain daily-period values. */
export function priceChartBlock(bars, { symbol, maxPoints = 600, lastPoints = null } = {}) {
  if (bars.length === 0) return null;
  const start = lastPoints === null ? 0 : Math.max(0, bars.length - lastPoints);
  const sampled = chartBars(bars.slice(start), maxPoints);
  const closes = bars.map((bar) => bar.close);
  const series = [{
    type: "candlestick", name: symbol, scale: "price",
    data: sampled.bars.map((bar) => ({ time: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close })),
  }];
  for (const period of [50, 200]) {
    const values = smaAligned(closes, period);
    const data = sampled.indices.flatMap((index) => Number.isFinite(values[index + start])
      ? [{ time: bars[index + start].date, value: values[index + start] }] : []);
    if (data.length > 0) series.push({ type: "line", name: `SMA ${period}`, scale: "price", data });
  }
  const volume = sampled.bars.flatMap((bar) => Number.isFinite(bar.volume)
    ? [{ time: bar.date, value: bar.volume }] : []);
  if (volume.length > 0) series.push({ type: "histogram", name: "Volume", scale: "volume", data: volume });
  const latest = bars.at(-1);
  return {
    version: 1, kind: "timeseries", title: `${symbol}, ${sampled.period}`,
    subtitle: `Source: ${latest.source ?? "market data"}. Last close ${latest.date}.`,
    currency: latest.currency ?? "USD", series,
  };
}

function smaAligned(values, period) {
  const out = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function sparkline(values, width = 24) {
  if (values.length < 2 || !values.every(Number.isFinite) || !Number.isInteger(width) || width < 2) return "";
  const sampled = sample(values, width);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const span = max - min;
  return sampled
    .map((value) => {
      const bucket = span === 0 ? 0 : Math.floor(((value - min) / span) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[bucket];
    })
    .join("");
}

function sample(values, width) {
  if (values.length <= width) return values;
  const out = [];
  for (let i = 0; i < width; i += 1) {
    out.push(values[Math.floor((i / (width - 1)) * (values.length - 1))]);
  }
  return out;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Price chart SVG: close line + optional SMA overlays + volume bars.
 * `overlays` maps a legend label to a full-length (or trailing) series.
 */
export function priceChartSvg(bars, { symbol, overlays = {}, width = 960, height = 480 } = {}) {
  if (bars.length < 2 || !bars.every((bar) => Number.isFinite(bar.close)) || !Number.isFinite(width) || width < 240 || !Number.isFinite(height) || height < 180) return null;
  const margin = { top: 100, right: 72, bottom: 42, left: 72 };
  const volumeHeight = Math.round((height - margin.top - margin.bottom) * 0.20);
  const priceHeight = height - margin.top - margin.bottom - volumeHeight - 24;
  const highs = bars.map((bar) => Number.isFinite(bar.high) ? bar.high : bar.close);
  const lows = bars.map((bar) => Number.isFinite(bar.low) ? bar.low : bar.close);
  let yMax = Math.max(...highs);
  let yMin = Math.min(...lows);
  for (const series of Object.values(overlays)) {
    for (const value of series) {
      if (!Number.isFinite(value)) continue;
      if (value > yMax) yMax = value;
      if (value < yMin) yMin = value;
    }
  }
  const yPad = (yMax - yMin) * 0.05 || 1;
  yMax += yPad;
  yMin -= yPad;
  const x = (i) => margin.left + (i / (bars.length - 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (1 - (value - yMin) / (yMax - yMin)) * priceHeight;
  const maxVolume = Math.max(...bars.map((bar) => Number.isFinite(bar.volume) && bar.volume > 0 ? bar.volume : 0), 1);
  const volumeY = (volume) =>
    height - margin.bottom - (volume / maxVolume) * volumeHeight;

  const closes = bars.map((bar) => bar.close);
  const last = closes[closes.length - 1];
  const previous = closes.at(-2);
  const change = previous === undefined ? null : last - previous;
  const lineColor = "#2563eb";
  const closePath = closes.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  const gridLines = [];
  const tickStep = niceStep(yMax - yMin, 5);
  const tickDecimals = Math.max(0, Math.min(8, -Math.floor(Math.log10(tickStep) + 1e-9)));
  for (let value = Math.ceil(yMin / tickStep) * tickStep; value <= yMax + tickStep * 1e-9; value += tickStep) {
    const py = y(value).toFixed(1);
    gridLines.push(
      `<line x1="${margin.left}" y1="${py}" x2="${width - margin.right}" y2="${py}" stroke="#cbd5e1" stroke-opacity="0.7" stroke-width="1"/>` +
        `<text x="${width - margin.right + 7}" y="${Number(py) + 4}" font-size="11" fill="#334155">${formatTick(value, tickDecimals)}</text>`,
    );
  }

  const overlayColors = { sma50: "#a16207", sma200: "#7c3aed" };
  const overlayPaths = Object.entries(overlays)
    .map(([label, series], index) => {
      const color = overlayColors[label] ?? ["#0f766e", "#be185d", "#4d7c0f"][index % 3];
      const offset = Math.max(0, bars.length - series.length);
      const defined = series.slice(-bars.length)
        .map((value, i) => (!Number.isFinite(value) ? null : `${x(i + offset).toFixed(1)},${y(value).toFixed(1)}`))
        .filter((point) => point !== null);
      if (defined.length < 2) return "";
      return `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${defined.join(" ")}"/>`;
    })
    .join("");

  const volumeBars = bars
    .map((bar, i) => {
      if (!Number.isFinite(bar.volume) || bar.volume < 0) return "";
      const barWidth = Math.max((width - margin.left - margin.right) / bars.length - 0.5, 0.5);
      return `<rect x="${(x(i) - barWidth / 2).toFixed(1)}" y="${volumeY(bar.volume).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(height - margin.bottom - volumeY(bar.volume)).toFixed(1)}" fill="${bar.close >= bar.open ? "#0f766e" : "#c2410c"}" fill-opacity="0.52"/>`;
    })
    .join("");

  const dateTicks = [0, Math.floor(bars.length / 2), bars.length - 1]
    .map((i, tick) => `<text x="${x(i).toFixed(1)}" y="${height - margin.bottom + 19}" font-size="11" fill="#334155" text-anchor="${tick === 0 ? "start" : tick === 2 ? "end" : "middle"}">${escapeXml(shortDate(bars[i].date))}</text>`)
    .join("");

  // Only overlays that actually draw a line get a legend entry.
  const legend = Object.entries(overlays)
    .filter(([, series]) => series.slice(-bars.length).filter((value) => Number.isFinite(value)).length >= 2)
    .map(([label], index) => {
      const color = overlayColors[label] ?? ["#0f766e", "#be185d", "#4d7c0f"][index % 3];
      const lx = margin.left + 112 + index * 110;
      return `<line x1="${lx}" y1="${margin.top - 17}" x2="${lx + 17}" y2="${margin.top - 17}" stroke="${color}" stroke-width="3"/><text x="${lx + 23}" y="${margin.top - 13}" font-size="12" fill="#334155">${escapeXml(label.toUpperCase().replace("SMA", "SMA "))}</text>`;
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#f8fafc" rx="12"/>`,
    `<text x="${margin.left}" y="34" font-size="14" font-weight="700" fill="#0f172a">${escapeXml(symbol)} · PRICE HISTORY</text>`,
    `<text x="${margin.left}" y="66" font-size="27" font-weight="700" fill="#0f172a">${fmtPrice(last)} ${escapeXml(bars.at(-1).currency ?? "USD")}</text>`,
    `<text x="${margin.left + 214}" y="63" font-size="14" font-weight="600" fill="${change === null ? "#475569" : change >= 0 ? "#0f766e" : "#c2410c"}">${change === null ? "Change unavailable" : `${change >= 0 ? "+" : ""}${fmtPrice(change)} (${((change / previous) * 100).toFixed(2)}%)`}</text>`,
    `<text x="${width - margin.right}" y="34" text-anchor="end" font-size="12" fill="#334155">AS OF ${escapeXml(bars.at(-1).date)}</text>`,
    `<line x1="${margin.left}" y1="83" x2="${width - margin.right}" y2="83" stroke="#cbd5e1"/>`,
    `<line x1="${margin.left}" y1="${margin.top + priceHeight + 12}" x2="${width - margin.right}" y2="${margin.top + priceHeight + 12}" stroke="#cbd5e1"/>`,
    `<text x="${margin.left}" y="${margin.top - 13}" font-size="11" fill="#334155">CLOSE</text>`,
    `<text x="${margin.left}" y="${height - margin.bottom - volumeHeight - 5}" font-size="11" fill="#334155">VOLUME</text>`,
    legend,
    gridLines.join(""),
    volumeBars,
    `<polyline fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${closePath}"/>`,
    overlayPaths,
    `<circle cx="${x(bars.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4" fill="${lineColor}" stroke="#f8fafc" stroke-width="2"/>`,
    dateTicks,
    `</svg>`,
  ].join("");
}

/**
 * Squarified treemap of portfolio weights. Items: { label, weight (0-1),
 * value (positive/negative return for coloring) }.
 */
export function treemapSvg(items, { title = "Portfolio", width = 960, height = 600 } = {}) {
  const normalized = items
    .filter((item) => Number.isFinite(item.weight) && item.weight > 0)
    .map((item) => ({ ...item, label: String(item.label) }))
    .sort((a, b) => b.weight - a.weight);
  const total = normalized.reduce((a, item) => a + item.weight, 0);
  if (total <= 0 || normalized.length === 0) return null;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#f8fafc" rx="12"/>`,
    `<text x="24" y="36" font-size="20" font-weight="700" fill="#0f172a">${escapeXml(String(title).length > 50 ? `${String(title).slice(0, 49)}…` : title)}</text>`,
    `<text x="24" y="59" font-size="12" fill="#334155">AREA = PORTFOLIO WEIGHT</text>`,
    `<rect x="${width - 297}" y="25" width="12" height="12" rx="2" fill="#0f766e"/><text x="${width - 280}" y="35" font-size="11" fill="#334155">Gain</text>`,
    `<rect x="${width - 221}" y="25" width="12" height="12" rx="2" fill="#c2410c"/><text x="${width - 204}" y="35" font-size="11" fill="#334155">Loss</text>`,
    `<rect x="${width - 142}" y="25" width="12" height="12" rx="2" fill="#475569"/><text x="${width - 125}" y="35" font-size="11" fill="#334155">P/L unknown</text>`,
  ];
  const bodyTop = 76;
  const bodyHeight = height - bodyTop - 18;
  const bodyWidth = width - 36;
  const bodyRects = squarify(
    normalized.map((item) => ({ ...item, area: (item.weight / total) * bodyWidth * bodyHeight })),
    { x: 18, y: bodyTop, w: bodyWidth, h: bodyHeight },
  );
  for (const rect of bodyRects) {
    const value = rect.value;
    const fill = !Number.isFinite(value) ? "#475569" : value >= 0 ? mixColor("#0f766e", "#115e59", value) : mixColor("#c2410c", "#9a3412", -value);
    const label = rect.label.length > 14 ? `${rect.label.slice(0, 13)}…` : rect.label;
    const fontSize = Math.min(17, Math.floor((rect.w - 18) / Math.max(label.length * 0.63, 1)));
    const showLabel = fontSize >= 10 && rect.w >= 55 && rect.h >= 44;
    parts.push(
      `<rect x="${(rect.x + 2).toFixed(1)}" y="${(rect.y + 2).toFixed(1)}" width="${Math.max(0, rect.w - 4).toFixed(1)}" height="${Math.max(0, rect.h - 4).toFixed(1)}" fill="${fill}" rx="8"/>`,
    );
    if (showLabel) {
      const textX = rect.x + 12;
      const textY = rect.y + Math.min(29, rect.h / 2 - 2);
      parts.push(
        `<text x="${textX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="${fontSize}" fill="#fff" font-weight="700">${escapeXml(label)}</text>`,
        `<text x="${textX.toFixed(1)}" y="${(textY + 17).toFixed(1)}" font-size="11" fill="#fff" fill-opacity="0.9">${(rect.weight / total * 100).toFixed(1)}%${rect.w >= 160 && Number.isFinite(value) ? ` · ${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}% P/L` : ""}</text>`,
      );
    }
  }
  parts.push(`</svg>`);
  return parts.join("");
}

/** Classic squarified treemap layout. */
export function squarify(items, container) {
  const rects = [];
  let remaining = [...items];
  let current = { ...container };
  while (remaining.length > 0) {
    const horizontal = current.w >= current.h;
    const totalArea = remaining.reduce((a, item) => a + item.area, 0);
    const side = horizontal ? current.h : current.w;
    let row = [];
    let rowArea = 0;
    let worst = Infinity;
    while (remaining.length > 0) {
      const candidate = rowArea + remaining[0].area;
      const rowSide = candidate / side;
      let rowWorst = 0;
      for (const item of [...row, remaining[0]]) {
        const itemSide = item.area / rowSide;
        const ratio = Math.max(rowSide / itemSide, itemSide / rowSide);
        rowWorst = Math.max(rowWorst, ratio);
      }
      if (row.length > 0 && rowWorst > worst) break;
      worst = rowWorst;
      row.push(remaining.shift());
      rowArea = candidate;
      if (rowArea >= totalArea) break;
    }
    const rowSideLen = rowArea / side;
    let offset = 0;
    for (const item of row) {
      const itemLen = item.area / rowSideLen;
      if (horizontal) {
        rects.push({ ...item, x: current.x, y: current.y + offset, w: rowSideLen, h: itemLen });
      } else {
        rects.push({ ...item, x: current.x + offset, y: current.y, w: itemLen, h: rowSideLen });
      }
      offset += itemLen;
    }
    if (horizontal) {
      current = { x: current.x + rowSideLen, y: current.y, w: current.w - rowSideLen, h: current.h };
    } else {
      current = { x: current.x, y: current.y + rowSideLen, w: current.w, h: current.h - rowSideLen };
    }
  }
  return rects;
}

function mixColor(dark, bright, t) {
  const clamp = Math.max(0, Math.min(1, t / 0.15));
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(dark);
  const [r2, g2, b2] = parse(bright);
  const mix = (a, b) => Math.round(a + (b - a) * clamp);
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

/** A 1, 2, 2.5 or 5 times 10^n step giving about `target` ticks across `range`. */
export function niceStep(range, target = 5) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const raw = range / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized < 1.5 ? 1 : normalized < 2.25 ? 2 : normalized < 3.5 ? 2.5 : normalized < 7.5 ? 5 : 10;
  return factor * magnitude;
}

function formatTick(value, decimals) {
  const extra = decimals === 0 && Math.abs(value % 1) > 1e-9 ? 1 : 0;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals + extra, maximumFractionDigits: decimals + extra });
}

function fmtPrice(value) {
  return Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 0 }) : value.toFixed(2);
}

function shortDate(value) {
  const parsed = /^\d{4}-(\d{2})-(\d{2})$/u.exec(value);
  if (!parsed) return String(value).slice(0, 12);
  return `${new Date(`${value}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${Number(parsed[2])}, ${value.slice(0, 4)}`;
}
