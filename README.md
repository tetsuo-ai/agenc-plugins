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

## Hosting it

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

## The one thing hosting needs

The hosted manifest names this repository as each plugin's source, so the
repo has to be reachable at the URL in `PLUGIN_REPO_URL` before anyone can
install from the deployment. Publish the repo first, deploy second.

## Verified

Against a real AgenC daemon (runtime 0.17.0):

- `plugin marketplace add` accepts the local checkout and the hosted URL
- `plugin marketplace catalog --product desktop --json` lists both plugins
- installing both puts their skills, commands and MCP files under
  `~/.agenc/plugins/`
- `mcp list --config-only --json` reports `plugin:iot-builder:iot-serial`
  sourced from `plugin:iot-builder@agenc`
