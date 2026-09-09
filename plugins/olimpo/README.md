# Olimpo

The IMO corpus with guided solving — built to make a Qwen 27B/30B-class
local model genuinely good at olympiad math. The design insight: small
models fail at olympiads through **recall** (misremembering problems and
arithmetic), not through explanation. So the plugin moves the truth out
of the model:

- **Retrieval over recall** — 12 curated historic problems (1959-1, the
  legendary 1988-6 Vieta jumping, Erdős–Ginzburg–Ziv 1989-3, Sophie
  Germain 1969-1, Fekete 1982-1, fourth powers 1985-4, EGZ, 2000-2 with
  its gorgeous x/y substitution…) with statements, hint ladders, key
  ideas and solutions. The model never recites from memory; it
  retrieves and explains.
- **Progressive disclosure** — `problem_get` levels: `statement` →
  `hint1` → `hints` → `keyIdea` → `solution`. Solutions never leak into
  a context that only asked for a hint — small contexts stay small.
- **Honest solutions** — each entry carries `solutionType` full/sketch;
  sketches are labeled as sketches when presented.
- **Deterministic answer checking** — numeric answers verified by the
  tool, not by model arithmetic; proof-type problems say "not
  applicable" instead of pretending.
- **Study engine** — `study_plan` (deterministic, easy → hard),
  `problem_random`, a local progress ledger, and `ingest` to grow the
  corpus with your own problems (validated ids YYYY-N).
- **Technique lessons** — search by tag (`vieta-jumping`, `invariantes`,
  `sophie-germain`, `erdos-ginzburg-ziv`) and the family of problems
  assembles the lesson.

## MCP server

`server/main.mjs` (NDJSON JSON-RPC, zero-dep): `problems_list`,
`problem_search`, `problem_get`, `problem_random`, `answer_check`,
`study_plan`, `progress_mark`, `progress_list`, `ingest`. Fully offline.

Core issue [tetsuo-ai/agenc-core#2078](https://github.com/tetsuo-ai/agenc-core/issues/2078):
until it ships, register the identical server with the one-line
user-level `agenc mcp add-json` (`env_vars: ["PATH"]`). The skill and
`/olimpo` command work regardless.
