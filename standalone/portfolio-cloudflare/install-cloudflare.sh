#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Сначала установите Node.js LTS: https://nodejs.org/"
  exit 1
fi
npm install
npm run deploy
