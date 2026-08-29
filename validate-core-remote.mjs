/** Download and install the SHA-pinned hosted catalog through current Core code. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const coreRootInput = process.env.AGENC_CORE_ROOT;
if (coreRootInput === undefined || coreRootInput.trim().length === 0) {
  throw new Error("AGENC_CORE_ROOT must point to a current AgenC Core checkout");
}
const CORE_ROOT = resolve(coreRootInput);
const tsxCli = join(CORE_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const operationsUrl = pathToFileURL(
  join(CORE_ROOT, "runtime", "src", "plugins", "cli", "pluginOperations.ts"),
).href;
const catalogPath = join(ROOT, "public", "marketplace.json");
const publishersPath = join(ROOT, "public", "plugin-publishers.json");

for (const path of [tsxCli, catalogPath, publishersPath]) {
  if (!existsSync(path)) throw new Error(`required remote-smoke input is missing: ${path}`);
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const expectedSha = process.env.PLUGIN_REPO_SHA;
if (expectedSha !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(expectedSha)) {
  throw new Error("PLUGIN_REPO_SHA must be a full lowercase Git commit SHA");
}
for (const plugin of catalog.plugins ?? []) {
  if (plugin.source?.source !== "git-subdir") {
    throw new Error(`${plugin.name}: hosted source is not git-subdir`);
  }
  if (expectedSha !== undefined && plugin.source.sha !== expectedSha) {
    throw new Error(`${plugin.name}: hosted SHA does not match PLUGIN_REPO_SHA`);
  }
}

const verifierProgram = `
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPluginOp } from ${JSON.stringify(operationsUrl)};

void (async () => {
const root = await mkdtemp(join(tmpdir(), "agenc-plugins-remote-"));
const home = join(root, "home");
const storage = join(root, "plugins");
const sessions = join(root, "sessions");
const workspace = join(root, "workspace");
await Promise.all([home, storage, sessions, workspace].map((path) =>
  mkdir(path, { recursive: true, mode: 0o700 })
));

try {
  const catalog = JSON.parse(await readFile(process.env.AGENC_HOSTED_CATALOG, "utf8"));
  for (const entry of catalog.plugins) {
    const remote = entry.source;
    const result = await installPluginOp({
      source: {
        type: "git",
        url: remote.url,
        path: remote.path,
        sha: remote.sha,
      },
      name: entry.name + "@agenc-plugins",
      scope: "user",
      agencHome: home,
      pluginStorageRoot: storage,
      sessionTempRoot: sessions,
      workspaceRoot: workspace,
      env: {
        ...process.env,
        AGENC_HOME: home,
        HOME: home,
      },
      publishersPath: process.env.AGENC_PUBLISHERS_PATH,
      requireSignature: true,
      refreshCache: true,
    });
    if (result.resolutionKind !== "git" || result.signatureVerified !== true) {
      throw new Error(entry.name + ": remote install did not verify its signature");
    }
    if (result.plugin.name !== entry.name) {
      throw new Error(entry.name + ": installed manifest name mismatch");
    }
    const installedManifest = JSON.parse(
      await readFile(join(result.destination, ".agenc-plugin", "plugin.json"), "utf8")
    );
    if (installedManifest.interface?.logo !== "./assets/logo.png") {
      throw new Error(entry.name + ": installed manifest logo path mismatch");
    }
    const logo = await readFile(join(result.destination, "assets", "logo.png"));
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (logo.length < 33 || logo.length > 1024 * 1024 || !logo.subarray(0, 8).equals(pngMagic)) {
      throw new Error(entry.name + ": installed logo is not a bounded PNG");
    }
    const width = logo.readUInt32BE(16);
    const height = logo.readUInt32BE(20);
    if (
      logo.readUInt32BE(8) !== 13 ||
      logo.toString("ascii", 12, 16) !== "IHDR" ||
      width !== height ||
      width < 128 ||
      width > 1024 ||
      width * height > 1024 * 1024 ||
      logo[24] !== 8 ||
      logo[25] !== 6
    ) {
      throw new Error(entry.name + ": installed logo has an invalid IHDR");
    }
    const installedSignature = JSON.parse(
      await readFile(join(result.destination, ".agenc-plugin", "signature.json"), "utf8")
    );
    const expectedLogoDigest = "sha256:" + createHash("sha256").update(logo).digest("hex");
    if (installedSignature.files?.["assets/logo.png"] !== expectedLogoDigest) {
      throw new Error(entry.name + ": installed logo digest is not signed");
    }
    console.log(JSON.stringify({
      plugin: result.plugin.id,
      resolutionKind: result.resolutionKind,
      signatureVerified: result.signatureVerified,
      logo: installedManifest.interface.logo,
      logoBytes: logo.length,
    }));
  }
  console.log("Core remote catalog smoke test passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
})().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
`;

const result = spawnSync(process.execPath, [tsxCli, "--eval", verifierProgram], {
  cwd: join(CORE_ROOT, "runtime"),
  env: {
    ...process.env,
    AGENC_HOSTED_CATALOG: catalogPath,
    AGENC_PUBLISHERS_PATH: publishersPath,
  },
  encoding: "utf8",
  timeout: 10 * 60_000,
  maxBuffer: 4 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.stdout.length > 0) process.stdout.write(result.stdout);
if (result.stderr.length > 0) process.stderr.write(result.stderr);
if (result.status !== 0) {
  throw new Error(`Core remote catalog smoke test failed (${result.status})`);
}
