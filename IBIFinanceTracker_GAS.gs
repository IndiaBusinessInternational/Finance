// IBI Finance Tracker — GAS Backend v2.6
// India Business International — Finance & Accounts Ledger
// Sheet ID: 1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE
// All requests via GET (URL params) — avoids CORS/redirect issues
// Deploy → Web App → Execute as Me → Access: Anyone
//
// v2.1: auto-imports the legacy "Ledger" tab (Date|Time|Description|Income|Expenditure|
//       Cumulative Balance) into the new "Transactions" schema the first time the app
//       loads, so existing data shows up. Runs once (guarded by a script property).
//       To re-import manually: Run → migrateLedgerToTransactions() in the editor.
// v2.2: read the Ledger with getDisplayValues() so dates are parsed from the literal
//       DD-MM-YYYY text the user sees (the raw cells were locale-swapped Date objects,
//       which sent day<=12 rows to the wrong month). toISO_ now auto-corrects order.
// v2.3: the Ledger date column is MIXED — day<=12 dates became US (month-first) Date
//       objects while day>12 stayed DD-MM text. Read raw values and swap month<->day on
//       the Date cells to recover the intended Indian dates; text stays day-first.
// v2.4: version label unified with the frontend (one app version). No backend logic
//       change — the v2.4 release is the frontend "Saving..." freeze fix; backend
//       behaviour is identical to v2.3. (Live ping reflects v2.4 only after a redeploy.)
// v2.5: frontend adds Report Generation — month-wise and "From Date → To Date" range —
//       with an on-screen statement (running balance + totals), period CSV export, and a
//       branded Print / Save-as-PDF view. PURE FRONTEND: reports run on the data already
//       returned by getAll, so NO redeploy is required for the feature to work. This file's
//       only change is the version label, kept in sync with the frontend (one app version).
// v2.6: fix duplicate entries (same row saved twice seconds apart). addTransaction now
//       fingerprints the payload and suppresses an identical add seen within 90s via the
//       shared CacheService — so a cold-start reload-and-resubmit or a double-tap can no
//       longer create a second row. Frontend also adds an in-flight save guard. REQUIRES A
//       REDEPLOY for the server-side guard to take effect (frontend guard works immediately).

const SHEET_ID    = "1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE";
const SHEET_NAME  = "Transactions";
const LEDGER_NAME = "Ledger";
const HEADERS     = ["ID","Date","Type","Description","Party","Amount","Note","CreatedAt"];

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#000000")
      .setFontColor("#00c5ff");
    sh.setColumnWidth(1, 130);
    sh.setColumnWidth(2, 100);
    sh.setColumnWidth(3, 90);
    sh.setColumnWidth(4, 240);
    sh.setColumnWidth(5, 170);
    sh.setColumnWidth(6, 110);
    sh.setColumnWidth(7, 210);
    sh.setColumnWidth(8, 150);
  }
  return sh;
}

