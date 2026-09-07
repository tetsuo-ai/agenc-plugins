# Inbox — the Gmail copilot

Connects Gmail through your **own** Google Cloud OAuth client (Desktop
type) with a local loopback redirect: the consent happens in your
browser, Google redirects to `localhost` on your machine, and the tokens
live only in the plugin data directory. No third-party cloud sees your
mail, ever. Read-only scopes plus label triage — the plugin never sends,
never deletes, never unsubscribes for you.

## The layers no email reader reads

- **Digest by relationship** — a local sender-trust graph built from your
  own exchange history (bidirectional volume, replies, recency; bulk
  detection from List-Unsubscribe and sender patterns) ranks unread mail:
  humans first, security/transactional alerts when they matter,
  newsletters never. Every row carries its deterministic reasons
  ("frequent contact", "asks a question", "mentions Sep 30").
- **Loops** — the commitments living in your mail: waiting-on threads
  (you asked, they went silent) with aging; reply debt (humans awaiting
  your answer); your outbound promises paired with detected dates
  ("te envío el informe antes del viernes"), as candidates you confirm.
- **Attachment vault** — explicit per-file downloads, content-hashed and
  indexed by sender/date/name: "the PDF María sent in March" is one
  `vault_search`.
- **Newsletter archaeology** — per-sender volume with List-Unsubscribe
  evidence into an evidence-backed kill-list. The plugin reports; you
  unsubscribe.
- **paper-radar bridge** — renewal notices, policies and invoices found
  in mail become `ingestText` purpose-built for paper-radar's
  `ingest_extract`, with PDF attachments fetched into the vault for its
  pdftotext flow. The administrative memory feeds itself.

## Setup (one time, your own credentials)

1. Google Cloud console → new or existing project → enable the **Gmail
   API**.
2. APIs & Services → Credentials → Create credentials → OAuth client ID
   → application type **Desktop** → copy clientId and clientSecret.
3. In the agent: `/inbox setup`, which stores them via the plugin and
   opens the consent flow.
4. Keep the Google Cloud app in Testing mode with yourself as test user.
   Honest limitation: Google expires Testing-mode refresh tokens weekly,
   so the consent is one click per week. Publishing the app unverified
   removes that but shows a Google warning.

## MCP server

`server/main.mjs` — zero-dependency stdio MCP server (NDJSON JSON-RPC).
Tools: `auth_store_credentials`, `auth_begin`, `auth_status`,
`auth_disconnect`, `digest`, `search`, `read`, `loops_scan`,
`graph_stats`, `cleanup_scan`, `documents_scan`, `vault_fetch`,
`vault_search`, `label_apply`. API endpoints honor `INBOX_API_BASE` so
the entire flow (OAuth included) runs offline against a local mock —
that is how it is tested.

Core issue [tetsuo-ai/agenc-core#2078](https://github.com/tetsuo-ai/agenc-core/issues/2078):
plugin-declared stdio MCP servers spawn without `PATH` until it ships;
register the identical server as a user-level MCP server meanwhile:

```bash
agenc mcp add-json inbox-gmail '{
  "command": "node",
  "args": ["<plugin-install-root>/server/main.mjs"],
  "transport": "stdio",
  "env_vars": ["PATH"]
}'
```
