#!/usr/bin/env node
/**
 * stonks-copilot MCP server.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited): the
 * AgenC plugin sandbox launches it with cwd confined to the plugin root
 * and AGENC_PLUGIN_DATA pointing at its private data directory. Every tool
 * uses public endpoints (Yahoo, Stooq, SEC EDGAR) or private local JSON
 * stores; nothing here places orders, holds credentials, or mutates files
 * outside its data directory.
 */
import { once } from "node:events";
import { join } from "node:path";
import { technicalSnapshot } from "./indicators.mjs";
import { priceChartBlock } from "./charts.mjs";
import { parsePositionsText, xrayPortfolio } from "./portfolio.mjs";
import { makeCache } from "./cache.mjs";
import { makeMarketData } from "./bars.mjs";
import { makeEdgar } from "./edgar.mjs";
import { makeStores } from "./stores.mjs";
import {
  SUPPORTED_METRICS,
  evaluateThesis,
  newThesis,
} from "./theses.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "stonks-copilot", version: "0.2.5" };

const dataDir = resolveDataDir();
const cache = makeCache(dataDir);
const marketData = makeMarketData({ cache });
const edgar = makeEdgar({ cache });
const stores = makeStores(dataDir);

function resolveDataDir() {
  if (process.env.AGENC_PLUGIN_DATA && process.env.AGENC_PLUGIN_DATA.trim() !== "") {
    return process.env.AGENC_PLUGIN_DATA;
  }
  const fallback = join(
    process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? ".", ".local", "share"),
    "agenc-plugins",
    "stonks-copilot",
  );
  return fallback;
}

