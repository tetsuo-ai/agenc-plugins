import assert from "node:assert/strict";

/** Minimal independent validator for chart-spec-v1.md. */
export function validateChartBlock(block) {
  assert.match(block, /^```chart\n\{[\s\S]*\}\n```$/u);
  const chart = JSON.parse(block.slice("```chart\n".length, -"\n```".length));
  assert.equal(chart.version, 1);
  assert.equal(chart.kind, "timeseries");
  assert.ok(typeof chart.title === "string" && chart.title.length > 0);
  if (chart.subtitle !== undefined) assert.equal(typeof chart.subtitle, "string");
  if (chart.currency !== undefined) assert.match(chart.currency, /^[A-Z]{3}$/u);
  assert.ok(Array.isArray(chart.series) && chart.series.length >= 1 && chart.series.length <= 8);
  const times = new Set();
  for (const series of chart.series) {
    assert.ok(["line", "area", "candlestick", "bar", "histogram"].includes(series.type));
    assert.ok(typeof series.name === "string" && series.name.length > 0);
    if (series.scale !== undefined) assert.ok(["price", "volume", "percent"].includes(series.scale));
    if (series.precision !== undefined) assert.ok(Number.isInteger(series.precision) && series.precision >= 0 && series.precision <= 8);
    assert.ok(Array.isArray(series.data) && series.data.length <= 5000);
    let previous = null;
    for (const point of series.data) {
      assert.ok(typeof point.time === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(point.time)
        && new Date(point.time).toISOString().slice(0, 10) === point.time || Number.isInteger(point.time));
      if (previous !== null) assert.ok(point.time > previous, "chart times ascend without duplicates");
      previous = point.time;
      times.add(point.time);
      if (["candlestick", "bar"].includes(series.type)) {
        for (const field of ["open", "high", "low", "close"]) assert.ok(Number.isFinite(point[field]), field);
        assert.ok(point.high >= Math.max(point.open, point.close, point.low));
        assert.ok(point.low <= Math.min(point.open, point.close, point.high));
      } else assert.ok(Number.isFinite(point.value));
    }
  }
  if (chart.markers !== undefined) {
    assert.ok(Array.isArray(chart.markers) && chart.markers.length <= 50);
    for (const marker of chart.markers) {
      assert.ok(times.has(marker.time));
      assert.ok(typeof marker.text === "string");
    }
  }
  return chart;
}
