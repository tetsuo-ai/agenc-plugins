---
description: Recommend a local model that fits this machine's memory budget
argument-hint: "[category, e.g. coding]"
---

Follow the `local-model-fit` skill and its boundaries.

Start with `llm-checker hw-detect --json` so the memory budget is measured
rather than assumed, then `llm-checker recommend`, adding `-c <category>` when a
category was given. `recommend` has no `--json`; read its human report.

Report the pick as *needed of available* memory, and present the ranking as what
it is — a fit and suitability ranking, not a benchmark result. Do not attribute
scores to HumanEval, MMLU or any public leaderboard. Hand over the install
command; never pull a model or start a server.