function doGet(e) {
  const p      = e.parameter || {};
  const action = p.action || '';
  let result;

  try {
    switch (action) {
      case 'ping':
        result = { status:'ok', message:'IBI Finance Tracker GAS v2.6 is live!' };
        break;
      case 'getAll':
        result = getAllTransactions();
        break;
      case 'add':
        result = addTransaction(p);
        break;
      case 'update':
        result = updateTransaction(p);
        break;
      case 'delete':
        result = deleteTransaction(p.id);
        break;
      case 'migrate':
        result = { status:'ok', imported: migrateFromLedger_(true), message:'Re-imported Ledger.' };
        break;
      default:
        result = { status:'error', message:'Unknown action: ' + action };
    }
  } catch(err) {
    result = { status:'error', message: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Keep doPost as fallback (same handler)
function doPost(e) { return doGet(e); }

function getAllTransactions() {
  const sh = getSheet();

  // One-time auto-import of legacy Ledger data when Transactions is still empty.
  if (sh.getLastRow() <= 1) {
    try { migrateFromLedger_(false); } catch(e) { /* never block a read */ }
  }

  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return { status:'ok', transactions:[] };

  const rows = data.slice(1).map(r => ({
    id:          String(r[0]),
    date:        r[1] ? (r[1] instanceof Date
                          ? Utilities.formatDate(r[1], 'Asia/Kolkata', 'yyyy-MM-dd')
                          : String(r[1])) : '',
    type:        r[2],
    description: r[3],
    party:       r[4],
    amount:      parseFloat(r[5]) || 0,
    note:        r[6] || '',
    createdAt:   r[7] || ''
  }));

  return { status:'ok', transactions: rows };
}

function addTransaction(p) {
  const sh  = getSheet();

  // ── Duplicate-submit guard ────────────────────────────────────────────────
  // A cold start can make a save feel stuck, so the user reloads and resubmits
  // the same row (seen as two identical entries seconds apart); a double-tap can
  // also fire twice. Fingerprint the payload and suppress an identical add seen
  // within a short window. Shared, cross-execution CacheService = no schema change.
  const cache = CacheService.getScriptCache();
  const fp = [p.date, p.type, p.description, p.party,
              parseFloat(p.amount) || 0, p.note]
              .map(x => String(x == null ? '' : x).trim()).join('|');
  const key = 'add_' + Utilities.base64EncodeWebSafe(
              Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, fp));
  const seen = cache.get(key);
  if (seen) {
    return { status:'ok', id: seen, duplicate:true, message:'Duplicate suppressed — already saved.' };
  }

  const id  = 'TX' + Date.now();
  const now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');

  sh.appendRow([
    id,
    p.date   || '',
    p.type   || 'income',
    p.description || '',
    p.party  || '',
    parseFloat(p.amount) || 0,
    p.note   || '',
    now
  ]);

  cache.put(key, id, 90);   // 90-second idempotency window for this exact payload
  return { status:'ok', id: id, message:'Added successfully.' };
}

function updateTransaction(p) {
  if (!p.id) return { status:'error', message:'No ID provided.' };
  const sh   = getSheet();
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.id)) {
      const r = i + 1;
      sh.getRange(r, 2).setValue(p.date        || '');
      sh.getRange(r, 3).setValue(p.type        || 'income');
      sh.getRange(r, 4).setValue(p.description || '');
      sh.getRange(r, 5).setValue(p.party       || '');
      sh.getRange(r, 6).setValue(parseFloat(p.amount) || 0);
      sh.getRange(r, 7).setValue(p.note        || '');
      return { status:'ok', message:'Updated: ' + p.id };
    }
  }
  return { status:'error', message:'ID not found: ' + p.id };
}

function deleteTransaction(id) {
  if (!id) return { status:'error', message:'No ID provided.' };
  const sh   = getSheet();
  const rows = sh.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      return { status:'ok', message:'Deleted: ' + id };
    }
  }
  return { status:'error', message:'ID not found: ' + id };
}

// ─────────────────────────────────────────────────────────────────────────
//  LEGACY LEDGER MIGRATION
//  Old "Ledger" columns: Date | Time | Description | Income(₹) | Expenditure(₹) | Cumulative Balance
//  Mapped to: ID | Date | Type | Description | Party | Amount | Note | CreatedAt
// ─────────────────────────────────────────────────────────────────────────

// Run this from the Apps Script editor to (re)import the Ledger at any time.
function migrateLedgerToTransactions() {
  const n = migrateFromLedger_(true);
  Logger.log('Imported ' + n + ' rows from "' + LEDGER_NAME + '" into "' + SHEET_NAME + '".');
  return n;
}

