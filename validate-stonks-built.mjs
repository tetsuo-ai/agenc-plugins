/**
 * Real built-Core Stonks smoke test, with a disposable home and normal sandbox.
 *
 * AGENC_CORE_RUNTIME=/absolute/core/runtime node validate-stonks-built.mjs
 * Add --committed-fixture to test the signed HEAD payload instead of dirty files.
 * Add --expect-network-blocked to reproduce the default network-denial baseline.
 * That baseline is NOT a successful release acceptance test.
 * Add --approved-network only for an explicitly authorized, task-local network
 * fixture. It keeps workspace_write and native isolation, then restarts without
 * the grant and probes an uncached symbol to verify default denial again.
 *
 * No source imports, unsigned installs, live profiles, credentials, daemon,
 * trading calls, or sandbox bypass. Public reads use AAPL and at most 2 months.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPluginSignatureFile } from "./plugin-signing.mjs";

const script = fileURLToPath(import.meta.url);
const repository = dirname(script);
const childMode = process.argv[2] === "--isolated-child";

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function run(executable, args, { cwd, env, timeout = 60_000 }) {
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Command failed (${result.status}): ${args[0]}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

// Discover only named exports in built artifacts so hashed chunk names can change.
function builtModule(runtime, symbols) {
  const dist = join(runtime, "dist");
  const matches = readdirSync(dist).filter((name) => /^chunk-[A-Z0-9]+\.js$/u.test(name)).filter((name) => {
    const text = readFileSync(join(dist, name), "utf8");
    const exports = text.slice(text.lastIndexOf("export {"));
    return symbols.every((symbol) => new RegExp(`(?:^|\\n)\\s*${symbol}(?:,|\\s|$)`, "u").test(exports));
  });
  assert.equal(matches.length, 1, `Expected one built chunk exporting ${symbols.join(", ")}`);
  return pathToFileURL(join(dist, matches[0])).href;
}

function resultObject(result) {
  if (typeof result === "string") {
    try { return JSON.parse(result); } catch { return undefined; }
  }
  if (Array.isArray(result)) {
    for (const item of result) { const value = resultObject(item); if (value) return value; }
    return undefined;
  }
  if (!result || typeof result !== "object") return undefined;
  if (result.bars !== undefined || result.path !== undefined) return result;
  return resultObject(result.structuredContent) ?? resultObject(result.codeModeResult) ?? resultObject(result.content) ?? resultObject(result.text);
}

async function isolatedChild(runtime, approvedNetwork = false, symbol = "AAPL") {
  assert.ok(isAbsolute(runtime), "Child requires an absolute built Core path");
  const environment = Object.freeze({ ...process.env });
  const sessionModule = await import(builtModule(runtime, ["ConfigStore", "init_store", "createSessionMcpManager", "init_mcp_startup"]));
  const configModule = await import(builtModule(runtime, ["getAllMcpConfigs", "init_config"]));
  const sandboxModule = await import(builtModule(runtime, ["SandboxExecutionBroker", "init_execution_broker", "pluginMcpPermissionProfile"]));
  sessionModule.init_store(); sessionModule.init_mcp_startup(); configModule.init_config(); sandboxModule.init_execution_broker();
  const { ConfigStore, createSessionMcpManager } = sessionModule;
  const { getAllMcpConfigs } = configModule;
  const store = new ConfigStore({ home: environment.AGENC_HOME, cwd: process.cwd(), env: environment });
  await store.reload();
  const resolved = await getAllMcpConfigs(store, { pluginStorageRoot: environment.AGENC_PLUGIN_CACHE_DIR }, environment);
  assert.deepEqual(resolved.errors, []);
  assert.equal(Object.keys(resolved.servers).length, 1, "Use only the installed plugin, never a duplicate custom MCP");
  const [name, definition] = Object.entries(resolved.servers)[0];
  assert.match(name, /stonks/);
  assert.equal(definition.type, "stdio");
  assert.equal(definition.command, "node");
  assert.deepEqual(definition.args, ["./server/main.mjs"]);
  assert.equal(definition.pluginSandbox?.mode, "stdio-child-process");
  assert.ok(inside(environment.AGENC_PLUGIN_CACHE_DIR, definition.cwd));
  assert.ok(inside(environment.AGENC_PLUGIN_CACHE_DIR, definition.env.AGENC_PLUGIN_DATA));
  const { type, ...preserved } = definition;
  const config = { ...preserved, name, transport: type };
  // This is explicit operator-owned fixture authority, not plugin metadata or
  // an automatic grant. Nothing is persisted into the user's configuration.
  const brokerOptions = { mode: "workspace_write", cwd: process.cwd(), env: environment, sessionTempRoot: environment.AGENC_TMPDIR };
  const defaultBroker = new sandboxModule.SandboxExecutionBroker(brokerOptions);
  // Reuse Core's actual default filesystem profile; authorize only its network
  // enum. The non-exported bundle helper is not replaced with source imports.
  const broker = approvedNetwork ? new sandboxModule.SandboxExecutionBroker({
    ...brokerOptions,
    permissionProfile: { ...defaultBroker.runtimeSandbox("mcp_stdio").permissionProfile, network: "enabled" },
  }) : defaultBroker;
  assert.equal(broker.mode, "workspace_write");
  assert.equal(broker.required, true);
  const manager = createSessionMcpManager([config], { environment, sandboxExecutionBroker: broker });
  const report = {
    builtOnly: true,
    node: process.version,
    server: name,
    probeSymbol: symbol,
    approvedNetworkFixture: approvedNetwork,
    sandboxMode: broker.mode,
    sandboxRequired: broker.required,
    pluginPermissionProfile: sandboxModule.pluginMcpPermissionProfile({ pluginDataDir: definition.env.AGENC_PLUGIN_DATA }, broker.executionAuthority().permissionProfile?.network),
    initialized: false,
  };
  assert.equal(report.pluginPermissionProfile.fileSystem.kind, "restricted");
  assert.deepEqual(report.pluginPermissionProfile.fileSystem.entries.filter((entry) => entry.access === "write"), [
    { path: { kind: "path", path: definition.env.AGENC_PLUGIN_DATA }, access: "write" },
  ], "Approved network must not widen the plugin filesystem");
  try {
    await manager.start({ requireOneReady: true, timeoutMs: 15_000 });
    assert.deepEqual(manager.getConnectedServers(), [name]);
    report.initialized = true;
    report.toolCount = manager.getTools().length;
    assert.equal(report.toolCount, 14);
    const metrics = await manager.callTool(name, "metrics_registry", {}, { signal: AbortSignal.timeout(10_000) });
    assert.ok(!metrics.isError, JSON.stringify(metrics));
    assert.match(JSON.stringify(metrics), /revenue_growth/);
    report.metrics = "passed";
    for (const tool of ["ohlcv", "chart_price"]) {
      try {
        const result = await manager.callTool(name, tool, { symbol, months: 2 }, { signal: AbortSignal.timeout(40_000) });
        if (result.isError) {
          report[tool] = { passed: false, error: JSON.stringify(result).slice(0, 1600) };
          continue;
        }
        const value = resultObject(result);
        if (tool === "ohlcv") {
          if (!Array.isArray(value?.bars) || value.bars.length < 2) {
            const summary = JSON.stringify(result);
            const match = new RegExp(`(\\d+) daily bars for ${symbol}\\b`, "u").exec(summary);
            report[tool] = { passed: false, publicReadSucceeded: Number(match?.[1] ?? 0) >= 2, diagnostic: "legacy-missing-bars", error: "ohlcv did not return the full bar array", ...(match ? { reportedBars: Number(match[1]), summary: summary.slice(0, 500) } : {}) };
            continue;
          }
          report[tool] = { passed: true, bars: value.bars.length, source: value.priceData?.source ?? null };
        } else {
          assert.ok(typeof value?.path === "string" && isAbsolute(value.path), "chart must return an absolute artifact path");
          const chartPath = realpathSync(value.path);
          assert.ok(inside(definition.env.AGENC_PLUGIN_DATA, chartPath), "chart must stay inside plugin data");
          const chart = readFileSync(chartPath, "utf8");
          assert.match(chart, /<svg\b/u);
          assert.match(chart, /<\/svg>/u);
          assert.ok(!/<script\b|\sonload\s*=|<foreignObject\b/iu.test(chart));
          report[tool] = { passed: true, bytes: Buffer.byteLength(chart), sha256: createHash("sha256").update(chart).digest("hex"), artifact: relative(environment.AGENC_PLUGIN_CACHE_DIR, chartPath) };
        }
      } catch (error) {
        report[tool] = { passed: false, error: String(error?.message ?? error).slice(0, 1600) };
      }
    }
  } finally {
    await manager.stop();
  }
  console.log(`STONKS_BUILT_RESULT:${JSON.stringify(report)}`);
}

async function parent() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) assert.ok(["--committed-fixture", "--expect-network-blocked", "--approved-network"].includes(flag), `Unknown option: ${flag}`);
  assert.ok(!(flags.has("--approved-network") && flags.has("--expect-network-blocked")), "Approved and denied fixtures are separate cases");
  const runtimeInput = process.env.AGENC_CORE_RUNTIME;
  assert.ok(runtimeInput && isAbsolute(runtimeInput), "AGENC_CORE_RUNTIME must be an absolute Core runtime directory");
  const runtime = realpathSync(runtimeInput);
  assert.ok(existsSync(join(runtime, "bin", "agenc")) && existsSync(join(runtime, "dist")), "Core must already be built");
  const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "stonks-built-integration-")));
  try {
    const workspace = join(temporaryRoot, "workspace");
    const environment = {
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      HOME: join(temporaryRoot, "platform-home"),
      AGENC_HOME: join(temporaryRoot, "agenc"),
      AGENC_PLUGIN_CACHE_DIR: join(temporaryRoot, "plugins"),
      AGENC_TMPDIR: join(temporaryRoot, "session-temp"),
      TMPDIR: join(temporaryRoot, "session-temp"),
      XDG_CONFIG_HOME: join(temporaryRoot, "xdg-config"),
      XDG_CACHE_HOME: join(temporaryRoot, "xdg-cache"),
      XDG_DATA_HOME: join(temporaryRoot, "xdg-data"),
      NODE_ENV: "production", NO_COLOR: "1",
    };
    for (const path of [workspace, environment.HOME, environment.AGENC_HOME, environment.AGENC_PLUGIN_CACHE_DIR, environment.AGENC_TMPDIR]) mkdirSync(path, { recursive: true, mode: 0o700 });
    let source = join(repository, "plugins", "stonks-copilot");
    let fixtureCommit;
    if (flags.has("--committed-fixture")) {
      fixtureCommit = run("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: repository, env: environment });
      source = join(temporaryRoot, "signed-fixture");
      const prefix = "plugins/stonks-copilot/";
      const files = run("/usr/bin/git", ["ls-tree", "-r", "--name-only", fixtureCommit, "--", prefix], { cwd: repository, env: environment }).split("\n");
      assert.ok(files.length > 1);
      for (const file of files) {
        assert.ok(file.startsWith(prefix) && !file.includes(".."));
        const destination = join(source, file.slice(prefix.length));
        assert.ok(inside(source, destination));
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        const blob = spawnSync("/usr/bin/git", ["show", `${fixtureCommit}:${file}`], { cwd: repository, env: environment, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(blob.status, 0);
        writeFileSync(destination, blob.stdout, { mode: 0o600 });
      }
    }
    const signature = verifyPluginSignatureFile(source, readFileSync(join(repository, "agenc-plugins.pub"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(source, ".agenc-plugin", "plugin.json"), "utf8"));
    const cli = join(runtime, "bin", "agenc");
    const version = run(process.execPath, [cli, "--version"], { cwd: workspace, env: environment });
    run(process.execPath, [cli, "plugin", "install", source, "--scope", "user", "--name", "stonks-copilot@agenc-plugins"], { cwd: workspace, env: environment });
    const probe = (mode) => {
      const output = run(process.execPath, [script, "--isolated-child", runtime, mode], { cwd: workspace, env: environment, timeout: 115_000 });
      const resultLine = output.split("\n").find((line) => line.startsWith("STONKS_BUILT_RESULT:"));
      assert.ok(resultLine, `Built manager did not return a report: ${output}`);
      return JSON.parse(resultLine.slice("STONKS_BUILT_RESULT:".length));
    };
    const report = { coreRuntime: runtime, coreVersion: version, pluginVersion: manifest.version, signature, fixture: fixtureCommit ?? "signed-current-payload", ...probe(flags.has("--approved-network") ? "--approved-network" : "--default-network") };
    if (flags.has("--approved-network")) {
      // A fresh built manager/broker, same isolated installation, and no grant.
      // MSFT was not fetched above, so cached AAPL bars cannot hide denial.
      report.revokedRestart = probe("--revoked-network");
    }
    report.releaseAccepted = !flags.has("--committed-fixture") && report.ohlcv?.passed === true && report.chart_price?.passed === true &&
      (!flags.has("--approved-network") || (report.revokedRestart.pluginPermissionProfile.network === "disabled" && report.revokedRestart.ohlcv?.passed === false && report.revokedRestart.chart_price?.passed === false));
    console.log(JSON.stringify(report, null, 2));
    if (flags.has("--expect-network-blocked")) {
      assert.equal(report.ohlcv?.passed, false, "Baseline expected public data to be blocked");
      assert.equal(report.chart_price?.passed, false, "Baseline expected network-backed chart to be blocked");
      assert.match(JSON.stringify(report.pluginPermissionProfile), /disabled/u, "Expected built plugin profile to deny network");
      console.log("Baseline reproduced. This is not release acceptance.");
    } else {
      if (fixtureCommit && flags.has("--approved-network") && report.ohlcv?.diagnostic === "legacy-missing-bars") {
        assert.equal(report.ohlcv.publicReadSucceeded, true, "Legacy fixture must prove a successful upstream read");
        console.log("Legacy signed fixture omitted full bars. Network verification only; release acceptance remains false.");
      } else assert.equal(report.ohlcv?.passed, true, "Public-data call failed in the real built sandbox");
      assert.equal(report.chart_price?.passed, true, "Chart failed in the real built sandbox");
      if (flags.has("--approved-network")) {
        assert.equal(report.pluginPermissionProfile.network, "enabled");
        assert.equal(report.revokedRestart.pluginPermissionProfile.network, "disabled");
        assert.equal(report.revokedRestart.ohlcv?.passed, false, "Revoked restart must not fetch uncached public data");
        assert.equal(report.revokedRestart.chart_price?.passed, false, "Revoked restart must not create an uncached network-backed chart");
      }
    }
  } finally {
    assert.equal(dirname(temporaryRoot), realpathSync(tmpdir()));
    assert.ok(temporaryRoot.split(sep).at(-1).startsWith("stonks-built-integration-"));
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (childMode) await isolatedChild(process.argv[3], process.argv[4] === "--approved-network", process.argv[4] === "--revoked-network" ? "MSFT" : "AAPL");
else await parent();
