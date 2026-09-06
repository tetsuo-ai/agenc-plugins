---
name: thesis-journal
description: Investment decision journal with thesis-break surveillance. Records why the user bought something as quantified predicates over cited metrics (margins, growth, yields, price levels) and re-checks them against current data. Use when the user explains why they bought something, wants to log or review an investment decision, or asks if their reasons still hold.
when_to_use: The user says "I bought X because...", "log my reasoning", "does my thesis still hold", "why do I still own this", or asks for a portfolio decision review.
argument-hint: <add|list|scan> [symbol]
---

# Thesis journal: record reasons and check cited metrics

Each thesis is stored with the metrics its author actually cited. A requested
scan checks whether those metrics still satisfy their predicates. It does not
run automatically, monitor in the background or send unsolicited alerts.

## Tools

`thesis_create`, `thesis_list`, `thesis_scan`, `metrics_registry`,
`analyze`, `fundamentals`, `indicators` from the stonks-copilot MCP
server. Call `metrics_registry` once per session if unsure of the
supported metric names.

## Recording a thesis (`add`)

1. Take the user's reasoning **in their words**. Ask for the reason if
   they only give a symbol. Do not invent an investment rationale.
2. Propose predicates supported by the registry from THEIR stated reasons.
   Do not invent thresholds or substitute a different metric. Azure segment
   growth is not the registry's company-wide `revenue_growth`; explain that
   gap and ask whether the user wants a supported proxy. `net_margin > 30`
   and `price < 500` are examples only, not default investment conditions.
3. Confirm the distilled predicates with the user before storing. Show
   them as "I will watch: revenue_growth > 8, net_margin > 30". Adjust on
   objection; this is their journal.
4. Call `thesis_create` with symbol, the user's thesis text verbatim,
   horizon, exit conditions, and the confirmed predicates.
5. Run `thesis_scan` for the symbol once immediately to baseline every
   predicate as holds, broken or unavailable from day one. Disclose partial
   results; missing data does not prove the thesis holds. A baseline reflects
   the tool's stated data dates, not necessarily the purchase date.

## Scanning (`scan`)

1. Call `thesis_scan` (optionally for one symbol).
2. For each broken predicate, state the user-confirmed threshold and the
   returned value with its source period. State a historical change only if
   the tool returned comparable historical figures. Do not invent a previous
   value, purchase-time measurement or trend.
3. Do NOT tell the user to sell. Present the break and the magnitude;
   the decision is theirs. Ask what they want to do about it: update the
   reasoning or leave the thesis unchanged. The current tools do not update,
   close or delete a thesis; do not claim those actions were performed. A new
   entry requires the user's confirmation and does not replace the old one.
4. `unavailable` checks mean the data could not be fetched (non-US
   filer, network); say so rather than treating it as holds or broken. A
   partially measured thesis is not a fully verified hold.

## Listing (`list`)

Summarize each thesis: symbol, opened date, one-line reason excerpt,
predicate status from the last scan. Highlight every `broken` one.

## Boundaries

- Predicates use the supported registry only. If the reason is unquantifiable
  ("great management"), explain that this tool needs at least one measurable,
  user-confirmed condition before it can create a checkable entry. Never add
  a proxy or threshold without the user's agreement.
- Never edit or delete a stored thesis silently. Updating means a new
  confirmed exchange with the user.
- This is a memory of reasoning, not advice. A break is information.
