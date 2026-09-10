/**
 * Compact date extraction for email bodies - the same Spanish/English
 * engine used by paper-radar, reduced to what deadlines in prose need:
 * absolute dates in both languages plus d/m/y numerics with Spanish bias.
 * Pure, no I/O.
 */

const MONTH_NAME_TO_NUMBER = new Map(
  [
    ["enero", 1], ["febrero", 2], ["marzo", 3], ["abril", 4], ["mayo", 5], ["junio", 6],
    ["julio", 7], ["agosto", 8], ["septiembre", 9], ["setiembre", 9], ["octubre", 10],
    ["noviembre", 11], ["diciembre", 12],
    ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
    ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
    ["ene", 1], ["feb", 2], ["mar", 3], ["abr", 4], ["jun", 6], ["jul", 7], ["ago", 8],
    ["sep", 9], ["set", 9], ["oct", 10], ["nov", 11], ["dic", 12],
    ["jan", 1], ["apr", 4], ["aug", 8], ["dec", 12],
  ].map(([name, month]) => [name, month]),
);

export function extractDates(text) {
  const spanishBias = /\b(?:de|del|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/iu.test(text);
  const found = [];
  const push = (match, iso) => {
    found.push({
      match: match[0],
      iso,
      index: match.index ?? 0,
      context: contextAround(text, match.index ?? 0, 60),
    });
  };
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)) {
    push(match, isoFrom(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+\.?)(?:\s+de\s+(\d{2,4}))?/giu)) {
    const month = monthNumber(match[2]);
    if (month === null) continue;
    const year = match[3] !== undefined ? resolveYear(match[3]) : defaultYear(month.month);
    push(match, isoFrom(year, month, Number(match[1])));
  }
  for (const match of text.matchAll(/\b([a-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?/giu)) {
    const month = monthNumber(match[1]);
    if (month === null) continue;
    const year = match[3] !== undefined ? resolveYear(match[3]) : defaultYear(month.month);
    push(match, isoFrom(year, month, Number(match[2])));
  }
  for (const match of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/gu)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = resolveYear(match[3]);
    let day;
    let month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else if (spanishBias) { day = a; month = b; }
    else { day = b; month = a; }
    push(match, isoFrom(year, month, day));
  }
  const seen = new Set();
  return found.filter((entry) => {
    if (entry.iso === null) return false;
    const key = `${entry.match}|${entry.iso}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function monthNumber(name) {
  const month = MONTH_NAME_TO_NUMBER.get(name.toLowerCase().replace(/\.$/u, ""));
  return month === undefined ? null : month;
}

function resolveYear(raw) {
  const year = Number(raw);
  return year >= 1000 ? year : 2000 + year;
}

function defaultYear(month) {
  const now = new Date();
  // Future-bias: a bare "15 de octubre" most likely means the next one.
  return month < now.getUTCMonth() + 1 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function isoFrom(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function contextAround(text, index, radius) {
  return text
    .slice(Math.max(0, index - radius), Math.min(text.length, index + radius))
    .replace(/\s+/gu, " ")
    .trim();
}
