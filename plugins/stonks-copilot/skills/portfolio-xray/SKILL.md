---
name: portfolio-xray
description: Portfolio forensics for normal investors. Imports broker position exports, merges direct holdings with real ETF/mutual-fund constituents from SEC N-PORT filings, and reports effective exposure, hidden overlap, concentration, and fee drag. Use when the user asks what they actually own, about overlap, diversification, or concentration.
when_to_use: The user asks "how much X do I really own", "is my portfolio diversified", "do my funds overlap", pastes a positions CSV, or wants a portfolio review.
argument-hint: [positions CSV]
---

# Portfolio X-Ray — what you own, not what you bought

Trackers show positions. This shows exposure: the same stock bought four
times through different funds is one large bet, and that is the fact this
skill exists to surface.

## Tools

`portfolio_import`, `portfolio_get`, `xray`, `fund_holdings`,
`chart_treemap` from the stonks-copilot MCP server. Fund constituents
come from SEC N-PORT filings (quarterly, public, keyless) and are cached
for 90 days.

## Method

1. **Import.** If the user pasted positions (Schwab positions export, or
   any `symbol,quantity[,cost]` CSV), call `portfolio_import` with the
   raw text exactly as given. Never retype or "clean" their numbers; pass
   the text through. If nothing is stored and nothing is pasted, ask for
   a positions export — do not invent a portfolio.
2. **X-Ray.** Call `xray`. Read, in this order: `effectiveExposure`
   (top underlyings aggregated across stocks AND funds),
   `concentration` (HHI, top-10 weight, interpretation),
   `duplicatedViaFunds` (the same name stacked through multiple funds),
   `unresolvedFunds` (funds without N-PORT data — disclose),
   `estimatedAnnualFeeUsd`.
3. **Interpret like a person.** "You own 4.1% NVDA in total: 1.2%
   directly and the rest via VOO and QQQ" beats any table. Lead with the
   single most surprising aggregation.
4. **Treemap.** Offer `chart_treemap` and hand back the SVG path.
5. **Privacy.** Holdings stay in the plugin's local data directory.
   Nothing is uploaded anywhere; the only network calls are public
   market data.

## Output format

```
X-Ray — N positions, $<total>
Fund/stock split: <x%> funds / <y%> single stocks
Top effective exposures: 3-5 lines of "SYMBOL — z.z% (via ...)"
Concentration: HHI <h> (<interpretation>), top-10 <t>%
Hidden overlap: the most duplicated names, with the funds stacking them
Fee drag: ~$<f>/yr (when expense ratios were imported)
Gaps: unresolved funds, stale constituent data (quarterly filings)
Treemap: <path>
```

## Boundaries

- N-PORT data is quarterly; say "as of the latest filing" when fund
  internals matter to the conclusion.
- Never recommend specific buys/sells. Surface facts and let the user
  decide; suggest they weigh the concentration findings themselves.
- If the paste looks like someone else's account, stop and confirm.
