---
description: Decision journal: record an investment thesis with cited metrics, list theses or scan for breaks
argument-hint: "<add|list|scan> [symbol] [reasoning]"
---

Follow the `thesis-journal` skill and its boundaries.

- `add <symbol> <reasoning...>`: distill 2–5 predicates from the user's
  reasoning (confirm the metrics and thresholds with the user first), then
  `thesis_create`, then `thesis_scan` for the symbol to baseline it.
- `list`: `thesis_list` and summarize per the skill, highlighting
  anything broken.
- `scan [symbol]`: `thesis_scan` and report every broken predicate with
  cited-vs-current numbers and any unavailable checks. Ask whether the user
  wants to record new reasoning or leave the entry unchanged. The current tools
  cannot update or close an entry. Never recommend selling outright.

If the argument is missing or ambiguous, ask which action; do not pick
one silently.
