import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { copyIssues, frontmatterCopyIssues, manifestCopyIssues, repositoryCopyIssues } from "../copy-policy.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("copy policy rejects literal and encoded em dashes", () => {
  for (const dash of ["\u2014", "\\u2014", "\\u{2014}", "&mdash;", "&#8212;", "&#x2014;"]) {
    assert.deepEqual(copyIssues(`Code styles ${dash} with checks`), ["em dashes are not allowed"]);
  }
  const manifest = JSON.parse('{"description":"Code styles \\u2014 with checks"}');
  assert.equal(manifestCopyIssues(manifest).length, 1);
});

test("copy policy catches Spanish regressions in nested UI copy, not compatibility IDs", () => {
  const manifest = {
    name: "forja",
    skills: ["./skills/calidad"],
    commands: { codigo: { source: "./commands/codigo.md", argumentHint: "<pedido o archivo>" } },
    interface: { defaultPrompt: ["Escribe una carta formal", "Hazme este email"], displayName: "Forge" },
  };
  assert.equal(manifestCopyIssues(manifest).length, 3);
  assert.deepEqual(manifestCopyIssues({
    name: "pluma", interface: { displayName: "Quill", defaultPrompt: ["Write a formal letter"] },
    commands: { escribe: { source: "./commands/escribe.md", argumentHint: "<style> <request or text>" } },
  }), []);
});

test("English copy supports punctuation, proper names and multilingual functionality", () => {
  for (const text of ["Code disciplines with practical checks.", "Read-only tools: inspect, then report.",
    "Recognize English and Spanish dates.", "Fernández Huerta readability scores.",
    "Use the codigo command to inspect a file.", "The legacy style is `limpio`."]) {
    assert.deepEqual(copyIssues(text, { english: true }), []);
  }
});

test("frontmatter guards both inline and multiline descriptions", () => {
  assert.equal(frontmatterCopyIssues("---\ndescription: Escribe una carta formal\n---\nBody").length, 1);
  assert.equal(frontmatterCopyIssues("---\r\ndescription: >\r\n  Escribe una carta formal\r\nname: escribe\r\n---\r\nBody").length, 1);
  assert.deepEqual(frontmatterCopyIssues("---\nname: escribe\ndescription: Write a letter\n---\nBody"), []);
});

test("functional JSON data keeps multilingual input without exempting punctuation", () => {
  assert.deepEqual(manifestCopyIssues({ title: "Cancelación del seguro" }, "fixture", { language: false }), []);
  assert.equal(manifestCopyIssues({ title: "input\u2014output" }, "fixture", { language: false }).length, 1);
});

test("skill display labels are English without renaming their stable directories", () => {
  for (const [plugin, directory, label] of [
    ["forja", "calidad", "Code Quality"],
    ["pluma", "escritura", "Writing"],
    ["olimpo", "olimpiada", "Olympiad Practice"],
  ]) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", plugin, ".agenc-plugin/plugin.json"), "utf8"));
    assert.ok(manifest.skills.includes(`./skills/${directory}`));
    const markdown = readFileSync(join(ROOT, "plugins", plugin, "skills", directory, "SKILL.md"), "utf8");
    assert.equal(/^name:\s*(.+)$/mu.exec(markdown)?.[1], label);
  }
  for (const name of ["calidad", "escritura", "olimpiada", "cercano"]) {
    assert.equal(frontmatterCopyIssues(`---\nname: ${name}\ndescription: A writing style\n---\nText`, "SKILL.md").length, 1);
  }
});

test("plugin payloads satisfy the authored-copy policy", () => {
  assert.deepEqual(repositoryCopyIssues(ROOT), []);
});

test("all visible canonical commands are English while legacy command aliases retain their paths", () => {
  for (const plugin of readdirSync(join(ROOT, "plugins"))) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", plugin, ".agenc-plugin/plugin.json"), "utf8"));
    for (const command of Object.keys(manifest.commands ?? {})) {
      assert.deepEqual(copyIssues(command, { english: true }), [], `${plugin}: /${command}`);
      assert.doesNotMatch(command, /^(?:olimpo|codigo|escribe)$/u, `${plugin}: canonical command uses a legacy alias`);
    }
  }
  for (const [plugin, canonical, legacy] of [["olimpo", "olympus", "olimpo"], ["forja", "code", "codigo"], ["pluma", "write", "escribe"]]) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", plugin, ".agenc-plugin/plugin.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.commands), [canonical]);
    assert.equal(manifest.commands[canonical].source, `./commands/${legacy}.md`);
    const markdown = readFileSync(join(ROOT, "plugins", plugin, "commands", `${legacy}.md`), "utf8");
    assert.ok(markdown.includes(`\naliases: [${legacy}]\n`));
    if (plugin === "olimpo") assert.ok(markdown.includes(`\nname: ${canonical}\n`));
  }
});

test("English display names preserve stable plugin installation IDs", () => {
  for (const [id, displayName] of Object.entries({ forja: "Forge", pluma: "Quill", olimpo: "Olympus", motor3d: "3D Engine" })) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", id, ".agenc-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.name, id);
    assert.equal(manifest.interface.displayName, displayName);
  }
});
