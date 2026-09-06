import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeCache } from "../plugins/stonks-copilot/server/cache.mjs";
import { makeDataFiles, makeStores } from "../plugins/stonks-copilot/server/stores.mjs";
import { currentMetricValue, evaluateThesis, newThesis, normalizePredicate } from "../plugins/stonks-copilot/server/theses.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "../plugins/stonks-copilot/server/main.mjs");
const thesisInput = {
  symbol: "AAPL", thesis: "Margins should stay above twenty percent.",
  citedMetrics: [{ metric: "net_margin", op: ">", value: 20 }],
};
const portfolio = {
  importedAt: "2026-09-05T12:00:00.000Z", source: "fixture",
  positions: [{ symbol: "AAPL", quantity: 2, costBasis: 10, lastPrice: 15, expenseRatioPct: null, kind: "stock" }],
};

function fixtureBars(count = 240) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.now() - (count - index - 1) * 86400000).toISOString().slice(0, 10),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000000,
    source: "yahoo", currency: "USD", priceBasis: "fixture unadjusted close", fetchedAt: new Date().toISOString(),
  }));
}

function temp(t) {
  const path = mkdtempSync(join(tmpdir(), "stonks-security-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("data files never follow leaf symlinks or predictable temp symlinks", (t) => {
  const root = temp(t);
  const data = join(root, "data");
  const victim = join(root, "outside.json");
  writeFileSync(victim, "preserve outside data");
  const stores = makeStores(data);
  symlinkSync(victim, join(data, "holdings.json"));
  symlinkSync(victim, join(data, "holdings.json.tmp"));
  assert.throws(() => stores.loadHoldings());
  stores.saveHoldings(portfolio);
  assert.equal(readFileSync(victim, "utf8"), "preserve outside data");
  assert.equal(lstatSync(join(data, "holdings.json")).isSymbolicLink(), false);
  assert.equal(lstatSync(join(data, "holdings.json")).mode & 0o777, 0o600);
  assert.deepEqual(stores.loadHoldings(), portfolio);
  const charts = makeDataFiles(data, "charts");
  symlinkSync(victim, join(data, "charts", "aapl-price.svg"));
  charts.write("aapl-price.svg", "<svg/>");
  assert.equal(readFileSync(victim, "utf8"), "preserve outside data");
  assert.throws(() => charts.write("../../outside.json", "overwritten"), /filename/u);
});

test("data files reject linked directories before initialization and after directory substitution", (t) => {
  const root = temp(t);
  const data = join(root, "data");
  const outside = join(root, "outside");
  mkdirSync(data);
  mkdirSync(outside);
  symlinkSync(outside, join(data, "cache"));
  assert.throws(() => makeCache(data), /subdirectory/u);
  const stores = makeStores(data);
  renameSync(data, join(root, "original"));
  symlinkSync(outside, data);
  assert.throws(() => stores.saveHoldings(portfolio), /directory/u);
  assert.equal(existsSync(join(outside, "holdings.json")), false);
  assert.throws(() => makeStores(data), /real directory/u);
});

test("stores distinguish missing data from corrupt or invalid persisted data", (t) => {
  const root = temp(t);
  const stores = makeStores(root);
  assert.deepEqual(stores.loadTheses(), []);
  writeFileSync(join(root, "theses.json"), "broken json");
  assert.throws(() => stores.loadTheses(), /corrupt/u);
  writeFileSync(join(root, "theses.json"), "{}");
  assert.throws(() => stores.loadTheses(), /invalid theses/u);
  writeFileSync(join(root, "holdings.json"), JSON.stringify({ ...portfolio, positions: [{ ...portfolio.positions[0], symbol: "../../escape" }] }));
  assert.throws(() => stores.loadHoldings(), /invalid holdings/u);
  assert.throws(() => stores.saveHoldings({ ...portfolio, positions: Array(501).fill(portfolio.positions[0]) }), /500/u);
  const files = makeDataFiles(root);
  files.write("size.txt", "12345");
  assert.throws(() => files.read("size.txt", 4), /oversized/u);
  assert.throws(() => files.write("size.txt", "abcdef", 4), /size limit/u);
  assert.equal(files.read("size.txt"), "12345");
});

test("cache keys cannot collide after sanitization; timestamps and links are checked", (t) => {
  const root = temp(t);
  const cache = makeCache(root);
  cache.set("a/b", { one: true });
  cache.set("a?b", { two: true });
  assert.deepEqual(cache.get("a/b", 10000), { one: true });
  assert.deepEqual(cache.get("a?b", 10000), { two: true });
  const name = `${createHash("sha256").update("a/b").digest("hex")}.json`;
  const victim = join(root, "outside-cache.json");
  writeFileSync(victim, JSON.stringify({ storedAt: Date.now(), value: "private" }));
  rmSync(join(root, "cache", name));
  symlinkSync(victim, join(root, "cache", name));
  assert.equal(cache.get("a/b", 10000), null);
  cache.set("a/b", "safe");
  assert.equal(JSON.parse(readFileSync(victim)).value, "private");
  assert.equal(cache.get("a/b", 10000), "safe");
  writeFileSync(join(root, "cache", name), JSON.stringify({ storedAt: Date.now() + 60000, value: "future" }));
  assert.equal(cache.get("a/b", 10000), null);
  assert.equal(cache.get("a?b", -1), null);
  assert.ok(readdirSync(join(root, "cache")).every((file) => /^[a-f0-9]{64}\.json$/u.test(file)));
});

test("thesis predicates reject prototype operators and coercion, and missing metrics never imply holds", () => {
  for (const op of ["constructor", "toString", "__proto__"]) {
    assert.match(normalizePredicate({ metric: "price", op, value: 10 }).error, /op must/u);
  }
  for (const value of [null, "", "20", true, {}, Infinity, NaN]) {
    assert.match(normalizePredicate({ metric: "price", op: ">", value }).error, /finite number/u);
  }
  for (const citedMetrics of [undefined, null, [], {}, "text", Array(33).fill(thesisInput.citedMetrics[0])]) {
    assert.match(newThesis({ ...thesisInput, citedMetrics }).error, /citedMetrics/u);
  }
  assert.match(newThesis({ ...thesisInput, symbol: "../escape" }).error, /symbol/u);
  const { thesis } = newThesis(thesisInput);
  for (const value of [null, "", "N/A", "NaN", Infinity, NaN]) {
    const current = { technical: { lastClose: value }, fundamental: { metrics: { netMarginPct: value } } };
    assert.equal(currentMetricValue("price", current), null);
    assert.equal(evaluateThesis(thesis, current).status, "partial");
  }
  assert.equal(evaluateThesis({ ...thesis, citedMetrics: [] }, {}).status, "partial");
  assert.equal(evaluateThesis({ ...thesis, citedMetrics: [null] }, {}).checks[0].status, "invalid");
});

async function withServer(t) {
  const root = temp(t);
  // A preload replaces fetch before any plugin modules initialize. No test can reach public services.
  const preload = `data:text/javascript,${encodeURIComponent("globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_TEST'); };")}`;
  const child = spawn(process.execPath, ["--import", preload, SERVER], {
    env: { PATH: process.env.PATH, AGENC_PLUGIN_DATA: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = [];
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const waiters = new Map();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      output.push(message);
      waiters.get(message.id)?.(message);
    }
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  });
  async function call(method, params) {
    const id = nextId++;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`MCP timeout for ${method}: ${stderr}`)), 5000);
        waiters.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
      });
    } finally {
      clearTimeout(timer);
      waiters.delete(id);
    }
  }
  return { root, child, output, call, stderr: () => stderr };
}

