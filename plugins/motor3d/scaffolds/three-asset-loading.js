import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: three-asset-loading - GLTF loading with visible progress,
// error handling, and correct disposal instead of a silent black screen.
export default {
  "name": "three-asset-loading",
  "framework": "three",
  "description": "GLTFLoader with LoadingManager: progress bar, explicit errors, and disposal on failure/reload.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: title</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0f172a}canvas{display:block}
  #bar{position:fixed;left:0;top:0;height:3px;width:0%;background:#38bdf8;transition:width .2s;z-index:9}
  #msg{position:fixed;inset:auto 0 40% 0;text-align:center;color:#94a3b8;font:13px ui-monospace}
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
<div id="bar"></div>
<div id="msg">cargando…</div>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const bar = document.getElementById("bar");
const msg = document.getElementById("msg");

let loadFailed = false;
const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => {
  bar.style.width = \`\${Math.round((loaded / total) * 100)}%\`;
};
manager.onLoad = () => { bar.style.width = "100%"; if (!loadFailed) msg.style.display = "none"; };
manager.onError = (url) => {
  loadFailed = true; msg.style.display = "block";
  msg.style.color = "#f87171";
  msg.textContent = \`loading error: \${url} - check the URL/CORS\`;
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.2, 4);

scene.add(new THREE.AmbientLight(0x94a3b8, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(2, 4, 3);
scene.add(key);

const disposables = new Set();
function track(model) {
  model.traverse((node) => {
    if (node.isMesh) {
      disposables.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        disposables.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) disposables.add(value);
      }
    }
  });
}

// TODO: your model URL (same origin or CORS enabled)
const MODEL_URL = "https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf";

const loader = new GLTFLoader(manager);
loader.load(
  MODEL_URL,
  (gltf) => {
    const model = gltf.scene;
    model.name = "model";
    track(model);
    scene.add(model);
  },
  undefined,
  (error) => {
    loadFailed = true; msg.style.display = "block";
    msg.style.color = "#f87171";
    msg.textContent = \`loading failed: \${error?.message ?? error}\`;
  },
);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addEventListener("beforeunload", () => {
  for (const d of disposables) d.dispose?.();
  renderer.dispose();
});

const clock = new THREE.Clock();
(function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const model = scene.getObjectByName?.("model");
  if (model !== undefined && model !== null) model.rotation.y += dt * 0.3;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();
</script>
</body>
</html>`),
  "notes": [
    "manager.onError prevents a silent black screen after a 404 or CORS failure.",
    "Track geometries/materials during loading; three.js model disposal is manual.",
    "The modern GLTF loader already sets the correct colorSpace on model textures.",
  ],
}
