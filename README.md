# IBI Finance Tracker

Income &amp; expense ledger for **India Business International** (Kanyakumari).

**Live:** https://finance.indiabusinessinternational.online/

## Stack
- Single-file PWA (`index.html`) — installable, offline-capable via service worker (`sw.js`), dark/light themes, live clock, summary metrics, add/edit/delete, filter/sort/search, CSV export.
- Backend: Google Apps Script web app (`IBIFinanceTracker_GAS.gs`) storing data in Google Sheets.

## Data API (Apps Script, GET-based)
`?action=ping | getAll | add | update | delete` → JSON `{ status:'ok', ... }`

Sheet columns: `ID, Date, Type, Description, Party, Amount, Note, CreatedAt` (tab: `Transactions`).

## Deploy
- **Frontend** — hosted on GitHub Pages from `main` (custom domain via `CNAME`). Push to `main` → auto-rebuilds.
- **Backend** — open the Sheet → Extensions → Apps Script, paste `IBIFinanceTracker_GAS.gs`, then **Deploy → Manage deployments → Edit → New version** (keep *Execute as: Me*, *Access: Anyone*). This preserves the existing `/exec` URL the app calls.

Sheet: https://docs.google.com/spreadsheets/d/1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE/edit
