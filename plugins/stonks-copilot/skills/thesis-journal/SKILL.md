---
name: thesis-journal
description: Investment decision journal with thesis-break surveillance. Records why the user bought something as quantified predicates over cited metrics (margins, growth, yields, price levels) and re-checks them against current data. Use when the user explains why they bought something, wants to log or review an investment decision, or asks if their reasons still hold.
when_to_use: The user says "I bought X because...", "log my reasoning", "does my thesis still hold", "why do I still own this", or asks for a portfolio decision review.
argument-hint: <add|list|scan> [symbol]
---

# Thesis journal — remember why, notice when it breaks

Every tool shows data. None of them remember the user's reasoning. This
skill keeps the reason alive: each thesis is stored with the metrics its
author actually cited, and a scan reports a break when one of those
metrics stops satisfying its predicate. Price moving is not a break; the
reason being false is.

## Tools

`thesis_create`, `thesis_list`, `thesis_scan`, `metrics_registry`,
`analyze`, `fundamentals`, `indicators` from the stonks-copilot MCP
server. Call `metrics_registry` once per session if unsure of the
supported metric names.

## Recording a thesis (`add`)

1. Take the user's reasoning **in their words**. Ask for the reason if
   they only give a symbol — the journal without a reason is useless.
2. Distill 2–5 predicates from THEIR stated reasons, not from generic
   wisdom. "I bought MSFT because Azure keeps growing" becomes
   `revenue_growth > 8`. "It's a margin story" becomes
   `net_margin > 30`. A price discipline becomes `price < 500`.
3. Confirm the distilled predicates with the user before storing. Show
   them as "I will watch: revenue_growth > 8, net_margin > 30". Adjust on
   objection; this is their journal.
4. Call `thesis_create` with symbol, the user's thesis text verbatim,
   horizon, exit conditions, and the confirmed predicates.
5. Run `thesis_scan` for the symbol once immediately to baseline every
   predicate as holds/broken from day one — and tell the user if the
   thesis is already broken at purchase. That happens more than anyone
   admits.

## Scanning (`scan`)

1. Call `thesis_scan` (optionally for one symbol).
2. For each broken predicate, state what was cited, what the value is
   now, and the change. "You cited net_margin > 30; it printed 26.4,
   down from 33.1 a year ago."
3. Do NOT tell the user to sell. Present the break and the magnitude;
   the decision is theirs. Ask what they want to do about it: update the
   thesis (new predicates), close the thesis, or leave it and accept the
   drift.
4. `unavailable` checks mean the data could not be fetched (non-US
   filer, network); say so rather than treating it as holds or broken.

## Listing (`list`)

Summarize each thesis: symbol, opened date, one-line reason excerpt,
predicate status from the last scan. Highlight every `broken` one.

## Boundaries

- Predicates use the supported registry only; if the user cites
  something unquantifiable ("great management"), keep it in the thesis
  text but add at least one measurable proxy predicate.
- Never edit or delete a stored thesis silently. Updating means a new
  confirmed exchange with the user.
- This is a memory of reasoning, not advice. A break is information.
