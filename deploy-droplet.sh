#!/bin/sh
# Build and atomically publish the marketplace artifacts to agenc.tech.
set -eu

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to deploy a dirty worktree" >&2
  exit 1
fi

git fetch origin main
head_sha=$(git rev-parse HEAD)
origin_sha=$(git rev-parse origin/main)
if [ "$head_sha" != "$origin_sha" ]; then
  echo "refusing to deploy: HEAD is not origin/main" >&2
  exit 1
fi

npm ci --ignore-scripts
npm test

remote_stage="/var/www/agenc-tech/.plugins-upload-$head_sha"
ssh -o BatchMode=yes agenc-mainnet \
  "rm -rf '$remote_stage' && mkdir -p '$remote_stage/.agenc-plugin'"
scp -o BatchMode=yes \
  public/marketplace.json \
  public/plugin-publishers.json \
  public/agenc-plugins.pub \
  public/agenc-plugins-2026-09.pub \
  "agenc-mainnet:$remote_stage/"
scp -o BatchMode=yes \
  public/.agenc-plugin/marketplace.json \
  "agenc-mainnet:$remote_stage/.agenc-plugin/marketplace.json"

ssh -o BatchMode=yes agenc-mainnet "
  set -eu
  mkdir -p /var/www/agenc-tech/plugins/.agenc-plugin
  mv '$remote_stage/marketplace.json' /var/www/agenc-tech/plugins/marketplace.json
  mv '$remote_stage/.agenc-plugin/marketplace.json' /var/www/agenc-tech/plugins/.agenc-plugin/marketplace.json
  mv '$remote_stage/plugin-publishers.json' /var/www/agenc-tech/plugins/plugin-publishers.json
  mv '$remote_stage/agenc-plugins.pub' /var/www/agenc-tech/plugins/agenc-plugins.pub
  mv '$remote_stage/agenc-plugins-2026-09.pub' /var/www/agenc-tech/plugins/agenc-plugins-2026-09.pub
  rmdir '$remote_stage/.agenc-plugin'
  rmdir '$remote_stage'
"

local_hash=$(sha256sum public/marketplace.json | cut -d ' ' -f 1)
remote_hash=$(curl -fsS https://agenc.tech/plugins/marketplace.json | sha256sum | cut -d ' ' -f 1)
if [ "$local_hash" != "$remote_hash" ]; then
  echo "deployed marketplace hash does not match local build" >&2
  exit 1
fi

curl -fsS https://agenc.tech/plugins/plugin-publishers.json >/dev/null
curl -fsS https://agenc.tech/plugins/.agenc-plugin/marketplace.json >/dev/null
echo "live: https://agenc.tech/plugins/marketplace.json ($head_sha)"
