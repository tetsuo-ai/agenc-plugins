/**
 * Corpus loading and pure retrieval logic. The corpus ships as JSON
 * files under corpus/ and grows via user ingests (data dir). Progressive
 * disclosure lives here: a small model should never see the solution
 * until it asks for that level explicitly.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const TOPICS = ["algebra", "geometry", "number-theory", "combinatorics"];

export function loadCorpus(corpusDir, extraPath) {
  const problems = [];
  const seen = new Set();
  const pushFile = (path) => {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const raw of parsed) {
      const problem = normalizeProblem(raw);
      if (problem === null || seen.has(problem.id)) continue;
      seen.add(problem.id);
      problems.push(problem);
    }
  };
  if (existsSync(corpusDir)) {
    for (const entry of readdirSync(corpusDir).sort()) {
      if (entry.endsWith(".json")) pushFile(join(corpusDir, entry));
    }
  }
  if (extraPath !== undefined && existsSync(extraPath)) pushFile(extraPath);
  return problems.sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeProblem(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  const statement = String(raw.statement ?? "").trim();
  if (!/^\d{4}-\d[a-z]?$/u.test(id) || statement.length < 20) return null;
  const solution = String(raw.solution ?? "").trim();
  const hints = Array.isArray(raw.hints) ? raw.hints.map((h) => String(h).trim()).filter(Boolean).slice(0, 5) : [];
  return {
    id,
    year: Number(id.slice(0, 4)),
    number: Number(id.slice(5, 6)),
    topic: TOPICS.includes(raw.topic) ? raw.topic : "other",
    difficulty: ["easy", "medium", "hard", "legendary"].includes(raw.difficulty) ? raw.difficulty : "medium",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 8) : [],
    title: String(raw.title ?? `IMO ${id}`).slice(0, 120),
    statement,
    answer: raw.answer === null || raw.answer === undefined ? null : String(raw.answer).slice(0, 200),
    keyIdea: String(raw.keyIdea ?? "").trim() || null,
    hints,
    solutionType: raw.solutionType === "sketch" ? "sketch" : "full",
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
    ...(problem.answer !== null ? { answer: problem.answer } : {}),
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
      ...(problem.solution !== undefined ? { solution: problem.solution } : { solution: null, note: "solution not recorded for this problem" }),
      ...(problem.sourceNote !== undefined ? { sourceNote: problem.sourceNote } : {}),
    };
  }
  return { error: `level must be one of statement, hint1, hints, keyIdea, solution` };
}

export function searchProblems(problems, { query, topic, year, difficulty, limit = 20 }) {
  const terms = String(query ?? "").toLowerCase().split(/\s+/u).filter((t) => t.length > 1);
  const hits = [];
  for (const problem of problems) {
    if (topic !== undefined && problem.topic !== topic) continue;
    if (year !== undefined && problem.year !== year) continue;
    if (difficulty !== undefined && problem.difficulty !== difficulty) continue;
    if (terms.length > 0) {
      const haystack = `${problem.title} ${problem.statement} ${problem.tags.join(" ")} ${problem.keyIdea ?? ""}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) continue;
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
 * Deterministic numeric/expression answer check: normalizes commas,
 * whitespace, and a few textual equivalences before comparing. When the
 * recorded answer is null the check is reported as not-applicable — the
 * model must never guess verification.
 */
export function checkAnswer(problem, attempt) {
  if (problem.answer === null || problem.answer === undefined) {
    return { applicable: false, note: "this problem has no recorded short answer (proof-type); verify by reading the solution level" };
  }
  const norm = (value) => String(value)
    .toLowerCase()
    .replace(/^[a-z]\)|^\d+[.)]/gu, "")
    .replace(/^(?:el|la|los|las|the)\b/u, "")
    .replace(/múltiplos|multiplos/gu, "múltiplo")
    .replace(/ningún|ninguno|no existe|imposible|none/gu, "∅")
    .replace(/f\(n\)\s*=\s*/gu, "")
    .replace(/[\s,]/gu, "")
    .trim();
  const expected = norm(problem.answer);
  const got = norm(attempt);
  const ok = expected === got
    || expected.includes(got) && got.length >= Math.max(3, expected.length - 4)
    || got.includes(expected) && expected.length >= 3;
  return { applicable: true, correct: ok, expectedHint: ok ? null : "not quite — try the hints level before the solution" };
}

/** Deterministic study plan: spread over topics, easy → harder. */
export function studyPlan(problems, { topic, count = 5 }) {
  const pool = problems.filter((p) => (topic === undefined || p.topic === topic));
  const order = { easy: 0, medium: 1, hard: 2, legendary: 3 };
  return pool
    .slice()
    .sort((a, b) => (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1) || a.year - b.year)
    .slice(0, Math.max(1, Math.min(count, 10)))
    .map((p) => ({ id: p.id, title: p.title, difficulty: p.difficulty, topic: p.topic }));
}

export function makeProgressStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "progress.json");
  const load = () => {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  };
  return {
    mark(id, { status, note }) {
      const entries = load();
      const entry = entries.find((e) => e.id === id) ?? { id };
      if (["attempted", "solved", "learning"].includes(status)) entry.status = status;
      if (note !== undefined) entry.note = String(note).slice(0, 200);
      entry.at = new Date().toISOString();
      if (!entries.includes(entry)) entries.push(entry);
      writeFileSync(`${path}.tmp`, JSON.stringify({ entries }, null, 2));
      renameSync(`${path}.tmp`, path);
      return entry;
    },
    list() {
      return load();
    },
  };
}

export function makeIngestStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "user-problems.json");
  return {
    ingest(items) {
      const added = [];
      const rejected = [];
      let existing = [];
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        existing = Array.isArray(parsed) ? parsed : [];
      } catch {
        existing = [];
      }
      for (const raw of Array.isArray(items) ? items : [items]) {
        const problem = normalizeProblem(raw);
        if (problem === null) {
          rejected.push({ id: raw?.id ?? "?", reason: "id must be YYYY-N and statement ≥ 20 chars" });
          continue;
        }
        if (existing.some((p) => p.id === problem.id)) {
          rejected.push({ id: problem.id, reason: "duplicate" });
          continue;
        }
        existing.push(raw);
        added.push(problem.id);
      }
      if (added.length > 0) {
        writeFileSync(`${path}.tmp`, JSON.stringify(existing, null, 2));
        renameSync(`${path}.tmp`, path);
      }
      return { added, rejected };
    },
  };
}
