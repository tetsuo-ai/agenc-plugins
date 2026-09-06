import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "stonks-copilot");
const manifest = JSON.parse(readFileSync(join(root, ".agenc-plugin/plugin.json"), "utf8"));
const skill = name => readFileSync(join(root, "skills", name, "SKILL.md"), "utf8").replace(/\s+/g, " ");

test("Stonks starts its signed local server without a user-level workaround or shell preapproval", () => {
  assert.deepEqual(manifest.mcpServers["stonks-data"], {
    command: "node", args: ["./server/main.mjs"], transport: "stdio",
  });
  for (const command of Object.values(manifest.commands)) assert.equal(command.allowedTools, undefined);
});

test("Stonks profile artwork satisfies the marketplace PNG contract", () => {
  assert.equal(manifest.interface.logo, "./assets/logo.png");
  const logo = readFileSync(join(root, "assets/logo.png"));
  assert.equal(logo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(logo.readUInt32BE(16), 512);
  assert.equal(logo.readUInt32BE(20), 512);
  assert.equal(logo[24], 8);
  assert.equal(logo[25], 6);
  assert.ok(logo.length < 1024 * 1024);
});

test("Stonks copy describes requested scans and preserves the app punctuation style", () => {
  const copy = [manifest.description, manifest.interface.shortDescription, manifest.interface.longDescription,
    ...Object.values(manifest.commands).map(command => command.description)];
  assert.ok(copy.every(text => !text.includes(String.fromCodePoint(0x2014))));
  assert.match(manifest.interface.longDescription, /No orders, broker credentials or automatic background monitoring/);
  const journal = skill("thesis-journal");
  assert.match(journal, /Do not invent thresholds or substitute a different metric/);
  assert.match(journal, /do not update, close or delete a thesis/);
});

test("Stonks instructions expose chart paths as actual Desktop media, not hidden code blocks", () => {
  assert.match(skill("stock-analyzer"), /!\[Price chart\]\(<absolute path>\).*outside code fences/);
  assert.match(skill("portfolio-xray"), /!\[Portfolio exposure\]\(<absolute path>\).*outside code fences/);
  assert.match(skill("portfolio-xray"), /Unknown fees are not zero/);
});
