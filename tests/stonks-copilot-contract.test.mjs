/**
 * Stonks Copilot contract tests: pure analysis modules against synthetic
 * fixtures (no network), plus the MCP stdio server exercised as a real
 * child process — handshake, tool listing, journal round-trip, and error
 * semantics. Network-dependent tools are not called here; they are
 * exercised live by the plugin's E2E flow.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sma, rsi, macd, technicalSnapshot, levelZones } from "../plugins/stonks-copilot/server/indicators.mjs";
import { sparkline, priceChartSvg, treemapSvg, squarify } from "../plugins/stonks-copilot/server/charts.mjs";
import { parsePositionsText, xrayPortfolio } from "../plugins/stonks-copilot/server/portfolio.mjs";
import { parseNportXml, holdingsWithWeights } from "../plugins/stonks-copilot/server/nport.mjs";
import { fundamentalSnapshot } from "../plugins/stonks-copilot/server/fundamentals.mjs";
import { evaluateThesis, newThesis } from "../plugins/stonks-copilot/server/theses.mjs";

const SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "plugins",
  "stonks-copilot",
  "server",
  "main.mjs",
);

function risingBars(n, start = 10, drift = 0.5) {
  const bars = [];
  let close = start;
  for (let i = 0; i < n; i += 1) {
    const open = close;
    close = close + drift;
    bars.push({
      date: `2026-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open,
      high: close + 0.4,
      low: open - 0.4,
      close,
      volume: 1_000_000 + (i % 7) * 1000,
    });
  }
  return bars;
}

/** Trend up but with pullbacks — a straight line is *overbought*, not bullish. */
function realisticRisingBars(n, drift = 0.5) {
  return risingBars(n, 10, drift).map((bar, i) => {
    const wiggle = Math.sin(i / 4) * 1.2;
    const close = bar.close + wiggle;
    return { ...bar, close, high: close + 0.5, low: close - 1.5 };
  });
}

