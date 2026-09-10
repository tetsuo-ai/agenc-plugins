---
name: paper-radar
description: The urgency sweep over the document ledger — what renews, expires, or must be cancelled soon, with notice-window status, recurring-cost totals, calendar export, and ready-to-send cancellation drafts. Use for "what's coming up", "what should I cancel", "cuánto gasto en suscripciones", or any renewal/deadline question.
when_to_use: The user asks what's due, renewing, or expiring; wants to cut recurring costs; wants a cancellation drafted; or wants the deadlines in their calendar.
argument-hint: [radar|cost|calendar|cancel]
---

# Paper radar — what's coming, what it costs, how to escape it

One `radar` call is the whole product: everything due within the horizon,
sorted, with the fact that changes decisions — whether the cancellation
window is already open.

## The sweep

The plugin's MCP tools are deferred entries in the tool catalog: call your tool search (`system.searchTools`) with "paper" or "radar" to surface them before first use in a session.

1. Call `radar` (default horizon 30 days).
2. Lead with `critical` rows, and inside each one lead with the notice
   window: "cancel by Sep 4 or it renews Sep 30 for another year" beats
   any table. A critical row with a closed notice window still deserves
   attention: flag "window closed — renewal will happen; plan for next
   year or call the counterparty".
3. `soon`/`upcoming` rows: one line each, grouped by urgency.
4. Empty radar: say so plainly and state the next due date from
   `ledger_list` so "empty" is still information.

## Cost conversation

`cost_report` gives monthly/annual totals by category. Use it when the
user mentions money, cutting costs, or "what am I even paying for".
Present the annualized number — €9.99/mo lands differently as €120/yr —
and the top-5 biggest. Suggest candidates to cancel (highest annual cost
+ lowest recent use is a question for the user, not for you) but never
cancel anything without an explicit instruction.
Keep totals grouped by currency; there is no exchange-rate conversion.

## Cancellation flow

When the user picks an entry:

1. `cancel_draft` with the entry id and the user's name (ask for the
   account/policy number if the ledger lacks it).
2. Show the draft. It is deterministic from ledger data — check the
   renewal date it cites against the radar row before showing.
3. The user sends it. You do not send anything: this plugin has no
   email integration by design.
4. After they confirm sending, set the entry to `status: "cancelled"`
   via `ledger_upsert` with the same id, so the radar goes quiet.

## Calendar

`ics_export` writes one .ics with every active entry (alarms at the
notice deadline when present). Give the user the file path — desktop
opens it directly into their calendar.

## Boundaries

- Never invent dates: everything comes from ledger entries and their
  derived fields. If an entry looks stale, ask the user for the current
  document and re-ingest instead of editing dates by hand.
- No financial or legal advice beyond the facts: state notice windows
  and costs, let the user decide.
