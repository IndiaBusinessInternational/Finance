// IBI Finance Tracker — GAS Backend v5.19  (same version number as the web app)
// v5.18 (4 Oct 2026): SIGN-IN. Every write needs a signed-in token; anonymous reads get no rows.
//   Script Properties: FINANCE_PASSWORD_NEW (temporary, then run setStaffPassword),
//   FINANCE_PASSWORD_HASH + FINANCE_TOKEN_SECRET (written by the script), FINANCE_SERVICE_KEY
//   (read-only, for Staff Supervision), FINANCE_ENFORCE_AUTH, optional FINANCE_USER.
//   Check with checkAuthSetup(). Deploy as a NEW VERSION of the SAME deployment.
// India Business International — Finance & Accounts Ledger
// Sheet ID: 1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE
// All requests via GET (URL params) — avoids CORS/redirect issues
// Deploy → Web App → Execute as Me → Access: Anyone (the script itself checks the sign-in)
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

const APP_VERSION = "5.19";   // kept in step with the web app's badge (7 Sep 2026)
// Lets a page newer than this deployment detect what it can do, and say
// "update the Apps Script" instead of failing oddly at Save.
const FEATURES    = ["plans", "commitments", "paidby", "category", "rid", "balances", "profile", "auth", "serviceKey"];   // category: Category column on Transactions

/* Per-app names for the shared SIGN-IN block below. */
const AUTH_PREFIX       = 'FINANCE';            // Script Property names: FINANCE_PASSWORD_HASH, …
const AUTH_USER_DEFAULT = 'IBI-Finance-Data';   // the username typed at sign-in (FINANCE_USER overrides)
const AUTH_APP_LABEL    = 'IBI Finance Tracker';

/* ══ SIGN-IN — shared by the IBI and TSM finance scripts (IBI v5.18 / TSM v6.18) ══
   Until v5.17 / v6.17 anyone holding the /exec address could READ the whole
   ledger and ADD, CHANGE or DELETE rows — no password at all (found 1 Oct 2026,
   security audit 4 Oct 2026). This is the Mini Finance Tracker's model —
   action=login → a 30-day token, every other action checks it, a refusal says
   status:'auth' — hardened the way Order Processing v15.0 / Package Tracker
   v14.0 were:
     • the password is kept only as a salted, stretched hash
       (<PREFIX>_PASSWORD_HASH), written by setStaffPassword() from a temporary
       <PREFIX>_PASSWORD_NEW property that it deletes again;
     • tokens are HMAC-signed (no session list to grow), tied to the current
       password — change it and every device signs in again;
     • 10 wrong passwords in 15 minutes pause sign-in for everyone;
     • sign-in is accepted only as a POST, so a password never sits in a URL;
     • EVERY write needs a signed-in token. A service key (optional,
       <PREFIX>_SERVICE_KEY, 32+ characters) may READ the ledger (getAll) for a
       server-side reader such as Staff Supervision — it can never write.
   Reads: an anonymous read gets NO rows, whatever the flag says — a ledger has
   no safe subset. <PREFIX>_ENFORCE_AUTH = true only makes the refusal (and the
   ping) say less: off = the refusal still carries version/features and the
   ping reports which setup pieces are in place, to help the roll-out.
   Per-app names come from AUTH_PREFIX / AUTH_USER_DEFAULT / AUTH_APP_LABEL
   above this block; the block itself is byte-identical in both scripts. */
const AUTH_TTL_MS          = 30 * 24 * 60 * 60 * 1000;   // signed in for 30 days
const AUTH_PW_ROUNDS       = 1000;
const AUTH_FAIL_LIMIT      = 10;                         // wrong passwords per window, then a pause
const AUTH_FAIL_WINDOW_SEC = 15 * 60;
const AUTH_OPEN_ACTIONS    = ['ping', 'login', 'logout'];
const AUTH_SERVICE_ACTIONS = ['getAll'];                 // what a service key may do: read, never write

function authProps_() { return PropertiesService.getScriptProperties(); }
function authProp_(name) { return String(authProps_().getProperty(AUTH_PREFIX + '_' + name) || ''); }
function authEnforced_() { return authProp_('ENFORCE_AUTH').trim().toLowerCase() === 'true'; }
function authUser_() { return authProp_('USER').trim() || AUTH_USER_DEFAULT; }

