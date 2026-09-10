/**
 * Forge contract tests: the deterministic code verifier against JS/TS
 * and Python fixtures ; base rules, per-style discipline, minimal-diff
 * consistency with the original ; plus the MCP server as a real child
 * process. Fully offline.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CODE_STYLE_RULESETS, verifyCode } from "../plugins/forja/server/verify.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "forja", "server", "main.mjs");
const rules = (result) => result.violations.map((v) => v.rule);

function longFunction(lines = 50) {
  const body = Array.from({ length: lines }, (_, i) => `  const v${i} = ${i + 10};`).join("\n");
  return `function process(data) {\n${body}\n  return v0;\n}\n`;
}

test("verify: base rules catch the classics", () => {
  const deep = [
    "function f(a, b, c, d, e, f2) {",
    "  if (a) {",
    "    if (b) {",
    "      if (c) {",
    "        if (d) {",
    "          if (e) { return 1; }",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const result = verifyCode(deep, { style: "limpio", language: "js" });
  const found = rules(result);
  assert.ok(found.includes("nesting-deep"), `deep nesting caught (${found})`);
  assert.ok(found.includes("too-many-params"), `6 params caught (${found})`);

  const messy = `import { unused } from "./x.js";\nconsole.log("debug");\ntry { run(); } catch (e) {}\nconst x = 10;\n// TODO fix later\n${"const line = '".padEnd(130, "x") + "';"}\n`;
  const messyResult = verifyCode(messy, { style: "limpio", language: "js" });
  const messyFound = rules(messyResult);
  assert.ok(messyFound.includes("debug-leftover"), "console.log caught");
  assert.ok(messyFound.includes("empty-catch"), "empty catch caught");
  assert.ok(messyFound.includes("dead-import"), "unused import caught");
  assert.ok(messyFound.includes("todo-left"), "TODO caught");
  assert.ok(messyFound.includes("long-lines"), "long line caught");
});

test("verify: function bands by style: clean stricter than base", () => {
  const fn = longFunction(30); // 32 lines total
  const limpio = verifyCode(fn, { style: "limpio", language: "js" });
  assert.ok(rules(limpio).includes("fn-long"), "30-line fn warns under limpio (≤25 target)");
  const defensivo = verifyCode(fn, { style: "defensivo", language: "js" });
  assert.ok(!rules(defensivo).includes("fn-long"), "same fn is fine under defensivo (warn 40)");
  const huge = verifyCode(longFunction(70), { style: "defensivo", language: "js" });
  assert.ok(rules(huge).includes("fn-too-long"), "70-line fn errors everywhere");
});

test("verify: clean wants early returns and real names", () => {
  const nested = "function f(a) {\n  if (a) {\n    if (a.x) {\n      return 1;\n    }\n  }\n  return 0;\n}\n";
  const result = verifyCode(nested, { style: "limpio", language: "js" });
  assert.ok(rules(result).includes("nested-guard"), "if-inside-if flagged");
  const cryptic = verifyCode("function run(d) {\n  const s = d * 86400;\n  return s;\n}\n", { style: "limpio", language: "js" });
  assert.ok(rules(cryptic).includes("cryptic-name") || rules(cryptic).includes("magic-number"), `naming/magic caught (${rules(cryptic)})`);
});

test("verify: defensive: swallowed defaults and switch default", () => {
  const sloppy = [
    "function cfg(raw) {",
    "  return { retries: raw.retries ?? 3, deep: raw.deep ?? true, wide: raw.wide ?? false, mode: raw.mode ?? \"x\" };",
    "}",
    "function pick(kind) {",
    "  switch (kind) {",
    "    case \"a\": return 1;",
    "  }",
    "}",
  ].join("\n");
  const result = verifyCode(sloppy, { style: "defensivo", language: "js" });
  const found = rules(result);
  assert.ok(found.includes("default-masking"), `literal ?? fallbacks flagged (${found})`);
  assert.ok(found.includes("switch-no-default"), `switch without default (${found})`);
});

test("verify: functional: const discipline and transform preference", () => {
  const imperative = [
    "let label = \"total\";",
    "for (const i of items) {",
    "  if (i.ok) { out.push(i.v); }",
    "}",
    "out.push(1);",
    "out.push(2);",
    "out.push(3);",
    "out.push(4);",
    "out.push(5);",
  ].join("\n");
  const result = verifyCode(imperative, { style: "funcional", language: "js" });
  const found = rules(result);
  assert.ok(found.includes("let-could-be-const"), `never-reassigned let flagged (${found})`);
  assert.ok(found.includes("mutation-heavy"), `append-heavy code flagged (${found})`);
});

test("verify: solid: god class, constructed deps, god switch", () => {
  const god = [
    "class Mega {",
    "  constructor() {",
    "    this.db = new Database();",
    "    this.mail = new Mailer();",
    "  }",
    ...Array.from({ length: 125 }, (_, i) => `  method${i}() {`).concat([]),
  ].join("\n");
  const tallClass = `class Mega {\n  constructor() {\n    this.db = new Database();\n    this.mail = new Mailer();\n  }\n${Array.from({ length: 60 }, (_, i) => `  method${i}() {\n    const step${i} = ${i};\n    return step${i};\n  }`).join("\n")}\n}\n`;
  const result = verifyCode(tallClass, { style: "solid", language: "js" });
  const found = rules(result);
  assert.ok(found.includes("class-large") || found.includes("god-class"), `big class caught (${found})`);
  assert.ok(found.includes("constructed-deps"), `in-class construction caught (${found})`);
  void god;

  const switchy = [
    "function route(kind) {",
    "  switch (kind) {",
    ...Array.from({ length: 8 }, (_, i) => `    case "${i}": return ${i};`),
    "  }",
    "}",
  ].join("\n");
  const switchResult = verifyCode(switchy, { style: "solid", language: "js" });
  assert.ok(rules(switchResult).includes("god-switch"), "8-case switch flagged");
});

test("verify: minimal-diff measures consistency with the original file", () => {
  const original = [
    "const client = require('./client')",
    "const log = require('./log')",
    "",
    "function fetchIt(url) {",
    "  log.call('fetch', url)",
    "  return client.get(url)",
    "}",
  ].join("\n");
  const goodPatch = [
    "const client = require('./client')",
    "const log = require('./log')",
    "",
    "const DEFAULT_TIMEOUT_MS = 5000",
    "",
    "function fetchIt(url, timeoutMs = DEFAULT_TIMEOUT_MS) {",
    "  log.call('fetch', url)",
    "  return client.get(url, { timeout: timeoutMs })",
    "}",
  ].join("\n");
  const good = verifyCode(goodPatch, { style: "minimal-diff", language: "js", original });
  const goodErrors = good.violations.filter((v) => v.severity === "error");
  assert.equal(goodErrors.length, 0, JSON.stringify(good.violations));

  const reformatted = goodPatch
    .replaceAll("  ", "    ")
    .replaceAll("'", '"')
    .replace("const client", "const getClient");
  const bad = verifyCode(reformatted, { style: "minimal-diff", language: "js", original });
  const found = rules(bad);
  assert.ok(found.includes("indent-width") || found.includes("indent-mismatch"), `indent mismatch measured (${found})`);
  assert.ok(found.includes("quote-mismatch"), `quote drift measured (${found})`);
});

test("verify: python: def extents, print leftovers, except-pass", () => {
  const py = [
    "import os",
    "",
    "def process(data):",
    "    print(data)",
    "    try:",
    "        x = int(data)",
    "    except ValueError:",
    "        pass",
    "    return x",
  ].join("\n");
  const result = verifyCode(py, { style: "defensivo", language: "py" });
  const found = rules(result);
  assert.ok(found.includes("debug-leftover"), "print caught");
  assert.ok(found.includes("empty-catch"), "except-pass caught");
  assert.ok(result.stats.functions >= 1, "def counted");
  const cleanPy = verifyCode("def add(a, b):\n    return a + b\n", { style: "limpio", language: "py" });
  assert.equal(cleanPy.violations.filter((v) => v.severity === "error").length, 0, JSON.stringify(cleanPy.violations));
});

test("verify: unknown style is actionable; scores and stats present", () => {
  const bad = verifyCode("x", { style: "zzz" });
  assert.match(bad.error, /unknown style 'zzz'/u);
  const clean = verifyCode(
    "function add(a: number, b: number): number {\n  return a + b;\n}\n",
    { style: "limpio", language: "js" },
  );
  assert.ok(clean.pass, `clean passes (${clean.score}: ${JSON.stringify(clean.violations)})`);
  assert.equal(clean.stats.functions, 1);
});

test("mcp server: catalog and lint round-trips: as a real child process", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "forja-mcp-"));
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
    assert.equal(init.result.serverInfo.name, "forja");
    assert.equal(init.result.serverInfo.title, "Forge");
    const catalog = await call("tools/list");
    assert.deepEqual(catalog.result.tools.map((t) => t.name).sort(), ["code_lint", "code_styles_list"]);

    const lintSchema = catalog.result.tools.find((entry) => entry.name === "code_lint").inputSchema;
    assert.ok(lintSchema.properties.style.enum.includes("clean"));
    assert.ok(lintSchema.properties.style.enum.includes("limpio"), "legacy requests remain schema-valid");

    const list = await tool("code_styles_list", {});
    assert.equal(list.styles.length, Object.keys(CODE_STYLE_RULESETS).length);
    const md = list.styles.find((s) => s.key === "minimal-diff");
    assert.equal(list.styles.find((entry) => entry.key === "clean").outputStyleName, "limpio");
    assert.ok(md.lintRules.includes("matchOriginal"));
    assert.ok(md.description.length > 20);

    const bad = await tool("code_lint", {
      code: "function f(a,b,c,d,e,g) { console.log(a); if (a) { if (b) { if (c) { if (d) { if (e) { return g; } } } } } }\n",
      style: "limpio",
      language: "js",
    });
    assert.ok(bad.violations.length >= 3);
    assert.ok(bad.score < 85);

    const original = "const client = require('./client')\nmodule.exports = function fetchIt(url) {\n  return client.get(url)\n}\n";
    const drifted = "const client = require(\"./client\");\nmodule.exports = function fetchIt(url) {\n    return client.get(url);\n}\n";
    const diff = await tool("code_lint", { code: drifted, style: "minimal-diff", language: "js", original });
    const diffRules = diff.violations.map((v) => v.rule);
    assert.ok(diffRules.includes("indent-width") || diffRules.includes("indent-mismatch"), `(${diffRules})`);
    assert.ok(diffRules.includes("quote-mismatch") || diffRules.includes("semicolon-style"), `(${diffRules})`);

    const unknown = await tool("code_lint", { code: "x", style: "zzz" });
    assert.match(unknown, /unknown style/u);
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
