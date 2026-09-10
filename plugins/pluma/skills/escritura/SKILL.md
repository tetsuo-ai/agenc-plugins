---
name: escritura
description: Writing with styles and a deterministic verifier. Picks the right tone or document form, drafts, then verifies the draft against the style's lint ruleset (register, structure, length, readability) and fixes every violation before delivering. Use for letters, emails, speeches, proposals, cover letters, or any text that must carry a specific voice.
when_to_use: The user asks to write something with a voice or form ("write a formal letter", "redactá un discurso", "make this concise", "suena muy frío"), or wants existing text re-styled or checked.
argument-hint: <estilo> [texto o pedido]
---

# Escritura — la voz elegida, verificada

Los estilos de pluma son dos cosas: una biblioteca de voces y formas
(seleccionables como output styles con `/output-style` para toda la
sesión) y un verificador determinista que se asegura de que el borrador
CUMPLE el estilo antes de entregarlo. El modelo escribe; el linter
juzga.

## Protocolo

1. **Elige el estilo con el usuario** — `styles_list` y una pregunta
   corta si no está claro. Tonos (formal, cercano, directo, persuasivo,
   técnico) vs formas (carta-formal, email-profesional, discurso,
   propuesta, cover-letter). Si el usuario da texto existente para
   re-estilizar, nombra qué tiene y qué quiere.
2. **Borrador** — escribe siguiendo el output style correspondiente (su
   markdown define estructura y reglas). Máxima densidad de propósito:
   cada línea gana la siguiente.
3. **Verifica** — `style_lint` con el borrador y el estilo. Lee las
   violaciones: severidad, excerpt, fix.
4. **Corrige y repite** — aplica los fixes y vuelve a lintear hasta
   `pass: true` (score ≥ 85). Máximo dos iteraciones de corrección; si
   algo sigue en rojo, es una decisión del usuario: muéstrala, no la
   resuelvas por él (p. ej. falta el precio real en una propuesta).
5. **Entrega** — el texto final, más una línea con el score y qué
   corregiste. Si el usuario querrá escribir más en esa voz, sugiere
   `/output-style <nombre>` para toda la sesión.

## Sobre re-estilizar texto existente

Preserva los HECHOS del original (nombres, cifras, fechas, pedidos) al
mil por ciento; el estilo cambia, la verdad no. Si el original contiene
afirmaciones que el lint marca (vaguedades, hedges), no las "mejores"
inventando datos: márcalas al usuario.

## Límites

- El linter es determinista: sus reglas son francas, no sutiles. Un
  `info` no bloquea la entrega; un `error` sí.
- No inventes destinatarios, empresas ni logros: el gancho de un cover
  letter se escribe con lo que el usuario dio, o se pregunta.
- Los tools son entradas deferidas del catálogo: busca con tu tool
  search (`system.searchTools`) "pluma" antes del primer uso.
