# Shridhar Stock: a separate inventory system

## Context

The shop's brief asks for inventory built for a Kannada kirana:
- local units, and one item sold in several ways;
- range pricing;
- stock spread over a shop and far-away godowns, updated live;
- a worker display grouped by where items are kept;
- digitising handwritten bills;
- Excel export;
- transport;
- customer addresses.

**Your latest rule is that the billing software is not touched at all.** Its code, APK, server and data all stay exactly as they are. So inventory becomes its own system.

What was decided:

| | Decision |
|---|---|
| Code | A new folder and git repo, `D:\Shridhar\stock-app`. Nothing in `D:\Shridhar\billing-app` changes. |
| Admin | **Both** a separate admin APK ("Shridhar Stock", installed next to the billing app) **and** the same admin screens on the website |
| Other users | The same website, one screen per role: shop worker, godown, vendor, delivery, customer, owner/partner |
| Login | Phone + PIN set by the admin |
| Excel | CSV (UTF-8 with BOM, so Kannada opens in Excel) |
| Address | A subdomain, `stock.3.111.82.220.sslip.io` |
| Database | The same Atlas cluster, but a **new database**, `inventory`. The billing database is never written to. |
| Link to billing | The inventory server **reads** new bills from the billing server's existing API. It never writes to it. Typed item names are matched to items. Handwritten and unmatched lines go to a digitise queue. |

### What "not touching billing" means for the brief

These parts of the brief **need a change inside the billing app**. They are listed here so nothing is silently dropped. They wait until you allow a billing change:
1. **Live bill while it is being written** on the worker display. Without the change, workers see a bill **as soon as it is saved**, within about 5 seconds.
2. **Typing mode with catalogue search, unit chips and range pricing inside the billing screen.** Without the change:
   - prices, units and slabs live in the Stock system;
   - the admin, the website and the worker screen can look them up;
   - bills that went out of range are flagged afterwards.
3. **Round-off on the printed slip.** Not possible without a billing change.
4. **Worker "fetched" ticks turning on the billing app's given tick.** The ticks are kept and shown in Stock only.

Everything else in the brief is fully covered by the new system.

### Assumed until you say otherwise
- Customers see "available / not available", not quantities.
- A customer's order is a request. The admin bills it in the billing app, as today.
- The godown marks a transfer "sent", and the receiver marks it "received".

---

# Part A: Design

## A1. Layout

```
 D:\Shridhar\billing-app  (billing, UNCHANGED) ── server 3.111.82.220.sslip.io ── Atlas db: billing
                                                        ▲  read-only GET /api/bills
 D:\Shridhar\stock-app (NEW repo)                        │  (every 30 s + on demand)
  core/     shared rules: types, pricing, units, csv, refill, roles, kannada search, i18n
  server/   Express + Mongoose, port 4200 ── Atlas db: inventory
  web/      one website: /admin (admin) + /worker /godown /vendor /delivery /customer /owner
  app/      Expo admin APK "Shridhar Stock" (com.shridhar.stock)
  scripts/  tests      deploy/  caddy block + systemd unit (you run them)
```

**Stack.** The stack is the same as billing's, so nothing new is learned:
- npm workspaces;
- TypeScript;
- Express, Mongoose, Zod and jsonwebtoken on the server;
- Vite, React and react-router for the website;
- Expo and React Native for the APK.

These packages are new to this repo, at the same versions billing uses. **Approving this plan approves that list.** Anything beyond it, I ask about first.

**Code copied, not imported.** `kannada.ts` (`searchKey`, `latinToKannada`), the phone rules and the theme tokens are copied from billing into `core/`, so the two repos never depend on each other.

**Deploy.** It runs on the same EC2 box, as its own systemd service `shridhar-stock` on port 4200.
- Caddy gets a new block for `stock.3.111.82.220.sslip.io`.
- The billing service and its Caddy block are left alone.
- I write the commands, and you run them on the server.