const tools = [
  {
    name: "ohlcv",
    description: "Daily OHLCV bars for a US-listed symbol from Yahoo, with Stooq fallback (public, keyless). Returns the raw price history and source metadata.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker, e.g. AAPL or VOO" },
        months: { type: "number", description: "Lookback window in months (default 24)" },
      },
      required: ["symbol"],
    },
    handler: async ({ symbol, months }) => {
      const bars = await marketData.dailyBars(symbol, { months: clampMonths(months) });
      return structured({ symbol: symbol.toUpperCase(), priceData: priceMetadata(bars), bars });
    },
  },
  {
    name: "indicators",
    description: "Technical snapshot for a symbol: trend (SMA50/200, golden/death cross), RSI14, MACD histogram, Bollinger %B, 52-week range/drawdown, volume, and clustered support/resistance zones, plus a 0-100 technical score with per-signal reasons.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        months: { type: "number", description: "History window in months (default 24; needs 10+ for SMA200)" },
      },
      required: ["symbol"],
    },
    handler: async ({ symbol, months }) => {
      const bars = await marketData.dailyBars(symbol, { months: clampMonths(months) });
      return structured({ ...technicalSnapshot(bars), priceData: priceMetadata(bars) });
    },
  },
  {
    name: "fundamentals",
    description: "Fundamental snapshot from SEC EDGAR XBRL (annual 10-K series): revenue/margin/EPS/FCF/debt trends, valuation (P/E, P/S, FCF yield, dividend yield), and a 0-100 fundamental score with reasons. Pass the latest close for valuation ratios.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        price: { type: "number", description: "Latest close; enables P/E, P/S, FCF and dividend yields" },
      },
      required: ["symbol"],
    },
    handler: async ({ symbol, price }) => {
      let snapshot = null;
      try {
        snapshot = await edgar.fundamentalsSnapshot(symbol, { price: price ?? null });
      } catch (error) {
        return toolError(`EDGAR lookup failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (snapshot === null) return toolError(`No EDGAR data for ${symbol}. It may be a non-US ticker or not an SEC filer.`);
      return structured(snapshot);
    },
  },
  {
    name: "analyze",
    description: "Technical and SEC fundamental scorecard. A blended score and verdict are returned only when both scores exist. Missing fundamentals yield a labeled technical-only score and an explanation.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        technicalWeight: { type: "number", description: "0-100 weight of the technical score (default 50)" },
        months: { type: "number" },
      },
      required: ["symbol"],
    },
    handler: async ({ symbol, technicalWeight, months }) => {
      const weight = clamp(Number.isFinite(technicalWeight) ? technicalWeight : 50, 0, 100);
      const bars = await marketData.dailyBars(symbol, { months: clampMonths(months) });
      const technical = technicalSnapshot(bars);
      let fundamental = null;
      let fundamentalError = null;
      try {
        fundamental = await edgar.fundamentalsSnapshot(symbol, { price: technical.lastClose });
      } catch (error) {
        fundamentalError = error instanceof Error ? error.message : String(error);
      }
      const fundamentalScored = Number.isFinite(fundamental?.score);
      const canBlend = Number.isFinite(technical.score) && fundamentalScored;
      const blended = canBlend
        ? Math.round((technical.score * weight + fundamental.score * (100 - weight)) / 100)
        : null;
      const fundamentalNote = canBlend ? null : fundamentalError
        ? `Fundamentals are unavailable: ${fundamentalError}`
        : fundamental === null
          ? `Fundamentals are unavailable for ${symbol.toUpperCase()}: no usable SEC filing data was found.`
          : `Fundamentals are unavailable for ${symbol.toUpperCase()}: the SEC filing did not yield a valid fundamental score.`;
      return priceResult({
        symbol: symbol.toUpperCase(),
        asOf: technical.asOf,
        lastClose: technical.lastClose,
        priceData: priceMetadata(bars),
        technicalScore: technical.score,
        fundamentalScore: fundamental?.score ?? null,
        fundamentalAvailable: fundamentalScored,
        fundamentalError,
        fundamentalNote,
        technicalOnly: !canBlend && Number.isFinite(technical.score),
        technicalWeight: weight,
        blendedScore: blended,
        verdict: canBlend ? verdictLine(blended) : null,
        technical,
        fundamental,
      }, bars, symbol);
    },
  },
  {
    name: "portfolio_import",
    description: "Import positions from pasted broker text/CSV (Schwab positions export or generic symbol,quantity[,cost] columns). Replaces any previously stored portfolio. Returns parsed positions and warnings about ignored rows.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The pasted CSV/text, one row per position" },
        source: { type: "string", description: "Optional label, e.g. 'schwab-positions.csv'" },
      },
      required: ["text"],
    },
    handler: async ({ text: inputText, source }) => {
      const parsed = parsePositionsText(inputText);
      if (parsed.positions.length === 0) {
        return toolError(`No positions recognized.\n${parsed.warnings.join("\n")}`);
      }
      stores.saveHoldings({ importedAt: new Date().toISOString(), source: source ?? "paste", positions: parsed.positions });
      return structured({ imported: parsed.positions.length, positions: parsed.positions, warnings: parsed.warnings });
    },
  },
  {
    name: "portfolio_get",
    description: "Stored portfolio: positions with last closes, market values, weights and P/L vs cost basis (when a cost basis was imported).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const holdings = stores.loadHoldings();
      if (holdings.positions.length === 0) {
        return text("No portfolio stored yet. Import one with portfolio_import.");
      }
      const enriched = [];
      const warnings = [];
      for (const position of holdings.positions) {
        let lastPrice = position.lastPrice ?? null;
        let priceAsOf = null;
        let priceSource = lastPrice === null ? null : "import";
        let priceWarning = null;
        try {
          const bars = await marketData.dailyBars(position.symbol, { months: 2 });
          const last = bars[bars.length - 1];
          lastPrice = last.close;
          priceAsOf = last.date;
          priceSource = last.source ?? "market-data";
        } catch {
          priceWarning = lastPrice === null ? "Current price unavailable; position is excluded from the priced total."
            : "Current price unavailable; using imported price with unknown market date.";
          warnings.push(`${position.symbol}: ${priceWarning}`);
        }
        const value = lastPrice !== null ? lastPrice * position.quantity : null;
        const cost = position.costBasis !== null && position.costBasis !== undefined
          ? position.costBasis * position.quantity
          : null;
        enriched.push({
          ...position,
          lastPrice,
          priceAsOf,
          priceSource,
          priceWarning,
          value: round2(value),
          costTotal: round2(cost),
          pl: value !== null && cost !== null ? round2(value - cost) : null,
        });
      }
      const total = enriched.reduce((a, p) => a + (p.value ?? 0), 0);
      return structured({
        importedAt: holdings.importedAt,
        source: holdings.source,
        totalValue: round2(total),
        warnings,
        positions: enriched.map((p) => ({ ...p, weight: total > 0 && p.value !== null ? round4(p.value / total) : null })),
      });
    },
  },
  {
    name: "fund_holdings",
    description: "Latest complete holdings of a registered fund (ETF/mutual fund) from SEC N-PORT filings, as value-weighted positions. Quarterly data. Returns null-equivalent text when the fund has no N-PORT filings.",
    inputSchema: {
      type: "object",
      properties: { fund: { type: "string", description: "Fund ticker, e.g. VOO" } },
      required: ["fund"],
    },
    handler: async ({ fund }) => {
      let holdings = null;
      try {
        holdings = await edgar.fundHoldings(fund);
      } catch (error) {
        return toolError(`N-PORT lookup failed for ${fund}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (holdings === null) return toolError(`No N-PORT holdings found for ${fund}.`);
      return structured(holdings);
    },
  },
  {
    name: "xray",
    description: "Portfolio forensics: merges direct holdings with fund constituents (N-PORT) into effective exposure per underlying - overlap, duplicated fund exposure, concentration (HHI, top-10), fund vs stock split, and estimated annual fee drag when expense ratios were imported.",
    inputSchema: {
      type: "object",
      properties: {
        includeFunds: { type: "boolean", description: "Resolve fund constituents via N-PORT (default true)" },
      },
    },
    handler: async ({ includeFunds }) => {
      const holdings = stores.loadHoldings();
      if (holdings.positions.length === 0) {
        return text("No portfolio stored yet. Import one with portfolio_import.");
      }
      const priceCache = new Map();
      const priceWarnings = [];
      const priceOf = async (symbol) => {
        if (priceCache.has(symbol)) return priceCache.get(symbol);
        let price = null;
        try {
          const bars = await marketData.dailyBars(symbol, { months: 2 });
          price = bars[bars.length - 1].close;
        } catch {
          price = null;
          priceWarnings.push(`${symbol}: Current price unavailable; excluded from valued exposure.`);
        }
        priceCache.set(symbol, price);
        return price;
      };
      const positions = [];
      for (const position of holdings.positions) {
        const price = await priceOf(position.symbol);
        positions.push({ ...position, lastPrice: price });
      }
      const fundCache = new Map();
      const fundWarnings = [];
      const fundReports = [];
      if (includeFunds !== false) {
        const funds = new Set(positions.filter((p) => p.kind === "fund").map((p) => p.symbol));
        for (const fund of funds) {
          try {
            const holdingsFor = await edgar.fundHoldings(fund);
            const supportedBasis = holdingsFor !== null && Number.isFinite(holdingsFor.netAssetsUsd)
              && holdingsFor.netAssetsUsd > 0 && holdingsFor.weightBasis === "reported net assets"
              && holdingsFor.omittedHoldings === 0;
            const simplified = !supportedBasis
              ? null
              : holdingsFor.holdings.map((holding) => ({ symbol: holding.symbol, name: holding.name, cusip: holding.cusip, weight: holding.weight, derivative: holding.derivative }));
            for (const warning of holdingsFor?.warnings ?? []) fundWarnings.push(`${fund}: ${warning}`);
            if (holdingsFor === null) fundWarnings.push(`${fund}: No matching N-PORT holdings available; fund exposure remains unresolved.`);
            else if (!supportedBasis) fundWarnings.push(`${fund}: Fund exposure remains unresolved because reported net assets or complete dollar valuations are unavailable.`);
            fundReports.push({
              symbol: fund,
              asOf: holdingsFor?.asOf ?? null,
              netAssetsUsd: holdingsFor?.netAssetsUsd ?? null,
              weightBasis: holdingsFor?.weightBasis ?? null,
              omittedHoldings: holdingsFor?.omittedHoldings ?? null,
              sourceUrl: holdingsFor?.sourceUrl ?? null,
              searchScope: holdingsFor?.searchScope ?? null,
              supportedBasis,
            });
            fundCache.set(fund, simplified);
          } catch (error) {
            fundWarnings.push(`${fund}: N-PORT lookup failed; fund exposure remains unresolved (${error instanceof Error ? error.message : String(error)}).`);
            fundReports.push({ symbol: fund, supportedBasis: false, netAssetsUsd: null, weightBasis: null });
            fundCache.set(fund, null);
          }
        }
      } else if (positions.some((p) => p.kind === "fund")) {
        fundWarnings.push("Fund look-through was disabled; constituent exposure remains unresolved.");
      }
      const result = xrayPortfolio(positions, {
        constituentsOf: (symbol) => fundCache.get(symbol) ?? null,
        priceOf: (symbol) => priceCache.get(symbol) ?? null,
      });
      const warnings = [...(result.warnings ?? []), ...priceWarnings, ...fundWarnings];
      if (result.error !== undefined) return { ...structured({ ...result, coverage: "partial", warnings, fundReports }), isError: true };
      for (const fund of result.unresolvedFunds) {
        warnings.push(`${fund}: Fund exposure is incomplete or unsupported; do not treat the constituent weights as exact economic exposure.`);
      }
      return structured({
        ...result,
        coverage: result.unpricedSymbols.length > 0 || result.unresolvedWeight > 0 ? "partial" : "complete_for_disclosed_holdings",
        fundReports: fundReports.map((report) => ({ ...report, unresolved: result.unresolvedFunds.includes(report.symbol) })),
        warnings,
      });
    },
  },
  {
    name: "chart_price",
    description: "Show a price chart with OHLC, volume and SMA 50/200 as a display attachment. Returns a short price and indicator summary.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        months: { type: "number", description: "Window in months (default 24)" },
      },
      required: ["symbol"],
    },
    handler: async ({ symbol, months }) => {
      const bars = await marketData.dailyBars(symbol, { months: clampMonths(months) });
      const closes = bars.map((bar) => bar.close);
      const chart = priceChartBlock(bars, { symbol: symbol.toUpperCase() });
      if (chart === null) return text("No bars to draw a chart.");
      const latest = bars.at(-1);
      const indicators = { sma50: smaAligned(closes, 50).at(-1) ?? null, sma200: smaAligned(closes, 200).at(-1) ?? null };
      const period = `${bars[0].date} to ${latest.date} (${chart.title.split(", ").at(-1)})`;
      const summary = `${symbol.toUpperCase()}, ${period}: last close ${latest.close} ${latest.currency ?? "USD"}; SMA 50 ${indicatorText(indicators.sma50)}, SMA 200 ${indicatorText(indicators.sma200)}.`;
      return displayResult(summary, [displayResource("chart", `agenc:chart:price:${symbol.toUpperCase()}`, chart)], {
        symbol: symbol.toUpperCase(), period, asOf: latest.date,
        lastClose: latest.close, currency: latest.currency ?? "USD", indicators, bars: bars.length,
      });
    },
  },
  {
    name: "chart_treemap",
    description: "Show portfolio position weights as a pie chart and position details as a table. Requires a stored portfolio.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const holdings = stores.loadHoldings();
      if (holdings.positions.length === 0) {
        return text("No portfolio stored yet. Import one with portfolio_import.");
      }
      const positions = [];
      const unpricedSymbols = [];
      let importedPriceCount = 0;
      for (const position of holdings.positions) {
        let price = position.lastPrice ?? null;
        let priceAsOf = null;
        let priceSource = price === null ? null : "import";
        try {
          const bars = await marketData.dailyBars(position.symbol, { months: 2 });
          const last = bars[bars.length - 1];
          price = last.close;
          priceAsOf = last.date;
          priceSource = last.source ?? "market-data";
        } catch { if (price !== null) importedPriceCount += 1; }
        const value = price === null || !Number.isFinite(price * position.quantity) ? null : price * position.quantity;
        if (value === null) unpricedSymbols.push(position.symbol);
        const cost = position.costBasis != null ? position.costBasis * position.quantity : null;
        positions.push({
          symbol: position.symbol, quantity: position.quantity, kind: position.kind,
          lastPrice: price, priceAsOf, priceSource, value, costBasis: position.costBasis ?? null,
          costTotal: Number.isFinite(cost) ? cost : null,
          pl: value !== null && cost !== null && Number.isFinite(value - cost) ? value - cost : null,
          plPct: value !== null && cost !== null && cost > 0 && Number.isFinite((value - cost) / cost) ? (value - cost) / cost : null,
          expenseRatioPct: position.expenseRatioPct ?? null,
        });
      }
      const priced = positions.filter((position) => position.value !== null);
      const grossValue = priced.reduce((sum, position) => sum + Math.abs(position.value), 0);
      if (grossValue <= 0 || !Number.isFinite(grossValue)) return text("No nonzero priced positions to chart.");
      const netValue = priced.reduce((sum, position) => sum + position.value, 0);
      const rows = positions.map((position) => ({ ...position, weight: position.value === null ? null : Math.abs(position.value) / grossValue }));
      const ranked = rows.filter((position) => position.weight !== null && position.weight > 0).sort((a, b) => b.weight - a.weight);
      const visible = ranked.slice(0, 99);
      const slices = visible.map((position) => ({ label: position.symbol, value: position.weight }));
      if (ranked.length > 99) slices.push({ label: `Other (${ranked.length - 99} positions)`, value: ranked.slice(99).reduce((sum, position) => sum + position.weight, 0) });
      const pie = { version: 1, kind: "pie", title: "Portfolio gross position weights", slices };
      const table = {
        version: 1, title: "Portfolio positions",
        columns: [
          ["symbol", "Symbol"], ["weight", "Gross weight"], ["value", "Market value"],
          ["quantity", "Quantity"], ["kind", "Kind"], ["lastPrice", "Last price"],
          ["priceAsOf", "Price date"], ["priceSource", "Price source"],
          ["costBasis", "Cost basis"], ["costTotal", "Total cost"],
          ["pl", "P/L"], ["plPct", "P/L %"], ["expenseRatioPct", "Expense ratio %"],
        ].map(([key, label]) => ({ key, label })),
        rows,
      };
      const summary = `Portfolio: ${priced.length}/${holdings.positions.length} positions priced; net value ${round2(netValue)} USD, gross value ${round2(grossValue)} USD; ${unpricedSymbols.length} unpriced, ${importedPriceCount} using imported prices.`;
      return displayResult(summary, [
        displayResource("chart", "agenc:chart:portfolio-weights", pie),
        displayResource("table", "agenc:table:portfolio-positions", table),
      ], { totalValue: round2(netValue), grossValue: round2(grossValue), pricedPositions: priced.length, positions: holdings.positions.length, unpricedCount: unpricedSymbols.length, importedPriceCount });
    },
  },
  {
    name: "thesis_create",
    description: "Record an investment thesis with quantified cited metrics to surveil. Extract 2-5 predicates from the user's own reasoning (metric/op/value) using the supported metric registry.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        thesis: { type: "string", description: "The user's stated reason for the position, in their words" },
        horizon: { type: "string", description: "e.g. '5 years', 'until margins compress'" },
        exitConditions: { type: "string", description: "Stated exit conditions, if any" },
        citedMetrics: {
          type: "array",
          description: "Predicates extracted from the thesis text",
          items: {
            type: "object",
            properties: {
              metric: { type: "string", enum: SUPPORTED_METRICS.map((m) => m.metric) },
              op: { type: "string", enum: [">", ">=", "<", "<="] },
              value: { type: "number" },
            },
            required: ["metric", "op", "value"],
          },
        },
      },
      required: ["symbol", "thesis", "citedMetrics"],
    },
    handler: async (args) => {
      const created = newThesis(args);
      if (created.error !== undefined) return toolError(`Invalid thesis: ${created.error}`);
      const theses = stores.loadTheses();
      theses.push(created.thesis);
      stores.saveTheses(theses);
      return structured(created.thesis);
    },
  },
  {
    name: "thesis_list",
    description: "All recorded theses with their cited metrics and last scan status.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => structured({ theses: stores.loadTheses() }),
  },
  {
    name: "thesis_scan",
    description: "Re-evaluate theses against current data. A break means a cited metric no longer satisfies its predicate - the stated reason for holding no longer holds. Scans one symbol or all.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Optional: scan only this symbol" } },
    },
    handler: async ({ symbol }) => {
      const theses = stores.loadTheses();
      const targets = theses.filter((thesis) =>
        symbol === undefined || thesis.symbol === symbol.toUpperCase(),
      );
      if (targets.length === 0) return text("No theses recorded. Create one with thesis_create.");
      const techCache = new Map();
      const fundCache = new Map();
      const results = [];
      for (const thesis of targets) {
        let technical = techCache.get(thesis.symbol);
        if (technical === undefined) {
          try {
            const bars = await marketData.dailyBars(thesis.symbol, { months: 12 });
            technical = technicalSnapshot(bars);
          } catch {
            technical = null;
          }
          techCache.set(thesis.symbol, technical);
        }
        let fundamental = fundCache.get(thesis.symbol);
        if (fundamental === undefined) {
          try {
            fundamental = await edgar.fundamentalsSnapshot(thesis.symbol, {
              price: technical?.lastClose ?? null,
            });
          } catch {
            fundamental = null;
          }
          fundCache.set(thesis.symbol, fundamental);
        }
        const evaluation = evaluateThesis(thesis, { technical, fundamental });
        evaluation.priceAsOf = technical?.asOf ?? null;
        evaluation.dataWarnings = fundamental?.warnings ?? [];
        thesis.lastScan = evaluation.scannedAt;
        thesis.status = evaluation.status;
        results.push(evaluation);
      }
      stores.saveTheses(theses);
      const broken = results.filter((result) => result.status === "broken");
      const partial = results.filter((result) => result.status === "partial");
      return structured({
        scanned: results.length,
        broken: broken.length,
        partial: partial.length,
        summary: broken.length === 0
          ? partial.length === 0 ? "All cited metrics still hold." : `${partial.length} thesis(ies) could not be fully evaluated; some cited metrics are unavailable or invalid.`
          : `${broken.length} thesis(ies) broken: ${broken.map((b) => b.symbol).join(", ")}${partial.length > 0 ? `; ${partial.length} additional thesis(ies) could not be fully evaluated.` : ""}`,
        results,
      });
    },
  },
  {
    name: "metrics_registry",
    description: "The supported cited-metric registry for theses: names, units, and where each value comes from (technical vs EDGAR fundamentals).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => structured({ metrics: SUPPORTED_METRICS }),
  },
];