/** Flat base, sustained move, accelerating final leg. `dir` = +1 up / -1 down. */
function breakoutBars(n = 120, dir = 1) {
  return Array.from({ length: n }, (_, i) => {
    const advance = i <= 40 ? 0 : (i - 40) * 1.2 + (i > n - 20 ? (i - (n - 20)) ** 2 * 0.08 : 0);
    const close = 100 + dir * (advance + Math.sin(i / 5) * 0.4);
    return {
      date: `2026-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
      open: close - 0.5,
      high: close + 0.6,
      low: close - 1,
      close,
      volume: 1_000_000,
    };
  });
}

test("indicators: sma, rsi and macd behave on known shapes", () => {
  assert.equal(sma([1, 2, 3, 4], 4), 2.5);
  assert.equal(sma([1, 2], 5), null);
  // Strictly rising closes: RSI saturates at 100.
  assert.equal(rsi(risingBars(40).map((b) => b.close)), 100);
  const trending = breakoutBars(120).map((b) => b.close);
  const macdValue = macd(trending);
  assert.ok(macdValue.histogram > 0, `uptrend MACD histogram is positive (got ${macdValue.histogram})`);
  const falling = breakoutBars(120, -1).map((b) => b.close);
  assert.ok(macd(falling).histogram < 0, "downtrend MACD histogram is negative");
});

test("indicators: technical snapshot scores an uptrend above a downtrend", () => {
  const up = technicalSnapshot(realisticRisingBars(300));
  const down = technicalSnapshot(realisticRisingBars(300).toReversed());
  assert.ok(up.score > down.score, `up ${up.score} must beat down ${down.score}`);
  assert.ok(up.score >= 55, `uptrend with pullbacks reads bullish (got ${up.score})`);
  const supports = levelZones([10, 10.1, 9.95, 20, 20.2], 1.5);
  assert.equal(supports.length, 2, "distinct price levels stay separate");
  assert.ok(supports[0].count >= 2 || supports[1].count >= 2, "nearby pivots merge into a zone");
});

test("portfolio: parses generic and Schwab-style pastes, skips noise", () => {
  const generic = parsePositionsText("symbol,quantity,cost basis\nAAPL,10,150.25\nVOO,3,410\n");
  assert.equal(generic.positions.length, 2);
  assert.deepEqual(
    generic.positions.map((p) => p.symbol),
    ["AAPL", "VOO"],
  );
  assert.equal(generic.positions[0].quantity, 10);
  assert.equal(generic.positions[0].costBasis, 150.25);

  const schwab = parsePositionsText([
    "Positions as of September 3, 2026",
    "Symbol,Security Type,Quantity,Price,Price as of Date,Cost Basis Per Share",
    '"AAPL","Stocks",12,"$228.40","09/02/2026","$141.90"',
    '"VOO","ETFs",5,"$540.10","09/02/2026","$401.11"',
    "Cash & Cash Equivalents,,,\"$1,200.00\",,",
    '"Account Total',",,,\"$6,114.50\",,",
  ].join("\n"));
  assert.equal(schwab.positions.length, 2);
  assert.equal(schwab.positions[0].quantity, 12);
  assert.equal(schwab.positions[0].lastPrice, 228.4);
  assert.equal(schwab.positions[0].kind, "stock");
  assert.equal(schwab.positions[1].kind, "fund");
  assert.ok(schwab.warnings.length > 0, "cash and total rows are reported as ignored");

  const headerless = parsePositionsText("MSFT 8 410");
  // Space-separated single line is not CSV rows with quantities; the header
  // assumption path must not silently invent positions.
  assert.ok(headerless.positions.length === 0 || headerless.warnings.length > 0);
});

test("portfolio: xray aggregates fund constituents into effective exposure", () => {
  const positions = [
    { symbol: "AAPL", quantity: 10, costBasis: 150, lastPrice: 200, kind: "stock" },
    { symbol: "FUND1", quantity: 2, costBasis: 500, lastPrice: 500, kind: "fund" },
    { symbol: "FUND2", quantity: 1, costBasis: 1000, lastPrice: 1000, kind: "fund" },
  ];
  const result = xrayPortfolio(positions, {
    constituentsOf: (fund) =>
      fund === "FUND1"
        ? [{ symbol: "AAPL", weight: 0.3 }, { symbol: "MSFT", weight: 0.7 }]
        : [{ symbol: "AAPL", weight: 0.5 }, { symbol: "NVDA", weight: 0.5 }],
    priceOf: () => null,
  });
  // Total = 10*200 + 2*500 + 1*1000 = 4000. AAPL direct 0.5, via FUND1 0.25*0.3=0.075, via FUND2 0.25*0.5=0.125.
  const aapl = result.effectiveExposure.find((entry) => entry.symbol === "AAPL");
  assert.ok(Math.abs(aapl.weight - 0.7) < 1e-9, `AAPL aggregated to ${aapl.weight}`);
  assert.ok(aapl.via.includes("FUND1") && aapl.via.includes("FUND2"), "via tracks the stacking funds");
  // HHI = 0.7² + 0.175² + 0.125² ≈ 0.54 — 70% effective AAPL is genuinely high.
  assert.equal(result.concentration.interpretation, "highly concentrated");
  assert.ok(result.concentration.top10Weight > 0 && result.concentration.top10Weight <= 1);
});

test("nport: parses holdings blocks and normalizes weights", () => {
  const xml = [
    "<edgarSubmission><formData>",
    "<genInfo><seriesName>Test S&amp;P Fund</seriesName><seriesId>S000000001</seriesId><repPdDate>2026-06-30</repPdDate></genInfo>",
    "<fundInfo><netAssets>200000</netAssets></fundInfo>",
    "<invstOrSecs>",
    '<invstOrSec><name>Apple Inc.</name><cusip>037833100</cusip><identifiers><ticker value="AAPL"/></identifiers><balance>500</balance><valUSD>100000</valUSD></invstOrSec>',
    '<invstOrSec><name>Microsoft Corp</name><cusip>594918104</cusip><identifiers><ticker value="MSFT"/></identifiers><balance>100</balance><valUSD>50000</valUSD></invstOrSec>',
    "<invstOrSec><name>Cash</name><valUSD>50000</valUSD></invstOrSec>",
    "</invstOrSecs></formData></edgarSubmission>",
  ].join("");
  const weighted = holdingsWithWeights(parseNportXml(xml));
  assert.equal(weighted.fundName, "Test S&P Fund");
  assert.equal(weighted.holdingsCount, 3);
  assert.equal(weighted.holdings[0].symbol, "AAPL");
  assert.ok(Math.abs(weighted.holdings[0].weight - 0.5) < 1e-9);
  assert.equal(weighted.holdings.find((h) => h.name === "Cash").symbol, null);
});

function companyfactsFixture() {
  const years = [2022, 2023, 2024, 2025];
  const series = (values) => ({
    units: {
      USD: years.flatMap((fy, index) => [
        { fy, fp: "FY", form: "10-K", end: `${fy}-12-31`, start: `${fy}-01-01`, val: values[index] },
        { fy, fp: "Q1", form: "10-Q", end: `${fy}-03-31`, start: `${fy}-01-01`, val: values[index] / 4 },
      ]),
    },
  });
  return {
    facts: {
      "us-gaap": {
        Revenues: series([80, 100, 120, 150]),
        NetIncomeLoss: series([8, 15, 21, 30]),
        EarningsPerShareDiluted: {
          units: { "USD/shares": years.map((fy, index) => ({ fy, fp: "FY", form: "10-K", end: `${fy}-12-31`, start: `${fy}-01-01`, val: 1 + index })) },
        },
        NetCashProvidedByUsedInOperatingActivities: series([10, 12, 15, 18]),
        PaymentsToAcquirePropertyPlantAndEquipment: series([2, 3, 3, 4]),
        AssetsCurrent: series([30, 35, 40, 45]),
        LiabilitiesCurrent: series([20, 22, 24, 25]),
      },
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: { shares: [{ end: "2026-09-01", val: 10 }] },
        },
      },
    },
  };
}

test("fundamentals: extracts annual series, growth and ratios", () => {
  const company = companyfactsFixture();
  const snapshot = fundamentalSnapshot(company.facts, {
    price: 200,
    sharesOutstanding: company.facts.dei.EntityCommonStockSharesOutstanding.units.shares[0].val,
  });
  assert.equal(snapshot.metrics.fiscalYear, 2025);
  assert.equal(snapshot.metrics.revenueUsd, 150);
  assert.equal(snapshot.metrics.revenueGrowthPct, 25);
  assert.equal(snapshot.metrics.netMarginPct, 20);
  assert.equal(snapshot.metrics.epsDiluted, 4);
  assert.equal(snapshot.metrics.peRatio, 50);
  assert.equal(snapshot.metrics.currentRatio, 1.8);
  assert.equal(snapshot.metrics.fcfUsd, 14);
  assert.equal(snapshot.series.revenue.length, 4, "quarterly duplicates are dropped");
  assert.ok(snapshot.score > 50, "healthy grower reads above neutral");
});

test("theses: predicates validate, evaluate and break", () => {
  const invalid = newThesis({ symbol: "AAPL", thesis: "too short", citedMetrics: [] });
  assert.ok(invalid.error !== undefined);
  const badPredicate = newThesis({
    symbol: "AAPL",
    thesis: "margin story for the long haul",
    citedMetrics: [{ metric: "vibes", op: ">", value: 1 }],
  });
  assert.match(badPredicate.error, /unknown metric 'vibes'/u);

  const { thesis } = newThesis({
    symbol: "AAPL",
    thesis: "margin story: they keep 30% and grow double digits",
    horizon: "5 years",
    citedMetrics: [
      { metric: "net_margin", op: ">", value: 30 },
      { metric: "revenue_growth", op: ">=", value: 10 },
    ],
  });
  const evaluation = evaluateThesis(thesis, {
    technical: { lastClose: 200 },
    fundamental: { metrics: { netMarginPct: 26.4, revenueGrowthPct: 14 } },
  });
  assert.equal(evaluation.status, "broken");
  const marginCheck = evaluation.checks.find((c) => c.metric === "net_margin");
  assert.equal(marginCheck.status, "broken");
  const growthCheck = evaluation.checks.find((c) => c.metric === "revenue_growth");
  assert.equal(growthCheck.status, "holds");

  const unavailable = evaluateThesis(thesis, { technical: null, fundamental: null });
  assert.ok(unavailable.checks.every((c) => c.status === "unavailable"));
  assert.equal(unavailable.status, "partial");
});

test("charts: sparkline, price svg and treemap layout", () => {
  const spark = sparkline([1, 2, 3, 4, 5]);
  assert.equal(spark.length, 5);
  assert.ok(spark.startsWith("▁") && spark.endsWith("█"), "monotonic rise renders low→high blocks");

  const bars = risingBars(120);
  const svg = priceChartSvg(bars, { symbol: "TEST", overlays: { sma50: bars.map((b, i) => (i > 50 ? b.close : undefined)) } });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("<polyline"), "close line exists");
  assert.ok(svg.includes("<rect"), "volume bars exist");
  assert.ok(svg.includes("sma50"));

  const rects = squarify(
    [
      { label: "A", weight: 0.5, area: 50 },
      { label: "B", weight: 0.3, area: 30 },
      { label: "C", weight: 0.2, area: 20 },
    ],
    { x: 0, y: 0, w: 10, h: 10 },
  );
  const covered = rects.reduce((a, rect) => a + rect.w * rect.h, 0);
  assert.ok(Math.abs(covered - 100) < 0.01, "treemap partitions cover the container");

  const treemap = treemapSvg([
    { label: "AAPL", weight: 500, value: 0.1 },
    { label: "VOO", weight: 300, value: -0.02 },
    { label: "CASH", weight: 200, value: 0 },
  ]);
  assert.ok(treemap.includes("AAPL") && treemap.includes("VOO"));
  assert.equal(treemapSvg([]), null);
});

/** Drive the real stdio server: NDJSON in, NDJSON out, no network tools. */
async function withServer(run) {
  const dataDir = mkdtempSync(join(tmpdir(), "stonks-mcp-"));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGENC_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const responses = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      responses.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  const notify = (method) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  try {
    await run({ call, notify, responses, dataDir });
  } finally {
    child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("mcp server: handshake, tool catalog, journal round-trip and errors", async () => {
  await withServer(async ({ call, notify, responses }) => {
    const init = await call("initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "contract-test", version: "0" },
    });
    assert.equal(init.result.serverInfo.name, "stonks-copilot");
    assert.ok(init.result.capabilities.tools !== undefined);
    notify("notifications/initialized");

    const catalog = await call("tools/list");
    const names = catalog.result.tools.map((tool) => tool.name);
    for (const expected of [
      "ohlcv", "indicators", "fundamentals", "analyze",
      "portfolio_import", "portfolio_get", "fund_holdings", "xray",
      "chart_price", "chart_treemap",
      "thesis_create", "thesis_list", "thesis_scan", "metrics_registry",
    ]) {
      assert.ok(names.includes(expected), `tool ${expected} is listed`);
    }
    for (const tool of catalog.result.tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} declares an object input schema`);
    }

    const registry = await call("tools/call", { name: "metrics_registry", arguments: {} });
    const metrics = registry.result.structuredContent.metrics;
    assert.ok(metrics.some((m) => m.metric === "net_margin"));

    const created = await call("tools/call", {
      name: "thesis_create",
      arguments: {
        symbol: "aapl",
        thesis: "services growth keeps margins above 25 percent",
        citedMetrics: [{ metric: "net_margin", op: ">", value: 25 }],
      },
    });
    const thesis = created.result.structuredContent;
    assert.equal(thesis.symbol, "AAPL");
    assert.equal(thesis.citedMetrics.length, 1);

    const listed = await call("tools/call", { name: "thesis_list", arguments: {} });
    assert.equal(listed.result.structuredContent.theses.length, 1);

    const invalid = await call("tools/call", {
      name: "thesis_create",
      arguments: { symbol: "AAPL", thesis: "x", citedMetrics: [] },
    });
    assert.match(invalid.result.content[0].text, /Invalid thesis/u);

    const unknown = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(unknown.error.code, -32602);

    const badMethod = await call("resources/list");
    assert.equal(badMethod.error.code, -32601);

    // Notifications must never produce a response frame.
    notify("notifications/initialized");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(responses.every((message) => message.id !== undefined), "no response to notifications");
  });
});
