# AgenC Plugins

The first-party plugin marketplace for AgenC. It contains eight packages:

- **Zero Day Hunter** — a security-research campaign skill.
- **IoT Builder** — a guarded PlatformIO build/upload workflow.
- **Ledger** — read-only wallet inspection with Ledger's official `wallet-cli`.
- **LLM Checker** — hardware-measured local-model recommendations.
- **Stonks Copilot** — agent-native investing copilot: 50/50 stock analysis,
  portfolio X-Ray with real N-PORT fund overlap, SVG charts, and a decision
  journal that flags when your stated thesis breaks.
- **Inbox** — the Gmail copilot: your own OAuth client and a loopback redirect
  (no third-party cloud), a relationship-ranked digest from a local trust
  graph, the social commitments layer, an attachment vault, newsletter
  archaeology, and a document bridge that feeds Paper Radar from your mailbox.
  Read-only: never sends, never deletes.
- **Paper Radar** — the administrative memory: deterministic Spanish/English
  extraction of renewal dates, costs and cancellation windows from your own
  documents, a local urgency radar, cancellation drafts, and calendar export.
  Fully offline, built to work efficiently with local models.
- **Pluma** — writing styles with a deterministic verifier: ten output
  styles (voices and full forms) plus a prose linter that checks register,
  structure, length and readability before anything is delivered.

## Plugin, skill, and MCP

They are different layers:

```text
plugin package
├── .agenc-plugin/plugin.json   identity and declared capabilities
├── skills/                     agent instructions and operating method
├── commands/                   user-invocable prompt commands
├── scripts/, templates/        signed package resources
└── mcpServers                  optional external tool servers
```

A skill is instructions for the agent. An MCP server is an optional process or
remote endpoint that contributes tools. A plugin is the signed package that can
contain either or both. Zero Day Hunter, IoT Builder, Ledger, and LLM Checker
intentionally ship without MCP servers: their previous MCP declarations were
broader than their real capabilities. Ledger calls `wallet-cli` through its
skill, IoT calls PlatformIO, and Zero Day uses its signed scripts and
references. Stonks Copilot is the first package whose tool surface genuinely
warrants an MCP server: it ships a zero-dependency stdio server
(`server/main.mjs`) whose tools cover market data, portfolio forensics, the
thesis journal, and chart rendering over keyless public endpoints.

## Requirements

