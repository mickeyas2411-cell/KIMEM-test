#!/usr/bin/env bash
# KIMEM staging backend dependency installer. Only installs dependencies.
set -Eeuo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Node.js and npm are required" >&2; exit 2
fi
registry="${KIMEM_NPM_REGISTRY:-https://registry.npmjs.org/}"
echo "Using npm registry: $registry"
# A DNS failure is not an application dependency or version error.
if ! node -e 'const dns=require("node:dns"); const u=new URL(process.argv[1]); dns.lookup(u.hostname,(e)=>{if(e){console.error("DNS lookup failed:",e.code);process.exitCode=10}else console.log("DNS resolved:",u.hostname)})' "$registry"; then
  echo "Cannot install until this environment can resolve the npm registry." >&2
  echo "Check DNS/network or set KIMEM_NPM_REGISTRY to an approved reachable mirror." >&2
  exit 10
fi
npm install --no-audit --no-fund --registry="$registry" \
  --fetch-retries=5 --fetch-retry-factor=2 \
  --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000
echo "Dependencies installed successfully."
