/**
 * Fundamental analysis over SEC EDGAR XBRL company facts. Extracts annual
 * (10-K) series for a resilient set of US-GAAP tags, derives ratios and
 * growth, and produces a scored snapshot comparable to the technical one.
 * Pure — the network fetch lives in edgar.mjs.
 */

const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
];
const NET_INCOME_TAGS = ["NetIncomeLoss", "ProfitLoss"];
const EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"];
const OCF_TAGS = [
  "NetCashProvidedByUsedInOperatingActivities",
  "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
];
const CAPEX_TAGS = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];
const CASH_TAGS = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"];
const DEBT_TAGS = ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"];
const CURRENT_ASSETS_TAGS = ["AssetsCurrent"];
const CURRENT_LIAB_TAGS = ["LiabilitiesCurrent"];
const DIVIDEND_TAGS = ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"];

/**
 * Annual series for one fact group: latest `years` fiscal years, preferring
 * 10-K filings and deduplicating by fiscal year.
 */
function annualSeries(facts, usGaapTags, years = 5) {
  if (!facts || typeof facts !== "object") return [];
  for (const tag of usGaapTags) {
    const fact = facts["us-gaap"]?.[tag];
    if (fact?.units?.USD === undefined && fact?.units?.["USD/shares"] === undefined) continue;
    const unitKey = fact.units.USD !== undefined ? "USD" : "USD/shares";
    const entries = fact.units[unitKey];
    const byYear = new Map();
    for (const entry of entries) {
      if (entry.form !== "10-K" && entry.form !== "10-K/A") continue;
      if (typeof entry.fy !== "number" || typeof entry.fp !== "string") continue;
      if (entry.fp !== "FY") continue;
      const durationYears = (entry.end && entry.start)
        ? (Date.parse(entry.end) - Date.parse(entry.start)) / (365.25 * 24 * 3600 * 1000)
        : 1;
      if (durationYears < 0.8) continue;
      const existing = byYear.get(entry.fy);
      const better = existing === undefined
        || (entry.frame !== undefined && existing.frame === undefined)
        || (entry.end ?? "") > (existing.end ?? "");
      if (better) byYear.set(entry.fy, entry);
    }
    const series = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, years)
      .map(([fy, entry]) => ({
        fy,
        end: entry.end,
        value: Number(entry.val),
      }));
    if (series.length > 0) return series;
  }
  return [];
}

function latest(facts, tags, { asOfYearsAgo = 0 } = {}) {
  const series = annualSeries(facts, tags);
  return series[asOfYearsAgo] ?? null;
}

function growth(series) {
  if (series.length < 2) return null;
  const [current, previous] = series;
  if (!previous.value) return null;
  return ((current.value - previous.value) / Math.abs(previous.value)) * 100;
}

function cagr(series) {
  if (series.length < 2) return null;
  const newest = series[0];
  const oldest = series[series.length - 1];
  const years = newest.fy - oldest.fy;
  if (years <= 0 || oldest.value <= 0 || newest.value <= 0) return null;
  return (Math.pow(newest.value / oldest.value, 1 / years) - 1) * 100;
}

/**
 * Build the fundamental snapshot. `sharesOutstanding` (from EDGAR entity
 * data) and `price` (latest close) refine per-share and valuation metrics.
 */
