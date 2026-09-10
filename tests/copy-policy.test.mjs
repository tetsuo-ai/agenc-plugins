import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("plugin payloads satisfy the authored-copy policy", () => {
  assert.deepEqual(repositoryCopyIssues(ROOT), []);
});

test("English display names preserve stable plugin installation IDs", () => {
  for (const [id, displayName] of Object.entries({ forja: "Forge", pluma: "Quill", olimpo: "Olympus", motor3d: "3D Engine" })) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugins", id, ".agenc-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.name, id);
    assert.equal(manifest.interface.displayName, displayName);
  }
});
