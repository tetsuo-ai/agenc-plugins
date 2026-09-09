// Scaffold: canvas2d-game-loop — loop de juego serio en Canvas 2D:
// timestep FIJO para física, render interpolado, DPR correcto,
// input edge/hold, pausa al ocultar pestaña.
export default {
  "name": "canvas2d-game-loop",
  "framework": "canvas2d",
  "description": "Game loop de producción: física a 60 Hz fijos con render interp, DPR-aware, input limpio, visibilidad.",
  "html": `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>TODO: título</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0f172a}canvas{display:block;image-rendering:pixelated}</style>
</head>
<body>
<canvas id="game"></canvas>
<script type="module">
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ── Resolución + DPR ───────────────────────────────────────────────
const dpr = Math.min(devicePixelRatio || 1, 2);
function resize() {
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

// ── Estado del juego ───────────────────────────────────────────────
const player = {
  x: 0, y: 0, px: 0, py: 0, // posición actual y previa (para interp)
  speed: 260, size: 24,
};
const STEP = 1 / 60;         // física fija: determinista
let accumulator = 0;
let last = performance.now();
let running = true;

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
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
  // TODO: física, colisiones — solo aquí, con dt
}

function render(alpha) {
  // interpolación: dibujar ENTRE px y x → movimiento suave a cualquier Hz
  const ix = player.px + (player.x - player.px) * alpha;
  const iy = player.py + (player.y - player.py) * alpha;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // unidades CSS dentro del canvas HiDPI
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  // TODO: dibujar el mundo
  ctx.fillStyle = "#38bdf8";
  const half = player.size / 2;
  ctx.fillRect(ix - half + innerWidth / 2, iy - half + innerHeight / 2, player.size, player.size);
}

// ── Loop: física fija, render interp ───────────────────────────────
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
</html>`,
  "notes": [
    "Física con dt VARIABLE rompe colisiones y determinismo; fija + interp no.",
    "canvas.width SIEMPRE × dpr, y setTransform(dpr,…) para dibujar en unidades CSS.",
    "pressedThisTick: edge-detection limpio para saltos/disparos de un frame.",
  ],
}