- A current AgenC build using the canonical `.agenc-plugin/` contract.
- Node.js 22 or newer for repository validation and catalog builds.
- Stonks client requirements: [publisher-key overlap](https://github.com/tetsuo-ai/agenc-core/pull/2214)
  and [approved plugin networking](https://github.com/tetsuo-ai/agenc-core/pull/2213).
  These determine whether an installed client can verify and run Stonks;
  publishing the catalog does not update that client's runtime or trust.
- Ledger plugin: globally installed `@ledgerhq/wallet-cli` (`wallet-cli` 2.1+
  recommended). The plugin never installs or downloads it automatically.
- IoT plugin: an existing `platformio.ini` and a locally installed `pio`.

## Install from a local checkout

```bash
agenc plugin marketplace add /path/to/agenc-plugins --name agenc-plugins
```

Open `/plugins` inside AgenC, choose `agenc-plugins`, and install a package.
Core does not currently expose `marketplace catalog` or `marketplace install`
as CLI commands.

## Install from agenc.tech

Remote plugins are signed by `tetsuo-ai`. Before trusting the publisher, fetch
the proposed keyring and verify the DER-SPKI key fingerprint through a trusted
channel:

```bash
curl -fsS https://agenc.tech/plugins/plugin-publishers.json -o /tmp/agenc-plugin-publishers.json
jq -r '.publishers["tetsuo-ai"].publicKey' /tmp/agenc-plugin-publishers.json \
  | base64 -d | sha256sum
```

Legacy SHA-256 (retained for already-published plugins):

```text
8174e96296289bd8eed26b832296309015216afe544a7f15097356b10aa1b932
```

September 2026 signing key, `agenc-plugins-2026-09.pub`:

```text
d3cd019ab546d8512619fabc80cb4b363c66d1a70bfa25a35bbef5aacf3836c3
```

The keyring keeps the legacy `publicKey` and adds both keys in `publicKeys`.
Rollover-capable Core verifies either key; older Core ignores the new list and
continues verifying the four unchanged legacy plugins. Stonks now requires the
new key. Upgrade Core before installing it, and independently verify both
fingerprints before updating an explicit local publisher entry. An explicit
old-only pin is never silently overridden by the new built-in root. Publishing
the hosted keyring does not automatically update client trust.

Merge the `tetsuo-ai` entry into `$AGENC_HOME/plugin-publishers.json` (normally
`~/.agenc/plugin-publishers.json`) without replacing other trusted publishers.
The value must be DER-SPKI encoded as Base64; do not paste the PEM headers from
`agenc-plugins.pub` into the JSON.

Then register the marketplace:

```bash
agenc plugin marketplace add \
  https://agenc.tech/plugins/marketplace.json \
  --name agenc-plugins
```

Use `/plugins` to browse and install.

## Zero Day Hunter and the built-in copy

Current Core builds already bundle `zeroday-hunter@builtin`. The marketplace
copy is opt-in and has a separate ID, `zeroday-hunter@agenc-plugins`. Until Core
gains a `replaces`/`conflicts` contract, avoid enabling both copies. To use the
marketplace package, disable the built-in explicitly in `config.toml`:

```toml
[plugins.plugins."zeroday-hunter@builtin"]
enabled = false
```

The marketplace copy is vendored from the Core revision recorded in
`plugins/zeroday-hunter/UPSTREAM.json`; its scripts, templates, methodology, and
references are part of the signed payload.

## Repository layout

```text
.agenc-plugin/marketplace.json        local source-of-truth catalog
plugins/zeroday-hunter/               skill + scripts + templates
plugins/iot-builder/                  skill + /flash prompt command
plugins/ledger/                       skill + /ledger-balance prompt command
plugin-signing.mjs                    shared Core-compatible payload logic
sign-plugins.mjs                      Ed25519 release signer
build-manifest.mjs                    SHA-pinned hosted catalog builder
validate.mjs                          repository and signature checks
validate-core.mjs                     isolated real-Core smoke test
```

Generated files under `public/` are intentionally ignored. A hosted build
rewrites local plugin paths to `git-subdir` sources pinned to the full Git commit
SHA, and emits both `/marketplace.json` and
`/.agenc-plugin/marketplace.json` with identical bytes.

Plugin distribution uses the existing static server at `agenc.tech/plugins`.
Deploy only the generated catalog and public publisher keys; clients download
the signed plugin files, including their logos, from the pinned GitHub commit.
This repository is private to npm (`"private": true`): catalog deployment does
not require an npm publication, a Core/Desktop binary release, or an Apple
distribution certificate. Never upload the private signing key. Validate the
catalog against compatible Core before deployment, preserve the legacy plugins
and signing key, and keep a rollback copy of the previous hosted artifacts.

## Validate

```bash
npm ci
npm test
```

To validate against a current Core checkout:

```bash
AGENC_BIN='/path/to/agenc-core/runtime/bin/agenc' npm run validate:core
```

Exercise the new plugins through compiled Core's actual native MCP sandbox:

```bash
AGENC_CORE_RUNTIME='/path/to/agenc-core/runtime' npm run validate:built
```

This uses disposable storage, verifies package signatures, and retains default
network denial. Inbox OAuth/Gmail flows are tested with synthetic credentials
against a loopback fixture by `npm test`; real accounts still require user consent.

That test uses a temporary `AGENC_HOME`, validates the catalog and all five
plugins, registers the local marketplace, installs each package, and checks the
resulting inventory. It does not modify the operator's AgenC configuration.

Stonks has a focused offline regression suite and an isolated native MCP check:

```bash
npm run test:stonks
AGENC_CORE_RUNTIME='/path/to/agenc-core/runtime' npm run validate:stonks-core
```

The Core check installs the plugin into disposable storage with the built CLI,
then exercises the source-native MCP manager: initialization, all 14 tools and
a keyless metrics-registry call. It does not start or restart the operator's
daemon. This integration check does not replace release-signature verification.

For release compatibility, `npm run validate:stonks-built` uses only compiled
Core artifacts and checks a public-data call and chart under the native sandbox.
The release must preserve default-denied networking and respect an explicit
operator network grant without broadening filesystem permissions. A source-only
or unrestricted-sandbox smoke test does not satisfy this release check.

Visual checks render the actual logo, Desktop card and chart in a separate
offscreen Electron process with a temporary profile and HTTP(S) blocked:

```bash
AGENC_DESKTOP_ROOT='/path/to/agenc-desktop' \
STONKS_VISUAL_OUTPUT_ROOT='/path/to/review-output' npm run validate:stonks-visuals
```

The chart fixture is synthetic, not a live market quote. These opt-in checks
require the indicated existing development dependencies; they install none.

CI also generates a catalog pinned to the commit under test, downloads every
`git-subdir` source from GitHub, and installs it through current Core with
signature verification required. This catches a valid-looking catalog that
points to a commit without the advertised plugin payload.

## Sign a release

Normal releases reuse the existing publisher key. The private key must remain
outside the repository; `*.pem` and `*.key` are ignored as an additional guard.

```bash
node sign-plugins.mjs \
  --key ~/.agenc/keys/agenc-plugins.pem \
  --publisher tetsuo-ai \
  --plugin stonks-copilot
npm test
```

The signer refuses a private key that does not match either checked-in public
key. Select a single plugin with `--plugin`; omit it only when deliberately
re-signing the whole catalog. The September rollover signs Stonks only, leaving
the four existing signatures and legacy public key unchanged.
Each signature covers the canonical plugin manifest plus the exact set of all
other payload files. CI verifies the declared file map, publisher, and Ed25519
signature; a missing public key is a hard failure.

Generate a new Ed25519 key only when bootstrapping a new publisher or carrying
out an explicit key rotation. Keep the key directory private (0700), the private
PEM owner-only (0600), and an operator-controlled backup outside Git. Never add
the private key to CI artifacts, chat, logs, or the hosted catalog. A rotation
also requires distributing the new trusted keyring and fingerprint through an
independent trusted channel; replacing `agenc-plugins.pub` would break existing
clients. Keep the legacy key throughout the compatibility window.

## Publish

Vercel and DigitalOcean builds run `npm run build`, which pins every plugin
source to the commit being deployed. The existing droplet can be updated from a
clean, pushed `main` checkout:

```bash
./deploy-droplet.sh
```

The deployment script refuses dirty or unpublished trees, stages every artifact,
moves each file atomically, and compares the live marketplace hash with the
local build.

Licensed under the MIT License. See `LICENSE`.
