import assert from "node:assert/strict";
import test from "node:test";
import { fundamentalSnapshot } from "../plugins/stonks-copilot/server/fundamentals.mjs";
import { makeEdgar } from "../plugins/stonks-copilot/server/edgar.mjs";
import { parseNportXml, holdingsWithWeights } from "../plugins/stonks-copilot/server/nport.mjs";
import { parsePositionsText, xrayPortfolio } from "../plugins/stonks-copilot/server/portfolio.mjs";
import { makeMarketData } from "../plugins/stonks-copilot/server/bars.mjs";
import { makeYahoo } from "../plugins/stonks-copilot/server/yahoo.mjs";
import { makeStooq, parseStooqCsv } from "../plugins/stonks-copilot/server/stooq.mjs";
import { fetchPublic } from "../plugins/stonks-copilot/server/http.mjs";
import { macd, technicalSnapshot, sma } from "../plugins/stonks-copilot/server/indicators.mjs";
import { priceChartSvg, treemapSvg } from "../plugins/stonks-copilot/server/charts.mjs";

const DAY = 86400000;
const NOW = Date.parse("2026-09-05T12:00:00Z");
function cache() {
  const entries = new Map();
  return { get: (key) => entries.get(key) ?? null, set: (key, value) => entries.set(key, value) };
}
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
function annual(end, value, extra = {}) {
  return { start: `${end.slice(0, 4)}-01-01`, end, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed: `${Number(end.slice(0, 4)) + 1}-02-01`, val: value, ...extra };
}
const fact = (...entries) => ({ units: { USD: entries } });
function company() {
  return { facts: { "us-gaap": {
    Revenues: fact(annual("2024-12-31", 100), annual("2025-12-31", 150)),
    NetIncomeLoss: fact(annual("2024-12-31", 10), annual("2025-12-31", 30)),
    EarningsPerShareDiluted: { units: { "USD/shares": [annual("2025-12-31", 3)] } },
    NetCashProvidedByUsedInOperatingActivities: fact(annual("2025-12-31", 50)),
    PaymentsToAcquirePropertyPlantAndEquipment: fact(annual("2025-12-31", 20)),
  }, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: "2026-07-01", val: 10 }] } } } } };
}

test("SEC companyfacts envelope works through the real client without a cache", async () => {
  const edgar = makeEdgar({ fetchImpl: async (url) => json(url.endsWith("company_tickers.json")
    ? { 0: { ticker: "TEST", cik_str: 123, title: "Fixture Inc" } } : company()) });
  const result = await edgar.fundamentalsSnapshot("TEST", { price: 60 });
  assert.equal(result.metrics.revenueUsd, 150);
  assert.equal(result.metrics.peRatio, 20);
  assert.equal(result.metrics.marketCapUsd, 600);
  assert.equal(result.metrics.fcfUsd, 30);
  assert.match(result.basis, /annual/u);
});

test("annual facts deduplicate reporting periods, accept restatements and tag transitions", () => {
  const facts = { "us-gaap": {
    RevenueFromContractWithCustomerExcludingAssessedTax: fact(
      annual("2024-12-31", 100),
      annual("2024-12-31", 110, { fy: 2025, filed: "2026-02-01" }),
      annual("2025-12-31", 165),
      annual("2025-12-31", 999, { start: "2023-01-01" }),
    ),
    Revenues: fact(annual("2023-12-31", 80)),
  } };
  const result = fundamentalSnapshot(facts, { now: NOW });
  assert.deepEqual(result.series.revenue, [{ fy: 2023, value: 80 }, { fy: 2024, value: 110 }, { fy: 2025, value: 165 }]);
  assert.equal(result.metrics.revenueGrowthPct, 50);
});

test("fundamentals never invent capex, mix annual periods or divide by zero", () => {
  const facts = company();
  delete facts.facts["us-gaap"].PaymentsToAcquirePropertyPlantAndEquipment;
  facts.facts["us-gaap"].NetIncomeLoss = fact(annual("2024-12-31", 10));
  facts.facts["us-gaap"].AssetsCurrent = fact(annual("2025-12-31", 50));
  facts.facts["us-gaap"].LiabilitiesCurrent = fact(annual("2025-12-31", 0));
  const result = fundamentalSnapshot(facts, { price: 0, now: NOW });
  assert.equal(result.metrics.netMarginPct, null);
  assert.equal(result.metrics.fcfUsd, null);
  assert.equal(result.metrics.currentRatio, null);
  assert.equal(result.metrics.peRatio, null);
  assert.ok(result.warnings.some((warning) => warning.includes("capital expenditures")));
  assert.ok(!result.signals.some((signal) => signal.name === "fcf"));
});

