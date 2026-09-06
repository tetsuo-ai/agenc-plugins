/**
 * Exercise the installed Stonks manifest through real AgenC Core registration
 * and its native MCP manager. Requires a Core checkout with dependencies and
 * an existing CLI build; does not build Core or contact a running daemon.
 * Usage: AGENC_CORE_RUNTIME=/absolute/core/runtime node validate-stonks-core.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = dirname(fileURLToPath(import.meta.url));
const runtimeInput = process.env.AGENC_CORE_RUNTIME;
assert.ok(runtimeInput && isAbsolute(runtimeInput), "AGENC_CORE_RUNTIME must name an absolute Core runtime directory");
const runtime = realpathSync(runtimeInput);
const cli = join(runtime, "bin", "agenc");
const loader = join(runtime, "..", "node_modules", "tsx", "dist", "loader.mjs");
assert.ok(existsSync(cli) && existsSync(loader), "Core requires its built CLI and installed tsx dependency");
const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "stonks-core-integration-")));
const agencHome = join(temporaryRoot, "agenc");
const pluginStorageRoot = join(temporaryRoot, "plugins");
const sessionTempRoot = join(temporaryRoot, "session-temp");
const workspaceRoot = join(temporaryRoot, "workspace");
for (const directory of [agencHome, pluginStorageRoot, sessionTempRoot, workspaceRoot]) mkdirSync(directory, { recursive: true, mode: 0o700 });

// An allowlist keeps credentials and user-specific runtime settings out of
// both the CLI and native MCP process. Every writable authority is disposable.
const environment = {
  PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
  AGENC_HOME: agencHome,
  AGENC_PLUGIN_CACHE_DIR: pluginStorageRoot,
  AGENC_TMPDIR: sessionTempRoot,
  TMPDIR: sessionTempRoot,
  XDG_CONFIG_HOME: join(temporaryRoot, "xdg-config"),
  XDG_CACHE_HOME: join(temporaryRoot, "xdg-cache"),
  XDG_DATA_HOME: join(temporaryRoot, "xdg-data"),
  TSX_TSCONFIG_PATH: join(runtime, "tsconfig.json"),
  NODE_ENV: "production",
  NO_COLOR: "1",
};

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: workspaceRoot,
    env: environment,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const sourceModule = (relative) => JSON.stringify(pathToFileURL(join(runtime, "src", relative)).href);
try {
  console.log(`Core CLI: ${run([cli, "--version"])}`);
  const validation = JSON.parse(run([cli, "plugin", "validate", join(repository, "plugins", "stonks-copilot"), "--json"]));
  assert.equal(validation.success, true, JSON.stringify(validation));
  console.log("Core plugin validation passed");
  console.log(run([cli, "plugin", "install", join(repository, "plugins", "stonks-copilot"), "--scope", "user", "--name", "stonks-copilot@agenc-plugins"]));
  const listing = JSON.parse(run([cli, "plugin", "list", "--json"]));
  const installed = listing.plugins.find((plugin) => plugin.id === "stonks-copilot@agenc-plugins");
  assert.ok(installed?.enabled, "Core must enable the installed plugin");
  assert.ok(installed.root.startsWith(`${pluginStorageRoot}/`), "Core must install under the disposable cache");
  console.log(run([
    "--import", loader, "--input-type=module", "--eval",
    `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
// Core's production bundler imports prompt Markdown as text. Mirror that
// asset loader without rebuilding or writing to the running Core checkout.
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".md")) {
    return { format: "module", source: "export default " + JSON.stringify(readFileSync(new URL(url), "utf8")), shortCircuit: true };
  }
  return nextLoad(url, context);
} });
const { ConfigStore } = await import(${sourceModule("config/store.ts")});
const { loadPluginMcpServers } = await import(${sourceModule("plugins/registration/mcp-plugin-integration.ts")});
const { MCPManager } = await import(${sourceModule("mcp-client/manager.ts")});
const { SandboxExecutionBroker } = await import(${sourceModule("sandbox/execution-broker.ts")});
const environment = Object.freeze({ ...process.env });
const store = new ConfigStore({ home: environment.AGENC_HOME, cwd: process.cwd(), env: environment });
await store.reload();
const errors = [];
const servers = await loadPluginMcpServers({
  cwd: process.cwd(),
  pluginStorageRoot: environment.AGENC_PLUGIN_CACHE_DIR,
  config: store.current(),
  env: environment,
  errors,
});
assert.deepEqual(errors, []);
assert.equal(Object.keys(servers).length, 1);
const [name, config] = Object.entries(servers)[0];
assert.equal(config.command, "node");
assert.deepEqual(config.args, ["./server/main.mjs"]);
assert.ok(config.cwd.startsWith(environment.AGENC_PLUGIN_CACHE_DIR + "/"));
assert.ok(config.env.AGENC_PLUGIN_DATA.startsWith(environment.AGENC_PLUGIN_CACHE_DIR + "/"));
assert.equal(config.pluginSandbox.mode, "stdio-child-process");
const broker = new SandboxExecutionBroker({
  mode: "danger_full_access",
  cwd: process.cwd(),
  env: environment,
  sessionTempRoot: environment.AGENC_TMPDIR,
});
const manager = new MCPManager([{ name, ...config }], undefined, environment);
manager.setSandboxExecutionBroker(broker);
try {
  await manager.start({ requireOneReady: true, timeoutMs: 10_000 });
  assert.deepEqual(manager.getConnectedServers(), [name]);
  const tools = manager.getTools().map((tool) => tool.name);
  assert.equal(tools.length, 14);
  assert.ok(tools.includes("mcp." + name + ".metrics_registry"));
  const result = await manager.callTool(name, "metrics_registry", {});
  assert.ok(!result.isError, JSON.stringify(result));
  assert.match(JSON.stringify(result), /revenue_growth/);
  console.log(JSON.stringify({ nativeMcp: "passed", server: name, toolCount: tools.length, safeToolCall: "metrics_registry", manifestCommandUnchanged: true, pathInheritance: "Core default", isolatedStorage: true }));
} finally {
  await manager.stop();
}
`,
  ]));
  console.log("Stonks Core install, initialize, tools/list and safe tool call passed");
} finally {
  assert.equal(dirname(temporaryRoot), realpathSync(tmpdir()));
  assert.ok(temporaryRoot.split("/").at(-1).startsWith("stonks-core-integration-"));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