**Git.** The repo is local at first. Whether it goes to GitHub, and whether publicly, is your decision when we get there.

## A2. The billing link (read-only)

**Login.** The inventory server signs in to billing with the shop PIN, which is held in the inventory server's env as `BILLING_PIN`. This is a secret: you put it on the server yourself, and it is never committed.

**Read-only by construction.** The billing client module only has a `get()` method. There is no code path that can POST, PUT or DELETE to billing.

**Sync, every 30 s.**
1. It fetches `GET /api/bills?limit=50` and upserts each bill into `billmirror` in the inventory database, keyed by bill number. It keeps the cancelled flag.
2. For each new line:
   - **Typed:** the line's name is matched to an item, by the `searchKey` of its English or Kannada name or of its aliases (for example "parle", "ಪಾರ್ಲೆ", "parle pack" → unit pack). If there is **exactly one** match, a `sale` move is posted from the shop. Its quantity is the line's quantity × the alias unit's `perBase`, and its key is `sale:<billNo>:<i>`.
   - **Handwritten, or no single match:** the line goes to the **digitise queue**.
3. A bill that has since been cancelled or deleted in billing posts `cancel` moves for anything already posted.
4. The last bill number seen is stored, so a restart resumes where it stopped.

**Price check.** The billed rate is compared with the item's slab and min–max. Out-of-range lines are flagged in a report, and nothing is blocked.

**When billing can't be reached.** Sync retries and the admin sees "billing link last OK at …". Stock moves from admins, godowns and vendors carry on regardless.

## A3. Identity and security

**Admin**
- Admins are people with `role: 'admin'`, using the same phone + PIN login.
- The admin APK and the website's `/admin` use the same API.
- You set the first admin PIN on the server through a one-time env var, `SEED_ADMIN_PHONE` / `SEED_ADMIN_PIN`, and remove it afterwards.

**Tokens**
- A token is a JWT carrying `{pid, role, linkedId, tv}` and lasts 30 days.
- `requireRole(...)` loads the person and refuses the token if they are switched off or if `tv` has changed. Resetting a PIN or switching someone off bumps `tv`, which signs them out everywhere.

**PINs** are 4–6 digits. They are stored as salted `crypto.scrypt` hashes and never returned. Anyone can change their own.

**Login limit.** After 5 failures per IP + phone, login locks for 15 minutes.

**Scope, checked on the server for every request and every live event:**

| Role | Sees / does |
|---|---|
| admin | Everything, edits everything |
| owner | Everything, read-only, exports |
| worker | Bills for today and their fetch ticks, and item racks |
| godown | Transfers to or from its own godown, and its own stock |
| vendor | Its own purchase orders only, with no sale prices |
| delivery | Deliveries assigned to it only |
| customer | Its own bills and balance (from the mirror), the catalogue (price and available only), and its own order requests |

Each role's API response is built per role, never trimmed afterwards.

**Formula guard.** CSV cells starting with `= + - @` are prefixed with `'`, so Excel won't run them as formulas.

## A4. Data (database `inventory`)

**Places and items**
```ts
Location  { id, name, nameKn, kind:'shop'|'godown', address?, active }        // exactly one shop
Item      { id, nameEn, nameKn, searchKey, aliases:[{text, key, unit?}], category?,
            baseUnit, units: ItemUnit[], racks:{[locId]: string}, reorderAt:{[locId]: number}, active }
ItemUnit  { code, label, labelKn, perBase, price, slabs?:[{minQty, rate}], min?, max?, cost? }
```

**Stock**
```ts
Stock     { itemId, locationId, qty }                         // base units, cache
StockMove { id, key(unique), at, kind, itemId, from?, to?, qty, ref, by, note? }
            kind: open|adjust|sale|cancel|digitise|purchase|transfer_out|transfer_in
```

