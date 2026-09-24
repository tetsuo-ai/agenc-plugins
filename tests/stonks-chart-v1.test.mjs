import assert from "node:assert/strict";
import test from "node:test";
import { chartBars, priceChartBlock } from "../plugins/stonks-copilot/server/charts.mjs";
import { makeEdgar } from "../plugins/stonks-copilot/server/edgar.mjs";
import { validateChartBlock } from "./support/chart-v1.mjs";

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

test("chart block validates against v1 with real daily OHLC, volume and daily SMAs", () => {
  const input = bars(240);
  const chart = priceChartBlock(input, { symbol: "TEST" });
  const validated = validateChartBlock(`\`\`\`chart\n${JSON.stringify(chart)}\n\`\`\``);
  assert.equal(validated.title, "TEST, daily");
  assert.match(validated.subtitle, /Stooq.*2020-08-27/u);
  assert.deepEqual(validated.series.map((series) => series.name), ["TEST", "SMA 50", "SMA 200", "Volume"]);
  assert.deepEqual(validated.series[0].data[3], {
    time: input[3].date, open: input[3].open, high: input[3].high, low: input[3].low, close: input[3].close,
  });
  assert.equal(validated.series.at(-1).data.length, 239, "unknown volume is omitted");
  const recent = priceChartBlock(input, { symbol: "TEST", lastPoints: 60 });
  validateChartBlock(`\`\`\`chart\n${JSON.stringify(recent)}\n\`\`\``);
  assert.equal(recent.series[0].data.length, 60);
  assert.equal(recent.series.find((series) => series.name === "SMA 200").data.length, 41,
    "recent chart keeps daily SMA values computed from the full history");
  const broken = structuredClone(chart);
  broken.series[0].data[0].high = broken.series[0].data[0].low - 1;
  assert.throws(() => validateChartBlock(`\`\`\`chart\n${JSON.stringify(broken)}\n\`\`\``));
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
  validateChartBlock(`\`\`\`chart\n${JSON.stringify(priceChartBlock(input, { symbol: "TEST" }))}\n\`\`\``);
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
