---
description: Analyze a stock using technicals and SEC fundamentals, with a chart and data-quality warnings
argument-hint: "<symbol> [--weight 0-100]"
---

Follow the `stock-analyzer` skill and its boundaries.

The argument is the ticker (uppercase it). If `--weight N` is present,
pass `technicalWeight: N` to the `analyze` tool call; otherwise omit it
and let the default 50/50 apply.

Call `analyze`, then `chart_price` for the same symbol. Report exactly in
the skill's output format: available scores, supported reasons and risks,
support/resistance levels and the exact last close, change and date. After
the report, describe the price chart shown under the `chart_price` tool call.
Never draw charts with text characters. If EDGAR is unavailable,
say why, label the technical score as technical only, and omit the blended
score and verdict.
