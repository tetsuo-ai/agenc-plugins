/** Build the static marketplace and publisher-key artifacts. */
import { execFileSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publisherPublicKeyBase64 } from "./plugin-signing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(ROOT, "public");
const REPOSITORY =
  process.env.PLUGIN_REPO_URL ?? "https://github.com/tetsuo-ai/agenc-plugins.git";

function repositorySha() {
  const value =
    process.env.PLUGIN_REPO_SHA ??
    process.env.GITHUB_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(value)) {
    throw new Error("PLUGIN_REPO_SHA must be a full 40- or 64-character commit SHA");
  }
  return value.toLowerCase();
}

const sha = repositorySha();
const sourceManifest = JSON.parse(
  readFileSync(join(ROOT, ".agenc-plugin", "marketplace.json"), "utf8"),
);
const hostedManifest = {
  ...sourceManifest,
  plugins: sourceManifest.plugins.map((plugin) => {
    if (typeof plugin.source !== "string" || !plugin.source.startsWith("./")) {
      throw new Error(`${plugin.name}: source manifest must use a local ./ path`);
    }
    return {
      ...plugin,
      source: {
        source: "git-subdir",
        url: REPOSITORY,
        path: plugin.source.slice(2),
        sha,
      },
    };
  }),
};

const publicKeyPem = readFileSync(join(ROOT, "agenc-plugins.pub"), "utf8");
createPublicKey(publicKeyPem);
const publisherKeyring = {
  publishers: {
    "tetsuo-ai": {
      publicKey: publisherPublicKeyBase64(publicKeyPem),
    },
  },
};

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(join(OUTPUT, ".agenc-plugin"), { recursive: true });
const manifestText = `${JSON.stringify(hostedManifest, null, 2)}\n`;
writeFileSync(join(OUTPUT, "marketplace.json"), manifestText);
writeFileSync(join(OUTPUT, ".agenc-plugin", "marketplace.json"), manifestText);
writeFileSync(join(OUTPUT, "agenc-plugins.pub"), publicKeyPem.trimEnd() + "\n");
writeFileSync(
  join(OUTPUT, "plugin-publishers.json"),
  `${JSON.stringify(publisherKeyring, null, 2)}\n`,
);

console.log(
  `built ${hostedManifest.plugins.length} plugins from ${REPOSITORY}@${sha}`,
);
