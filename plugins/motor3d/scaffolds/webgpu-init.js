import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: webgpu-init - arranque WebGPU correcto: feature-detect,
// adapter with a power-preference fallback, preferred canvas format,
// and a clear frame, a frequently misimplemented hello world.
export default {
  "name": "webgpu-init",
  "framework": "webgpu",
  "description": "Modern WebGPU initialization: navigator.gpu, labeled adapter/device, canvas format, and animated clearing.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: title</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0f172a}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas id="gpu"></canvas>
<div id="fallback" style="display:none;color:#94a3b8;font:14px ui-monospace;padding:16px">WebGPU no disponible en este navegador.</div>
<script type="module">
const canvas = document.getElementById("gpu");

const fallback = document.getElementById("fallback");
function fail(message) {
  canvas.style.display = "none"; fallback.style.display = "block";
  if (message) fallback.textContent = message;
}
try {
if (!navigator.gpu) {
  fail();
} else {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) {
    fail();
  } else {
    const device = await adapter.requestDevice({ label: "main-device" });
    let stopped = false;
    device.addEventListener("uncapturederror", (e) => { stopped = true; fail(e.error.message); });
    device.lost.then((info) => {
      stopped = true; fail("Dispositivo WebGPU perdido: " + info.reason);
      // TODO: recovery (recreate the device and upload resources again)
      console.error("device perdido", info.reason);
    });

    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Canvas WebGPU no disponible");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    function resize() {
      // Always set buffer dimensions explicitly; CSS only stretches the result
      canvas.width = Math.min(device.limits.maxTextureDimension2D, Math.max(1, Math.floor(innerWidth * Math.min(devicePixelRatio, 2))));
      canvas.height = Math.min(device.limits.maxTextureDimension2D, Math.max(1, Math.floor(innerHeight * Math.min(devicePixelRatio, 2))));
    }
    addEventListener("resize", resize);
    resize();

    const CLEAR = { r: 0.06, g: 0.09, b: 0.16, a: 1.0 };

    addEventListener("beforeunload", () => { stopped = true; device.destroy(); });
    function frame(t) {
      if (stopped) return;
      const pulse = 0.5 + 0.5 * Math.sin(t / 1000);
      const encoder = device.createCommandEncoder({ label: "frame" });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: CLEAR.r * (0.5 + pulse * 0.5), g: CLEAR.g, b: CLEAR.b + pulse * 0.1, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      // TODO: actual render pipeline
      pass.end();
      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}
} catch (error) { fail(error.message); }
</script>
</body>
</html>`),
  "notes": [
    "Call getCurrentTexture() for every new frame; never cache the view across frames.",
    "Use getPreferredCanvasFormat(); hardcoding a format can fail on other platforms.",
    "alphaMode 'opaque' is the fast option when canvas transparency is unnecessary.",
  ],
}
