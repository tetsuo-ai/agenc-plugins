---
name: Code Quality
description: Choose a code-writing discipline or minimal-diff for existing files, draft, verify structural quality and consistency, then revise before delivery. Use for new code, edits, refactoring, or code-quality reviews.
when_to_use: The user asks to write code, refactor, edit an existing file, review code quality, or apply a design discipline.
argument-hint: <style> [code or request]
---

# Code quality with a verified discipline

Forge combines code-writing output styles with a deterministic structural
verifier. The model writes; the linter provides heuristic feedback.

## Workflow

1. Choose a discipline, using `code_styles_list` if needed. For new code,
   default to clean. Use defensive for external boundaries, functional for
   domain transformations, and solid for stateful domains. For existing
   files, default to **minimal-diff** and preserve the file's own discipline.
2. Draft using the output style. Before editing, read the file, learn its
   conventions, and make the smallest complete change.
3. Call `code_lint` with draft, style, and language. `js` covers JS/TS;
   `py` covers Python. For edits, pass the current file as `original` so
   indentation, quotes, naming, and semicolons can be compared.
4. Revise and recheck until `pass: true`, requiring a score of at least 85
   and no errors. Stop after two revision passes. Explain unresolved
   findings, such as a necessarily long algorithm, for the user's decision.
5. Deliver the code and one line with style, score, and changes. For a
   session-wide discipline, open `/output-style` and select the installed
   plugin style matching the catalog's `outputStyleName`. Do not construct
   an exact style ID; it includes an installation namespace.

## About the verifier

The analysis uses heuristics, not an AST. Explain false positives rather
than silently suppressing them. Informational findings alone do not block
delivery; errors do. Run the project's compiler, formatter, and tests.

## Boundaries

- Do not reformat unrelated code merely to satisfy the linter.
- Preserve existing names and conventions outside the requested change.
  Improve code you introduce without broadening the task.
- Discover deferred tools with `system.searchTools` using the compatible
  installation ID `forja` before first use.
