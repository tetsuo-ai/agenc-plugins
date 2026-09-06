/**
 * Zero-dependency chart rendering: standalone SVG artifacts (price chart
 * with moving averages, portfolio treemap) plus inline unicode sparklines
 * for terminal output. Pure functions — no I/O.
 */

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

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
  const margin = { top: 52, right: 72, bottom: 48, left: 72 };
  const volumeHeight = Math.round((height - margin.top - margin.bottom) * 0.18);
  const priceHeight = height - margin.top - margin.bottom - volumeHeight - 12;
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
  const first = closes[0];
  const last = closes[closes.length - 1];
  const up = last >= first;
  const lineColor = up ? "#22c55e" : "#ef4444";
  const closePath = closes.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  const gridLines = [];
  for (let step = 0; step <= 4; step += 1) {
    const value = yMin + ((yMax - yMin) * step) / 4;
    const py = y(value).toFixed(1);
    gridLines.push(
      `<line x1="${margin.left}" y1="${py}" x2="${width - margin.right}" y2="${py}" stroke="#e2e8f0" stroke-width="1"/>` +
        `<text x="${width - margin.right + 6}" y="${Number(py) + 4}" font-size="11" fill="#64748b">${fmtPrice(value)}</text>`,
    );
  }

  const overlayColors = { sma50: "#f59e0b", sma200: "#8b5cf6" };
  const overlayPaths = Object.entries(overlays)
    .map(([label, series], index) => {
      const color = overlayColors[label] ?? ["#0ea5e9", "#f43f5e", "#84cc16"][index % 3];
      const offset = Math.max(0, bars.length - series.length);
      const defined = series.slice(-bars.length)
        .map((value, i) => (!Number.isFinite(value) ? null : `${x(i + offset).toFixed(1)},${y(value).toFixed(1)}`))
        .filter((point) => point !== null);
      if (defined.length < 2) return "";
      return `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${defined.join(" ")}"/>`;
    })
    .join("");

  const volumeBars = bars
    .map((bar, i) => {
      if (!Number.isFinite(bar.volume) || bar.volume < 0) return "";
      const barWidth = Math.max((width - margin.left - margin.right) / bars.length - 0.5, 0.5);
      return `<rect x="${(x(i) - barWidth / 2).toFixed(1)}" y="${volumeY(bar.volume).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(height - margin.bottom - volumeY(bar.volume)).toFixed(1)}" fill="${bar.close >= bar.open ? "#bbf7d0" : "#fecaca"}"/>`;
    })
    .join("");

  const dateTicks = [0, Math.floor(bars.length / 2), bars.length - 1]
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${height - margin.bottom + 18}" font-size="11" fill="#64748b" text-anchor="middle">${escapeXml(bars[i].date)}</text>`)
    .join("");

  const legend = Object.entries(overlays)
    .map(([label], index) => {
      const color = overlayColors[label] ?? ["#0ea5e9", "#f43f5e", "#84cc16"][index % 3];
      return `<text x="${margin.left + index * 84}" y="${margin.top - 8}" font-size="12" fill="${color}">${escapeXml(label)}</text>`;
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, monospace">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${margin.left}" y="20" font-size="14" font-weight="bold" fill="#0f172a">${escapeXml(symbol)} | daily close</text>`,
    legend,
    gridLines.join(""),
    volumeBars,
    `<polyline fill="none" stroke="${lineColor}" stroke-width="2" points="${closePath}"/>`,
    overlayPaths,
    `<circle cx="${x(bars.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5" fill="${lineColor}"/>`,
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, monospace">`,
    `<rect width="${width}" height="${height}" fill="#0f172a"/>`,
    `<text x="16" y="28" font-size="16" font-weight="bold" fill="#f8fafc">${escapeXml(title)}</text>`,
  ];
  const bodyTop = 44;
  const bodyHeight = height - bodyTop;
  const bodyRects = squarify(
    normalized.map((item) => ({ ...item, area: (item.weight / total) * width * bodyHeight })),
    { x: 0, y: bodyTop, w: width, h: bodyHeight },
  );
  for (const rect of bodyRects) {
    const value = rect.value;
    const fill = !Number.isFinite(value) ? "#475569" : value >= 0 ? mixColor("#14532d", "#22c55e", value) : mixColor("#7f1d1d", "#ef4444", -value);
    const fontSize = Math.max(Math.min(rect.w / Math.max(rect.label.length * 0.62, 1), rect.h / 3), 9);
    parts.push(
      `<rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" width="${rect.w.toFixed(1)}" height="${rect.h.toFixed(1)}" fill="${fill}" stroke="#0f172a" stroke-width="2" rx="3"/>`,
    );
    if (rect.w > 42 && rect.h > 22) {
      parts.push(
        `<text x="${(rect.x + rect.w / 2).toFixed(1)}" y="${(rect.y + rect.h / 2 - fontSize * 0.2).toFixed(1)}" font-size="${fontSize.toFixed(1)}" fill="#f8fafc" text-anchor="middle" font-weight="bold">${escapeXml(rect.label)}</text>`,
        `<text x="${(rect.x + rect.w / 2).toFixed(1)}" y="${(rect.y + rect.h / 2 + fontSize * 1.1).toFixed(1)}" font-size="${(fontSize * 0.85).toFixed(1)}" fill="#e2e8f0" text-anchor="middle">${(rect.weight / total * 100).toFixed(1)}%</text>`,
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

function fmtPrice(value) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}
