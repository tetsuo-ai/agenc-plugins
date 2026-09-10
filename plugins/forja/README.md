# Forja

Code writing styles with a deterministic verifier — pluma's discipline,
applied to code. The ecosystem separates code-style prompting from
linters; forja closes the loop: the model writes under a chosen
discipline, the verifier supplies heuristic feedback before delivery.

## The disciplines (AgenC output styles)

- **limpio** — small single-purpose functions (≤ 25 lines), early
  returns, intention-revealing names, no magic numbers, no leftovers.
- **defensivo** — guard clauses at every boundary, fail fast with
  actionable errors, no swallowed catches, explicit switch defaults.
- **funcional** — pure functions by default, const discipline,
  map/filter/reduce over mutation, errors as values when expected.
- **solid** — one responsibility per class (≤ 200 lines / ≤ 10 public
  methods), injected dependencies, composition over inheritance.
- **minimal-diff** — the surgery protocol for editing existing code:
  smallest coherent change, and the host file's conventions (tabs vs
  spaces and width, quotes, naming, semicolons) are the spec.

Each file carries the craft: rules plus before/after examples.

## The verifier (forja-lint MCP server)

`code_lint` runs heuristic structural analysis (JS/TS and Python —
stated as heuristics, no AST, zero dependencies) with base rules
(function-length bands, nesting depth, parameter counts, long
lines/files, duplicate blocks, naming-mix detection, debug leftovers,
empty catches, dead imports, else-after-return, TODO markers) plus
per-style discipline — and for minimal-diff, **measured consistency
with the original file**: indentation style and width, quote style,
naming convention and semicolon endings must match the file being
edited, not your preferences. Violations carry concrete fixes; drafts
clear 85/100 before delivery. `code_styles_list` exposes the library.

## MCP server

`server/main.mjs` (NDJSON JSON-RPC): `code_styles_list`, `code_lint`.
No state, no network.

Use a current Core build with native plugin MCP support, not a duplicate
unrestricted MCP registration. A pass requires score >=85 and zero errors.
This linter does not compile or execute code, prove correctness/security, or
cover every syntax form (including complex regex/templates). Always run the
project's formatter, compiler and tests. Review suggestions before applying.
