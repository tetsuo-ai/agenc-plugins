#!/usr/bin/env node
/**
 * motor3d MCP server - verified scaffolds + deterministic verifier for
 * browser 3D/games. Built for small local models: the scaffolds carry
 * the correct modern patterns (retrieval over recall), the API-era
 * table kills the classic hallucinations (THREE.Geometry, outputEncoding,
 * core OrbitControls…), the perf heuristics catch per-frame allocations
 * and lifecycle bugs, and harness_build wraps any snippet in a
 * self-checking HTML (error overlay + FPS). Zero-dep, fully offline.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lint3d, detectFramework } from "./lint3d.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "motor3d", version: "0.2.3" };
const SCAFFOLDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scaffolds");

const scaffoldCache = new Map();
async function scaffolds() {
  if (scaffoldCache.size > 0) return scaffoldCache;
  for (const entry of readdirSync(SCAFFOLDS_DIR).sort()) {
    if (!entry.endsWith(".js")) continue;
    const mod = await import(pathToFileURL(join(SCAFFOLDS_DIR, entry)).href);
    if (mod.default !== undefined) scaffoldCache.set(mod.default.name, mod.default);
  }
  return scaffoldCache;
}

const tools = [
  {
    name: "scaffolds_list",
    description: "Verified scaffolds for browser 3D/games: modern three.js basics (scene/controls/instancing/raycast/assets), production canvas2d game loop (fixed timestep + DPR), WebGPU init. Each is a starting HTML template with notes; validate it in the target browser.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const all = await scaffolds();
      return structured({
        scaffolds: [...all.values()].map((s) => ({
          name: s.name,
          framework: s.framework,
          description: s.description,
          notes: s.notes,
        })),
        hint: "Never write three.js/WebGPU from memory. Retrieve the closest scaffold, adapt the TODO marks, then run lint3d.",
      });
    },
  },
  {
    name: "scaffold_get",
    description: "One complete scaffold by name - full runnable HTML with the correct modern patterns. Adapt the TODO marks; do not rewrite from scratch.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    handler: async ({ name }) => {
      const all = await scaffolds();
      const scaffold = all.get(String(name));
      if (scaffold === undefined) {
        return text(`No scaffold '${name}'. Available: ${[...all.keys()].join(", ")}`);
      }
      return structured(scaffold);
    },
  },
  {
    name: "lint3d",
    description: "Deterministic verifier for browser 3D/game code: API-era table (removed/renamed three.js APIs - the classic hallucinations), per-frame allocation detection, missing resize/dispose/pixel-ratio, DPR-blind canvas2d, unclamped delta, cached WebGPU textures, touch-action, audio-gesture, instancing advice. Violations with fixes; pass requires score ≥ 85 and no errors.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        framework: { type: "string", enum: ["three", "canvas2d", "webgpu"], description: "Auto-detected when omitted" },
      },
      required: ["code"],
    },
    handler: async ({ code, framework }) => {
      const result = lint3d(code, framework !== undefined ? { framework } : {});
      if (result.error !== undefined) return text(result.error);
      return structured(result);
    },
  },
  {
    name: "harness_build",
    description: "Wrap any snippet in a self-checking HTML harness: pinned three import map (only if three is detected), error overlay (window.onerror + unhandledrejection shown red on screen), FPS counter, and canvas sizing. Deliver this file so the user SEES failures instead of a black canvas.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JS/module code (not full HTML)" },
        title: { type: "string" },
      },
      required: ["code"],
    },
    handler: async ({ code, title }) => {
      if (typeof code !== "string" || !code.trim() || code.length > 100_000) return text("code must be nonempty JavaScript, at most 100000 characters");
      const source = code;
      const framework = detectFramework(source);
      const html = buildHarness(source, String(title ?? "motor3d harness"), framework);
      return structured({ html, framework, bytes: Buffer.byteLength(html) });
    },
  },
];

function buildHarness(code, title, framework) {
  const importMap = framework === "three"
    ? `  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
    }
  }
  </script>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0f172a; }
  canvas { display: block; touch-action: none; }
  #err {
    position: fixed; inset: auto 0 0 0; max-height: 40%; overflow: auto;
    padding: 8px 12px; display: none;
    background: #7f1d1d; color: #fecaca; font: 12px/1.5 ui-monospace, monospace;
    white-space: pre-wrap; z-index: 10;
  }
  #fps {
    position: fixed; top: 8px; left: 8px; color: #38bdf8;
    font: 12px ui-monospace, monospace; z-index: 10;
  }
</style>
${importMap}
</head>
<body>
<div id="err"></div>
<div id="fps"></div>
<script>
  (function harness() {
    var box = document.getElementById("err");
    function show(e) {
      box.style.display = "block";
      box.textContent += String((e && (e.message || e.reason && e.reason.message)) || e) + "\\n";
    }
    window.addEventListener("error", function (e) { show(e.error || e.message); });
    window.addEventListener("unhandledrejection", function (e) { show(e.reason); });
    var el = document.getElementById("fps");
    var frames = 0, t0 = performance.now();
    (function tick(t) {
      requestAnimationFrame(tick);
      frames += 1;
      if (t - t0 >= 500) {
        el.textContent = Math.round(frames * 1000 / (t - t0)) + " fps";
        frames = 0; t0 = t;
      }
    })(t0);
  })();
</script>
<script type="module">
${code.replace(/<\/script/gi, "<\\/script")}
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function text(value) {
  return { content: [{ type: "text", text: String(value) }] };
}

function structured(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

async function handleMessage(message) {
  if (message === null || typeof message !== "object") return null;
  const { id, method, params } = message;
  const isNotification = id === undefined;
  if (isNotification) return null;
  try {
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
      return reply(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const name = params?.name;
      const tool = toolByName.get(name);
      if (tool === undefined) {
        return isNotification ? null : reply(id, null, { code: -32602, message: `unknown tool: ${name}` });
      }
      const result = await tool.handler(params?.arguments ?? {});
      return isNotification ? null : reply(id, result);
    }
    return isNotification ? null : reply(id, null, { code: -32601, message: `method not found: ${method}` });
  } catch (error) {
    if (isNotification) return null;
    return reply(id, null, {
      code: -32000,
      message: `tool error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function reply(id, result, error) {
  const response = { jsonrpc: "2.0", id };
  if (error !== undefined) response.error = error;
  else response.result = result;
  return response;
}

async function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stderr.write("motor3d: invalid JSON\n");
        continue;
      }
      const response = await handleMessage(message);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`motor3d fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
