---
name: calidad
description: Code writing with styles and a deterministic verifier. Picks the discipline (clean, defensive, functional, solid) or the minimal-diff surgery protocol for editing existing code, drafts, verifies the draft with structural lint (function bands, nesting, naming, consistency with the host file), fixes every violation, and delivers. Use when writing new code, editing existing files, or when asked for cleaner/better code.
when_to_use: The user asks to write code, refactor, "hacelo limpio", edit an existing file, review whether code is clean, or apply a design discipline.
argument-hint: <estilo> [código o pedido]
---

# Calidad — la disciplina elegida, verificada

forja es pluma para código: una biblioteca de disciplinas de escritura
(output styles) y un verificador estructural determinista que el
borrador debe superar antes de entregarse. El modelo escribe; el linter
juzga.

## Protocolo

1. **Elige la disciplina con el usuario** — `code_styles_list` si hay
   duda. Código NUEVO: limpio (default), defensivo (fronteras con el
   exterior), funcional (lógica de dominio), solid (estado y dominios
   ricos). Código EXISTENTE: **minimal-diff, siempre** — la disciplina
   del archivo es la del archivo.
2. **Borrador** — escribe siguiendo el output style. Para ediciones:
   lee el archivo, respeta sus convenciones, cambio mínimo completo.
3. **Verifica** — `code_lint` con el borrador, estilo y lenguaje
   (`js` cubre TS, `py` Python). Para ediciones pasa `original`: el
   contenido actual del archivo — la consistencia (indentación,
   comillas, naming, punto y coma) se MIDE contra él.
4. **Corrige y repite** — aplica los fixes y relintea hasta
   `pass: true` (score ≥ 85). Máximo dos iteraciones; lo que siga en
   rojo es una decisión del usuario (una función larga que ES el
   algoritmo, un catch que el dominio justifica): muéstrala, no la
   resuelvas por él.
5. **Entrega** — el código más una línea: estilo, score, qué
   corregiste. Sugiere `/output-style <nombre>` si seguirá escribiendo
   código en esa disciplina.

## Sobre el verificador

Es heurístico y lo dice: sin AST, con regex y aritmética. Un `info` no
bloquea; un `error` sí. Los falsos positivos se explican al usuario en
una línea, no se silencian — y si una regla molesta sistemáticamente,
es feedback para el plugin, no para pelearla cada vez.

## Límites

- Nunca reformatees código que no te pidieron para "pasar el linter":
  en ediciones, el diff mínimo es la regla y el linter lo sabe
  (matchea contra el original).
- Los números mágicos y nombres crípticos que vienen del código AJENO
  se respetan en ediciones; se corrigen en código nuevo tuyo.
- Los tools son entradas deferidas: busca con tu tool search
  (`system.searchTools`) "forja" antes del primer uso.
