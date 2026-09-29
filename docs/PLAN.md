# Shridhar Stock: full plan, website only, linked to billing, handwriting understood

## Context

The stock system in `D:\Shridhar\stock-app` has phases 0–3 built: sign-in, roles, items, units,
prices, places, the ledger, CSV, and an admin APK. You now want five things:

1. **No inventory app, only a website.** The admin and every other user sign in there. Each role
   sees its own screens.
2. **Everything linked**: the stock screens with each other, and stock with billing.
3. **Handwriting everywhere.** The system must read handwriting properly, above all the Kannada
   handwritten bill lines, and update stock from it.
4. **A detailed design you can walk through on localhost**, with realistic demo data and one
   login per role.
5. **A more detailed plan.** This document.

Decided with you:

| | |
|---|---|
| Handwriting reader | **Claude vision** (`claude-opus-5-5`), which picks only from the shop's own item list. When it's sure, stock updates by itself. When it isn't, the admin confirms with one tap. |
| Billing link | **Both ways.** Reading starts now, with billing unchanged. A small billing-side change that can be switched off is designed now and built only when you say go. |
| Stock APK | **Removed.** `app/` is deleted from the repo but stays in git history. |
| Walkthrough | **A working website with demo data**: every role's screens built and working on localhost, plus a guided walkthrough page. |

---

# Part 1: Architecture

