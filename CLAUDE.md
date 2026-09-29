# Shridhar Stock (inventory): notes for Claude

This folder is the **stock / inventory system** for Shridhar Kirani Stores. It is the only place
the stock server, the stock website and the stock admin APK are built from.

- **Website only.** There is no stock APK: the admin APK was removed at the owner's request (it
  is in git history). Every role, the admin included, signs in on the website.
- npm workspaces:
  - `core/`: shared rules, i18n in EN and KN;
  - `server/`: Express + Mongo, database `inventory`, port 4200;
  - `web/`: the website, with `/admin`, one screen per role, and `/walkthrough` in demo mode.
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

- **Plan:** `docs/PLAN.md` (phases W1–W10).
- **W1 done:** every role's screens working on demo data. Run `bash scripts/demo.sh` and open
  http://localhost:4200/walkthrough (demo PIN 1111; file store only, refuses a database).
- **Next:** W2, the read-only billing sync, then W3, the Claude handwriting reader (needs the
  owner's `ANTHROPIC_API_KEY` in `server/.env`).
- **Real handwriting for the demo:** export a billing backup to Downloads, then extract strokes
  only into the gitignored `scripts/demo-ink.json`.
