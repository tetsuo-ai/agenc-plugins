import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  readPublisherPublicKeys,
  verifyPluginSignatureFile,
} from "./plugin-signing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_PATH = join(ROOT, ".agenc-plugin", "marketplace.json");
const EXPECTED_PLUGINS = ["zeroday-hunter", "iot-builder", "ledger", "llm-checker", "stonks-copilot", "paper-radar", "inbox", "pluma"];
const EXPECTED_PLUGIN_VERSION = "0.2.1";
const EXPECTED_LOGO_PATH = "./assets/logo.png";
const LOGO_PAYLOAD_PATH = "assets/logo.png";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_LOGO_DIMENSION = 128;
const MAX_LOGO_DIMENSION = 1024;
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_LOGO_PIXELS = 1024 * 1024;
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

function assertPluginLogo(pluginRoot, manifest, pluginName) {
  const declaredLogo = manifest.interface?.logo;
  assert.equal(
    declaredLogo,
    EXPECTED_LOGO_PATH,
    `${pluginName}: interface.logo must be ${EXPECTED_LOGO_PATH}`,
  );
  const logoPath = resolve(pluginRoot, declaredLogo.slice(2));
  assertInside(logoPath, pluginRoot, `${pluginName}.interface.logo`);
  assert.ok(existsSync(logoPath), `${pluginName}: logo does not exist: ${logoPath}`);
  const logoStats = lstatSync(logoPath);
  assert.ok(!logoStats.isSymbolicLink(), `${pluginName}: logo must not be a symlink`);
  assert.ok(logoStats.isFile(), `${pluginName}: logo must be a regular file`);
  assert.ok(logoStats.size >= 33, `${pluginName}: logo is too small to be a PNG`);
  assert.ok(
    logoStats.size <= MAX_LOGO_BYTES,
    `${pluginName}: logo exceeds ${MAX_LOGO_BYTES} bytes`,
  );

  const logo = readFileSync(logoPath);
  assert.equal(logo.length, logoStats.size, `${pluginName}: logo size changed while reading`);
  assert.ok(logo.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC), `${pluginName}: invalid PNG magic`);
  assert.equal(logo.readUInt32BE(8), 13, `${pluginName}: first PNG chunk must be a 13-byte IHDR`);
  assert.equal(logo.toString("ascii", 12, 16), "IHDR", `${pluginName}: PNG is missing IHDR`);

  const width = logo.readUInt32BE(16);
  const height = logo.readUInt32BE(20);
  assert.equal(width, height, `${pluginName}: logo must be square`);
  assert.ok(
    width >= MIN_LOGO_DIMENSION && width <= MAX_LOGO_DIMENSION,
    `${pluginName}: logo dimension must be ${MIN_LOGO_DIMENSION}-${MAX_LOGO_DIMENSION}px`,
  );
  assert.ok(width * height <= MAX_LOGO_PIXELS, `${pluginName}: logo has too many pixels`);
  assert.equal(logo[24], 8, `${pluginName}: logo must use 8-bit PNG channels`);
  assert.equal(logo[25], 6, `${pluginName}: logo must use PNG RGBA color type 6`);
  assert.equal(logo[26], 0, `${pluginName}: PNG compression method must be 0`);
  assert.equal(logo[27], 0, `${pluginName}: PNG filter method must be 0`);
  assert.ok(logo[28] === 0 || logo[28] === 1, `${pluginName}: invalid PNG interlace method`);

  const signaturePath = join(pluginRoot, ".agenc-plugin", "signature.json");
  const signature = readJson(signaturePath);
  assert.ok(
    signature.files !== null && typeof signature.files === "object" && !Array.isArray(signature.files),
    `${pluginName}: signature file map is missing`,
  );
  assert.ok(
    Object.hasOwn(signature.files, LOGO_PAYLOAD_PATH),
    `${pluginName}: signature does not include ${LOGO_PAYLOAD_PATH}`,
  );
  const expectedDigest = `sha256:${createHash("sha256").update(logo).digest("hex")}`;
  assert.equal(
    signature.files[LOGO_PAYLOAD_PATH],
    expectedDigest,
    `${pluginName}: signed logo digest does not match the asset`,
  );
  return { bytes: logo.length, width, height };
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
const publicKeyBase64 = publisherPublicKeyBase64(publicKeyPem);
const publicKeys = readPublisherPublicKeys(ROOT);
const rolloverFingerprint = createHash("sha256")
  .update(Buffer.from(publisherPublicKeyBase64(publicKeys[1]), "base64"))
  .digest("hex");
