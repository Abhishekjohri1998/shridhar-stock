# Shridhar Stock

Stock for the shop: items and the many units they sell in, prices and quantity slabs, the shop
and its godowns, and a ledger of every change. It is a separate system from the billing app
(Simple Sales Book). This repo never changes the billing app, and it only ever **reads** from the
billing server.

```
core/     rules shared by the server, the website and the admin app: types, pricing, units,
          CSV, item checks, Kannada search, every string in English and Kannada
server/   Express + MongoDB (its own database, "inventory") or a JSON file for tests
web/      the website: /admin for the admin, and one screen per role for everyone else
app/      the admin APK, "Shridhar Stock" (com.shridhar.stock), installed beside the billing app
deploy/   putting it on the server beside billing (docs/deploy.md)
scripts/  tests
```

## Running it on a laptop

```bash
npm install
bash scripts/dev-scratch.sh
```

Then open http://localhost:4200 and sign in as the scratch admin: phone `9000000001`, PIN
`4821`. The data goes to `server/.data-scratch`, which you can delete when you're done. This
setup never touches a database.

For live reload while working on the website, run the scratch server, then `npm run dev:web`
and open http://localhost:5174.

## The admin APK

```bash
bash app/build-apk.sh
```

This builds a signed APK into `app/dist-apk/`. It has its own package and its own signing key (`C:/Users/hp/.keystores/shridhar-stock.*`, kept outside the repo), so it never updates over the billing app and the billing app never updates over it. **Back up that key.** Without it, no update can be installed over this app again.

The app talks only to the stock server (`https://stock.3.111.82.220.sslip.io` by default, and the sign-in screen can change it). It has no code that reaches the billing server.

## Tests

```bash
npm test
```

This typechecks everything, then runs the pure rules (`unittest`), the Mongo schemas
(`schematest`), and the whole API against a throwaway file store (`apitest`).

## Rules the code keeps

- **Stock is a ledger.** Every change is a move with a unique key, so posting the same move
  twice changes nothing. The per-place numbers are a cache of the ledger, and the server rebuilds
  them on start and every 5 minutes.
- **Base units only.** A pack of 24 is 24 pieces in stock. A pack still has its own price
  (Parle-G: ₹110, not 24 × ₹5).
- **Stock may go below zero.** Nothing refuses a sale. The item is flagged so someone counts it.
- **Every rule is checked on the server.** That covers roles, item checks and PINs. The screens
  only help.
- **PINs are stored as salted scrypt hashes.** After 5 wrong tries, that phone is locked for 15
  minutes. A new PIN, a change of role or switching someone off signs them out on every device.

## Status

Built:
- **Phase 0:** sign-in, roles and the stores.
- **Phase 1:** items, units, prices and CSV.
- **Phase 2:** places, the stock ledger, corrections and recount.
- **Phase 3:** the admin APK. It has the same admin screens as the website, apart from bringing in an items file, which is done on the website.

The full plan for the later phases (admin APK, billing link, worker screen, godowns, vendors,
deliveries, customers) is in `docs/PLAN.md`.