```
┌──────────────── D:\Shridhar\billing-app (billing, unchanged until "go") ────────────────┐
│  Tablet APK / web  ──►  billing server :4000  ──►  Atlas db "billing"                    │
└───────────────────────────────▲──────────────────────────────────────────────────────────┘
          read-only: GET /api/bills, /api/customers  (every 15 s)
┌───────────────────────────────┴──────── D:\Shridhar\stock-app ───────────────────────────┐
│  stock server :4200 ── Atlas db "inventory"                                              │
│   ├─ billing sync ── bill mirror ── typed lines matched ── sale moves                    │
│   │                             └─ handwritten lines ── Reader (Claude vision) ─┐        │
│   │                                  sure → sale move · unsure → To-confirm queue ◄┘      │
│   ├─ ledger, transfers, purchase orders, deliveries, order requests                      │
│   └─ live stream (SSE) → every open screen                                               │
│  website (one app, role-based):                                                          │
│   /admin  /owner  /worker  /godown  /vendor  /delivery  /customer   (+ /walkthrough demo) │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Repo after this plan:**
- `core/`: types, pricing, units, CSV, refill, roles, i18n, handwriting prompt schema.
- `server/`, with new modules:
  - `billing/`: the read-only client and the sync;
  - `reader/`: rendering ink to an image, the Claude call, and the confidence rules;
  - `events.ts`: the live stream;
  - `routes/<role>.ts`: one route file per role.
- `web/`: one Vite app. Each role has its own layout and pages under `web/src/roles/<role>/`.
- `scripts/`:
  - the tests;
  - `demo-seed.js`, which loads the demo data;
  - `demo.sh`, which starts both scratch servers and the demo.
- `app/`: **removed.** The `app` workspace goes, and so do the Expo packages. The stock signing key
  stays in `C:\Users\hp\.keystores`, unused.

**New dependency: `@anthropic-ai/sdk`.** You approved it by choosing Claude. It is the only one.
Turning strokes into an image uses a small PNG writer with no library, built the same way as
`scripts/make-icons.js`.

---

# Part 2: Handwriting, understood everywhere

## 2.1 Where handwriting appears

| Where | Who writes | What gets understood |
|---|---|---|
| Billing bill lines (in the billing APK today) | Shopkeeper | Item, unit and quantity, which drive the sale move |
| Stock website, "write instead of type" on every name box | Anyone | The same reader turns the writing into text or an item |
| Godown "received" and "sent" notes | Godown staff | A short note, kept as ink with its reading |
| Customer order request lines | Customer | Item and quantity for each written line |
| Admin quick-add item | Admin | A Kannada name written, read and filled into the form |
| Stock count (correct the count) | Admin, godown | The item name is written and the count typed |

The web writing pad is copied from billing's `client/src/components/InkPad.tsx`, including the
stroke eraser, palm rejection and pressure. The copy goes into `web/src/components/InkPad.tsx`.
Ink is stored in billing's own format, `{w, h, strokes}`, so bill ink and stock ink are the same
thing.

## 2.2 How a handwritten bill line is read

1. **Render.**
   - `reader/render.ts` draws the strokes in black on white.
   - Height is 96 px, width in proportion, 3 px lines.
   - The result is a PNG written with zlib.
   - It is cached by a hash of the strokes, so the same ink is never read twice.
2. **Ask Claude.** One request per line.
   - Model `claude-opus-5-5`, effort `low`, with structured output and the `fallbacks: "default"`
     setting.
   - **System prompt, cached:** you are reading a Kannada kirana bill line, choose only from this
     item list. The catalogue goes in with names in both scripts, other names and units.
   - **The message:** the image, the line's quantity and price as typed digits, and the last 20
     confirmed readings as examples.
   - **Returned:**
     ```json
     { "readText": "2 ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ", "script": "kn|en|mixed",
       "itemId": "it_… | null", "unit": "pack|pc|kg…", "qty": 2,
       "confidence": 0.0-1.0, "alternatives": [{"itemId","confidence"}] }
     ```
3. **Decide.** `reader/decide.ts` is a pure function and fully tested.
   - **Auto-post only if all of these hold:**
     - confidence ≥ 0.85;
     - the item is active;
     - the billed rate is consistent with the item's unit price, slab or range, within 15%;
     - the reading's quantity agrees with the bill.
   - **Otherwise it goes to To confirm,** with the reading and up to 3 alternatives filled in.
   - A line with no ink and no price is skipped.
4. **Learn.** Every admin confirmation or correction does two things:
   - it saves `{readText → itemId, unit}` as an alias on the item (shown to the admin, who can
     remove it);
   - it is added to the example list. The more the shop confirms, the fewer lines need a human.
5. **Record.**
   - Each line in the bill mirror keeps: status (`read-auto`, `confirmed`, `skipped`), the reading,
     the confidence, and who confirmed it.
   - The stock move carries `ref: bill 54 line 1` and `by: reader` or the admin's id.
   - Undo reverses the move.

**Guard rails**
- **Only ink is sent to Claude.** Never the customer's name, phone or the bill total.
- **No key means no reading, not a stop.**
  - If `ANTHROPIC_API_KEY` is unset, every handwritten line simply queues for a person.
  - If a call fails or is refused, the line queues. The sync never stops over a reading.
- **Cost is shown to the admin.** Each reading's token use is logged, and admin Settings shows
  "this month: N lines read, about ₹X".
- **A monthly cap** (setting, default ₹500) stops reading and queues lines once it's reached.
- **The key is yours.** You put it in `server/.env` yourself. It is never in the repo or in
  chat.

## 2.3 Handwriting in the stock website

Every "item name" box has a ✎ toggle. When on, a writing strip opens. On lifting the pen it is
read with the same prompt, but choosing from items only. The best match appears as a chip,
"ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ?", and tapping it accepts. Free notes, like a godown's reason, are stored as
ink plus the reading text.

---

# Part 3: The billing link, both ways

## 3.1 Read side: now, with billing unchanged

- **How the stock server reads billing.** It signs in with the shop PIN, held in its own env as
  `BILLING_PIN`. The client it uses is a module with only a `get()` method. Every 15 s it reads:
  - `GET /api/bills?limit=100`, upserted into `billmirror` by bill number;
  - `GET /api/customers`, whose name, phone and address are mirrored into `CustomerProfile`, with
    the landmark and map pin kept on the stock side.
- **Typed lines.** Each is matched by the `searchKey` of its name, other names and units. Exactly
  one match gives a sale move. Anything else goes to To confirm.
- **Handwritten lines** go to the reader (2.2).
- **Cancelled or deleted bills** get reverse moves.
- **What the rest of the system builds on this:**
  - the worker screen shows each saved bill within about 15 s;
  - customers see their bills and balance;
  - deliveries are created from bills;
  - reports.
- **The link's health is always shown to the admin**, for example "Billing link: OK, last bill #54,
  12 s ago".

## 3.2 Write side: designed now, built on your "go"

This is a small billing change with its own switch. It is off unless both `STOCK_URL` and
`STOCK_KEY` are set on the billing server.

| Billing sends or asks | What it gives |
|---|---|
| The draft bill while it's being written (debounced) | The worker screen shows the bill live, before it is saved |
| Catalogue search while typing | Suggestions with unit chips and the range price in billing's typing mode |
| Given-tick sync | A worker's "fetched" tick turns on billing's given tick, and the other way round |
| Round-off setting | A "Round off" line on the slip |

The stock side exposes this as a key-protected `/api/billing-link/*`. When the switch is off,
billing behaves exactly as today. None of it is built until you say go, and it will be a separate,
reviewed billing change.

---

# Part 4: Roles and screens (what the walkthrough shows)

Everything is mobile first and in Kannada or English. Every list updates live.

**Admin: `/admin`**
- **Home dashboard.** Tiles for:
  - To confirm (handwriting);
  - running low;
  - below zero;
  - transfers in transit;
  - open purchase orders;
  - today's deliveries;
  - customer requests;
  - the billing link;
  - handwriting reading costs this month.
- **Items.** Everything already built, plus quick add by writing the name, and each item's "learnt
  names" from confirmations.
- **Stock.** Every place side by side, per-item history, corrections by writing or typing, and
  recount.
- **To confirm.** Cards showing:
  - the handwriting image;
  - the reading ("2 ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ");
  - the suggested item and unit;
  - the quantity and price from the bill.

  Buttons: ✓ Correct, a pick from the alternatives, Search, or Skip (not an item). Keyboard
  shortcuts on a PC.
- **Bills.** The mirror of billing's bills, with each line's status (auto-read, confirmed, typed
  match, skipped).
- **Refill.** Running low, then plan trips, then send to a godown.
- **Transfers, Suppliers & purchase orders, Deliveries, Requests, People, Places.**
- **Excel files and Settings.** Settings covers the billing link, handwriting reading (on or off,
  monthly cap, key status) and rounding.

**Owner or partner: `/owner`.** Read-only:
- today's sales from bills and money due;
- stock value by place;
- low stock, and fast and slow movers;
- out-of-range prices;
- the handwriting auto-read rate;
- CSV downloads.

**Shop worker: `/worker`**
- **"Today's bills" queue.** The newest bill opens as a pick list grouped by rack (Rack 1, Rack 3,
  Back room). Handwritten lines show both the ink and the reading.
- **Fetching.** A big ✓ Fetched on each line, a counter "5 of 7", and a done banner.
- **TV mode, `/worker/screen`:** large type, read-only.

**Godown staff: `/godown`**
- **Requests** from the shop: items, quantities, the rack in this godown. Send it with vehicle,
  driver and the quantity actually sent, plus a handwritten note if wanted.
- **Incoming:** mark received with the actual quantity. Any shortfall is highlighted.
- **My stock:** this godown's stock, and a count correction if the admin allows it.

**Vendor: `/vendor`.** Their own purchase orders: confirm, then dispatch with invoice number,
vehicle and ETA. History. They never see sale prices.

**Delivery person: `/delivery`.** Today's drops, in order:
- name, address and landmark, call, and a Maps link;
- the items and the amount to collect;
- Out, then Delivered or Failed, with a note.

**Customer: `/customer`**
- **My bills:** the slip view, the same as the printed one, with ink.
- **Balance** due.
- **Shop items:** search in either script, price per unit, available or not.
- **Order request:** type or write lines by hand, send, and follow its status. The admin turns it
  into a bill in billing.

**Walkthrough: `/walkthrough`** (demo mode only; this page doesn't exist in production)
- **"Log in as" cards:** one button per role, which signs in as that demo person.
- **"A day at the shop" story**, 12 steps, each with a "do it" button and a link to the screen
  where you'll see the result:
  1. A handwritten bill arrives from billing.
  2. The reader reads it: one line auto, one line queued.
  3. The admin confirms, and the item learns the name.
  4. Stock drops.
  5. Items run low, and a trip is planned.
  6. The godown sends it.
  7. The shop receives it.
  8. A purchase order goes to a vendor.
  9. The vendor dispatches.
  10. It's received.
  11. A delivery is made.
  12. The customer sees the bill and places a request.
- **Reset demo** puts the demo data back.

---

# Part 5: Demo data (localhost only)

`scripts/demo.sh` does four things:
1. It starts a **scratch billing server**, billing's own code on the file store at port 4100. It
   is not changed and not Atlas.
2. It starts the **stock server** in demo mode at 4200, on the file store.
3. It runs `demo-seed.js`.
4. It opens `/walkthrough`.

**What gets loaded:**
- **Items:** about 40 real kirana items in both scripts, with real units, for example:
  - Parle-G: piece, pack of 24, box of 144;
  - Clinic Plus: piece, line of 16;
  - rice: kg, bag of 25;
  - groundnut oil: litre, tin of 15;
  - Shahi Biriyani Masala: pack.

  Each has slabs, ranges and racks.
- **Places:** the shop and 2 godowns, with realistic stock. Some items are low and one is below
  zero.
- **People:** one per role. Phones `90000000 01` to `07`, all with the demo PIN `1111`, which
  works only in demo mode.
- **Suppliers:** 2. Purchase orders, transfers and deliveries in every state.
- **Bills:** posted into the scratch billing server through its normal API. They include typed
  lines and **handwritten lines**.
  - **Where the handwriting comes from.** The handwriting samples are **stroke data only, copied
    from the shop's real bills with one read-only GET**. That is the only way to get real Kannada
    handwriting.
  - **Nothing else is copied.** No names, phones or amounts come with it, and the samples stay on
    this laptop, in the gitignored `scripts/demo-ink.json`.
  - **If you say no,** I use a handful of samples drawn in the browser instead.

Handwriting reading in the demo needs your key in `server/.env`. Without it, the walkthrough still
runs, and every handwritten line lands in To confirm.

---

# Part 6: Phases

Each phase ends with its tests, then a walkthrough on localhost where you click through it
yourself.

| # | Phase | Done when |
|---|---|---|
| **W1** | **Web-only reset and role shells.** Remove `app/`; a layout per role; login sends each role to its home; the demo seed; `/walkthrough` with log-in-as. All role screens built with **demo data behind real APIs**, where the API exists; the rest read-only until their phase. | You can log in as all 7 roles and see each one's real screens. **This is the design review.** |
| W2 | **Billing read link.** Sync, the mirror, typed-line matching, sale and cancel moves, the admin Bills page, link health. | A typed bill on the scratch billing server lowers stock within 15 s. Cancelling it restores the stock. |
| W3 | **Handwriting reader.** Render, the Claude call, decide, To confirm, learning, cost logging and cap, InkPad plus "write instead" on the website. | Demo handwritten lines are read. Confirming one teaches the name, and the next line with the same name is auto-read. |
| W4 | **Live stream and worker screen.** SSE, the worker pick list grouped by rack, fetched ticks, TV mode. | A bill saved in scratch billing appears on the worker's phone within about 15 s. |
| W5 | **Godowns and refill.** Plan trips, transfers from requested to sent to received, the godown screens, shortfalls. | The walkthrough steps for low stock, the trip, sending and receiving pass. |
| W6 | **Vendors and purchase orders.** | Order, then confirm, then dispatch, then receive, and stock and cost update. |
| W7 | **Deliveries and the customer mirror.** | A delivery is assigned, marked out and delivered, with the address from billing's customer. |
| W8 | **Customer and owner screens, and reports.** | The customer sees bills and balance and sends a written request. The owner's figures agree with the ledger. |
| W9 | **Billing write side, on your "go" only.** A separate, reviewed billing change. | Live drafts, suggestions, ticks and round-off, all behind the switch. |
| W10 | **Deploy.** `deploy/setup-stock.sh`, which you run, plus `BILLING_PIN` and the key on the server. | The live site works at `https://stock.3.111.82.220.sslip.io`. |

## Tests that go with it

- **unittest:**
  - `decide()`: every rule, including a confident read with the wrong price, which must queue;
  - rendering: the PNG decodes and is sized correctly;
  - typed-line matching: one match, two matches, none;
  - trip proposal;
  - that reading prompts contain no customer data.
- **apitest,** with a **fake billing server** and a **fake reader** (no API spend in tests):
  - the sync posts once and survives a restart;
  - cancel reverses;
  - a sure reading auto-posts, an unsure one queues;
  - a confirmation learns an alias;
  - the cap stops reading;
  - no key queues everything;
  - every role sees only its own data, and gets 403 for anyone else's.
- **Reader eval, opt-in, costs money, run only when you say.**
  - It runs 30 of the shop's real handwritten lines, labelled by you once, through the real reader.
  - It reports accuracy and auto-read rate.
  - It is used to set the 0.85 threshold.
- **Checks against billing:** billing's `git status` stays clean through W1–W8, and billing's own
  `npm test` is still green.

## Verification of W1 (the first thing you'll see)

1. `bash scripts/demo.sh`.
2. On `http://localhost:4200/walkthrough`, log in as each role and click through its screens.
3. A screenshot tour of every role goes to you as a walkthrough page.
4. Both scratch servers are stopped and their data deleted afterwards.

## Things I'll still ask before doing

- Copying the stroke-only handwriting samples from the live billing server (Part 5).
- Running the paid reader eval.
- Anything in W9, since it changes billing.
- Deploying, and anything on the server.
