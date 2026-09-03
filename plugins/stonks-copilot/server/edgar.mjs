/**
 * SEC EDGAR client: ticker→CIK resolution, XBRL company facts for
 * fundamentals, and N-PORT fund holdings — all public, keyless endpoints
 * behind the shared TTL cache. SEC asks for a descriptive User-Agent;
 * keep the default honest rather than spoofing a browser.
 */
import { parseNportXml, holdingsWithWeights } from "./nport.mjs";
import { fundamentalSnapshot } from "./fundamentals.mjs";
import { TTL } from "./cache.mjs";

const UA_DEFAULT = "tetsuo-ai stonks-copilot plugin (+https://github.com/tetsuo-ai/agenc-plugins)";

export function makeEdgar({ cache, fetchImpl = globalThis.fetch, userAgent = UA_DEFAULT } = {}) {
  const headers = { "user-agent": userAgent, "accept-encoding": "gzip" };

  async function fetchJson(url, ttl) {
    const cacheKey = `edgar-${url}`;
    const cached = cache?.get(cacheKey, ttl);
    if (cached !== null) return cached;
    const response = await fetchImpl(url, { headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`EDGAR request failed: HTTP ${response.status} for ${url}`);
    const value = await response.json();
    cache?.set(cacheKey, value);
    return value;
  }

  async function fetchText(url) {
    const response = await fetchImpl(url, { headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`EDGAR request failed: HTTP ${response.status} for ${url}`);
    return await response.text();
  }

  async function tickerToCik(ticker) {
    const map = await fetchJson("https://www.sec.gov/files/company_tickers.json", TTL.TICKER_MAP);
    if (map === null) throw new Error("ticker map unavailable");
    const wanted = String(ticker).trim().toUpperCase();
    for (const entry of Object.values(map)) {
      if (String(entry.ticker).toUpperCase() === wanted) {
        return { cik: String(entry.cik_str).padStart(10, "0"), title: entry.title, cikNumber: entry.cik_str };
      }
    }
    return null;
  }

  async function companyfacts(symbol) {
    const resolved = await tickerToCik(symbol);
    if (resolved === null) return null;
    const facts = await fetchJson(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${resolved.cik}.json`,
      TTL.FUNDAMENTALS,
    );
    if (facts === null) return null;
    const shares = extractSharesOutstanding(facts);
    return { cik: resolved.cik, title: resolved.title, facts, sharesOutstanding: shares };
  }

  function extractSharesOutstanding(facts) {
    const dei = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
    if (Array.isArray(dei) && dei.length > 0) {
      const latest = [...dei].sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""))[0];
      const value = Number(latest.val);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }

  async function fundamentalsSnapshot(symbol, { price = null } = {}) {
    const company = await companyfacts(symbol);
    if (company === null) return null;
    return {
      cik: company.cik,
      title: company.title,
      ...fundamentalSnapshot(company.facts, { price, sharesOutstanding: company.sharesOutstanding }),
    };
  }

  /** Latest N-PORT holdings for a registered fund, as weighted symbols. */
  async function fundHoldings(fundSymbol) {
    const resolved = await tickerToCik(fundSymbol);
    if (resolved === null) return null;
    const cacheKey = `nport-${resolved.cik}`;
    const cached = cache?.get(cacheKey, TTL.NPORT);
    if (cached !== null) return cached;
    const submissions = await fetchJson(
      `https://data.sec.gov/submissions/CIK${resolved.cik}.json`,
      TTL.NPORT,
    );
    if (submissions === null) return null;
    const recent = submissions.filings?.recent;
    if (recent === undefined) return null;
    for (let i = 0; i < Math.min(recent.form.length, 200); i += 1) {
      if (recent.form[i] !== "N-PORT-P") continue;
      const accession = recent.accessionNumber[i];
      const primary = recent.primaryDocument[i];
      const noDash = accession.replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${resolved.cikNumber}/${noDash}/${primary}`;
      const xml = await fetchText(url);
      if (xml === null) continue;
      const weighted = holdingsWithWeights(parseNportXml(xml));
      if (weighted !== null) {
        cache?.set(cacheKey, weighted);
        return weighted;
      }
    }
    return null;
  }

  return { tickerToCik, companyfacts, fundamentalsSnapshot, fundHoldings };
}
