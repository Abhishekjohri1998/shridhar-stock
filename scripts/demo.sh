#!/usr/bin/env bash
# The walkthrough on this computer: demo data in server/.data-demo (never a database), every role
# one click away at http://localhost:4200/walkthrough. Stop with Ctrl+C; delete server/.data-demo
# to start again from scratch (or use "Reset the demo" on the walkthrough page).
set -e
cd "$(dirname "$0")/.."
npm run build >/dev/null
cd server
echo "Open http://localhost:4200/walkthrough"
MONGO_URI= DEMO=1 PORT=4200 DATA_DIR=.data-demo JWT_SECRET=demo node dist/index.js
