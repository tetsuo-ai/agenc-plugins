import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET_VERSION = "3.8.1";
const DOCUMENTS = [
  "plugins/llm-checker/skills/local-model-fit/SKILL.md",
  "plugins/llm-checker/commands/pick-model.md",
  "plugins/llm-checker/commands/runtime-check.md",
];

// Pinned from `llm-checker@3.8.1 <command> --help`. This deliberately checks
// executable examples rather than prose, so an invented flag fails CI.
const ROOT_OPTIONS = new Set(["--version", "--help", "-h"]);
const COMMAND_OPTIONS = new Map([
  ["hw-detect", new Set(["--json", "-j", "--help", "-h"])],
  ["ollama", new Set(["--list", "-l", "--help", "-h"])],
  ["installed", new Set(["--sort", "--json", "--verify", "--help", "-h"])],
  [
    "registry-search",
    new Set([
      "--source", "-s", "--format", "--runtime", "--quant", "--max-size",
      "--min-params", "--max-params", "--local-only", "--limit", "-l",
      "--json", "-j", "--help", "-h",
    ]),
  ],
  [
    "registry-recommend",
    new Set([
      "--category", "-c", "--optimize", "--runtime", "--source", "-s",
      "--format", "--quant", "--max-size", "--min-params", "--max-params",
      "--target-context", "--include-gated", "--pool-limit", "--limit", "-l",
      "--json", "-j", "--help", "-h",
    ]),
  ],
  [
    "ollama-plan",
    new Set([
      "--models", "--ctx", "--concurrency", "--objective", "--reserve-gb",
      "--json", "--help", "-h",
    ]),
  ],
  [
    "verify-context",
    new Set(["--model", "-m", "--target", "-t", "--json", "-j", "--help", "-h"]),
  ],
]);

function extractCommands(markdown) {
  const commands = [];
  for (const match of markdown.matchAll(/^llm-checker [^\r\n]+$/gm)) {
    commands.push(match[0]);
  }
  for (const match of markdown.matchAll(/`(llm-checker [^`\r\n]+)`/g)) {
    commands.push(match[1]);
  }
  return [...new Set(commands)];
}

function tokenize(command) {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

test(`llm-checker examples use the ${TARGET_VERSION} CLI contract`, () => {
  const examples = DOCUMENTS.flatMap((path) =>
    extractCommands(readFileSync(join(ROOT, path), "utf8")),
  );

  assert.ok(examples.length > 0, "expected at least one llm-checker example");

  for (const example of examples) {
    const tokens = tokenize(example);
    assert.equal(tokens[0], "llm-checker", example);

    if (tokens[1]?.startsWith("-")) {
      assert.ok(ROOT_OPTIONS.has(tokens[1]), `${example}: unsupported root option`);
      continue;
    }

    const command = tokens[1];
    const allowed = COMMAND_OPTIONS.get(command);
    assert.ok(allowed, `${example}: unsupported command ${command}`);

    for (const token of tokens.slice(2)) {
      if (!token.startsWith("-")) continue;
      const option = token.split("=", 1)[0];
      assert.ok(allowed.has(option), `${example}: unsupported ${command} option ${option}`);
    }
  }
});
