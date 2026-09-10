/**
 * SEC EDGAR client: ticker→CIK resolution, XBRL company facts for
 * fundamentals, and N-PORT fund holdings - all public, keyless endpoints
 * behind the shared TTL cache. SEC asks for a descriptive User-Agent;
 * keep the default honest rather than spoofing a browser.
 */
import { parseNportXml, holdingsWithWeights } from "./nport.mjs";
import { fundamentalSnapshot } from "./fundamentals.mjs";
import { TTL } from "./cache.mjs";
import { fetchPublic } from "./http.mjs";

const UA_DEFAULT = "tetsuo-ai stonks-copilot plugin (+https://github.com/tetsuo-ai/agenc-plugins)";

export function makeEdgar({ cache, fetchImpl = globalThis.fetch, userAgent = UA_DEFAULT } = {}) {
  const headers = { "user-agent": userAgent, "accept-encoding": "gzip" };
  let lastRequest = 0;
  async function request(url, options = {}) {
    const wait = 125 - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    return fetchPublic(url, { fetchImpl, headers, allowNotFound: true, ...options });
  }

  async function fetchJson(url, ttl) {
    const cacheKey = `edgar-${url}`;
    const cached = cache?.get(cacheKey, ttl);
    if (cached != null) return cached;
    const value = await request(url);
    if (value === null) return null;
    cache?.set(cacheKey, value);
    return value;
  }

  async function fetchText(url) {
    return request(url, { format: "text" });
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
      const latest = [...dei].filter((entry) => Number.isFinite(entry.val) && entry.val > 0 && Number.isFinite(Date.parse(entry.end)))
        .sort((a, b) => (b.end ?? "").localeCompare(a.end ?? "") || (b.filed ?? "").localeCompare(a.filed ?? ""))[0];
      if (!latest) return null;
      const value = Number(latest.val);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }

  async function fundamentalsSnapshot(symbol, { price = null } = {}) {
    const company = await companyfacts(symbol);
    if (company === null) return null;
    const snapshot = fundamentalSnapshot(company.facts, { price, sharesOutstanding: company.sharesOutstanding });
    if (!snapshot.available) return null;
    return {
      cik: company.cik,
      title: company.title,
      ...snapshot,
    };
  }

  /** Latest N-PORT holdings for a registered fund, as weighted symbols. */
  async function fundHoldings(fundSymbol) {
    const map = await fetchJson("https://www.sec.gov/files/company_tickers_mf.json", TTL.TICKER_MAP);
    const fields = map?.fields;
    const row = Array.isArray(fields) && Array.isArray(map?.data)
      ? map.data.find((entry) => String(entry[fields.indexOf("symbol")]).toUpperCase() === String(fundSymbol).trim().toUpperCase())
      : null;
    const cikNumber = row?.[fields.indexOf("cik")];
    const seriesId = row?.[fields.indexOf("seriesId")];
    const resolved = /^\d{1,10}$/u.test(String(cikNumber)) && /^S\d+$/u.test(seriesId ?? "")
      ? { cikNumber: Number(cikNumber), cik: String(cikNumber).padStart(10, "0"), seriesId } : null;
    if (resolved === null) return null;
    const cacheKey = `nport-v2-${resolved.cik}-${resolved.seriesId}`;
    const cached = cache?.get(cacheKey, TTL.NPORT);
    if (cached != null) return cached;
    const submissions = await fetchJson(
      `https://data.sec.gov/submissions/CIK${resolved.cik}.json`,
      TTL.NPORT,
    );
    if (submissions === null) return null;
    const recent = submissions.filings?.recent;
    if (!Array.isArray(recent?.form)) return null;
    let fetched = 0;
    let best = null;
    for (let i = 0; i < recent.form.length && fetched < 20; i += 1) {
      if (!["NPORT-P", "NPORT-P/A"].includes(recent.form[i])) continue;
      const accession = recent.accessionNumber[i];
      const primaryPath = recent.primaryDocument[i];
      if (!/^\d{10}-\d{2}-\d{6}$/u.test(accession ?? "") || !/^(?:xsl[\w.-]+\/)?[\w.-]+\.xml$/u.test(primaryPath ?? "")) continue;
      const primary = primaryPath.split("/").at(-1);
      const noDash = accession.replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${resolved.cikNumber}/${noDash}/${primary}`;
      const xml = await fetchText(url);
      fetched += 1;
      if (xml === null) continue;
      const parsed = parseNportXml(xml);
      if (parsed?.seriesId !== resolved.seriesId) continue;
      const weighted = holdingsWithWeights(parsed);
      if (weighted !== null) {
        weighted.sourceUrl = url;
        weighted.filingDate = recent.filingDate?.[i] ?? null;
        if (!best || (weighted.asOf ?? "") > (best.asOf ?? "")
          || weighted.asOf === best.asOf && (weighted.filingDate ?? "") > (best.filingDate ?? "")) best = weighted;
      }
    }
    if (best) {
      best.searchScope = "newest reporting period found among up to 20 recent public N-PORT filings; older submission archives are not searched";
      cache?.set(cacheKey, best);
    }
    return best;
  }

  return { tickerToCik, companyfacts, fundamentalsSnapshot, fundHoldings };
}
