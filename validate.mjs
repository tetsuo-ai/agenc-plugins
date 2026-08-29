import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publisherPublicKeyBase64,
  verifyPluginSignatureFile,
} from "./plugin-signing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_PATH = join(ROOT, ".agenc-plugin", "marketplace.json");
const EXPECTED_PLUGINS = ["zeroday-hunter", "iot-builder", "ledger"];
const EXPECTED_PUBLISHER_FINGERPRINT =
  "8174e96296289bd8eed26b832296309015216afe544a7f15097356b10aa1b932";
const ALLOWED_MANIFEST_FIELDS = new Set([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "dependencies",
  "commands",
  "agents",
  "skills",
  "outputStyles",
  "apps",
  "hooks",
  "mcpServers",
  "lspServers",
  "channels",
  "settings",
  "userConfig",
  "interface",
]);
const FORBIDDEN_PAYLOAD_TEXT = [
  "@modelcontextprotocol/server-filesystem",
  "agenc-marketplace --network",
  "write_flash 0x0",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertInside(path, root, label) {
  const rel = relative(root, path);
  assert.ok(
    rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep),
    `${label} must stay inside ${root}`,
  );
}

function localPluginRoot(source) {
  assert.equal(typeof source, "string", "source marketplace must use local paths");
  assert.ok(source.startsWith("./"), `invalid local plugin source: ${source}`);
  const root = resolve(ROOT, source.slice(2));
  assertInside(root, ROOT, source);
  return root;
}

function declaredPaths(declaration) {
  if (typeof declaration === "string") return [declaration];
  if (Array.isArray(declaration)) {
    return declaration.filter((entry) => typeof entry === "string");
  }
  if (declaration !== null && typeof declaration === "object") {
    return Object.values(declaration)
      .map((entry) => entry?.source)
      .filter((entry) => typeof entry === "string");
  }
  return [];
}

function assertDeclaredPaths(pluginRoot, declaration, field) {
  for (const path of declaredPaths(declaration)) {
    assert.ok(path.startsWith("./"), `${field} path must start with ./: ${path}`);
    const target = resolve(pluginRoot, path.slice(2));
    assertInside(target, pluginRoot, `${field} path`);
    assert.ok(existsSync(target), `${field} path does not exist: ${target}`);
  }
}

function walkPayload(root, visitor, directory = root) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".hg", ".svn"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    const stats = lstatSync(path);
    assert.ok(!stats.isSymbolicLink(), `plugin payload contains symlink: ${path}`);
    if (stats.isDirectory()) walkPayload(root, visitor, path);
    if (stats.isFile()) visitor(path);
  }
}

const marketplace = readJson(MARKETPLACE_PATH);
assert.equal(marketplace.name, "agenc-plugins");
assert.equal(marketplace.metadata?.name, "agenc-plugins");
assert.deepEqual(
  marketplace.plugins.map((plugin) => plugin.name),
  EXPECTED_PLUGINS,
  "marketplace must contain the three product plugins in the expected order",
);
assert.equal(new Set(EXPECTED_PLUGINS).size, EXPECTED_PLUGINS.length);
assert.ok(!existsSync(join(ROOT, "marketplace.json")), "retired root marketplace.json exists");
assert.ok(existsSync(join(ROOT, "LICENSE")), "MIT license file is missing");

const publicKeyPem = readFileSync(join(ROOT, "agenc-plugins.pub"), "utf8");
const publicKey = createPublicKey(publicKeyPem);
const publicKeyBase64 = publisherPublicKeyBase64(publicKeyPem);

