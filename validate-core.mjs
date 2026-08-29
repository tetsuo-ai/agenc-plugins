/** Run the repository against a real modern AgenC binary in an isolated home. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const AGENC_BIN = process.env.AGENC_BIN ?? "agenc";
const temporaryRoot = mkdtempSync(join(tmpdir(), "agenc-plugins-core-"));
const agencHome = join(temporaryRoot, "home");
const pluginStorageRoot = join(temporaryRoot, "plugins");
mkdirSync(agencHome, { recursive: true });
mkdirSync(pluginStorageRoot, { recursive: true });

function run(args) {
  const result = spawnSync(AGENC_BIN, args, {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      AGENC_HOME: agencHome,
      AGENC_PLUGIN_CACHE_DIR: pluginStorageRoot,
      NO_COLOR: "1",
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${AGENC_BIN} ${args.join(" ")} failed (${result.status})\n${result.stdout}${result.stderr}`,
    );
  }
  if (result.stdout.trim().length > 0) console.log(result.stdout.trim());
  if (result.stderr.trim().length > 0) console.error(result.stderr.trim());
  return result.stdout;
}

try {
  run(["--version"]);
  run([
    "plugin",
    "validate",
    join(ROOT, ".agenc-plugin", "marketplace.json"),
    "--marketplace",
    "--json",
  ]);
  for (const plugin of ["zeroday-hunter", "iot-builder", "ledger"]) {
    run(["plugin", "validate", join(ROOT, "plugins", plugin), "--json"]);
  }
  run(["plugin", "marketplace", "add", ROOT, "--name", "agenc-plugins"]);
  run(["plugin", "marketplace", "list", "--json"]);
  for (const plugin of ["zeroday-hunter", "iot-builder", "ledger"]) {
    run([
      "plugin",
      "install",
      join(ROOT, "plugins", plugin),
      "--scope",
      "user",
      "--name",
      `${plugin}@agenc-plugins`,
    ]);
  }
  const installed = run(["plugin", "list", "--json"]);
  for (const plugin of ["zeroday-hunter", "iot-builder", "ledger"]) {
    if (!installed.includes(`${plugin}@agenc-plugins`)) {
      throw new Error(`installed plugin list does not contain ${plugin}@agenc-plugins`);
    }
  }
  console.log("Core contract smoke test passed");
} finally {
  if (!temporaryRoot.startsWith(`${tmpdir()}/agenc-plugins-core-`)) {
    throw new Error(`refusing to clean unexpected temporary path: ${temporaryRoot}`);
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
