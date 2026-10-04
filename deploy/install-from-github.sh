#!/usr/bin/env bash
#
# Puts Shridhar Stock on the server straight from GitHub: no tarball to copy up.
#
# On the EC2 box, as the ubuntu user:
#
#   curl -fsSL https://raw.githubusercontent.com/Abhishekjohri1998/shridhar-stock/main/deploy/install-from-github.sh | bash
#
# The first run asks for the secrets (setup-stock.sh writes them to the server's .env and nowhere
# else). Run the same line again to update: it pulls the newest code, keeps .env and the data.

set -euo pipefail

REPO="${STOCK_REPO:-https://github.com/Abhishekjohri1998/shridhar-stock.git}"
SRC="${STOCK_SRC:-$HOME/stock-src}"

command -v git >/dev/null || sudo apt-get install -y -qq git

if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q origin main
  git -C "$SRC" reset -q --hard origin/main
else
  rm -rf "$SRC"
  git clone -q --depth 1 "$REPO" "$SRC"
fi
echo "Code at $(git -C "$SRC" log --oneline -1)"

# Piped into bash, this script's stdin is the download, so the questions read the keyboard.
bash "$SRC/deploy/setup-stock.sh" < /dev/tty
