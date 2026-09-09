# Motor3D

Browser 3D and game development with verified scaffolds and a
deterministic verifier — built for small local models (Qwen 27B/30B
class). The insight repeats olimpo's: 30B models write bad three.js by
**recall**, not comprehension. They hallucinate removed APIs, allocate
inside the render loop, forget resize/dispose/DPR. Motor3D moves the
ground truth out of the model.

## Verified scaffolds (retrieval over recall)

Seven complete, runnable HTML patterns — retrieved and adapted, never
rewritten from memory: `three-basic-scene` (pinned import map, pixel
ratio capped, resize, delta-clamped loop, dispose), `three-orbit-controls`
(pointer+touch, inertia, limits, no addons), `three-instancing`
(InstancedMesh with DynamicDrawUsage — one draw call for thousands),
`three-raycast-picking` (NDC done right), `three-asset-loading`
(LoadingManager with progress and explicit errors), `canvas2d-game-loop`
(fixed timestep, interpolated render, DPR-aware, visibility pause),
`webgpu-init` (feature detect, preferred format, per-frame texture).

## The verifier (`lint3d`)

- **API-era table** — the classic hallucinations, each with the modern
  fix and the release that changed it: `THREE.Geometry` (removed r125),
  `sRGBEncoding`/`outputEncoding` (→ `outputColorSpace`), `useLegacyLights`
  (removed r165), `new THREE.OrbitControls`/`THREE.GLTFLoader` (addons,
  not core), `texture.encoding`→`colorSpace`, direct `.array` assignment…
- **Performance heuristics** — per-frame `new THREE.Vector3()`-style
  allocations (detected inside the rAF-invoked function), missing
  resize/dispose/setPixelRatio, DPR-blind canvas2d sizing, unclamped
  deltas, cached `getCurrentTexture()` (new each frame), missing
  touch-action, AudioContext without gesture resume, many-meshes
  instancing advice.

## The harness (`harness_build`)

Wraps any snippet in a self-checking HTML: pinned three import map when
detected, red on-screen error overlay (`window.onerror` +
`unhandledrejection`), FPS counter, canvas sizing. The user opens the
file and SEES failures — no more black canvas guessing.

## MCP server

`server/main.mjs` (NDJSON JSON-RPC, zero-dep): `scaffolds_list`,
`scaffold_get`, `lint3d`, `harness_build`. Fully offline.

Core issue [tetsuo-ai/agenc-core#2078](https://github.com/tetsuo-ai/agenc-core/issues/2078):
until it ships, register the identical server with the one-line
user-level `agenc mcp add-json` (`env_vars: ["PATH"]`). The skill and
`/motor3d` command work regardless.
