/**
 * Investment decision journal. A thesis records why a position was taken
 * plus quantified predicates ("cited metrics") extracted from the user's
 * own words. Surveillance re-evaluates those predicates against current
 * data: a thesis-break is when the reason you gave no longer holds —
 * independent of what the price is doing. Pure — persistence lives in
 * stores.mjs.
 */

export const SUPPORTED_METRICS = [
  { metric: "price", source: "technical", unit: "usd", description: "latest daily close" },
  { metric: "pe", source: "fundamental", unit: "ratio", description: "price / diluted EPS (TTM latest FY)" },
  { metric: "net_margin", source: "fundamental", unit: "percent", description: "net income / revenue, latest FY" },
  { metric: "revenue_growth", source: "fundamental", unit: "percent", description: "revenue growth YoY, latest FY" },
  { metric: "eps_growth", source: "fundamental", unit: "percent", description: "diluted EPS growth YoY, latest FY" },
  { metric: "fcf_yield", source: "fundamental", unit: "percent", description: "free cash flow / market cap" },
  { metric: "current_ratio", source: "fundamental", unit: "ratio", description: "current assets / current liabilities" },
  { metric: "dividend_yield", source: "fundamental", unit: "percent", description: "declared dividends per share / price" },
  { metric: "rsi14", source: "technical", unit: "index", description: "Wilder RSI over 14 sessions" },
];

const OPERATORS = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};

export function normalizePredicate(input) {
  if (input === null || typeof input !== "object") return { error: "predicate must be an object" };
  const metric = typeof input.metric === "string" ? input.metric.trim().toLowerCase() : "";
  const known = SUPPORTED_METRICS.find((entry) => entry.metric === metric);
  if (known === undefined) {
    return { error: `unknown metric '${metric}'; supported: ${SUPPORTED_METRICS.map((m) => m.metric).join(", ")}` };
  }
  const op = typeof input.op === "string" ? input.op.trim() : "";
  if (OPERATORS[op] === undefined) return { error: `op must be one of >, >=, <, <= (got '${op}')` };
  const value = Number(input.value);
  if (!Number.isFinite(value)) return { error: "value must be a finite number" };
  return { predicate: { metric: known.metric, op, value } };
}

export function currentMetricValue(metric, { technical, fundamental }) {
  if (metric === "price") return technical?.lastClose ?? null;
  if (metric === "rsi14") {
    const signal = technical?.signals?.find((entry) => entry.name === "rsi14");
    return signal ? Number(signal.value) : null;
  }
  const map = {
    pe: "peRatio",
    net_margin: "netMarginPct",
    revenue_growth: "revenueGrowthPct",
    eps_growth: "epsGrowthPct",
    fcf_yield: "fcfYieldPct",
    current_ratio: "currentRatio",
    dividend_yield: "dividendYieldPct",
  };
  const key = map[metric];
  if (key === undefined) return null;
  const value = fundamental?.metrics?.[key];
  return value === undefined || value === null ? null : Number(value);
}

/** Evaluate one thesis against current snapshots. */
export function evaluateThesis(thesis, current) {
  const checks = (thesis.citedMetrics ?? []).map((cited) => {
    const normalized = normalizePredicate(cited);
    if (normalized.error !== undefined) {
      return { metric: String(cited.metric ?? "?"), status: "invalid", detail: normalized.error };
    }
    const predicate = normalized.predicate;
    const actual = currentMetricValue(predicate.metric, current);
    if (actual === null) {
      return {
        metric: predicate.metric,
        status: "unavailable",
        detail: `current value for ${predicate.metric} is unavailable`,
        expectation: formatPredicate(predicate),
      };
    }
    const holds = OPERATORS[predicate.op](actual, predicate.value);
    return {
      metric: predicate.metric,
      status: holds ? "holds" : "broken",
      expectation: formatPredicate(predicate),
      actual,
      detail: holds
        ? `${predicate.metric} is ${actual} — expectation ${formatPredicate(predicate)} still holds`
        : `${predicate.metric} is ${actual}, expectation ${formatPredicate(predicate)} no longer holds`,
    };
  });
  const broken = checks.filter((check) => check.status === "broken");
  return {
    id: thesis.id,
    symbol: thesis.symbol,
    status: broken.length > 0 ? "broken" : checks.every((c) => c.status === "holds") ? "holds" : "partial",
    brokenCount: broken.length,
    checks,
    scannedAt: new Date().toISOString(),
  };
}

function formatPredicate(predicate) {
  return `${predicate.metric} ${predicate.op} ${predicate.value}`;
}

export function newThesis(input) {
  if (typeof input.symbol !== "string" || input.symbol.trim() === "") {
    return { error: "symbol is required" };
  }
  if (typeof input.thesis !== "string" || input.thesis.trim().length < 10) {
    return { error: "thesis text is required (at least 10 characters)" };
  }
  const predicates = [];
  for (const cited of input.citedMetrics ?? []) {
    const normalized = normalizePredicate(cited);
    if (normalized.error !== undefined) return { error: `citedMetrics: ${normalized.error}` };
    predicates.push(normalized.predicate);
  }
  return {
    thesis: {
      id: `thesis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      symbol: input.symbol.trim().toUpperCase(),
      openedAt: new Date().toISOString(),
      thesis: input.thesis.trim(),
      horizon: typeof input.horizon === "string" ? input.horizon.trim() : "long-term",
      exitConditions: typeof input.exitConditions === "string" ? input.exitConditions.trim() : "",
      citedMetrics: predicates,
      status: "open",
      lastScan: null,
    },
  };
}