for (const entry of marketplace.plugins) {
  assert.equal(entry.policy?.installation, "AVAILABLE");
  assert.equal(
    entry.policy?.products,
    undefined,
    `${entry.name}: products must remain omitted until Core passes a product to /plugins`,
  );
  const pluginRoot = localPluginRoot(entry.source);
  const manifestPath = join(pluginRoot, ".agenc-plugin", "plugin.json");
  assert.ok(existsSync(manifestPath), `${entry.name}: canonical manifest is missing`);
  assert.ok(!existsSync(join(pluginRoot, "plugin.json")), `${entry.name}: root plugin.json is retired`);
  assert.ok(!existsSync(join(pluginRoot, ".mcp.json")), `${entry.name}: .mcp.json is retired`);
  const manifest = readJson(manifestPath);
  assert.equal(manifest.name, entry.name, `${entry.name}: manifest name mismatch`);
  assert.equal(manifest.version, "0.2.0", `${entry.name}: expected release version 0.2.0`);
  for (const field of Object.keys(manifest)) {
    assert.ok(ALLOWED_MANIFEST_FIELDS.has(field), `${entry.name}: unknown manifest field ${field}`);
  }
  assertDeclaredPaths(pluginRoot, manifest.skills, `${entry.name}.skills`);
  assertDeclaredPaths(pluginRoot, manifest.commands, `${entry.name}.commands`);
  walkPayload(pluginRoot, (path) => {
    if (!/\.(?:json|md|sh|yaml|yml)$/iu.test(path)) return;
    const content = readFileSync(path, "utf8");
    for (const forbidden of FORBIDDEN_PAYLOAD_TEXT) {
      assert.ok(!content.includes(forbidden), `${entry.name}: forbidden stale pattern ${forbidden}`);
    }
  });
  const signature = verifyPluginSignatureFile(pluginRoot, publicKey);
  console.log(`verified ${entry.name} (${signature.files} signed payload files)`);
}

for (const script of [
  "campaign.sh",
  "poc-check.sh",
  "zdh-init.sh",
  "zdh-slice.sh",
  "zdh-triage.sh",
  "zdh-variant.sh",
  "zdh-watch.sh",
]) {
  const mode = statSync(join(ROOT, "plugins", "zeroday-hunter", "scripts", script)).mode;
  assert.ok((mode & 0o111) !== 0, `Zero Day script is not executable: ${script}`);
}

const ledgerSkill = readFileSync(
  join(ROOT, "plugins", "ledger", "skills", "ledger-status", "SKILL.md"),
  "utf8",
);
for (const command of [
  "wallet-cli session view",
  "wallet-cli account discover",
  "wallet-cli balances",
  "wallet-cli receive",
]) {
  assert.ok(ledgerSkill.includes(command), `Ledger skill is missing ${command}`);
}

const iotSkill = readFileSync(
  join(ROOT, "plugins", "iot-builder", "skills", "flash-board", "SKILL.md"),
  "utf8",
);
for (const command of ["pio device list --json-output", "pio run -e", "--upload-port"]) {
  assert.ok(iotSkill.includes(command), `IoT skill is missing ${command}`);
}

const hostedAlias = readFileSync(join(ROOT, "public", "marketplace.json"), "utf8");
const hostedCanonical = readFileSync(
  join(ROOT, "public", ".agenc-plugin", "marketplace.json"),
  "utf8",
);
assert.equal(hostedAlias, hostedCanonical, "hosted marketplace aliases differ");
const hosted = JSON.parse(hostedAlias);
for (const [index, plugin] of hosted.plugins.entries()) {
  assert.equal(plugin.name, marketplace.plugins[index].name);
  assert.equal(plugin.source.source, "git-subdir");
  assert.equal(plugin.source.path, marketplace.plugins[index].source.slice(2));
  assert.match(plugin.source.sha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  assert.equal(plugin.source.ref, undefined, `${plugin.name}: hosted source must not use a mutable ref`);
}
const publishedKeyring = readJson(join(ROOT, "public", "plugin-publishers.json"));
assert.equal(publishedKeyring.publishers?.["tetsuo-ai"]?.publicKey, publicKeyBase64);
assert.equal(
  readFileSync(join(ROOT, "public", "agenc-plugins.pub"), "utf8"),
  publicKeyPem.trimEnd() + "\n",
);

const fingerprint = createHash("sha256")
  .update(Buffer.from(publicKeyBase64, "base64"))
  .digest("hex");
assert.equal(
  fingerprint,
  EXPECTED_PUBLISHER_FINGERPRINT,
  "publisher key changed; use the documented key-rotation process",
);
assert.ok(
  readFileSync(join(ROOT, "README.md"), "utf8").includes(EXPECTED_PUBLISHER_FINGERPRINT),
  "README does not publish the expected publisher-key fingerprint",
);
console.log(`publisher key sha256:${fingerprint}`);
console.log("marketplace validation passed");
