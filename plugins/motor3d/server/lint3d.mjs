/**
 * Deterministic 3D/browser-game code verifier — the motor3d engine room.
 * Two families of rules, plain regex/arithmetic, zero dependencies:
 *
 * 1. API-era table: the classic small-model hallucinations — APIs that
 *    were REMOVED or RENAMED in modern three.js/WebGPU, each with the
 *    modern replacement and the release that changed it. These are
 *    errors, not style.
 * 2. Performance/robustness heuristics: per-frame allocations, missing
 *    resize handling, missing dispose, DPR-blind canvas sizing, delta
 *    without clamp, cached WebGPU textures, touch-action absent on
 *    interactive canvases — stated severity, stated fix.
 */

export const REMOVED_APIS = [
  { re: /\bTHREE\.Geometry\b/gu, fix: "THREE.BufferGeometry", note: "Geometry se eliminó en r125" },
  { re: /\bTHREE\.sRGBEncoding\b/gu, fix: "THREE.SRGBColorSpace", note: "sRGBEncoding se eliminó (r162)" },
  { re: /\bTHREE\.LinearEncoding\b/gu, fix: "THREE.NoColorSpace / LinearSRGBColorSpace", note: "eliminado junto a sRGBEncoding" },
  { re: /\b\.outputEncoding\b/gu, fix: "renderer.outputColorSpace", note: "renamed r152+" },
  { re: /\b\.physicallyCorrectLights\b/gu, fix: "(eliminado: ahora siempre físico)", note: "eliminado r150+" },
  { re: /\buseLegacyLights\b/gu, fix: "(eliminado: escala de intensidad moderna)", note: "eliminado r165" },
  { re: /\bTHREE\.MeshLambertMaterial\b/gu, fix: "MeshStandardMaterial / MeshPhongMaterial", note: "Lambert sin PBR; en pipelines HDR moderna da resultados planos — solo si es intencional", severity: "info" },
  { re: /\bnew\s+THREE\.OrbitControls\b/gu, fix: "import { OrbitControls } from \"three/addons/controls/OrbitControls.js\"", note: "no está en el core de THREE" },
  { re: /\bTHREE\.GLTFLoader\b/gu, fix: "import { GLTFLoader } from \"three/addons/loaders/GLTFLoader.js\"", note: "addon, no core" },
  { re: /new\s+THREE\.WebGLRenderer\s*\(\s*\{\s*gammaFactor/gu, fix: "outputColorSpace", note: "gammaFactor eliminado" },
  { re: /\brenderer\.gammaOutput\b/gu, fix: "renderer.outputColorSpace", note: "eliminado r152+" },
  { re: /\bgeometry\.attributes\.position\.array\s*=/gu, fix: "geometry.attributes.position.set(...) + needsUpdate, o setAttribute", note: "asignar .array directo no refreshea el buffer" },
  { re: /\btexture\.encoding\b/gu, fix: "texture.colorSpace", note: "renamed r152+" },
  { re: /\bTHREE\.ACESFilmicToneMapping\s*\?\?/gu, fix: "", note: "", skip: true },
];

const PERF_RULES = {
  perFrameAlloc: {
    re: /(?:new THREE\.(?:Vector2|Vector3|Matrix4|Matrix3|Quaternion|Euler|Color|Raycaster|Box3|Sphere)\s*\()/gu,
    inLoop: true,
    severity: "warn",
    message: "allocation de objetos THREE dentro del loop de animación",
    fix: "Creá los objetos UNA vez fuera del loop y reutilizá (set/copy). El GC por frame causa stutter.",
  },
  missingResize: {
    detect: (code, framework) => framework !== "webgpu"
      && /(?:requestAnimationFrame|setAnimationLoop)/u.test(code)
      && !/addEventListener\s*\(\s*["']resize["']/u.test(code),
    severity: "warn",
    message: "loop de render sin handler de resize",
    fix: "resize: camera.aspect + updateProjectionMatrix + renderer.setSize. Sin esto, deformás al cambiar tamaño.",
  },
  missingDispose: {
    detect: (code) => (code.match(/new THREE\.\w*(?:Geometry|Material|Texture)\b/gu) ?? []).length >= 3
      && !/\.dispose\s*\(/u.test(code),
    severity: "info",
    message: "recursos THREE creados sin ningún dispose()",
    fix: "En SPAs: geometry.dispose(), material.dispose(), renderer.dispose() al descargar la escena.",
  },
  missingPixelRatio: {
    detect: (code) => /new THREE\.WebGLRenderer/u.test(code)
      && !/setPixelRatio/u.test(code),
    severity: "info",
    message: "WebGLRenderer sin setPixelRatio",
    fix: "renderer.setPixelRatio(Math.min(devicePixelRatio, 2)) — con tope 2 para móvil.",
  },
  canvas2dDprBlind: {
    detect: (code, framework) => framework === "canvas2d"
      && /canvas\.width\s*=\s*(?!.*dpr)/u.test(code.replace(/\n/gu, " "))
      && !/devicePixelRatio/u.test(code),
    severity: "error",
    message: "canvas 2D dimensionado sin devicePixelRatio",
    fix: "canvas.width = innerWidth * dpr; y ctx.setTransform(dpr,0,0,dpr,0,0) para dibujar en unidades CSS.",
  },
  deltaNoClamp: {
    detect: (code) => /getDelta\s*\(\s*\)/u.test(code)
      && !/Math\.min\s*\(\s*\w+\s*\.?getDelta|Math\.min\s*\([^)]*getDelta|clamp/giu.test(code.split("getDelta")[0] + "getDelta")
      && !/Math\.min\s*\(/u.test(code),
    severity: "warn",
    message: "delta del clock sin clamp",
    fix: "const dt = Math.min(clock.getDelta(), 0.1): al volver de pestaña inactiva, dt gigante rompe física y salta objetos.",
  },
  cachedGpuTexture: {
    detect: (code, framework) => framework === "webgpu"
      && [...code.matchAll(/(?:const|let)\s+\w+\s*=\s*\w+\.getCurrentTexture\s*\(\s*\)/gu)]
        .some((m) => !isInsideLoop(code, m.index))
      && /requestAnimationFrame|frame\s*\(/u.test(code),
    severity: "error",
    message: "getCurrentTexture() cacheado en variable de módulo",
    fix: "Es una textura nueva por frame: llamá getCurrentTexture() DENTRO del frame, nunca cachear.",
  },
  missingTouchAction: {
    detect: (code) => /(?:pointerdown|pointermove)/u.test(code)
      && /<canvas/u.test(code)
      && !/touch-action/u.test(code),
    severity: "warn",
    message: "canvas interactivo sin touch-action",
    fix: "canvas { touch-action: none } en CSS — sin eso, el navegador roba el gesto para scroll en móvil.",
  },
  audioNoGesture: {
    detect: (code) => /new\s+(?:AudioContext|webkitAudioContext)\s*\(/u.test(code)
      && !/resume\s*\(/u.test(code),
    severity: "warn",
    message: "AudioContext sin resume por gesto",
    fix: "Los navegadores bloquean audio sin interacción: ctx.resume() en el primer pointerdown/keydown.",
  },
  manyMeshesNoInstancing: {
    detect: (code) => {
      const adds = (code.match(/scene\.add\s*\(/gu) ?? []).length;
      const inLoop = /(for\s*\(|while\s*\()[\s\S]{0,200}scene\.add\s*\(/u.test(code);
      return inLoop || adds >= 15;
    },
    severity: "warn",
    message: "muchos meshes agregados individualmente",
    fix: "Objetos idénticos → InstancedMesh (1 draw call por N instancias). Es la diferencia entre 5 y 5000 objetos fluidos.",
  },
  rendererInLoop: {
    detect: (code) => [...code.matchAll(/new THREE\.(?:WebGLRenderer|PerspectiveCamera)\s*\(/gu)]
      .some((m) => isInsideLoop(code, m.index)),
    severity: "error",
    message: "renderer o cámara creados más de una vez",
    fix: "UN renderer y UNA cámara por página; recrearlos filtra contextos WebGL (el navegador los limita a ~8-16).",
  },
};


/**
 * Lint one snippet/file. `framework`: "three" | "canvas2d" | "webgpu"
 * (heuristic auto-detect when omitted).
 */
export function lint3d(code, { framework } = {}) {
  if (typeof code !== "string" || code.length > 100_000) return { error: "code must be a string of at most 100000 characters" };
  if (framework !== undefined && !["three", "canvas2d", "webgpu"].includes(framework)) return { error: "unknown framework" };
  const source = code;
  if (source.trim().length < 10) {
    return { error: "código demasiado corto para analizar" };
  }
  const detected = framework ?? detectFramework(source);
  const violations = [];
  const push = (severity, rule, message, fix) =>
    violations.push({ severity, rule, message, fix });

  // 1) API-era table (solo three)
  if (detected === "three") {
    for (const api of REMOVED_APIS) {
      if (api.skip) continue;
      const hits = [...source.matchAll(api.re)].length;
      if (hits > 0) {
        push(api.severity ?? "error", `api-era:${api.re.source.slice(0, 30)}`,
          `${hits}× ${api.note}${api.fix ? ` → ${api.fix}` : ""}`, api.fix || "Consultá la tabla de scaffolds.");
      }
    }
  }

  // 2) Performance rules
  for (const [name, rule] of Object.entries(PERF_RULES)) {
    let triggered = false;
    let count = 0;
    if (rule.re !== undefined) {
      const hits = [...source.matchAll(rule.re)];
      count = hits.length;
      if (rule.inLoop) {
        triggered = hits.some((m) => isInsideLoop(source, m.index ?? 0));
      } else {
        triggered = count > 0;
      }
    } else if (rule.detect !== undefined) {
      try {
        const result = rule.detect(source, detected);
        if (typeof result === "boolean") triggered = result;
      } catch {
        triggered = false;
      }
    }
    if (triggered) {
      push(rule.severity, name, `${rule.message}${count > 1 ? ` (${count}×)` : ""}`, rule.fix);
    }
  }

  const weights = { error: 15, warn: 6, info: 2 };
  const score = Math.max(0, 100 - violations.reduce((a, v) => a + (weights[v.severity] ?? 2), 0));
  return {
    framework: detected,
    stats: {
      lines: source.split(/\r?\n/u).length,
      threeObjects: (source.match(/new THREE\.\w+/gu) ?? []).length,
      rafLoops: (source.match(/requestAnimationFrame|setAnimationLoop/gu) ?? []).length,
      disposes: (source.match(/\.dispose\s*\(/gu) ?? []).length,
    },
    violations,
    score,
    pass: score >= 85 && !violations.some((v) => v.severity === "error"),
  };
}

export function detectFramework(code) {
  if (/getCurrentTexture|navigator\.gpu|createRenderPass/u.test(code)) return "webgpu";
  if (/new THREE\.|import \* as THREE|three\.module/u.test(code)) return "three";
  if (/getContext\s*\(\s*["']2d["']/u.test(code)) return "canvas2d";
  return "three";
}

/** Heurística: ¿el índice cae dentro de una función invocada por frame? */
function isInsideLoop(source, index) {
  // Busca el rango de la función envolvente que contiene a requestAnimationFrame/setAnimationLoop
  const rafMatches = [...source.matchAll(/(?:requestAnimationFrame\s*\(\s*(\w+)|setAnimationLoop\s*\(\s*(\w+))/gu)];
  for (const m of rafMatches) {
    const fnName = m[1] ?? m[2];
    if (fnName === undefined) continue;
    const fnStart = source.search(new RegExp(`(?:function\\s+${fnName}\\s*\\(|const\\s+${fnName}\\s*=|let\\s+${fnName}\\s*=)`, "u"));
    if (fnStart === -1 || fnStart > index) continue;
    const bodyStart = source.indexOf("{", fnStart);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          if (index >= bodyStart && index <= i) return true;
          break;
        }
      }
    }
  }
  return false;
}
