# AgenC Plugins

A plugin marketplace for AgenC Desktop: **IoT Builder** and **Ledger**, each
carrying a skill, a slash command and an MCP server.

## What is in here

```
marketplace.json          the manifest, plugin sources relative to this repo
plugins/iot-builder/      skill + /flash command + iot-serial MCP server
plugins/ledger/           skill + /ledger-balance command + agenc-market MCP
build-manifest.mjs        rewrites the manifest for hosting
vercel.json               static deploy: builds public/marketplace.json
```

## Installing it locally

Point AgenC at the checkout. Plugin sources are relative paths, so they
resolve against the repo:

```bash
agenc plugin marketplace add /path/to/agenc-plugins --name agenc
```

Then install from the app's Plugins pane, or:

```bash
agenc plugin marketplace install iot-builder@agenc --product desktop
```

## Live

The manifest is served from the existing `agenc-mainnet` droplet, as a static
file under the `agenc.tech` root:

    https://agenc.tech/plugins/marketplace.json

No nginx change and no DNS change: that vhost already serves static files
through `try_files`, so publishing is a copy into
`/var/www/agenc-tech/plugins/`. Nothing else on the droplet is touched.

```bash
node build-manifest.mjs
scp public/marketplace.json agenc-mainnet:/var/www/agenc-tech/plugins/marketplace.json
```

Add it with:

```bash
agenc plugin marketplace add https://agenc.tech/plugins/marketplace.json --name agenc-plugins
```

## Hosting it elsewhere

A marketplace added by URL downloads only the manifest, so a relative
`./plugins/ledger` has nothing to resolve against on the client. Each plugin
has to name a fetchable source of its own — which is why `build-manifest.mjs`
rewrites them to `git-subdir` entries pointing back at this repository.

Deploy to Vercel:

```bash
vercel deploy --prod
```

`vercel.json` runs the build and serves `public/marketplace.json` with CORS
and a five-minute cache. Users then add it with:

```bash
agenc plugin marketplace add https://<your-deployment>/marketplace.json --name agenc
```

Override the repo the manifest points at with `PLUGIN_REPO_URL` and
`PLUGIN_REPO_REF` at build time — a fork or a pinned tag both work.

For DigitalOcean App Platform the same repo works as a static site: build
command `node build-manifest.mjs`, output directory `public`.

## Signing (required once it is hosted)

AgenC requires a signature for any non-local source, so a marketplace served
over HTTPS or cloned from GitHub refuses to install unsigned plugins. A local
checkout does not, which is why this only shows up after publishing.

```bash
openssl genpkey -algorithm ed25519 -out ~/.agenc/keys/agenc-plugins.pem
openssl pkey -in ~/.agenc/keys/agenc-plugins.pem -pubout -out agenc-plugins.pub
node sign-plugins.mjs --key ~/.agenc/keys/agenc-plugins.pem --publisher tetsuo-ai
```

Commit the `.agenc-plugin/signature.json` files, never the private key.

Anyone installing has to trust the matching public key. In their
`~/.agenc/plugin-publishers.json`:

```json
{ "publishers": { "tetsuo-ai": "<contents of agenc-plugins.pub>" } }
```

That is the trust model: not "anyone can install", but "anyone who trusts
this key can install". Re-sign after any change to a skill, command or MCP
config — the signature covers every payload file.

## The one thing hosting needs

The hosted manifest names this repository as each plugin's source, so the
repo has to be reachable at the URL in `PLUGIN_REPO_URL` before anyone can
install from the deployment. Publish the repo first, deploy second.

## What a plugin manifest can carry

Core reads far more than a name and a description. The two plugins here use:

| field | why it matters |
|---|---|
| `interface.defaultPrompt` | the suggestion chips the app offers on a fresh session |
| `interface.brandColor`, `logo` | how the plugin reads in the Plugins pane |
| `interface.capabilities` | what it claims to do, in the user's language |
| `userConfig` | typed settings with `sensitive`, `min`/`max` and defaults — the right way to ask for a port or a key path instead of inventing one |
| `author`, `homepage`, `repository`, `license`, `keywords` | discovery and provenance |

`agenc plugin validate <path>` checks a plugin, and
`agenc plugin validate marketplace.json --marketplace` checks the index.

## Known gaps

- **No engine compatibility.** VS Code extensions pin a minimum host with
  `engines.vscode`; nothing here says which AgenC versions a plugin needs, so
  an old client installs a plugin it cannot run.
- **No update signal.** `marketplace upgrade` refreshes the index, but nothing
  tells a user their installed copy is behind.
- **Key distribution is manual.** Every user pastes the publisher key into
  their own keyring. A well-known location served beside the manifest would
  make that one step instead of two.

## Verified

Against a real AgenC daemon (runtime 0.17.0):

- `plugin marketplace add` accepts the local checkout and the hosted URL
- `plugin marketplace catalog --product desktop --json` lists both plugins
- installing both puts their skills, commands and MCP files under
  `~/.agenc/plugins/`
- `mcp list --config-only --json` reports `plugin:iot-builder:iot-serial`
  sourced from `plugin:iot-builder@agenc`
