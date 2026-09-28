#!/usr/bin/env bash
# A throwaway server for trying the website on a laptop: the JSON file store in server/.data-scratch,
# never a database. The admin below exists only in that scratch folder (the same test values as
# scripts/apitest.js). Delete server/.data-scratch when done.
#
#   phone 9000000001, PIN 4821
set -e
cd "$(dirname "$0")/.."
npm run build >/dev/null
cd server
MONGO_URI= PORT=4200 DATA_DIR=.data-scratch JWT_SECRET=scratch \
  SEED_ADMIN_PHONE=9000000001 SEED_ADMIN_PIN=4821 SEED_ADMIN_NAME="Scratch admin" \
  node dist/index.js