assert.equal(rolloverFingerprint, "d3cd019ab546d8512619fabc80cb4b363c66d1a70bfa25a35bbef5aacf3836c3");

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
  assert.equal(
    manifest.version,
    EXPECTED_PLUGIN_VERSION,
    `${entry.name}: expected release version ${EXPECTED_PLUGIN_VERSION}`,
  );
  for (const field of Object.keys(manifest)) {
    assert.ok(ALLOWED_MANIFEST_FIELDS.has(field), `${entry.name}: unknown manifest field ${field}`);
  }
  assertDeclaredPaths(pluginRoot, manifest.skills, `${entry.name}.skills`);
  assertDeclaredPaths(pluginRoot, manifest.commands, `${entry.name}.commands`);
  const logo = assertPluginLogo(pluginRoot, manifest, entry.name);
  walkPayload(pluginRoot, (path) => {
    if (!/\.(?:json|md|sh|yaml|yml)$/iu.test(path)) return;
    const content = readFileSync(path, "utf8");
    for (const forbidden of FORBIDDEN_PAYLOAD_TEXT) {
      assert.ok(!content.includes(forbidden), `${entry.name}: forbidden stale pattern ${forbidden}`);
    }
  });
  const signature = verifyPluginSignatureFile(pluginRoot, publicKeys);
  console.log(
    `verified ${entry.name} (${signature.files} signed payload files; ${logo.width}x${logo.height} RGBA logo, ${logo.bytes} bytes)`,
  );
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

const stonksManifest = readJson(
  join(ROOT, "plugins", "stonks-copilot", ".agenc-plugin", "plugin.json"),
);
assert.ok(
  stonksManifest.mcpServers?.["stonks-data"]?.command === "node",
  "Stonks Copilot must declare its stdio stonks-data MCP server",
);
const stonksJournalSkill = readFileSync(
  join(ROOT, "plugins", "stonks-copilot", "skills", "thesis-journal", "SKILL.md"),
  "utf8",
);
for (const required of ["thesis_create", "thesis_scan", "thesis_list", "metrics_registry"]) {
  assert.ok(stonksJournalSkill.includes(required), `Stonks Copilot journal skill is missing ${required}`);
}
const paperManifest = readJson(
  join(ROOT, "plugins", "paper-radar", ".agenc-plugin", "plugin.json"),
);
assert.ok(
  paperManifest.mcpServers?.["paper-ledger"]?.command === "node",
  "Paper Radar must declare its stdio paper-ledger MCP server",
);
const paperIngestSkill = readFileSync(
  join(ROOT, "plugins", "paper-radar", "skills", "paper-ingest", "SKILL.md"),
  "utf8",
);
for (const required of ["ingest_extract", "ledger_upsert", "pdftotext", "noticeWindows"]) {
  assert.ok(paperIngestSkill.includes(required), `Paper Radar ingest skill is missing ${required}`);
}
const paperRadarSkill = readFileSync(
  join(ROOT, "plugins", "paper-radar", "skills", "paper-radar", "SKILL.md"),
  "utf8",
);
for (const required of ["cancel_draft", "ics_export", "cost_report", "radar"]) {
  assert.ok(paperRadarSkill.includes(required), `Paper Radar skill is missing ${required}`);
}

const stonksAnalyzerSkill = readFileSync(
  join(ROOT, "plugins", "stonks-copilot", "skills", "stock-analyzer", "SKILL.md"),
  "utf8",
);
assert.ok(
  stonksAnalyzerSkill.includes("chart_price"),
  "Stonks Copilot analyzer skill is missing chart_price",
);

const plumaManifest = readJson(
  join(ROOT, "plugins", "pluma", ".agenc-plugin", "plugin.json"),
);
assert.ok(
  plumaManifest.mcpServers?.["pluma-lint"]?.command === "node",
  "Pluma must declare its stdio pluma-lint MCP server",
);
assert.equal(
  plumaManifest.outputStyles?.length,
  10,
  "Pluma must ship its ten output styles",
);
const plumaSkill = readFileSync(
  join(ROOT, "plugins", "pluma", "skills", "escritura", "SKILL.md"),
  "utf8",
);
for (const required of ["style_lint", "styles_list", "pass", "system.searchTools"]) {
  assert.ok(plumaSkill.includes(required), `Pluma skill is missing ${required}`);
}

const inboxManifest = readJson(
  join(ROOT, "plugins", "inbox", ".agenc-plugin", "plugin.json"),
);
assert.ok(
  inboxManifest.mcpServers?.["inbox-gmail"]?.command === "node",
  "Inbox must declare its stdio inbox-gmail MCP server",
);
const inboxDigestSkill = readFileSync(
  join(ROOT, "plugins", "inbox", "skills", "inbox-digest", "SKILL.md"),
  "utf8",
);
for (const required of ["auth_status", "auth_begin", "auth_store_credentials", "system.searchTools"]) {
  assert.ok(inboxDigestSkill.includes(required), `Inbox digest skill is missing ${required}`);
}
const inboxLoopsSkill = readFileSync(
  join(ROOT, "plugins", "inbox", "skills", "inbox-loops", "SKILL.md"),
  "utf8",
);
for (const required of ["loops_scan", "reply debt", "waiting-on"]) {
  assert.ok(inboxLoopsSkill.includes(required), `Inbox loops skill is missing ${required}`);
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
assert.deepEqual(publishedKeyring.publishers?.["tetsuo-ai"]?.publicKeys, publicKeys.map(publisherPublicKeyBase64));
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
assert.ok(readFileSync(join(ROOT, "README.md"), "utf8").includes(rolloverFingerprint));
console.log(`publisher key sha256:${fingerprint}`);
console.log("marketplace validation passed");
