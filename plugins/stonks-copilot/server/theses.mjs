/**
 * Investment decision journal. A thesis records why a position was taken
 * plus quantified predicates ("cited metrics") extracted from the user's
 * own words. Surveillance re-evaluates those predicates against current
 * data: a thesis-break is when the reason you gave no longer holds -
 * independent of what the price is doing. Pure - persistence lives in
 * stores.mjs.
 */

export const SUPPORTED_METRICS = [
  { metric: "price", source: "technical", unit: "usd", description: "latest daily close" },
  { metric: "pe", source: "fundamental", unit: "ratio", description: "price / diluted EPS (latest fiscal year, not TTM)" },
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
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { error: "predicate must be an object" };
  const metric = typeof input.metric === "string" ? input.metric.trim().toLowerCase() : "";
  const known = SUPPORTED_METRICS.find((entry) => entry.metric === metric);
  if (known === undefined) {
    return { error: `unknown metric '${metric}'; supported: ${SUPPORTED_METRICS.map((m) => m.metric).join(", ")}` };
  }
  const op = typeof input.op === "string" ? input.op.trim() : "";
  if (!Object.hasOwn(OPERATORS, op)) return { error: `op must be one of >, >=, <, <= (got '${op}')` };
  const value = input.value;
  if (!Number.isFinite(value)) return { error: "value must be a finite number" };
  return { predicate: { metric: known.metric, op, value } };
}

export function currentMetricValue(metric, { technical, fundamental } = {}) {
  if (metric === "price") return finiteMetric(technical?.lastClose);
  if (metric === "rsi14") {
    const signal = technical?.signals?.find((entry) => entry.name === "rsi14");
    return finiteMetric(signal?.value);
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
  const key = Object.hasOwn(map, metric) ? map[metric] : undefined;
  if (key === undefined) return null;
  const value = fundamental?.metrics?.[key];
  return finiteMetric(value);
}

function finiteMetric(value) {
  if (value === null || value === undefined || (typeof value !== "number" && typeof value !== "string")
      || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Evaluate one thesis against current snapshots. */
export function evaluateThesis(thesis, current) {
  const checks = (Array.isArray(thesis.citedMetrics) ? thesis.citedMetrics : []).map((cited) => {
    const normalized = normalizePredicate(cited);
    if (normalized.error !== undefined) {
      return { metric: String(cited?.metric ?? "?"), status: "invalid", detail: normalized.error };
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
        ? `${predicate.metric} is ${actual} - expectation ${formatPredicate(predicate)} still holds`
        : `${predicate.metric} is ${actual}, expectation ${formatPredicate(predicate)} no longer holds`,
    };
  });
  const broken = checks.filter((check) => check.status === "broken");
  return {
    id: thesis.id,
    symbol: thesis.symbol,
    status: broken.length > 0 ? "broken" : checks.length > 0 && checks.every((c) => c.status === "holds") ? "holds" : "partial",
    brokenCount: broken.length,
    checks,
    scannedAt: new Date().toISOString(),
  };
}

function formatPredicate(predicate) {
  return `${predicate.metric} ${predicate.op} ${predicate.value}`;
}

export function newThesis(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { error: "thesis input must be an object" };
  if (typeof input.symbol !== "string" || !/^[A-Z][A-Z0-9.-]{0,11}$/u.test(input.symbol.trim().toUpperCase())) {
    return { error: "symbol must be a ticker of 1-12 letters, digits, dots or hyphens" };
  }
  if (typeof input.thesis !== "string" || input.thesis.trim().length < 10 || input.thesis.length > 10000) {
    return { error: "thesis text is required (10-10000 characters)" };
  }
  if (!Array.isArray(input.citedMetrics) || input.citedMetrics.length < 1 || input.citedMetrics.length > 32) {
    return { error: "citedMetrics must contain 1-32 predicates" };
  }
  if ((input.horizon !== undefined && (typeof input.horizon !== "string" || input.horizon.length > 256))
      || (input.exitConditions !== undefined && (typeof input.exitConditions !== "string" || input.exitConditions.length > 10000))) {
    return { error: "horizon and exitConditions must be strings within their length limits" };
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
