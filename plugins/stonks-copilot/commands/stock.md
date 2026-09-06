---
description: Analyze a stock using technicals and SEC fundamentals, with a chart and data-quality warnings
argument-hint: "<symbol> [--weight 0-100]"
---

Follow the `stock-analyzer` skill and its boundaries.

The argument is the ticker (uppercase it). If `--weight N` is present,
pass `technicalWeight: N` to the `analyze` tool call; otherwise omit it
and let the default 50/50 apply.

Call `analyze`, then `chart_price` for the same symbol. Report exactly in
the skill's output format: scores, three reasons, two risks,
support/resistance levels and the inline sparkline. Put the actual returned
absolute chart path in Markdown image syntax outside the report and code fences.
If EDGAR returns nothing for the symbol, say so plainly and give the
technical-only view.