**Transfers, suppliers and deliveries**
```ts
Transfer  { id, no, from, to, lines, status: requested|sent|received|cancelled, vehicle?, driver?,
            received?, by/times per step }
Supplier  { id, name, phone, address?, gstin?, active }
PurchaseOrder { id, no, supplierId, to, lines(qty, unit, cost),
            status: ordered|confirmed|dispatched|received|cancelled, invoiceNo?, vehicle?, eta?, received? }
Delivery  { id, billNo, customerKey, name, phone, address, landmark?, mapPin?, personId?, vehicle?,
            status: pending|out|delivered|failed, amountDue, note? }
```

**Billing mirror, people and requests**
```ts
BillMirror{ no, at, customer{name, phone}, lines[{name, ink?:bool, qty, rate, amount}], total, balance,
            cancelled, lineState[{status: posted|queued|digitised|skipped, itemId?, unit?, qty?, fetched?}] }
CustomerProfile { key(phone), name, address, address2?, landmark?, mapPin? }   // Stock's own copy
Person    { id, name, phone(unique), role, linkedId?, pinHash, tv, active }
OrderRequest { id, personId, lines, note?, status: new|done|declined, billNo? }
Settings  { billingUrl, lastBillNo, lastSyncOk }
```

**Addresses.** Billing's customer address is shown read-only. Stock's own `CustomerProfile` adds a landmark and a map pin for deliveries.

## A5. Stock engine

One function, `post(moves)`, makes every change:
1. Insert each move with its unique `key`. If the key already exists, skip it.
2. `$inc` the stock of the `from` and `to` places.
3. If step 2 fails, the move stays and the reconciler fixes the cache.

**The reconciler.** It runs every 5 minutes and on start. It rebuilds the stock of any item whose ledger total and cache total disagree. There is also an admin "Recount all" button.

**Negative stock** is allowed and shown in red as "count this". A sale is never blocked.

**Tests** use a file store with the same interface, so Atlas is never touched in testing.

## A6. Pricing, units, CSV

**`priceFor(item, unit, qty)`**
- returns `{rate, amount, baseQty, outOfRange}`;
- the slab with the highest `minQty ≤ qty` wins, otherwise `unit.price`.

**Unit conversion.** `toBase` and `fromBase`, and a display helper: 150 pieces of Parle-G shows as "1 box 6 pc".

**Worked examples, which become tests:**
- **Parle-G:** pc ₹5, pack of 24 ₹110, box of 144 ₹640.
- **Clinic Plus:** pc ₹2, line of 16 ₹30, and from 5 lines, ₹28 a line.
- **Rice:** by the kg, and a 25 kg bag.

**CSV files**
- Items: one row per unit, with slabs written as `"5:28|10:26"`, and aliases.
- Stock by place.
- The ledger for a date range.
- The bill mirror with lines.
- Purchases, transfers and deliveries.

**Import** is parse → preview (new / changed / errors by row) → apply. It is done on the website. The APK gets it only if `expo-document-picker` is approved.

## A7. Live updates

**One event stream.** The server keeps it in process: `GET /api/events`, a server-sent events stream with a heartbeat every 25 s. Events are small, like "transfer 17 changed", and every event is scoped to what the role may see. On an event, and on every reconnect, the page re-reads its data.

**The APK can't hold the stream,** because React Native can't read one without a new library. The APK polls `/api/changes?since=` every 5 s while it is open.

**The worker display.** A saved bill appears within about 5 s, grouped by rack for the shop. Each line has a large ✓ "fetched" button, and there is a count, "7 of 12 fetched". Handwritten lines are drawn from the mirrored ink, if the billing API returns ink, which the bill read will confirm. `/worker/screen` is a large-type, read-only mode for a TV or second monitor.

## A8. Screens

**The website (mobile first, one app, the menu depends on role)**