/* Constant-time compare: a plain === leaks through its timing how many
   leading characters matched. */
function authSafeEqual_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= ((a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0));
  return diff === 0;
}

/* "v1$<rounds>$<salt>$<hash>" — salted, stretched SHA-256. */
function authHashPw_(pw, salt, rounds) {
  const pwBytes = Utilities.newBlob(String(salt) + '|' + String(pw)).getBytes();
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwBytes);
  for (let i = 1; i < rounds; i++) {
    d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(pwBytes));
  }
  return Utilities.base64EncodeWebSafe(d);
}
function authCheckPw_(pw) {
  const parts = authProp_('PASSWORD_HASH').split('$');
  if (parts.length !== 4 || parts[0] !== 'v1' || !pw) return false;
  const rounds = parseInt(parts[1], 10) || AUTH_PW_ROUNDS;
  return authSafeEqual_(authHashPw_(pw, parts[2], rounds), parts[3]);
}

function authSecret_() {
  let s = authProp_('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    authProps_().setProperty(AUTH_PREFIX + '_TOKEN_SECRET', s);
  }
  return s;
}
/* The token is tied to the CURRENT password: change it and every device's
   token stops working at once. No password = no token is ever valid. */
function authFingerprint_() { return authProp_('PASSWORD_HASH').slice(-16); }
function authSig_(exp) {
  const raw = Utilities.computeHmacSha256Signature('user|' + exp + '|' + authFingerprint_(), authSecret_());
  return Utilities.base64EncodeWebSafe(raw);
}
function authMakeToken_(exp) { return 't1.' + exp + '.' + authSig_(String(exp)); }
function authCheckToken_(token) {
  const m = String(token == null ? '' : token).trim().match(/^t1\.(\d{10,16})\.([A-Za-z0-9_\-=]+)$/);
  if (!m) return false;
  if (Date.now() > parseInt(m[1], 10)) return false;              // expired
  if (!authFingerprint_()) return false;                           // no password set = nobody
  return authSafeEqual_(m[2], authSig_(m[1]));
}
function authCheckServiceKey_(key) {
  const real = authProp_('SERVICE_KEY');
  if (real.length < 32 || !key) return false;                      // unset = refused, never open
  return authSafeEqual_(String(key), real);
}
/* Who is calling? 'user' | 'service' | '' (anonymous). */
function authWho_(p) {
  try {
    if (p && p.token && authCheckToken_(p.token)) return 'user';
    if (p && p.serviceKey && authCheckServiceKey_(p.serviceKey)) return 'service';
  } catch (e) {}
  return '';
}

function authRefusal_() {
  const r = { status: 'auth', code: 'auth', ok: false,
              message: 'Please sign in to ' + AUTH_APP_LABEL + '.' };
  if (!authEnforced_()) { r.redacted = true; r.version = APP_VERSION; r.features = FEATURES; }
  return r;
}
/* null = go ahead; otherwise the refusal to send back. */
function authGate_(action, p) {
  if (AUTH_OPEN_ACTIONS.indexOf(action) >= 0) return null;
  const who = authWho_(p);
  if (who === 'user') return null;
  if (who === 'service' && AUTH_SERVICE_ACTIONS.indexOf(action) >= 0) return null;
  return authRefusal_();
}

/* Extra ping fields. Whether each piece is SET — never its value. */
function authPingInfo_(r) {
  r.authEnforced = authEnforced_();
  if (!r.authEnforced) {
    r.setup = { password: !!authProp_('PASSWORD_HASH'),
                serviceKey: authProp_('SERVICE_KEY').length >= 32 };
  }
  return r;
}

