import test from "node:test";
import assert from "node:assert/strict";
import { lint3d } from "../plugins/motor3d/server/lint3d.mjs";
import { withMcp } from "./support/mcp.mjs";

test("motor3d: valid APIs and module-level objects are not render-loop errors", () => {
  const code = 'const r = new THREE.WebGLRenderer(); const c = new THREE.PerspectiveCamera(); const p = THREE.RGBADepthPacking; function frame(){ r.render(s,c); requestAnimationFrame(frame); }';
  const result = lint3d(code);
  assert.ok(!result.violations.some(v => v.rule === "rendererInLoop" || v.rule.startsWith("api-era:")));
  assert.ok(lint3d('function frame(){ const r = new THREE.WebGLRenderer(); requestAnimationFrame(frame); }').violations.some(v => v.rule === "rendererInLoop"));
});
test("motor3d: WebGPU per-frame texture is valid; caching outside the frame fails", () => {
  const frame = "function frame(){ const view = context.getCurrentTexture().createView(); requestAnimationFrame(frame); }";
  assert.ok(!lint3d(frame, {framework:"webgpu"}).violations.some(v => v.rule === "cachedGpuTexture"));
  const cached = lint3d("const view = context.getCurrentTexture(); function frame(){ requestAnimationFrame(frame); }", {framework:"webgpu"});
  assert.equal(cached.score, 85);
  assert.equal(cached.pass, false);
});
test("motor3d: invalid inputs cannot bypass validation", () => {
  for (const code of [undefined, 123, {}, " ".repeat(20), "x".repeat(100001)]) assert.ok(lint3d(code).error);
  assert.ok(lint3d("new THREE.Scene()", {framework:"unknown"}).error);
});
test("motor3d: real MCP harness preserves script literals and UTF-8 byte length", async () => {
  await withMcp("motor3d", async ({tool}) => {
    const value = await tool("harness_build", {code:'document.body.dataset.test = "</SCRIPT>";',title:"é <test>"});
    assert.ok(value.html.includes('"<\\/script>"'));
    assert.equal(value.bytes, Buffer.byteLength(value.html));
    assert.ok(value.html.includes("é &lt;test&gt;"));
    assert.match(await tool("harness_build", {}), /nonempty/);
    assert.match(await tool("harness_build", {code: "x".repeat(100001)}), /100000/);
    const scaffold = await tool("scaffold_get", {name:"three-basic-scene"});
    assert.ok(scaffold.html.indexOf('id="motor3d-error"') < scaffold.html.indexOf('<script type="module">'));
  });
});
