# Forge

Code-writing styles with a deterministic verifier. The agent writes under a
chosen discipline, checks the draft, and uses heuristic feedback before
delivery.

## The disciplines

- **clean**: small, single-purpose functions, early returns, clear names,
  named constants, and no debug leftovers.
- **defensive**: guard clauses at boundaries, actionable errors, explicit
  defaults, and no swallowed exceptions.
- **functional**: pure functions, immutable data, composition, and isolated
  side effects.
- **solid**: one responsibility per class, injected dependencies, and
  composition over inheritance.
- **minimal-diff**: the smallest complete change to an existing file,
  matching its indentation, quotes, naming, and semicolons.

Each output style includes rules and examples. The installation ID remains
`forja`, and saved output-style IDs and paths are unchanged. Open
`/output-style` and select the installed plugin style matching the
`outputStyleName` returned by `code_styles_list`. Exact style IDs include
an installation namespace. New linter requests can use the English labels
above; legacy IDs remain accepted.

## The verifier

The `forja-lint` MCP server exposes `code_styles_list` and `code_lint`.
Checks cover function length, nesting, parameter counts, long lines and
files, duplicate blocks, naming, debug leftovers, empty catches, unused
imports, TODO markers, and style-specific rules. For edits, pass `original`
so minimal-diff can compare the draft with the existing file's conventions.

Passing requires a score of at least 85 and no error findings. Findings
include concrete suggestions. The server uses newline-delimited JSON-RPC
with no state, network access, or external dependencies.

Use Core's native plugin MCP support, not a duplicate unrestricted server.
The JS/TS and Python checks are heuristics without an AST. They do not
compile or execute code, prove security or correctness, or cover every
syntax form. Always run the project's formatter, compiler, and tests.
Review suggestions before applying them.
