// IBI Finance Tracker — GAS Backend v5.7  (same version number as the web app)
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
//       Also adds a search/filter summary bar (match Personal Transactions Tracker): while
//       a search term or type filter is active, a bar under the filter row shows Income /
//       Expense / Net / Entries for just the matching rows. PURE FRONTEND — no redeploy
//       needed for this part.
//       Also: date fields open the native calendar from a click anywhere on the field
//       (showPicker), and the calendar/dropdown widgets follow the app's dark/light theme
//       (color-scheme). PURE FRONTEND — no redeploy needed for this part.

const SHEET_ID    = "1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE";
const SHEET_NAME  = "Transactions";
const LEDGER_NAME = "Ledger";
/* PaidBy and Mode are APPENDED after CreatedAt rather than inserted in the
   middle: an existing sheet keeps every column exactly where it was, so the
   hand-made filters and the bank-import stamps still point at the same thing. */
const HEADERS     = ["ID","Date","Type","Description","Party","Amount","Note","CreatedAt",
                     "PaidBy","Mode","Category"];   // Category appended, same append-only rule

const COMMIT_SHEET = "Commitments";
const COMMIT_HDRS  = ["ID","Name","Kind","Category","Party","Amount","DueDay","Freq",
                      "StartMonth","TotalInst","OpeningInst","OpeningPaid","Principal",
                      "Outstanding","Unit","UnitPerInst","OpeningUnits","PayMode",
                      "Active","Note","CreatedAt"];

const PLAN_SHEET = "Plans";
const PLAN_HDRS  = ["ID","Month","Side","CommitmentId","Item","Category","Party",
                    "Proposed","Actual","DueDate","PaidDate","Status","PayMode",
                    "PaidBy","TxId","Note","Sort","CreatedAt"];

const APP_VERSION = "5.7";   // kept in step with the web app's badge (7 Sep 2026)
// Lets a page newer than this deployment detect what it can do, and say
// "update the Apps Script" instead of failing oddly at Save.
const FEATURES    = ["plans", "commitments", "paidby", "category"];   // category: Category column on Transactions

/* One helper builds every data sheet, so a sheet added in a later version gets
   the same frozen, styled header row and — the part that matters on an upgrade
   — the same "append any header this version added" migration. Columns are
   only ever appended, never renumbered. */
function getNamedSheet(name, headers, widths) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    styleHeader_(sh, headers.length);
    if (widths) widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    return sh;
  }
  const have = sh.getLastColumn();
  if (have < headers.length) {
    sh.getRange(1, have + 1, 1, headers.length - have).setValues([headers.slice(have)]);
    styleHeader_(sh, headers.length);
  }
  return sh;
}

function styleHeader_(sh, n) {
  sh.getRange(1, 1, 1, n)
    .setFontWeight("bold")
    .setBackground("#000000")
    .setFontColor("#00c5ff");
}

function getSheet() {
  return getNamedSheet(SHEET_NAME, HEADERS,
                       [130, 100, 90, 240, 170, 110, 210, 150, 110, 100, 170]);
}

function sheetTZ_() {
  try { return SpreadsheetApp.openById(SHEET_ID).getSpreadsheetTimeZone() || 'Asia/Kolkata'; }
  catch (e) { return 'Asia/Kolkata'; }
}

function num_(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function str_(v) { return v == null ? '' : String(v); }
function bool_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return !(s === 'false' || s === 'no' || s === '0' || s === '');
}

/* A date cell can come back as a Date (Sheets parsed it) or as the plain
   'yyyy-MM-dd' text we wrote. Formatting a Date in a timezone that is not the
   Sheet's own shifts it by a day. */
function isoOf_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/* A month cell is 'yyyy-MM'. Sheets loves to read that as a date and hand back
   a Date, which would come out as '2026-08-01' and stop matching the month key
   the app wrote. */
function monthOf_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : s;
}

