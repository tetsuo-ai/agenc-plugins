---
description: Browser 3D and games with verified scaffolds, API-era lint and a self-checking harness
argument-hint: "<pedido 3d o juego>"
---

Follow the `motor3d` skill and its boundaries.

1. `scaffolds_list` → pick the closest scaffold → `scaffold_get` → adapt
   ONLY the TODO marks (never rewrite the base from memory).
2. `lint3d` the adapted code; fix every `api-era` error with the given
   fix, then the perf warnings; re-lint until pass (two iterations
   maximum — then surface the unresolved choice).
3. `harness_build` with the final code and deliver BOTH: the harness
   file (user opens it and sees errors/FPS) and the integrated version
   if they have their own HTML.
4. One line to close: framework, lint score, what the harness shows.
Search the tools ("motor3d") with your tool search before first use.
