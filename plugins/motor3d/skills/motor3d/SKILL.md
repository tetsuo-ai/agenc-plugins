---
name: motor3d
description: Browser 3D and game development with verified scaffolds and a deterministic verifier. Retrieves correct modern three.js/canvas2d/WebGPU patterns instead of writing from memory, kills the classic API hallucinations (THREE.Geometry, outputEncoding, core OrbitControls), catches per-frame allocation and lifecycle bugs, and delivers a self-checking harness the user opens to SEE errors and FPS. Built for small local models.
when_to_use: The user asks for anything 3D in the browser, three.js, WebGL/WebGPU, a canvas game, shaders, or says their scene is slow/black/not rendering.
argument-hint: <3d or game request>
---

# 3D Engine: correct scaffolds instead of recall

Small models can misuse three.js because of recall errors: removed APIs,
allocations inside the loop, or missing resize/dispose/DPR handling.
This skill supplies reference implementations outside the model.

## Protocol

1. **Retrieve first**: use `scaffolds_list`, choose the closest match, then
   `scaffold_get` and adapt ONLY the TODO marks. Rewriting the base from
   memory reintroduces the same errors.
2. **Adapt** content, parameters, and mechanics. Preserve the pinned import
   map, resize handler, delta clamp, and disposal structure.
3. **Verify** the final code with `lint3d`:
   - `api-era:*` errors identify removed or renamed APIs. Always apply the fix.
   - Performance warnings/errors cover per-frame allocations, resize,
     disposal, DPR, delta, and instancing. Fix them and lint again.
   - Explain any `info` finding you choose to leave unchanged.
4. **Iterate until pass** (score ≥ 85 and zero errors), at most twice.
   Present any remaining failures as unresolved choices for the user.
5. **Deliver a harness**: run `harness_build` on the final code to provide
   self-contained HTML with an error overlay and FPS counter. The user can
   open it to inspect failures. If they already have HTML, also deliver the
   harness as a separate test version.

## Common pitfalls

- **API versions**: verify uncertain APIs with `lint3d`, not memory.
- **Render loop**: no `new` inside the loop; always clamp dt.
- **Lifecycle**: resize and disposal are required.
- **Mobile**: cap pixel ratio at 2 and use `touch-action: none`.
- **Canvas 2D**: scale `canvas.width` by dpr and use `setTransform` to avoid blur.
- **WebGPU**: never cache `getCurrentTexture()` across frames.

## Boundaries

- The linter uses text heuristics; it does not prove correctness or security.
- The server is offline. Three.js HTML downloads Three.js 0.170.0 from
  jsDelivr, and the GLTF example uses an external model. Serve local copies
  for offline use. Test rendering and interaction in the target browser.
- Use the native MCP installation; do not duplicate the server in user config.
- Scaffolds are verified starting points, not finished games. Develop the
  mechanics with the user.
- For custom shaders or physics without a matching scaffold, adapt the
  closest one, identify what remains unverified, and still run `lint3d`.
- Tools are deferred. Search for "motor3d" with `system.searchTools` before
  first use.
