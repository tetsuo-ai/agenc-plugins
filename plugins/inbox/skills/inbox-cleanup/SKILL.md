---
name: inbox-cleanup
description: Newsletter archaeology and the paper-radar document bridge. Kills-lists bulk senders by real volume with List-Unsubscribe evidence, and finds emails that ARE documents (renewals, policies, invoices) ready to feed paper-radar's ledger. Use for "too many newsletters", "unsubscribe", "clean my inbox", and for turning mailbox documents into tracked renewals.
when_to_use: The user wants to reduce email noise, asks about newsletters/subscriptions flooding them, wants to find renewal/policy/invoice emails, or wants mailbox documents tracked automatically.
argument-hint: [days]
---

# Cleanup — evidence over vibes

Two deterministic sweeps, zero guessing.

## Newsletter archaeology

1. Run `cleanup_scan` (default 90 days).
2. Present the kill-list as evidence: sender, message count, last date,
   one example subject. Rank by volume. Always state the number —
   "214 emails from 37 senders" lands harder than "you have
   newsletters".
3. For each sender the user wants gone: give them the unsubscribe route
   from the row (`mailto:` or URL). The plugin NEVER unsubscribes by
   itself — no fetches, no sends. When the row has no route, tell them
   it needs a manual email and offer to draft it for THEM to send.
4. After the user acts, `label_apply` can file those senders
   (radar/newsletters) so future digests skip them even faster.

## Document bridge (paper-radar feed)

1. Run `documents_scan` (default 30 days).
2. Rows carry `ingestText` purpose-built for paper-radar's
   `ingest_extract`. When paper-radar is installed: run its extract on
   the ingestText, follow ITS skill to confirm the entry, and offer
   `vault_fetch` first for PDF attachments (its ingest runs pdftotext).
   When it is NOT installed: still present the documents found — dates
   and senders are useful alone.
3. Events section: flights, bookings, appointments with extracted dates.
   Surface them as calendar candidates; the user decides what becomes a
   reminder.

## Boundaries

- No automated unsubscription, ever. Report + evidence + the user acts.
- Attachments download ONLY via explicit `vault_fetch` per file.
- The tools are deferred catalog entries: call your tool search
  (`system.searchTools`) with "inbox" before first use in a session.
