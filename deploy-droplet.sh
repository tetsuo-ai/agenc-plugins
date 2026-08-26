#!/bin/sh
# Publish the manifest to the agenc-mainnet droplet.
#
# A copy, not a deployment: agenc.tech already serves /var/www/agenc-tech
# statically through try_files, so the file appears at
# https://agenc.tech/plugins/marketplace.json with the vhost's existing TLS.
# No nginx reload, no DNS, nothing else on the host is touched.
set -e
cd "$(dirname "$0")"
node build-manifest.mjs
ssh -o BatchMode=yes agenc-mainnet 'mkdir -p /var/www/agenc-tech/plugins'
scp -o BatchMode=yes public/marketplace.json \
  agenc-mainnet:/var/www/agenc-tech/plugins/marketplace.json
curl -fsS https://agenc.tech/plugins/marketplace.json > /dev/null
echo "live: https://agenc.tech/plugins/marketplace.json"
