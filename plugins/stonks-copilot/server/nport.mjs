/**
 * SEC N-PORT XML parsing. Registered funds file their complete holdings
 * quarterly in N-PORT primary documents; parsing them locally is what lets
 * the X-Ray compute real fund overlap with zero API keys. Pure — no I/O.
 */

/**
 * Extract fund name and holdings from an N-PORT primary document.
 * Returns { fundName, holdings: [{ name, cusip, usValue }] } with entries
 * sorted by value descending; `weight` fields are added by the caller once
 * the total is known (see holdingsWithWeights).
 */
export function parseNportXml(xml) {
  if (typeof xml !== "string" || xml.length === 0) return null;
  const nameMatch = xml.match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/u);
  const blocks = [];
  const invstOrSec = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/gu;
  let match;
  while ((match = invstOrSec.exec(xml)) !== null) {
    const block = match[1];
    const name = textTag(block, "name");
    const title = textTag(block, "title");
    const cusip = textTag(block, "cusip");
    const balance = numberTag(block, "balance");
    const curVal = numberTag(block, "curVal");
    if (name === null && title === null) continue;
    const usValue = curVal ?? balance;
    if (usValue === null) continue;
    blocks.push({
      name: clean(name ?? title),
      cusip: clean(cusip),
      usValue,
    });
  }
  if (blocks.length === 0) return null;
  blocks.sort((a, b) => b.usValue - a.usValue);
  return {
    fundName: nameMatch ? clean(nameMatch[1]) : null,
    holdings: blocks,
  };
}

/** Attach normalized weights and resolve fund share lines to symbols. */
export function holdingsWithWeights(parsed, { maxHoldings = 400 } = {}) {
  if (parsed === null) return null;
  const total = parsed.holdings.reduce((a, holding) => a + holding.usValue, 0);
  if (total <= 0) return null;
  return {
    fundName: parsed.fundName,
    totalUsValue: Math.round(total),
    holdingsCount: parsed.holdings.length,
    holdings: parsed.holdings.slice(0, maxHoldings).map((holding) => ({
      symbol: holdingSymbol(holding),
      name: holding.name,
      usValue: Math.round(holding.usValue),
      weight: holding.usValue / total,
    })),
  };
}

/**
 * Best-effort ticker from an N-PORT holding line: registered funds report
 * `<title>` as "TICKER - Company Name" for equities. CUSIP-only rows keep
 * the name as identity.
 */
function holdingSymbol(holding) {
  const dash = holding.name.split(/\s+-\s+/u)[0];
  if (/^[A-Z]{1,6}(?:\.[A-Z]{1,2})?$/u.test(dash)) return dash;
  return null;
}

function textTag(block, tag) {
  const match = block.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "u"),
  );
  return match ? match[1] : null;
}

function numberTag(block, tag) {
  const text = textTag(block, tag);
  if (text === null) return null;
  const value = Number(text.trim().replace(/,/gu, ""));
  return Number.isFinite(value) ? value : null;
}

function clean(value) {
  return String(value)
    .replace(/&#xA;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}
