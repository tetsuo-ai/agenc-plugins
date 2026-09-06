import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as signing from "../plugin-signing.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const plugins = ["zeroday-hunter", "iot-builder", "ledger", "llm-checker", "stonks-copilot"];
const publicFiles = ["agenc-plugins.pub", "agenc-plugins-2026-09.pub"];

function pemPair(type = "ed25519") {
  const pair = generateKeyPairSync(type, type === "ec" ? { namedCurve: "prime256v1" } : {});
  return {
    public: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    private: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agenc-publisher-rollover-")));
  t.after(() => {
    assert.equal(dirname(root), realpathSync(tmpdir()));
    assert.ok(root.split("/").at(-1).startsWith("agenc-publisher-rollover-"));
    rmSync(root, { recursive: true, force: true });
  });
  const oldKey = pemPair(), newKey = pemPair();
  const env = {
    PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
    HOME: root, TMPDIR: root, NO_COLOR: "1", NODE_ENV: "test",
    PLUGIN_REPO_SHA: "a".repeat(40), PLUGIN_REPO_URL: "https://example.invalid/fixture.git",
  };
  for (const file of ["sign-plugins.mjs", "plugin-signing.mjs", "build-manifest.mjs"]) copyFileSync(join(repository, file), join(root, file));
  writeFileSync(join(root, publicFiles[0]), oldKey.public);
  writeFileSync(join(root, publicFiles[1]), newKey.public);
  const oldPath = join(root, "ephemeral-legacy.pem"), newPath = join(root, "ephemeral-active.pem");
  writeFileSync(oldPath, oldKey.private, { mode: 0o600 });
  writeFileSync(newPath, newKey.private, { mode: 0o600 });
  mkdirSync(join(root, ".agenc-plugin"));
  writeFileSync(join(root, ".agenc-plugin", "marketplace.json"), JSON.stringify({ name: "fixture", plugins: plugins.map((name) => ({ name, source: `./plugins/${name}` })) }));
  for (const name of plugins) {
    const target = join(root, "plugins", name);
    mkdirSync(join(target, ".agenc-plugin"), { recursive: true });
    writeFileSync(join(target, ".agenc-plugin", "plugin.json"), JSON.stringify({ name, version: "0.0.1" }));
    writeFileSync(join(target, "README.md"), `Fixture for ${name}.\n`);
    const files = signing.collectPluginPayloadDigests(target);
    const signature = sign(null, signing.pluginSignaturePayload(target, files), oldKey.private).toString("base64");
    writeFileSync(join(target, signing.PLUGIN_SIGNATURE_PATH), JSON.stringify({ publisher: "tetsuo-ai", signature, files }) + "\n");
  }
  const run = (script, args = []) => spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, env, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  const signatures = () => Object.fromEntries(plugins.map((name) => [name, readFileSync(join(root, "plugins", name, signing.PLUGIN_SIGNATURE_PATH), "utf8")]));
  return { root, oldKey, newKey, oldPath, newPath, run, signatures };
}

function succeeded(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

test("rollover verifies either Ed25519 key, preserves single-key compatibility, and rejects tampering", (t) => {
  const f = fixture(t);
  const keys = signing.readPublisherPublicKeys(f.root);
  assert.deepEqual(keys.map((pem) => pem.trim()), [f.oldKey.public.trim(), f.newKey.public.trim()]);
  const target = join(f.root, "plugins", "stonks-copilot");
  assert.equal(signing.verifyPluginSignatureFile(target, f.oldKey.public).publisher, "tetsuo-ai");
  assert.equal(signing.verifyPluginSignatureFile(target, keys).publisher, "tetsuo-ai");
  assert.throws(() => signing.verifyPluginSignatureFile(target, f.newKey.public));
  succeeded(f.run("sign-plugins.mjs", ["--key", f.newPath, "--plugin", "stonks-copilot"]));
  assert.equal(signing.verifyPluginSignatureFile(target, f.newKey.public).publisher, "tetsuo-ai");
  assert.equal(signing.verifyPluginSignatureFile(target, keys).publisher, "tetsuo-ai");
  assert.throws(() => signing.verifyPluginSignatureFile(target, f.oldKey.public));
  assert.throws(() => signing.verifyPluginSignatureFile(target, keys, "wrong-publisher"));
  writeFileSync(join(target, "README.md"), "Modified after signing.\n");
  assert.throws(() => signing.verifyPluginSignatureFile(target, keys), /payload|file map|digest/iu);
});

test("--plugin signs only Stonks and leaves the other four signature bytes unchanged", (t) => {
  const f = fixture(t), before = f.signatures();
  succeeded(f.run("sign-plugins.mjs", ["--key", f.newPath, "--publisher", "tetsuo-ai", "--plugin", "stonks-copilot"]));
  const after = f.signatures();
  for (const name of plugins.filter((name) => name !== "stonks-copilot")) {
    assert.equal(after[name], before[name], name);
    signing.verifyPluginSignatureFile(join(f.root, "plugins", name), f.oldKey.public);
  }
  assert.notEqual(after["stonks-copilot"], before["stonks-copilot"]);
  signing.verifyPluginSignatureFile(join(f.root, "plugins", "stonks-copilot"), f.newKey.public);
});

test("omitting --plugin retains the existing sign-all behavior with trusted legacy and active keys", (t) => {
  const f = fixture(t);
  for (const [keyPath, publicKey] of [[f.newPath, f.newKey.public], [f.oldPath, f.oldKey.public]]) {
    succeeded(f.run("sign-plugins.mjs", ["--key", keyPath]));
    for (const name of plugins) signing.verifyPluginSignatureFile(join(f.root, "plugins", name), publicKey);
  }
});

test("untrusted signer and invalid --plugin selections fail before changing any signature", (t) => {
  const f = fixture(t), before = f.signatures(), untrusted = pemPair();
  const untrustedPath = join(f.root, "ephemeral-untrusted.pem");
  writeFileSync(untrustedPath, untrusted.private, { mode: 0o600 });
  for (const args of [
    ["--key", untrustedPath, "--plugin", "stonks-copilot"],
    ["--key", f.newPath, "--plugin", "missing-plugin"],
    ["--key", f.newPath, "--plugin"],
    ["--key", f.newPath, "--plugin", ""],
    ["--key", f.newPath, "--plugin", "--publisher", "tetsuo-ai"],
    ["--key", f.newPath, "--plugins", "stonks-copilot"],
    ["--key", f.newPath, "--plugin", "stonks-copilot", "--plugin", "ledger"],
    ["--key", f.oldPath, "--key", f.newPath],
  ]) {
    const result = f.run("sign-plugins.mjs", args);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.signatures(), before);
  }
});

test("publisher trust and signing reject non-Ed25519 keys", (t) => {
  const f = fixture(t), ec = pemPair("ec"), before = f.signatures();
  const target = join(f.root, "plugins", "stonks-copilot");
  assert.throws(() => signing.verifyPluginSignatureFile(target, [f.oldKey.public, ec.public]), /Ed25519/iu);
  const files = signing.collectPluginPayloadDigests(target);
  writeFileSync(join(target, signing.PLUGIN_SIGNATURE_PATH), JSON.stringify({ publisher: "tetsuo-ai", files, signature: sign("sha256", signing.pluginSignaturePayload(target, files), ec.private).toString("base64") }));
  assert.throws(() => signing.verifyPluginSignatureFile(target, ec.public));
  writeFileSync(join(target, signing.PLUGIN_SIGNATURE_PATH), before["stonks-copilot"]);
  writeFileSync(join(f.root, publicFiles[1]), ec.public);
  assert.throws(() => signing.readPublisherPublicKeys(f.root), /Ed25519/iu);
  const keyPath = join(f.root, "ephemeral-ec.pem");
  writeFileSync(keyPath, ec.private, { mode: 0o600 });
  const result = f.run("sign-plugins.mjs", ["--key", keyPath, "--plugin", "stonks-copilot"]);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.signatures(), before);
});