| Route | Role | Content |
|---|---|---|
| `/login` | all | Phone + PIN keypad, and change PIN |
| `/worker`, `/worker/screen` | worker, owner, admin | Today's bills, newest first, grouped by rack, with fetched ticks |
| `/godown` | godown | Requests (send with vehicle and driver, editing the quantity actually sent), Incoming (receive the actual quantity), My stock |
| `/vendor` | vendor | Orders: confirm, then dispatch with invoice number, vehicle and ETA; history |
| `/delivery` | delivery | Today's drops: call, map link, items, amount due; out / delivered / failed + note |
| `/customer` | customer | My bills (slip view), balance, shop items (search in either script, price, available), order request |
| `/owner` | owner | Dashboard, stock by place, ledger, reports, CSV downloads |
| `/admin/*` | admin | Every admin screen below |

**The admin screens, the same on the APK and at `/admin`:**
- **Home** tiles with counts: Running low · To digitise · Transfers · Purchase orders · Deliveries · Requests · billing link status.
- **Items:** names in both scripts, aliases, units table (code, label, perBase, price, min/max, cost, slabs), racks and reorder level per place.
- **Places.**
- **Stock:** per item per place, the last moves, adjust (counted, damaged, expired), opening stock, recount.
- **Running low → Plan trips:**
  - For each item under the shop's reorder level, the godown with the most stock of it is chosen.
  - Trips are grouped by godown, so each trip brings everything low that godown holds. Quantities top the shop up to twice the reorder level, capped at what the godown has.
  - A trip creates one transfer request.
  - An item no godown has goes to "buy from supplier" and prefills a purchase order.
- **Transfers,** and **Suppliers & purchase orders** (receiving updates stock and cost).
- **To digitise:** the handwritten or unmatched line (ink image, qty, price, bill date) → pick the item and unit → post. There is also "Skip" for a service or note, and "Undo".
- **Deliveries:** make one from a mirrored bill; the address comes from billing and the landmark from Stock's profile; assign a person and vehicle.
- **People:** add, set role and link, reset PIN, switch off.
- **Requests:** mark done with the billing bill number, or decline.
- **Exports**, and **Settings** (billing link status and last sync).

**Look.** The website and the APK copy billing's tokens (colours, radius, shadow), so they look like one family. Both languages are in `core/i18n.ts`, and a key cannot be missing from either (the same typed rule billing uses).

---

# Part B: Phases

Each phase ships on its own, with tests.

## Phase 0: Repo and foundations
- Create `D:\Shridhar\stock-app` with its workspaces, TypeScript, and `npm test`.
- Copy the Kannada search and the design tokens into `core/`.
- Server: env, health endpoint, file and Mongo stores behind one interface, people and PIN login, the login limit, `requireRole`, and the seed admin.
- Website: login and the role redirect.
- Tests: PIN hash, lockout, a switched-off person is refused, the role gate, and every Mongo schema validates.
- Done when `npm test` passes and you can log in as admin on a scratch server.

## Phase 1: Items, units, prices, CSV
- Item CRUD, aliases and search. `priceFor` and the unit helpers. Items CSV export and import.
- Admin screens on the website.
- Tests:
  - slab edges;
  - min/max flags;
  - the Parle-G, Clinic Plus and rice examples;
  - conversion (box = 6 packs = 144 pieces);
  - CSV round-trip with Kannada;
  - formula guard;
  - no duplicate unit codes, and `perBase` a positive whole number.
- Done when the three example items are entered, exported, open correctly in Excel, and re-import with one changed price.

## Phase 2: Places and stock ledger
- Locations; `post()` with keys that can't post twice; reconciler; opening stock, adjust, recount; stock and ledger CSV.
- Tests:
  - the same key posted twice moves stock once;
  - a tampered cache is found and repaired;
  - negative stock is allowed and flagged.

## Phase 3: Admin APK
- A new Expo app `app/` with id `com.shridhar.stock` and its own name and icon. It has every admin screen built so far, plus `/api/changes` polling.
- Exports go out through `expo-sharing`.
- The APK is built locally, the same way as billing, as a separate app beside the billing app on the tablet.
- OTA updates need an EAS project for this app. **You create it on your Expo account**, since I don't sign in to accounts.
- Done when the APK is installed next to the billing app and adding an item on the tablet shows on the website.

