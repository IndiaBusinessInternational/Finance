# IBI Finance Tracker v5.18

**Sign-in (v5.18)** — the Apps Script now checks a password (salted hash in Script Property `FINANCE_PASSWORD_HASH`, set by running `setStaffPassword()` from a temporary `FINANCE_PASSWORD_NEW`) and hands the page a 30-day signed token. Every write needs it; an anonymous read gets no rows. Username **IBI-Finance-Data**. Staff Supervision reads with the read-only `FINANCE_SERVICE_KEY`. Entries waiting in the outbox are kept through a sign-out and sent after sign-in with the same request id — never twice. Check the set-up with `checkAuthSetup()`.

**Instant save (v5.17)** — a new entry appears at once (list and totals) and goes into an on-device outbox that syncs to Google Drive in the background, in order, retrying with growing gaps; the NO REPEATS request id makes every retry safe. A small badge in the status bar shows "N syncing…" or, if the server refuses one, "N not saved — tap" (send again / remove). The outbox survives closing the app. Edits update the row in place instead of re-downloading the ledger. Measured before: Apps Script took 4–50 s just to start a request.


**Balances: edit, rename, delete (v5.16)** — every account card now has **Edit** (latest reading), **Rename** (renaming to an existing account's name offers to MERGE them — e.g. "HDFC Bank Savings Account" into "HDFC Savings"), and **Delete** (the account and all its readings, after a confirm); History rows gain a delete button. Changes show on screen at once and are sent in the background. GAS is a number-only bump.


**Profile & Photo (v5.15)** — tap the IBI circle (camera badge) or the name, or Menu → Profile & Photo, to set a photo or the company logo, the display name and the subtitle any time. The picture is cropped square, shrunk to fit a Sheet cell and kept in the hidden **Settings** tab, so every device shows the same; it is UPLOADED (POST, text/plain JSON body — Google refuses URLs over ~12,000 characters), and doPost now merges the JSON body. "No photo" brings back the IBI mark. Paste the Apps Script 5.15 for the sync.


**Bank & Cash Balances (v5.14)** — a new **Balances** section (bottom bar on a phone) keeps each account's balance as a *reading*, never as a transaction: account, date, balance, note. Each account shows its latest reading, the change since the one before and its history; the section totals every account and flags one not updated for 30 days. Readings live in their own **Balances** sheet (date stored as text, read with getDisplayValues), so they never touch Income, Expenses or any report — no more ₹1 entries. *Review & move* finds the old ₹1 / ₹0 balance rows in the ledger, reads the figure out of the description, and moves the ticked ones into Balances (idempotent: each reading's ID is BL + the ledger row's ID). Typing a ₹1 balance into the ledger now offers to record it under Balances instead. Paste the Apps Script v5.14 for the server half.


**No repeated entries (v5.13)** — every new ledger entry, plan line and commitment now carries a request id (the industry-standard idempotency key). The Apps Script remembers it for six hours, so a save that is sent again after a lost reply — the app's old automatic retry, a Save tapped twice, Plan → Record it retried — returns the first row instead of writing a second. A create is never re-sent automatically any more; a lost reply is checked against Google Drive instead. A genuinely new entry with the same date, party and amount shows a *Possible repeat* warning (OK = save anyway, Cancel = go back), and Plan → Record it offers to link to a matching ledger row rather than adding one. Paste the Apps Script for the server half.


**Payment mode EFT (v5.12)** — *EFT — Electronic Funds Transfer* sits beside Bank transfer in every payment-mode list (ledger form, plan payment, commitment editor, voice check screen), and voice entry hears "by EFT" / "electronic funds transfer". Added for royalties such as Amazon KDP, whose payment reports name the method EFT. It is a label only — no total is split by mode — and the backend stores it as typed, so no Apps Script change is needed.


Income &amp; expense ledger for **India Business International** (Kanyakumari).

**Live:** https://finance.indiabusinessinternational.online/

## Stack
- **Voice entry (v5.8)** — speak one sentence, check it on screen, confirm. The recogniser is the browser's own (Web Speech API); the parser reads Indian amounts ("one lakh twenty thousand", "twenty five hundred"), day-first dates, type, party, mode and payer, snapping names to those already in the books. Nothing is written until Confirm & Save, which goes through the same `saveEntry()` the typed form uses. Hands-free "say save" arms only after the read-back and never while a warning is showing.
- Single-file PWA (`index.html`) — installable, offline-capable via service worker (`sw.js`), dark/light themes, live clock, summary metrics, add/edit/delete, filter/sort/search, CSV export.
- Backend: Google Apps Script web app (`IBIFinanceTracker_GAS.gs`) storing data in Google Sheets.

## Data API (Apps Script, GET-based)
`?action=ping | getAll | add | update | delete` → JSON `{ status:'ok', ... }`

Sheet columns: `ID, Date, Type, Description, Party, Amount, Note, CreatedAt` (tab: `Transactions`).

## Deploy
- **Frontend** — hosted on GitHub Pages from `main` (custom domain via `CNAME`). Push to `main` → auto-rebuilds.
- **Backend** — open the Sheet → Extensions → Apps Script, paste `IBIFinanceTracker_GAS.gs`, then **Deploy → Manage deployments → Edit → New version** (keep *Execute as: Me*, *Access: Anyone*). This preserves the existing `/exec` URL the app calls.

Sheet: https://docs.google.com/spreadsheets/d/1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE/edit
