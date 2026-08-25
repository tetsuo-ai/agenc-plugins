/**
 * The hosted manifest is the local one with its plugin sources rewritten.
 *
 * A marketplace added by URL downloads only the manifest, so a relative
 * "./plugins/ledger" has nothing to resolve against on the client. Each
 * plugin has to name a fetchable source of its own, which for us is this
 * same repository at a pinned ref.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const REPO =
  process.env.PLUGIN_REPO_URL ?? "https://github.com/tetsuo-ai/agenc-plugins";
const REF = process.env.PLUGIN_REPO_REF ?? "main";

const manifest = JSON.parse(readFileSync("marketplace.json", "utf8"));
const hosted = {
  ...manifest,
  plugins: manifest.plugins.map((plugin) => ({
    ...plugin,
    source: {
      source: "git-subdir",
      url: REPO,
      path: String(plugin.source).replace(/^\.\//, ""),
      ref: REF,
    },
  })),
};

mkdirSync("public", { recursive: true });
writeFileSync("public/marketplace.json", `${JSON.stringify(hosted, null, 2)}\n`);
console.log(
  `wrote public/marketplace.json — ${hosted.plugins.length} plugins from ${REPO}@${REF}`,
);
