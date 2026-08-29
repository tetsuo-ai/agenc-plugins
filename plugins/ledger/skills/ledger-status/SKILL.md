---
name: ledger-status
description: Read Ledger accounts, balances and history, verify receive addresses on the device, and check device authenticity with the official wallet-cli. Use for read-only Ledger requests; never sign or broadcast.
allowed-tools: [Bash]
---

# Ledger status

Use the globally installed `wallet-cli` binary from `@ledgerhq/wallet-cli`.
This skill is intentionally read-only: it never signs, broadcasts, swaps,
stakes, encrypts, or destroys local state. Never ask for a recovery phrase;
no legitimate flow needs one typed into the computer.

## Preflight

```bash
command -v wallet-cli
```

If the binary is absent, stop and tell the user to install
`@ledgerhq/wallet-cli` globally with their preferred package manager. Do not
install it automatically and do not substitute `npx` or another wallet tool.

## Start with the local session

For a generic Ledger request, run this immediately before asking what to do:

```bash
wallet-cli session view
```

The session contains account labels, not signing authority. Use a label shown
by this command, such as `ethereum-1`, for later reads. Do not invent a label or
assume a derivation path. If accounts already exist, do not rediscover them.

## Discover accounts only when needed

If the session has no suitable account and the user wants discovery, require
an explicit network. Supported values are `bitcoin`, `ethereum`, `solana`,
`bitcoin:testnet`, `ethereum:sepolia`, and `solana:devnet`. Never infer a
network from an address or choose mainnet by default.

```bash
wallet-cli account discover <network>
```

This command accesses the Ledger over USB. Tell the user what will happen,
request the host's explicit USB or sandbox bypass, then let the command finish
while the user unlocks the device and follows its prompts. Never run it in
parallel with another device command, impose a timeout, or kill it because the
device is waiting for interaction.

## Read balances and history

Use only an account label returned by `session view` or discovery:

```bash
wallet-cli balances <account-label>
wallet-cli operations <account-label>
```

These commands do not need the device. State the account label and its network
with every result. `operations` is unsupported for testnet accounts; report
that limitation instead of improvising another command.

## Verify a receive address

For a mainnet account, run:

```bash
wallet-cli receive <account-label>
```

This is a device command and follows the same USB, serialization, and no-timeout
rules as discovery. Never pass `--no-verify`. Ask the user to compare the
terminal address with the trusted Ledger display before sharing or using it.
If they differ, do not use the address: stop, ask the user to disconnect the
device, and perform a genuine check before retrying. Receiving on testnets is
not supported by wallet-cli.

## Check device authenticity

Ask the user to unlock the Ledger and return to its dashboard, with no currency
app open, then run this as a serialized USB device command:

```bash
wallet-cli genuine-check
```

It also needs network access. If it exits because an app is open, ask the user
to return to the dashboard and rerun it; do not loop automatically.

## Read-only boundary

The underlying CLI supports sending and other state-changing operations, but
this plugin deliberately does not expose them. If asked to send, swap, stake,
reset a session, or use Ledger Key Ring commands, explain the plugin's
read-only scope and stop. Never construct or run `wallet-cli send`, `swap
execute`, `earn deposit`, `earn withdraw`, `session reset`, or `ring` commands.
