// Register before module evaluation so import failures are visible too.
export function withErrorOverlay(html) {
  return html.replace("<body>", String.raw`<body>
<pre id="motor3d-error" role="alert" style="display:none;position:fixed;inset:auto 0 0;margin:0;padding:12px;max-height:40%;overflow:auto;white-space:pre-wrap;background:#7f1d1d;color:#fecaca;z-index:99"></pre>
<script>
(() => {
  const box = document.getElementById("motor3d-error");
  const show = (value) => { box.style.display = "block"; box.textContent += String(value?.message ?? value) + "\n"; };
  addEventListener("error", (event) => show(event.error ?? event.message ?? "Module or resource failed to load"), true);
  addEventListener("unhandledrejection", (event) => show(event.reason));
})();
</script>`);
}