function smaAligned(values, period) {
  const out = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function priceResult(value, bars, symbol) {
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const change = previous ? last.close - previous.close : null;
  const changeText = change === null ? "change unavailable" : `change ${change >= 0 ? "+" : ""}${Number(change.toPrecision(12))} ${last.currency ?? "USD"}`;
  const summary = `${symbol.toUpperCase()}: last close ${last.close} ${last.currency ?? "USD"} on ${last.date}; ${changeText}.`;
  const content = [{ type: "text", text: summary }];
  return { structuredContent: { ...value, summary, lastClose: last.close, change, asOf: last.date }, content };
}

function indicatorText(value) {
  return value === null ? "unavailable" : Number(value.toPrecision(8)).toString();
}

function displayResource(kind, uri, data) {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body, "utf8") > 512 * 1024) throw new Error(`${kind} exceeds the 512 KiB display limit`);
  return {
    type: "resource", annotations: { audience: ["user"] },
    resource: { uri, mimeType: `application/vnd.agenc.${kind}+json`, text: body },
  };
}

function displayResult(summary, attachments, facts) {
  return { structuredContent: { ...facts, summary }, content: [{ type: "text", text: summary }, ...attachments] };
}

function priceMetadata(bars) {
  const latest = bars.at(-1);
  return {
    asOf: latest?.date ?? null,
    source: latest?.source ?? null,
    currency: latest?.currency ?? null,
    priceBasis: latest?.priceBasis ?? null,
    fetchedAt: latest?.fetchedAt ?? null,
  };
}

