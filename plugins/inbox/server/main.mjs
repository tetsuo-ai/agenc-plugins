#!/usr/bin/env node
/**
 * inbox MCP server - the Gmail copilot.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited).
 * Read-only against Gmail: OAuth2
 * with a local loopback redirect, tokens stored only in the plugin data
 * directory. The differentiators run deterministically inside the tools:
 * a local sender-trust graph, a relationship-ranked digest, the social
 * commitments layer (waiting-on, reply debt, promise candidates), the
 * attachment vault, newsletter archaeology, and the paper-radar document
 * bridge. API endpoints are injectable so the full flow works offline
 * against a local mock.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeOAuth } from "./oauth.mjs";
import { makeGmail } from "./gmail.mjs";
import {
  attachments as mimeAttachments,
  bodyText,
  emailAddress,
  header,
  listUnsubscribe,
} from "./mime.mjs";
import { extractDates } from "./dates.mjs";
import { buildGraph, digestRows } from "./graph.mjs";
import { commitmentCandidates, replyDebtRows, waitingOnRows } from "./loops.mjs";
import { cleanupRows } from "./cleanup.mjs";
import { makeVault } from "./vault.mjs";
import { documentRows, eventRows } from "./bridge.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "inbox", version: "0.2.4" };

const dataDir = resolveDataDir();
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const apiBase = process.env.INBOX_API_BASE || undefined;
const authBase = process.env.INBOX_AUTH_BASE || undefined;
const oauth = makeOAuth({
  dataDir,
  ...(authBase !== undefined ? { authBase, tokenUrl: `${authBase.replace(/\/$/u, "")}/oauth2/v4/token`, profileUrl: `${authBase.replace(/\/$/u, "")}/v3/userinfo` } : {}),
});
const gmail = makeGmail({
  accessToken: () => oauth.accessToken(),
  ...(apiBase !== undefined ? { apiBase } : {}),
});
const vault = makeVault(dataDir);

function resolveDataDir() {
  if (process.env.AGENC_PLUGIN_DATA && process.env.AGENC_PLUGIN_DATA.trim() !== "") {
    return process.env.AGENC_PLUGIN_DATA;
  }
  return join(
    process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? ".", ".local", "share"),
    "agenc-plugins",
    "inbox",
  );
}

const ME_LABELS = { inbox: "INBOX", sent: "SENT" };

/**
 * Fetch and analyze recent messages. `query` supports native Gmail syntax;
 * `box` selects inbox vs sent (direction), both feed the graph.
 */
async function analyzeMessages({ box = "in", days = 14, max = 40, query: extra } = {}) {
  const query = [`newer_than:${days}d`, extra].filter(Boolean).join(" ");
  const refs = await gmail.listAll({
    query: `${query} ${box === "out" ? "in:sent" : "in:inbox"}`,
    max,
  });
  const graphRecords = [];
  const analyzed = [];
  for (const ref of refs) {
    try {
      const message = await gmail.getMessage(ref.id, { format: "full" });
      const from = emailAddress(header(message.payload, "From") ?? "");
      const tos = (header(message.payload, "To") ?? "")
        .split(",")
        .map((entry) => emailAddress(entry))
        .filter(Boolean);
      const subject = header(message.payload, "Subject") ?? "(no subject)";
      const text = bodyText(message.payload, message.snippet ?? "");
      const attachments = mimeAttachments(message.payload);
      const unsubscribe = listUnsubscribe(message.payload);
      const date = message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : (header(message.payload, "Date") ?? "");
      const labels = message.labelIds ?? [];
      const record = {
        direction: box === "out" ? "out" : "in",
        from,
        tos: box === "out" ? tos : [],
        date,
        bulk: unsubscribe !== null,
      };
      graphRecords.push(record);
      analyzed.push({
        messageId: message.id,
        threadId: message.threadId,
        direction: record.direction,
        from,
        tos,
        to: tos.join(", "),
        subject,
        date,
        text,
        attachments,
        unsubscribe,
        dates: extractDates(`${subject}\n${text}`).slice(0, 4),
        labels,
        unread: labels.includes("UNREAD"),
      });
    } catch (error) {
      // One bad message must not sink the sweep.
      process.stderr.write(`inbox: skipping message ${ref.id}: ${error instanceof Error ? error.message : error}\n`);
    }
  }
  return { graphRecords, analyzed };
}

