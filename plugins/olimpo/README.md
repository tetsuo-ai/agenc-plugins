# Olimpo

Offline olympiad-style practice with **16 original exercises**, four per topic:
algebra, geometry, number theory and combinatorics. Not an official IMO archive;
not affiliated with the IMO or AoPS.

Original Spanish statements, progressive hints, key ideas and worked solutions.
Stable IDs such as `olimpo-nt-004`; no invented contest years or attributions.
Native AgenC registration provides nine offline MCP tools: `problems_list`,
`problem_search`, `problem_get`, `problem_random`, `answer_check`, `study_plan`,
`progress_mark`, `progress_list`, `ingest`. Do not add a duplicate manual server.

## Accuracy and disclosure

Solutions were checked by derivation and deterministic tests. This AI-assisted
work is **not independently human-reviewed or formally verified**. Finite checks
supplement written proofs; they do not establish universal claims.
See [review coverage](corpus/REVIEW.md).

`problem_get` defaults to `statement`; other levels are `hint1`, `hints`,
`keyIdea`, `solution`. Answers and solutions appear only at the last level.
`answer_check` compares recorded text after conservative normalization.
A mismatch may just be formatting, not a mathematical error. A matching number
does not certify a proof. Problems with no short answer report not-applicable.

## User data

State lives in AgenC's plugin data directory. Writes are private and atomic;
linked files are rejected and damaged state is preserved for repair.
Crash locks require operator recovery after stopping plugin processes.

Ingest accepts 50 exercises per request and 500 total. IDs such as
`user-my-exercise` are supported; legacy `YYYY-N` IDs remain valid for private
imports without asserting an official attribution. Imports cannot replace
bundled exercises and always carry user-provided/unreviewed provenance.
Only import material you have rights to use; an import is not a license check.

## Provenance

The prior draft's 396 entries were removed with user approval because of
unverified copied text, truncation, false attributions and incorrect explanations.
Git history retains that draft; it is not a redistributable corpus.

The new wording and explanations were written for this project using standard
mathematics. [MIT](LICENSE) applies to the package; mathematical concepts are
not claimed as our property. See [sources](corpus/SOURCES.md).
