/**
 * Olimpo contract tests: corpus loading and normalization, progressive
 * disclosure (solutions never leak at lower levels), deterministic
 * answer checking, search, study plans, progress ledger and ingest
 * validation — plus the MCP server as a real child process over the
 * shipped corpus. Fully offline.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkAnswer,
  loadCorpus,
  normalizeProblem,
  problemAtLevel,
  searchProblems,
  studyPlan,
  makeIngestStore,
  makeProgressStore,
} from "../plugins/olimpo/server/corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "olimpo");
const SERVER = join(ROOT, "server", "main.mjs");
const CORPUS_DIR = join(ROOT, "corpus");

test("corpus: ships well-formed classics with full structure", () => {
  const problems = loadCorpus(CORPUS_DIR);
  assert.ok(problems.length >= 270, `full compendium corpus (${problems.length})`);
  const sourced = problems.filter((p) => p.tags.includes("compendium"));
  assert.ok(sourced.length >= 250, `sourced bulk present (${sourced.length})`);
  const byId = Object.fromEntries(problems.map((p) => [p.id, p]));
  assert.ok(byId["1988-6"] !== undefined, "the legendary 1988-6 ships");
  assert.equal(byId["1988-6"].difficulty, "legendary");
  assert.ok(byId["1988-6"].solution.includes("Vieta"));
  assert.ok(byId["1988-6"].hints.length >= 3);
  assert.ok(byId["1959-1"] !== undefined, "the 1959 opener ships");
  assert.ok(problems.every((p) => p.statement.length >= 20));
  assert.ok(problems.every((p) => p.solutionType === "full" || p.solutionType === "sketch"));
  const topics = new Set(problems.map((p) => p.topic));
  for (const expected of ["algebra", "number-theory", "combinatorics"]) {
    assert.ok(topics.has(expected), `topic ${expected} covered`);
  }
});

test("disclosure: solutions never leak below the solution level", () => {
  const problems = loadCorpus(CORPUS_DIR);
  const famous = problems.find((p) => p.id === "1988-6");
  const statement = JSON.stringify(problemAtLevel(famous, "statement"));
  const hint1 = JSON.stringify(problemAtLevel(famous, "hint1"));
  const hints = JSON.stringify(problemAtLevel(famous, "hints"));
  const keyIdea = JSON.stringify(problemAtLevel(famous, "keyIdea"));
  assert.ok(!statement.includes("solución") || famous.statement.includes("Demostrar"));
  assert.ok(!hint1.includes("cuadrado perfecto\n\n") && !hint1.includes(famous.solution.slice(0, 40)));
  assert.ok(!hints.includes(famous.solution.slice(0, 40)));
  assert.ok(!keyIdea.includes(famous.solution.slice(0, 40)));
  const solution = problemAtLevel(famous, "solution");
  assert.ok(solution.solution.includes("Vieta") || solution.solution.includes("cuadrática"));
  assert.equal(solution.solutionType, "full");
  const bad = problemAtLevel(famous, "otra-cosa");
  assert.match(bad.error, /level must be one of/u);
});

test("answers: deterministic check with normalization, honest N/A for proofs", () => {
  const problems = loadCorpus(CORPUS_DIR);
  const byId = Object.fromEntries(problems.map((p) => [p.id, p]));
  const numeric = byId["1964-1"]; // answer: "a) n múltiplo de 3"
  const ok = checkAnswer(numeric, "n múltiplo de 3");
  assert.equal(ok.applicable, true);
  assert.equal(ok.correct, true);
  const alsoOk = checkAnswer(numeric, "los múltiplos de 3");
  assert.equal(alsoOk.correct, true);
  const wrong = checkAnswer(numeric, "n múltiplo de 5");
  assert.equal(wrong.correct, false);
  assert.match(wrong.expectedHint, /hints/u);
  const proof = byId["1988-6"];
  const na = checkAnswer(proof, "cualquier cosa");
  assert.equal(na.applicable, false);
  assert.match(na.note, /proof-type|no recorded/u);
});

test("search and plans: by tag, by topic, deterministic order", () => {
  const problems = loadCorpus(CORPUS_DIR);
  const vieta = searchProblems(problems, { query: "vieta" });
  assert.ok(vieta.some((p) => p.id === "1988-6"));
  const nt = searchProblems(problems, { topic: "number-theory" });
  assert.ok(nt.length >= 3);
  assert.ok(nt.every((p) => p.topic === "number-theory"));
  const plan = studyPlan(problems, { count: 5 });
  assert.equal(plan.length, 5);
  const order = { easy: 0, medium: 1, hard: 2, legendary: 3 };
  assert.ok(order[plan[0].difficulty] <= order[plan[4].difficulty], "easy first, harder later");
});

test("normalize: rejects junk ids and stubs", () => {
  assert.equal(normalizeProblem({ id: "xx", statement: "short" }), null);
  assert.equal(normalizeProblem({ id: "1990-3", statement: "ok statement long enough" }).difficulty, "medium");
  const valid = normalizeProblem({
    id: "2001-1",
    statement: "Un enunciado suficientemente largo y correcto para validar.",
    topic: "algebra",
    difficulty: "hard",
    hints: ["h1"],
    solution: "solución completa de prueba",
    solutionType: "full",
  });
  assert.equal(valid.id, "2001-1");
  assert.equal(valid.solutionType, "full");
});

test("ingest + progress: validated growth and local ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "olimpo-store-"));
  const ingest = makeIngestStore(dir);
  const result = ingest.ingest([
    { id: "2050-1", statement: "Problema ingerido de prueba con enunciado largo.", solution: "sol", hints: ["h"] },
    { id: "bad", statement: "demasiado corto" },
  ]);
  assert.deepEqual(result.added, ["2050-1"]);
  assert.equal(result.rejected.length, 1);
  const dup = ingest.ingest([{ id: "2050-1", statement: "Otro enunciado largo de prueba para validar." }]);
  assert.equal(dup.rejected[0].reason, "duplicate");

  const progress = makeProgressStore(dir);
  progress.mark("1988-6", { status: "attempted", note: "casi, me falto el salto" });
  progress.mark("1988-6", { status: "solved" });
  const entries = progress.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "solved");
  rmSync(dir, { recursive: true, force: true });
});

test("mcp server: corpus + disclosure + checks — as a real child process", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "olimpo-mcp-"));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGENC_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const responses = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      responses.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  const tool = (name, args) =>
    call("tools/call", { name, arguments: args }).then(
      (r) => r.result?.structuredContent ?? r.result?.content?.[0]?.text ?? r.error,
    );
  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "olimpo");
    const catalog = await call("tools/list");
    const names = catalog.result.tools.map((t) => t.name);
    for (const expected of [
      "problems_list", "problem_search", "problem_get", "problem_random",
      "answer_check", "study_plan", "progress_mark", "progress_list", "ingest",
    ]) {
      assert.ok(names.includes(expected), `tool ${expected} listed`);
    }

    const list = await tool("problems_list", { topic: "number-theory" });
    assert.ok(list.count >= 3);

    const search = await tool("problem_search", { query: "vieta jumping" });
    assert.ok(search.problems.some((p) => p.id === "1988-6"));

    const statement = await tool("problem_get", { id: "1988-6" });
    assert.ok(statement.statement.includes("cuadrado perfecto"));
    assert.equal(statement.solution, undefined, "statement level does not leak the solution");
    const hint1 = await tool("problem_get", { id: "1988-6", level: "hint1" });
    assert.equal(hint1.hint, statement ? hint1.hint : null);
    assert.ok(hint1.hint.includes("cuadrática") || hint1.hint.includes("Vieta") || hint1.hint.includes("raíz"));
    const solution = await tool("problem_get", { id: "1988-6", level: "solution" });
    assert.equal(solution.solutionType, "full");
    assert.ok(solution.solution.includes("Vieta"));

    const check = await tool("answer_check", { id: "1964-1", attempt: "múltiplos de 3" });
    assert.equal(check.correct, true);
    const na = await tool("answer_check", { id: "1988-6", attempt: "42" });
    assert.equal(na.applicable, false);

    const plan = await tool("study_plan", { count: 3 });
    assert.equal(plan.plan.length, 3);

    const marked = await tool("progress_mark", { id: "1959-1", status: "solved", note: "primer problema de la historia" });
    assert.equal(marked.status, "solved");
    const ledger = await tool("progress_list", {});
    assert.equal(ledger.entries.length, 1);

    const ingested = await tool("ingest", {
      items: [{ id: "2050-1", statement: "Problema ingerido por el contrato con enunciado largo.", solution: "s" }],
    });
    assert.deepEqual(ingested.added, ["2050-1"]);
    const found = await tool("problem_get", { id: "2050-1" });
    assert.ok(found.statement.includes("contrato"));

    const unknown = await tool("problem_get", { id: "9999-9" });
    assert.match(unknown, /No problem/u);
    const rpc = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(rpc.error.code, -32602);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(responses.every((m) => m.id !== undefined), "no response to notifications");
  } finally {
    child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  }
});
