# Shridhar Stock (inventory): notes for Claude

This folder is the **stock / inventory system** for Shridhar Kirani Stores. It is the only place
the stock server, the stock website and the stock admin APK are built from.

- The admin APK is package `com.shridhar.stock`, app name "Shridhar Stock", with the marigold
  crates icon. It installs **beside** the billing app on the shop's tablet.
- npm workspaces:
  - `core/`: shared rules, i18n in EN and KN;
  - `server/`: Express + Mongo, database `inventory`, port 4200;
  - `web/`: the website, with `/admin` and one screen per role;
  - `app/`: the Expo admin APK.
- The full plan with every phase is in `docs/PLAN.md`. Deploying to the EC2 box, beside billing,
  is `docs/deploy.md`.

## Not this folder

The **billing app** is a separate project in `D:\Shridhar\billing-app`. **Never edit it from
here.** The client asked for the two to be kept apart.

The stock system may only **read** billing's API. Anything in the plan that needs a billing change
waits for the client's explicit yes. That covers:
- live drafts on the worker screen;
- the typed catalogue in the billing screen;
- the round-off on the slip;
- ticks written back to billing.

## How to work here

- **Tests:** `npm test` runs typecheck, then `unittest`, `schematest` and `apitest` against a
  throwaway file store.
- **Trying it:** `bash scripts/dev-scratch.sh`, then open http://localhost:4200 and sign in as
  admin with phone 9000000001 and PIN 4821. These are scratch-only values. Delete
  `server/.data-scratch` afterwards.
- **Never use the live Atlas database for tests.**
- **APK:** `bash app/build-apk.sh`, run in the foreground with a 10-minute timeout. The first
  build after a folder move or a cache clean takes about 25 minutes. Bump `android.versionCode`
  in `app/app.json` for each new build.
- **Signing key:** `C:\Users\hp\.keystores\shridhar-stock.jks` and `shridhar-stock.properties`.
  It is separate from billing's key. Never put either in the repo.
- **Git:** local only for now. Pushing to GitHub is the owner's decision. If git reports
  "dubious ownership", use `git -c safe.directory='*' …`.
- **Heredocs eat backslashes.** For edit scripts, write a file with the Write tool and run it.
- **Before adding any package** beyond the billing app's stack, ask first.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Status

- **Built:** phases 0–3, which cover:
  - sign-in and roles;
  - items, units, slabs, range and CSV;
  - places, the stock ledger, corrections and recount;
  - the admin APK, version 0.1.0 build 1.
- **Not deployed yet:** the owner runs `deploy/setup-stock.sh` on EC2.
- **Next:** phase 4, the read-only billing link and the digitise queue.
