---
description: Portfolio forensics — effective exposure, fund overlap, concentration, fees, treemap
argument-hint: "[pasted positions CSV]"
---

Follow the `portfolio-xray` skill and its boundaries.

If the argument contains CSV-like rows, pass the raw text to
`portfolio_import` first and confirm the parsed position count to the
user before analyzing. If the argument is empty or says "use stored",
call `xray` directly against the stored portfolio; if nothing is stored,
ask for a positions export instead of guessing.

Then run `xray` and `chart_treemap`, and report in the skill's output
format. Lead with the single most surprising aggregation (a name the
user probably does not realize they are stacked on). Disclose unresolved
funds and the quarterly staleness of N-PORT constituents.
