# IBI Finance Tracker v5.14

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
