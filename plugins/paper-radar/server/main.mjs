#!/usr/bin/env node
/**
 * paper-radar MCP server.
 *
 * Zero-dependency stdio MCP server (JSON-RPC 2.0, newline-delimited),
 * fully offline: no network calls, no telemetry, nothing leaves the
 * machine. Parsing is deterministic inside the tools so the plugin works
 * efficiently with small local models - the model only ever sees compact
 * structured candidates and acts with strict-validation tools, never raw
 * document bodies. State is a local JSON ledger plus exported .ics files
 * under the plugin data directory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractCandidates } from "./extract.mjs";
import { CATEGORIES, PERIODS, normalizeEntry, radarRows } from "./ledger.mjs";
import { makeStores } from "./stores.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "paper-radar", version: "0.2.5" };

const dataDir = resolveDataDir();
const stores = makeStores(dataDir);
mkdirSync(join(dataDir, "exports"), { recursive: true, mode: 0o700 });

function resolveDataDir() {
  if (process.env.AGENC_PLUGIN_DATA && process.env.AGENC_PLUGIN_DATA.trim() !== "") {
    return process.env.AGENC_PLUGIN_DATA;
  }
  return join(
    process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? ".", ".local", "share"),
    "agenc-plugins",
    "paper-radar",
  );
}

let counter = 0;
function newId() {
  counter += 1;
  return `item_${Date.now().toString(36)}_${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const tools = [
  {
    name: "ingest_extract",
    description: "Deterministic candidate extraction from one document's text (run pdftotext first for PDFs). Returns compact structured candidates - dates with relevance to expiry/renewal language, amounts with per-period hints, cancellation-notice windows, periodicity, and kind guesses - with short context snippets only. Never returns or stores the full document.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The document's extracted plain text" },
      },
      required: ["text"],
    },
    handler: async ({ text: documentText }) => {
      const body = typeof documentText === "string" ? documentText : "";
      if (body.trim().length < 20) {
        return text("Text too short to extract anything (need at least 20 characters). Did pdftotext produce output?");
      }
      const candidates = extractCandidates(body.slice(0, 100_000));
      return structured({
        ...candidates,
        hint: "Pick the renewal/expiry date with the highest relevance; confirm with the user only when the top candidates tie or notice windows conflict.",
      });
    },
  },
  {
    name: "ledger_upsert",
    description: "Create or update one ledger entry. Strict validation with actionable errors; derives nextDue, noticeDeadline and annualCost automatically from anchorDate, period and noticeDays. Do not compute those by hand.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing entry id to update; omit to create" },
        title: { type: "string", description: "Human name, e.g. 'Car insurance - Mapfre'" },
        category: { type: "string", enum: CATEGORIES },
        period: { type: "string", enum: PERIODS },
        anchorDate: { type: "string", description: "ISO date of the next/renewal date found in the document (YYYY-MM-DD)" },
        noticeDays: { type: "number", description: "Days of cancellation notice the contract requires, if any" },
        cost: { type: "number", description: "Recurring cost per costPeriod" },
        costPeriod: { type: "string", enum: ["week", "month", "quarter", "year"] },
        currency: { type: "string", description: "3-letter code (EUR, USD...)" },
        counterparty: { type: "string" },
        language: { type: "string", enum: ["es", "en"] },
        notes: { type: "string" },
        evidence: { type: "array", items: { type: "string" }, description: "Up to 5 short context snippets as proof; capped at 160 chars each" },
        sourceFile: { type: "string", description: "File name the entry came from" },
        status: { type: "string", enum: ["active", "cancelled"] },
      },
      description: "New entries require title, category and anchorDate. Updates require id and the fields to change.",
    },
    handler: async (args) => stores.withWriteLock(() => {
      const entries = stores.loadLedger();
      const previous = args.id ? entries.find((entry) => entry.id === args.id) : undefined;
      const normalized = normalizeEntry({ ...previous, ...args });
      if (normalized.error !== undefined) return text(`Invalid entry: ${normalized.error}`);
      let entry = normalized.entry;
      let updated = false;
      if (entry.id !== null) {
        const index = entries.findIndex((candidate) => candidate.id === entry.id);
        if (index === -1) return text(`No ledger entry with id '${entry.id}'. Omit id to create.`);
        entry = { ...entries[index], ...entry, id: entry.id };
        entries[index] = entry;
        updated = true;
      } else {
        entry = { ...entry, id: newId() };
        entries.push(entry);
      }
      stores.saveLedger(entries);
      return structured({
        id: entry.id,
        created: !updated,
        entry,
        derived: normalized.derived,
      });
    }),
  },
  {
    name: "ledger_list",
    description: "All ledger entries (or one by id), with derived nextDue and noticeDeadline.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
      },
    },
    handler: async ({ id, category }) => {
      let entries = stores.loadLedger();
      if (id !== undefined && id !== null) {
        entries = entries.filter((entry) => entry.id === id);
        if (entries.length === 0) return text(`No ledger entry with id '${id}'.`);
      }
      if (category !== undefined && category !== null) {
        entries = entries.filter((entry) => entry.category === category);
      }
      const { todayIso, nextOccurrence, addDaysIso } = await import("./extract.mjs");
      const today = todayIso();
      return structured({
        count: entries.length,
        today,
        entries: entries.map((entry) => ({
          ...entry,
          nextDue: nextOccurrence(entry.anchorDate, entry.period, today),
          noticeDeadline: entry.noticeDays != null
            ? addDaysIso(nextOccurrence(entry.anchorDate, entry.period, today) ?? entry.anchorDate, -entry.noticeDays)
            : null,
        })),
      });
    },
  },
  {
    name: "ledger_remove",
    description: "Remove one entry by id (prefer status 'cancelled' to keep history; use this only for mistakes).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async ({ id }) => stores.withWriteLock(() => {
      const entries = stores.loadLedger();
      const remaining = entries.filter((entry) => entry.id !== id);
      if (remaining.length === entries.length) return text(`No ledger entry with id '${id}'.`);
      stores.saveLedger(remaining);
      return text(`Removed ${id}.`);
    }),
  },
  {
    name: "radar",
    description: "The urgency sweep: everything due within a horizon (default 30 days), sorted, with notice-window status. 'critical' = the cancellation notice window is already open (or due within 7 days) - those need action TODAY even if renewal is weeks away.",
    inputSchema: {
      type: "object",
      properties: { horizonDays: { type: "number", description: "Default 30" } },
    },
    handler: async ({ horizonDays }) => {
      const horizon = Number.isFinite(horizonDays) ? Math.min(Math.max(horizonDays, 1), 365) : 30;
      const rows = radarRows(stores.loadLedger(), { horizonDays: horizon });
      return structured({
        horizonDays: horizon,
        count: rows.length,
        critical: rows.filter((row) => row.urgency === "critical").length,
        rows,
      });
    },
  },
  {
    name: "cost_report",
    description: "Recurring-cost totals by category from active entries (monthly and annualized). Shows what renewal season actually costs.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const entries = stores.loadLedger().filter((entry) => entry.status !== "cancelled" && entry.cost !== undefined);
      const byCategory = new Map();
      const totals = new Map();
      const seen = new Set();
      for (const entry of entries) {
        const annual = annualizeEntry(entry);
        if (annual === null) continue;
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + annual);
        const key = `${entry.currency}:${entry.category}`;
        const bucket = byCategory.get(key) ?? { category: entry.category, currency: entry.currency, annual: 0, items: 0 };
        bucket.annual += annual;
        bucket.items += 1;
        byCategory.set(key, bucket);
      }
      return structured({
        currency: totals.size === 1 ? [...totals.keys()][0] : null,
        monthlyTotal: totals.size === 1 ? round2([...totals.values()][0] / 12) : null,
        annualTotal: totals.size === 1 ? round2([...totals.values()][0]) : null,
        totalsByCurrency: [...totals].map(([currency, annual]) => ({ currency, annual: round2(annual), monthly: round2(annual / 12) })),
        byCategory: [...byCategory.values()]
          .map((bucket) => ({
            category: bucket.category,
            currency: bucket.currency,
            items: bucket.items,
            annual: round2(bucket.annual),
          }))
          .sort((a, b) => b.annual - a.annual),
        biggest: entries
          .filter((entry) => annualizeEntry(entry) !== null)
          .map((entry) => ({ id: entry.id, title: entry.title, currency: entry.currency, annual: round2(annualizeEntry(entry)) }))
          .sort((a, b) => b.annual - a.annual)
          .slice(0, 5),
      });
    },
  },
  {
    name: "cancel_draft",
    description: "Draft an English cancellation notice (email or letter) for one entry from ledger data using a deterministic template. The source document language is preserved as metadata. Returns the draft text; the user sends it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        senderName: { type: "string", description: "Full name of the account holder" },
        accountRef: { type: "string", description: "Policy/account number if known" },
        channel: { type: "string", enum: ["email", "letter"], description: "Default email" },
      },
      required: ["id", "senderName"],
    },
    handler: async ({ id, senderName, accountRef, channel }) => {
      const entry = stores.loadLedger().find((candidate) => candidate.id === id);
      if (entry === undefined) return text(`No ledger entry with id '${id}'.`);
      const { todayIso, nextOccurrence } = await import("./extract.mjs");
      const today = todayIso();
      const nextDue = nextOccurrence(entry.anchorDate, entry.period, today) ?? entry.anchorDate;
      const draft = renderCancelDraft({
        entry,
        senderName: String(senderName ?? "").trim(),
        accountRef: accountRef === undefined || accountRef === null ? null : String(accountRef).trim(),
        channel: channel === "letter" ? "letter" : "email",
        today,
        nextDue,
      });
      return structured({ id, today, nextDue, language: "en", sourceLanguage: entry.language, draft });
    },
  },
  {
    name: "ics_export",
    description: "Write a calendar file with one VEVENT per active entry (alarm at the notice deadline when present, else 7 days before). Returns the .ics path.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Export just this entry" },
        years: { type: "number", description: "Project this many years ahead for periodic items (default 2)" },
      },
    },
    handler: async ({ id, years }) => {
      const span = Number.isFinite(years) ? Math.min(Math.max(years, 1), 5) : 2;
      let entries = stores.loadLedger().filter((entry) => entry.status !== "cancelled");
      if (id !== undefined && id !== null) {
        entries = entries.filter((entry) => entry.id === id);
        if (entries.length === 0) return text(`No ledger entry with id '${id}'.`);
      }
      if (entries.length === 0) return text("Ledger is empty; nothing to export.");
      const { todayIso, nextOccurrence } = await import("./extract.mjs");
      const today = todayIso();
      const limit = new Date(Date.parse(`${today}T00:00:00Z`) + span * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const events = [];
      for (const entry of entries) {
        let due = nextOccurrence(entry.anchorDate, entry.period, today);
        let guard = 0;
        while (due !== null && due <= limit && guard < 270) {
          events.push({ entry, due });
          due = entry.period === "one_time"
            ? null
            : nextOccurrence(entry.anchorDate, entry.period, addDay(due));
          guard += 1;
        }
      }
      if (events.length === 0) return text("No upcoming dates within the export window.");
      const file = join(dataDir, "exports", `paper-radar-${today}.ics`);
      writeFileSync(file, renderIcs(events, today), { mode: 0o600 });
      return structured({ path: file, events: events.length, spanYears: span });
    },
  },
];

function addDay(iso) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function annualizeEntry(entry) {
  const costPeriod = entry.costPeriod ?? ({ weekly: "week", monthly: "month", quarterly: "quarter", annual: "year" }[entry.period] ?? null);
  if (costPeriod === null) return null;
  if (costPeriod === "week") return entry.cost * 52;
  if (costPeriod === "month") return entry.cost * 12;
  if (costPeriod === "quarter") return entry.cost * 4;
  return entry.cost;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function renderCancelDraft({ entry, senderName, accountRef, channel, today, nextDue }) {
  const who = entry.counterparty ?? "customer service";
  const ref = accountRef ?? "";
  const refLine = ref ? `Account/policy reference: ${ref}` : "";
  const subject = `Cancellation notice - ${entry.title}${ref ? ` (${ref})` : ""}`;
  const body = [
    `Dear ${who},`,
    "",
    `I, ${senderName}, hereby give notice of cancellation for the following agreement effective before its next renewal date of ${nextDue}:`,
    `  ${entry.title}`,
    refLine,
    "",
    `Please confirm in writing that this agreement will not renew and that no further charges will be applied. If any cancellation notice period applies, treat this letter as notice given on ${today}.`,
    "",
    "Sincerely,",
    senderName,
  ].filter((line) => line !== "").join("\n");
  return channel === "email"
    ? `Subject: ${subject}\n\n${body}`
    : `${senderName}\n${today}\n\n${subject}\n\n${body}`;
}

function renderIcs(events, today) {
  const stamp = `${today.replaceAll("-", "")}T090000Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//tetsuo-ai//paper-radar//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const { entry, due } of events) {
    const day = due.replaceAll("-", "");
    const alarmDays = entry.noticeDays ?? 7;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(entry.id)}-${day}@paper-radar`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${icsEscape(entry.title)} - ${entry.period === "one_time" ? "deadline" : "renewal"}`,
      `DESCRIPTION:${icsEscape(`paper-radar: ${entry.title}. ${entry.noticeDays ? `Notice period ${entry.noticeDays} days - cancel by ${alarmDate(due, entry.noticeDays)}.` : "No notice period recorded."}`)}`,
      "BEGIN:VALARM",
      `TRIGGER:-P${alarmDays}D`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(entry.title)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function alarmDate(due, noticeDays) {
  return new Date(Date.parse(`${due}T00:00:00Z`) - noticeDays * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

function icsEscape(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r\n?|\n/gu, "\\n");
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
        process.stderr.write("paper-radar: invalid JSON-RPC input\n");
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
  process.stderr.write(`paper-radar fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
