/** Read the published N-PORT dollar valuations, fund identity and period. */
export function parseNportXml(xml) {
  if (typeof xml !== "string" || !xml || /<!DOCTYPE|<!ENTITY/iu.test(xml)) return null;
  const holdings = [];
  const invstOrSec = /<(?:[\w.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?invstOrSec\s*>/gu;
  let match;
  let omitted = 0;
  while ((match = invstOrSec.exec(xml)) !== null) {
    const block = match[1];
    const name = textTag(block, "name") ?? textTag(block, "title");
    // balance is a quantity, and curVal can be foreign currency. Only
    // valUSD is the SEC's dollar valuation (N-PORT item C.2.c).
    const usValue = numberTag(block, "valUSD");
    if (!name || usValue === null) { omitted += 1; continue; }
    const identifiers = textTag(block, "identifiers") ?? "";
    const ticker = identifiers.match(/<(?:[\w.-]+:)?ticker\b[^>]*\bvalue\s*=\s*["']([^"']+)["']/u)?.[1]
      ?? textTag(identifiers, "ticker");
    const derivative = /<(?:[\w.-]+:)?(?:derivativeInfo|derivInfo)\b/u.test(block);
    const symbol = clean(ticker)?.toUpperCase();
    holdings.push({
      name: clean(name),
      cusip: clean(textTag(block, "cusip")),
      symbol: !derivative && /^[A-Z][A-Z0-9.-]{0,11}$/u.test(symbol ?? "") ? symbol : null,
      usValue,
      derivative,
    });
  }
  if (holdings.length === 0) return null;
  const genInfo = textTag(xml, "genInfo") ?? "";
  return {
    fundName: clean(textTag(genInfo, "seriesName") ?? textTag(genInfo, "regName")),
    seriesId: clean(textTag(genInfo, "seriesId") ?? textTag(xml, "seriesId")),
    asOf: clean(textTag(genInfo, "repPdDate")),
    netAssets: numberTag(textTag(xml, "fundInfo") ?? "", "netAssets"),
    omittedHoldings: omitted,
    holdings: holdings.sort((a, b) => b.usValue - a.usValue),
  };
}

export function holdingsWithWeights(parsed, { maxHoldings = 400, now = Date.now() } = {}) {
  if (!parsed?.holdings?.length) return null;
  const total = parsed.holdings.reduce((sum, holding) => sum + holding.usValue, 0);
  const denominator = parsed.netAssets > 0 ? parsed.netAssets : total;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const holdings = parsed.holdings.slice(0, maxHoldings).map((holding) => ({
    ...holding,
    weight: holding.usValue / denominator,
  }));
  return {
    fundName: parsed.fundName,
    seriesId: parsed.seriesId,
    asOf: parsed.asOf,
    totalUsValue: total,
    netAssetsUsd: parsed.netAssets,
    weightBasis: parsed.netAssets > 0 ? "reported net assets" : "sum of disclosed investment dollar values; net assets unavailable",
    holdingsCount: parsed.holdings.length,
    omittedHoldings: parsed.omittedHoldings ?? 0,
    returnedHoldingsCount: holdings.length,
    coverageWeight: holdings.reduce((sum, holding) => sum + holding.weight, 0),
    warnings: [
      ...(!parsed.asOf ? ["Filing reporting date unavailable."] : now - Date.parse(parsed.asOf) > 180 * 86400000 ? ["Holdings reporting period is more than 180 days old."] : []),
      ...(parsed.omittedHoldings ? [`${parsed.omittedHoldings} holdings omitted because dollar valuations were unavailable.`] : []),
      ...(holdings.length < parsed.holdings.length ? [`Only ${holdings.length} of ${parsed.holdings.length} holdings returned; weights are not renormalized.`] : []),
      ...(parsed.holdings.some((holding) => holding.derivative || holding.usValue < 0) ? ["Derivative or short positions are present; market-value weights do not describe economic exposure."] : []),
    ],
    holdings,
  };
}

function textTag(block, tag) {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}\\s*>`, "u"));
  return match ? match[1].replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/u, "$1") : null;
}

function numberTag(block, tag) {
  const text = textTag(block, tag);
  if (text === null || !text.trim()) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : null;
}

function clean(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/&#(?:x([0-9a-f]+)|(\d+));/giu, (_, hex, decimal) => {
    const code = parseInt(hex ?? decimal, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }).replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
}
