// Scaffold: three-asset-loading — carga de GLTF con progreso visible,
// gestión de errores y dispose correcto. Nada de pantalla negra silenciosa.
export default {
  "name": "three-asset-loading",
  "framework": "three",
  "description": "GLTFLoader con LoadingManager: barra de progreso, error explícito, dispose al fallar/recargar.",
  "html": `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: título</title>
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

const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => {
  bar.style.width = \`\${Math.round((loaded / total) * 100)}%\`;
};
manager.onLoad = () => { bar.style.width = "100%"; msg.style.display = "none"; };
manager.onError = (url) => {
  msg.style.color = "#f87171";
  msg.textContent = \`error cargando: \${url} — revisá la URL/CORS\`;
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

const disposables = [];
function track(model) {
  model.traverse((node) => {
    if (node.isMesh) {
      disposables.push(node.geometry, node.material);
      if (Array.isArray(node.material)) disposables.push(...node.material);
    }
  });
}

// TODO: tu URL de modelo (mismo origen o con CORS habilitado)
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
    msg.style.color = "#f87171";
    msg.textContent = \`fallo la carga: \${error?.message ?? error}\`;
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

(function animate() {
  const model = scene.getObjectByName?.("model");
  if (model !== undefined && model !== null) model.rotation.y += 0.005;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();
</script>
</body>
</html>`,
  "notes": [
    "manager.onError: sin esto, un 404/CORS = pantalla negra silenciosa.",
    "Trackear geometry/material al cargar: el dispose de modelos es manual en three.",
    "Texturas de modelos GLTF: ya traen colorSpace correcto desde el loader moderno.",
  ],
}
