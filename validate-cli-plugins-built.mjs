/**
 * Run the commands that the CLI-backed skills prescribe through compiled Core's
 * native sandbox: the SandboxExecutionBroker boundary that exec_command uses.
 *
 * AGENC_CORE_RUNTIME=/absolute/core/runtime \
 * AGENC_PLUGIN_CLI_PATH=/dir/with/wallet-cli:/dir/with/llm-checker:/dir/with/pio \
 *   node validate-cli-plugins-built.mjs [--approved-network]
 *
 * Each case checks what the skill tells the agent: the default sandbox outcome
 * and the scoped grant the skill requests (network, or write access to the
 * tool's own state folder). Everything runs in a disposable home with a
 * synthetic wallet-cli session of fresh random public addresses. It never runs
 * a Ledger device command, a board upload, an install, or a sandbox bypass.
 * --approved-network adds the cases that read public services: Ledger's
 * explorers and token list, and PlatformIO's package registry for one native
 * build. A CLI that is not on AGENC_PLUGIN_CLI_PATH is reported as skipped.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const approvedNetwork = process.argv.includes("--approved-network");
for (const flag of process.argv.slice(2)) assert.equal(flag, "--approved-network", `Unknown option: ${flag}`);
assert.ok(process.env.AGENC_CORE_RUNTIME, "Set AGENC_CORE_RUNTIME to a compiled Core runtime");
const runtime = realpathSync(process.env.AGENC_CORE_RUNTIME);
const cliPath = (process.env.AGENC_PLUGIN_CLI_PATH ?? "").split(delimiter).filter(Boolean);

// Names exported by a compiled chunk's final `export {...}` block, minified or not.
function exportedNames(source) {
  const match = /export\s*\{([^}]*)\}\s*;?\s*(?:\/\/# sourceMappingURL=\S+\s*)?$/u.exec(source);
  if (!match) return new Set();
  return new Set(match[1].split(",").map((part) => part.trim().split(/\s+as\s+/u).pop()).filter(Boolean));
}
function builtModule(symbols) {
  const dist = join(runtime, "dist");
  const matches = readdirSync(dist).filter((name) => /^chunk-[A-Z0-9]+\.js$/u.test(name)).filter((name) => {
    const exports = exportedNames(readFileSync(join(dist, name), "utf8"));
    return symbols.every((symbol) => exports.has(symbol));
  });
  assert.equal(matches.length, 1, `Missing compiled Core exports: ${symbols}`);
  return pathToFileURL(join(dist, matches[0])).href;
}

function base58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let text = "";
  while (value > 0n) { text = alphabet[Number(value % 58n)] + text; value /= 58n; }
  return text;
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "agenc-plugins-cli-")));
const home = join(root, "home");
const workspace = join(root, "workspace");
const temporary = join(root, "tmp");
for (const path of [home, workspace, temporary]) mkdirSync(path, { recursive: true, mode: 0o700 });
const env = {
  PATH: [...cliPath, dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter),
  HOME: home, TMPDIR: temporary, AGENC_TMPDIR: temporary, XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), NO_COLOR: "1",
  WALLET_CLI_NO_NUDGE: "1", PYTHONWARNINGS: "ignore", PLATFORMIO_DISABLE_UPGRADE_CHECK: "1",
};

function available(binary) {
  return spawnSync("/bin/sh", ["-c", `command -v ${binary}`], { env, encoding: "utf8" }).status === 0;
}

const sandbox = await import(builtModule(["SandboxExecutionBroker", "init_execution_broker"]));
sandbox.init_execution_broker();

async function run(cwd, command, { network = false, write = [], timeoutMs = 120_000 } = {}) {
  const broker = new sandbox.SandboxExecutionBroker({ mode: "workspace_write", cwd, env, sessionTempRoot: temporary });
  assert.equal(broker.required, true);
  const additional = {
    ...(network ? { network: { enabled: true } } : {}),
    ...(write.length > 0 ? { fileSystem: { entries: write.map((path) => ({ path: { kind: "path", path }, access: "write" })) } } : {}),
  };
  const prepared = broker.prepareSpawn("tool", {
    program: "/bin/sh", args: ["-c", command], cwd, env,
    ...(Object.keys(additional).length > 0 ? { additionalPermissions: additional } : {}),
  });
  return prepared.run((spawnCommand, lifecycleSignal) => new Promise((resolve) => {
    const child = spawn(spawnCommand.program, spawnCommand.args, {
      cwd: spawnCommand.cwd, env: spawnCommand.env, argv0: spawnCommand.argv0, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} };
    const timer = setTimeout(stop, timeoutMs);
    lifecycleSignal.addEventListener("abort", stop, { once: true });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  }));
}

function lastJson(text) {
  const line = text.trim().split("\n").filter((entry) => entry.trim().startsWith("{")).pop();
  return line === undefined ? undefined : JSON.parse(line);
}

const report = { coreRuntime: runtime, approvedNetwork, sandboxMode: "workspace_write", plugins: {} };
const checks = [];
async function check(plugin, name, command, options, verify) {
  const result = await run(options.cwd ?? workspace, command, options);
  const output = `${result.stdout}\n${result.stderr}`;
  try {
    verify(result, output);
    checks.push({ plugin, name, passed: true, exit: result.code });
  } catch (error) {
    checks.push({ plugin, name, passed: false, exit: result.code, error: error.message.slice(0, 300), output: output.slice(-600) });
  }
}

try {
  if (available("wallet-cli")) {
    report.plugins.ledger = "tested";
    const state = join(env.XDG_STATE_HOME, "ledger-wallet-cli");
    mkdirSync(state, { recursive: true, mode: 0o700 });
    const evm = `0x${randomBytes(20).toString("hex")}`;
    const solana = base58(randomBytes(32));
    writeFileSync(join(state, "session.yaml"), [
      "# Synthetic validator session: fresh random public addresses, no device.",
      "accounts:",
      "  - label: ethereum-1",
      `    descriptor: "account:2:address:ethereum:${evm}:m/44'/60'/0'/0/0"`,
      "  - label: solana-1",
      `    descriptor: "account:2:address:solana:${solana}:m/44'/501'/0'/0'"`,
      "",
    ].join("\n"), { mode: 0o600 });
    await check("ledger", "version prints JSON in the default sandbox", "wallet-cli --version", {}, (result) => {
      assert.equal(result.code, 0);
      assert.match(JSON.parse(result.stdout).data.version, /^3\./u);
    });
    await check("ledger", "session view reads labels in the default sandbox", "wallet-cli session view --output json", {}, (result) => {
      assert.equal(result.code, 0);
      assert.deepEqual(lastJson(result.stdout).accounts.map((account) => account.label), ["ethereum-1", "solana-1"]);
    });
    await check("ledger", "balances is denied network in the default sandbox", "wallet-cli balances --account ethereum-1 --output json", {}, (result) => {
      assert.equal(result.code, 1);
      assert.match(lastJson(result.stdout).error.message, /ENOTFOUND/u);
    });
    await check("ledger", "old network names fail on wallet-cli 3", "wallet-cli assets token ethereum:sepolia 0x0000000000000000000000000000000000000001 --output json", {}, (result) => {
      assert.equal(result.code, 1);
      assert.match(lastJson(result.stdout).error.message, /Unknown network/u);
    });
    if (approvedNetwork) {
      for (const [name, command] of [
        ["balances with the scoped network grant", "wallet-cli balances --account ethereum-1 --output json"],
        ["Solana balances with the scoped network grant", "wallet-cli balances --account solana-1 --output json"],
        ["operations with the scoped network grant", "wallet-cli operations --account ethereum-1 --limit 5 --output json"],
        ["earn positions with the scoped network grant", "wallet-cli earn positions --account solana-1 --output json"],
        ["assets token with the scoped network grant", "wallet-cli assets token ethereum 0xdAC17F958D2ee523a2206206994597C13D831ec7 --output json"],
      ]) {
        await check("ledger", name, command, { network: true }, (result) => {
          assert.equal(result.code, 0);
          assert.equal(lastJson(result.stdout).status, "success");
        });
      }
    }
  } else report.plugins.ledger = "skipped: wallet-cli is not on AGENC_PLUGIN_CLI_PATH";

  if (available("llm-checker")) {
    report.plugins["llm-checker"] = "tested";
    const state = join(home, ".llm-checker");
    await check("llm-checker", "hw-detect runs in the default sandbox", "llm-checker hw-detect --json", {}, (result) => {
      assert.equal(result.code, 0);
      assert.equal(typeof JSON.parse(result.stdout).summary.effectiveMemory, "number");
    });
    await check("llm-checker", "registry-recommend cannot create ~/.llm-checker in the default sandbox", "llm-checker registry-recommend --category coding --limit 1 --json", {}, (result, output) => {
      assert.notEqual(result.code, 0);
      assert.match(output, /EPERM[^\n]*\.llm-checker/u);
    });
    await check("llm-checker", "registry-recommend with a write grant for ~/.llm-checker", "llm-checker registry-recommend --category coding --runtime auto --target-context 8192 --limit 2 --json", { write: [state], timeoutMs: 300_000 }, (result) => {
      assert.equal(result.code, 0);
      const value = JSON.parse(result.stdout);
      assert.ok(value.total_artifacts > 0);
      for (const row of value.recommendations) {
        for (const field of ["model", "artifact", "source", "quantization", "required_gb", "runtime", "score"]) assert.ok(Object.hasOwn(row, field), field);
        assert.ok(Object.hasOwn(row.memory ?? {}, "memorySource"));
      }
    });
    await check("llm-checker", "registry-search with a write grant for ~/.llm-checker", "llm-checker registry-search \"Hermes-3-Llama-3.1-8B\" --quant Q4_K_M --limit 3 --json", { write: [state] }, (result) => {
      assert.equal(result.code, 0);
      for (const row of JSON.parse(result.stdout).results) {
        for (const field of ["source_id", "canonical_model_id", "artifact_name", "quantization", "context_length", "install_command"]) assert.ok(Object.hasOwn(row, field), field);
      }
    });
  } else report.plugins["llm-checker"] = "skipped: llm-checker is not on AGENC_PLUGIN_CLI_PATH";

  if (available("pio")) {
    report.plugins["iot-builder"] = "tested";
    const state = join(home, ".platformio");
    const project = join(workspace, "native-project");
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "platformio.ini"), "[env:native]\nplatform = native\n");
    writeFileSync(join(project, "src", "main.c"), "int main(void) { return 0; }\n");
    await check("iot-builder", "pio cannot create ~/.platformio in the default sandbox", "pio --version", { cwd: project }, (_result, output) => {
      assert.match(output, /Operation not permitted[^\n]*\.platformio/u);
    });
    await check("iot-builder", "pio project config with a write grant for ~/.platformio", "pio project config --json-output", { cwd: project, write: [state] }, (result) => {
      assert.equal(result.code, 0);
      assert.deepEqual(JSON.parse(result.stdout)[0][0], "env:native");
    });
    await check("iot-builder", "pio device list with a write grant for ~/.platformio", "pio device list --json-output", { cwd: project, write: [state] }, (result) => {
      assert.equal(result.code, 0);
      assert.ok(Array.isArray(JSON.parse(result.stdout)));
    });
    if (approvedNetwork) {
      await check("iot-builder", "first native build with write and network grants", "pio run -e native", { cwd: project, network: true, write: [state], timeoutMs: 600_000 }, (result) => {
        assert.equal(result.code, 0);
      });
      await check("iot-builder", "cached native build with only the write grant", "pio run -e native", { cwd: project, write: [state], timeoutMs: 300_000 }, (result) => {
        assert.equal(result.code, 0);
      });
    }
  } else report.plugins["iot-builder"] = "skipped: pio is not on AGENC_PLUGIN_CLI_PATH";

  report.checks = checks;
  console.log(JSON.stringify(report, null, 2));
  assert.ok(checks.length > 0, "No CLI was found on AGENC_PLUGIN_CLI_PATH");
  assert.deepEqual(checks.filter((entry) => !entry.passed).map((entry) => `${entry.plugin}: ${entry.name}`), []);
} finally {
  rmSync(root, { recursive: true, force: true });
}
