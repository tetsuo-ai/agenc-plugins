---
name: portfolio-xray
description: Portfolio forensics for normal investors. Imports broker position exports, merges direct holdings with real ETF/mutual-fund constituents from SEC N-PORT filings, and reports effective exposure, hidden overlap, concentration, and fee drag. Use when the user asks what they actually own, about overlap, diversification, or concentration.
when_to_use: The user asks "how much X do I really own", "is my portfolio diversified", "do my funds overlap", pastes a positions CSV, or wants a portfolio review.
argument-hint: [positions CSV]
---

# Portfolio X-Ray: positions and effective exposure

Trackers show positions. This shows exposure: the same stock bought four
times through different funds is one large bet, and that is the fact this
skill exists to surface.

## Tools

`portfolio_import`, `portfolio_get`, `xray`, `fund_holdings`,
`chart_treemap` from the stonks-copilot MCP server. Fund constituents
come from the latest available verified SEC N-PORT filings, not live fund
books. Read filing dates, coverage and search-scope warnings. Do not assume
a complete portfolio because a filing was found.

## Method

1. **Import.** If the user pasted positions (Schwab positions export, or
   any `symbol,quantity[,cost]` CSV), call `portfolio_import` with the
   raw text exactly as given. Never retype or "clean" their numbers; pass
   the text through. If nothing is stored and nothing is pasted, ask for
   a positions export. Do not invent a portfolio. Tell the user that importing
   replaces the saved positions before calling the import tool; confirm a
   replacement when it was not already explicitly requested.
2. **X-Ray.** Call `xray`. Read, in this order: `effectiveExposure`
   (top underlyings aggregated across stocks AND funds),
   `concentration` (HHI, top-10 weight, interpretation),
   `duplicatedViaFunds` (the same name stacked through multiple funds),
   `unresolvedFunds` (funds without verified look-through data),
   `estimatedAnnualFeeUsd`, `unpricedSymbols`, `valuationBasis`,
   `omittedExposureWeight`, `unresolvedWeight` and `feeCoverageWeight`.
   Missing prices mean a partial valuation, not zero-price positions. Never
   substitute share counts for market-value weights. Unknown fees are not zero.
3. **Interpret like a person.** "You own 4.1% NVDA in total: 1.2%
   directly and the rest via VOO and QQQ" beats any table. Lead with the
   single most surprising aggregation.
4. **Treemap.** Offer `chart_treemap`. After the report, include the exact
   returned absolute path as `![Portfolio exposure](<absolute path>)` outside
   code fences. A raw tool result alone does not create a Desktop media card.
5. **Privacy.** Holdings stay in the plugin's local data directory.
   The server sends ticker and filing requests to public data providers, not
   portfolio quantities, costs or journal text. Tool results still enter the
   host model's conversation and follow that provider's data policy.

## Output format

```
X-Ray: N positions, $<priced subtotal or complete total, clearly labeled>
Fund/stock split: <x%> funds / <y%> single stocks
Top effective exposures: up to 5 supported lines of "SYMBOL: z.z% (via ...)"
Concentration: HHI <h> (<interpretation>), top-10 <t>%
Hidden overlap: the most duplicated names, with the funds stacking them
Fee drag: ~$<f>/yr (when expense ratios were imported)
Gaps: unpriced positions, unresolved funds, unsupported derivatives, filing dates
```

Use ordinary prose rather than a fenced report. Place the chart Markdown after
it. Disclose coverage beside every concentration or overlap conclusion.

## Boundaries

- Say "as of the latest available filing" when fund
  internals matter to the conclusion.
- Never recommend specific buys/sells. Surface facts and let the user
  decide; suggest they weigh the concentration findings themselves.
- If the paste looks like someone else's account, stop and confirm.
