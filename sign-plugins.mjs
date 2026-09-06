/**
 * Sign every plugin, or one explicitly selected plugin, from the catalog.
 *
 * Usage:
 *   node sign-plugins.mjs --key ~/.agenc/keys/agenc-plugins.pem --publisher tetsuo-ai
 */
import {
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPluginPayloadDigests,
  PLUGIN_SIGNATURE_PATH,
  pluginSignaturePayload,
  readPublisherPublicKeys,
} from "./plugin-signing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  if (!["--key", "--publisher", "--plugin"].includes(flag)) {
    throw new Error(`unknown signer option: ${flag}`);
  }
  if (options.has(flag)) throw new Error(`duplicate signer option: ${flag}`);
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--") || value === "") {
    throw new Error(`missing value for ${flag}`);
  }
  options.set(flag, value);
}

function argument(name, fallback) {
  const value = options.get(`--${name}`);
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return value;
}

function localPluginRoot(source) {
  if (typeof source !== "string" || !source.startsWith("./")) {
    throw new Error(
      `signing requires a local ./ plugin source, received ${JSON.stringify(source)}`,
    );
  }
  const root = resolve(ROOT, source.slice(2));
  const rel = relative(ROOT, root);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep)) {
    throw new Error(`plugin source escapes repository root: ${source}`);
  }
  return root;
}

const keyPath = resolve(argument("key"));
const publisher = argument("publisher", "tetsuo-ai");
const privateKey = createPrivateKey(readFileSync(keyPath));
const derivedPublicKey = Buffer.from(
  createPublicKey(privateKey).export({ format: "der", type: "spki" }),
);
const publishedPublicKeys = readPublisherPublicKeys(ROOT).map((pem) => Buffer.from(
  createPublicKey(pem).export({
    format: "der",
    type: "spki",
  }),
));
if (!publishedPublicKeys.some((publicKey) =>
  derivedPublicKey.length === publicKey.length && timingSafeEqual(derivedPublicKey, publicKey)
)) {
  throw new Error("private signing key does not match a trusted publisher public key");
}

const marketplace = JSON.parse(
  readFileSync(join(ROOT, ".agenc-plugin", "marketplace.json"), "utf8"),
);
const selectedName = options.get("--plugin");
const selectedPlugins = selectedName === undefined
  ? marketplace.plugins
  : marketplace.plugins.filter((plugin) => plugin.name === selectedName);
if (selectedPlugins.length === 0) throw new Error(`unknown catalog plugin: ${selectedName}`);
for (const plugin of selectedPlugins) {
  const pluginRoot = localPluginRoot(plugin.source);
  const files = collectPluginPayloadDigests(pluginRoot);
  const signature = sign(
    null,
    pluginSignaturePayload(pluginRoot, files),
    privateKey,
  ).toString("base64");
  const signaturePath = join(pluginRoot, PLUGIN_SIGNATURE_PATH);
  mkdirSync(dirname(signaturePath), { recursive: true });
  writeFileSync(
    signaturePath,
    `${JSON.stringify({ publisher, signature, files }, null, 2)}\n`,
    { mode: 0o644 },
  );
  console.log(`signed ${plugin.name} (${Object.keys(files).length} payload files)`);
}