function readCommitments_(tz) {
  const sh = getNamedSheet(COMMIT_SHEET, COMMIT_HDRS,
    [130,220,100,160,150,100,70,100,100,90,100,110,110,110,80,100,100,100,70,220,150]);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })
    .map(function (r) {
      return {
        id: String(r[0]), name: str_(r[1]), kind: str_(r[2]) || 'bill',
        category: str_(r[3]), party: str_(r[4]), amount: num_(r[5]),
        dueDay: num_(r[6]), freq: str_(r[7]) || 'monthly',
        startMonth: monthOf_(r[8], tz), totalInst: num_(r[9]),
        openingInst: num_(r[10]), openingPaid: num_(r[11]),
        principal: num_(r[12]), outstanding: num_(r[13]),
        unit: str_(r[14]), unitPerInst: num_(r[15]), openingUnits: num_(r[16]),
        payMode: str_(r[17]), active: bool_(r[18]), note: str_(r[19]),
        createdAt: str_(r[20])
      };
    });
}

function readPlans_(tz) {
  const sh = getNamedSheet(PLAN_SHEET, PLAN_HDRS,
    [130,90,70,130,220,160,150,100,100,110,110,90,100,110,130,220,70,150]);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })
    .map(function (r) {
      return {
        id: String(r[0]), month: monthOf_(r[1], tz), side: str_(r[2]) || 'out',
        commitmentId: str_(r[3]), item: str_(r[4]), category: str_(r[5]),
        party: str_(r[6]), proposed: num_(r[7]), actual: num_(r[8]),
        dueDate: isoOf_(r[9], tz), paidDate: isoOf_(r[10], tz),
        status: str_(r[11]) || 'planned', payMode: str_(r[12]),
        paidBy: str_(r[13]), txId: str_(r[14]), note: str_(r[15]),
        sort: num_(r[16]), createdAt: str_(r[17])
      };
    });
}

/* ── COMMITMENTS ────────────────────────────────────────────────────────────
   A commitment is the standing thing — "car loan, ₹12,111 on the 10th, 84
   instalments". The month-by-month record of actually paying it lives in
   Plans; nothing here is rewritten when a payment is made, so the instalment
   count and the running total are always derived from the plan rows rather
   than being a second copy that can drift out of step. */
function commitmentRow_(id, p, createdAt) {
  return [id, str_(p.name).slice(0,160), str_(p.kind) || 'bill',
          str_(p.category).slice(0,80), str_(p.party).slice(0,120),
          num_(p.amount), num_(p.dueDay), str_(p.freq) || 'monthly',
          str_(p.startMonth), num_(p.totalInst), num_(p.openingInst),
          num_(p.openingPaid), num_(p.principal), num_(p.outstanding),
          str_(p.unit).slice(0,20), num_(p.unitPerInst), num_(p.openingUnits),
          str_(p.payMode).slice(0,30), bool_(p.active) ? 'TRUE' : 'FALSE',
          str_(p.note).slice(0,400), createdAt];
}