function migrateFromLedger_(force) {
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('ledger_migrated') === '1') return 0;

  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Locate the Ledger tab (case-insensitive, tolerant of stray spaces).
  let led = ss.getSheetByName(LEDGER_NAME);
  if (!led) {
    led = ss.getSheets().filter(s => s.getName().toLowerCase().trim() === 'ledger')[0] || null;
  }
  if (!led) return 0;

  // Read RAW values. Day<=12 dates were stored as US (month-first) Date objects; toISO_
  // swaps month<->day to recover the intended Indian DD-MM date. Day>12 dates stayed as
  // text and are parsed day-first. (getDisplayValues only shows the already-misparsed
  // value, so it cannot recover the original intent.)
  const lv = led.getDataRange().getValues();
  if (lv.length <= 1) return 0;

  const out = [];
  let idx = 0;
  for (let i = 1; i < lv.length; i++) {
    const r      = lv[i];
    const dCell  = r[0], tCell = r[1], desc = r[2], incRaw = r[3], expRaw = r[4];

    // Skip fully blank rows.
    if (String(desc).trim() === '' &&
        String(incRaw).trim() === '' &&
        String(expRaw).trim() === '') continue;

    const hasInc = String(incRaw).trim() !== '';
    const hasExp = String(expRaw).trim() !== '';
    const incN   = parseFloat(String(incRaw).replace(/[^0-9.\-]/g, ''));
    const expN   = parseFloat(String(expRaw).replace(/[^0-9.\-]/g, ''));

    let type, amount;
    if (hasExp && !hasInc)        { type = 'expense'; amount = isNaN(expN) ? 0 : expN; }
    else if (hasInc && hasExp)    {                                            // both filled (rare)
      if ((isNaN(expN) ? 0 : expN) > (isNaN(incN) ? 0 : incN)) { type = 'expense'; amount = expN; }
      else                                                     { type = 'income';  amount = isNaN(incN) ? 0 : incN; }
    }
    else                         { type = 'income';  amount = isNaN(incN) ? 0 : incN; } // income (or 0 balance note)

    idx++;
    const created = toISO_(dCell) + (fmtTime_(tCell) ? ' ' + fmtTime_(tCell) : '');
    out.push(['TXMIG' + idx, toISO_(dCell), type, String(desc), '', amount, '', created]);
  }

  if (!out.length) return 0;

  const sh = getSheet();
  if (sh.getLastRow() > 1) {                                   // idempotent: clear data, keep header
    sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).clearContent();
  }
  sh.getRange(2, 1, out.length, HEADERS.length).setValues(out);
  props.setProperty('ledger_migrated', '1');
  return out.length;
}

function toISO_(d) {
  // Date object → Sheets misparsed the typed Indian DD-MM as US M-D. Recover by treating
  // the stored MONTH as the user's day and the stored DAY as the user's month.
  if (d instanceof Date) {
    const sMon = d.getMonth() + 1, sDay = d.getDate(), yr = d.getFullYear();
    let day, mon;
    if (sDay <= 12) { day = sMon; mon = sDay; }   // swap back to DD-MM intent
    else            { day = sDay; mon = sMon; }   // day>12 can't be a month → already correct
    return yr + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
  }
  // Text "DD-MM-YYYY" (day-first, Indian), with a guard that auto-corrects a swapped order.
  const s = String(d || '').trim();
  const m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    const y = m[3];
    let day, mon;
    if (a > 12 && b <= 12)      { day = a; mon = b; }   // unambiguous DD-MM
    else if (b > 12 && a <= 12) { day = b; mon = a; }   // unambiguous MM-DD → swap to DD-MM
    else                        { day = a; mon = b; }   // ambiguous → assume DD-MM (Indian)
    return y + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
  }
  const dd = new Date(s);
  if (!isNaN(dd.getTime())) return Utilities.formatDate(dd, 'Asia/Kolkata', 'yyyy-MM-dd');
  return s;
}

function fmtDisp_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MM-yyyy');
  return String(d || '').trim();
}

function fmtTime_(t) {
  if (t instanceof Date) return Utilities.formatDate(t, 'Asia/Kolkata', 'h:mm a');
  return String(t || '').trim();
}