test("comparative years in a single filing are labeled by their reporting periods", () => {
  const result = fundamentalSnapshot({ "us-gaap": { Revenues: fact(
    annual("2023-12-31", 80, { fy: 2025 }), annual("2024-12-31", 100, { fy: 2025 }), annual("2025-12-31", 150),
  ) } });
  assert.deepEqual(result.series.revenue.map((entry) => entry.fy), [2023, 2024, 2025]);
});

test("missing prior net income does not crash; gaps are not reported as YoY", () => {
  const facts = { "us-gaap": { Revenues: fact(annual("2023-12-31", 100), annual("2025-12-31", 150)) } };
  assert.equal(fundamentalSnapshot(facts).metrics.revenueGrowthPct, null);
  assert.equal(fundamentalSnapshot(facts).metrics.netMarginTrendPct, null);
  assert.equal(fundamentalSnapshot({}).available, false);
});

function nport(seriesId = "S000000001", symbol = "AAPL", namespace = "") {
  return `<edgarSubmission><formData><genInfo><seriesName>Fixture &amp; Fund</seriesName><seriesId>${seriesId}</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSecs>
  <invstOrSec><name>Issuer</name><cusip>000000001</cusip><identifiers><ticker value="${symbol}"/></identifiers><balance>2</balance><curVal>9000</curVal><valUSD>600</valUSD></invstOrSec>
  <invstOrSec><name>ABC</name><valUSD>200</valUSD></invstOrSec>
  <invstOrSec><name>Cash</name><balance>200</balance><valUSD>200</valUSD></invstOrSec>
  </invstOrSecs></formData></edgarSubmission>`.replace(/<(\/?)([a-zA-Z])/gu, `<$1${namespace}$2`);
}

test("N-PORT reads valUSD, explicit tickers, namespaces, fund identity and NAV", () => {
  const result = holdingsWithWeights(parseNportXml(nport(undefined, undefined, "ns:")), { now: NOW });
  assert.equal(result.fundName, "Fixture & Fund");
  assert.equal(result.asOf, "2026-06-30");
  assert.equal(result.seriesId, "S000000001");
  assert.equal(result.holdings[0].weight, 0.6);
  assert.equal(result.holdings[0].symbol, "AAPL");
  assert.equal(result.holdings[1].symbol, null, "uppercase issuer name is not a ticker");
  assert.equal(parseNportXml("<invstOrSec><name>Issuer</name><balance>100</balance></invstOrSec>"), null);
});

test("N-PORT truncation preserves weights and reports incomplete coverage", () => {
  const result = holdingsWithWeights(parseNportXml(nport()), { maxHoldings: 1, now: NOW });
  assert.equal(result.coverageWeight, 0.6);
  assert.equal(result.holdingsCount, 3);
  assert.equal(result.returnedHoldingsCount, 1);
  assert.ok(result.warnings.some((warning) => /not renormalized/u.test(warning)));
});

test("N-PORT exposes omitted dollar valuations for the portfolio coverage guard", () => {
  const xml = nport().replace("</invstOrSecs>", "<invstOrSec><name>Missing dollar value</name><balance>1000</balance></invstOrSec></invstOrSecs>");
  const result = holdingsWithWeights(parseNportXml(xml), { now: NOW });
  assert.equal(result.omittedHoldings, 1);
  assert.equal(result.holdingsCount, 3);
  assert.ok(result.warnings.some((warning) => warning.includes("dollar valuations were unavailable")));
  assert.equal(holdingsWithWeights(parseNportXml(nport()), { now: NOW }).omittedHoldings, 0);
});

