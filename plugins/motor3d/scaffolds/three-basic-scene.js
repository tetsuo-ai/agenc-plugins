import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: three-basic-scene - escena Three.js moderna y correcta.
// Pinned import map, renderer pixel ratio, correct resizing,
// a clamped-delta loop, and disposal on unload.
// Replace the TODO marks. Keep the error overlay for immediate
// feedback when something fails.

export default {
  "name": "three-basic-scene",
  "framework": "three",
  "description": "Minimal modern scene: renderer, camera, resize, clamped-delta rAF, and disposal. A reliable starting point.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: title</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0f172a; }
  canvas { display: block; }
  #err {
    position: fixed; inset: auto 0 0 0; padding: 8px 12px; display: none;
    background: #7f1d1d; color: #fecaca; font: 12px/1.4 ui-monospace, monospace;
    white-space: pre-wrap; z-index: 10;
  }
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<div id="err"></div>
<script type="module">
import * as THREE from "three";

const errBox = document.getElementById("err");
const showErr = (e) => { errBox.style.display = "block"; errBox.textContent += String(e?.message ?? e) + "\\n"; };
window.addEventListener("error", (e) => showErr(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showErr(e.reason));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 5);

// TODO: your scene content
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8 }),
);
scene.add(mesh);
const light = new THREE.DirectionalLight(0xffffff, 2.5);
light.position.set(3, 5, 2);
scene.add(light, new THREE.AmbientLight(0x334155, 1.2));

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

const clock = new THREE.Clock();
const MAX_DELTA = 0.1; // seconds: clamp after inactive tabs

function animate() {
  const dt = Math.min(clock.getDelta(), MAX_DELTA);
  // TODO: update with dt (do not create objects here)
  mesh.rotation.y += dt * 0.8;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// Al cerrar: liberar GPU (importante en SPA)
window.addEventListener("beforeunload", () => {
  mesh.geometry.dispose();
  mesh.material.dispose();
  renderer.dispose();
});
</script>
</body>
</html>`),
  "notes": [
    "Call setPixelRatio before setSize and cap it at 2; DPR 3 can exhaust mobile fill rate.",
    "Clamping delta prevents large jumps when returning to an inactive tab.",
    "Modern three.js uses physical DirectionalLight intensity; about 2-3 is a useful starting point.",
  ],
}
