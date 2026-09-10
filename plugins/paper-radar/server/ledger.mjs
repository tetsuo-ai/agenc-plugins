/**
 * Ledger schema, validation, and derived deadlines. Pure — persistence
 * lives in the server's stores. Validation is strict and the errors are
 * written for a small local model to act on directly ("noticeDays must be
 * 1-365, got 900"), because this plugin must work end-to-end on local
 * models: the tool output IS the error message.
 */
import { addDaysIso, daysBetween, nextOccurrence, todayIso } from "./extract.mjs";

export const CATEGORIES = [
  "insurance", "telecom", "gym", "streaming", "lease", "warranty",
  "domain", "vehicle", "identity", "software", "subscription", "other",
];

export const PERIODS = ["weekly", "monthly", "quarterly", "annual", "one_time"];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Validate + normalize one ledger entry. Derived fields the caller should
 * never compute by hand: nextDue (next occurrence ≥ today for periodic
 * anchors), noticeDeadline (nextDue - noticeDays), annualCost.
 */
export function normalizeEntry(input, { now = new Date() } = {}) {
  if (input === null || typeof input !== "object") {
    return { error: "entry must be an object" };
  }
  const errors = [];
  const title = String(input.title ?? "").trim();
  if (title.length < 3) errors.push("title is required (at least 3 characters)");

  const category = String(input.category ?? "other").trim().toLowerCase();
  if (!CATEGORIES.includes(category)) {
    errors.push(`category must be one of ${CATEGORIES.join(", ")} (got '${category}')`);
  }

  const period = input.period === undefined || input.period === null
    ? "one_time"
    : String(input.period).trim().toLowerCase();
  if (!PERIODS.includes(period)) {
    errors.push(`period must be one of ${PERIODS.join(", ")} (got '${period}')`);
  }

  const anchorIso = String(input.anchorDate ?? "").trim();
  const parsedDate = new Date(`${anchorIso}T00:00:00Z`);
  if (!ISO_RE.test(anchorIso) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== anchorIso) {
    errors.push(`anchorDate must be an ISO date (YYYY-MM-DD), got '${input.anchorDate ?? ""}'`);
  }

  let noticeDays = null;
  if (input.noticeDays !== undefined && input.noticeDays !== null) {
    noticeDays = Number(input.noticeDays);
    if (!Number.isInteger(noticeDays) || noticeDays < 1 || noticeDays > 365) {
      errors.push("noticeDays must be an integer between 1 and 365");
      noticeDays = null;
    }
  }

  let cost = null;
  let currency = null;
  const costPeriod = input.costPeriod ?? ({ weekly: "week", monthly: "month", quarterly: "quarter", annual: "year" }[period] ?? null);
  if (costPeriod !== null && !["week", "month", "quarter", "year"].includes(costPeriod)) {
    errors.push("costPeriod must be week, month, quarter or year");
  }
  if (input.cost !== undefined && input.cost !== null && input.cost !== "") {
    cost = Number(input.cost);
    if (!Number.isFinite(cost) || cost <= 0) {
      errors.push("cost, when present, must be a positive number");
      cost = null;
    }
    currency = String(input.currency ?? "EUR").trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) {
      errors.push("currency must be a 3-letter code like EUR or USD");
      currency = null;
    }
  }

  if (errors.length > 0) return { error: errors.join("; ") };

  const today = todayIso(now);
  const nextDue = nextOccurrence(anchorIso, period, today);
  const noticeDeadline = nextDue !== null && noticeDays !== null
    ? addDaysIso(nextDue, -noticeDays)
    : null;

  return {
    entry: {
      id: typeof input.id === "string" && input.id.trim() !== "" ? input.id.trim() : null,
      title,
      category,
      period,
      anchorDate: anchorIso,
      noticeDays,
      ...(cost !== null ? { cost, currency, costPeriod } : {}),
      counterparty: optionalText(input.counterparty),
      language: input.language === "en" ? "en" : "es",
      status: input.status === "cancelled" ? "cancelled" : "active",
      notes: optionalText(input.notes),
      evidence: sanitizeEvidence(input.evidence),
      sourceFile: optionalText(input.sourceFile),
      createdAt: optionalText(input.createdAt) ?? today,
    },
    derived: {
      today,
      nextDue,
      noticeDeadline,
      annualCost: cost !== null && costPeriod !== null ? annualize(cost, costPeriod, period) : null,
    },
  };
}

function annualize(cost, per, fallbackPeriod) {
  const effective = per ?? (fallbackPeriod === "monthly" ? "month" : "year");
  if (effective === "week") return cost * 52;
  if (effective === "month") return cost * 12;
  if (effective === "quarter") return cost * 4;
  return cost;
}

function optionalText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text.slice(0, 200) : null;
}

/** Evidence snippets are capped hard: never store document bodies. */
function sanitizeEvidence(evidence) {
  if (evidence === undefined || evidence === null) return [];
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/\s+/gu, " ").trim().slice(0, 160))
    .slice(0, 5);
}

/**
 * Radar view: urgency-sorted rows. `critical` means the notice window is
 * already open (or the deadline itself is imminent) — that is the row the
 * user must act on TODAY even though renewal is weeks away.
 */
export function radarRows(entries, { horizonDays = 30, now = new Date() } = {}) {
  const today = todayIso(now);
  const rows = [];
  for (const entry of entries) {
    if (entry.status === "cancelled") continue;
    const nextDue = nextOccurrence(entry.anchorDate, entry.period, today);
    if (nextDue === null) continue;
    const daysToDue = daysBetween(today, nextDue);
    if (daysToDue === null) continue;
    const noticeDeadline = entry.noticeDays !== null && entry.noticeDays !== undefined
      ? addDaysIso(nextDue, -entry.noticeDays)
      : null;
    const daysToNotice = noticeDeadline !== null ? daysBetween(today, noticeDeadline) : null;
    if (daysToDue > horizonDays && (daysToNotice === null || daysToNotice > horizonDays)) continue;
    rows.push({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      nextDue,
      daysToDue,
      noticeDeadline,
      daysToNotice,
      urgency: urgencyOf(daysToDue, daysToNotice),
      ...(entry.cost !== undefined ? { cost: entry.cost, currency: entry.currency } : {}),
    });
  }
  return rows.sort(
    (a, b) =>
      urgencyRank(a) - urgencyRank(b) ||
      actionDeadline(a) - actionDeadline(b) ||
      a.daysToDue - b.daysToDue,
  );
}

/**
 * Within one urgency band, the row whose deadline to ACT comes first wins:
 * for notice-bearing rows that is the notice deadline — a window that is
 * open today outranks a renewal that is merely a few days out.
 */
function actionDeadline(row) {
  return row.daysToNotice ?? row.daysToDue;
}

function urgencyOf(daysToDue, daysToNotice) {
  if (daysToNotice !== null && daysToNotice <= 0) return "critical";
  if (daysToDue <= 7) return "critical";
  if (daysToNotice !== null && daysToNotice <= 14) return "act-soon";
  if (daysToDue <= 30) return "soon";
  return "upcoming";
}

const URGENCY_ORDER = { critical: 0, "act-soon": 1, soon: 2, upcoming: 3 };
function urgencyRank(row) {
  return URGENCY_ORDER[row.urgency] ?? 9;
}