test("isolated builder retains the legacy publicKey, publishes both publicKeys and both PEM files", (t) => {
  const f = fixture(t);
  succeeded(f.run("build-manifest.mjs"));
  const keyring = JSON.parse(readFileSync(join(f.root, "public", "plugin-publishers.json"), "utf8"));
  const entry = keyring.publishers["tetsuo-ai"];
  assert.equal(entry.publicKey, signing.publisherPublicKeyBase64(f.oldKey.public));
  assert.deepEqual(entry.publicKeys, [f.oldKey.public, f.newKey.public].map(signing.publisherPublicKeyBase64));
  for (const [index, file] of publicFiles.entries()) assert.equal(readFileSync(join(f.root, "public", file), "utf8").trim(), [f.oldKey.public, f.newKey.public][index].trim());
  const catalog = JSON.parse(readFileSync(join(f.root, "public", "marketplace.json"), "utf8"));
  assert.equal(catalog.plugins.length, 5);
  assert.ok(catalog.plugins.every((entry) => entry.source.sha === "a".repeat(40)));
});

test("repository publishes the expected active public-key fingerprint without replacing the legacy key", () => {
  const keys = signing.readPublisherPublicKeys(repository);
  assert.equal(keys.length, 2);
  const active = createPublicKey(keys[1]).export({ type: "spki", format: "der" });
  assert.equal(createHash("sha256").update(active).digest("hex"), "d3cd019ab546d8512619fabc80cb4b363c66d1a70bfa25a35bbef5aacf3836c3");
  assert.equal(keys[0].trim(), readFileSync(join(repository, publicFiles[0]), "utf8").trim());
  assert.notEqual(keys[0], keys[1]);
});