function clampMonths(months) {
  return clamp(Number.isFinite(months) ? months : 24, 1, 120);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}

function round4(value) {
  return value === null || value === undefined ? null : Math.round(value * 10000) / 10000;
}

function verdictLine(score) {
  if (score >= 70) return "evidence leans favorable";
  if (score >= 55) return "evidence tilts mildly favorable";
  if (score > 45) return "evidence is mixed";
  if (score > 30) return "evidence tilts mildly unfavorable";
  return "evidence leans unfavorable";
}

function text(value) {
  return { content: [{ type: "text", text: String(value) }] };
}

function toolError(value) {
  return { ...text(value), isError: true };
}

function structured(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

// These limits are both advertised to clients and enforced before any handler runs.
for (const tool of tools) {
  tool.inputSchema.additionalProperties = false;
  for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
    if (name === "symbol" || name === "fund") {
      Object.assign(schema, { pattern: "^[A-Za-z][A-Za-z0-9.-]{0,11}$", maxLength: 12 });
    }
    if (name === "months") Object.assign(schema, { type: "integer", minimum: 1, maximum: 120 });
    if (name === "technicalWeight") Object.assign(schema, { minimum: 0, maximum: 100 });
    if (name === "price") Object.assign(schema, { exclusiveMinimum: 0 });
    if (name === "text") schema.maxLength = 256 * 1024;
    if (name === "source" || name === "horizon") schema.maxLength = 256;
    if (name === "thesis" || name === "exitConditions") schema.maxLength = 10000;
    if (name === "citedMetrics") {
      schema.maxItems = 32;
      schema.items.additionalProperties = false;
    }
  }
}

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateArguments(value, schema, path = "arguments") {
  const matches = schema.type === "object" ? isObject(value)
    : schema.type === "array" ? Array.isArray(value)
      : schema.type === "integer" ? Number.isInteger(value)
        : schema.type === "number" ? Number.isFinite(value) : typeof value === schema.type;
  if (!matches) return `${path} must be ${schema.type}`;
  if (schema.enum !== undefined && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}`;
  if (schema.type === "object") {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return `${path}.${key} is required`;
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) return `${path} contains an unknown property`;
      const error = validateArguments(item, schema.properties[key], `${path}.${key}`);
      if (error !== null) return error;
    }
  }
  if (schema.type === "array") {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} exceeds ${schema.maxItems} items`;
    for (let i = 0; i < value.length; i += 1) {
      const error = validateArguments(value[i], schema.items, `${path}[${i}]`);
      if (error !== null) return error;
    }
  }
  if (schema.type === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} exceeds ${schema.maxLength} characters`;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) return `${path} must be a ticker of 1-12 letters, digits, dots or hyphens`;
  }
  if ((schema.type === "number" || schema.type === "integer") && ((schema.minimum !== undefined && value < schema.minimum)
      || (schema.maximum !== undefined && value > schema.maximum)
      || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum))) return `${path} is outside the supported range`;
  return null;
}

async function handleMessage(message) {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string"
      || (Object.hasOwn(message, "id") && message.id !== null && typeof message.id !== "string" && !Number.isFinite(message.id))) {
    return reply(null, null, { code: -32600, message: "invalid JSON-RPC request" });
  }
  const { id, method, params } = message;
  // Only requests may execute tools; notifications never produce responses or mutations.
  if (id === undefined) return null;
  if (params !== undefined && !isObject(params)) return reply(id, null, { code: -32602, message: "params must be an object" });
  try {
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return reply(id, null, { code: -32600, message: "notification method cannot be a request" });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
      return reply(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const name = params?.name;
      const tool = toolByName.get(name);
      if (tool === undefined) {
        return reply(id, null, { code: -32602, message: "unknown tool" });
      }
      const args = params.arguments === undefined ? {} : params.arguments;
      const validationError = validateArguments(args, tool.inputSchema);
      if (validationError !== null) return reply(id, null, { code: -32602, message: validationError });
      const result = await tool.handler(args);
      return reply(id, result);
    }
    return reply(id, null, { code: -32601, message: "method not found" });
  } catch (error) {
    return reply(id, toolError(`tool error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

