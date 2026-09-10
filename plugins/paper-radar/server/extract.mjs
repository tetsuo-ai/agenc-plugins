/**
 * Deterministic document extraction — the plugin's engine room.
 *
 * Everything here is plain regex/date arithmetic over extracted text in
 * Spanish and English: absolute dates, durations, periodicities, money
 * amounts, cancellation-notice windows, and document-kind scoring. No
 * model involvement, no network, no locale dependencies. The design rule:
 * the language model (hosted or local) only ever sees these compact
 * candidates with short context snippets — never the full document.
 */

/** Month name → number. Regional duplicates ("setiembre") map to the same month. */
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

const NUMBER_WORDS = {
  es: { cero: 0, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, sesenta: 60, noventa: 90 },
  en: { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90 },
};

const EXPIRY_KEYWORDS = [
  "vence", "vencimiento", "vencerá", "vencera", "caduca", "caducidad", "expira", "expiración", "expiracion", "vigencia", "hasta el",
  "expires", "expiry", "expiration", "expire", "valid until", "until", "due",
];
const RENEWAL_KEYWORDS = [
  "renovación", "renovacion", "renueva", "renovará", "renovara", "se renovará", "prórroga", "prolongación automática",
  "renewal", "renews", "renew", "auto-renew", "automatically renew", "anniversary date",
];
const NOTICE_KEYWORDS_ES = [
  "preaviso", "notificación previa", "notificacion previa", "antelación", "antelacion",
  "anticipación", "anticipacion", "comunicar con", "avisar con", "cancelar con",
  "resolver con", "oponerse a la renovación", "oponerse a la renovacion",
];
const NOTICE_KEYWORDS_EN = [
  "written notice", "prior notice", "advance notice", "in advance", "anticipation",
  "notify", "cancel.*?(?:before|prior to)", "terminate.*?(?:before|upon)", "oppose.*?renewal",
];
const PERIODICITY_PATTERNS = [
  { pattern: /\b(?:mensual(?:es)?|por mes|\/\s*mes|al mes|month(?:ly)?|per month|\/\s*mo(?:nth)?\b)/iu, period: "monthly" },
  { pattern: /\b(?:anual(?:es)?|anualmente|por a[ñn]o|al a[ñn]o|\/\s*a[ñn]o|yearly|annually|per annum|per year|\/\s*y(?:ea)?r\b|p\.\s*a\.)/iu, period: "annual" },
  { pattern: /\b(?:semanal(?:es)?|por semana|weekly|per week)/iu, period: "weekly" },
  { pattern: /\b(?:trimestral(?:es)?|quarterly|per quarter)/iu, period: "quarterly" },
];

const KIND_RULES = [
  { kind: "insurance", words: ["póliza", "poliza", "seguro", "cobertura", "prima", "policy", "insurance", "coverage", "premium", "underwriter", "aseguradora"] },
  { kind: "telecom", words: ["telefonía", "telefonia", "fibra", "móvil", "movil", "línea", "internet", "plan de datos", "broadband", "mobile plan", "fiber", "sim"] },
  { kind: "gym", words: ["gimnasio", "cuota", "membresía", "membresia", "gym", "membership", "fitness club", "cuota mensual"] },
  { kind: "streaming", words: ["suscripción", "suscripcion", "streaming", "plan premium", "subscription", "netflix", "spotify", "hbo", "disney+", "prime video", "youtube premium"] },
  { kind: "lease", words: ["arrendamiento", "alquiler", "inquilino", "arrendador", "renta mensual", "lease", "tenant", "landlord", "rent"] },
  { kind: "warranty", words: ["garantía", "garantia", "garantía limitada", "warranty", "guarantee", "defectos de fabricación"] },
  { kind: "domain", words: ["dominio", "domain name", "registro de dominio", "whois", "registrar"] },
  { kind: "vehicle", words: ["inspección técnica", "inspeccion tecnica", "itv", "vehicle inspection", "registration renewal", "matrícula", "matricula"] },
  { kind: "identity", words: ["pasaporte", "passport", "dni", "licencia de conducir", "driver's license", "driving licence", "visa", "residencia", "id card"] },
  { kind: "software", words: ["licencia de software", "software license", "saas", "seat", "subscription term", "plan anual de software"] },
];