test("MCP validates arguments before file operations and preserves portfolios on failed imports", async (t) => {
  const { root, call } = await withServer(t);
  for (const args of [{ symbol: "../../outside" }, { symbol: null }, { symbol: [] }, { symbol: "AAPL", months: "12" }, { symbol: "AAPL", months: 1.5 }, { symbol: "AAPL", months: 1000 }, { symbol: "AAPL", extra: true }, []]) {
    const result = await call("tools/call", { name: "chart_price", arguments: args });
    assert.equal(result.error.code, -32602);
  }
  const imported = await call("tools/call", { name: "portfolio_import", arguments: { text: "symbol,quantity,cost basis\nAAPL,2,10" } });
  assert.equal(imported.result.structuredContent.imported, 1);
  const saved = readFileSync(join(root, "holdings.json"), "utf8");
  const empty = await call("tools/call", { name: "portfolio_import", arguments: { text: "" } });
  assert.equal(empty.result.isError, true);
  assert.match(empty.result.content[0].text, /No positions recognized/u);
  assert.equal(readFileSync(join(root, "holdings.json"), "utf8"), saved);
  const missing = await call("tools/call", { name: "portfolio_import", arguments: {} });
  assert.equal(missing.error.code, -32602);
  const nullArgs = await call("tools/call", { name: "metrics_registry", arguments: null });
  assert.equal(nullArgs.error.code, -32602);
  const poison = JSON.parse('{"symbol":"AAPL","thesis":"This is a long valid thesis","citedMetrics":[{"metric":"price","op":"constructor","value":1}]}');
  const invalidPredicate = await call("tools/call", { name: "thesis_create", arguments: poison });
  assert.equal(invalidPredicate.error.code, -32602);
});