function authFailCount_() {
  try { return parseInt(CacheService.getScriptCache().get(AUTH_PREFIX + '_login_fails') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function authFailBump_() {
  try { CacheService.getScriptCache().put(AUTH_PREFIX + '_login_fails', String(authFailCount_() + 1), AUTH_FAIL_WINDOW_SEC); }
  catch (e) {}
}
function authFailClear_() {
  try { CacheService.getScriptCache().remove(AUTH_PREFIX + '_login_fails'); } catch (e) {}
}

/* action=login, POST body {user, pw} — the same fields the Mini app sends. */
function authLogin_(p, viaPost) {
  if (!viaPost) {
    return { status: 'error', code: 'post-only',
             message: 'Sign-in must be sent as a POST — update the page (reload it).' };
  }
  if (!authProp_('PASSWORD_HASH')) {
    return { status: 'error', code: 'unconfigured',
             message: 'Sign-in is not set up yet — run setStaffPassword in the Apps Script editor.' };
  }
  if (authFailCount_() >= AUTH_FAIL_LIMIT) {
    return { status: 'error', code: 'locked',
             message: 'Too many wrong passwords. Wait 15 minutes, then try again.' };
  }
  const want = authUser_().toLowerCase();
  const user = String((p && p.user) || '').trim().toLowerCase();
  const pw   = String((p && p.pw) || '');
  if (user !== want || !authCheckPw_(pw)) {
    authFailBump_();
    Utilities.sleep(600);                                    // blunt the speed of guessing
    return { status: 'error', code: 'bad-login', message: 'Wrong username or password.' };
  }
  authFailClear_();
  const exp = Date.now() + AUTH_TTL_MS;
  return { status: 'ok', token: authMakeToken_(exp), expires: exp, user: authUser_(),
           version: APP_VERSION, features: FEATURES };
}

/** RUN FROM THE EDITOR. Hashes <PREFIX>_PASSWORD_NEW into <PREFIX>_PASSWORD_HASH
    and deletes the plain copy. The password is never written in this file and
    never logged. Every device then signs in again. */
function setStaffPassword() {
  const p = authProps_(), newKey = AUTH_PREFIX + '_PASSWORD_NEW';
  const pw = String(p.getProperty(newKey) || '');
  if (!pw) {
    Logger.log('Nothing to do: add the Script Property ' + newKey + ' (the new password) first, then run this again.');
    return 'missing ' + newKey;
  }
  if (pw.length < 8) {
    p.deleteProperty(newKey);
    Logger.log('Too short: use at least 8 characters. ' + newKey + ' was deleted — add it again with a longer password.');
    return 'too short';
  }
  const salt = Utilities.getUuid().replace(/-/g, '');
  p.setProperty(AUTH_PREFIX + '_PASSWORD_HASH', 'v1$' + AUTH_PW_ROUNDS + '$' + salt + '$' + authHashPw_(pw, salt, AUTH_PW_ROUNDS));
  p.deleteProperty(newKey);
  authSecret_();
  authFailClear_();
  Logger.log('Password saved (hashed). ' + newKey + ' was deleted. Sign in with username ' +
             authUser_() + ' and the new password.');
  return 'ok';
}

/** RUN FROM THE EDITOR. Says which pieces are in place — never a value. */
function checkAuthSetup() {
  const p = authProps_();
  const lines = [
    AUTH_APP_LABEL + ' backend v' + APP_VERSION,
    'Username: ' + authUser_(),
    'Password: ' + (authProp_('PASSWORD_HASH') ? 'OK (hashed)' : 'MISSING — run setStaffPassword'),
    'Temporary password left behind: ' + (p.getProperty(AUTH_PREFIX + '_PASSWORD_NEW') ? 'YES — run setStaffPassword now' : 'none (OK)'),
    'Token secret: ' + (authSecret_() ? 'OK' : 'MISSING'),
    'Service key (read-only, optional): ' + (authProp_('SERVICE_KEY').length >= 32 ? 'OK'
        : (authProp_('SERVICE_KEY') ? 'TOO SHORT — needs 32+ characters' : 'not set')),
    'Enforce: ' + (authEnforced_() ? 'ON — refusals say nothing more' : 'off — anonymous reads still get NO rows; refusals carry the version')
  ];
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}

/** RUN FROM THE EDITOR if a device is lost or a token may have leaked: every
    device must sign in again (the password itself does not change). */
function signOutAllDevices() {
  authProps_().setProperty(AUTH_PREFIX + '_TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('Every device is signed out and must sign in again.');
  return 'ok';
}
/* ══ end SIGN-IN ══ */

/* One helper builds every data sheet, so a sheet added in a later version gets
   the same frozen, styled header row and — the part that matters on an upgrade
   — the same "append any header this version added" migration. Columns are
   only ever appended, never renumbered. */
function getNamedSheet(name, headers, widths) {
  const ss = book_();
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
  try { return book_().getSpreadsheetTimeZone() || 'Asia/Kolkata'; }
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
    const again = ridSeen_(p);
    if (again) return again;
    const id = 'CM' + Date.now();
    sh.appendRow(commitmentRow_(id, p, nowStamp_()));
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id:id, message:'Commitment saved.' });
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
    const again = ridSeen_(p);
    if (again) return again;
    const id = 'PL' + Date.now();
    sh.appendRow(planRow_(id, p, nowStamp_()));
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id:id, message:'Plan row saved.' });
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

/* ── ROUTER (v5.18) ─────────────────────────────────────────────────────────
   Every action except ping / login / logout passes authGate_() first — a
   write needs a signed-in token, a read needs a token or the read-only
   service key. GET and POST reach the same route; a POST's JSON body (the
   profile photo, the sign-in) joins the URL's parameters.
   The old web action 'migrate' (re-import the legacy Ledger — it CLEARS the
   Transactions tab first) is gone from the web; run migrateLedgerToTransactions()
   from the editor if it is ever needed again. */
function doGet(e)  { return respond_(route_((e && e.parameter) || {}, false)); }
function doPost(e) {
  const p = {}, q = (e && e.parameter) || {};
  Object.keys(q).forEach(function (k) { p[k] = q[k]; });
  try {
    if (e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      if (body && typeof body === 'object') Object.keys(body).forEach(function (k) { p[k] = body[k]; });
    }
  } catch (err) { /* not JSON — the query parameters stand on their own */ }
  return respond_(route_(p, true));
}
function respond_(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(p, viaPost) {
  const action = String(p.action || '');
  try {
    const refused = authGate_(action, p);
    if (refused) return refused;
    switch (action) {
      case 'ping':
        return authPingInfo_({ status:'ok', message:'IBI Finance Tracker GAS v' + APP_VERSION + ' is live!',
                               version: APP_VERSION, features: FEATURES });
      case 'login':            return authLogin_(p, viaPost);
      case 'logout':           return { status:'ok', message:'Signed out on this device.' };
      case 'getAll':           return getAllTransactions();
      case 'add':              return addTransaction(p);
      case 'update':           return updateTransaction(p);
      case 'delete':           return deleteTransaction(p.id);
      case 'saveCommitment':   return saveCommitment(p);
      case 'deleteCommitment': return deleteRowById(COMMIT_SHEET, COMMIT_HDRS, p.id);
      case 'savePlan':         return savePlan(p);
      case 'savePlans':        return savePlans(p);
      case 'deletePlan':       return deleteRowById(PLAN_SHEET, PLAN_HDRS, p.id);
      case 'saveBalance':      return saveBalance(p);
      case 'deleteBalance':    return deleteRowById(BAL_SHEET, BAL_HDRS, p.id);
      case 'moveToBalances':   return moveToBalances(p);
      case 'getProfile':       return getProfile_();
      case 'saveProfile':      return saveProfile_(p);
      default:                 return { status:'error', message:'Unknown action: ' + action };
    }
  } catch (err) {
    return { status:'error', message: err.toString() };
  }
}

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
           balances:      readBalances_(),
           profileAt:     Number(readSetting_('profileAt') || 0),
           version:     APP_VERSION,
           features:    FEATURES };
}

