import assert from "node:assert/strict";

const JSON_LIMIT = 512 * 1024;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const strictKeys = (value, required, optional = []) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  for (const key of required) assert.ok(Object.hasOwn(value, key), `missing ${key}`);
  for (const key of Object.keys(value)) assert.ok([...required, ...optional].includes(key), `unexpected ${key}`);
};
const title = (value) => assert.ok(typeof value === "string" && value.trim().length > 0);

export function validateDisplayResource(block, kind) {
  strictKeys(block, ["type", "annotations", "resource"]);
  assert.equal(block.type, "resource");
  assert.deepEqual(block.annotations, { audience: ["user"] });
  strictKeys(block.resource, ["uri", "mimeType", "text"]);
  assert.match(block.resource.uri, /^agenc:(?:chart|table):/u);
  assert.equal(block.resource.mimeType, `application/vnd.agenc.${kind}+json`);
  assert.ok(Buffer.byteLength(block.resource.text, "utf8") <= JSON_LIMIT);
  const data = JSON.parse(block.resource.text);
  assert.equal(block.resource.text, JSON.stringify(data));
  return data;
}

export function validateChartBlock(chart) {
  strictKeys(chart, ["version", "kind", "title", "series"], ["subtitle", "currency", "markers"]);
  assert.equal(chart.version, 1);
  assert.equal(chart.kind, "timeseries");
  title(chart.title);
  if (chart.subtitle !== undefined) assert.equal(typeof chart.subtitle, "string");
  if (chart.currency !== undefined) {
    assert.match(chart.currency, /^[A-Z]{3}$/u);
    assert.ok([...Intl.supportedValuesOf("currency"), "XAU", "XAG", "XPT", "XPD", "XDR", "XTS", "XXX"].includes(chart.currency));
  }
  assert.ok(Array.isArray(chart.series) && chart.series.length >= 1 && chart.series.length <= 8);
  const times = new Set();
  let timeKind;
  for (const series of chart.series) {
    strictKeys(series, ["type", "name", "data"], ["scale", "precision"]);
    assert.ok(["line", "area", "candlestick", "bar", "histogram"].includes(series.type));
    title(series.name);
    if (series.scale !== undefined) assert.ok(["price", "volume", "percent"].includes(series.scale));
    if (["candlestick", "bar"].includes(series.type)) assert.equal(series.scale ?? "price", "price");
    if (series.precision !== undefined) assert.ok(Number.isInteger(series.precision) && series.precision >= 0 && series.precision <= 8);
    assert.ok(Array.isArray(series.data) && series.data.length >= 1 && series.data.length <= 5000);
    let previous;
    for (const point of series.data) {
      const ohlc = ["candlestick", "bar"].includes(series.type);
      strictKeys(point, ohlc ? ["time", "open", "high", "low", "close"] : ["time", "value"]);
      const kind = typeof point.time === "string" ? "daily" : "intraday";
      if (kind === "daily") {
        assert.match(point.time, /^\d{4}-\d{2}-\d{2}$/u);
        assert.equal(new Date(`${point.time}T00:00:00Z`).toISOString().slice(0, 10), point.time);
      } else {
        assert.ok(Number.isSafeInteger(point.time));
        assert.ok(Number.isFinite(new Date(point.time * 1000).valueOf()));
      }
      if (timeKind !== undefined) assert.equal(kind, timeKind, "one time format across series");
      timeKind = kind;
      if (previous !== undefined) assert.ok(point.time > previous, "chart times ascend without duplicates");
      previous = point.time;
      times.add(String(point.time));
      if (ohlc) {
        for (const field of ["open", "high", "low", "close"]) assert.ok(finite(point[field]), field);
        assert.ok(point.high >= Math.max(point.open, point.close, point.low));
        assert.ok(point.low <= Math.min(point.open, point.close, point.high));
      } else assert.ok(finite(point.value));
    }
  }
  if (chart.markers !== undefined) {
    assert.ok(Array.isArray(chart.markers) && chart.markers.length <= 50);
    for (const marker of chart.markers) {
      strictKeys(marker, ["time", "text"]);
      assert.ok(times.has(String(marker.time)));
      title(marker.text);
    }
  }
  return chart;
}

export function validatePie(chart) {
  strictKeys(chart, ["version", "kind", "title", "slices"]);
  assert.equal(chart.version, 1);
  assert.equal(chart.kind, "pie");
  title(chart.title);
  assert.ok(Array.isArray(chart.slices) && chart.slices.length >= 1 && chart.slices.length <= 100);
  for (const slice of chart.slices) {
    strictKeys(slice, ["label", "value"]);
    title(slice.label);
    assert.ok(finite(slice.value) && slice.value >= 0);
  }
  return chart;
}

export function validateTable(table) {
  strictKeys(table, ["version", "title", "columns", "rows"]);
  assert.equal(table.version, 1);
  title(table.title);
  assert.ok(Array.isArray(table.columns) && table.columns.length >= 1 && table.columns.length <= 32);
  assert.ok(Array.isArray(table.rows) && table.rows.length <= 1000);
  const keys = new Set();
  for (const column of table.columns) {
    strictKeys(column, ["key", "label"], ["format"]);
    title(column.key);
    title(column.label);
    assert.ok(!keys.has(column.key));
    keys.add(column.key);
    if (column.format !== undefined) assert.ok(typeof column.format === "string" && column.format.length <= 64);
  }
  for (const row of table.rows) {
    for (const [key, value] of Object.entries(row)) {
      assert.ok(keys.has(key));
      assert.ok(value === null || typeof value === "string" || typeof value === "boolean" || finite(value));
    }
  }
  return table;
}
