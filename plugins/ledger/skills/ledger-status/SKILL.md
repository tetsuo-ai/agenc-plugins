---
name: ledger-status
description: Read a Ledger device's connection, accounts and balances without signing anything. Use when the user asks about their Ledger, hardware wallet accounts, addresses or balances.
---

# Ledger status

Readonly. This skill never signs, never broadcasts, and never asks for a
recovery phrase — no legitimate flow ever needs one typed anywhere.

## 1. Is the device reachable

```bash
agenc-marketplace --network mainnet --json ledger status
```

A locked device answers as locked. Say that plainly rather than retrying: the
human has to unlock it and open the app themselves.

## 2. Accounts

Never assume a derivation path. Ask the device:

```bash
agenc-marketplace --network mainnet --json ledger accounts --scan
```

Report the exact key path beside each address. A path repeated from memory is
how someone ends up watching the wrong account.

## 3. Balances

```bash
agenc-marketplace --network mainnet --json ledger balance --key <PATH>
```

State the network with the number. A mainnet balance and a devnet balance
look identical on screen and are not the same money.

## Never

Sending, swapping, or any transfer of value belongs to the human, on the
device, approving the exact recipient and amount shown on its screen. If
asked to move funds, explain that and stop.
