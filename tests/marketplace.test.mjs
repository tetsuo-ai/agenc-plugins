import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectPluginPayloadDigests,
  pluginSignaturePayload,
  publisherPublicKeyBase64,
} from "../plugin-signing.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGINS = ["zeroday-hunter", "iot-builder", "ledger", "llm-checker", "stonks-copilot", "paper-radar", "inbox", "pluma"];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("publisher export is DER-SPKI base64 accepted by Core", () => {
  const pem = readFileSync(join(ROOT, "agenc-plugins.pub"), "utf8");
  const base64 = publisherPublicKeyBase64(pem);
  const key = createPublicKey({
    key: Buffer.from(base64, "base64"),
    format: "der",
    type: "spki",
  });
  assert.equal(key.asymmetricKeyType, "ed25519");
});

test("signature payload is deterministic", () => {
  const pluginRoot = join(ROOT, "plugins", "ledger");
  const files = collectPluginPayloadDigests(pluginRoot);
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  assert.deepEqual(
    pluginSignaturePayload(pluginRoot, files),
    pluginSignaturePayload(pluginRoot, reversed),
  );
});

test("every plugin declares a bounded signed RGBA PNG logo", () => {
  for (const plugin of PLUGINS) {
    const pluginRoot = join(ROOT, "plugins", plugin);
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, ".agenc-plugin", "plugin.json"), "utf8"),
    );
    const signature = JSON.parse(
      readFileSync(join(pluginRoot, ".agenc-plugin", "signature.json"), "utf8"),
    );
    assert.equal(manifest.interface?.logo, "./assets/logo.png", `${plugin}: logo path`);
    const logo = readFileSync(join(pluginRoot, "assets", "logo.png"));
    assert.ok(logo.length >= 33 && logo.length <= 1024 * 1024, `${plugin}: logo bytes`);
    assert.ok(logo.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC), `${plugin}: PNG magic`);
    assert.equal(logo.readUInt32BE(8), 13, `${plugin}: IHDR length`);
    assert.equal(logo.toString("ascii", 12, 16), "IHDR", `${plugin}: IHDR type`);
    const width = logo.readUInt32BE(16);
    const height = logo.readUInt32BE(20);
    assert.equal(width, height, `${plugin}: square logo`);
    assert.ok(width >= 128 && width <= 1024, `${plugin}: logo dimension`);
    assert.ok(width * height <= 1024 * 1024, `${plugin}: logo pixels`);
    assert.equal(logo[24], 8, `${plugin}: PNG bit depth`);
    assert.equal(logo[25], 6, `${plugin}: PNG RGBA color type`);
    const expectedDigest = `sha256:${createHash("sha256").update(logo).digest("hex")}`;
    assert.equal(signature.files?.["assets/logo.png"], expectedDigest, `${plugin}: signed digest`);
    assert.equal(
      collectPluginPayloadDigests(pluginRoot)["assets/logo.png"],
      expectedDigest,
      `${plugin}: payload digest`,
    );
  }
});

test("hosted catalog aliases contain identical bytes", () => {
  assert.equal(
    readFileSync(join(ROOT, "public", "marketplace.json"), "utf8"),
    readFileSync(join(ROOT, "public", ".agenc-plugin", "marketplace.json"), "utf8"),
  );
});
