import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: three-instancing - InstancedMesh for N identical objects:
// one draw call instead of N, a key 3D performance technique.
export default {
  "name": "three-instancing",
  "framework": "three",
  "description": "InstancedMesh with per-instance updates and a dynamic count; reduces draw calls for repeated objects.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: title</title>
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block}</style>
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
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 8, 24);

scene.add(new THREE.AmbientLight(0x475569, 1.5));
const dir = new THREE.DirectionalLight(0xffffff, 2.2);
dir.position.set(5, 12, 6);
scene.add(dir);

const COUNT = 5000;

// One geometry, one material, one draw call.
const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const material = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
const instances = new THREE.InstancedMesh(geometry, material, COUNT);
instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // updated every frame
scene.add(instances);

// Keep vectors outside the loop: no per-frame allocations.
const dummy = new THREE.Object3D();
const state = new Float32Array(COUNT * 4); // x, z, fase, velocidad
for (let i = 0; i < COUNT; i += 1) {
  state[i * 4 + 0] = (Math.random() - 0.5) * 40;
  state[i * 4 + 1] = (Math.random() - 0.5) * 40;
  state[i * 4 + 2] = Math.random() * Math.PI * 2;
  state[i * 4 + 3] = 0.5 + Math.random() * 1.5;
}

let color = new THREE.Color();
for (let i = 0; i < COUNT; i += 1) {
  // Optional per-instance color: set once
  instances.setColorAt(i, color.setHSL(0.55 + state[i * 4 + 2] * 0.05, 0.7, 0.55));
}
if (instances.instanceColor) instances.instanceColor.needsUpdate = true;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addEventListener("beforeunload", () => {
  instances.dispose(); geometry.dispose(); material.dispose(); renderer.dispose();
});
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  for (let i = 0; i < COUNT; i += 1) {
    const x = state[i * 4 + 0], z = state[i * 4 + 1], phase = state[i * 4 + 2], speed = state[i * 4 + 3];
    dummy.position.set(x, Math.sin(t * speed + phase) * 1.2, z);
    dummy.rotation.y = t * speed + phase;
    dummy.updateMatrix();
    instances.setMatrixAt(i, dummy.matrix);
  }
  instances.instanceMatrix.needsUpdate = true; // One buffer upload per frame
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
</script>
</body>
</html>`),
  "notes": [
    "instanceMatrix.setUsage(DynamicDrawUsage): avoids repeated GPU buffer allocation.",
    "Reuse the dummy Object3D; per-instance allocations on every frame increase garbage collection.",
    "For more than about 100 identical meshes, consider InstancedMesh; for more than about 10 distinct materials, consider an atlas.",
  ],
}
