---
description: Read Ledger accounts and balances without signing
argument-hint: "[account-label]"
---

Follow the `ledger-status` skill and its read-only boundary. Find wallet-cli
with `ledger_wallet_cli_status`, then start with
`wallet-cli session view --output json`. Use the optional account label only
after confirming that it exists in that session. Read balances with
`wallet-cli balances --account <label> --output json` under the skill's
network permission: for that label only, or without a label for each account
in the session, one command per account. Never sign, broadcast, swap, stake,
encrypt, propose a payment, or reset the session.
