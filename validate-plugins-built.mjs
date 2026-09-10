/** Install signed packages and exercise their tools through compiled Core's native sandbox. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPublisherPublicKeys, verifyPluginSignatureFile } from "./plugin-signing.mjs";

const script = fileURLToPath(import.meta.url);
const repository = dirname(script);
const probes = {
  "paper-radar": [
    ["ingest_extract", { text: "Annual renewal on 2027-10-01. Premium EUR 120 per year." }, /2027-10-01/],
    ["ledger_upsert", { title: "QA fixture", category: "software", period: "annual", anchorDate: "2027-10-01", cost: 12, costPeriod: "month", currency: "EUR" }, /QA fixture/],
    ["ledger_list", {}, /QA fixture/], ["cost_report", {}, /144/], ["radar", {}, /rows/], ["ics_export", { years: 5 }, /paper-radar-/],
  ],
  inbox: [["auth_status", {}, /credentialsStored/], ["vault_search", {}, /totalBytes/]],
  pluma: [["styles_list", {}, /email-profesional/], ["style_lint", { text: "Entrega el informe hoy.", style: "directo" }, /violations/]],
  forja: [["code_styles_list", {}, /minimal-diff/], ["code_lint", { code: "export const double = (value) => value * 2;", style: "limpio" }, /violations/]],
  motor3d: [["scaffolds_list", {}, /three-basic-scene/], ["scaffold_get", { name: "three-basic-scene" }, /WebGLRenderer/], ["lint3d", { code: "new THREE.Geometry();" }, /BufferGeometry/], ["harness_build", { code: "document.body.dataset.qa = 'ok';" }, /doctype/]],
  olimpo: [
    ["problems_list", {limit:100}, /"count":16/],
    ["problem_search", {query:"vieta"}, /olimpo-nt-004/],
    ["problem_get", {id:"olimpo-nt-001",level:"solution"}, /"answer":"1"/],
    ["answer_check", {id:"olimpo-co-001",attempt:"20"}, /"correct":true/],
    ["problem_random", {topic:"geometry"}, /olimpo-ge-/],
    ["study_plan", {count:3}, /"plan"/],
    ["progress_mark", {id:"olimpo-nt-001",status:"attempted"}, /attempted/],
    ["progress_list", {}, /olimpo-nt-001/],
    ["ingest", {items:[{id:"user-native-qa",statement:"A private synthetic QA exercise for the native sandbox."}]}, /user-native-qa/],
    ["problem_get", {id:"user-native-qa"}, /unreviewed/],
  ],
};

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
function builtModule(runtime, symbols) {
  const dist = join(runtime, "dist");
  const matches = readdirSync(dist).filter((name) => /^chunk-[A-Z0-9]+\.js$/u.test(name)).filter((name) => {
    const source = readFileSync(join(dist, name), "utf8");
    const exports = source.slice(source.lastIndexOf("export {"));
    return symbols.every((symbol) => new RegExp(`(?:^|\\n)\\s*${symbol}(?:,|\\s|$)`, "u").test(exports));
  });
  assert.equal(matches.length, 1, `Missing compiled Core exports: ${symbols}`);
  return pathToFileURL(join(dist, matches[0])).href;
}

async function child(runtime, plugin) {
  const environment = Object.freeze({ ...process.env });
  const session = await import(builtModule(runtime, ["ConfigStore", "init_store", "createSessionMcpManager", "init_mcp_startup"]));
  const config = await import(builtModule(runtime, ["getAllMcpConfigs", "init_config"]));
  const sandbox = await import(builtModule(runtime, ["SandboxExecutionBroker", "init_execution_broker", "pluginMcpPermissionProfile"]));
  session.init_store(); session.init_mcp_startup(); config.init_config(); sandbox.init_execution_broker();
  const store = new session.ConfigStore({ home: environment.AGENC_HOME, cwd: process.cwd(), env: environment });
  await store.reload();
  const resolved = await config.getAllMcpConfigs(store, { pluginStorageRoot: environment.AGENC_PLUGIN_CACHE_DIR }, environment);
  assert.deepEqual(resolved.errors, []);
  assert.equal(Object.keys(resolved.servers).length, 1);
  const [name, { type, ...definition }] = Object.entries(resolved.servers)[0];
  assert.equal(type, "stdio"); assert.equal(definition.pluginSandbox.mode, "stdio-child-process");
  const broker = new sandbox.SandboxExecutionBroker({ mode: "workspace_write", cwd: process.cwd(), env: environment, sessionTempRoot: environment.AGENC_TMPDIR });
  assert.equal(broker.required, true);
  const profile = sandbox.pluginMcpPermissionProfile({ pluginDataDir: definition.env.AGENC_PLUGIN_DATA }, broker.executionAuthority().permissionProfile?.network);
  assert.equal(profile.network, "disabled");
  assert.deepEqual(profile.fileSystem.entries.filter((entry) => entry.access === "write"), [{ path: { kind: "path", path: definition.env.AGENC_PLUGIN_DATA }, access: "write" }]);
  const manager = session.createSessionMcpManager([{ name, transport: type, ...definition }], { environment, sandboxExecutionBroker: broker });
  try {
    await manager.start({ requireOneReady: true, timeoutMs: 15000 });
    assert.deepEqual(manager.getConnectedServers(), [name]);
    for (const [tool, args, expected] of probes[plugin]) {
      const result = await manager.callTool(name, tool, args, { signal: AbortSignal.timeout(15000) });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.match(JSON.stringify(result), expected, `${plugin}.${tool}`);
    }
    console.log(JSON.stringify({ plugin, builtOnly: true, nativeSandbox: true, defaultNetworkDenied: true, tools: manager.getTools().length, probes: probes[plugin].length }));
  } finally { await manager.stop(); }
}

async function parent() {
  assert.ok(process.env.AGENC_CORE_RUNTIME, "Set AGENC_CORE_RUNTIME to a compiled Core runtime");
  const runtime = realpathSync(process.env.AGENC_CORE_RUNTIME);
  const catalog = JSON.parse(readFileSync(join(repository, ".agenc-plugin/marketplace.json"), "utf8"));
  for (const plugin of catalog.plugins.map((entry) => entry.name).filter((name) => Object.hasOwn(probes, name))) {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "agenc-plugins-built-")));
    try {
      const workspace = join(temporary, "workspace");
      const env = { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: join(temporary, "platform-home"),
        AGENC_HOME: join(temporary, "agenc"), AGENC_PLUGIN_CACHE_DIR: join(temporary, "plugins"), AGENC_TMPDIR: join(temporary, "tmp"),
        TMPDIR: join(temporary, "tmp"), XDG_CONFIG_HOME: join(temporary, "xdg-config"), XDG_CACHE_HOME: join(temporary, "xdg-cache"),
        XDG_DATA_HOME: join(temporary, "xdg-data"), NODE_ENV: "production", NO_COLOR: "1" };
      for (const path of [workspace, env.HOME, env.AGENC_HOME, env.AGENC_PLUGIN_CACHE_DIR, env.TMPDIR]) mkdirSync(path, { recursive: true, mode: 0o700 });
      const source = join(repository, "plugins", plugin);
      verifyPluginSignatureFile(source, readPublisherPublicKeys(repository));
      run([join(runtime, "bin/agenc"), "plugin", "install", source, "--scope", "user", "--name", plugin + "@agenc-plugins"], workspace, env);
      console.log(run([script, "--child", runtime, plugin], workspace, env).trim());
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
}
if (process.argv[2] === "--child") await child(process.argv[3], process.argv[4]);
else await parent();
