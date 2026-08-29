/**
 * Sign every plugin listed in .agenc-plugin/marketplace.json.
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
} from "./plugin-signing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return process.argv[index + 1];
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
const publishedPublicKey = Buffer.from(
  createPublicKey(readFileSync(join(ROOT, "agenc-plugins.pub"))).export({
    format: "der",
    type: "spki",
  }),
);
if (
  derivedPublicKey.length !== publishedPublicKey.length ||
  !timingSafeEqual(derivedPublicKey, publishedPublicKey)
) {
  throw new Error("private signing key does not match agenc-plugins.pub");
}

const marketplace = JSON.parse(
  readFileSync(join(ROOT, ".agenc-plugin", "marketplace.json"), "utf8"),
);
for (const plugin of marketplace.plugins) {
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
