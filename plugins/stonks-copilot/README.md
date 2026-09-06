# Stonks Copilot

A local investment-research assistant. It analyzes public data, examines
portfolio exposure and records the user's reasons for an investment. It does
not place trades, connect to a broker or promise investment returns.

## Workflows

- **Analyze:** daily-price indicators and SEC filing fundamentals, with
  signal-level reasons and a 50/50 score when both are available. Missing data
  stays unavailable; a technical-only score is not a complete business analysis.
- **X-Ray:** import pasted positions CSV and examine direct and fund exposure.
  N-PORT look-through requires a verified fund series. Missing prices,
  unverified holdings and incomplete fee data remain explicit gaps.
- **Journal:** record a thesis with user-confirmed predicates, then request a
  scan to check those metrics. A scan can report holds, broken, partial or
  unavailable data. It is not automatic monitoring or a buy/sell instruction.

The /stock, /xray and /thesis commands invoke the corresponding skills. The
server provides 14 tools: ohlcv, indicators, fundamentals, analyze,
portfolio_import, portfolio_get, fund_holdings, xray, chart_price,
chart_treemap, thesis_create, thesis_list, thesis_scan and metrics_registry.

## Installation and Core compatibility

Install stonks-copilot@agenc-plugins through the signed AgenC marketplace.
Its manifest starts Node with server/main.mjs using Core's plugin MCP
transport. There is no npm install step or external MCP package to download.

The repository's validate:stonks-built check uses only compiled Core artifacts
in an isolated home. It verifies signed installation, discovery of all 14 tools,
public data and a chart. The separate validate:stonks-core check uses Core source
for its manager and is not proof of compatibility with a released Core build.
Current tested Core inherits PATH for stdio servers;
the manual user-level registration previously documented for Core issue
[#2078](https://github.com/tetsuo-ai/agenc-core/issues/2078) is not required.
Older Core builds should be updated rather than adding a duplicate server.

Public data requires operator-approved network access and a Core build that
preserves that approval in its plugin sandbox. Builds that always disable plugin
networking can start the server but cannot fetch prices or filings. Keep the
sandbox enabled; do not use an unrestricted duplicate server as a workaround.
Network access remains denied by default. Existing file permissions must remain
restricted to the plugin's own data directory after network approval.

## Sources and limitations

Daily bars use Yahoo Finance's chart endpoint with a Stooq CSV fallback. These
are public endpoints, not a guaranteed market-data feed. SEC EDGAR company
facts provide supported US-filing fundamentals. Fund holdings come from the
latest available verified N-PORT filing, not live fund books.

Read source dates, currency, period basis and warnings before comparing
metrics. A provider outage, rate limit, missing filing or unsupported symbol
must not be interpreted as a zero value. EDGAR may reject requests from some
hosts. Non-USD or unverified quote currencies are not silently treated as USD.
Portfolio totals can cover only priced positions, and look-through/fees can be
incomplete. Do not present partial totals as full-account valuations.

Fundamentals use annual 10-K periods, not TTM estimates. Free cash flow stays
unknown if capex is unavailable; the reported debt field covers long-term debt.
N-PORT lookup searches up to 20 recent filings and returns at most 400 holdings.
Its coverage fields identify omitted positions and unsupported derivatives.
Large portfolio and journal requests run sequentially and can take time; they
are not a real-time quote service.

Charts are local SVG artifacts with a text sparkline where applicable. Include
the actual returned absolute path in a Markdown image outside code fences;
current AgenC Desktop renders these files inline. A terminal can use the
sparkline and file path. Never fabricate a chart path.

## Privacy and storage

The server uses AGENC_PLUGIN_DATA, provided by Core, or a standalone local data
directory. It stores imported positions, journal entries, public-data caches
and chart files there. Importing positions replaces the saved portfolio;
confirm the parsed positions before using them in a report.

The server sends ticker/filing requests to public data providers. It does not
send portfolio quantities, costs or journal text to those endpoints. The host
model can receive tool results as part of the conversation, so its provider's
data policy still applies. Never paste broker passwords, API secrets or
unnecessary account identifiers.

This is informational research, not personalized investment advice. Confirm
material figures against the cited provider or filing before acting.
