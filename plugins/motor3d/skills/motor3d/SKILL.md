---
name: motor3d
description: Browser 3D and game development with verified scaffolds and a deterministic verifier. Retrieves correct modern three.js/canvas2d/WebGPU patterns instead of writing from memory, kills the classic API hallucinations (THREE.Geometry, outputEncoding, core OrbitControls), catches per-frame allocation and lifecycle bugs, and delivers a self-checking harness the user opens to SEE errors and FPS. Built for small local models.
when_to_use: The user asks for anything 3D in the browser, three.js, WebGL/WebGPU, a canvas game, shaders, or says their scene is slow/black/not rendering.
argument-hint: <pedido 3d o juego>
---

# Motor3D — el andamio correcto, no de memoria

Los modelos chicos escriben three.js MAL por recall, no por comprensión:
alucinan APIs eliminadas, allocan en el loop, olvidan resize/dispose/DPR.
Este skill mueve la verdad fuera del modelo:

## Protocolo

1. **Nunca de memoria** — `scaffolds_list`, elegí el más cercano,
   `scaffold_get` y adaptá SOLO los TODO. El scaffold ES la base
   correcta; reescribirlo de memoria reintroduce el problema.
2. **Adaptá** — contenido, parámetros, mecánica. Conservá la estructura:
   import map pineado, resize handler, delta clamp, dispose.
3. **Verificá** — `lint3d` con el código final. Reglas:
   - `api-era:*` (error): API eliminada/renombrada — corregí SIEMPRE
     con el fix que te da.
   - perf (warn/error): allocation por frame, resize, dispose,
     DPR, delta, instancing — corregí y relinteá.
   - `info`: decisión tuya — pero decíselo al usuario.
4. **Iterá hasta pass** (score ≥ 85 y cero errores), máximo dos vueltas; lo que siga
   en rojo es una decisión del usuario: mostrala.
5. **Entregá con harness** — `harness_build` con el código final: HTML
   autocontenido con overlay de errores y contador de FPS. El usuario
   lo abre y VE si funciona — nada de canvas negro silencioso. Si el
   usuario ya tiene su HTML, entregá el harness igual como versión de
   prueba.

## Las trampas clásicas (memorizá las categorías, no las APIs)

- **Era de API**: three cambió mucho; si dudás de una API, lint3d lo
  responde — no la recuerdes, verificá.
- **Loop de render**: cero `new` dentro; dt SIEMPRE con clamp.
- **Ciclo de vida**: resize + dispose no son opcionales.
- **Móvil**: pixel ratio con tope 2, touch-action: none.
- **Canvas 2D**: `canvas.width` × dpr + `setTransform` — sino se ve
  borroso.
- **WebGPU**: `getCurrentTexture()` NUNCA se cachea (es nueva por frame).

## Límites

- El linter usa heurísticas de texto, no prueba corrección ni seguridad.
- El servidor es offline; los HTML de Three.js descargan Three.js 0.170.0
  de jsDelivr y el ejemplo GLTF usa un modelo externo. Para uso offline,
  serví copias locales. Probá render e interacción en el navegador objetivo.
- Instalación MCP nativa: no duplicar el servidor en configuración de usuario.

- Los scaffolds son puntos de partida verificados, no tu juego: la
  mecánica la ponés vos con el usuario.
- Si el usuario pide algo que ningún scaffold cubre (shaders propios,
  física), partí del más cercano, sé explícito sobre lo que no está
  verificado y lint3d igual.
- Los tools son entradas deferidas: buscalos con tu tool search
  (`system.searchTools`) "motor3d" antes del primer uso.
