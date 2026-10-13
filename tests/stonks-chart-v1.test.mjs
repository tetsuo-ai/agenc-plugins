import assert from "node:assert/strict";
import test from "node:test";
import { chartBars, priceChartBlock } from "../plugins/stonks-copilot/server/charts.mjs";
import { makeEdgar } from "../plugins/stonks-copilot/server/edgar.mjs";
import { validateChartBlock, validateDisplayResource, validatePie, validateTable } from "./support/chart-v1.mjs";

function bars(count) {
  return Array.from({ length: count }, (_, i) => {
    const open = 100 + i / 10;
    return {
      date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10),
      open, high: open + 3, low: open - 2, close: open + 1,
      volume: i === 3 ? null : 1000 + i, source: "Stooq", currency: "USD",
    };
  });
}

test("chart block validates against v1 with a dated close line, volume and daily SMAs", () => {
  const input = bars(240);
  const chart = priceChartBlock(input, { symbol: "TEST" });
  const validated = validateChartBlock(chart);
  assert.equal(validated.title, "TEST: last close 124.9 USD");
  assert.match(validated.subtitle, /2020-01-01 to 2020-08-27, daily.*Stooq/u);
  assert.deepEqual(validated.series.map((series) => series.name), ["TEST", "SMA 50", "SMA 200", "Volume"]);
  assert.deepEqual(validated.series[0].data[3], {
    time: input[3].date, value: input[3].close,
  });
  assert.equal(validated.series.at(-1).data.length, 239, "unknown volume is omitted");
  const recent = priceChartBlock(input, { symbol: "TEST", lastPoints: 60 });
  validateChartBlock(recent);
  assert.equal(recent.series[0].data.length, 60);
  assert.equal(recent.series.find((series) => series.name === "SMA 200").data.length, 41,
    "recent chart keeps daily SMA values computed from the full history");
  const broken = structuredClone(chart);
  broken.series[0].data[0].value = NaN;
  assert.throws(() => validateChartBlock(broken));
  const mixed = structuredClone(chart);
  mixed.series[1].data[0].time = Date.parse(`${mixed.series[1].data[0].time}T00:00:00Z`) / 1000;
  assert.throws(() => validateChartBlock(mixed), /one time format/u);
  const duplicate = structuredClone(chart);
  duplicate.series[0].data[1].time = duplicate.series[0].data[0].time;
  assert.throws(() => validateChartBlock(duplicate), /ascend/u);
});

test("daily SMAs use history before the visible window, including after weekly sampling", () => {
  const input = bars(2400);
  for (const lastPoints of [30, 700]) {
    const chart = priceChartBlock(input, { symbol: "TEST", lastPoints });
    validateChartBlock(chart);
    for (const period of [50, 200]) {
      const line = chart.series.find((series) => series.name === `SMA ${period}`);
      assert.deepEqual(line.data.map((point) => point.time), chart.series[0].data.map((point) => point.time));
      for (const point of line.data) {
        const end = input.findIndex((bar) => bar.date === point.time);
        const expected = input.slice(end - period + 1, end + 1).reduce((sum, bar) => sum + bar.close, 0) / period;
        assert.ok(Math.abs(point.value - expected) < 1e-9);
      }
    }
    assert.equal(chart.series[0].data.at(-1).value, input.at(-1).close);
  }
});

test("support and resistance span the displayed dates within v1 limits", () => {
  const input = bars(240);
  const chart = priceChartBlock(input, {
    symbol: "TEST", lastPoints: 30,
    supports: [{ level: NaN }, { level: 110 }, { level: 105 }, { level: 100 }],
    resistances: [{ level: 130 }, { level: 140 }, { level: 150 }],
  });
  validateChartBlock(chart);
  assert.equal(chart.series.length, 8);
  const levels = chart.series.filter((series) => /^(Support|Resistance) /u.test(series.name));
  assert.deepEqual(levels.map((series) => series.name), ["Support 110", "Support 105", "Resistance 130", "Resistance 140"]);
  for (const [index, value] of [110, 105, 130, 140].entries()) {
    assert.equal(levels[index].type, "line");
    assert.equal(levels[index].scale, "price");
    assert.deepEqual(levels[index].data, input.slice(-30).map((bar) => ({ time: bar.date, value })));
  }
});

test("empty and short histories omit unavailable overlays without inventing data", () => {
  assert.equal(priceChartBlock([], { symbol: "TEST" }), null);
  assert.equal(priceChartBlock(bars(20), { symbol: "TEST", lastPoints: 0 }), null);
  const chart = priceChartBlock(bars(1), { symbol: "TEST", supports: [{ level: 90 }] });
  validateChartBlock(chart);
  assert.deepEqual(chart.series.map((series) => series.name), ["TEST", "Support 90", "Volume"]);
  assert.deepEqual(chart.series[1].data, [{ time: "2020-01-01", value: 90 }]);
});

