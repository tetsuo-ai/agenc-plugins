import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: three-orbit-controls — órbita/dolly/pan con puntero y touch,
// SIN dependencias más allá de three (controles propios, ~80 líneas
// correctas: inercia, límites, capture de puntero).
export default {
  "name": "three-orbit-controls",
  "framework": "three",
  "description": "Controles orbitales propios con inercia y límites (puntero + touch), sin addons externos.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: título</title>
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block;touch-action:none}</style>
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }
</script>
</head>
<body>
<script type="module">
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);

// TODO: contenido
const world = new THREE.Group();
world.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.28, 120, 16), new THREE.MeshStandardMaterial({ color: 0xf59e0b })));
const light = new THREE.DirectionalLight(0xffffff, 2.5);
light.position.set(2, 4, 3);
scene.add(world, light, new THREE.AmbientLight(0x334155, 1.2));

// ── Controles orbitales ────────────────────────────────────────────
const orbit = {
  theta: Math.PI / 4,      // azimut
  phi: Math.PI / 3,        // polar
  radius: 6,
  target: new THREE.Vector3(0, 0, 0),
  minRadius: 2, maxRadius: 20,
  minPhi: 0.05, maxPhi: Math.PI - 0.05,
};
const vel = { theta: 0, phi: 0, radius: 0 }; // velocidad para inercia
const INERTIA = 0.90, SENS = 0.005, ZOOM_SENS = 0.0012, PAN_SENS = 0.002;

const pointers = new Map();
const right = new THREE.Vector3(), up = new THREE.Vector3();

function applyCamera() {
  orbit.phi = Math.max(orbit.minPhi, Math.min(orbit.maxPhi, orbit.phi));
  orbit.radius = Math.max(orbit.minRadius, Math.min(orbit.maxRadius, orbit.radius));
  const sinPhi = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.cos(orbit.phi),
    orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  renderer.domElement.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
});
renderer.domElement.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev === undefined) return;
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  prev.x = e.clientX; prev.y = e.clientY;
  if (prev.button === 2 || (pointers.size === 2)) {
    // pan: mover target en el plano de la cámara
    right.setFromMatrixColumn(camera.matrix, 0);
    up.setFromMatrixColumn(camera.matrix, 1);
    orbit.target.addScaledVector(right, -dx * PAN_SENS * orbit.radius);
    orbit.target.addScaledVector(up, dy * PAN_SENS * orbit.radius);
  } else if (prev.button === 0) {
    vel.theta = -dx * SENS;
    vel.phi = -dy * SENS;
    orbit.theta += vel.theta;
    orbit.phi += vel.phi;
  }
});
const releasePointer = (e) => { pointers.delete(e.pointerId); };
renderer.domElement.addEventListener("pointerup", releasePointer);
renderer.domElement.addEventListener("pointercancel", releasePointer);
renderer.domElement.addEventListener("lostpointercapture", releasePointer);
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  vel.radius = e.deltaY * ZOOM_SENS * orbit.radius;
  orbit.radius += vel.radius;
}, { passive: false });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addEventListener("beforeunload", () => {
  world.traverse((node) => { if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); } });
  renderer.dispose();
});
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  // inercia cuando no hay arrastre activo
  if (![...pointers.values()].some((p) => p.button === 0)) {
    orbit.theta += vel.theta; orbit.phi += vel.phi;
    vel.theta *= INERTIA; vel.phi *= INERTIA;
    orbit.radius += vel.radius; vel.radius *= INERTIA;
  }
  applyCamera();
  // TODO: animar contenido con dt
  world.rotation.y += dt * 0.5;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
applyCamera();
animate();
</script>
</body>
</html>`),
  "notes": [
    "setPointerCapture: no perdés el arrastre al salir del canvas.",
    "touch-action: none en el canvas es OBLIGATORIO para pointermove en móvil.",
    "El pan escala con orbit.radius: cerca de la escena, pan fino; lejos, amplio.",
  ],
}
