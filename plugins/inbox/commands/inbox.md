---
description: Gmail copilot — relationship-ranked digest, open loops, document bridge and newsletter cleanup
argument-hint: "<digest|loops|cleanup|documents|search <q>|setup> [args]"
---

Follow the `inbox-digest`, `inbox-loops`, and `inbox-cleanup` skills and
their boundaries. Check `auth_status` first; if not connected, run the
setup walkthrough from the digest skill before anything else.

- no argument or `digest [days]`: run `digest` and report top rows with
  their reasons; offer `read`/`vault_fetch` follow-ups.
- `loops [days]`: run `loops_scan`; waiting-on oldest-first with the ask,
  reply debt framed as people, commitment candidates for confirmation.
- `cleanup [days]`: run `cleanup_scan`; present the kill-list with
  evidence and unsubscribe routes; never act on the user's behalf.
- `documents [days]`: run `documents_scan`; when paper-radar is
  installed, feed `ingestText` through its ingest skill and offer
  `vault_fetch` for PDFs first.
- `search <gmail query>`: pass the query to `search` untouched and
  summarize the matches.
- `setup`: the auth walkthrough from the digest skill.
