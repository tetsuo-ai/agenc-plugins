import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: three-raycast-picking - click/hover over 3D objects with
// correct NDC coordinates, a common source of model-generated bugs.
export default {
  "name": "three-raycast-picking",
  "framework": "three",
  "description": "Correct picking: pointer→NDC→raycaster, hover and click, with an object counter.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: title</title>
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block;touch-action:none}</style>
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }
</script>
</head>
<body>
<script type="module">
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 10);

const pickables = [];
const base = new THREE.MeshStandardMaterial({ color: 0x64748b });
for (let i = 0; i < 12; i += 1) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base.clone());
  const ring = Math.floor(i / 4), idx = i % 4;
  const angle = (idx / 4) * Math.PI * 2 + ring * 0.5;
  box.position.set(Math.cos(angle) * (2 + ring * 2), Math.sin(angle) * (2 + ring * 2), -ring);
  box.userData.baseColor = 0x64748b;
  scene.add(box);
  pickables.push(box);
}
scene.add(new THREE.AmbientLight(0x94a3b8, 1.4), (() => { const l = new THREE.DirectionalLight(0xffffff, 2.2); l.position.set(3, 5, 4); return l; })());

// ── Picking ────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;

// NDC: (-1..1). Common mistakes: forgetting the 2× scale or the sign.
function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function updateHover() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  const first = hits.length > 0 ? hits[0].object : null;
  if (first !== hovered) {
    if (hovered !== null) hovered.material.color.set(hovered.userData.baseColor);
    hovered = first;
    if (hovered !== null) hovered.material.color.set(0xf59e0b);
  }
}

renderer.domElement.addEventListener("pointermove", (e) => {
  setPointerFromEvent(e);
  updateHover();
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  setPointerFromEvent(e);
  updateHover();
  if (hovered !== null) {
    // TODO: your click action
    hovered.userData.baseColor = 0x22c55e;
    hovered.material.color.set(0x22c55e);
    hovered = null;
  }
});

renderer.domElement.addEventListener("pointerleave", () => {
  if (hovered) hovered.material.color.set(hovered.userData.baseColor);
  hovered = null;
});
addEventListener("beforeunload", () => {
  for (const mesh of pickables) { mesh.geometry.dispose(); mesh.material.dispose(); }
  base.dispose(); renderer.dispose();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();
</script>
</body>
</html>`),
  "notes": [
    "getBoundingClientRect(): NDC is relative to the canvas, not the window, so scrolling is safe.",
    "intersectObjects(objs, false): use recursive=true only when children must also be picked.",
    "Orthographic cameras use the same raycaster with setFromCamera.",
  ],
}