function reply(id, result, error) {
  const response = { jsonrpc: "2.0", id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  return response;
}

async function main() {
  const MAX_FRAME_BYTES = 1024 * 1024;
  const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let bufferBytes = 0;
  let discarding = false;
  async function send(response) {
    let serialized = JSON.stringify(response);
    if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) serialized = JSON.stringify(reply(response.id, toolError("result exceeds the response size limit")));
    if (!process.stdout.write(`${serialized}\n`)) await once(process.stdout, "drain");
  }
  for await (const chunk of process.stdin) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf("\n", start);
      const fragment = chunk.slice(start, newline < 0 ? chunk.length : newline);
      start = newline < 0 ? chunk.length : newline + 1;
      if (!discarding) {
        bufferBytes += Buffer.byteLength(fragment);
        if (bufferBytes > MAX_FRAME_BYTES) {
          discarding = true;
          buffer = "";
          await send(reply(null, null, { code: -32700, message: "JSON-RPC frame exceeds 1 MiB limit" }));
        } else buffer += fragment;
      }
      if (newline < 0) continue;
      const line = buffer.trim();
      buffer = "";
      bufferBytes = 0;
      if (discarding) {
        discarding = false;
        continue;
      }
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        await send(reply(null, null, { code: -32700, message: "invalid JSON" }));
        continue;
      }
      const response = await handleMessage(message);
      if (response !== null) {
        await send(response);
      }
    }
  }
  if (!discarding && buffer.trim() !== "") await send(reply(null, null, { code: -32700, message: "unterminated JSON-RPC frame" }));
}

main().catch((error) => {
  process.stderr.write(`stonks-copilot fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