function addTransaction(p) {
  // One writer at a time: a slow first request and its repeat must never both
  // pass the NO REPEATS check before either has written.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const again = ridSeen_(p);
    if (again) return again;

    // Older page (no request id — a cached copy of the app): fall back to the
    // v5 guard — an identical payload inside 90 seconds is the same save.
    const cache = CacheService.getScriptCache();
    let key = '';
    if (!String(p.rid || '').trim()) {
      const fp = [p.date, p.type, p.description, p.party,
                  parseFloat(p.amount) || 0, p.note]
                  .map(x => String(x == null ? '' : x).trim()).join('|');
      key = 'add_' + Utilities.base64EncodeWebSafe(
            Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, fp));
      const seen = cache.get(key);
      if (seen) {
        return { status:'ok', id: seen, duplicate:true, message:'Duplicate suppressed — already saved.' };
      }
    }

    const sh  = getSheet();
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
    SpreadsheetApp.flush();

    if (key) cache.put(key, id, 90);
    return ridKeep_(p, { status:'ok', id: id, message:'Added successfully.' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
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

  const ss = book_();

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

/* ── NO REPEATS — idempotency key (pairs with the web app's NO REPEATS block) ──
   Every create the app sends (ledger entry, plan line, commitment) carries a
   request id, `rid`. A repeat of the same rid — a retry after a lost reply, a
   Save tapped again — gets the FIRST answer back instead of a second row.
   Checked INSIDE the script lock, so a slow first request and its repeat can
   never both write. Six hours is the CacheService maximum. */
function ridSeen_(p) {
  const rid = String((p && p.rid) || '').trim();
  if (!rid) return null;
  const hit = CacheService.getScriptCache().get('rid_' + rid.slice(0, 200));
  if (!hit) return null;
  const first = JSON.parse(hit);
  first.duplicate = true;
  first.message = 'Already saved — not added twice.';
  return first;
}
function ridKeep_(p, result) {
  const rid = String((p && p.rid) || '').trim();
  if (rid && result && result.status === 'ok') {
    CacheService.getScriptCache().put('rid_' + rid.slice(0, 200), JSON.stringify(result), 21600);
  }
  return result;
}

/* ── BANK & CASH BALANCES (shared by all three finance trackers' scripts) ────
   A balance is a READING of an account, not a transaction, so it lives in its
   own sheet and never reaches the ledger or any total. One row per reading.
   The Date column is plain TEXT (yyyy-MM-dd) and is read back with
   getDisplayValues(), so Sheets can never re-read 01-10-2026 as 10 January. */
const BAL_SHEET = 'Balances';
const BAL_HDRS  = ['ID', 'Account', 'Date', 'Balance', 'Note', 'CreatedAt'];
const BAL_WIDTHS = [150, 220, 110, 130, 300, 160];

function balSheet_() {
  const sh = getNamedSheet(BAL_SHEET, BAL_HDRS, BAL_WIDTHS);
  sh.getRange('C:C').setNumberFormat('@');
  return sh;
}
function balNum_(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
/* yyyy-MM-dd as written; a date typed into the sheet by hand as DD-MM-YYYY
   (the Indian order) is read that way too. */
function balIso_(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}
function balStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
}

function readBalances_() {
  const sh = getNamedSheet(BAL_SHEET, BAL_HDRS, BAL_WIDTHS);
  const data = sh.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];
  return data.slice(1)
    .filter(function (r) { return String(r[0] || '').trim() !== ''; })
    .map(function (r) {
      return { id: String(r[0]), account: String(r[1] || '').trim(), date: balIso_(r[2]),
               balance: balNum_(r[3]), note: String(r[4] || ''), createdAt: String(r[5] || '') };
    });
}

function saveBalance(p) {
  const account = String(p.account || '').trim().slice(0, 80);
  const date = balIso_(p.date);
  const bal = parseFloat(p.balance);
  if (!account) return { status:'error', message:'Name the account.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status:'error', message:'A balance needs a date.' };
  if (isNaN(bal)) return { status:'error', message:'Enter the balance.' };
  const note = String(p.note || '').slice(0, 400);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const sh = balSheet_();
    if (p.id) {
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
      for (let i = 1; i < ids.length; i++) {
        if (String(ids[i][0]) === String(p.id)) {
          sh.getRange(i + 1, 2, 1, 4).setValues([[account, date, bal, note]]);
          SpreadsheetApp.flush();
          return { status:'ok', id:String(p.id), message:'Balance updated.' };
        }
      }
      return { status:'error', message:'Balance reading not found: ' + p.id };
    }
    const again = ridSeen_(p);
    if (again) return again;
    const id = 'BL' + Date.now();
    sh.appendRow([id, account, date, bal, note, balStamp_()]);
    SpreadsheetApp.flush();
    return ridKeep_(p, { status:'ok', id:id, message:'Balance saved.' });
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* The one-time move of the old ₹1 / ₹0 balance rows out of the ledger. Each
   reading's ID is 'BL' + the ledger row's ID, so a repeat of the same request
   finds it already there and only finishes the delete — nothing is doubled. */
function moveToBalances(p) {
  let items;
  try { items = JSON.parse(p.items || '[]'); } catch (e) { return { status:'error', message:'Bad list.' }; }
  if (!Array.isArray(items) || !items.length) return { status:'error', message:'Nothing to move.' };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) {
    return { status:'error', message:'Busy — please try again in a moment.' };
  }
  try {
    const bs = balSheet_();
    const have = {};
    bs.getRange(1, 1, Math.max(bs.getLastRow(), 1), 1).getValues()
      .forEach(function (r) { have[String(r[0])] = true; });
    const tx = getSheet();
    const txIds = tx.getRange(1, 1, Math.max(tx.getLastRow(), 1), 1).getValues()
      .map(function (r) { return String(r[0]); });
    const add = [], del = [];
    let ok = 0;
    items.forEach(function (it) {
      const txId = String(it.txId || '').trim();
      const account = String(it.account || '').trim().slice(0, 80);
      const date = balIso_(it.date);
      const bal = parseFloat(it.balance);
      if (!txId || !account || isNaN(bal) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      ok++;
      const id = 'BL' + txId;
      if (!have[id]) { add.push([id, account, date, bal, String(it.note || '').slice(0, 400), balStamp_()]); have[id] = true; }
      const row = txIds.indexOf(txId);
      if (row > 0) del.push(row + 1);
    });
    if (add.length) bs.getRange(bs.getLastRow() + 1, 1, add.length, BAL_HDRS.length).setValues(add);
    del.sort(function (a, b) { return b - a; }).forEach(function (r) { tx.deleteRow(r); });
    SpreadsheetApp.flush();
    return { status:'ok', moved: ok, added: add.length, removed: del.length,
             message: 'Moved ' + add.length + ' into Balances; removed ' + del.length + ' ledger rows.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ── PROFILE — photo/logo, name and subtitle, shared by every device (v5.15) ──
   Ported from TSM / Mini. A hidden 'Settings' sheet holds key/value pairs;
   'profileAt' is the version stamp the app compares on each sync, so the
   photo travels only when it has changed. It arrives by POST (doPost). */
const SETTINGS_SHEET = 'Settings';
const PROFILE_MAX = 45000;                     // a Sheet cell holds 50,000 characters

function settingsSheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.appendRow(['Key', 'Value', 'UpdatedAt']);
    sh.setFrozenRows(1);
    styleHeader_(sh, 3);
    sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 420); sh.setColumnWidth(3, 170);
    sh.hideSheet();
  }
  return sh;
}
function readSetting_(key) {
  const rows = settingsSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === key) return String(rows[i][1] == null ? '' : rows[i][1]);
  return '';
}
function writeSetting_(key, value) {
  const sh = settingsSheet_();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) { sh.getRange(i + 1, 2, 1, 2).setValues([[value, nowStamp_()]]); return; }
  }
  sh.appendRow([key, value, nowStamp_()]);
}
function getProfile_() {
  const raw = readSetting_('profile');
  let profile = null;
  if (raw) { try { profile = JSON.parse(raw); } catch (e) { profile = null; } }
  return { status:'ok', profile: profile, profileAt: Number(readSetting_('profileAt') || 0) };
}
function saveProfile_(p) {
  const raw = String(p.profile == null ? '' : p.profile);
  if (!raw) return { status:'error', message:'No profile supplied.' };
  if (raw.length > PROFILE_MAX) return { status:'error', message:'That photo is too large to sync. Please choose a smaller picture.' };
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { status:'error', message:'Profile was not valid JSON.' }; }
  const clean = JSON.stringify({ name: String(obj.name || '').slice(0, 120), sub: String(obj.sub || '').slice(0, 160), photo: String(obj.photo || '') });
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { status:'error', message:'Busy — please try again in a moment.' }; }
  try {
    const at = Date.now();
    writeSetting_('profile', clean);
    writeSetting_('profileAt', String(at));
    SpreadsheetApp.flush();
    return { status:'ok', profileAt: at, message:'Profile saved.' };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ── One spreadsheet handle per request (v5.17) ─────────────────────────────
   getAll used to call openById six times — once per sheet — and each call is
   a round trip inside Google. The handle is opened once and reused. */
let _book = null;
function book_() { return _book || (_book = SpreadsheetApp.openById(SHEET_ID)); }
