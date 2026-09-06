/**
 * Paper Radar contract tests: the deterministic extraction engine against
 * Spanish and English document fixtures, ledger validation and derived
 * deadlines, radar urgency ordering, ICS and cancellation drafts, plus the
 * MCP stdio server exercised as a real child process. Fully offline.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractAmounts,
  extractCandidates,
  extractDates,
  extractDurations,
  extractNoticeWindows,
  nextOccurrence,
  daysBetween,
  addDaysIso,
  todayIso,
} from "../plugins/paper-radar/server/extract.mjs";
import { normalizeEntry, radarRows } from "../plugins/paper-radar/server/ledger.mjs";

const SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "plugins",
  "paper-radar",
  "server",
  "main.mjs",
);

test("extract: Spanish dates across formats", () => {
  const text = "Renovación: 30 de septiembre de 2026. Vence 30/09/2026. Firmado el 15-01-26.";
  const dates = extractDates(text);
  const isos = dates.map((d) => d.iso);
  assert.ok(isos.includes("2026-09-30"), `long Spanish form parsed (${isos.join()})`);
  assert.ok(isos.includes("2026-01-15"), `numeric day-first parsed under Spanish bias (${isos.join()})`);
  const ambiguous = dates.find((d) => d.match === "15-01-26");
  assert.equal(ambiguous.ambiguousOrder, false, "Spanish bias marks day-first as unambiguous");
});

test("extract: English dates and month-first default", () => {
  const text = "Expires September 30, 2026. Effective March 5 2025. Signed 09/15/2026.";
  const dates = extractDates(text);
  const isos = dates.map((d) => d.iso);
  assert.ok(isos.includes("2026-09-30"), "US long form parsed");
  assert.ok(isos.includes("2025-03-05"), "month-first without comma parsed");
  assert.ok(isos.includes("2026-09-15"), "unambiguous m/d (day>12) resolved correctly");
});

test("extract: durations including written numbers", () => {
  const durations = extractDurations("requiere un preaviso de 30 días y thirty (30) days notice y 2 semanas");
  const days = durations.map((d) => d.days).sort((a, b) => a - b);
  assert.deepEqual(days, [14, 30, 30]);
});

test("extract: amounts keep currency and per-period, reject date fragments", () => {
  const text = [
    "PÓLIZA — renovará el 30 de septiembre de 2026.",
    "Prima anual: 412,50 € (cuatrocientos doce euros).",
    "Cuota mensual de 29,99 € IVA incluido.",
    "Total USD 1,299.99 per annum. Página 7 de 12.",
  ].join("\n");
  const amounts = extractAmounts(text);
  const matches = amounts.map((a) => a.match);
  assert.ok(matches.includes("412,50 €"), `European decimal parsed (${matches})`);
  assert.ok(matches.includes("29,99 €"), `monthly fee parsed (${matches})`);
  const usd = amounts.find((a) => a.currency === "USD");
  assert.equal(usd.value, 1299.99);
  assert.ok(!matches.some((m) => /^[0-9]{1,2}$/.test(m)), `no bare date fragments (${matches})`);
  assert.ok(!matches.includes("7") && !matches.includes("12"), "page numbers excluded");
});

test("extract: notice windows pair durations with notice language (es/en)", () => {
  const es = extractNoticeWindows(
    "El tomador deberá comunicar la no renovación con un preaviso mínimo de 30 días antes del vencimiento.",
  );
  assert.equal(es[0]?.days, 30);
  const en = extractNoticeWindows(
    "Either party may terminate with thirty (30) days written notice prior to the renewal date.",
  );
  assert.equal(en[0]?.days, 30);
  const notNotice = extractNoticeWindows("El plazo del contrato es de 365 días.");
  assert.equal(notNotice.length, 0, "plain durations are not notice windows");
});

test("extract: full Spanish insurance document produces the right candidates", () => {
  const doc = [
    "PÓLIZA DE SEGURO DE AUTOMÓVIL",
    "Compañía Aseguradora: MAPFRE ESPAÑA, S.A.",
    "La presente póliza se renovará automáticamente el 30 de septiembre de 2026.",
    "Prima anual: 412,50 €.",
    "El tomador deberá comunicar la no renovación con un preaviso mínimo de 30 días antes de la fecha de vencimiento.",
  ].join("\n");
  const candidates = extractCandidates(doc);
  assert.equal(candidates.dates[0].iso, "2026-09-30");
  assert.ok(candidates.dates[0].relevance >= 2, "renewal date scores relevance");
  assert.equal(candidates.noticeWindows[0].days, 30);
  assert.equal(candidates.periodicity.period, "annual");
  assert.equal(candidates.kinds[0].kind, "insurance");
});

test("ledger: strict validation errors are actionable", () => {
  const bad = normalizeEntry({ title: "x", category: "nope", anchorDate: "30/09/2026", noticeDays: 900 });
  assert.match(bad.error, /title is required/u);
  assert.match(bad.error, /category must be one of/u);
  assert.match(bad.error, /anchorDate must be an ISO date/u);
  assert.match(bad.error, /noticeDays must be an integer between 1 and 365/u);
});

test("ledger: derives nextDue, noticeDeadline and annualized cost", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const ok = normalizeEntry(
    {
      title: "Car insurance — Mapfre",
      category: "insurance",
      period: "annual",
      anchorDate: "2026-09-30",
      noticeDays: 30,
      cost: 412.5,
      costPeriod: "year",
      currency: "EUR",
      evidence: ["renovará automáticamente el 30 de septiembre de 2026. Prima anual: 412,50 €.".repeat(10)],
    },
    { now },
  );
  assert.equal(ok.error, undefined);
  assert.equal(ok.derived.nextDue, "2026-09-30");
  assert.equal(ok.derived.noticeDeadline, "2026-08-31");
  assert.equal(ok.derived.annualCost, 412.5);
  assert.ok(ok.entry.evidence[0].length <= 160, "evidence snippets are capped");

  const monthly = normalizeEntry(
    { title: "Gym", category: "gym", period: "monthly", anchorDate: "2026-01-05", cost: 29.99, costPeriod: "month" },
    { now },
  );
  assert.equal(monthly.derived.nextDue, "2026-09-05", "monthly anchor projects to the next occurrence");
  assert.equal(monthly.derived.annualCost, 359.88, "monthly cost annualizes");

  const past = normalizeEntry(
    { title: "Domain", category: "domain", period: "annual", anchorDate: "2025-03-10" },
    { now },
  );
  assert.equal(past.derived.nextDue, "2027-03-10", "expired anchor rolls to the next cycle");
});

test("radar: notice window drives criticality ahead of the due date", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const entries = [
    { id: "a", title: "Insurance (notice open)", category: "insurance", period: "annual", anchorDate: "2026-10-01", noticeDays: 30, status: "active" },
    { id: "b", title: "Domain (due sooner, no notice)", category: "domain", period: "annual", anchorDate: "2026-09-20", status: "active" },
    { id: "c", title: "Streaming (far)", category: "streaming", period: "monthly", anchorDate: "2026-08-05", status: "active" },
    { id: "d", title: "Cancelled gym", category: "gym", period: "monthly", anchorDate: "2026-09-10", status: "cancelled" },
  ];
  const rows = radarRows(entries, { horizonDays: 45, now });
  assert.equal(rows[0].id, "a", "open notice window outranks a sooner plain renewal");
  assert.equal(rows[0].urgency, "critical");
  assert.equal(rows[0].noticeDeadline, "2026-09-01");
  assert.ok(rows[0].daysToNotice <= 0, "notice window is already open");
  assert.equal(rows.find((r) => r.id === "d"), undefined, "cancelled entries stay off the radar");
  assert.equal(rows.find((r) => r.id === "c").daysToDue, 4, "monthly anchor projects to the next occurrence");
});

test("date math: occurrences, deltas and offsets", () => {
  assert.equal(nextOccurrence("2026-09-30", "annual", "2026-10-01"), "2027-09-30");
  assert.equal(nextOccurrence("2026-01-31", "monthly", "2026-02-01"), "2026-02-28", "month-end clamps");
  assert.equal(daysBetween("2026-09-01", "2026-10-01"), 30);
  assert.equal(addDaysIso("2026-09-30", -30), "2026-08-31");
});

/** Drive the real stdio server: handshake, ingestion, ledger, radar, drafts, ICS. */
async function withServer(run) {
  const dataDir = mkdtempSync(join(tmpdir(), "paper-radar-mcp-"));
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
  const notify = (method) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  try {
    await run({ call, tool, notify, dataDir, responses });
  } finally {
    child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("mcp server: full offline journey — extract → upsert → radar → cancel → ics", async () => {
  await withServer(async ({ call, tool, notify, responses, dataDir }) => {
    const init = await call("initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "contract-test", version: "0" },
    });
    assert.equal(init.result.serverInfo.name, "paper-radar");

    const catalog = await call("tools/list");
    const names = catalog.result.tools.map((t) => t.name);
    for (const expected of [
      "ingest_extract", "ledger_upsert", "ledger_list", "ledger_remove",
      "radar", "cost_report", "cancel_draft", "ics_export",
    ]) {
      assert.ok(names.includes(expected), `tool ${expected} listed`);
    }

    const extracted = await tool("ingest_extract", {
      text: [
        "PÓLIZA DE SEGURO DE HOGAR",
        "Aseguradora: Allianz, S.A.",
        "La póliza se renovará el 15 de octubre de 2026 por una prima anual de 380,00 €.",
        "El tomador podrá oponerse a la renovación comunicándolo con 30 días de antelación.",
      ].join("\n"),
    });
    assert.equal(extracted.dates[0].iso, "2026-10-15");
    assert.equal(extracted.noticeWindows[0].days, 30);
    assert.equal(extracted.kinds[0].kind, "insurance");

    const invalid = await tool("ledger_upsert", { title: "x", category: "zzz", anchorDate: "nope" });
    assert.match(invalid, /Invalid entry: /u, "validation errors reach the caller as text");

    // Anchor the renewal 25 days out so the 30-day notice window is OPEN
    // today: the journey must be critical regardless of the real clock.
    const anchor = addDaysIso(todayIso(), 25);
    const created = await tool("ledger_upsert", {
      title: "Home insurance — Allianz",
      category: "insurance",
      period: "annual",
      anchorDate: anchor,
      noticeDays: 30,
      cost: 380,
      costPeriod: "year",
      currency: "EUR",
      counterparty: "Allianz",
      language: "es",
      evidence: ["se renovará por una prima anual de 380,00 €"],
    });
    const id = created.id;
    assert.equal(created.derived.nextDue, anchor);
    assert.ok(created.derived.noticeDeadline !== null);

    const gym = await tool("ledger_upsert", {
      title: "Gym — FitCorp",
      category: "gym",
      period: "monthly",
      anchorDate: addDaysIso(todayIso(), 5),
      cost: 49.99,
      costPeriod: "month",
      currency: "EUR",
      language: "en",
    });

    const radar = await tool("radar", { horizonDays: 60 });
    assert.ok(radar.rows.length >= 2);
    assert.ok(radar.rows.some((row) => row.id === id && row.urgency === "critical"));

    const cost = await tool("cost_report", {});
    assert.equal(cost.annualTotal, 380 + 49.99 * 12);

    const draft = await tool("cancel_draft", { id, senderName: "Paul Garcia", accountRef: "POL-12345" });
    assert.match(draft.draft, /Asunto: Preaviso de cancelación/u);
    assert.match(draft.draft, /POL-12345/u);
    assert.match(draft.draft, new RegExp(anchor, "u"), "draft cites the renewal date");

    const draftEn = await tool("cancel_draft", { id: gym.id, senderName: "Paul Garcia" });
    assert.match(draftEn.draft, /Subject: Cancellation notice/u);

    const ics = await tool("ics_export", {});
    assert.ok(existsSync(ics.path));
    const body = readFileSync(ics.path, "utf8");
    assert.match(body, /BEGIN:VCALENDAR/u);
    assert.match(body, /TRIGGER:-P30D/u, "alarm fires at the notice window");
    assert.match(body, /SUMMARY:Home insurance — Allianz/u);

    const unknown = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(unknown.error.code, -32602);

    notify("notifications/initialized");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(responses.every((m) => m.id !== undefined), "no response to notifications");
  });
});