test("MCP ignores tool notifications, recovers framing, and never logs malformed private input", async (t) => {
  const { child, root, output, call, stderr } = await withServer(t);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "thesis_create", arguments: thesisInput } })}\n`);
  child.stdin.write('private-account-data malformed json\n');
  child.stdin.write('[]\n');
  child.stdin.write(`${"x".repeat(1024 * 1024 + 1)}\n`);
  const ping = await call("ping");
  assert.deepEqual(ping.result, {});
  assert.equal(existsSync(join(root, "theses.json")), false);
  assert.deepEqual(output.filter((message) => message.error).map((message) => message.error.code), [-32700, -32600, -32700]);
  assert.equal(stderr().includes("private-account-data"), false);
  assert.ok(output.every((message) => Object.hasOwn(message, "id")));
});

test("MCP thesis scans report missing data as partial and can recover a broken thesis", async (t) => {
  const { root, call } = await withServer(t);
  const created = await call("tools/call", { name: "thesis_create", arguments: thesisInput });
  assert.equal(created.result.structuredContent.status, "open");
  const stores = makeStores(root);
  const theses = stores.loadTheses();
  theses[0].status = "broken";
  stores.saveTheses(theses);
  const scan = await call("tools/call", { name: "thesis_scan", arguments: {} });
  assert.equal(scan.result.structuredContent.partial, 1);
  assert.equal(scan.result.structuredContent.broken, 0);
  assert.doesNotMatch(scan.result.structuredContent.summary, /All cited metrics still hold/u);
  assert.equal(stores.loadTheses()[0].status, "partial");
  const priceTheses = stores.loadTheses();
  priceTheses[0].citedMetrics = [{ metric: "price", op: ">", value: 1 }];
  priceTheses[0].status = "broken";
  stores.saveTheses(priceTheses);
  makeCache(root).set("bars-v2-AAPL-12m", fixtureBars());
  const recovered = await call("tools/call", { name: "thesis_scan", arguments: {} });
  assert.equal(recovered.result.structuredContent.results[0].status, "holds");
  assert.equal(stores.loadTheses()[0].status, "holds");
  writeFileSync(join(root, "theses.json"), "corrupt");
  const failed = await call("tools/call", { name: "thesis_create", arguments: thesisInput });
  assert.equal(failed.result.isError, true);
  assert.equal(readFileSync(join(root, "theses.json"), "utf8"), "corrupt");
});

test("MCP portfolio fallback prices are explicitly labeled and chart symlinks cannot overwrite outside files", async (t) => {
  const { root, call } = await withServer(t);
  makeStores(root).saveHoldings(portfolio);
  const got = await call("tools/call", { name: "portfolio_get", arguments: {} });
  assert.equal(got.result.structuredContent.totalValue, 30);
  assert.equal(got.result.structuredContent.positions[0].priceSource, "import");
  assert.equal(got.result.structuredContent.positions[0].priceAsOf, null);
  assert.equal(got.result.structuredContent.warnings.length, 1);
  const outside = join(temp(t), "victim.svg");
  writeFileSync(outside, "preserved");
  symlinkSync(outside, join(root, "charts", "portfolio-treemap.svg"));
  const chart = await call("tools/call", { name: "chart_treemap", arguments: {} });
  assert.equal(chart.result.structuredContent.warnings.length, 1);
  assert.equal(readFileSync(outside, "utf8"), "preserved");
  assert.equal(lstatSync(chart.result.structuredContent.path).isSymbolicLink(), false);
});

test("MCP price history includes the full cached series and chart paths use safe atomic writes", async (t) => {
  const { root, call } = await withServer(t);
  const bars = fixtureBars();
  makeCache(root).set("bars-v2-AAPL-24m", bars);
  const response = await call("tools/call", { name: "ohlcv", arguments: { symbol: "AAPL" } });
  assert.deepEqual(response.result.structuredContent.bars, bars);
  assert.equal(response.result.structuredContent.priceData.source, "yahoo");
  const snapshot = await call("tools/call", { name: "indicators", arguments: { symbol: "AAPL" } });
  assert.equal(snapshot.result.structuredContent.priceData.asOf, bars.at(-1).date);
  const outside = join(temp(t), "victim.svg");
  writeFileSync(outside, "preserved");
  symlinkSync(outside, join(root, "charts", "aapl-price.svg"));
  const chart = await call("tools/call", { name: "chart_price", arguments: { symbol: "AAPL" } });
  assert.equal(chart.result.structuredContent.bars, bars.length);
  assert.equal(readFileSync(outside, "utf8"), "preserved");
  assert.match(readFileSync(chart.result.structuredContent.path, "utf8"), /^<svg/u);
});

test("MCP xray preserves derivative flags and refuses unsupported fund valuation bases", async (t) => {
  const { root, call } = await withServer(t);
  const stores = makeStores(root);
  const cache = makeCache(root);
  stores.saveHoldings({ ...portfolio, positions: [{ ...portfolio.positions[0], symbol: "VOO", kind: "fund" }] });
  cache.set("bars-v2-VOO-2m", fixtureBars(45));
  cache.set("edgar-https://www.sec.gov/files/company_tickers_mf.json", {
    fields: ["cik", "seriesId", "classId", "symbol"],
    data: [[12345, "S000012345", "C000012345", "VOO"]],
  });
  const normal = {
    fundName: "Fixture fund", seriesId: "S000012345", asOf: "2026-08-31", netAssetsUsd: 100,
    weightBasis: "reported net assets", omittedHoldings: 0, warnings: [],
    searchScope: "fixture filings only", sourceUrl: "https://www.sec.gov/Archives/fixture.xml",
    holdings: [{ symbol: "AAPL", cusip: "037833100", name: "Apple Inc.", weight: 1, derivative: false }],
  };
  const cases = [
    { name: "valid assets", data: normal, unresolved: 0 },
    { name: "derivative", data: { ...normal, holdings: [{ ...normal.holdings[0], derivative: true }] }, unresolved: 1 },
    { name: "missing net assets", data: { ...normal, netAssetsUsd: null, weightBasis: "sum of disclosed investment dollar values; net assets unavailable" }, unresolved: 1 },
    { name: "negative net assets", data: { ...normal, netAssetsUsd: -1 }, unresolved: 1 },
    { name: "omitted dollar valuations", data: { ...normal, omittedHoldings: 1 }, unresolved: 1 },
    { name: "unknown valuation basis", data: { ...normal, weightBasis: "unknown" }, unresolved: 1 },
    { name: "partial holdings", data: { ...normal, holdings: [{ ...normal.holdings[0], weight: 0.75 }] }, unresolved: 0.25 },
  ];
  for (const fixture of cases) {
    cache.set("nport-v2-0000012345-S000012345", fixture.data);
    const response = await call("tools/call", { name: "xray", arguments: {} });
    const result = response.result.structuredContent;
    assert.equal(result.unresolvedWeight, fixture.unresolved, fixture.name);
    assert.equal(result.coverage, fixture.unresolved === 0 ? "complete_for_disclosed_holdings" : "partial", fixture.name);
    assert.equal(result.fundReports[0].netAssetsUsd, fixture.data.netAssetsUsd, fixture.name);
    assert.equal(result.fundReports[0].weightBasis, fixture.data.weightBasis, fixture.name);
    assert.equal(result.fundReports[0].searchScope, normal.searchScope, fixture.name);
    if (fixture.unresolved > 0) {
      assert.ok(result.warnings.length > 0, `${fixture.name} must explain incomplete coverage`);
      assert.match(result.concentration.interpretation, /partial/u, fixture.name);
    } else assert.deepEqual(result.effectiveExposure.map((entry) => entry.symbol), ["AAPL"]);
  }
});

test("MCP xray reports lookup failures and unpriced positions as partial coverage", async (t) => {
  const { root, call } = await withServer(t);
  const stores = makeStores(root);
  stores.saveHoldings({ ...portfolio, positions: [
    { ...portfolio.positions[0], symbol: "VOO", kind: "fund" },
    { ...portfolio.positions[0], symbol: "AAPL", kind: "stock" },
  ] });
  makeCache(root).set("bars-v2-VOO-2m", fixtureBars(45));
  const response = await call("tools/call", { name: "xray", arguments: {} });
  const result = response.result.structuredContent;
  assert.equal(result.coverage, "partial");
  assert.deepEqual(result.unpricedSymbols, ["AAPL"]);
  assert.equal(result.unresolvedWeight, 1);
  assert.ok(result.warnings.some((warning) => /AAPL: Current price unavailable/u.test(warning)));
  assert.ok(result.warnings.some((warning) => /VOO: N-PORT lookup failed/u.test(warning)));
  stores.saveHoldings(portfolio);
  const unvalued = await call("tools/call", { name: "xray", arguments: {} });
  assert.equal(unvalued.result.isError, true);
  assert.equal(unvalued.result.structuredContent.coverage, "partial");
  assert.deepEqual(unvalued.result.structuredContent.unpricedSymbols, ["AAPL"]);
  assert.ok(unvalued.result.structuredContent.warnings.length > 0);
});
