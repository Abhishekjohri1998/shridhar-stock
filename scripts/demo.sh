#!/usr/bin/env bash
# The walkthrough on this computer, with the link to billing working:
#
#   - a scratch billing server: the billing app's own code, unchanged, run from
#     ../billing-app on port 4100, with its data in stock-app/server/.data-billing-demo
#     (never the billing folder, never a database; scratch PIN 246810);
#   - the stock server on port 4200 in demo mode, reading bills from it every 15 s;
#   - both ways: billing asks stock for items, prices and round-off, and sends live drafts,
#     with a scratch link key (demo-link-key) that is only for this computer.
#
# Open http://localhost:4200/walkthrough, and the billing app itself at http://localhost:4100 to
# make bills that stock picks up. Ctrl+C stops both. Delete server/.data-demo and
# server/.data-billing-demo to start again from scratch.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BILLING="$HERE/../billing-app"
cd "$HERE"
npm run build >/dev/null

if [ -f "$BILLING/server/dist/index.js" ]; then
  (cd "$BILLING/server" && MONGO_URI= PORT=4100 AUTH_PIN=246810 JWT_SECRET=scratch \n    STOCK_URL=http://localhost:4200 LINK_KEY=demo-link-key \
    DATA_DIR="$HERE/server/.data-billing-demo" node dist/index.js) &
  BILLING_PID=$!
  trap 'kill $BILLING_PID 2>/dev/null' EXIT
  LINK="BILLING_URL=http://localhost:4100 BILLING_PIN=246810"
  echo "Scratch billing: http://localhost:4100 (PIN 246810)"
else
  LINK=""
  echo "No billing build in $BILLING (run npm run build there): the demo runs without the link."
fi

cd server
echo "Open http://localhost:4200/walkthrough"
env MONGO_URI= DEMO=1 PORT=4200 DATA_DIR=.data-demo JWT_SECRET=demo LINK_KEY=demo-link-key $LINK node dist/index.js
