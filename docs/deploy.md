# Putting Shridhar Stock on the server

It goes on the same EC2 box as the billing app, beside it:

| | Billing (not touched) | Stock |
|---|---|---|
| Folder | `/opt/shridhar` | `/opt/shridhar-stock` |
| Service | `shridhar` | `shridhar-stock` |
| Port | 4000 | 4200 |
| Address | `3.111.82.220.sslip.io` | `stock.3.111.82.220.sslip.io` |
| Database | the billing database | `inventory` (same cluster, its own database) |

sslip.io answers for any name ending in the IP address, so the `stock.` address already points
at the box. Caddy gets its certificate the first time someone opens the address.

## 1. On the laptop: pack the code

The repo is not on GitHub yet, so the code is copied up as one file. `git archive` packs only
what is committed. It never includes `.env`, data, or the signing key.

```bash
cd "/d/Shridhar/stock-app"
git archive --format=tar.gz -o shridhar-stock.tar.gz HEAD
scp -i <your-key.pem> shridhar-stock.tar.gz ubuntu@3.111.82.220:~
```

## 2. On the server

```bash
ssh -i <your-key.pem> ubuntu@3.111.82.220
mkdir -p ~/stock-src && tar -xzf ~/shridhar-stock.tar.gz -C ~/stock-src
bash ~/stock-src/deploy/setup-stock.sh
```

The script asks three things and echoes none of them:

- **The MongoDB connection string.** The same one billing uses is fine, because `MONGO_DB=inventory` keeps the data in its own database.
- **The first admin's phone.**
- **The first admin's PIN.**

It adds the stock block to `/etc/caddy/Caddyfile` after saving a dated backup, and leaves the billing block unchanged. When it finishes, it prints the health check from `https://stock.3.111.82.220.sslip.io`.

## Updating later

Pack and copy the code the same way, then run the script again. It keeps `.env` and restarts the service.

## If something is wrong

```bash
sudo journalctl -u shridhar-stock -n 50 --no-pager
sudo systemctl restart shridhar-stock
```

To take the stock site off Caddy, remove its block from `/etc/caddy/Caddyfile` or restore the
dated backup next to it, then run `sudo systemctl reload caddy`. Billing is unaffected either way.
