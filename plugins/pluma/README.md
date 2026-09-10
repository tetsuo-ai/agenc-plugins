# Quill

Writing styles with a deterministic verifier. A style library and a prose
linter share one write, lint, and revise loop inside the agent.

## The library

Ten styles offer these English linter labels:

- Voices: `formal` (measured courtesy), `warm` (natural and personable),
  `concise` (conclusion first), `persuasive` (benefit, evidence, one action),
  and `technical` (precise and quantified).
- Forms: `formal-letter`, `professional-email`, `speech`, `proposal`,
  and `cover-letter`. Each defines structure, register, length guidance,
  and examples.

The installation ID remains `pluma`. Saved output-style IDs and file paths
are unchanged. Open `/output-style` and select the installed plugin style
matching the `outputStyleName` returned by `styles_list`. Exact style IDs
include an installation namespace. New linter requests can use the English labels above;
legacy linter IDs remain accepted.

## The verifier

The `pluma-lint` MCP server checks English and Spanish drafts for fillers,
slang, hedges, vague quantities, contractions, register, passive-heavy prose,
sentence and paragraph length, greetings and closings, proposal sections,
calls to action, opening hooks, and approximate readability. Findings include
excerpts and concrete suggestions. Passing requires a score of at least 85
and no error findings.

`styles_list` returns the library and its rules. `style_lint` accepts a draft,
style, and optional email subject. It returns statistics, findings, score,
and pass status. The server uses newline-delimited JSON-RPC with no state,
network access, or external dependencies.

Use Core's native plugin MCP integration, not a duplicate unrestricted
registration. The checks are heuristics, not a grammar, factual-accuracy, or
quality guarantee. Preserve facts when revising; never invent details to
satisfy a rule.
