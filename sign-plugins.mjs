/**
 * Sign each plugin so it can be installed from git or a URL.
 *
 * AgenC requires a signature for any non-local source — `requireSignature`
 * defaults to `kind !== "local"` — so a marketplace served over HTTPS or
 * cloned from GitHub refuses to install unsigned plugins. A local checkout
 * does not, which is why this only shows up once you publish.
 *
 * Usage:
 *   node sign-plugins.mjs --key ~/.agenc/keys/agenc-plugins.pem --publisher tetsuo-ai
 *
 * The private key never belongs in this repository. Generate one with:
 *   openssl genpkey -algorithm ed25519 -out agenc-plugins.pem
 *   openssl pkey -in agenc-plugins.pem -pubout -out agenc-plugins.pub
 *
 * Users install only if they trust the matching public key, which goes in
 * their ~/.agenc/plugin-publishers.json as:
 *   { "publishers": { "tetsuo-ai": "<contents of agenc-plugins.pub>" } }
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return process.argv[index + 1];
}

/** Every file under the plugin except its manifest and the signature itself. */
function payloadFiles(root, manifestRel, signatureRel) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === ".git" || entry === "node_modules") continue;
        walk(full);
        continue;
      }
      const rel = relative(root, full).split(sep).join("/");
      if (rel === manifestRel || rel === signatureRel) continue;
      found.push(rel);
    }
  };
  walk(root);
  return found.sort();
}

const keyPath = arg("key");
const publisher = arg("publisher");
const privateKey = createPrivateKey(readFileSync(keyPath));

const manifest = JSON.parse(readFileSync("marketplace.json", "utf8"));
for (const plugin of manifest.plugins) {
  const root = String(plugin.source).replace(/^\.\//, "");
  const manifestRel = "plugin.json";
  const signatureRel = ".agenc-plugin/signature.json";

  const files = {};
  for (const rel of payloadFiles(root, manifestRel, signatureRel)) {
    files[rel] = createHash("sha256").update(readFileSync(join(root, rel))).digest("hex");
  }

  // The payload is the manifest bytes followed by the canonical file digest
  // map — the same two things core hashes when it verifies, so any edit to a
  // skill or an MCP config invalidates the signature.
  const manifestBytes = readFileSync(join(root, manifestRel));
  const payload = Buffer.concat([
    manifestBytes,
    Buffer.from(JSON.stringify(files, Object.keys(files).sort()), "utf8"),
  ]);
  const signature = sign(null, payload, privateKey).toString("base64");

  mkdirSync(join(root, ".agenc-plugin"), { recursive: true });
  writeFileSync(
    join(root, signatureRel),
    `${JSON.stringify({ publisher, signature, files }, null, 2)}\n`,
  );
  console.log(`signed ${plugin.name} — ${Object.keys(files).length} files`);
}