function graphTierMap(graph, address) {
  const entry = graph.find((candidate) => candidate.address === address);
  return entry?.tier ?? "cold";
}

async function threadsForLoops({ days, max = 60 }) {
  const refs = await gmail.listAll({ query: `newer_than:${days}d {in:inbox in:sent}`, max });
  const threads = new Map();
  for (const ref of refs) {
    if (threads.has(ref.threadId)) continue;
    try {
      const thread = await gmail.getThread(ref.threadId);
      const messages = thread.messages ?? [];
      const last = [...messages].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)).at(-1);
      if (last === undefined) continue;
      const from = emailAddress(header(last.payload, "From") ?? "");
      const lastIsMine = (last.labelIds ?? []).includes(ME_LABELS.sent);
      threads.set(ref.threadId, {
        threadId: ref.threadId,
        subject: header(last.payload, "Subject") ?? "(no subject)",
        lastDirection: lastIsMine ? "out" : "in",
        lastContact: lastIsMine
          ? (header(last.payload, "To") ?? "").split(",")[0]?.trim() ?? from
          : from,
        lastSenderTier: null,
        lastText: bodyText(last.payload, last.snippet ?? ""),
        lastDate: last.internalDate ? new Date(Number(last.internalDate)).toISOString() : "",
        messages,
      });
    } catch (error) {
      process.stderr.write(`inbox: skipping thread ${ref.threadId}: ${error instanceof Error ? error.message : error}\n`);
    }
  }
  return [...threads.values()];
}

