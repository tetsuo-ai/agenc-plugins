import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: three-instancing — InstancedMesh para N objetos idénticos:
// UN draw call en vez de N. La regla de oro del performance 3D.
export default {
  "name": "three-instancing",
  "framework": "three",
  "description": "InstancedMesh con actualización por instancia y conteo dinámico; reduce draw calls para objetos repetidos.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: título</title>
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

// UNA geometría, UN material, UN draw call.
const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const material = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
const instances = new THREE.InstancedMesh(geometry, material, COUNT);
instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // se actualiza por frame
scene.add(instances);

// Vectores FUERA del loop: cero allocations por frame.
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
  // color por instancia (opcional): set once
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
  instances.instanceMatrix.needsUpdate = true; // UNA subida de buffer por frame
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
</script>
</body>
</html>`),
  "notes": [
    "instanceMatrix.setUsage(DynamicDrawUsage): evita re-reserva del buffer GPU.",
    "dummy (Object3D) reutilizado: la allocation por instancia por frame mata el GC.",
    "Más de ~100 meshes idénticos → InstancedMesh; más de ~10 materiales distintos → atlas.",
  ],
}
