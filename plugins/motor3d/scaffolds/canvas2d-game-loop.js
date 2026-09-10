import { withErrorOverlay } from "../server/overlay.mjs";
// Scaffold: canvas2d-game-loop - production Canvas 2D game loop:
// fixed physics timestep, interpolated rendering, correct DPR,
// edge/hold input, and pause when the tab is hidden.
export default {
  "name": "canvas2d-game-loop",
  "framework": "canvas2d",
  "description": "Production game loop: fixed 60 Hz physics, interpolated rendering, DPR awareness, clean input, and visibility handling.",
  "html": withErrorOverlay(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: title</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0f172a}canvas{display:block;image-rendering:pixelated}</style>
</head>
<body>
<canvas id="game"></canvas>
<script type="module">
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ── Resolution + DPR ───────────────────────────────────────────────
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
}
addEventListener("resize", resize);
resize();

// ── Input: hold y edge ─────────────────────────────────────────────
const keys = Object.create(null);
const pressedThisTick = new Set();
addEventListener("keydown", (e) => {
  if (!e.repeat) pressedThisTick.add(e.code);
  keys[e.code] = true;
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

function resetInput() {
  for (const key of Object.keys(keys)) delete keys[key];
  pressedThisTick.clear();
}
addEventListener("blur", resetInput);

// ── Game state ───────────────────────────────────────────────
const player = {
  x: 0, y: 0, px: 0, py: 0, // current and previous position for interpolation
  speed: 260, size: 24,
};
const STEP = 1 / 60;         // fixed physics: deterministic
let accumulator = 0;
let last = performance.now();
let running = true;

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  resetInput(); accumulator = 0;
  last = performance.now(); // evitar salto acumulado
});

function update(dt) {
  player.px = player.x; player.py = player.y;
  let dx = 0, dy = 0;
  if (keys.ArrowLeft || keys.KeyA) dx -= 1;
  if (keys.ArrowRight || keys.KeyD) dx += 1;
  if (keys.ArrowUp || keys.KeyW) dy -= 1;
  if (keys.ArrowDown || keys.KeyS) dy += 1;
  if (dx !== 0 && dy !== 0) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; } // diagonal
  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;
  // TODO: physics and collisions, only here, with dt
}

function render(alpha) {
  // Interpolation: draw between px and x for smooth movement at any refresh rate
  const ix = player.px + (player.x - player.px) * alpha;
  const iy = player.py + (player.y - player.py) * alpha;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // CSS units inside the HiDPI canvas
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  // TODO: draw the world
  ctx.fillStyle = "#38bdf8";
  const half = player.size / 2;
  ctx.fillRect(ix - half + innerWidth / 2, iy - half + innerHeight / 2, player.size, player.size);
}

// ── Loop: fixed physics, interpolated rendering ───────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = STEP; // spiral-of-death guard

  accumulator += elapsed;
  while (accumulator >= STEP) {
    update(STEP);
    pressedThisTick.clear();
    accumulator -= STEP;
  }
  render(accumulator / STEP);
}
requestAnimationFrame(frame);
</script>
</body>
</html>`),
  "notes": [
    "Variable-delta physics can break collisions and determinism; use a fixed timestep with interpolation.",
    "Always scale canvas.width by dpr and use setTransform(dpr,…) to draw in CSS units.",
    "pressedThisTick provides clean edge detection for single-frame jumps or firing.",
  ],
}
