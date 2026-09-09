#!/usr/bin/env node
/**
 * olimpo MCP server — the IMO corpus with progressive disclosure.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited),
 * fully offline. Designed for small local models (Qwen 27B/30B class):
 * the corpus carries the ground truth (statements, hint ladders, full
 * solutions of the classics), the model carries only the reasoning —
 * retrieval over recall, hints before solutions, deterministic answer
 * checking over trusted arithmetic. No network, no state beyond the
 * user's progress and ingested problems.
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOPICS,
  loadCorpus,
  problemAtLevel,
  searchProblems,
  checkAnswer,
  studyPlan,
  makeProgressStore,
  makeIngestStore,
} from "./corpus.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "olimpo", version: "0.2.1" };

const dataDir = resolveDataDir();
mkdirSync(dataDir, { recursive: true });
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");
const userCorpusPath = join(dataDir, "user-problems.json");
const progress = makeProgressStore(dataDir);
const ingest = makeIngestStore(dataDir);

function resolveDataDir() {
  if (process.env.AGENC_PLUGIN_DATA && process.env.AGENC_PLUGIN_DATA.trim() !== "") {
    return process.env.AGENC_PLUGIN_DATA;
  }
  return join(
    process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? ".", ".local", "share"),
    "agenc-plugins",
    "olimpo",
  );
}

function corpus() {
  return loadCorpus(corpusDir, userCorpusPath);
}

function findProblem(id) {
  return corpus().find((p) => p.id === String(id).trim()) ?? null;
}

const tools = [
  {
    name: "problems_list",
    description: "The IMO corpus: browse by topic (algebra, geometry, number-theory, combinatorics), year or difficulty. Returns id, title and statement head per problem — never full solutions.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: [...TOPICS, "other"] },
        year: { type: "number" },
        difficulty: { type: "string", enum: ["easy", "medium", "hard", "legendary"] },
        limit: { type: "number", description: "Default 20" },
      },
    },
    handler: async (args) => {
      const hits = searchProblems(corpus(), { ...args, query: undefined });
      return structured({ count: hits.length, problems: hits });
    },
  },
  {
    name: "problem_search",
    description: "Keyword search over titles, statements, tags and key ideas ('vieta', 'invariantes', 'frobenius', 'sophie germain'…).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topic: { type: "string", enum: [...TOPICS, "other"] },
      },
      required: ["query"],
    },
    handler: async ({ query, topic }) => {
      const hits = searchProblems(corpus(), { query, topic });
      return structured({ count: hits.length, problems: hits });
    },
  },
  {
    name: "problem_get",
    description: "One problem with PROGRESSIVE DISCLOSURE — the small-model discipline: level 'statement' (default) gives just the problem; 'hint1' gives the first hint; 'hints' all hints; 'keyIdea' the strategy; 'solution' the full solution (with solutionType 'full' or 'sketch' — say which it is when presenting). Never jump to 'solution' unless the user asked or failed after the hints.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "e.g. 1988-6" },
        level: { type: "string", enum: ["statement", "hint1", "hints", "keyIdea", "solution"] },
      },
      required: ["id"],
    },
    handler: async ({ id, level }) => {
      const problem = findProblem(id);
      if (problem === null) return text(`No problem with id '${id}'. Use problems_list or problem_search.`);
      return structured(problemAtLevel(problem, level));
    },
  },
  {
    name: "problem_random",
    description: "A random problem for practice, optionally filtered by topic and minimum difficulty. Deterministic per call seed — no hidden state.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: [...TOPICS, "other"] },
        minDifficulty: { type: "string", enum: ["easy", "medium", "hard", "legendary"] },
      },
    },
    handler: async ({ topic, minDifficulty }) => {
      const order = { easy: 0, medium: 1, hard: 2, legendary: 3 };
      const pool = corpus().filter((p) =>
        (topic === undefined || p.topic === topic)
        && (minDifficulty === undefined || (order[p.difficulty] ?? 1) >= order[minDifficulty]),
      );
      if (pool.length === 0) return text("No problem matches those filters.");
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return structured(problemAtLevel(pick, "statement"));
    },
  },
  {
    name: "answer_check",
    description: "Deterministic check of a short answer (numeric or expression) against the recorded one. Proof-type problems report not-applicable — verification then means reading the solution, not guessing.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        attempt: { type: "string" },
      },
      required: ["id", "attempt"],
    },
    handler: async ({ id, attempt }) => {
      const problem = findProblem(id);
      if (problem === null) return text(`No problem with id '${id}'.`);
      return structured(checkAnswer(problem, attempt));
    },
  },
  {
    name: "study_plan",
    description: "A deterministic practice session: problems ordered easy → hard within a topic (or mixed), ready to run one by one with the hint ladder.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: [...TOPICS, "other"] },
        count: { type: "number", description: "Default 5" },
      },
    },
    handler: async (args) => {
      return structured({ plan: studyPlan(corpus(), args) });
    },
  },
  {
    name: "progress_mark",
    description: "Mark a problem attempted / solved / learning for this user (local ledger, powers 'what should I practice next').",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["attempted", "solved", "learning"] },
        note: { type: "string" },
      },
      required: ["id", "status"],
    },
    handler: async ({ id, status, note }) => {
      const problem = findProblem(id);
      if (problem === null) return text(`No problem with id '${id}'.`);
      return structured(progress.mark(id, { status, note }));
    },
  },
  {
    name: "progress_list",
    description: "The user's progress ledger: what was attempted/solved, with dates and notes.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => structured({ entries: progress.list() }),
  },
  {
    name: "ingest",
    description: "Add problems to the corpus (local, in the plugin data dir): each item needs id 'YYYY-N', statement ≥ 20 chars, and optionally hints/solution/keyIdea/tags/difficulty. Grows the practice set without touching the shipped corpus.",
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object" } },
      },
      required: ["items"],
    },
    handler: async ({ items }) => {
      const result = ingest.ingest(items);
      if (result.added.length === 0 && result.rejected.length > 0) {
        return text(`Nothing ingested: ${JSON.stringify(result.rejected)}`);
      }
      return structured(result);
    },
  },
];

function text(value) {
  return { content: [{ type: "text", text: String(value) }] };
}

function structured(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

async function handleMessage(message) {
  if (message === null || typeof message !== "object") return null;
  const { id, method, params } = message;
  const isNotification = id === undefined;
  try {
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
      return reply(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const name = params?.name;
      const tool = toolByName.get(name);
      if (tool === undefined) {
        return isNotification ? null : reply(id, null, { code: -32602, message: `unknown tool: ${name}` });
      }
      const result = await tool.handler(params?.arguments ?? {});
      return isNotification ? null : reply(id, result);
    }
    return isNotification ? null : reply(id, null, { code: -32601, message: `method not found: ${method}` });
  } catch (error) {
    if (isNotification) return null;
    return reply(id, null, {
      code: -32000,
      message: `tool error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function reply(id, result, error) {
  const response = { jsonrpc: "2.0", id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  return response;
}

async function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write(`olimpo: unparseable line: ${line.slice(0, 120)}\n`);
        continue;
      }
      const response = await handleMessage(message);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`olimpo fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
