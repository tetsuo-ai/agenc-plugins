import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGIN = join(ROOT, "plugins", "ledger");
const skill = readFileSync(join(PLUGIN, "skills", "ledger-status", "SKILL.md"), "utf8");
const command = readFileSync(join(PLUGIN, "commands", "ledger-balance.md"), "utf8");
const manifest = JSON.parse(readFileSync(join(PLUGIN, ".agenc-plugin", "plugin.json"), "utf8"));

// The read-only wallet-cli 3 surface this plugin may prescribe.
const ALLOWED = [
  "--version",
  "session view",
  "account discover",
  "balances",
  "operations",
  "earn positions",
  "assets token-by-id",
  "assets token",
  "receive",
  "genuine-check",
];
const BLOCKED = ["send", "swap", "earn deposit", "earn withdraw", "earn yields", "ring", "agent-intent", "session reset", "skill"];

function fencedInvocations(text) {
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/gu)].map((match) => match[1]);
  return blocks.flatMap((block) => block.split("\n")).map((line) => line.trim())
    .filter((line) => line.startsWith("wallet-cli "));
}
function inlineInvocations(text) {
  return [...text.matchAll(/`(wallet-cli [^`]+)`/gu)].map((match) => match[1]);
}
function subcommand(invocation) {
  const rest = invocation.slice("wallet-cli ".length);
  return ALLOWED.find((name) => rest === name || rest.startsWith(`${name} `));
}

test("every prescribed wallet-cli command is on the read-only surface", () => {
  const invocations = [...fencedInvocations(skill), ...inlineInvocations(command)];
  assert.ok(invocations.length >= 9, "the skill must show its commands");
  for (const invocation of invocations) {
    assert.ok(subcommand(invocation), `not a read-only command: ${invocation}`);
  }
});

test("parsed commands ask for JSON output and never skip device verification", () => {
  for (const invocation of [...fencedInvocations(skill), ...inlineInvocations(command)]) {
    if (subcommand(invocation) !== "--version") {
      assert.match(invocation, /--output json/u, `missing --output json: ${invocation}`);
    }
    assert.doesNotMatch(invocation, /--no-verify|--dry-run|--force/u, invocation);
  }
  assert.match(skill, /Never pass `--no-verify`/u);
});

test("the read-only boundary names every blocked command family", () => {
  const boundary = skill.slice(skill.indexOf("## Read-only boundary"));
  assert.ok(boundary.length > 0);
  for (const name of BLOCKED) {
    assert.ok(boundary.includes(`\`${name}`) || boundary.includes(`\`wallet-cli ${name}`), `boundary misses ${name}`);
  }
  assert.match(skill, /Never ask for a\nrecovery phrase or a PIN/u);
});

test("network ids use the wallet-cli 3 names", () => {
  for (const id of ["bitcoin", "ethereum", "solana", "bitcoin_testnet", "ethereum_sepolia", "solana_devnet"]) {
    assert.ok(skill.includes(`\`${id}\``), id);
  }
  assert.doesNotMatch(skill.replace(/old names such as `ethereum:sepolia`/u, ""), /`(?:bitcoin|ethereum|solana):[a-z]+`/u);
});

test("the skill finds wallet-cli through AgenC and requests scoped sandbox grants", () => {
  for (const required of [
    "ledger_wallet_cli_status",
    "install_ledger_wallet_cli",
    "with_additional_permissions",
    "\"network\": {\"enabled\": true}",
    "require_escalated",
    "USB only",
    "no Bluetooth transport",
  ]) {
    assert.ok(skill.includes(required), `skill is missing ${required}`);
  }
  assert.match(command, /ledger_wallet_cli_status/u);
});

test("the manifest stays a skill-only, read-only package", () => {
  assert.equal(manifest.name, "ledger");
  assert.equal(manifest.mcpServers, undefined);
  assert.deepEqual(manifest.skills, ["./skills/ledger-status"]);
  assert.deepEqual(Object.keys(manifest.commands), ["ledger-balance"]);
  assert.ok(manifest.interface.capabilities.includes("readonly-staking-positions"));
  assert.match(manifest.interface.longDescription, /never signs, broadcasts, or asks for a recovery phrase/u);
});
