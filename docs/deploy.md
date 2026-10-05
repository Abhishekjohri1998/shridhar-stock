# Putting Shridhar Stock on the server

It goes on the same EC2 box as the billing app, beside it. Nothing of billing's is changed:

| | Billing (not touched) | Stock |
|---|---|---|
| Folder | `/opt/shridhar` | `/opt/shridhar-stock` |
| Service | `shridhar` | `shridhar-stock` |
| Port | 4000 | 4200 |
| Address | `3.111.82.220.sslip.io` | `stock.3.111.82.220.sslip.io` |
| Database | the billing database | `inventory` (same Atlas cluster, its own database) |

sslip.io answers for any name ending in the IP address, so the `stock.` address already points
at the box. Caddy gets its certificate the first time the address is opened.

The stock server reads bills from billing on the same box, at `http://127.0.0.1:4000`. It never
goes out to the internet to reach billing.

## The short way: straight from GitHub

Sign in to the box and run this one line. It fetches the code from
`github.com/Abhishekjohri1998/shridhar-stock` and runs `deploy/setup-stock.sh`, which asks for the
secrets the first time. Run the same line again later to update; `.env` and the data are kept.

```bash
ssh -i C:/Users/hp/.ssh/shridhar-billing.pem ubuntu@3.111.82.220
curl -fsSL https://raw.githubusercontent.com/Abhishekjohri1998/shridhar-stock/main/deploy/install-from-github.sh | bash
```

The steps below do the same by copying a package up by hand.

## 1. On the laptop: pack the code

The package is `D:\Shridhar\shridhar-stock.tar.gz`, made with `git archive`. It holds only what
is committed: no `.env`, no demo data, no handwriting samples, no keys.

To make it again after a change:

```bash
cd "/d/Shridhar/stock-app" && git -c safe.directory='*' archive --format=tar.gz -o ../shridhar-stock.tar.gz HEAD
```

## 2. Copy it up

The billing box only lets SSH in from addresses you have allowed. If this fails with a timeout,
add your current IP to the EC2 security group's SSH rule in the AWS console first.

```bash
scp -i C:/Users/hp/.ssh/shridhar-billing.pem "/d/Shridhar/shridhar-stock.tar.gz" ubuntu@3.111.82.220:~
```

## 3. On the server

```bash
ssh -i C:/Users/hp/.ssh/shridhar-billing.pem ubuntu@3.111.82.220
```

Then, on the server:

```bash
rm -rf ~/stock-src && mkdir -p ~/stock-src && tar -xzf ~/shridhar-stock.tar.gz -C ~/stock-src && bash ~/stock-src/deploy/setup-stock.sh
```

The script asks for four things. It echoes none of them and writes them only to
`/opt/shridhar-stock/server/.env`, readable by nobody but the service:

1. **The MongoDB connection string.** Use the same one as billing. `MONGO_DB=inventory` keeps
   stock in its own database, and the billing database is never written to.
2. **The first admin's phone** (10 digits).
3. **The first admin's PIN.** You sign in with this and can change it on the website. The script
   deletes it from `.env` once the admin exists.
4. **The shop's billing PIN**, the one the counter types. Stock uses it only to read bills. Leave
   it empty to switch the billing link on later.

Handwritten bill lines wait in **Bills → To confirm**, where a person picks the item.

When the script finishes:
- `shridhar-stock` is running on port 4200.
- Caddy has a new block for the stock address. The old Caddyfile is kept next to it with a date
  on the end, and billing's block is unchanged.
- The script prints the health check from `https://stock.3.111.82.220.sslip.io`.

## 4. Check it

- Open https://stock.3.111.82.220.sslip.io and sign in with the admin phone and PIN.
- **Setup → Settings:** "Link to billing" should say Working, with billing's last bill number.
- **Setup → Places:** add your godowns.
- **Inventory:** add items, or bring them in from Setup → Excel.
- **Setup → People:** add shop workers and godown staff. Each one signs in at the same address
  with their phone and the PIN you give them. The roles are Admin, Shop worker and Godown; old
  owner, delivery and customer logins are kept as records but can no longer sign in.

## Switching the link on later

On the server:

```bash
nano /opt/shridhar-stock/server/.env
```

Set these two lines:

```
BILLING_URL=http://127.0.0.1:4000
BILLING_PIN=<the shop's PIN>
```

An old `ANTHROPIC_API_KEY` or `READER_*` line from before is simply ignored.

Then restart:

```bash
sudo systemctl restart shridhar-stock
```

## Updating later

Pack and copy the code as in steps 1 and 2, then run the same `tar … && bash …/setup-stock.sh`
line. It keeps `.env` and the data, and restarts the service.

## If something is wrong

```bash
sudo journalctl -u shridhar-stock -n 60 --no-pager
```

```bash
sudo systemctl restart shridhar-stock
```

To take the stock site off Caddy:
1. Remove its block from `/etc/caddy/Caddyfile`, or restore the dated backup next to it.
2. Run `sudo systemctl reload caddy`.

Billing is unaffected either way.