function saveCommitment(p) {
  if (!String(p.name || '').trim()) return { status:'error', message:'A commitment needs a name.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = getNamedSheet(COMMIT_SHEET, COMMIT_HDRS);
    const rows = sh.getDataRange().getValues();
    if (p.id) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(p.id)) {
          const created = rows[i][COMMIT_HDRS.length - 1] || nowStamp_();
          sh.getRange(i + 1, 1, 1, COMMIT_HDRS.length)
            .setValues([commitmentRow_(String(p.id), p, created)]);
          SpreadsheetApp.flush();
          return { status:'ok', id:String(p.id), message:'Commitment updated.' };
        }
      }
      return { status:'error', message:'Commitment not found: ' + p.id };
    }
    const id = 'CM' + Date.now();
    sh.appendRow(commitmentRow_(id, p, nowStamp_()));
    SpreadsheetApp.flush();
    return { status:'ok', id:id, message:'Commitment saved.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ── PLAN ROWS ──────────────────────────────────────────────────────────── */
function planRow_(id, p, createdAt) {
  return [id, str_(p.month), str_(p.side) || 'out', str_(p.commitmentId),
          str_(p.item).slice(0,160), str_(p.category).slice(0,80),
          str_(p.party).slice(0,120), num_(p.proposed), num_(p.actual),
          str_(p.dueDate), str_(p.paidDate), str_(p.status) || 'planned',
          str_(p.payMode).slice(0,30), str_(p.paidBy).slice(0,80),
          str_(p.txId), str_(p.note).slice(0,400), num_(p.sort), createdAt];
}

function savePlan(p) {
  if (!String(p.month || '').trim()) return { status:'error', message:'A plan row needs a month.' };
  if (!String(p.item  || '').trim()) return { status:'error', message:'A plan row needs an item name.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = getNamedSheet(PLAN_SHEET, PLAN_HDRS);
    const rows = sh.getDataRange().getValues();
    if (p.id) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(p.id)) {
          const created = rows[i][PLAN_HDRS.length - 1] || nowStamp_();
          sh.getRange(i + 1, 1, 1, PLAN_HDRS.length)
            .setValues([planRow_(String(p.id), p, created)]);
          SpreadsheetApp.flush();
          return { status:'ok', id:String(p.id), message:'Plan updated.' };
        }
      }
      return { status:'error', message:'Plan row not found: ' + p.id };
    }
    const id = 'PL' + Date.now();
    sh.appendRow(planRow_(id, p, nowStamp_()));
    SpreadsheetApp.flush();
    return { status:'ok', id:id, message:'Plan row saved.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* Building a month writes twenty-odd rows at once. Sent one at a time that is
   twenty round trips against a quota shared with every other script on the
   account; here it is one call and one setValues. */
function savePlans(p) {
  let list;
  try { list = JSON.parse(String(p.rows || '[]')); }
  catch (e) { return { status:'error', message:'Plan rows were not valid JSON.' }; }
  if (!list || !list.length) return { status:'ok', ids:[], message:'Nothing to add.' };
  if (list.length > 120) return { status:'error', message:'Too many rows in one go.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = getNamedSheet(PLAN_SHEET, PLAN_HDRS);
    const now = nowStamp_(), base = Date.now(), ids = [];
    const values = list.map(function (row, i) {
      const id = 'PL' + (base + i);      // +i so a batch cannot collide with itself
      ids.push(id);
      return planRow_(id, row, now);
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, PLAN_HDRS.length).setValues(values);
    SpreadsheetApp.flush();
    return { status:'ok', ids:ids, message: values.length + ' rows added.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
}

/* One deleter for every sheet. Row order carries no meaning in any of them —
   each row is found by its ID. */
function deleteRowById(name, headers, id) {
  if (!id) return { status:'error', message:'No ID provided.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = getNamedSheet(name, headers);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sh.deleteRow(i + 1);
        SpreadsheetApp.flush();
        return { status:'ok', message:'Deleted: ' + id };
      }
    }
    return { status:'error', message:'ID not found: ' + id };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function doGet(e) {
  const p      = e.parameter || {};
  const action = p.action || '';
  let result;

  try {
    switch (action) {
      case 'ping':
        result = { status:'ok', message:'IBI Finance Tracker GAS v' + APP_VERSION + ' is live!',
                   version: APP_VERSION, features: FEATURES };
        break;
      case 'saveCommitment':   result = saveCommitment(p);                              break;
      case 'deleteCommitment': result = deleteRowById(COMMIT_SHEET, COMMIT_HDRS, p.id); break;
      case 'savePlan':         result = savePlan(p);                                    break;
      case 'savePlans':        result = savePlans(p);                                   break;
      case 'deletePlan':       result = deleteRowById(PLAN_SHEET, PLAN_HDRS, p.id);     break;

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
    createdAt:   r[7] || '',
    paidBy:      str_(r[8]),
    mode:        str_(r[9]),
    category:    str_(r[10])
  }));

  /* One call returns the ledger, the standing commitments and every planned
     month. Three separate round trips would each pay the Apps Script cold-start
     cost, and on a phone that is the whole of the wait. */
  const tz = sheetTZ_();
  return { status:'ok', transactions: rows,
           commitments: readCommitments_(tz),
           plans:       readPlans_(tz),
           version:     APP_VERSION,
           features:    FEATURES };
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
    now,
    p.paidBy || '',
    p.mode   || '',
    p.category || ''
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
      // Two ranges, one setValues each — six single-cell writes were six round
      // trips. Column 8 is CreatedAt and is deliberately skipped: it records
      // when the row was first written and must survive every later edit.
      sh.getRange(r, 2, 1, 6).setValues([[
        p.date        || '',
        p.type        || 'income',
        p.description || '',
        p.party       || '',
        parseFloat(p.amount) || 0,
        p.note        || ''
      ]]);
      sh.getRange(r, 9, 1, 3).setValues([[p.paidBy || '', p.mode || '', p.category || '']]);
      return { status:'ok', message:'Updated: ' + p.id };
    }
  }
  return { status:'error', message:'ID not found: ' + p.id };
}

// ─────────────────────────────────────────────────────────────────────────
//  PARTY BACKFILL (v2.6.1) — run ONCE from the Apps Script editor
//  Rows imported from the legacy Ledger (and anything saved before the Party
//  field existed) have an empty Party. Derive it from the Description for the
//  unambiguous e-commerce payouts only. Banks, cash, staff expenses, etc. are
//  LEFT BLANK on purpose (no reliable party in the text).
//
//  HOW TO RUN:
//    1. previewBackfillParties()  → writes NOTHING; logs every change it would make.
//    2. backfillParties()         → applies the fill (only touches EMPTY Party cells).
//  Safe to re-run: existing Party values are never overwritten.
//  No web-app redeploy needed — these run directly in the editor.
// ─────────────────────────────────────────────────────────────────────────

// Description keyword (lowercase) → Party. First match wins.
// Add a line here to onboard a new platform, e.g. ['glowroad', 'Glowroad'].
const PARTY_RULES = [
  ['amazon',   'Amazon'],
  ['meesho',   'Meesho'],
  ['flipkart', 'Flipkart']
];

function derivePartyFromDesc_(desc) {
  const d = String(desc || '').toLowerCase();
  for (let i = 0; i < PARTY_RULES.length; i++) {
    if (d.indexOf(PARTY_RULES[i][0]) !== -1) return PARTY_RULES[i][1];
  }
  return '';   // no confident match → leave blank
}

function backfillParties_(apply) {
  const sh   = getSheet();
  const last = sh.getLastRow();
  if (last <= 1) return { scanned:0, filled:0, changes:[] };

  // Columns are 1-based: Description = 4, Party = 5.
  const descs   = sh.getRange(2, 4, last - 1, 1).getValues();   // [[desc], ...]
  const parties = sh.getRange(2, 5, last - 1, 1).getValues();   // [[party], ...]

  let filled = 0;
  const changes = [];
  for (let i = 0; i < parties.length; i++) {
    if (String(parties[i][0] || '').trim() !== '') continue;     // never overwrite an existing party
    const party = derivePartyFromDesc_(descs[i][0]);
    if (party) {
      parties[i][0] = party;
      filled++;
      changes.push('row ' + (i + 2) + ': "' + String(descs[i][0]) + '" → ' + party);
    }
  }

  if (apply && filled) sh.getRange(2, 5, parties.length, 1).setValues(parties);  // single write, Party column only
  return { scanned: parties.length, filled: filled, changes: changes };
}

// Run me FIRST — dry run, writes nothing, logs every proposed change.
function previewBackfillParties() {
  const r = backfillParties_(false);
  Logger.log('DRY RUN — would fill ' + r.filled + ' of ' + r.scanned + ' empty-Party rows:\n' + r.changes.join('\n'));
  return r;
}

// Run me to APPLY — fills only empty Party cells, never overwrites.
function backfillParties() {
  const r = backfillParties_(true);
  Logger.log('APPLIED — filled ' + r.filled + ' of ' + r.scanned + ' rows.');
  return r;
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
