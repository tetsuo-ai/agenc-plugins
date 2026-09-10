/**
 * Fundamental analysis over SEC EDGAR XBRL company facts. Extracts annual
 * (10-K) series for a resilient set of US-GAAP tags, derives ratios and
 * growth, and produces a scored snapshot comparable to the technical one.
 * Pure - the network fetch lives in edgar.mjs.
 */

const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
];
const NET_INCOME_TAGS = ["NetIncomeLoss", "ProfitLoss"];
const EPS_TAGS = ["EarningsPerShareDiluted"];
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
function annualSeries(facts, usGaapTags, years = 5, { instant = false } = {}) {
  if (!facts || typeof facts !== "object") return [];
  const byEnd = new Map();
  const latestEndByFilingYear = new Map();
  for (const tag of usGaapTags) {
    const fact = facts["us-gaap"]?.[tag];
    if (fact?.units?.USD === undefined && fact?.units?.["USD/shares"] === undefined) continue;
    const unitKey = fact.units.USD !== undefined ? "USD" : "USD/shares";
    const entries = fact.units[unitKey];
    const byPeriod = new Map();
    for (const entry of entries) {
      if (entry.form !== "10-K" && entry.form !== "10-K/A") continue;
      if (!Number.isInteger(entry.fy) || !Number.isFinite(entry.val) || !Number.isFinite(Date.parse(entry.end))) continue;
      if (entry.fp !== "FY") continue;
      const days = (Date.parse(entry.end) - Date.parse(entry.start)) / 86400000;
      if (!instant && (!Number.isFinite(days) || days < 300 || days > 400)) continue;
      latestEndByFilingYear.set(entry.fy, Math.max(latestEndByFilingYear.get(entry.fy) ?? -Infinity, Date.parse(entry.end)));
      const existing = byPeriod.get(entry.end);
      // `fy` is the filing's fiscal year, including comparative facts. The
      // reporting period identifies the observation; the latest filing
      // supplies restated values without inventing additional fiscal years.
      const fy = Math.min(existing?.fy ?? entry.fy, entry.fy);
      if (!existing || (entry.filed ?? "") >= (existing.filed ?? "")) {
        byPeriod.set(entry.end, { ...entry, fy, tag });
      } else existing.fy = fy;
    }
    for (const [end, entry] of byPeriod) if (!byEnd.has(end)) byEnd.set(end, entry);
  }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, years)
    .map((entry) => ({
      fy: entry.fy - Math.round((latestEndByFilingYear.get(entry.fy) - Date.parse(entry.end)) / (365.25 * 86400000)),
      start: entry.start, end: entry.end, value: entry.val, tag: entry.tag,
    }));
}

function latest(facts, tags, { asOfYearsAgo = 0 } = {}) {
  const series = annualSeries(facts, tags, 5, { instant: true });
  return series[asOfYearsAgo] ?? null;
}

function growth(series) {
  if (series.length < 2) return null;
  const [current, previous] = series;
  const days = (Date.parse(current.end) - Date.parse(previous.end)) / 86400000;
  if (!previous.value || days < 300 || days > 400) return null;
  return ((current.value - previous.value) / Math.abs(previous.value)) * 100;
}

function cagr(series) {
  if (series.length < 2) return null;
  const newest = series[0];
  const oldest = series[series.length - 1];
  const years = (Date.parse(newest.end) - Date.parse(oldest.end)) / (365.25 * 86400000);
  if (years <= 0 || oldest.value <= 0 || newest.value <= 0) return null;
  return (Math.pow(newest.value / oldest.value, 1 / years) - 1) * 100;
}

/**
 * Build the fundamental snapshot. `sharesOutstanding` (from EDGAR entity
 * data) and `price` (latest close) refine per-share and valuation metrics.
 */
export function fundamentalSnapshot(facts, { price = null, sharesOutstanding = null, now = Date.now() } = {}) {
  facts = facts?.facts ?? facts;
  price = Number.isFinite(price) && price > 0 ? price : null;
  sharesOutstanding = Number.isFinite(sharesOutstanding) && sharesOutstanding > 0 ? sharesOutstanding : null;
  const revenue = annualSeries(facts, REVENUE_TAGS);
  const netIncome = annualSeries(facts, NET_INCOME_TAGS);
  const eps = annualSeries(facts, EPS_TAGS);
  const ocf = annualSeries(facts, OCF_TAGS);
  const capex = annualSeries(facts, CAPEX_TAGS);
  const cash = latest(facts, CASH_TAGS);
  const debt = latest(facts, DEBT_TAGS);
  const currentAssets = latest(facts, CURRENT_ASSETS_TAGS);
  const currentLiabilities = latest(facts, CURRENT_LIAB_TAGS);
  const dividendsPerShare = annualSeries(facts, DIVIDEND_TAGS)[0] ?? null;

  const revenueLatest = revenue[0]?.value ?? null;
  const netIncomeLatest = netIncome[0]?.value ?? null;
  const netMargin = revenueLatest > 0 && netIncomeLatest !== null && revenue[0]?.end === netIncome[0]?.end
    ? (netIncomeLatest / revenueLatest) * 100
    : null;
  const revenueGapDays = (Date.parse(revenue[0]?.end) - Date.parse(revenue[1]?.end)) / 86400000;
  const netMarginPrior = revenue[1]?.value > 0 && netIncome[1]?.value != null && revenue[1]?.end === netIncome[1]?.end
    && revenueGapDays >= 300 && revenueGapDays <= 400
    ? (netIncome[1].value / revenue[1].value) * 100
    : null;
  const revenueGrowth = growth(revenue);
  const revenueCagr = cagr(revenue);
  const epsLatest = eps[0]?.value ?? null;
  const epsGrowth = growth(eps);
  const fcf = ocf[0]?.value != null && capex[0]?.value != null && ocf[0].end === capex[0].end
    ? ocf[0].value - capex[0].value
    : null;
  const currentRatio = currentAssets?.value != null && currentLiabilities?.value > 0 && currentAssets.end === currentLiabilities.end
    ? currentAssets.value / currentLiabilities.value
    : null;
  const dilutedShares = sharesOutstanding ?? null;
  const marketCap = price !== null && dilutedShares !== null ? price * dilutedShares : null;
  const peRatio = price !== null && epsLatest !== null && epsLatest > 0 ? price / epsLatest : null;
  const psRatio = marketCap !== null && revenueLatest > 0 ? marketCap / revenueLatest : null;
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
    available: [revenueLatest, netIncomeLatest, epsLatest, ocf[0]?.value, cash?.value].some(Number.isFinite),
    basis: "annual 10-K financials; valuation ratios use annual earnings, not trailing twelve months",
    metricPeriods: { revenue: revenue[0]?.end ?? null, netIncome: netIncome[0]?.end ?? null, eps: eps[0]?.end ?? null, cashFlow: ocf[0]?.end ?? null, balanceSheet: cash?.end ?? currentAssets?.end ?? null },
    warnings: [
      ...(metrics.periodEnd && now - Date.parse(metrics.periodEnd) > 550 * 86400000 ? ["Latest available annual financial period is more than 550 days old."] : []),
      ...(ocf.length > 0 && fcf === null ? ["Free cash flow unavailable: matching annual capital expenditures were not reported."] : []),
      ...(debt ? ["debtUsd is reported long-term debt and may exclude current maturities and short-term borrowings."] : []),
    ],
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
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
