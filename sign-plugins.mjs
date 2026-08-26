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

/**
 * Exactly the files core digests: everything under the plugin except its
 * manifest, the signature itself, the install metadata, and VCS
 * directories. Paths are repo-relative with forward slashes.
 */
function payloadDigests(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === ".hg" || entry.name === ".svn") {
          continue;
        }
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (rel === "plugin.json") continue;
      if (rel === ".agenc-plugin/signature.json") continue;
      if (rel === ".agenc-plugin/agenc-install.json") continue;
      out[rel] = `sha256:${createHash("sha256").update(readFileSync(full)).digest("hex")}`;
    }
  };
  walk(root);
  return out;
}

const keyPath = arg("key");
const publisher = arg("publisher");
const privateKey = createPrivateKey(readFileSync(keyPath));

const manifest = JSON.parse(readFileSync("marketplace.json", "utf8"));
for (const plugin of manifest.plugins) {
  const root = String(plugin.source).replace(/^\.\//, "");
  const files = payloadDigests(root);

  /*
   * The signed payload is exactly what core rebuilds to verify: the
   * manifest's own sha256 beside the digest map, keys sorted. Signing the
   * manifest bytes directly, or the map in insertion order, produces a
   * signature that verifies nowhere.
   */
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
  const payload = Buffer.from(
    JSON.stringify({
      manifestSha256: createHash("sha256")
        .update(readFileSync(join(root, "plugin.json")))
        .digest("hex"),
      files: sorted,
    }),
  );
  const signature = sign(null, payload, privateKey).toString("base64");

  mkdirSync(join(root, ".agenc-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".agenc-plugin/signature.json"),
    `${JSON.stringify({ publisher, signature, files: sorted }, null, 2)}\n`,
  );
  console.log(`signed ${plugin.name} — ${Object.keys(sorted).length} files`);
}
