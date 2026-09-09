---
description: Write code with a chosen discipline — clean, defensive, functional, solid — or the minimal-diff surgery protocol for existing files, verified by a deterministic structural linter
argument-hint: "<limpio|defensivo|funcional|solid|minimal-diff> <pedido o archivo>"
---

Follow the `calidad` skill and its boundaries.

The first argument names the style when it matches one of: limpio,
defensivo, funcional, solid, minimal-diff. Everything else is the
task (or the file to edit).

1. Confirm the style if ambiguous (one short question at most). When
   the target is an existing file, minimal-diff applies by default.
2. Draft following the style's output-style definition; for edits,
   Read the file first and match its conventions.
3. `code_lint` the draft (with `original` for edits); fix violations
   and re-lint until pass — two iterations maximum, then surface the
   unresolved choice to the user.
4. Deliver the code plus one line: style, score, what changed.
5. If the user keeps coding in this discipline, suggest
   `/output-style` for the session.