test("long histories aggregate whole weekly OHLC bars and stay within 600 points", () => {
  const input = bars(2400);
  const sampled = chartBars(input);
  assert.ok(sampled.bars.length <= 600);
  assert.notEqual(sampled.period, "daily");
  for (let i = 0; i < sampled.bars.length; i += 1) {
    const start = i === 0 ? 0 : sampled.indices[i - 1] + 1;
    const batch = input.slice(start, sampled.indices[i] + 1);
    const bar = sampled.bars[i];
    assert.equal(bar.open, batch[0].open);
    assert.equal(bar.high, Math.max(...batch.map((point) => point.high)));
    assert.equal(bar.low, Math.min(...batch.map((point) => point.low)));
    assert.equal(bar.close, batch.at(-1).close);
    assert.ok(bar.high >= Math.max(bar.open, bar.close, bar.low));
    assert.ok(bar.low <= Math.min(bar.open, bar.close, bar.high));
  }
  validateChartBlock(priceChartBlock(input, { symbol: "TEST" }));
});

test("display resources obey Core's JSON shape, size and count limits", () => {
  const chart = priceChartBlock(bars(2400), {
    symbol: "TEST", supports: [{ level: 110 }, { level: 105 }], resistances: [{ level: 350 }, { level: 360 }],
  });
  const block = { type: "resource", annotations: { audience: ["user"] }, resource: {
    uri: "agenc:chart:price:TEST", mimeType: "application/vnd.agenc.chart+json", text: JSON.stringify(chart),
  } };
  assert.deepEqual(validateChartBlock(validateDisplayResource(block, "chart")), chart);
  assert.ok(chart.series.length <= 8);
  assert.ok(chart.series.every((series) => series.data.length <= 5000));
  assert.ok(Buffer.byteLength(block.resource.text, "utf8") <= 512 * 1024);
  assert.throws(() => validateDisplayResource({ ...block, annotations: { audience: ["assistant"] } }, "chart"));
  assert.throws(() => validateDisplayResource({ ...block, resource: { ...block.resource, text: " ".repeat(512 * 1024 + 1) } }, "chart"));
  validatePie({ version: 1, kind: "pie", title: "Weights", slices: [{ label: "TEST", value: 1 }] });
  validateTable({ version: 1, title: "Positions", columns: [{ key: "symbol", label: "Symbol" }], rows: [{ symbol: "TEST" }] });
  assert.throws(() => validatePie({ version: 1, kind: "pie", title: "Too many", slices: Array(101).fill({ label: "X", value: 1 }) }));
});

test("EDGAR requires a named contact and sends SEC headers at a serialized rate", async () => {
  const missing = makeEdgar({ userAgent: "", fetchImpl: () => { throw new Error("request must not run"); } });
  await assert.rejects(missing.tickerToCik("TEST"), /config\.toml.*edgarContact/u);
  const invalid = makeEdgar({ userAgent: "Stonks Copilot (+https://example.com)", fetchImpl: () => { throw new Error("request must not run"); } });
  await assert.rejects(invalid.tickerToCik("TEST"), /contact email/u);
  const calls = [];
  const edgar = makeEdgar({
    userAgent: "Fixture Research contact@tests.invalid",
    fetchImpl: async (url, options) => {
      calls.push({ at: Date.now(), host: new URL(url).host, headers: options.headers });
      return new Response(JSON.stringify(url.includes("companyfacts/") ? { facts: {} }
        : { 0: { ticker: "TEST", cik_str: 123, title: "Fixture" } }));
    },
  });
  await Promise.all([edgar.tickerToCik("TEST"), edgar.tickerToCik("TEST"), edgar.tickerToCik("TEST")]);
  await edgar.companyfacts("TEST");
  assert.equal(calls.length, 5);
  assert.equal(calls.at(-1).host, "data.sec.gov");
  for (const call of calls) {
    assert.ok(["www.sec.gov", "data.sec.gov"].includes(call.host));
    assert.equal(call.headers["user-agent"], "Fixture Research contact@tests.invalid");
    assert.equal(call.headers["accept-encoding"], "gzip, deflate");
    assert.equal(call.headers.host, undefined, "fetch derives Host from each SEC URL");
  }
  for (let i = 1; i < calls.length; i += 1) assert.ok(calls[i].at - calls[i - 1].at >= 100);
});