function contextAround(text, index, radius = 70) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text
    .slice(start, end)
    .replace(/\s+/gu, " ")
    .trim();
}

function monthNumber(name, _lang) {
  const lower = name.toLowerCase().replace(/\.$/u, "");
  const month = MONTH_NAME_TO_NUMBER.get(lower);
  return month === undefined ? null : { month, lang: _lang };
}

function resolveYear(raw) {
  const year = Number(raw);
  if (year >= 1000) return year;
  return 2000 + year;
}

function isoFrom(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * All absolute dates found in the text. Spanish day-first and English
 * month-first forms are unambiguous; bare numeric d/m/y is flagged
 * `ambiguousOrder` (day/month vs month/day) unless a Spanish month name
 * appears in the document, which biases to day-first.
 */
export function extractDates(text) {
  const spanishBias = /\b(?:de|del|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|vence|renovaci)\b/iu.test(text)
    || /[a-záéíóúñ]\s+[0-9]{1,2}\s+de\s+/iu.test(text);
  const found = [];
  const push = (match, iso, extra = {}) => {
    const index = match.index ?? 0;
    found.push({
      match: match[0],
      iso,
      context: contextAround(text, index),
      ...extra,
    });
  };

  // ISO: 2026-09-30
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/gu;
  for (const match of text.matchAll(isoRe)) {
    push(match, isoFrom(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  // "30 de septiembre de 2026" / "30 de septiembre" (year inferred later)
  const esRe = /\b(\d{1,2})\s+de\s+([a-záéíóúñ]+\.?)(?:\s+de\s+(\d{2,4}))?/giu;
  for (const match of text.matchAll(esRe)) {
    const month = monthNumber(match[2], "es");
    if (month === null) continue;
    const year = match[3] !== undefined ? resolveYear(match[3]) : null;
    push(match, year === null ? null : isoFrom(year, month.month, Number(match[1])), {
      partial: year === null ? { day: Number(match[1]), month: month.month } : undefined,
    });
  }

  // "September 30, 2026" / "Sept. 30 2026" / "September 30"
  const enRe = /\b([a-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?/giu;
  for (const match of text.matchAll(enRe)) {
    const month = monthNumber(match[1], "en");
    if (month === null) continue;
    const year = match[3] !== undefined ? resolveYear(match[3]) : null;
    push(match, year === null ? null : isoFrom(year, month.month, Number(match[2])), {
      partial: year === null ? { day: Number(match[2]), month: month.month } : undefined,
    });
  }

  // Numeric d/m/y or m/d/y: 30/09/2026, 30-09-26, 30.09.2026
  const numRe = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/gu;
  for (const match of text.matchAll(numRe)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = resolveYear(match[3]);
    let day = a;
    let month = b;
    let ambiguousOrder = false;
    if (a > 12 && b <= 12) {
      day = a; month = b; // day-first for sure
    } else if (b > 12 && a <= 12) {
      day = b; month = a; // month-first for sure
    } else if (spanishBias) {
      day = a; month = b; ambiguousOrder = !spanishBias;
    } else {
      day = b; month = a; ambiguousOrder = true;
    }
    push(match, isoFrom(year, month, day), { ambiguousOrder });
  }

  return dedupe(found);
}

function dedupe(dates) {
  const seen = new Set();
  return dates.filter((candidate) => {
    const key = `${candidate.match}|${candidate.iso ?? "partial"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Durations like "30 días", "thirty (30) days", "60 días de antelación". */
export function extractDurations(text) {
  const found = [];
  const numericRe = /(\d{1,4})\s*(?:\([a-záéíóúñ ]+\)\s*)?(?:días|dia|día|days?|semanas?|weeks?|mes(es)?|months?|años?|anos?|years?)/giu;
  for (const match of text.matchAll(numericRe)) {
    found.push({
      match: match[0],
      days: durationToDays(Number(match[1]), match[0]),
      context: contextAround(text, match.index ?? 0),
    });
  }
  const wordRe = /\b([a-záéíóúñ]+)\s*\((\d{1,4})\)\s*(?:días?|days?)/giu;
  for (const match of text.matchAll(wordRe)) {
    const spoken = NUMBER_WORDS.es[match[1].toLowerCase()] ?? NUMBER_WORDS.en[match[1].toLowerCase()];
    if (spoken !== undefined) {
      found.push({
        match: match[0],
        days: durationToDays(spoken, match[0]),
        context: contextAround(text, match.index ?? 0),
      });
    }
  }
  return found.filter((entry) => entry.days !== null);
}

function durationToDays(count, raw) {
  const lower = raw.toLowerCase();
  if (/\b(?:semanas?|weeks?)\b/u.test(lower)) return count * 7;
  if (/\b(?:mes(?:es)?|months?)\b/u.test(lower)) return count * 30;
  if (/\b(?:a[ñn]os?|years?)\b/u.test(lower)) return count * 365;
  return count; // days
}

const MONEY_CONTEXT = /(?:prima|cuota|precio|importe|total|coste|costo|tarifa|factura|premium|price|fee|rate|charge|total|per annum|prima anual)/iu;

/**
 * Money amounts with per-period hints: "€412", "1.299,99 €", "$1,299.99/mo".
 * Bare numbers (date fragments, page numbers) are kept only when they carry
 * a currency symbol, a decimal/thousands shape AND money language nearby —
 * documents are noisy and false amounts cost more than missed ones.
 */
export function extractAmounts(text) {
  const found = [];
  const dateSpans = [];
  for (const match of text.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+de\s+[a-záéíóúñ]+(?:\s+de\s+\d{2,4})?)\b/giu)) {
    dateSpans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  const inDate = (index, length) =>
    dateSpans.some(([start, end]) => index < end && index + length > start);

  const re = /(?:(€|EUR|USD|US\$|\$|GBP|£|MXN|ARS|CLP|COP)\s*)?(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d{2,6})(?:\s*(€|EUR|USD|US\$|\$|GBP|£|MXN|ARS|CLP|COP))?(?:\s*(?:\/|por|per)\s*(?:mes|month|mo|a[ñn]o|year|yr|semana|week))?/giu;
  for (const match of text.matchAll(re)) {
    const raw = match[0].trim();
    if (raw.length === 0) continue;
    const index = match.index ?? 0;
    if (inDate(index, raw.length) && !/[€$£]|(?:EUR|USD|GBP|MXN|ARS|CLP|COP)/iu.test(raw)) continue;
    const value = parseAmountValue(match[2]);
    if (value === null || value <= 0) continue;
    const currency = normalizeCurrency(match[1] ?? match[3] ?? "");
    const hasCurrency = currency !== null;
    const shaped = /[.,]/u.test(match[2]) && value >= 10;
    const nearMoney = MONEY_CONTEXT.test(contextAround(text, index, 45));
    if (!hasCurrency && !(shaped && nearMoney)) continue;
    const per = /(?:mes|month|mo)\b/iu.test(raw) ? "month"
      : /(?:a[ñn]o|year|yr)\b/iu.test(raw) ? "year"
        : /(?:semana|week)\b/iu.test(raw) ? "week"
          : null;
    found.push({
      match: raw,
      value,
      ...(currency !== null ? { currency } : {}),
      ...(per !== null ? { per } : {}),
      context: contextAround(text, index),
    });
  }
  return dedupeAmounts(found);
}

function parseAmountValue(raw) {
  const cleaned = raw.replace(/\s/gu, "");
  if (/^\d{1,3}(?:[.,]\d{3})+$/u.test(cleaned)) return Number(cleaned.replace(/[.,]/gu, ""));
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./gu, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/gu, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function normalizeCurrency(symbol) {
  const upper = symbol.toUpperCase();
  if (upper === "€" || upper === "EUR") return "EUR";
  if (upper === "$" || upper === "USD" || upper === "US$") return "USD";
  if (upper === "£" || upper === "GBP") return "GBP";
  if (["MXN", "ARS", "CLP", "COP"].includes(upper)) return upper;
  return null;
}

function dedupeAmounts(amounts) {
  const seen = new Set();
  return amounts.filter((candidate) => {
    const key = candidate.match;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractPeriodicity(text) {
  for (const rule of PERIODICITY_PATTERNS) {
    const match = text.match(rule.pattern);
    if (match !== null) {
      return { period: rule.period, match: match[0], index: match.index ?? 0 };
    }
  }
  return null;
}

/**
 * Cancellation-notice windows: a duration that sits near notice/cancel
 * language, e.g. "preaviso de 30 días", "thirty (30) days' written notice",
  "deberá comunicar con 60 días de antelación".
 */
export function extractNoticeWindows(text) {
  const notices = [];
  for (const duration of extractDurations(text)) {
    const nearText = duration.context.toLowerCase();
    const nearNotice =
      NOTICE_KEYWORDS_ES.some((keyword) => nearText.includes(keyword)) ||
      NOTICE_KEYWORDS_EN.some((pattern) => new RegExp(pattern, "iu").test(nearText)) ||
      /(?:notice|preaviso|aviso|cancel|cancelar|resoluc|terminate|terminaci|oponerse|renovaci)/iu.test(nearText);
    if (nearNotice) {
      notices.push({
        days: duration.days,
        match: duration.match,
        context: duration.context,
      });
    }
  }
  // Deduplicate by day count, keep the first evidence.
  const seen = new Set();
  return notices.filter((notice) => {
    if (seen.has(notice.days)) return false;
    seen.add(notice.days);
    return true;
  });
}

/** Score document kind from keyword evidence; empty kind when nothing hits. */
export function detectKind(text) {
  const lower = text.toLowerCase();
  const scored = [];
  for (const rule of KIND_RULES) {
    const hits = rule.words.filter((word) => lower.includes(word.toLowerCase()));
    if (hits.length > 0) {
      scored.push({ kind: rule.kind, hits: hits.slice(0, 4) });
    }
  }
  scored.sort((a, b) => b.hits.length - a.hits.length);
  return scored.slice(0, 3);
}

/**
 * The full deterministic candidate set for one document. Relevance flags
 * tell the model which dates sit near expiry/renewal language without it
 * having to re-read the text.
 */
export function extractCandidates(text, { maxDates = 12, maxAmounts = 8 } = {}) {
  const dates = extractDates(text).map((date) => ({
    ...date,
    relevance: scoreDateRelevance(date.context),
  }));
  const sorted = [...dates].sort((a, b) => b.relevance - a.relevance);
  return {
    dates: sorted.slice(0, maxDates),
    amounts: extractAmounts(text).slice(0, maxAmounts),
    noticeWindows: extractNoticeWindows(text),
    periodicity: extractPeriodicity(text),
    kinds: detectKind(text),
  };
}

function scoreDateRelevance(context) {
  const lower = context.toLowerCase();
  let score = 0;
  for (const keyword of EXPIRY_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) score += 2;
  }
  for (const keyword of RENEWAL_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) score += 2;
  }
  return score;
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Next occurrence of a periodic anchor date on/after `fromIso`. */
export function nextOccurrence(anchorIso, period, fromIso = todayIso()) {
  const anchor = Date.parse(`${anchorIso}T00:00:00Z`);
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  if (!Number.isFinite(anchor) || !Number.isFinite(from)) return null;
  if (period === "one_time" || period === undefined || period === null) {
    return anchorIso;
  }
  const steps = {
    weekly: { unit: "days", amount: 7 },
    monthly: { unit: "months", amount: 1 },
    quarterly: { unit: "months", amount: 3 },
    annual: { unit: "years", amount: 1 },
  };
  const step = steps[period];
  if (step === undefined) return null;
  let cursor = new Date(anchor);
  let count = 0;
  while (cursor.getTime() < from) {
    count += 1;
    cursor = advance(new Date(anchor), { ...step, amount: step.amount * count });
    if (cursor.getTime() < anchor) return null; // overflow guard
  }
  return cursor.toISOString().slice(0, 10);
}

function advance(date, step) {
  const next = new Date(date);
  if (step.unit === "days") {
    next.setUTCDate(next.getUTCDate() + step.amount);
  } else if (step.unit === "months") {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + step.amount);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  } else {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCFullYear(next.getUTCFullYear() + step.amount);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next;
}

/** Days between two ISO dates (b - a). */
export function daysBetween(aIso, bIso) {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / (24 * 3600 * 1000));
}

export function addDaysIso(iso, days) {
  const date = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date)) return null;
  return new Date(date + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
