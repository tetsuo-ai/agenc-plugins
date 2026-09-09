// Scaffold: webgpu-init — arranque WebGPU correcto: feature-detect,
// adapter con fallback de power preference, formato preferido del
// canvas, y clear frame (el hello-world que casi todos escriben mal).
export default {
  "name": "webgpu-init",
  "framework": "webgpu",
  "description": "Init WebGPU moderno: navigator.gpu, adapter/device con etiquetas, formato del canvas, clear animado.",
  "html": `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: título</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0f172a}canvas{display:block}</style>
</head>
<body>
<canvas id="gpu"></canvas>
<div id="fallback" style="display:none;color:#94a3b8;font:14px ui-monospace;padding:16px">WebGPU no disponible en este navegador.</div>
<script type="module">
const canvas = document.getElementById("gpu");

if (!navigator.gpu) {
  document.getElementById("fallback").style.display = "block";
} else {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) {
    document.getElementById("fallback").style.display = "block";
  } else {
    const device = await adapter.requestDevice({ label: "main-device" });
    device.lost.then((info) => {
      // TODO: recuperación (recrear device y re-subir recursos)
      console.error("device perdido", info.reason);
    });

    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    function resize() {
      // tamaño del buffer SIEMPRE explícito; el CSS estira
      canvas.width = Math.max(1, Math.floor(innerWidth * Math.min(devicePixelRatio, 2)));
      canvas.height = Math.max(1, Math.floor(innerHeight * Math.min(devicePixelRatio, 2)));
    }
    addEventListener("resize", resize);
    resize();

    const CLEAR = { r: 0.06, g: 0.09, b: 0.16, a: 1.0 };

    function frame(t) {
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
      // TODO: pipeline de render real
      pass.end();
      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}
</script>
</body>
</html>`,
  "notes": [
    "getCurrentTexture() por frame NUEVO — nunca cachear la view entre frames.",
    "getPreferredCanvasFormat(): bgra8unorm en la mayoría; hardcodear rompe en ARM.",
    "alphaMode 'opaque' es el rápido si no necesitás transparencia del canvas.",
  ],
}
