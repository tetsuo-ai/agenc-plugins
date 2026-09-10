---
aliases: [codigo]
description: Write code in a clean, defensive, functional, or solid discipline, or use minimal-diff for existing files, with deterministic structural checks
argument-hint: "<clean|defensive|functional|solid|minimal-diff> <request or file>"
---

Follow the skill in `skills/calidad/SKILL.md` and its boundaries.

Recognize clean, defensive, functional, solid, and minimal-diff as canonical
style arguments. Accept legacy style IDs through the linter's compatibility
aliases. Remaining arguments contain the task or target file.

1. Clarify an ambiguous style with at most one short question. Default to
   minimal-diff when editing an existing file.
2. Draft using the output style. Read existing files first and match their
   conventions.
3. Run `code_lint`, passing `original` for edits. Revise and recheck at most
   twice, then explain any unresolved choice to the user.
4. Deliver the code and one line with style, score, and changes.
5. Suggest `/output-style` for a continuing session-wide discipline.
