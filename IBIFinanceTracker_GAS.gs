// IBI Finance Tracker — GAS Backend v2.0
// India Business International — Finance & Accounts Ledger
// Sheet ID: 1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE
// All requests via GET (URL params) — avoids CORS/redirect issues
// Deploy → Web App → Execute as Me → Access: Anyone

const SHEET_ID   = "1hbh5E9kzX4632d4kaMHLXC-Aqhi5exgEJWOxMtSrttE";
const SHEET_NAME = "Transactions";
const HEADERS    = ["ID","Date","Type","Description","Party","Amount","Note","CreatedAt"];

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
        result = { status:'ok', message:'IBI Finance Tracker GAS v2.0 is live!' };
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
  const sh   = getSheet();
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return { status:'ok', transactions:[] };

  const rows = data.slice(1).map(r => ({
    id:          String(r[0]),
    date:        r[1] ? Utilities.formatDate(new Date(r[1]), 'Asia/Kolkata', 'yyyy-MM-dd') : '',
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
