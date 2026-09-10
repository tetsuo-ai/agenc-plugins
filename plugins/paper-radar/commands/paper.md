---
description: Document radar — ingest a document, see what's due, draft a cancellation, or export deadlines to calendar
argument-hint: "<radar|ingest|ledger|cost|calendar|cancel> [target]"
---

Follow the `paper-ingest` and `paper-radar` skills and their boundaries.

- `radar [days]`: run `radar` (horizon = the number if given, else 30) and
  report per the radar skill — critical rows first, notice windows stated
  as deadlines.
- `ingest <path|pasted text>`: follow the ingest skill — preflight
  `pdftotext` for PDFs, `ingest_extract`, confirm only real ambiguities,
  `ledger_upsert`, then report the entry id, renewal date, notice
  deadline, and cost.
- `ledger [category]`: `ledger_list` and summarize one line per entry
  with nextDue and notice deadline.
- `cost`: `cost_report` — monthly and annual totals by category, top-5
  biggest, annualized framing.
- `calendar`: `ics_export` and hand back the .ics path.
- `cancel <id>`: the cancellation flow from the radar skill — ask for the
  holder name if unknown, `cancel_draft`, show the draft, and only mark
  `cancelled` after the user confirms they sent it.

With no argument, run `radar`.
