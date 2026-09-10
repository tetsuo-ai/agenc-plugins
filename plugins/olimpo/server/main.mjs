#!/usr/bin/env node
/**
 * Olympus MCP server - original exercises with progressive disclosure.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited),
 * fully offline. Retrieves the bundled exercises and worked solutions
 * instead of relying on model recall. Short-answer matching is textual,
 * not symbolic equivalence or proof verification. No network or state beyond the
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
const SERVER_INFO = { name: "olimpo", version: "0.2.4" };

const dataDir = resolveDataDir();
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");
const userCorpusPath = join(dataDir, "user-problems.json");
const progress = makeProgressStore(dataDir);
const ingest = makeIngestStore(dataDir, loadCorpus(corpusDir).map((p) => p.id));

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
    description: "Browse original exercises by topic or difficulty; year filters apply only to dated private imports. Returns titles, IDs and statement previews, never answers or solutions.",
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
    description: "Search exercise titles, statements, tags and key ideas: 'vieta', 'pigeonhole', 'incirculo', 'induccion'.",
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
    description: "One problem with PROGRESSIVE DISCLOSURE - the small-model discipline: level 'statement' (default) gives just the problem; 'hint1' gives the first hint; 'hints' all hints; 'keyIdea' the strategy; 'solution' the full solution (with solutionType 'full' or 'sketch' - say which it is when presenting). Never jump to 'solution' unless the user asked or failed after the hints.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "e.g. olimpo-nt-004" },
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
    description: "A random problem for practice, optionally filtered by topic and minimum difficulty. Random selection; no reproducible seed.",
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
    description: "Compare a short answer with recorded text after conservative normalization. Does not verify proofs or symbolic equivalence; a mismatch can be formatting. No recorded answer means not-applicable.",
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
    description: "Import 1–50 private exercises, with IDs such as user-my-exercise and a 20–20000 character statement; up to 500 total. Optional hints, solution, keyIdea, tags and difficulty. Always user-provided/unreviewed; never overwrites a bundled exercise.",
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

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function validateArguments(tool, args) {
  if (!object(args)) throw new Error("arguments must be an object");
  const schema = tool.inputSchema;
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(args, key)) throw new Error("missing argument: " + key);
  }
  for (const [key, value] of Object.entries(args)) {
    const field = schema.properties[key];
    if (!Object.hasOwn(schema.properties, key)) throw new Error("unknown argument: " + key);
    if (field.type === "string" && (typeof value !== "string" || !value.trim() || value.length > (key === "attempt" ? 1000 : key === "id" ? 64 : key === "note" ? 200 : 256))) throw new Error("invalid text argument: " + key);
    if (field.type === "number" && (!Number.isSafeInteger(value) || value < 1 || value > (key === "year" ? 9999 : key === "count" ? 10 : 100))) throw new Error("invalid integer argument: " + key);
    if (field.type === "array" && (!Array.isArray(value) || value.length < 1 || value.length > 50 || value.some(item => !object(item)))) throw new Error("items must contain 1 to 50 objects");
    if (field.enum && !field.enum.includes(value)) throw new Error("invalid choice: " + key);
  }
}

async function handleMessage(message) {
  if (message === null || typeof message !== "object") return null;
  const { id, method, params } = message;
  const isNotification = id === undefined;
  if (isNotification) return null;
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
      const args = params?.arguments === undefined ? {} : params.arguments;
      try { validateArguments(tool, args); }
      catch (error) { return reply(id, null, { code: -32602, message: error.message }); }
      const result = await tool.handler(args);
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
  let dropping = false;
  const maximumFrameBytes = 1024 * 1024;
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (dropping || Buffer.byteLength(line) > maximumFrameBytes) {
        dropping = false;
        process.stderr.write("olimpo: oversized request discarded\n");
        continue;
      }
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write("olimpo: invalid JSON\n");
        continue;
      }
      const response = await handleMessage(message);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
    if (Buffer.byteLength(buffer) > maximumFrameBytes) { buffer = ""; dropping = true; }
  }
}

main().catch((error) => {
  process.stderr.write(`olimpo fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
