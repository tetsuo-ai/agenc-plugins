/**
 * 3D Engine contract tests: the deterministic verifier against the classic
 * hallucinations (API-era table), performance heuristics, harness
 * generation, scaffold loading, plus the MCP server as a real child
 * process. Fully offline.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { detectFramework, lint3d } from "../plugins/motor3d/server/lint3d.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "motor3d");
const SERVER = join(ROOT, "server", "main.mjs");
const rules = (result) => result.violations.map((v) => v.rule);

const HALLUCINATION_CODE = `
import * as THREE from "three";
const geo = new THREE.Geometry();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setSize(innerWidth, innerHeight);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
const loader = new THREE.GLTFLoader();
`;

test("lint3d: the classic 30B hallucinations are caught with modern fixes", () => {
  const result = lint3d(HALLUCINATION_CODE, { framework: "three" });
  const found = rules(result);
  assert.ok(found.some((r) => r.startsWith("api-era:") && r.includes("Geometry")), "THREE.Geometry caught");
  assert.ok(found.some((r) => r.startsWith("api-era:") && r.includes("outputEncoding")), "outputEncoding caught");
  assert.ok(found.some((r) => r.startsWith("api-era:") && r.includes("sRGBEncoding")), "sRGBEncoding caught");
  assert.ok(found.some((r) => r.startsWith("api-era:") && r.includes("OrbitControls")), "core OrbitControls caught");
  assert.ok(found.some((r) => r.startsWith("api-era:") && r.includes("GLTFLoader")), "core GLTFLoader caught");
  const geometryViolation = result.violations.find((v) => v.rule.includes("Geometry"));
  assert.match(geometryViolation.fix, /BufferGeometry/u);
  assert.ok(result.score < 40, `hallucination-heavy code fails hard (${result.score})`);
});

test("lint3d: per-frame allocations detected inside the rAF loop, not outside", () => {
  const dirtyLoop = `
import * as THREE from "three";
const renderer = new THREE.WebGLRenderer();
function animate() {
  const dir = new THREE.Vector3(1, 0, 0);
  mesh.position.add(dir);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
`;
  const bad = lint3d(dirtyLoop, { framework: "three" });
  assert.ok(rules(bad).includes("perFrameAlloc"), "allocation inside animate() flagged");

  const cleanLoop = `
import * as THREE from "three";
const renderer = new THREE.WebGLRenderer();
const dir = new THREE.Vector3(1, 0, 0);
function animate() {
  mesh.position.add(dir);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
`;
  const good = lint3d(cleanLoop, { framework: "three" });
  assert.ok(!rules(good).includes("perFrameAlloc"), "allocation outside loop is fine");
});

test("lint3d: perf and lifecycle heuristics", () => {
  const sloppy = `
import * as THREE from "three";
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
const clock = new THREE.Clock();
function animate() {
  const dt = clock.getDelta();
  mesh.rotation.y += dt;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
`;
  const result = lint3d(sloppy, { framework: "three" });
  const found = rules(result);
  assert.ok(found.includes("missingResize"), "resize handler missing flagged");
  assert.ok(found.includes("deltaNoClamp"), "unclamped delta flagged");
  assert.ok(found.includes("missingPixelRatio") || found.includes("missingDispose"), "lifecycle flagged");

  const responsive = sloppy
    .replace("const clock", 'addEventListener("resize", () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });\nrenderer.setPixelRatio(Math.min(devicePixelRatio,2));\nconst clock')
    .replace("clock.getDelta()", "Math.min(clock.getDelta(), 0.1)")
    + "\naddEventListener(\"beforeunload\", () => { mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose(); });\n";
  const fixed = lint3d(responsive, { framework: "three" });
  assert.ok(!rules(fixed).includes("missingResize"), "resize handled");
  assert.ok(!rules(fixed).includes("deltaNoClamp"), "delta clamped");
  assert.ok(fixed.score >= 85, `clean scene passes (${fixed.score}: ${JSON.stringify(fixed.violations)})`);
});

test("lint3d: canvas2d DPR blindness and webgpu texture caching", () => {
  const dprBlind = `const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = innerWidth;
canvas.height = innerHeight;
(function loop(){ ctx.fillRect(0,0,10,10); requestAnimationFrame(loop); })();
`;
  const bad2d = lint3d(dprBlind, { framework: "canvas2d" });
  assert.ok(rules(bad2d).includes("canvas2dDprBlind"), "DPR-blind canvas flagged");

  const gpu = `const ctx = canvas.getContext("webgpu");
context.configure({ device, format });
const view = context.getCurrentTexture().createView();
function frame(t) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] });
  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`;
  const badGpu = lint3d(gpu, { framework: "webgpu" });
  assert.ok(rules(badGpu).includes("cachedGpuTexture"), "cached per-frame texture flagged");
});

test("lint3d: framework detection and empty input", () => {
  assert.equal(detectFramework("new THREE.Scene()"), "three");
  assert.equal(detectFramework("const c = canvas.getContext('2d')"), "canvas2d");
  assert.equal(detectFramework("navigator.gpu.requestAdapter()"), "webgpu");
  const empty = lint3d("x");
  assert.match(empty.error, /code is too short to analyze/u);
});

test("scaffolds: all import cleanly and carry structure", async () => {
  const files = ["three-basic-scene", "three-orbit-controls", "three-instancing",
    "three-raycast-picking", "three-asset-loading", "canvas2d-game-loop", "webgpu-init"];
  for (const name of files) {
    const mod = await import(`file://${join(ROOT, "scaffolds", `${name}.js`)}`);
    assert.equal(mod.default.name, name);
    assert.ok(mod.default.html.length > 800, `${name} has real HTML`);
    assert.ok(Array.isArray(mod.default.notes) && mod.default.notes.length >= 3, `${name} carries notes`);
    // Three.js scaffolds should pass their own linter or come close.
    if (mod.default.framework === "three") {
      const result = lint3d(mod.default.html, { framework: "three" });
      assert.ok(result.score >= 80, `${name} self-lints ≥80 (${result.score}: ${rules(result)})`);
    }
    const loop = lint3d(mod.default.html, { framework: mod.default.framework });
    void loop;
  }
});

test("mcp server: scaffolds, lint and harness — as a real child process", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "motor3d-mcp-"));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, AGENC_PLUGIN_DATA: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const responses = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      responses.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  const tool = (name, args) =>
    call("tools/call", { name, arguments: args }).then(
      (r) => r.result?.structuredContent ?? r.result?.content?.[0]?.text ?? r.error,
    );
  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "motor3d");
    const catalog = await call("tools/list");
    assert.deepEqual(catalog.result.tools.map((t) => t.name).sort(), ["harness_build", "lint3d", "scaffold_get", "scaffolds_list"]);

    const list = await tool("scaffolds_list", {});
    assert.equal(list.scaffolds.length, 7);

    const scaffold = await tool("scaffold_get", { name: "three-instancing" });
    assert.ok(scaffold.html.includes("InstancedMesh"));
    assert.ok(scaffold.html.includes("DynamicDrawUsage"));
    const missing = await tool("scaffold_get", { name: "nope" });
    assert.match(missing, /No scaffold/u);

    const linted = await tool("lint3d", { code: HALLUCINATION_CODE });
    assert.ok(linted.score < 40);

    const harness = await tool("harness_build", {
      code: 'import * as THREE from "three";\nconst renderer = new THREE.WebGLRenderer();',
      title: "prueba",
    });
    assert.equal(harness.framework, "three");
    assert.ok(harness.html.includes('type="importmap"'));
    assert.ok(harness.html.includes("three@0.170.0"));
    assert.ok(harness.html.includes("window.addEventListener(\"error\""));
    assert.ok(harness.html.includes("fps"));

    const rpc = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(rpc.error.code, -32602);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(responses.every((m) => m.id !== undefined), "no response to notifications");
  } finally {
    child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  }
});
