#!/usr/bin/env node
/**
 * stonks-copilot MCP server.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited): the
 * AgenC plugin sandbox launches it with cwd confined to the plugin root
 * and AGENC_PLUGIN_DATA pointing at its private data directory. Every tool
 * is read-only against public endpoints (Stooq, SEC EDGAR) or local JSON
 * stores; nothing here places orders, holds credentials, or mutates files
 * outside its data directory.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { technicalSnapshot } from "./indicators.mjs";
import { priceChartSvg, treemapSvg, sparkline } from "./charts.mjs";
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
const SERVER_INFO = { name: "stonks-copilot", version: "0.2.1" };

const dataDir = resolveDataDir();
mkdirSync(join(dataDir, "charts"), { recursive: true });
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
    description: "Daily OHLCV bars for a US-listed symbol from Stooq (public, keyless). Use for raw price history.",
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
      return text(`${bars.length} daily bars for ${symbol.toUpperCase()} (${bars[0].date} → ${bars[bars.length - 1].date}). Last close: ${bars[bars.length - 1].close}. Full series in structuredContent.`);
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
      return structured(technicalSnapshot(bars));
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
        return text(`EDGAR lookup failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (snapshot === null) return text(`No EDGAR data for ${symbol}. It may be a non-US ticker or not an SEC filer.`);
      return structured(snapshot);
    },
  },
  {
    name: "analyze",
    description: "Combined 50/50 scorecard: technical score + fundamental score blended at technicalWeight (default 50). Returns both sub-scores, the blend, signal-level reasons, and a one-line verdict for the agent to elaborate on.",
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
      const blended = fundamental === null
        ? technical.score
        : Math.round((technical.score * weight + fundamental.score * (100 - weight)) / 100);
      return structured({
        symbol: symbol.toUpperCase(),
        asOf: technical.asOf,
        lastClose: technical.lastClose,
        sparkline: sparkline(bars.slice(-60).map((bar) => bar.close)),
        technicalScore: technical.score,
        fundamentalScore: fundamental?.score ?? null,
        fundamentalAvailable: fundamental !== null,
        fundamentalError,
        technicalWeight: weight,
        blendedScore: blended,
        verdict: verdictLine(blended),
        technical,
        fundamental,
      });
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
    handler: async ({ text, source }) => {
      const parsed = parsePositionsText(String(text));
      if (parsed.positions.length === 0) {
        return text(`No positions recognized.\n${parsed.warnings.join("\n")}`);
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
      for (const position of holdings.positions) {
        let lastPrice = position.lastPrice;
        try {
          const bars = await marketData.dailyBars(position.symbol, { months: 2 });
          lastPrice = bars[bars.length - 1].close;
        } catch {
          // keep imported price or null
        }
        const value = lastPrice !== null ? lastPrice * position.quantity : null;
        const cost = position.costBasis !== null && position.costBasis !== undefined
          ? position.costBasis * position.quantity
          : null;
        enriched.push({
          ...position,
          lastPrice,
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
        positions: enriched.map((p) => ({ ...p, weight: total > 0 ? round4(p.value / total) : null })),
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
        return text(`N-PORT lookup failed for ${fund}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (holdings === null) return text(`No N-PORT holdings found for ${fund}.`);
      return structured(holdings);
    },
  },
  {
    name: "xray",
    description: "Portfolio forensics: merges direct holdings with fund constituents (N-PORT) into effective exposure per underlying — overlap, duplicated fund exposure, concentration (HHI, top-10), fund vs stock split, and estimated annual fee drag when expense ratios were imported.",
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
      const priceOf = async (symbol) => {
        if (priceCache.has(symbol)) return priceCache.get(symbol);
        let price = null;
        try {
          const bars = await marketData.dailyBars(symbol, { months: 2 });
          price = bars[bars.length - 1].close;
        } catch {
          price = null;
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
      if (includeFunds !== false) {
        const funds = new Set(positions.filter((p) => p.kind === "fund").map((p) => p.symbol));
        for (const fund of funds) {
          try {
            const holdingsFor = await edgar.fundHoldings(fund);
            const simplified = holdingsFor === null
              ? null
              : holdingsFor.holdings
                  .filter((holding) => holding.symbol !== null)
                  .map((holding) => ({ symbol: holding.symbol, weight: holding.weight }));
            fundCache.set(fund, simplified);
          } catch {
            fundCache.set(fund, null);
          }
        }
      }
      const result = xrayPortfolio(positions, {
        constituentsOf: (symbol) => fundCache.get(symbol) ?? null,
        priceOf: (symbol) => priceCache.get(symbol) ?? null,
      });
      if (result.error !== undefined) return text(result.error);
      return structured(result);
    },
  },
  {
    name: "chart_price",
    description: "Render a price chart SVG (close line + SMA50/SMA200 + volume) into the plugin data directory and return its absolute path plus an inline unicode sparkline for terminals.",
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
      const svg = priceChartSvg(bars, {
        symbol: symbol.toUpperCase(),
        overlays: { sma50: smaAligned(closes, 50), sma200: smaAligned(closes, 200) },
      });
      if (svg === null) return text("Not enough bars to draw a chart.");
      const file = join(dataDir, "charts", `${symbol.toLowerCase()}-price.svg`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(file, svg);
      return structured({ path: file, sparkline: sparkline(closes.slice(-60)), bars: bars.length });
    },
  },
  {
    name: "chart_treemap",
    description: "Render a portfolio treemap SVG (area = weight, color = position P/L) into the plugin data directory and return its path. Requires a stored portfolio.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const holdings = stores.loadHoldings();
      if (holdings.positions.length === 0) {
        return text("No portfolio stored yet. Import one with portfolio_import.");
      }
      const items = [];
      for (const position of holdings.positions) {
        let price = position.lastPrice ?? null;
        try {
          const bars = await marketData.dailyBars(position.symbol, { months: 2 });
          price = bars[bars.length - 1].close;
        } catch {
          // fall back to imported price
        }
        if (price === null) continue;
        const value = price * position.quantity;
        const cost = position.costBasis != null ? position.costBasis * position.quantity : null;
        items.push({
          label: position.symbol,
          weight: value,
          value: cost !== null && cost > 0 ? (value - cost) / cost : 0,
        });
      }
      const svg = treemapSvg(items, { title: `Portfolio — ${holdings.positions.length} positions` });
      if (svg === null) return text("No priced positions to draw a treemap.");
      const file = join(dataDir, "charts", "portfolio-treemap.svg");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(file, svg);
      return structured({ path: file, items: items.length });
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
      if (created.error !== undefined) return text(`Invalid thesis: ${created.error}`);
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
    description: "Re-evaluate theses against current data. A break means a cited metric no longer satisfies its predicate — the stated reason for holding no longer holds. Scans one symbol or all.",
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
        thesis.lastScan = evaluation.scannedAt;
        thesis.status = evaluation.status === "broken" ? "broken" : thesis.status;
        results.push(evaluation);
      }
      stores.saveTheses(theses);
      const broken = results.filter((result) => result.status === "broken");
      return structured({
        scanned: results.length,
        broken: broken.length,
        summary: broken.length === 0
          ? "All cited metrics still hold."
          : `${broken.length} thesis(ies) broken: ${broken.map((b) => b.symbol).join(", ")}`,
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

function structured(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

async function handleMessage(message) {
  if (message === null || typeof message !== "object") return null;
  const { id, method, params } = message;
  const isNotification = id === undefined;
  try {
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
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
        return isNotification ? null : reply(id, null, { code: -32602, message: `unknown tool: ${name}` });
      }
      const result = await tool.handler(params?.arguments ?? {});
      return isNotification ? null : reply(id, result);
    }
    return isNotification ? null : reply(id, null, { code: -32601, message: `method not found: ${method}` });
  } catch (error) {
    if (isNotification) return null;
    return reply(id, null, {
      code: -32000,
      message: `tool error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function reply(id, result, error) {
  const response = { jsonrpc: "2.0", id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  return response;
}

async function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write(`stonks-copilot: unparseable line: ${line.slice(0, 120)}\n`);
        continue;
      }
      const response = await handleMessage(message);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`stonks-copilot fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
