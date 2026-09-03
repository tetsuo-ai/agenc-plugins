# Stonks Copilot

An agent-native investing copilot for people who buy stonks and hold them —
not a trading terminal. Three integrated loops over keyless public data
(Stooq, SEC EDGAR), cached locally:

- **Analyze (50/50)** — `analyze` blends a technical score computed locally
  from daily OHLCV (SMA trend regime, golden/death cross, RSI14, MACD
  histogram, Bollinger %B, 52-week drawdown, volume, clustered
  support/resistance zones) with a fundamental score from SEC EDGAR XBRL
  10-K facts (revenue/margin/EPS/FCF trends, liquidity, P/E, P/S, FCF and
  dividend yields). Signal-level reasons, not a black box.
- **X-Ray** — `portfolio_import` accepts a pasted positions export (Schwab
  or generic `symbol,quantity[,cost]`). `xray` merges direct holdings with
  real fund constituents from N-PORT filings — quarterly, public, keyless —
  into effective exposure, hidden overlap, concentration (HHI, top-10) and
  fee drag. `fund_holdings` exposes any fund's latest N-PORT book.
- **Journal** — `thesis_create` stores the reason a position was taken plus
  quantified predicates over the metrics its author cited
  (`net_margin > 30`, `revenue_growth > 8`, `price < 500`).
  `thesis_scan` re-evaluates those predicates against current data and
  reports a **thesis break** when the stated reason stops being true —
  independent of what price is doing.

Charts are standalone SVG artifacts written to the plugin data directory
(price + SMAs + volume, portfolio treemap) plus inline unicode sparklines
for terminals.

## Data sources

Daily bars come from Yahoo Finance's keyless v8 chart endpoint with Stooq's
CSV as automatic fallback; fundamentals and fund holdings come from SEC
EDGAR (XBRL company facts, N-PORT filings). EDGAR enforces rate limits and
blocks many datacenter IP ranges — from cloud hosts the fundamentals tools
report the gap honestly instead of guessing. Everything is cached locally
(bars 12h, fundamentals 24h, N-PORT 90d).

## Using the MCP server today

Core issue [tetsuo-ai/agenc-core#2078](https://github.com/tetsuo-ai/agenc-core/issues/2078):
plugin-declared stdio MCP servers currently spawn without `PATH`, so the
`stonks-data` server cannot start from the plugin manifest alone. Until
that ships, register the same server as a user-level MCP server (one
command, verified working):

```bash
agenc mcp add-json stonks-data '{
  "command": "node",
  "args": ["<plugin-install-root>/server/main.mjs"],
  "transport": "stdio",
  "env_vars": ["PATH"]
}'
```

`<plugin-install-root>` is the path shown by `agenc plugin list`. The
skills and commands work unchanged either way.

## Boundaries

Strictly read-only and local-first: no order placement, no broker
credentials, no uploads. Market data comes from public endpoints cached in
the plugin data directory (bars 12h, fundamentals 24h, N-PORT 90d).
Nothing here is investment advice; the skills' own text says so too.

## MCP server

`server/main.mjs` is a zero-dependency stdio MCP server (newline-delimited
JSON-RPC 2.0). Tools: `ohlcv`, `indicators`, `fundamentals`, `analyze`,
`portfolio_import`, `portfolio_get`, `fund_holdings`, `xray`,
`chart_price`, `chart_treemap`, `thesis_create`, `thesis_list`,
`thesis_scan`, `metrics_registry`. It resolves its data directory from
`AGENC_PLUGIN_DATA` (injected by the AgenC plugin sandbox) and falls back
to XDG data dirs when run standalone.

Non-US tickers: price data via Stooq symbol suffixes works for many
exchanges, but fundamentals are EDGAR-only (SEC filers). The tools report
the gap rather than guessing.