## Phase 4: Billing link and digitise queue
- The read-only billing client, the 30-second sync, the mirror, alias matching, sale and cancel moves, and the queue.
- Tests, with a fake billing server:
  - exactly one match posts;
  - two matches queue the line;
  - a handwritten line queues;
  - a cancelled bill reverses its sales;
  - a restart doesn't post anything twice;
  - the client has no write method.
- Done, on scratch servers only: a typed "Parle pack × 2" bill on a scratch billing server lowers shop stock by 48 pieces. Cancelling that bill restores it. A handwritten line appears in To digitise.
- Going live then needs `BILLING_PIN` on the inventory server, which you set.

## Phase 5: Live stream and worker screen
- The SSE hub with scoped events; `/worker` and `/worker/screen`; fetched ticks; racks.
- Tests:
  - a worker gets only today's bill events;
  - a tick round-trips;
  - the display works on a phone.

## Phase 6: Godowns, refill, transfers
- `proposeTrips`; transfer requested → sent → received; the `/godown` screen; shortfalls.
- Tests:
  - trip proposal with one godown, with two godowns, with no godown (goes to "buy"), and the cap;
  - stock moves once each way;
  - a godown can't see another godown's transfers (403).
- Done when three low items become one trip, the godown sends it from a phone, the shop receives it, and every place's stock is right.

## Phase 7: Vendors and purchase orders
- Suppliers; the purchase order lifecycle; `/vendor`; receiving posts purchase moves and updates cost.
- Tests:
  - receiving twice is posted once;
  - a vendor response contains no sale prices;
  - a vendor can't see another vendor's order (403).

## Phase 8: Deliveries
- Deliveries from mirrored bills; `CustomerProfile` with landmark and pin; `/delivery` with a Google Maps link (no maps library).
- Tests:
  - a delivery person sees only their own drops;
  - status order;
  - the address prefills.

## Phase 9: Customer and owner screens, reports
- `/customer`:
  - bills and balance from the mirror, matched by the person's phone;
  - the catalogue with price and available only;
  - order requests.
- `/owner`: dashboard and the remaining CSV exports.
- Reports:
  - sales by item (linked lines only, with the unlinked share shown);
  - stock value at cost;
  - fast and slow movers;
  - out-of-range bills.
- Tests:
  - a customer can't read another customer's bill;
  - the catalogue carries no cost or quantity;
  - the owner can't write;
  - report totals match the ledger.

## Phase 10: Go live
- Deploy the commands for systemd and Caddy, which you run.
- The seed admin, `BILLING_PIN`, and the `inventory` database on the same cluster.
- A walkthrough artifact.
- Then the tablet: both apps side by side, and billing unchanged.

---

## Verification (every phase)
1. `npm test` in the new repo, and `tsc --noEmit` for server, web and app.
2. **Scratch servers only:**
   - inventory on port 4200 with the file store;
   - for phase 4 on, a scratch billing server as well: `cd "D:\Shridhar\billing-app\server" && MONGO_URI= PORT=4100 AUTH_PIN=246810 JWT_SECRET=scratch node dist/index.js`. That runs billing's code unchanged and only reads from it, and its `.data` is deleted afterwards.
   - Drive the website in the in-app browser.
3. `git status` in `D:\Shridhar\billing-app` shows no changes at the end of every phase.
4. The APK is checked on the tablet, and the billing APK's behaviour is unchanged.

## I will ask you before
- any package beyond billing's stack, such as `expo-document-picker`;
- anything on the live server: deploy, env secrets, Caddy;
- pushing the new repo to GitHub;
- any change to the billing software. The four items in "What not touching billing means" wait for that.

## First step on approval
Phase 0, then Phase 1 and Phase 2, all on scratch servers. A walkthrough follows each phase.