export function fundamentalSnapshot(facts, { price = null, sharesOutstanding = null } = {}) {
  const revenue = annualSeries(facts, REVENUE_TAGS);
  const netIncome = annualSeries(facts, NET_INCOME_TAGS);
  const eps = annualSeries(facts, EPS_TAGS);
  const ocf = annualSeries(facts, OCF_TAGS);
  const capex = annualSeries(facts, CAPEX_TAGS);
  const cash = latest(facts, CASH_TAGS);
  const debt = latest(facts, DEBT_TAGS);
  const currentAssets = latest(facts, CURRENT_ASSETS_TAGS);
  const currentLiabilities = latest(facts, CURRENT_LIAB_TAGS);
  const dividendsPerShare = latest(facts, DIVIDEND_TAGS);

  const revenueLatest = revenue[0]?.value ?? null;
  const netIncomeLatest = netIncome[0]?.value ?? null;
  const netMargin = revenueLatest && netIncomeLatest !== null
    ? (netIncomeLatest / revenueLatest) * 100
    : null;
  const netMarginPrior = revenue[1]?.value && netIncome[1]?.value !== null
    ? (netIncome[1].value / revenue[1].value) * 100
    : null;
  const revenueGrowth = growth(revenue);
  const revenueCagr = cagr(revenue);
  const epsLatest = eps[0]?.value ?? null;
  const epsGrowth = growth(eps);
  const fcf = ocf[0]?.value != null && capex[0]?.value != null
    ? ocf[0].value - capex[0].value
    : ocf[0]?.value ?? null;
  const currentRatio = currentAssets?.value != null && currentLiabilities?.value != null
    ? currentAssets.value / currentLiabilities.value
    : null;
  const dilutedShares = sharesOutstanding ?? null;
  const marketCap = price !== null && dilutedShares !== null ? price * dilutedShares : null;
  const peRatio = price !== null && epsLatest !== null && epsLatest > 0 ? price / epsLatest : null;
  const psRatio = marketCap !== null && revenueLatest ? marketCap / revenueLatest : null;
  const dividendYield = price !== null && dividendsPerShare?.value ? (dividendsPerShare.value / price) * 100 : null;
  const fcfYield = marketCap !== null && fcf !== null && marketCap > 0 ? (fcf / marketCap) * 100 : null;

  const metrics = {
    fiscalYear: revenue[0]?.fy ?? netIncome[0]?.fy ?? null,
    periodEnd: revenue[0]?.end ?? netIncome[0]?.end ?? null,
    revenueUsd: revenueLatest,
    revenueGrowthPct: round2(revenueGrowth),
    revenueCagrPct: round2(revenueCagr),
    netIncomeUsd: netIncomeLatest,
    netMarginPct: round2(netMargin),
    netMarginTrendPct: netMargin !== null && netMarginPrior !== null ? round2(netMargin - netMarginPrior) : null,
    epsDiluted: epsLatest,
    epsGrowthPct: round2(epsGrowth),
    fcfUsd: fcf,
    fcfYieldPct: round2(fcfYield),
    cashUsd: cash?.value ?? null,
    debtUsd: debt?.value ?? null,
    currentRatio: round2(currentRatio),
    peRatio: round2(peRatio),
    psRatio: round2(psRatio),
    marketCapUsd: marketCap,
    dividendYieldPct: round2(dividendYield),
    sharesOutstanding: dilutedShares,
  };

  const signals = [];
  const add = (name, value, verdict, reason) => signals.push({ name, value, verdict, reason });

  if (revenueGrowth !== null) {
    const verdict = revenueGrowth > 8 ? 1 : revenueGrowth < 0 ? -1 : 0;
    add(
      "revenue_growth",
      `${round2(revenueGrowth)}%`,
      verdict,
      revenueGrowth > 8
        ? `revenue grew ${round2(revenueGrowth)}% YoY`
        : revenueGrowth < 0
          ? `revenue shrank ${round2(Math.abs(revenueGrowth))}% YoY`
          : `revenue growth is flat at ${round2(revenueGrowth)}% YoY`,
    );
  }
  if (netMargin !== null) {
    const verdict = netMargin > 15 ? 1 : netMargin < 0 ? -1 : 0;
    add(
      "net_margin",
      `${round2(netMargin)}%`,
      verdict,
      netMargin > 15
        ? `net margin is strong at ${round2(netMargin)}%`
        : netMargin < 0
          ? `the company is loss-making (net margin ${round2(netMargin)}%)`
          : `net margin is thin at ${round2(netMargin)}%`,
    );
  }
  if (metrics.netMarginTrendPct !== null) {
    const verdict = metrics.netMarginTrendPct > 0.5 ? 1 : metrics.netMarginTrendPct < -0.5 ? -1 : 0;
    add(
      "margin_trend",
      `${metrics.netMarginTrendPct > 0 ? "+" : ""}${metrics.netMarginTrendPct}pp`,
      verdict,
      `net margin moved ${metrics.netMarginTrendPct > 0 ? "up" : "down"} ${Math.abs(metrics.netMarginTrendPct)}pp vs the prior year`,
    );
  }
  if (epsGrowth !== null) {
    const verdict = epsGrowth > 10 ? 1 : epsGrowth < 0 ? -1 : 0;
    add(
      "eps_growth",
      `${round2(epsGrowth)}%`,
      verdict,
      `diluted EPS moved ${round2(epsGrowth)}% YoY`,
    );
  }
  if (fcf !== null) {
    const verdict = fcf > 0 ? 1 : -1;
    add(
      "fcf",
      formatUsd(fcf),
      verdict,
      fcf > 0 ? `free cash flow is positive at ${formatUsd(fcf)}` : `free cash flow is negative (${formatUsd(fcf)})`,
    );
  }
  if (currentRatio !== null) {
    const verdict = currentRatio >= 1.5 ? 1 : currentRatio < 1 ? -1 : 0;
    add(
      "current_ratio",
      round2(currentRatio),
      verdict,
      currentRatio < 1
        ? `current ratio ${round2(currentRatio)} below 1.0: short-term liabilities exceed liquid assets`
        : `current ratio is ${round2(currentRatio)}`,
    );
  }
  if (peRatio !== null) {
    const verdict = peRatio > 45 ? -1 : peRatio < 15 ? 1 : 0;
    add(
      "pe",
      round2(peRatio),
      verdict,
      peRatio > 45
        ? `P/E of ${round2(peRatio)} is demanding`
        : peRatio < 15
          ? `P/E of ${round2(peRatio)} is modest`
          : `P/E of ${round2(peRatio)} is mid-range`,
    );
  }

  const score = signals.length === 0
    ? 50
    : Math.round(((signals.reduce((a, s) => a + s.verdict, 0) / signals.length) + 1) * 50);

  return {
    metrics,
    score,
    signals,
    series: {
      revenue: revenue.map((entry) => ({ fy: entry.fy, value: entry.value })).reverse(),
      netIncome: netIncome.map((entry) => ({ fy: entry.fy, value: entry.value })).reverse(),
      eps: eps.map((entry) => ({ fy: entry.fy, value: entry.value })).reverse(),
    },
  };
}

export function formatUsd(value) {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function round2(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}
