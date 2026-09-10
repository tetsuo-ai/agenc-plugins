---
description: Write with a chosen voice — formal, warm, concise, persuasive, technical — or a full form (letter, email, speech, proposal, cover letter), verified by a deterministic linter before delivery
argument-hint: "<estilo> <pedido o texto>"
---

Follow the `escritura` skill and its boundaries.

The first argument names the style when it matches one of: formal,
cercano, directo, persuasivo, tecnico, carta-formal,
email-profesional, discurso, propuesta, cover-letter. Everything else
is the writing request (or the text to re-style).

1. Confirm the style if ambiguous (one short question at most).
2. Draft following the style's output-style definition.
3. `style_lint` the draft; fix violations and re-lint until pass (two
   iterations maximum — then surface the unresolved choice to the user).
4. Deliver the final text plus one line: style, score, what changed.
5. If the user will keep writing in this voice, suggest
   `/output-style` for the session.

With no style in the argument, propose the two most likely styles in
one line and pick the better fit if the user does not answer.
