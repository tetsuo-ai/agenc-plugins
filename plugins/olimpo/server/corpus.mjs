/**
 * Corpus loading and pure retrieval logic. The corpus ships as JSON
 * files under corpus/ and grows via user ingests (data dir). Progressive
 * disclosure lives here: a small model should never see the solution
 * until it asks for that level explicitly.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, makeDataStore } from "./storage.mjs";

export const TOPICS = ["algebra", "geometry", "number-theory", "combinatorics"];
// Legacy search inputs remain recognized; displayed corpus tags are English.
export const LEGACY_TAG_ALIASES = Object.freeze({
  euclides: "euclid", congruencias: "congruences", periodicidad: "periodicity",
  divisores: "divisors", factorizacion: "factorization", "descenso-infinito": "infinite-descent",
  "suma-de-cuadrados": "sum-of-squares", minimo: "minimum", sucesiones: "sequences",
  induccion: "induction", polinomios: "polynomials", interpolacion: "interpolation",
  desigualdades: "inequalities", pitagoras: "pythagoras", incirculo: "incircle",
  vectores: "vectors", baricentro: "centroid", optimizacion: "optimization",
  semejanza: "similarity", conteo: "counting", combinaciones: "combinations",
  caminos: "paths", "potencias-de-dos": "powers-of-two", grafos: "graphs",
});
export const isProblemId = (id) => typeof id === "string" && /^(?:\d{4}-\d[a-z]?|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/u.test(id) && id.length <= 64;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const optionalText = (value, max) => value == null || (typeof value === "string" && value.length <= max);

export function loadCorpus(corpusDir, extraPath) {
  const problems = [];
  const seen = new Set();
  const pushFile = (path, bundled) => {
    let parsed;
    try {
      parsed = readJsonFile(path);
    } catch (error) {
      throw new Error("Cannot read corpus; preserve and repair the source file", {cause:error});
    }
    if (!Array.isArray(parsed)) throw new Error("Corpus must be an array");
    for (const raw of parsed) {
      const problem = normalizeProblem(raw, { bundled });
      if (problem === null) throw new Error("Corpus contains an invalid problem; repair the source file");
      if (seen.has(problem.id)) throw new Error("Corpus contains a duplicate problem id");
      seen.add(problem.id);
      problems.push(problem);
    }
  };
  if (existsSync(corpusDir)) {
    for (const entry of readdirSync(corpusDir).sort()) {
      if (entry.startsWith("problems-") && entry.endsWith(".json")) pushFile(join(corpusDir, entry), true);
    }
  }
  if (extraPath !== undefined && existsSync(extraPath)) pushFile(extraPath, false);
  return problems.sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeProblem(raw, { bundled = false } = {}) {
  if (!object(raw) || !isProblemId(raw.id) || typeof raw.statement !== "string") return null;
  const id = raw.id;
  const statement = raw.statement.trim();
  if (statement.length < 20 || statement.length > 20000
      || !optionalText(raw.solution, 30000) || !optionalText(raw.answer, 200)
      || !optionalText(raw.keyIdea, 2000) || !optionalText(raw.title, 120)
      || !optionalText(raw.sourceNote, 500)
      || (raw.hints !== undefined && (!Array.isArray(raw.hints) || raw.hints.length > 5 || raw.hints.some(h => typeof h !== "string" || h.length > 2000)))
      || (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 8 || raw.tags.some(t => typeof t !== "string" || t.length > 80)))
      || (raw.topic !== undefined && ![...TOPICS, "other"].includes(raw.topic))
      || (raw.difficulty !== undefined && !["easy", "medium", "hard", "legendary"].includes(raw.difficulty))
      || (raw.solutionType != null && !["full", "sketch"].includes(raw.solutionType))) return null;
  const solution = (raw.solution ?? "").trim();
  const hints = (raw.hints ?? []).map(h => h.trim()).filter(Boolean);
  const datedId = /^\d{4}-\d[a-z]?$/u.test(id);
  return {
    id,
    ...(datedId ? { year: Number(id.slice(0, 4)), number: Number(id.slice(5, 6)) } : {}),
    topic: TOPICS.includes(raw.topic) ? raw.topic : "other",
    difficulty: ["easy", "medium", "hard", "legendary"].includes(raw.difficulty) ? raw.difficulty : "medium",
    tags: raw.tags ?? [],
    title: raw.title ?? `Exercise ${id}`,
    statement,
    answer: raw.answer === null || raw.answer === undefined ? null : String(raw.answer).slice(0, 200),
    keyIdea: String(raw.keyIdea ?? "").trim() || null,
    hints,
    solutionType: !solution ? null : raw.solutionType === "full" ? "full" : "sketch",
    provenance: bundled ? raw.provenance : { kind: "user", review: "unreviewed", license: "unspecified" },
    ...(solution.length > 0 ? { solution } : {}),
    ...(raw.sourceNote !== undefined ? { sourceNote: String(raw.sourceNote).slice(0, 300) } : {}),
  };
}

/**
 * Progressive disclosure: never hand a small model the full problem at
 * once. Levels build up: statement → hints (one by one) → keyIdea →
 * solution.
 */
