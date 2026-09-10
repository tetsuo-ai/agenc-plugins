# Pluma

Writing styles with a deterministic verifier. Two halves that the
ecosystem keeps separate — prompt-level style libraries and prose
linters (Vale, write-good) — combined into one write → lint → fix loop
inside the agent.

## The library (AgenC output styles)

Ten curated styles, selectable session-wide with `/output-style`:

- **Voices**: `formal` (usted, no contractions, measured courtesy),
  `cercano` (warm human, tuteo, zero ceremony), `directo` (conclusion
  first, ≤15-word sentences, no filler), `persuasivo` (benefit first,
  proof for every claim, exactly one CTA), `tecnico` (impersonal,
  quantified, no vague quantities, monospace for code).
- **Forms** (structure + voice): `carta-formal` (protocol structure,
  one request, 150–300 words), `email-profesional` (actionable subject,
  scannable body, action close), `discurso` (hook, one idea force,
  anaphora/triads, spoken-rhythm sentences), `propuesta` (six required
  sections with numbers and next steps), `cover-letter` (named
  greeting, measured achievements, proactive close, 150–350 words).

Each file carries the craft: structure, rules, and before/after
examples.

## The verifier (pluma-lint MCP server)

The model writes; the linter judges — deterministically, in Spanish and
English: fillers and weasel phrases, slang, hedges, vague quantifiers,
English contractions, exclamations/emoji by register, first-person
opinion in technical prose, decorative intensifiers, passive-heavy
writing, long sentences/paragraphs, missing salutation/closing, missing
proposal sections, missing CTA or opening hook, word-count bands,
readability (Fernández Huerta/Flesch family). Every violation ships
with an excerpt and a concrete fix; the draft must clear 85/100 before
delivery. Zero dependencies, fully offline — the loop runs the same on
small local models.

## MCP server

`server/main.mjs` (NDJSON JSON-RPC): `styles_list` (library with each
style's lint ruleset) and `style_lint` (draft + style + optional
subject → stats, violations with fixes, score, pass). No state, no
network.

Use current Core's native plugin MCP integration; do not register a duplicate
server to bypass the plugin sandbox. The linter is a style heuristic, not a
grammar, factual-accuracy or quality guarantee. Its readability number is an
approximation. Passing requires a score of at least 85 and zero error findings.
