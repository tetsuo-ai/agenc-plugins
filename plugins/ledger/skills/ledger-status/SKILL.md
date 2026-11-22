---
name: ledger-status
description: Read Ledger accounts, balances, history and staking positions, verify receive addresses on the device, and check device authenticity with Ledger's official wallet-cli (version 3). Use for read-only Ledger requests; never sign, send or broadcast.
allowed-tools: [Bash]
---

# Ledger status

Use Ledger's official `wallet-cli` from `@ledgerhq/wallet-cli`. This skill
targets wallet-cli 3.6. It is read-only: it never signs, broadcasts, swaps,
stakes, proposes payments, encrypts, or clears local state. Never ask for a
recovery phrase or a PIN. No legitimate flow needs either typed into the
computer.

## Find wallet-cli

Call the AgenC tool `ledger_wallet_cli_status` first. When it reports
`installed: true`, use its `executable` path for every command below, quoted
as one argument. The examples write `wallet-cli` for that path.

If the tool reports `installed: false`, tell the user that Ledger's official
wallet-cli is missing. Offer `install_ledger_wallet_cli`: AgenC shows its own
approval prompt and downloads nothing before the user approves it. Never
install it with npm, Bun, pnpm or yarn, never use `npx`, and never substitute
the unrelated `ledger`, `hledger` or `solana` binaries. If this session has no
`ledger_wallet_cli_status` tool, use `command -v wallet-cli` instead and stop if
it finds nothing.

Check the version before the first real command:

```bash
wallet-cli --version
```

It prints JSON when stdout is not a terminal, for example
`{"ok":true,"data":{"type":"version","name":"wallet-cli","version":"3.6.0"}}`.
If the version is older than 3.0.0, stop. Older releases use other network
names, a different session file, and other flags. Offer the approved update
through `install_ledger_wallet_cli`, or ask the user to update their own
install. Warn them that wallet-cli 3 rewrites its session file in place, so an
older install cannot read it afterwards. If a command or flag below is missing from
`wallet-cli <command> --help`, report the mismatch instead of guessing.

## Read results

Add `--output json` to every command and parse the last JSON line on stdout.

- Success carries `"status": "success"` and the command's fields.
- Failure carries `"ok": false` and `error.message`. Many failures also
  carry `error.code`, for example `disconnected`, and USB errors can add
  `error.usb_access_error` and `error.hint`.
- Exit codes: 0 success, 1 failure, 2 rejected on the device, 3 no Ledger
  detected, 4 wrong app open, 5 app not installed, 6 timeout or device locked.

wallet-cli accepts unknown flags without an error and drops them. Use only
the flags shown here or in `wallet-cli <command> --help`. Never guess a flag.

## Sandbox and approvals in AgenC

- `--version`, `--help` and `session view` read local files only. Run them in
  the default sandbox.
- `balances`, `operations`, `earn positions`, `assets token` and
  `assets token-by-id` read Ledger's online services. In the default sandbox
  they fail with `ENOTFOUND`. Run each one with
  `sandbox_permissions: "with_additional_permissions"`,
  `additional_permissions: {"network": {"enabled": true}}` and a one-line
  justification. Do not ask for a full sandbox bypass for these reads.
- `account discover`, `receive` and `genuine-check` talk to the Ledger over
  USB, and discovery also saves account labels in wallet-cli's state folder.
  They cannot work inside the sandbox: discovery there saves nothing and can
  stall on `Timed out waiting for a lock`. Say in one line that the command
  runs outside the sandbox, then run it with
  `sandbox_permissions: "require_escalated"` and a justification.

Run device commands one at a time; parallel runs corrupt the USB exchange.
Tell the user what the device will ask for, then let the command wait while
they act. If the shell tool returns a session id, keep polling it. Do not kill
a command that is waiting for the device.

## USB only

wallet-cli reaches a Ledger over USB only. It has no Bluetooth transport, so
a device that is connected only over Bluetooth cannot be reached. Say so and
stop. Do not try another wallet tool, a Bluetooth bridge, or a script that
talks to the device.

wallet-cli loads a `.env` file from its working directory, and that file can
point device commands at a Speculos emulator. Use an emulator only when the
user set it up. If an output mentions Speculos and the user did not ask for
it, stop and say so.

## Start with the local session

For a general Ledger request, run this before asking what to do:

```bash
wallet-cli session view --output json
```

The session holds account labels, not signing authority. Labels look like
`<network>[-derivation]-<n>`, for example `ethereum-1`, `bitcoin-native-1` or
`ethereum_sepolia-1`. Use a label exactly as listed. Do not invent a label or
assume a derivation path. If suitable accounts exist, do not rediscover them.

## Discover accounts only when needed

If the session has no suitable account and the user wants discovery, require
an explicit network id: `bitcoin`, `ethereum`, `solana`, `bitcoin_testnet`,
`ethereum_sepolia` or `solana_devnet`. Never infer a network from an address
and never pick mainnet by default. The old names such as `ethereum:sepolia`
fail on wallet-cli 3.

```bash
wallet-cli account discover --network <network> --output json
```

This is a device command. Ask the user to connect the Ledger by USB, unlock
it and approve opening the coin app. wallet-cli waits up to 60 seconds for the
device. If it reports `NOT saved to the session`, it ran inside the sandbox:
run it again outside the sandbox.

## Read balances, history and staking

Use only a label returned by `session view` or by discovery:

```bash
wallet-cli balances --account <label> --output json
wallet-cli operations --account <label> --limit 20 --output json
wallet-cli earn positions --account <label> --output json
```

These commands do not need the device. State the label and its network with
every result, and quote amounts as returned, for example `"0.5 ETH"`.

- `operations` returns `nextCursor` when more history exists. Fetch the next
  page with `--cursor <nextCursor>`. It is not supported on testnet accounts;
  report that instead of improvising another command.
- `earn positions` works for `ethereum` and `solana` accounts. On Solana its
  `stakes` array lists stake accounts with their `state`, `stakeBalance` and
  validator. A missing `stakes` key means the on-chain lookup failed: run it
  once more before saying that nothing is staked. A `(stale)` marker means the
  snapshot is old; `--fresh` asks for a refresh that appears on the next run.

To name a token the user mentions, resolve it read-only:

```bash
wallet-cli assets token <network> <contract-address> --output json
wallet-cli assets token-by-id <token-id> --output json
```

Report balances and history as facts. Do not give investment advice.

## Verify a receive address

For a mainnet account, run:

```bash
wallet-cli receive --account <label> --output json
```

This is a device command and follows the same USB and one-at-a-time rules.
Never pass `--no-verify`. While it waits, a `device-state` line reports what
the device needs, such as `awaiting_approval`. Ask the user to compare the
address in the terminal with the one on the Ledger's own screen before
sharing or using it. Treat an address as verified only when the user saw it on
that screen. If the addresses differ, or the device showed nothing, do not use
the address: stop, ask the user to disconnect the device, and run a genuine
check before retrying. Receiving on testnets is not supported by wallet-cli.

## Check device authenticity

Ask the user to unlock the Ledger and return to its dashboard with no coin app
open. Then run this device command outside the sandbox:

```bash
wallet-cli genuine-check --output json
```

It also needs network access. Exit code 4 means an app is still open: ask the
user to quit it and run the check again once. Do not loop automatically.
wallet-cli refuses this check on a Speculos emulator.

## Errors

- Exit 3 or `Ledger not detected`: the Ledger is not connected by USB, or it is
  off. Ask the user to connect and unlock it, then retry once.
- `No Ledger device found` with `usb_access_error`: the command ran inside the
  sandbox or another program holds the device. Run it outside the sandbox, and
  ask the user to close Ledger Live if it still fails.
- Exit 6: the device is locked or busy. Ask the user to unlock it, then retry.
- Exit 5: the coin app is not installed. The user installs it with Ledger Live.
- `Missing account` or `No account labeled`: use a label from `session view`.

## Read-only boundary

wallet-cli can also send, swap, stake and encrypt, and it can enroll agent
identities. This plugin deliberately does not expose any of that. If the user
asks to send, swap, stake or unstake, approve or propose a payment, reset the
session, or use Ledger Key Ring, explain the plugin's read-only scope and stop.
Never construct or run `wallet-cli send`, any `swap` command, `earn deposit`,
`earn withdraw`, `earn yields`, any `ring` command, any `agent-intent` command,
`session reset`, or any `skill` command (those manage skill files for other
agent tools). Never add `--dry-run` to reach a blocked command, and never edit
wallet-cli's session file by hand.