export function problemAtLevel(problem, level) {
  const base = {
    id: problem.id,
    year: problem.year,
    number: problem.number,
    topic: problem.topic,
    difficulty: problem.difficulty,
    tags: problem.tags,
    title: problem.title,
    statement: problem.statement,
    provenance: problem.provenance,
  };
  if (level === undefined || level === "statement") return base;
  if (level === "hints") {
    return { ...base, hintCount: problem.hints.length, hints: problem.hints };
  }
  if (level === "hint1") {
    return { ...base, hintCount: problem.hints.length, hint: problem.hints[0] ?? null };
  }
  if (level === "keyIdea") {
    return { ...base, hints: problem.hints, keyIdea: problem.keyIdea };
  }
  if (level === "solution") {
    return {
      ...base,
      hints: problem.hints,
      keyIdea: problem.keyIdea,
      solutionType: problem.solutionType,
      ...(problem.answer !== null ? { answer: problem.answer } : {}),
      ...(problem.solution !== undefined ? { solution: problem.solution } : { solution: null, note: "solution not recorded for this problem" }),
      ...(problem.sourceNote !== undefined ? { sourceNote: problem.sourceNote } : {}),
    };
  }
  return { error: `level must be one of statement, hint1, hints, keyIdea, solution` };
}

export function searchProblems(problems, { query, topic, year, difficulty, limit = 20 }) {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20;
  const terms = String(query ?? "").toLowerCase().split(/\s+/u).filter((t) => t.length > 1);
  const hits = [];
  for (const problem of problems) {
    if (topic !== undefined && problem.topic !== topic) continue;
    if (year !== undefined && problem.year !== year) continue;
    if (difficulty !== undefined && problem.difficulty !== difficulty) continue;
    if (terms.length > 0) {
      const haystack = `${problem.title} ${problem.statement} ${problem.tags.join(" ")} ${problem.keyIdea ?? ""}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term)
        || (Object.hasOwn(LEGACY_TAG_ALIASES, term) && haystack.includes(LEGACY_TAG_ALIASES[term])))) continue;
    }
    hits.push({
      id: problem.id,
      title: problem.title,
      year: problem.year,
      topic: problem.topic,
      difficulty: problem.difficulty,
      tags: problem.tags,
      statementHead: problem.statement.slice(0, 140),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Exact short-answer comparison after conservative text normalization.
 * This is not symbolic equivalence or a proof verifier. When the
 * recorded answer is null the check is reported as not-applicable - the
 * model must never guess verification.
 */
export function checkAnswer(problem, attempt) {
  if (problem.answer === null || problem.answer === undefined) {
    return { applicable: false, note: "this problem has no recorded short answer (proof-type); verify by reading the solution level" };
  }
  if (typeof attempt !== "string" || !attempt.trim() || attempt.length > 1000) return { applicable: true, correct: false, note: "attempt must be a nonempty string of at most 1000 characters" };
  // Text equality only; preserve decimal points, commas, negation and signs.
  const norm = (value) => String(value).normalize("NFKC").toLowerCase().trim()
    .replace(/^(?:[a-z]\)|\d+[.)])\s+/u, "").replace(/\s+/gu, " ");
  const ok = norm(problem.answer) === norm(attempt);
  return {
    applicable: true, correct: ok, comparison: "normalized-text-only",
    note: "Checks only the recorded short answer, not a proof or symbolic equivalence. A text mismatch may be a format difference.",
    expectedHint: ok ? null : "Compare your format with the question, or request hints before the solution.",
  };
}

/** Deterministic study plan: spread over topics, easy → harder. */
export function studyPlan(problems, { topic, count = 5 }) {
  const pool = problems.filter((p) => (topic === undefined || p.topic === topic));
  const order = { easy: 0, medium: 1, hard: 2, legendary: 3 };
  return pool
    .slice()
    .sort((a, b) => (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1) || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(count, 10)))
    .map((p) => ({ id: p.id, title: p.title, difficulty: p.difficulty, topic: p.topic }));
}

export function makeProgressStore(dataDir) {
  const validate = value => {
    if (!object(value) || !Array.isArray(value.entries) || value.entries.length > 1000
        || value.entries.some(e => !object(e) || !isProblemId(e.id) || !["attempted", "solved", "learning"].includes(e.status)
          || !optionalText(e.note, 200) || typeof e.at !== "string" || !Number.isFinite(Date.parse(e.at)))
        || new Set(value.entries.map(e => e.id)).size !== value.entries.length) throw new Error("invalid progress store");
  };
  const store = makeDataStore(dataDir, "progress.json", { entries: [] }, validate);
  return {
    mark(id, { status, note }) {
      if (!isProblemId(id) || !["attempted", "solved", "learning"].includes(status) || !optionalText(note, 200)) throw new Error("invalid progress input");
      return store.update(value => {
        const entry = value.entries.find(e => e.id === id) ?? { id };
        entry.status = status;
        if (note !== undefined) entry.note = note;
        entry.at = new Date().toISOString();
        if (!value.entries.includes(entry)) value.entries.push(entry);
        return entry;
      });
    },
    list() { return store.read().entries; },
  };
}

export function makeIngestStore(dataDir, builtInIds = []) {
  const validate = value => {
    if (!Array.isArray(value) || value.length > 500 || value.some(p => normalizeProblem(p) === null)
        || new Set(value.map(p => p.id)).size !== value.length) throw new Error("invalid user corpus");
  };
  const store = makeDataStore(dataDir, "user-problems.json", [], validate);
  return {
    ingest(items) {
      const inputs = Array.isArray(items) ? items : [items];
      if (inputs.length > 50) throw new Error("ingest accepts at most 50 items");
      return store.update(existing => {
        const added = [], rejected = [];
        for (const raw of inputs) {
          const problem = normalizeProblem(raw);
          if (problem === null) {
            rejected.push({ id: typeof raw?.id === "string" ? raw.id.slice(0, 64) : "?", reason: "invalid problem fields or limits" });
          } else if (builtInIds.includes(problem.id) || existing.some(p => p.id === problem.id)) {
            rejected.push({ id: problem.id, reason: "duplicate" });
          } else if (existing.length >= 500) {
            rejected.push({ id: problem.id, reason: "user corpus is full (500 problems)" });
          } else {
            existing.push(problem);
            added.push(problem.id);
          }
        }
        return { added, rejected };
      });
    },
  };
}
