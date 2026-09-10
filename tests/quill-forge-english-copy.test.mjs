import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STYLE_RULESETS, STYLE_ALIASES, STYLE_FILES, lintText } from "../plugins/pluma/server/lint.mjs";
import { CODE_STYLE_RULESETS, CODE_STYLE_ALIASES, CODE_STYLE_FILES, verifyCode } from "../plugins/forja/server/verify.mjs";

test("Quill and Forge advertise English linter labels with unchanged saved output-style IDs and payload paths", () => {
  assert.deepEqual(Object.keys(STYLE_RULESETS), [
    "formal", "warm", "concise", "persuasive", "technical", "formal-letter",
    "professional-email", "speech", "proposal", "cover-letter",
  ]);
  assert.deepEqual(Object.keys(CODE_STYLE_RULESETS), [
    "clean", "defensive", "functional", "solid", "minimal-diff",
  ]);
  for (const [plugin, files] of [["pluma", STYLE_FILES], ["forja", CODE_STYLE_FILES]]) {
    for (const [style, file] of Object.entries(files)) {
      const content = readFileSync(new URL(`../plugins/${plugin}/outputStyles/${file}.md`, import.meta.url), "utf8");
      assert.ok(content.includes(`\nname: ${file}\n`), `${plugin}/${file} saved style identity`);
      assert.ok(Object.hasOwn(plugin === "pluma" ? STYLE_RULESETS : CODE_STYLE_RULESETS, style));
      assert.ok(!content.includes("\u2014"), "authored style copy has no em dash");
    }
  }
});

test("Quill legacy input IDs produce the same canonical findings as English styles", () => {
  const draft = "Hola, Ana:\nCreo que varios usuarios esperan. Cabe destacar que quizás funciona.\nGracias";
  for (const [legacy, canonical] of Object.entries(STYLE_ALIASES)) {
    const options = { subject: "Approval needed by Friday" };
    assert.deepEqual(lintText(draft, legacy, options), lintText(draft, canonical, options));
    assert.equal(lintText(draft, legacy, options).style, canonical);
  }
  for (const style of ["__proto__", "constructor", "toString"]) {
    assert.match(lintText(draft, style).error, /unknown style/u);
  }
});

test("Forge legacy input IDs retain every structural rule and return English names", () => {
  const code = "function calculate(value) {\n  let result = value * 23;\n  console.log(result);\n  return result;\n}";
  for (const [legacy, canonical] of Object.entries(CODE_STYLE_ALIASES)) {
    assert.deepEqual(verifyCode(code, { style: legacy }), verifyCode(code, { style: canonical }));
    assert.equal(verifyCode(code, { style: legacy }).style, canonical);
  }
  assert.equal(verifyCode("const count = 1;").style, "clean");
  for (const style of ["__proto__", "constructor", "toString"]) {
    assert.match(verifyCode(code, { style }).error, /unknown style/u);
  }
});

test("Quill proposal checks accept English headings and emit English missing-section labels", () => {
  const proposal = [
    "## Context", "Invoices take 40 days to settle.",
    "## Objective", "Reduce payment time to 28 days.",
    "## Scope", "Phase 1 delivers reminders in 2 weeks.",
    "## Investment", "The price is 1800 USD, valid for 30 days.",
    "## Timeline", "Start September 15 and finish September 30.",
    "## Next steps", "Reply with approval by September 12.",
  ].join("\n\n");
  assert.equal(lintText(proposal, "proposal").pass, true);
  const missing = lintText("Reply to approve the 12-day plan.", "propuesta");
  assert.deepEqual(missing.violations.filter((entry) => entry.rule.startsWith("missing-section:")).map((entry) => entry.rule), [
    "missing-section:context", "missing-section:objective", "missing-section:scope",
    "missing-section:investment", "missing-section:timeline", "missing-section:next-steps",
  ]);
});

test("English commands and brands retain compatible installation IDs and legacy commands", () => {
  for (const [id, brand, command, legacy] of [
    ["pluma", "Quill", "write", "escribe"], ["forja", "Forge", "code", "codigo"],
  ]) {
    const manifest = JSON.parse(readFileSync(new URL(`../plugins/${id}/.agenc-plugin/plugin.json`, import.meta.url)));
    assert.equal(manifest.name, id);
    assert.equal(manifest.interface.displayName, brand);
    assert.equal(manifest.commands[command].source, `./commands/${legacy}.md`);
    assert.deepEqual(Object.keys(manifest.commands), [command]);
    const commandText = readFileSync(new URL(`../plugins/${id}/commands/${legacy}.md`, import.meta.url), "utf8");
    assert.ok(commandText.includes(`aliases: [${legacy}]`));
    assert.ok(!JSON.stringify(manifest).includes("\u2014"));
  }
});