const tools = [
  {
    name: "auth_store_credentials",
    description: "Store your own Google Cloud OAuth client (Desktop type) credentials locally. One-time setup: console.cloud.google.com → APIs & Services → Credentials → Create OAuth client (Desktop) with the Gmail API enabled in the project.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        clientSecret: { type: "string" },
      },
      required: ["clientId", "clientSecret"],
    },
    handler: async (args) => {
      const result = oauth.storeCredentials(args);
      if (result.error !== undefined) return text(`Invalid credentials: ${result.error}`);
      return structured(result);
    },
  },
  {
    name: "auth_begin",
    description: "Start the Gmail consent flow: returns a URL for the user to open in their browser. Google redirects to a local loopback on this machine; completion is captured in the background. Poll auth_status until connected:true.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const result = await oauth.beginFlow();
      if (result.error !== undefined) return text(result.error);
      return structured(result);
    },
  },
  {
    name: "auth_status",
    description: "Connection state: credentials stored, connected account email, token expiry, pending consent URL, and setup hints including the weekly re-auth note for Testing-mode Google Cloud apps.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => structured(oauth.status()),
  },
  {
    name: "auth_disconnect",
    description: "Erase the stored tokens (credentials remain). Use to reset the connection.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => structured(oauth.disconnect()),
  },
  {
    name: "digest",
    description: "The daily sweep: unread inbox messages ranked by RELATIONSHIP (local trust graph) and deterministic action signals - dates, questions, keywords es/en, attachments. Bulk senders suppressed unless security/transactional. Returns why each row surfaced.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "History window for the graph + unread scan (default 30)" },
        limit: { type: "number", description: "Max rows (default 8)" },
      },
    },
    handler: async ({ days, limit }) => {
      const window = clamp(days ?? 30, 1, 90);
      const [{ graphRecords, analyzed }, sent] = await Promise.all([
        analyzeMessages({ box: "in", days: window, max: 60 }),
        analyzeMessages({ box: "out", days: window, max: 40 }),
      ]);
      const graph = buildGraph([...graphRecords, ...sent.graphRecords]);
      const unread = analyzed
        .filter((message) => message.unread)
        .map((message) => ({ ...message, senderTier: graphTierMap(graph, message.from) }));
      const rows = digestRows(unread, { limit: clamp(limit ?? 8, 1, 25) });
      return structured({
        asOf: new Date().toISOString(),
        scanned: analyzed.length,
        unread: unread.length,
        graphSummary: summarizeGraph(graph),
        rows,
      });
    },
  },
  {
    name: "search",
    description: "Native Gmail search passthrough (from:, has:attachment, newer_than:...) returning analyzed summaries: sender, subject, snippet, attachments, detected dates.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search syntax" },
        max: { type: "number", description: "Default 20" },
      },
      required: ["query"],
    },
    handler: async ({ query, max }) => {
      const refs = await gmail.listAll({ query, max: clamp(max ?? 20, 1, 50) });
      const out = [];
      for (const ref of refs) {
        const message = await gmail.getMessage(ref.id, { format: "full" });
        out.push({
          messageId: message.id,
          threadId: message.threadId,
          from: emailAddress(header(message.payload, "From") ?? ""),
          subject: header(message.payload, "Subject") ?? "(no subject)",
          date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
          snippet: (message.snippet ?? bodyText(message.payload)).slice(0, 200),
          attachments: mimeAttachments(message.payload).map((a) => a.filename),
          unread: (message.labelIds ?? []).includes("UNREAD"),
        });
      }
      return structured({ count: out.length, messages: out });
    },
  },
  {
    name: "read",
    description: "Full body text of one message (plain-text rendering) with attachment metadata and detected dates.",
    inputSchema: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
    handler: async ({ messageId }) => {
      const message = await gmail.getMessage(messageId, { format: "full" });
      return structured({
        messageId: message.id,
        threadId: message.threadId,
        from: header(message.payload, "From"),
        to: header(message.payload, "To"),
        subject: header(message.payload, "Subject"),
        date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
        text: bodyText(message.payload, message.snippet ?? "").slice(0, 8000),
        attachments: mimeAttachments(message.payload),
        dates: extractDates(bodyText(message.payload, message.snippet ?? "")).slice(0, 6),
      });
    },
  },
  {
    name: "loops_scan",
    description: "The social commitments layer over recent mail: (1) waiting-on - threads where you asked last and got silence, with aging; (2) reply debt - known humans awaiting your answer; (3) commitment candidates - your outbound promises paired with dates, as evidence for the user to confirm.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Default 21" } },
    },
    handler: async ({ days }) => {
      const window = clamp(days ?? 21, 1, 90);
      const [inbox, sent] = await Promise.all([
        analyzeMessages({ box: "in", days: window, max: 50 }),
        analyzeMessages({ box: "out", days: window, max: 30 }),
      ]);
      const graph = buildGraph([...inbox.graphRecords, ...sent.graphRecords]);
      const threads = await threadsForLoops({ days: window });
      for (const thread of threads) {
        thread.lastSenderTier = graphTierMap(graph, emailAddress(thread.lastContact));
      }
      const waiting = waitingOnRows(threads, { now: new Date() });
      const debt = replyDebtRows(
        inbox.analyzed.map((message) => ({
          ...message,
          senderTier: graphTierMap(graph, message.from),
          answered: threads.some((thread) => thread.threadId === message.threadId && thread.messages.some((reply) => (reply.labelIds ?? []).includes("SENT") && Number(reply.internalDate) > Date.parse(message.date))),
        })),
        { now: new Date() },
      );
      const promises = commitmentCandidates(sent.analyzed, { extractDatesImpl: extractDates });
      return structured({
        days: window,
        waitingOn: waiting,
        replyDebt: debt,
        commitmentCandidates: promises.slice(0, 12),
      });
    },
  },
  {
    name: "graph_stats",
    description: "Your local sender-trust graph: tier counts, top contacts by exchange volume. Built from your own history - computed locally; tool results are shared with the host chat model.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Default 60" } },
    },
    handler: async ({ days }) => {
      const window = clamp(days ?? 60, 1, 180);
      const [inbox, sent] = await Promise.all([
        analyzeMessages({ box: "in", days: window, max: 80 }),
        analyzeMessages({ box: "out", days: window, max: 50 }),
      ]);
      const graph = buildGraph([...inbox.graphRecords, ...sent.graphRecords]);
      return structured({ days: window, summary: summarizeGraph(graph), top: graph.slice(0, 15) });
    },
  },
  {
    name: "cleanup_scan",
    description: "Newsletter/notification archaeology: per-sender volume with List-Unsubscribe evidence, ranked into a kill-list. The plugin never unsubscribes itself - it reports with evidence.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Default 90" },
        minMessages: { type: "number", description: "Default 3" },
      },
    },
    handler: async ({ days, minMessages }) => {
      const window = clamp(days ?? 90, 1, 365);
      const { graphRecords, analyzed } = await analyzeMessages({ box: "in", days: window, max: 150 });
      void graphRecords;
      const records = analyzed.map((message) => ({
        direction: "in",
        from: message.from,
        subject: message.subject,
        date: message.date,
        unsubscribe: message.unsubscribe,
      }));
      return structured({ days: window, killList: cleanupRows(records, { minMessages: clamp(minMessages ?? 3, 1, 50) }) });
    },
  },
  {
    name: "documents_scan",
    description: "paper-radar bridge: finds emails that ARE documents (renewals, policies, invoices) and emits ingestText ready for paper-radar's ingest_extract; also surfaces event-like emails (flights, bookings, appointments) with extracted dates for calendar follow-up.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Default 30" } },
    },
    handler: async ({ days }) => {
      const window = clamp(days ?? 30, 1, 120);
      const { analyzed } = await analyzeMessages({ box: "in", days: window, max: 80 });
      return structured({
        days: window,
        documents: documentRows(analyzed),
        events: eventRows(analyzed, { extractDatesImpl: extractDates }),
      });
    },
  },
  {
    name: "vault_fetch",
    description: "Download one attachment into the local vault (content-hashed, indexed by sender/date/name). Explicit only - nothing downloads behind your back.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        attachmentId: { type: "string" },
        filename: { type: "string", description: "Which attachment when several" },
      },
      required: ["messageId"],
    },
    handler: async ({ messageId, attachmentId, filename }) => {
      const message = await gmail.getMessage(messageId, { format: "full" });
      const files = mimeAttachments(message.payload);
      const target = attachmentId !== undefined
        ? files.find((file) => file.attachmentId === attachmentId)
        : filename !== undefined
          ? files.find((file) => file.filename === filename)
          : files[0];
      if (target === undefined) return text("No matching attachment on that message.");
      if (target.sizeBytes > 25 * 1024 * 1024) return text("Attachment exceeds the 25 MiB vault limit.");
      if (target.attachmentId === null) return text(`Attachment ${target.filename} has no separate payload (inline).`);
      const payload = await gmail.getAttachment(messageId, target.attachmentId);
      const buffer = Buffer.from(payload.data, "base64");
      const stored = vault.store({
        buffer,
        filename: target.filename,
        mimeType: target.mimeType,
        from: emailAddress(header(message.payload, "From") ?? ""),
        date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
        messageId,
      });
      return structured({ ...stored, filename: target.filename });
    },
  },
  {
    name: "vault_search",
    description: "Search the local attachment vault: name/from terms, sender filter, date floor. 'The PDF Alex sent in March' is one call.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        from: { type: "string" },
        after: { type: "string", description: "ISO date floor" },
      },
    },
    handler: async (args) => structured({ results: vault.search(args), stats: vault.stats() }),
  },
];

function summarizeGraph(graph) {
  const tiers = { inner: 0, personal: 0, bulk: 0, cold: 0 };
  for (const entry of graph) tiers[entry.tier] = (tiers[entry.tier] ?? 0) + 1;
  return { senders: graph.length, tiers };
}

function clamp(value, min, max) {
  return Math.floor(Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)));
}

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
        process.stderr.write("inbox: invalid JSON-RPC input\n");
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
  process.stderr.write(`inbox fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
