#!/usr/bin/env bash
#
# Puts Shridhar Stock on the server, beside the billing app, without touching it.
#
# Run on the EC2 box as the ubuntu user, from inside the unpacked stock code:
#
#   bash deploy/setup-stock.sh
#
# What it does:
#   - installs the code in /opt/shridhar-stock (billing lives in /opt/shridhar; not touched)
#   - writes /opt/shridhar-stock/server/.env, mode 600, asking for the secrets
#   - adds a systemd service, shridhar-stock, on port 4200 (billing's is on 4000; not touched)
#   - ADDS one site block for the stock address to /etc/caddy/Caddyfile, after backing it up.
#     The billing block is left exactly as it is.
#
# Run it again to update: the code is replaced, .env is kept.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/shridhar-stock}"
PORT="${PORT:-4200}"
HOST="${STOCK_HOST:-stock.3.111.82.220.sslip.io}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mxx\033[0m %s\n\n' "$1" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Run this as the ubuntu user, not root. It uses sudo where it needs to."
[ -f "$SRC/server/src/index.ts" ] || die "Run this from the unpacked stock code."
command -v node >/dev/null || die "Node is not installed. The billing setup installs it; run that first."
# The handwriting reader draws its PNGs with zlib.crc32, which Node has from 22.2.
node -e "process.exit(require('zlib').crc32 ? 0 : 1)" || die "Node $(node -v) is too old: 22.2 or newer is needed (the billing box has 22)."
[ "$APP_DIR" != "/opt/shridhar" ] || die "That is the billing app's folder."
[ "$PORT" != "4000" ] || die "Port 4000 is the billing app's."

say "Checking $HOST points at this machine"
THIS_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com || echo '')"
NAME_IP="$(getent hosts "$HOST" | awk '{print $1}' | head -1 || echo '')"
[ -n "$NAME_IP" ] || die "$HOST does not resolve."
[ "$NAME_IP" = "$THIS_IP" ] || die "$HOST points at $NAME_IP, but this machine is $THIS_IP."

command -v rsync >/dev/null || sudo apt-get install -y -qq rsync

say "Copying the code to $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"
# Everything except the secrets and data already there.
rsync -a --delete --exclude server/.env --exclude 'server/.data*' --exclude node_modules --exclude scripts/demo-ink.json "$SRC/" "$APP_DIR/"

if [ ! -f "$APP_DIR/server/.env" ]; then
  say "The secrets (written straight to $APP_DIR/server/.env, nothing is echoed)"
  read -r -s -p "MongoDB connection string (the same cluster as billing is fine): " MONGO_IN; echo
  case "$MONGO_IN" in
    mongodb+srv://*|mongodb://*) ;;
    *) die "That does not look like a connection string." ;;
  esac
  read -r -p "First admin's phone (10 digits): " ADMIN_PHONE
  read -r -s -p "First admin's PIN (4 to 6 digits): " ADMIN_PIN; echo
  echo "    The link to billing reads bills from the billing server on this same box."
  read -r -s -p "The shop's billing PIN (the one the counter types; empty to leave the link off for now): " BILLING_PIN_IN; echo
  read -r -s -p "Anthropic API key for reading handwriting (empty to leave it off for now): " KEY_IN; echo
  umask 077
  cat > "$APP_DIR/server/.env" <<ENV
MONGO_URI=$MONGO_IN
MONGO_DB=inventory
JWT_SECRET=$(openssl rand -base64 48)
PORT=$PORT
NODE_ENV=production
CORS_ORIGIN=https://$HOST
SEED_ADMIN_PHONE=$ADMIN_PHONE
SEED_ADMIN_PIN=$ADMIN_PIN
SEED_ADMIN_NAME=Admin
BILLING_URL=${BILLING_PIN_IN:+http://127.0.0.1:4000}
BILLING_PIN=$BILLING_PIN_IN
BILLING_EVERY_MS=15000
ANTHROPIC_API_KEY=$KEY_IN
READER_CAP_RUPEES=500
ENV
  echo "    Written. The first admin is made on first start; this script removes the seed after."
else
  echo "    $APP_DIR/server/.env already there, kept."
fi

say "Installing and building (a few minutes)"
cd "$APP_DIR"
npm install --no-audit --no-fund
npm run build

grep -q '^DEMO=1' "$APP_DIR/server/.env" && die "server/.env has DEMO=1: demo mode is for a laptop, never the shop's server."

say "The service: shridhar-stock on port $PORT"
sudo tee /etc/systemd/system/shridhar-stock.service >/dev/null <<UNIT
[Unit]
Description=Shridhar Stock
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v node) dist/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now shridhar-stock
sudo systemctl restart shridhar-stock
sleep 3
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { sudo journalctl -u shridhar-stock -n 40 --no-pager; die "The stock server did not start."; }
echo "    Running."

# The seed has done its work once people exist; take it out so it is not left lying around.
if grep -q '^SEED_ADMIN_PIN=' "$APP_DIR/server/.env"; then
  sed -i '/^SEED_ADMIN_/d' "$APP_DIR/server/.env"
  sudo systemctl restart shridhar-stock
  echo "    First admin made; the seed PIN is removed from .env."
fi

say "Caddy: adding $HOST"
if grep -q "^$HOST" /etc/caddy/Caddyfile; then
  echo "    Already there."
else
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-stock.$(date +%Y%m%d%H%M%S)"
  sudo tee -a /etc/caddy/Caddyfile >/dev/null <<CADDY

$HOST {
	reverse_proxy 127.0.0.1:$PORT {
		flush_interval -1
	}
	request_body {
		max_size 4MB
	}
	encode gzip
}
CADDY
  sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null || die "Caddy says the file is not valid. The backup is next to it."
  sudo systemctl reload caddy
  echo "    Added, and Caddy reloaded. The billing block was not changed."
fi

sleep 5
say "Done"
echo "    https://$HOST"
curl -fsS "https://$HOST/api/health" && echo