test("N-PORT resolves the fund series within a shared CIK and isolates cached funds", async () => {
  const requests = [];
  const edgar = makeEdgar({ cache: cache(), fetchImpl: async (url) => {
    requests.push(url);
    if (url.endsWith("company_tickers_mf.json")) return json({ fields: ["cik", "seriesId", "classId", "symbol"], data: [[123, "S000000001", "C1", "ONE"], [123, "S000000002", "C2", "TWO"]] });
    if (url.includes("submissions/")) return json({ filings: { recent: { form: ["NPORT-P", "NPORT-P"], accessionNumber: ["0000000123-26-000002", "0000000123-26-000001"], primaryDocument: ["second.xml", "first.xml"], filingDate: ["2026-08-01", "2026-08-01"] } } });
    return new Response(url.endsWith("second.xml") ? nport("S000000002", "MSFT") : nport());
  } });
  const one = await edgar.fundHoldings("ONE");
  const two = await edgar.fundHoldings("TWO");
  assert.equal(one.holdings[0].symbol, "AAPL");
  assert.equal(two.holdings[0].symbol, "MSFT");
  assert.ok(requests.some((url) => url.endsWith("first.xml")));
  assert.ok(!requests.some((url) => url.endsWith("company_tickers.json")));
});

test("quoted broker values preserve commas and total cost becomes per-share cost", () => {
  const parsed = parsePositionsText('Symbol,Description,Quantity,Price,Cost Basis Per Share\nAAPL,"Apple, Inc.","1,000","$200.00","$125.00"');
  assert.equal(parsed.positions[0].quantity, 1000);
  assert.equal(parsed.positions[0].lastPrice, 200);
  assert.equal(parsed.positions[0].costBasis, 125);
  const total = parsePositionsText("symbol,quantity,total cost basis\nTEST,10,1500");
  assert.equal(total.positions[0].costBasis, 150);
  const noCost = parsePositionsText("symbol,quantity,price as of date\nTEST,10,20260904");
  assert.equal(noCost.positions[0].lastPrice, null);
  assert.equal(noCost.positions[0].costBasis, null);
  assert.equal(parsePositionsText("symbol,quantity\nVTEX,2").positions[0].kind, "stock");
});

test("portfolio refuses share-count valuation and reports missing prices and fees", () => {
  const positions = [{ symbol: "A", quantity: 10, kind: "stock" }, { symbol: "B", quantity: 2, kind: "stock" }];
  const noPrices = xrayPortfolio(positions, { priceOf: () => null, constituentsOf: () => null });
  assert.match(noPrices.error, /prices unavailable/u);
  const partial = xrayPortfolio(positions, { priceOf: (symbol) => symbol === "A" ? 10 : null, constituentsOf: () => null });
  assert.deepEqual(partial.unpricedSymbols, ["B"]);
  assert.equal(partial.positionsCount, 2);
  assert.equal(partial.valuedPositionsCount, 1);
  assert.equal(partial.estimatedAnnualFeeUsd, null);
  assert.match(partial.concentration.interpretation, /incomplete/u);
});

test("partial fund holdings retain residual value and correctly report direct overlap", () => {
  const result = xrayPortfolio([
    { symbol: "AAPL", quantity: 5, lastPrice: 100, kind: "stock" },
    { symbol: "FUND", quantity: 5, lastPrice: 100, kind: "fund" },
  ], { priceOf: () => null, constituentsOf: () => [{ symbol: "AAPL", weight: 0.4 }] });
  assert.equal(result.effectiveExposure.reduce((sum, entry) => sum + entry.weight, 0), 1);
  assert.equal(result.effectiveExposure.find((entry) => entry.symbol === "AAPL").duplicatedViaFunds, 0.2);
  assert.equal(result.unresolvedWeight, 0.3);
});

function yahooBody({ currency = "USD", date = "2026-09-04", timeZone = "America/New_York" } = {}) {
  return { chart: { result: [{ meta: { currency, exchangeTimezoneName: timeZone }, timestamp: [Date.parse(`${date}T14:00:00Z`) / 1000], indicators: { quote: [{ open: [100], high: [110], low: [90], close: [105], volume: [null] }] } }] } };
}

test("market clients work without optional cache and do not manufacture missing volume", async () => {
  const yahoo = makeYahoo({ fetchImpl: async () => json(yahooBody()) });
  const bars = await yahoo.dailyBars("TEST");
  assert.equal(bars[0].volume, null);
  assert.equal(bars[0].currency, "USD");
  const stooq = makeStooq({ fetchImpl: async () => new Response("Date,Open,High,Low,Close,Volume\n2026-09-04,100,110,90,105,\n") });
  assert.equal((await stooq.dailyBars("TEST"))[0].volume, null);
});

