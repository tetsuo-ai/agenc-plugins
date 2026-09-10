# Paper Radar

Privacy: this plugin's parser and storage are offline. A hosted chat provider
can still receive document text and tool results through the host agent; use
a local chat model for an entirely offline workflow. Treat extracted dates as
candidates, not legal determinations of cancellation rights.

The administrative memory: the plugin that remembers what expires, renews,
and auto-bills - extracted from the documents you already have, not from
typing dates into an app.

## The loop

- **Drop** - a contract, policy, invoice, warranty or ID: PDF (via
  `pdftotext` from poppler, same explicit-dependency pattern as the Ledger
  plugin's `wallet-cli`) or pasted text.
- **Extract** - deterministic Spanish/English parsers (`ingest_extract`)
  pull the candidates: renewal/expiry dates with relevance scoring, money
  amounts with per-period hints, periodicity, document kind, and - the
  fact that actually costs money - the cancellation-notice window.
- **Ledger** - strict validated local entries; `nextDue`,
  `noticeDeadline` and annualized cost are derived, never hand-computed.
- **Radar** - `radar` sorts everything by urgency: a row is `critical`
  when the notice window is already open, even if renewal is weeks away.
  "Cancel by Sep 4 or it renews Sep 30" is the unit of output.
- **Act** - deterministic cancellation drafts (email or letter, in English), recurring-cost reports with annualized framing
  (€9.99/mo shown as €120/yr), and `.ics` export with alarms at the
  notice deadline.

## Local models and privacy

Documents are the most private thing a person hands a tool, so the
architecture is model-minimal by construction: every parse happens inside
the tools (plain JS, zero dependencies), the model only ever sees compact
structured candidates with short snippets - never the document body - and
the error messages from strict validation are written so a small local
model can act on them directly. Radar, reports, drafts and calendar
export involve no model reasoning at all. The plugin makes **zero network
calls**: no telemetry, no lookups, nothing leaves the machine.

## MCP server

`server/main.mjs` is a zero-dependency stdio MCP server
(newline-delimited JSON-RPC 2.0). Tools: `ingest_extract`,
`ledger_upsert`, `ledger_list`, `ledger_remove`, `radar`, `cost_report`,
`cancel_draft`, `ics_export`. It resolves its data directory from
`AGENC_PLUGIN_DATA` (injected by the AgenC plugin sandbox) and falls back
to XDG data dirs when run standalone.

Core issue [tetsuo-ai/agenc-core#2078](https://github.com/tetsuo-ai/agenc-core/issues/2078):
plugin-declared stdio MCP servers currently spawn without `PATH`, so
until that ships, register the identical server as a user-level MCP
server (verified working):

```bash
agenc mcp add-json paper-ledger '{
  "command": "node",
  "args": ["<plugin-install-root>/server/main.mjs"],
  "transport": "stdio",
  "env_vars": ["PATH"]
}'
```

`<plugin-install-root>` is the path shown by `agenc plugin list`. Skills
and commands work unchanged either way.

## Requirements

- AgenC with the canonical `.agenc-plugin` plugin contract.
- `pdftotext` (poppler) for PDF ingestion; plain text needs nothing.
