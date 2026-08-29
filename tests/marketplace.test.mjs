import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
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

test("hosted catalog aliases contain identical bytes", () => {
  assert.equal(
    readFileSync(join(ROOT, "public", "marketplace.json"), "utf8"),
    readFileSync(join(ROOT, "public", ".agenc-plugin", "marketplace.json"), "utf8"),
  );
});