test("Yahoo uses the exchange session date and rejects unverified currencies", async () => {
  const body = yahooBody({ timeZone: "Pacific/Honolulu" });
  body.chart.result[0].timestamp[0] = Date.parse("2026-09-05T01:00:00Z") / 1000;
  assert.equal((await makeYahoo({ fetchImpl: async () => json(body) }).dailyBars("TEST"))[0].date, "2026-09-04");
  await assert.rejects(makeYahoo({ fetchImpl: async () => json(yahooBody({ currency: "GBP" })) }).dailyBars("TEST.L"), /currency/u);
});

test("Stooq rejects malformed OHLC/dates, sorts and deduplicates rows", () => {
  const bars = parseStooqCsv("Date,Open,High,Low,Close,Volume\n2026-09-04,100,110,90,105,2\n2026-09-03,100,110,90,104,1\n2026-09-04,100,110,90,106,3\n2026-02-30,100,110,90,105,1\n2026-09-02,,110,90,105,1\n2026-09-01,100,90,80,105,1");
  assert.deepEqual(bars.map((bar) => [bar.date, bar.close]), [["2026-09-03", 104], ["2026-09-04", 106]]);
});

test("market data rejects stale series and falls back from an invalid primary source", async () => {
  let calls = 0;
  const market = makeMarketData({ cache: cache(), now: () => NOW, fetchImpl: async (url) => {
    calls += 1;
    return url.includes("yahoo") ? json(yahooBody({ date: "2020-01-01" })) : new Response("Date,Open,High,Low,Close,Volume\n2026-09-04,100,110,90,105,2");
  } });
  const bars = await market.dailyBars("TEST", { months: 1 });
  assert.equal(bars[0].source, "Stooq");
  assert.equal(calls, 2);
  await market.dailyBars("TEST", { months: 1 });
  assert.equal(calls, 2, "fresh bars are cached");
  const stale = makeMarketData({ cache: cache(), now: () => NOW, fetchImpl: async (url) => url.includes("yahoo") ? json(yahooBody({ date: "2020-01-01" })) : new Response("Date,Open,High,Low,Close,Volume\n2020-01-01,100,110,90,105,2") });
  await assert.rejects(stale.dailyBars("OLD"), /seven calendar days/u);
});

test("public data reads bound time, redirects and streamed body size", async () => {
  await assert.rejects(fetchPublic("https://example.com", { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), /timed out/u);
  await assert.rejects(fetchPublic("https://example.com", { fetchImpl: async () => ({ redirected: true }) }), /redirect/u);
  await assert.rejects(fetchPublic("https://example.com", { maxBytes: 4, fetchImpl: async () => new Response("123456") }), /size limit/u);
});

test("technical analysis needs full history for 52-week claims and treats flat averages neutrally", () => {
  const bars = Array.from({ length: 210 }, (_, i) => ({ date: new Date(NOW - (210 - i) * DAY).toISOString().slice(0, 10), open: 100, high: 101, low: 99, close: 100, volume: null }));
  const result = technicalSnapshot(bars);
  assert.ok(!result.signals.some((signal) => signal.name === "range_52w" || signal.name === "volume"));
  assert.equal(result.signals.find((signal) => signal.name === "sma_cross").verdict, 0);
  assert.equal(sma([1, 2, null], 3), null);
  assert.ok(macd(Array.from({ length: 34 }, (_, i) => i + 1)) !== null);
});

test("SVG price polyline has numeric coordinates and trailing overlays are aligned", () => {
  const bars = Array.from({ length: 5 }, (_, i) => ({ date: `day-${i}`, open: 100 + i, high: 110, low: 90, close: 100 + i, volume: null }));
  bars[0].date = '<script>alert("x")</script>';
  const svg = priceChartSvg(bars, { symbol: "TEST", overlays: { sma50: [103, 104] } });
  const points = [...svg.matchAll(/<polyline[^>]+points="([^"]+)"/gu)].map((match) => match[1]);
  assert.match(points[0], /^[\d.,\s]+$/u);
  assert.equal(points[1].split(" ")[0].split(",")[0], "684.0");
  assert.ok(!svg.includes("NaN") && !svg.includes("<script>"));
  const tree = treemapSvg([{ label: "A", weight: 500, value: null }, { label: "B", weight: 500, value: 0.1 }]);
  assert.ok(tree.includes("50.0%") && !tree.includes("50000.0%"));
  assert.ok(tree.includes("#475569"), "unknown performance has a neutral color");
});
