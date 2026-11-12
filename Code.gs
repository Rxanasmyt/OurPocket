// ============================================================
//  Our Wallet - Google Apps Script backend
//
//  แท็บที่ระบบสร้างให้ (เรียงจากซ้ายไปขวา):
//    "สรุป"       แดชบอร์ดประจำเดือน + กราฟ
//    "ลำดับจ่าย"   บิลที่ยังไม่จ่าย เรียงตามวันครบกำหนด พร้อมความเร่งด่วนและกราฟ
//    "รายเดือน"    ตารางรายการของเดือนที่เลือก ดู ทั้งหมด / รายรับ / รายจ่าย
//    "รายการ"     ข้อมูลทั้งหมดที่แอปบันทึก (แก้ในแอป ไม่ต้องแก้ในชีต)
//    "ตั้งค่า"     งบประมาณรายเดือน
//
//  สิทธิ์แก้ไข: ทุกแท็บล็อกให้เจ้าของไฟล์เท่านั้นที่แก้ได้ ต้อง Deploy แบบ "ดำเนินการในฐานะ: ฉัน (เจ้าของ)" เพื่อให้แอปบันทึกได้
//  ความปลอดภัย: Project Settings > Script properties > เพิ่ม WALLET_KEY = รหัสของคุณ
//    แล้วใส่รหัสเดียวกันในแอป (ปุ่มเฟือง). ถ้าไม่ตั้ง ใครรู้ URL ก็อ่าน/เขียนข้อมูลได้
//
//  ===== เมื่อต้องเพิ่ม/เปลี่ยนข้อมูลที่แอปบันทึก (สำหรับผู้พัฒนา) =====
//   1) เพิ่มคอลัมน์ใหม่ที่ "ท้าย" SCHEMA ด้านล่างเท่านั้น (อย่าเปลี่ยนชื่อหัวคอลัมน์เดิม)
//   2) ถ้าต้องการให้ขึ้นในแดชบอร์ด/ตาราง ให้แก้ฟังก์ชัน buildDashboard_/buildPlan_/buildMonthly_
//   3) เพิ่มเลข SETUP_VERSION แล้ว Deploy ใหม่ ระบบจะเพิ่มคอลัมน์และเติมข้อมูลเก่าให้เอง
//   ข้อมูลต้นฉบับเก็บไว้ครบในคอลัมน์ RAW_JSON เสมอ จึงไม่มีข้อมูลหายแม้ยังไม่มีคอลัมน์รองรับ
//
//  เมนู "💖 Our Wallet" ในชีต: จัดรูปแบบใหม่ / เติมข้อมูลทุกแถวใหม่ / ตรวจข้อมูล
// ============================================================

var SHEET_DATA = 'รายการ';
var SHEET_DASH = 'สรุป';
var SHEET_PLAN = 'ลำดับจ่าย';
var SHEET_MONTH = 'รายเดือน';
var SHEET_SET = 'ตั้งค่า';
var SHEET_FILTER = 'ค้นหา';
var SETUP_VERSION = 'v17';
// API_VERSION: เพิ่มทุกครั้งที่รูปแบบการคุยกับแอปเปลี่ยน (แอปจะไม่ส่งข้อมูลถ้าสคริปต์เก่ากว่าที่แอปต้องการ)
var API_VERSION = 8;
var SCRIPT_VERSION = 'Our Wallet script v' + API_VERSION;

var EXPENSE_CATEGORIES = ['อาหาร', 'เดินทาง', 'ช้อปปิ้ง', 'ที่พัก', 'สุขภาพ', 'หนี้สิน', 'อื่นๆ'];
var PEOPLE = ['Anas', 'Phada'];
var INCOME_CATEGORIES = ['เงินเดือน', 'ค่าเสี่ยงภัย', 'ค่า พตส', 'ค่าเวร', 'ค่าใบประกอบ', 'ค่า ฉ.10', 'ค่า ฉ.11', 'ค่า ฉ.10 และ ฉ.11', 'ค่าเงินประจำตำแหน่ง'];

// สีธนาคาร (ตรงกับในแอป)
var BANK_ORDER = ['KBank', 'SCB', 'BBL', 'KTB', 'กรุงศรี', 'ttb', 'ออมสิน', 'Credit Card', 'เงินสด'];
var BANK_COLORS = {
  'KBank': ['#138f2d', '#ffffff'], 'SCB': ['#4e2e7f', '#ffffff'], 'BBL': ['#1e4598', '#ffffff'],
  'KTB': ['#1ba5e0', '#ffffff'], 'กรุงศรี': ['#fec43b', '#5b4300'], 'ttb': ['#ee6b1e', '#ffffff'],
  'ออมสิน': ['#eb0f7f', '#ffffff'], 'Credit Card': ['#1f2937', '#ffffff'], 'เงินสด': ['#64748b', '#ffffff']
};

var COLOR_PRIMARY = '#ff4d6d';
var COLOR_DARK = '#c9184a';
var COLOR_SOFT = '#fff0f3';
var COLOR_INCOME = '#10b981';
var COLOR_EXPENSE = '#ef4444';

// ------------------------------------------------------------
//  SCHEMA: คอลัมน์ในแท็บ "รายการ"  (h = หัวคอลัมน์, get = ค่าที่เขียนจากข้อมูลของแอป)
//  ตัวเลขที่ไม่เกี่ยวข้องให้ใส่ '' (ว่าง) ไม่ใช่ '-' เพื่อให้สูตรและ QUERY ทำงานถูกต้อง
// ------------------------------------------------------------
function isIncome_(d) { return d.type === 'income'; }
function numOrBlank_(v) { var n = Number(v); return (v === null || v === undefined || v === '' || isNaN(n)) ? '' : n; }
function nowText_() { return Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss"); }

function payModeLabel_(d) {
  if (isIncome_(d)) return '-';
  if (d.payMode === 'minpay') return 'ผ่อนบัตร: จ่ายขั้นต่ำ';
  if (d.payMode === 'installment' || (!d.payMode && Number(d.totalInstallments) > 0)) return 'ผ่อนบัตร: จ่ายเป็นงวด';
  return 'จ่ายปกติ';
}

var SCHEMA = [
  {h: 'ประเภท', w: 80, align: 'center', get: function (d) { return isIncome_(d) ? 'รายรับ' : 'รายจ่าย'; }},
  {h: 'วันที่', w: 100, fmt: '@', align: 'center', get: function (d) { return d.date || '-'; }},
  {h: 'เดือน-ปี', w: 80, fmt: '@', align: 'center', get: function (d) { return d.monthYear || '-'; }},
  {h: 'หมวดหมู่', w: 110, fmt: '@', align: 'center', get: function (d) { return d.category || '-'; }},
  {h: 'รายการ', w: 240, fmt: '@', get: function (d) { return d.description || '-'; }},
  {h: 'คนทำรายการ', w: 100, fmt: '@', align: 'center', get: function (d) { return d.who || '-'; }},
  {h: 'ธนาคาร', w: 100, fmt: '@', align: 'center', get: function (d) { return isIncome_(d) ? '-' : (d.bank || '-'); }},
  {h: 'งวดที่', w: 70, fmt: '0', align: 'center', get: function (d) { return isIncome_(d) ? '' : numOrBlank_(d.currentInstallment); }},
  {h: 'รวมงวด', w: 80, fmt: '0', align: 'center', get: function (d) { return isIncome_(d) ? '' : numOrBlank_(d.totalInstallments); }},
  {h: 'จำนวนเงิน', w: 120, fmt: '#,##0.00', align: 'right', bold: true, get: function (d) { return Number(isIncome_(d) ? d.netAmount : d.amount) || 0; }},
  {h: 'สถานะ', w: 120, align: 'center', get: function (d) { return isIncome_(d) ? '-' : (d.isCompleted ? 'เสร็จสิ้น' : 'รอดำเนินการ'); }},
  {h: 'บันทึกเมื่อ', w: 150, fmt: '@', align: 'center', color: '#9ca3af', get: function (d, old) { return old ? old : nowText_(); }},
  {h: 'ID', w: 120, fmt: '@', hidden: true, get: function (d) { return d.id || '-'; }},
  {h: 'RAW_JSON', w: 120, hidden: true, get: function (d) { return JSON.stringify(d); }},
  {h: 'รูปแบบการจ่าย', w: 170, align: 'center', get: function (d) { return payModeLabel_(d); }},
  {h: 'ยอดเต็มบิล', w: 110, fmt: '#,##0.00', align: 'right', get: function (d) { return d.payMode === 'minpay' ? numOrBlank_(d.fullAmount) : ''; }},
  {h: 'ขั้นต่ำ / ต่องวด', w: 130, fmt: '#,##0.00', align: 'right', get: function (d) {
    if (isIncome_(d)) return '';
    if (d.payMode === 'minpay') return numOrBlank_(d.minAmount);
    if (d.payMode === 'installment' || Number(d.totalInstallments) > 0) return numOrBlank_(d.installmentAmount !== undefined && d.installmentAmount !== null ? d.installmentAmount : d.amount);
    return '';
  }},
  {h: 'คงค้าง', w: 110, fmt: '#,##0.00', align: 'right', get: function (d) { return d.payMode === 'minpay' ? numOrBlank_(d.remainingAmount) : ''; }},
  // ---- เพิ่มใน v7 ----
  {h: 'ยอดก่อนหัก', w: 110, fmt: '#,##0.00', align: 'right', get: function (d) { return isIncome_(d) ? numOrBlank_(d.amount) : ''; }},
  {h: 'หัก ณ ที่จ่าย %', w: 100, fmt: '0"%"', align: 'center', get: function (d) { return isIncome_(d) ? (Number(d.taxRate) || 0) : ''; }},
  {h: 'ที่มา', w: 120, align: 'center', get: function (d) { return d.autoGenerated ? 'สร้างอัตโนมัติ' : 'กรอกเอง'; }},
  // ---- เพิ่มใน v14 ----
  {h: 'รับประจำ', w: 90, align: 'center', get: function (d) { return (isIncome_(d) && d.recurring) ? 'ทุกเดือน' : ''; }},
  // ---- เพิ่มใน v15 ----
  // เงินเดือนที่รับปลายเดือนแต่ใช้จ่ายเดือนถัดไป: วันที่ = วันที่รับจริง, เดือน-ปี = เดือนที่นับเป็นรายรับ
  {h: 'นับเป็นเดือนถัดไป', w: 110, align: 'center', get: function (d) { return (isIncome_(d) && d.useNext) ? 'ใช่' : ''; }},
  // ---- เพิ่มใน v16 ----
  // เงินประจำเดือน (เช่น เงินเดือนของ 2026-10) ไว้ตรวจย้อนหลัง: รับได้ตั้งแต่วันที่ 25 ของเดือนนั้นถึงวันที่ 20 ของเดือนถัดไป
  {h: 'เงินประจำเดือน', w: 110, fmt: '@', align: 'center', get: function (d) { return (isIncome_(d) && d.periodMonth) ? String(d.periodMonth) : ''; }},
  // ---- เพิ่มใน v17 ----
  {h: 'โน้ต', w: 240, fmt: '@', get: function (d) { return d.note ? String(d.note) : ''; }}
];

// ------------------------------------------------------------
//  Utilities
// ------------------------------------------------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// เลขรุ่นของข้อมูล: เพิ่มทุกครั้งที่มีการเขียน/ลบ ใช้ให้แอปเช็กว่ามีอะไรเปลี่ยนหรือไม่โดยไม่ต้องอ่านทั้งชีต (ซิงค์เร็ว)
function readRev_() { return Number(PropertiesService.getScriptProperties().getProperty('rev')) || 0; }
function bumpRev_() { var p = PropertiesService.getScriptProperties(); var r = (Number(p.getProperty('rev')) || 0) + 1; p.setProperty('rev', String(r)); return r; }
function fail_(code, message) { return {status: "error", code: code, message: message}; }

function walletKey_() { return PropertiesService.getScriptProperties().getProperty('WALLET_KEY') || ''; }
function authorized_(key) { var k = walletKey_(); return !k || String(key || '') === k; }
function unauthorized_() { return json_({status: "error", code: "unauthorized", message: "รหัสผ่านไม่ถูกต้อง"}); }

function headerMap_(sh) {
  var last = sh.getLastColumn();
  var map = {};
  if (last < 1) return map;
  var row = sh.getRange(1, 1, 1, last).getValues()[0];
  for (var i = 0; i < row.length; i++) if (row[i] !== '' && row[i] !== null) map[String(row[i])] = i + 1;
  return map;
}

// ทำให้แท็บ "รายการ" มีคอลัมน์ครบตาม SCHEMA (เติมเฉพาะที่ขาด ไม่แตะข้อมูลเดิม)
function ensureColumns_(sh) {
  var map = headerMap_(sh);
  var next = 1;
  for (var k in map) if (map.hasOwnProperty(k) && map[k] >= next) next = map[k] + 1;
  for (var i = 0; i < SCHEMA.length; i++) {
    var h = SCHEMA[i].h;
    if (!map[h]) {
      if (next > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), next - sh.getMaxColumns());
      sh.getRange(1, next).setValue(h);
      map[h] = next;
      next++;
    }
  }
  return map;
}

function getDataSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_DATA);
  if (!sh) {
    var first = ss.getSheets()[0];
    var reserved = [SHEET_DASH, SHEET_PLAN, SHEET_MONTH, SHEET_FILTER, SHEET_SET];
    // ใช้แท็บเดิมที่มีข้อมูลอยู่แล้ว ถ้ายังไม่ใช่แท็บที่ระบบสร้าง
    if (first && reserved.indexOf(first.getName()) === -1) { first.setName(SHEET_DATA); sh = first; }
    else sh = ss.insertSheet(SHEET_DATA);
  }
  return sh;
}

// แปลงข้อมูลจากแอป -> แถวในชีต (คงคอลัมน์ที่ผู้ใช้เพิ่มเองไว้)
function buildRow_(d, map, existing, width) {
  var row = [];
  for (var i = 0; i < width; i++) row.push(existing ? existing[i] : '');
  for (var c = 0; c < SCHEMA.length; c++) {
    var idx = map[SCHEMA[c].h];
    if (idx) row[idx - 1] = SCHEMA[c].get(d, existing ? existing[idx - 1] : null);
  }
  return row;
}

function findRowById_(sh, map, id) {
  if (!id || !map['ID']) return -1;
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, map['ID'], last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function readAllData_(sh, map) {
  var last = sh.getLastRow();
  var out = [];
  if (last < 2 || !map['RAW_JSON']) return out;
  var raws = sh.getRange(2, map['RAW_JSON'], last - 1, 1).getValues();
  for (var i = 0; i < raws.length; i++) {
    var raw = raws[i][0];
    if (raw && typeof raw === 'string' && raw.charAt(0) === '{') {
      try {
        var d = JSON.parse(raw);
        if (isRecord_(d)) out.push(d);
      } catch (err) {}
    }
  }
  return out;
}

function isRecord_(d) { return !!(d && d.id && (d.type === 'income' || d.type === 'expense')); }

// ลบแถวขยะที่สคริปต์เวอร์ชันเก่าอาจสร้างไว้ (เช่นคำขอซิงค์ที่ถูกบันทึกเป็นรายการ)
function purgeJunkRows_(sh) {
  var map = headerMap_(sh);
  var last = sh.getLastRow();
  if (last < 2 || !map['RAW_JSON']) return 0;
  var raws = sh.getRange(2, map['RAW_JSON'], last - 1, 1).getValues();
  var removed = 0;
  for (var i = raws.length - 1; i >= 0; i--) {
    var raw = raws[i][0];
    if (!raw || typeof raw !== 'string' || raw.charAt(0) !== '{') continue;   // แถวที่พิมพ์เอง: ไม่แตะ
    var junk = false;
    try { junk = !isRecord_(JSON.parse(raw)); } catch (err) { junk = false; }
    if (junk) { sh.deleteRow(i + 2); removed++; }
  }
  return removed;
}

function syncPayload_(ss) {
  ensureSetup_(ss);
  var sh = getDataSheet_(ss);
  return {status: "success", data: readAllData_(sh, headerMap_(sh)), budgets: readBudgets_(ss), rev: readRev_()};
}

// ------------------------------------------------------------
//  Web app endpoints
// ------------------------------------------------------------
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'sync') {
    // เมื่อตั้งรหัสผ่านแล้ว ไม่ส่งข้อมูลผ่าน GET (กันรหัสหลุดใน URL) ให้แอปใช้ POST
    if (walletKey_()) return unauthorized_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return json_({status: "error"});
    return json_(syncPayload_(ss));
  }
  return ContentService.createTextOutput("✅ " + SCRIPT_VERSION + " is running").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    if (!e || !e.postData) return json_(fail_('bad_request', 'ไม่มีข้อมูลส่งมาถึงสคริปต์'));
    var data;
    try { data = JSON.parse(e.postData.contents); } catch (pe) { return json_(fail_('bad_request', 'อ่านข้อมูลที่ส่งมาไม่ได้')); }
    if (!authorized_(data.key)) return unauthorized_();
    delete data.key; // ห้ามเก็บรหัสผ่านลงชีต

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return json_(fail_('no_spreadsheet', 'สคริปต์ไม่ได้ผูกกับ Google Sheet (ต้องสร้างจาก Extensions > Apps Script ในชีตนั้น)'));

    if (data.action === 'sync') {
      // ถ้าแอปมีข้อมูลรุ่นล่าสุดอยู่แล้ว ตอบสั้นๆ ไม่ต้องอ่านทั้งชีต
      if (data.since && Number(data.since) === readRev_()) return json_({status: "success", unchanged: true, rev: readRev_()});
      return json_(syncPayload_(ss));
    }
    if (data.action === 'ping') return json_(pingInfo_(ss));

    try { lock.waitLock(20000); locked = true; }
    catch (le) { return json_(fail_('lock_timeout', 'ชีตกำลังถูกใช้งานพร้อมกันหลายเครื่อง ลองใหม่อีกครั้ง')); }

    ensureSetup_(ss);
    var sheet = getDataSheet_(ss);
    var map = headerMap_(sheet);

    if (data.action === 'selftest') return json_(selfTest_(ss, sheet, map));

    if (data.action === 'batch') {
      var items = data.items || [], results = [], changed = false;
      for (var i = 0; i < items.length; i++) {
        var one;
        // รายการหนึ่งผิดพลาดต้องไม่ทำให้รายการอื่นในชุดเดียวกันหายไปจากผลลัพธ์ และต้องเพิ่มเลขรุ่นถ้ามีรายการที่เขียนไปแล้ว
        try { one = applyOne_(ss, sheet, map, items[i] || {}); }
        catch (itemErr) { one = {status: "error", code: "exception", message: itemErr.toString()}; }
        if (one.changed) changed = true;
        results.push({status: one.status, code: one.code, message: one.message});
      }
      return json_({status: "success", results: results, rev: changed ? bumpRev_() : readRev_()});
    }

    var res = applyOne_(ss, sheet, map, data);
    res.rev = res.changed ? bumpRev_() : readRev_();
    return json_(res);
  } catch (error) {
    return json_(fail_('exception', error.toString()));
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (x) {} }
  }
}

// ทำงาน 1 คำสั่ง: งบประมาณ / ลบ / เพิ่ม-แก้ไขรายการ (ต้องถือ lock อยู่)
function applyOne_(ss, sheet, map, d) {
  if (d.action === 'budget') {
    if (!d.month) return {status: "error", code: "invalid_record", message: "ไม่มีเดือนของงบประมาณ"};
    saveBudget_(ss, d.month, Number(d.amount) || 0);
    return {status: "success", message: "budget saved", changed: true};
  }
  if (d.action === 'delete') {
    if (!d.id) return {status: "error", code: "invalid_record", message: "ไม่มี id ที่จะลบ"};
    var row = findRowById_(sheet, map, d.id);
    if (row > -1) { sheet.deleteRow(row); return {status: "success", message: "deleted", changed: true}; }
    return {status: "success", message: "already deleted", changed: false};
  }
  if (d.action) return {status: "error", code: "bad_request", message: "ไม่รู้จักคำสั่ง " + d.action};
  if (!isRecord_(d)) return {status: "error", code: "invalid_record", message: "ข้อมูลรายการไม่ครบ (ต้องมี id และประเภทรายรับ/รายจ่าย)"};
  upsertRecord_(sheet, map, d);
  return {status: "success", changed: true};
}

function upsertRecord_(sheet, map, data) {
  var width = sheet.getLastColumn();
  var rowIndex = findRowById_(sheet, map, data.id);
  var existing = null;
  if (rowIndex > -1) existing = sheet.getRange(rowIndex, 1, 1, width).getValues()[0];
  var row = buildRow_(data, map, existing, width);
  if (rowIndex > -1) {
    sheet.getRange(rowIndex, 1, 1, width).setValues([row]);
  } else {
    var target = Math.max(sheet.getLastRow() + 1, 2);
    if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
    sheet.getRange(target, 1, 1, width).setValues([row]);
  }
}

// ------------------------------------------------------------
//  ตรวจการเชื่อมต่อ (แอปกด "ทดสอบการเชื่อมต่อ")
// ------------------------------------------------------------
function pingInfo_(ss) {
  var sh = ss.getSheetByName(SHEET_DATA);
  var props = PropertiesService.getScriptProperties();
  return {
    status: "success", version: SCRIPT_VERSION,
    keyProtected: !!walletKey_(),
    rows: sh ? Math.max(sh.getLastRow() - 1, 0) : 0,
    setupVersion: props.getProperty('setup') || '',
    setupErrors: props.getProperty('setupErrors') || ''
  };
}

// เขียน-อ่าน-ลบ แถวทดสอบ 1 แถว เพื่อยืนยันว่าบันทึกลงชีตได้จริง
function selfTest_(ss, sheet, map) {
  var id = 'selftest-' + new Date().getTime();
  var rec = {id: id, type: 'expense', date: '2000-01-01', monthYear: '2000-01', category: 'อื่นๆ', who: 'test',
    description: 'ทดสอบการเชื่อมต่อ', bank: 'เงินสด', amount: 1, isCompleted: true};
  var result = {status: "success", version: SCRIPT_VERSION, keyProtected: !!walletKey_(), write: false, read: false, delete: false};
  try {
    upsertRecord_(sheet, map, rec);
    result.write = true;
    var row = findRowById_(sheet, map, id);
    result.read = row > -1 && String(sheet.getRange(row, map['รายการ']).getValue()) === rec.description;
  } finally {
    var del = findRowById_(sheet, map, id);
    if (del > -1) { sheet.deleteRow(del); result.delete = true; } else { result.delete = !result.write; }
  }
  result.rows = Math.max(sheet.getLastRow() - 1, 0);
  if (!(result.write && result.read && result.delete)) result.status = "error";
  return result;
}

// ------------------------------------------------------------
//  งบประมาณ
// ------------------------------------------------------------
function readBudgets_(ss) {
  var sh = ss.getSheetByName(SHEET_SET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] !== '' && Number(vals[i][1]) > 0) out[String(vals[i][0])] = Number(vals[i][1]);
  }
  return out;
}

function saveBudget_(ss, month, amount) {
  var sh = ensureSettingsSheet_(ss);
  var last = sh.getLastRow();
  var row = -1;
  if (last >= 2) {
    var months = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < months.length; i++) if (String(months[i][0]) === String(month)) { row = i + 2; break; }
  }
  if (row === -1) row = Math.max(last + 1, 2);
  sh.getRange(row, 1, 1, 2).setValues([[month, amount]]);
}

function ensureSettingsSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_SET);
  if (!sh) {
    sh = ss.insertSheet(SHEET_SET);
    sh.getRange(1, 1, 1, 2).setValues([["เดือน (yyyy-MM)", "งบประมาณ (บาท)"]]);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setHorizontalAlignment('center');
    sh.getRange(2, 1, 500, 1).setNumberFormat('@');
    sh.getRange(2, 2, 500, 1).setNumberFormat('#,##0');
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(2, 150);
    sh.setFrozenRows(1);
    sh.setTabColor(COLOR_DARK);
  }
  return sh;
}

// ------------------------------------------------------------
//  ตั้งค่าครั้งแรก (ทำอัตโนมัติ 1 ครั้งต่อเวอร์ชัน) / รันใหม่เองได้จากเมนู
// ------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💖 Our Wallet')
    .addItem('จัดรูปแบบและสร้างแดชบอร์ดใหม่', 'setupAll')
    .addItem('เติมข้อมูลทุกแถวใหม่ (หลังเพิ่มคอลัมน์)', 'refreshAll')
    .addItem('ตรวจสอบข้อมูล', 'checkData')
    .addToUi();
}

function setupAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().deleteProperty('setup');
  ensureSetup_(ss);
  var errs = PropertiesService.getScriptProperties().getProperty('setupErrors');
  SpreadsheetApp.getUi().alert(errs ? 'สร้างเสร็จ แต่มีบางขั้นตอนผิดพลาด:\n' + errs : '✅ จัดรูปแบบและสร้างแดชบอร์ดเรียบร้อย');
}

function refreshAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getDataSheet_(ss);
  ensureColumns_(sh);
  var n = refreshRows_(sh);
  SpreadsheetApp.getUi().alert('✅ เติมข้อมูลใหม่แล้ว ' + n + ' แถว');
}

function ensureSetup_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('setup') === SETUP_VERSION) return;
  var errors = [];
  var step = function (name, fn) { try { fn(); } catch (err) { errors.push(name + ': ' + err); } };

  var dataSheet = getDataSheet_(ss);
  step('columns', function () { ensureColumns_(dataSheet); });       // จำเป็นต่อการบันทึก
  step('format', function () { formatDataSheet_(dataSheet); });
  step('cleanup', function () { purgeJunkRows_(dataSheet); });
  step('refresh', function () { refreshRows_(dataSheet); });
  step('settings', function () { protectOwner_(ensureSettingsSheet_(ss), 'งบประมาณ: ตั้งในแอป Our Wallet (เจ้าของไฟล์เท่านั้นที่แก้ในชีตได้)', null); });
  step('dashboard', function () { buildDashboard_(ss); });
  step('plan', function () { buildPlan_(ss); });
  step('monthly', function () { buildMonthly_(ss); });
  step('filter', function () { buildFilter_(ss); });
  step('order', function () { ensureSheetOrder_(ss); });

  props.setProperty('setupErrors', errors.join('\n'));
  props.setProperty('setup', SETUP_VERSION);
}

// เติมคอลัมน์ทุกแถวใหม่จาก RAW_JSON (ใช้หลังเพิ่มคอลัมน์ใน SCHEMA) ไม่แตะแถวที่ไม่มี JSON
function refreshRows_(sh) {
  var map = headerMap_(sh);
  var last = sh.getLastRow();
  if (last < 2 || !map['RAW_JSON']) return 0;
  var width = sh.getLastColumn();
  var range = sh.getRange(2, 1, last - 1, width);
  var vals = range.getValues();
  var changed = 0;
  for (var i = 0; i < vals.length; i++) {
    var raw = vals[i][map['RAW_JSON'] - 1];
    if (!raw || typeof raw !== 'string' || raw.charAt(0) !== '{') continue;
    var d;
    try { d = JSON.parse(raw); } catch (err) { continue; }
    vals[i] = buildRow_(d, map, vals[i], width);
    changed++;
  }
  range.setValues(vals);
  return changed;
}

// ตรวจความสอดคล้อง: แถวไม่มี JSON, ID ซ้ำ, ค่าในชีตไม่ตรงกับข้อมูลที่แอปเห็น (เช่นถูกแก้มือในชีต)
function checkData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getDataSheet_(ss);
  var r = checkData_(sh);
  var msg = 'แถวข้อมูล: ' + r.rows + '\n' +
    'แถวที่ไม่มี JSON (แอปมองไม่เห็น): ' + r.noJson + '\n' +
    'ID ซ้ำ: ' + r.duplicates + '\n' +
    'แถวที่ค่าในชีตไม่ตรงกับข้อมูลในแอป (แก้มือในชีต): ' + r.mismatch + '\n\n' +
    (r.noJson + r.duplicates + r.mismatch === 0 ? '✅ ข้อมูลสมบูรณ์' : 'ควรแก้ข้อมูลในแอป แล้วใช้เมนู "เติมข้อมูลทุกแถวใหม่"');
  SpreadsheetApp.getUi().alert(msg);
}

function checkData_(sh) {
  var map = headerMap_(sh);
  var last = sh.getLastRow();
  var res = {rows: 0, noJson: 0, duplicates: 0, mismatch: 0};
  if (last < 2) return res;
  var width = sh.getLastColumn();
  var vals = sh.getRange(2, 1, last - 1, width).getValues();
  var seen = {};
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var empty = true;
    for (var c = 0; c < row.length; c++) if (row[c] !== '' && row[c] !== null) { empty = false; break; }
    if (empty) continue;
    res.rows++;
    var raw = row[map['RAW_JSON'] - 1];
    if (!raw || typeof raw !== 'string' || raw.charAt(0) !== '{') { res.noJson++; continue; }
    var d;
    try { d = JSON.parse(raw); } catch (err) { res.noJson++; continue; }
    var id = String(d.id);
    if (seen[id]) res.duplicates++; else seen[id] = true;
    var keys = ['ประเภท', 'วันที่', 'หมวดหมู่', 'รายการ', 'จำนวนเงิน', 'สถานะ'];
    for (var k = 0; k < keys.length; k++) {
      var def = null;
      for (var s = 0; s < SCHEMA.length; s++) if (SCHEMA[s].h === keys[k]) def = SCHEMA[s];
      if (def && String(def.get(d, null)) !== String(row[map[keys[k]] - 1])) { res.mismatch++; break; }
    }
  }
  return res;
}

// ------------------------------------------------------------
//  จัดรูปแบบตารางข้อมูล (แท็บ "รายการ")
// ------------------------------------------------------------
function formatDataSheet_(sh) {
  var map = headerMap_(sh);
  var cols = sh.getLastColumn();
  var minRows = 2000;
  if (sh.getMaxRows() < minRows) sh.insertRowsAfter(sh.getMaxRows(), minRows - sh.getMaxRows());
  var n = sh.getMaxRows();

  sh.setTabColor(COLOR_PRIMARY);
  sh.getRange(1, 1, n, cols).setFontFamily('Sarabun').setFontSize(10).setVerticalAlignment('middle');

  var header = sh.getRange(1, 1, 1, cols);
  header.setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(0);

  var hidden = [];
  for (var i = 0; i < SCHEMA.length; i++) {
    var c = SCHEMA[i], col = map[c.h];
    if (!col) continue;
    var body = sh.getRange(2, col, n - 1, 1);
    if (c.fmt) body.setNumberFormat(c.fmt);
    if (c.align) body.setHorizontalAlignment(c.align);
    if (c.bold) body.setFontWeight('bold');
    if (c.color) body.setFontColor(c.color);
    sh.setColumnWidth(col, c.w);
    if (c.hidden) hidden.push(col);
  }

  // สลับสีแถว
  var bandings = sh.getBandings();
  for (var b = 0; b < bandings.length; b++) bandings[b].remove();
  var banding = sh.getRange(1, 1, n, cols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  banding.setHeaderRowColor(COLOR_PRIMARY).setFirstRowColor('#ffffff').setSecondRowColor(COLOR_SOFT);

  // สีตามประเภท / สถานะ / ธนาคาร / ที่มา
  var rng = function (h) { return sh.getRange(2, map[h], n - 1, 1); };
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายรับ').setBackground('#d1fae5').setFontColor('#047857').setBold(true).setRanges([rng('ประเภท')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายจ่าย').setBackground('#fee2e2').setFontColor('#b91c1c').setBold(true).setRanges([rng('ประเภท')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('เสร็จสิ้น').setBackground('#d1fae5').setFontColor('#047857').setRanges([rng('สถานะ')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รอดำเนินการ').setBackground('#fef3c7').setFontColor('#b45309').setBold(true).setRanges([rng('สถานะ')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('ขั้นต่ำ').setBackground('#fef3c7').setFontColor('#b45309').setRanges([rng('รูปแบบการจ่าย')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('เป็นงวด').setBackground('#ede9fe').setFontColor('#6d28d9').setRanges([rng('รูปแบบการจ่าย')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('จ่ายปกติ').setBackground('#e0f2fe').setFontColor('#0369a1').setRanges([rng('รูปแบบการจ่าย')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('สร้างอัตโนมัติ').setFontColor('#7c3aed').setBold(true).setRanges([rng('ที่มา')]).build()
  ];
  for (var k = 0; k < BANK_ORDER.length; k++) {
    var bank = BANK_ORDER[k];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(bank)
      .setBackground(BANK_COLORS[bank][0]).setFontColor(BANK_COLORS[bank][1]).setBold(true).setRanges([rng('ธนาคาร')]).build());
  }
  sh.setConditionalFormatRules(rules);

  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, n, cols).createFilter();
  for (var h = 0; h < hidden.length; h++) sh.hideColumns(hidden[h]);

  // เจ้าของไฟล์เท่านั้นที่แก้ได้: ข้อมูลจริงอยู่ที่ RAW_JSON ให้แก้/ลบในแอป Our Wallet
  protectOwner_(sh, 'แก้/ลบข้อมูลในแอป Our Wallet (แอปอ่านจากคอลัมน์ RAW_JSON) เจ้าของไฟล์เท่านั้นที่แก้ในชีตได้', null);
}

// ------------------------------------------------------------
//  Helpers สำหรับสร้างแท็บสรุป
// ------------------------------------------------------------
function resetSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return ss.insertSheet(name);
  sh.getCharts().forEach(function (ch) { sh.removeChart(ch); });
  var all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.clearDataValidations();
  try { all.breakApart(); } catch (e) {}
  sh.clearConditionalFormatRules();
  sh.showColumns(1, sh.getMaxColumns());
  try {
    var prots = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var i = 0; i < prots.length; i++) prots[i].remove();
  } catch (e) {}
  sh.clear();
  return sh;
}

// ล็อกแท็บให้เจ้าของไฟล์เท่านั้นที่แก้ได้ (คนอื่นเปิดดูได้อย่างเดียว) สคริปต์รันในนามเจ้าของจึงยังบันทึกจากแอปได้ปกติ
// ช่องที่ผู้ใช้ต้องกรอก (เช่น ช่องเลือกเดือน) ใส่ใน unprotectedRanges ถ้าล็อกเจ้าของเท่านั้นไม่สำเร็จ จะถอยกลับเป็นแบบเตือนก่อนแก้
function protectOwner_(sh, description, unprotectedRanges) {
  try {
    var prots = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var i = 0; i < prots.length; i++) prots[i].remove();
  } catch (e) {}
  var p;
  try {
    p = sh.protect().setDescription(description);
    if (unprotectedRanges && unprotectedRanges.length) p.setUnprotectedRanges(unprotectedRanges);
  } catch (e) { return false; }
  try {
    var me = Session.getEffectiveUser();
    p.addEditor(me);
    var eds = p.getEditors();
    for (var k = 0; k < eds.length; k++) if (eds[k].getEmail() !== me.getEmail()) p.removeEditor(eds[k]);
    if (p.canDomainEdit()) p.setDomainEdit(false);
    return true;
  } catch (e) {
    try { p.setWarningOnly(true); } catch (e2) {}
    return false;
  }
}
// ชื่อเดิมที่ทุกแท็บเรียกใช้: ตอนนี้ล็อกเจ้าของเท่านั้น
function protectWarn_(sh, description, unprotectedRanges) { return protectOwner_(sh, description, unprotectedRanges); }

function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

// ช่วงคอลัมน์ในแท็บ "รายการ" แบบไม่ระบุจุดสิ้นสุด เช่น 'รายการ'!$J$2:$J (หาตำแหน่งจากชื่อหัวคอลัมน์)
function dataRanges_(ss) {
  var map = headerMap_(getDataSheet_(ss));
  var r = function (h) { var L = colLetter_(map[h]); return "'" + SHEET_DATA + "'!$" + L + "$2:$" + L; };
  return {
    map: map,
    typ: r('ประเภท'), date: r('วันที่'), mon: r('เดือน-ปี'), cat: r('หมวดหมู่'), who: r('คนทำรายการ'),
    bank: r('ธนาคาร'), amt: r('จำนวนเงิน'), sta: r('สถานะ'),
    col: function (h) { return colLetter_(map[h]); }
  };
}

function sectionTitle_(sh, a1, text) {
  sh.getRange(a1).merge().setValue(text).setFontWeight('bold').setFontSize(12).setFontColor(COLOR_DARK).setHorizontalAlignment('left');
}

function tableHeader_(range, labels, color) {
  range.setValues([labels]).setBackground(color || COLOR_PRIMARY).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
}

function bankColorList_() {
  return BANK_ORDER.map(function (b) { return BANK_COLORS[b][0]; });
}

function monthValidationRange_(ss) { return ss.getSheetByName(SHEET_DASH).getRange('A11:A22'); }

// ------------------------------------------------------------
//  แท็บ "สรุป": แดชบอร์ด + กราฟ
// ------------------------------------------------------------
function buildDashboard_(ss) {
  var F = dataRanges_(ss);
  var S = "'" + SHEET_SET + "'!";
  var sh = resetSheet_(ss, SHEET_DASH);
  sh.setTabColor(COLOR_DARK);
  sh.setHiddenGridlines(true);
  ensureSize_(sh, 90, 12);
  sh.getRange(1, 1, 90, 12).setFontFamily('Sarabun').setVerticalAlignment('middle');
  var widths = [110, 110, 110, 110, 24, 140, 110, 100, 24, 110, 110, 24];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  sh.getRange('A1:L1').merge().setValue('💖  Our Wallet — สรุปการเงิน')
    .setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontSize(20).setFontWeight('bold').setHorizontalAlignment('left');
  sh.setRowHeight(1, 56);

  var thisMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
  sh.getRange('A2').setValue('เลือกเดือนที่ดู ▸').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
  sh.getRange('B2').setNumberFormat('@').setValue(thisMonth)
    .setBackground('#ffffff').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange('A11:A22'), true).setAllowInvalid(true).build());
  sh.getRange('C2').setValue('(ตารางและกราฟด้านล่างเปลี่ยนตามเดือนที่เลือก)  •  บิลที่ต้องจ่ายดูที่แท็บ "ลำดับจ่าย"').setFontColor('#9ca3af').setFontSize(9);
  sh.setRowHeight(2, 32);
  sh.getRange('A3:L3').setBackground(COLOR_SOFT);
  sh.setRowHeight(3, 8);

  // การ์ดตัวเลขสำคัญ
  var cards = [
    {range: 'A4:B4', val: 'A5:B5', sub: 'A6:B6', label: 'รายรับ', color: COLOR_INCOME,
     f: '=SUMIFS(' + F.amt + ',' + F.typ + ',"รายรับ",' + F.mon + ',$B$2)', s: '="เดือน "&$B$2'},
    {range: 'C4:D4', val: 'C5:D5', sub: 'C6:D6', label: 'รายจ่าย', color: COLOR_EXPENSE,
     f: '=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.mon + ',$B$2)',
     s: '="จ่ายแล้ว "&TEXT(SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.sta + ',"เสร็จสิ้น",' + F.mon + ',$B$2),"#,##0")'},
    {range: 'F4:G4', val: 'F5:G5', sub: 'F6:G6', label: 'คงเหลือ', color: COLOR_DARK,
     f: '=A5-C5', s: '=IF(A5=0,"-",TEXT((A5-C5)/A5,"0%")&" ของรายรับ")'},
    {range: 'H4:K4', val: 'H5:K5', sub: 'H6:K6', label: 'บิลรอจ่าย', color: '#f59e0b',
     f: '=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.sta + ',"รอดำเนินการ",' + F.mon + ',$B$2)',
     s: '=COUNTIFS(' + F.typ + ',"รายจ่าย",' + F.sta + ',"รอดำเนินการ",' + F.mon + ',$B$2)&" รายการ"'}
  ];
  cards.forEach(function (card) {
    sh.getRange(card.range).merge().setValue(card.label).setFontSize(10).setFontColor('#6b7280').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(card.val).merge().setFormula(card.f).setNumberFormat('฿#,##0.00').setFontSize(18).setFontWeight('bold')
      .setFontColor(card.color).setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(card.sub).merge().setFormula(card.s).setFontSize(9).setFontColor('#9ca3af').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(card.range.split(':')[0] + ':' + card.sub.split(':')[1]).setBorder(true, true, true, true, false, false, '#fecdd3', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(4, 24); sh.setRowHeight(5, 40); sh.setRowHeight(6, 22);

  // งบประมาณ
  var bud = 'VLOOKUP($B$2,' + S + '$A:$B,2,FALSE)';
  sh.getRange('A7:K7').merge()
    .setFormula('=IFERROR(IF(' + bud + '>0,"🎯 งบเดือนนี้ "&TEXT(' + bud + ',"#,##0")&" บาท  •  ใช้ไป "&TEXT(C5/' + bud + ',"0%")&IF(C5>' + bud + ',"  ⚠️ เกินงบ",""),"🎯 ยังไม่ได้ตั้งงบเดือนนี้ (ตั้งได้ในแอป)"),"🎯 ยังไม่ได้ตั้งงบเดือนนี้ (ตั้งได้ในแอป)")')
    .setHorizontalAlignment('center').setFontColor(COLOR_DARK).setFontWeight('bold').setBackground(COLOR_SOFT);
  sh.setRowHeight(7, 30);

  // ตารางที่ 1: 12 เดือนล่าสุด
  sectionTitle_(sh, 'A9:D9', '📈 รายรับ–รายจ่าย 12 เดือนล่าสุด');
  tableHeader_(sh.getRange('A10:D10'), ['เดือน', 'รายรับ', 'รายจ่าย', 'คงเหลือ']);
  for (var r = 11; r <= 22; r++) {
    var off = r - 22;
    sh.getRange(r, 1).setFormula('=YEAR(EDATE(TODAY(),' + off + '))&"-"&TEXT(MONTH(EDATE(TODAY(),' + off + ')),"00")');
    sh.getRange(r, 2).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายรับ",' + F.mon + ',$A' + r + ')');
    sh.getRange(r, 3).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.mon + ',$A' + r + ')');
    sh.getRange(r, 4).setFormula('=B' + r + '-C' + r);
  }
  sh.getRange('A11:A22').setHorizontalAlignment('center');
  sh.getRange('B11:D22').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('B11:B22').setFontColor('#047857');
  sh.getRange('C11:C22').setFontColor('#b91c1c');
  // แถบความเข้มสี (heatmap): เดือนที่รายรับ/รายจ่ายสูงสีจะเข้มขึ้น เห็นภาพรวมทันทีโดยไม่ต้องอ่านตัวเลข
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint('#ffffff').setGradientMaxpoint('#a7f3d0').setRanges([sh.getRange('B11:B22')]).build(),
    SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint('#ffffff').setGradientMaxpoint('#fecaca').setRanges([sh.getRange('C11:C22')]).build(),
    SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint('#ffffff').setGradientMaxpoint('#fed7aa').setRanges([sh.getRange('G11:G17')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setBackground('#fee2e2').setFontColor('#b91c1c').setBold(true).setRanges([sh.getRange('D11:D22')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#047857').setBold(true).setRanges([sh.getRange('D11:D22')]).build()
  ]);
  sh.getRange('A11:D22').setBorder(null, null, true, null, null, true, '#fce7eb', SpreadsheetApp.BorderStyle.SOLID);

  // ตารางที่ 2: รายจ่ายตามหมวด
  sectionTitle_(sh, 'F9:H9', '🍩 รายจ่ายตามหมวด');
  tableHeader_(sh.getRange('F10:H10'), ['หมวด', 'จำนวน', '%']);
  for (var i = 0; i < EXPENSE_CATEGORIES.length; i++) {
    var rr = 11 + i;
    sh.getRange(rr, 6).setValue(EXPENSE_CATEGORIES[i]);
    sh.getRange(rr, 7).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.cat + ',$F' + rr + ',' + F.mon + ',$B$2)');
    sh.getRange(rr, 8).setFormula('=IF(SUM($G$11:$G$17)=0,0,G' + rr + '/SUM($G$11:$G$17))');
  }
  sh.getRange('G11:G17').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('H11:H17').setNumberFormat('0%').setHorizontalAlignment('right').setFontColor('#6b7280');
  sh.getRange('F11:H17').setBorder(null, null, true, null, null, true, '#fce7eb', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('F18:H18').setValues([['รวม', '', '']]);
  sh.getRange('G18').setFormula('=SUM(G11:G17)').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('F18:H18').setFontWeight('bold').setBackground(COLOR_SOFT);

  // ตารางที่ 3: รายรับตามประเภท
  sectionTitle_(sh, 'J9:K9', '💰 รายรับตามประเภท');
  tableHeader_(sh.getRange('J10:K10'), ['ประเภท', 'จำนวน'], COLOR_INCOME);
  for (var q = 0; q < INCOME_CATEGORIES.length; q++) {
    var ir = 11 + q;
    sh.getRange(ir, 10).setValue(INCOME_CATEGORIES[q]);
    sh.getRange(ir, 11).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายรับ",' + F.cat + ',$J' + ir + ',' + F.mon + ',$B$2)');
  }
  var incLast = 10 + INCOME_CATEGORIES.length, incTotal = incLast + 1;   // แถวสุดท้ายของหมวด และแถวรวม (ต้องไม่ชนหัวตารางธนาคารที่แถว 21)
  sh.getRange('K11:K' + incLast).setNumberFormat('#,##0').setHorizontalAlignment('right').setFontColor('#047857');
  sh.getRange('J11:K' + incLast).setBorder(null, null, true, null, null, true, '#d1fae5', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('J' + incTotal + ':K' + incTotal).setValues([['รวม', '']]);
  sh.getRange('K' + incTotal).setFormula('=SUM(K11:K' + incLast + ')').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('J' + incTotal + ':K' + incTotal).setFontWeight('bold').setBackground('#ecfdf5');

  // ตารางที่ 4: แยกตามคน
  sectionTitle_(sh, 'F20:H20', '👫 แยกตามคน (เดือนที่เลือก)');
  tableHeader_(sh.getRange('F21:H21'), ['คน', 'รายรับ', 'รายจ่าย']);
  for (var p = 0; p < PEOPLE.length; p++) {
    var pr = 22 + p;
    sh.getRange(pr, 6).setValue(PEOPLE[p]).setFontWeight('bold');
    sh.getRange(pr, 7).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายรับ",' + F.who + ',$F' + pr + ',' + F.mon + ',$B$2)').setFontColor('#047857');
    sh.getRange(pr, 8).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.who + ',$F' + pr + ',' + F.mon + ',$B$2)').setFontColor('#b91c1c');
  }
  sh.getRange('G22:H23').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('F22:H23').setBorder(null, null, true, null, null, true, '#fce7eb', SpreadsheetApp.BorderStyle.SOLID);

  // ตารางที่ 5: รายจ่ายตามธนาคาร
  sectionTitle_(sh, 'J21:K21', '🏦 รายจ่ายตามธนาคาร');
  tableHeader_(sh.getRange('J22:K22'), ['ธนาคาร', 'จำนวน'], '#334155');
  for (var b = 0; b < BANK_ORDER.length; b++) {
    var br = 23 + b;
    sh.getRange(br, 10).setValue(BANK_ORDER[b]).setBackground(BANK_COLORS[BANK_ORDER[b]][0]).setFontColor(BANK_COLORS[BANK_ORDER[b]][1]).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(br, 11).setFormula('=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.bank + ',$J' + br + ',' + F.mon + ',$B$2)');
  }
  sh.getRange('K23:K31').setNumberFormat('#,##0').setHorizontalAlignment('right');

  // แนวโน้ม 12 เดือน (กราฟจิ๋วในช่อง) + สถิติเฉลี่ย
  sectionTitle_(sh, 'A24:D24', '📉 แนวโน้ม 12 เดือน');
  var trend = [
    {row: 25, label: 'รายรับ', bg: '#ecfdf5', fg: '#047857', f: '=SPARKLINE($B$11:$B$22,{"charttype","column";"color","#10b981"})'},
    {row: 26, label: 'รายจ่าย', bg: '#fff1f2', fg: '#b91c1c', f: '=SPARKLINE($C$11:$C$22,{"charttype","column";"color","#ef4444"})'},
    {row: 27, label: 'คงเหลือ', bg: COLOR_SOFT, fg: COLOR_DARK, f: '=SPARKLINE($D$11:$D$22,{"charttype","column";"color","#c9184a";"negcolor","#9ca3af"})'}
  ];
  trend.forEach(function (t) {
    sh.getRange(t.row, 1).setValue(t.label).setBackground(t.bg).setFontColor(t.fg).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(t.row, 2, 1, 3).merge().setFormula(t.f);
    sh.setRowHeight(t.row, 30);
  });
  var stats = [
    {row: 29, label: 'รายรับเฉลี่ย / เดือน', f: '=IFERROR(AVERAGEIF($B$11:$B$22,">0"),0)', fmt: '฿#,##0', color: '#047857'},
    {row: 30, label: 'รายจ่ายเฉลี่ย / เดือน', f: '=IFERROR(AVERAGEIF($C$11:$C$22,">0"),0)', fmt: '฿#,##0', color: '#b91c1c'},
    {row: 31, label: 'เดือนที่ใช้จ่ายสูงสุด', f: '=IFERROR(IF(MAX($C$11:$C$22)=0,"-",INDEX($A$11:$A$22,MATCH(MAX($C$11:$C$22),$C$11:$C$22,0))),"-")', fmt: '@', color: COLOR_DARK}
  ];
  stats.forEach(function (st) {
    sh.getRange(st.row, 1, 1, 2).merge().setValue(st.label).setFontColor('#6b7280').setFontSize(10);
    sh.getRange(st.row, 3, 1, 2).merge().setFormula(st.f).setNumberFormat(st.fmt).setFontWeight('bold').setFontColor(st.color).setHorizontalAlignment('right');
  });

  // Top 5 รายจ่ายของเดือนที่เลือก พร้อมแท่งสัดส่วน
  sectionTitle_(sh, 'F24:H24', '🏆 Top 5 รายจ่ายเดือนนี้');
  tableHeader_(sh.getRange('F25:H25'), ['รายการ', 'จำนวน', 'สัดส่วน'], '#334155');
  var lastColL = colLetter_(getDataSheet_(ss).getLastColumn());
  sh.getRange('F26').setFormula('=IFERROR(QUERY(\'' + SHEET_DATA + '\'!$A$2:$' + lastColL + ',"select ' + F.col('รายการ') + ',' + F.col('จำนวนเงิน') + ' where ' + F.col('ประเภท') + '=\'รายจ่าย\' and ' + F.col('เดือน-ปี') + '=\'"&$B$2&"\' order by ' + F.col('จำนวนเงิน') + ' desc limit 5",0),"")');
  for (var tp = 26; tp <= 30; tp++) {
    sh.getRange(tp, 8).setFormula('=IF(G' + tp + '="","",SPARKLINE(G' + tp + ',{"charttype","bar";"max",MAX($G$26:$G$30);"color1","#ef4444"}))');
  }
  sh.getRange('F26:F30').setFontWeight('bold').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.getRange('G26:G30').setNumberFormat('#,##0').setHorizontalAlignment('right').setFontColor('#b91c1c');
  sh.getRange('F26:H30').setBorder(null, null, true, null, null, true, '#fce7eb', SpreadsheetApp.BorderStyle.SOLID);

  // กราฟ
  sectionTitle_(sh, 'A33:K33', '📊 กราฟสรุป');
  var PINKS = ['#ff4d6d', '#f59e0b', '#8b5cf6', '#0ea5e9', '#10b981', '#c9184a', '#9ca3af'];
  var GREENS = ['#059669', '#10b981', '#34d399', '#6ee7b7', '#047857', '#065f46', '#a7f3d0', '#16a34a', '#4ade80'];

  sh.insertChart(sh.newChart().asColumnChart()
    .addRange(sh.getRange('A10:C22')).setNumHeaders(1)
    .setOption('title', 'รายรับ vs รายจ่าย รายเดือน')
    .setOption('colors', [COLOR_INCOME, COLOR_EXPENSE]).setOption('legend', {position: 'bottom'})
    .setOption('vAxis', {format: '#,##0', gridlines: {color: '#f3f4f6'}}).setOption('bar', {groupWidth: '65%'})
    .setOption('width', 450).setOption('height', 300).setPosition(34, 1, 0, 6).build());

  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('F10:G17')).setNumHeaders(1)
    .setOption('title', 'รายจ่ายตามหมวด (เดือนที่เลือก)')
    .setOption('pieHole', 0.5).setOption('colors', PINKS).setOption('legend', {position: 'right'}).setOption('pieSliceText', 'percentage')
    .setOption('width', 520).setOption('height', 300).setPosition(34, 6, 10, 6).build());

  sh.insertChart(sh.newChart().asLineChart()
    .addRange(sh.getRange('A10:A22')).addRange(sh.getRange('D10:D22')).setNumHeaders(1)
    .setOption('title', 'เงินคงเหลือสุทธิรายเดือน')
    .setOption('colors', [COLOR_DARK]).setOption('legend', {position: 'none'}).setOption('curveType', 'function').setOption('pointSize', 5)
    .setOption('vAxis', {format: '#,##0', gridlines: {color: '#f3f4f6'}})
    .setOption('width', 450).setOption('height', 300).setPosition(50, 1, 0, 6).build());

  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('J10:K' + incLast)).setNumHeaders(1)
    .setOption('title', 'รายรับตามประเภท (เดือนที่เลือก)')
    .setOption('pieHole', 0.5).setOption('colors', GREENS).setOption('legend', {position: 'right'}).setOption('pieSliceText', 'percentage')
    .setOption('width', 520).setOption('height', 300).setPosition(50, 6, 10, 6).build());

  sh.insertChart(sh.newChart().asColumnChart()
    .addRange(sh.getRange('F21:H23')).setNumHeaders(1)
    .setOption('title', 'รายรับ vs รายจ่าย แยกตามคน (เดือนที่เลือก)')
    .setOption('colors', [COLOR_INCOME, COLOR_EXPENSE]).setOption('legend', {position: 'bottom'})
    .setOption('vAxis', {format: '#,##0', gridlines: {color: '#f3f4f6'}})
    .setOption('width', 450).setOption('height', 300).setPosition(66, 1, 0, 6).build());

  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('J22:K31')).setNumHeaders(1)
    .setOption('title', 'รายจ่ายตามธนาคาร (เดือนที่เลือก)')
    .setOption('pieHole', 0.5).setOption('colors', bankColorList_()).setOption('legend', {position: 'right'}).setOption('pieSliceText', 'percentage')
    .setOption('width', 520).setOption('height', 300).setPosition(66, 6, 10, 6).build());

  sh.getRange('A83').setValue('ข้อมูลทั้งหมดคำนวณจากแท็บ "รายการ" อัตโนมัติ  •  อย่าแก้ตัวเลขในแท็บนี้ (แก้ได้เฉพาะช่อง "เลือกเดือนที่ดู")')
    .setFontSize(9).setFontColor('#9ca3af');
  sh.setFrozenRows(2);
  protectWarn_(sh, 'คำนวณอัตโนมัติ แก้ได้เฉพาะช่องเลือกเดือน', [sh.getRange('B2')]);
}

// ------------------------------------------------------------
//  แท็บ "ลำดับจ่าย": บิลที่ยังไม่จ่าย เรียงตามวันครบกำหนด
// ------------------------------------------------------------
function buildPlan_(ss) {
  var F = dataRanges_(ss);
  var data = getDataSheet_(ss);
  var map = F.map;
  var nCols = data.getLastColumn();
  var HS = 20;                                   // คอลัมน์เริ่มต้นของข้อมูลช่วยคำนวณ (T)
  var FIRST = 26, ROWS = 80, LAST = FIRST + ROWS - 1;

  var sh = resetSheet_(ss, SHEET_PLAN);
  sh.setTabColor('#f59e0b');
  sh.setHiddenGridlines(true);
  ensureSize_(sh, LAST + 5, HS + nCols + 2);
  sh.getRange(1, 1, LAST + 5, 14).setFontFamily('Sarabun').setVerticalAlignment('middle');
  var widths = [50, 135, 100, 80, 95, 220, 80, 160, 120, 330, 130, 150, 110];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  sh.getRange('A1:K1').merge().setValue('🧾  ลำดับการจ่าย — จ่ายอะไรก่อน')
    .setBackground('#f59e0b').setFontColor('#ffffff').setFontSize(20).setFontWeight('bold');
  sh.setRowHeight(1, 56);
  sh.getRange('A2').setValue('บิลที่ยังไม่จ่ายทั้งหมด เรียงตามวันครบกำหนด (ใกล้ที่สุดอยู่บนสุด)  •  จ่ายแล้วให้ทำเครื่องหมายในแอป รายการจะหายจากตารางนี้เอง')
    .setFontColor('#9ca3af').setFontSize(9);
  sh.getRange('A3:K3').setBackground('#fff7ed');
  sh.setRowHeight(3, 8);

  // ข้อมูลช่วยคำนวณ (ซ่อน): บิลรายจ่ายที่ยังไม่จ่าย เรียงตามวันที่ แล้วตามจำนวนเงินมากไปน้อย
  var lastL = colLetter_(nCols);
  var src = "'" + SHEET_DATA + "'!$A$2:$" + lastL;
  var filt = 'FILTER(' + src + ',' + F.typ + '="รายจ่าย",' + F.sta + '="รอดำเนินการ")';
  sh.getRange(FIRST, HS).setFormula('=IFERROR(SORT(' + filt + ',' + map['วันที่'] + ',TRUE,' + map['จำนวนเงิน'] + ',FALSE),"")');
  var hc = function (h, r) { return colLetter_(HS + map[h] - 1) + r; };
  var dvCol = HS + nCols;                          // คอลัมน์เลขวันที่ (serial)
  var MONTH_ABBR = '"ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."';
  var monthName = function (d) { return 'CHOOSE(MONTH(' + d + '),' + MONTH_ABBR + ')'; };
  var thai = function (d) { return 'DAY(' + d + ')&" "&' + monthName(d) + '&" "&RIGHT(YEAR(' + d + ')+543,2)'; };

  // หัวตาราง
  sectionTitle_(sh, 'A24:K24', '📋 รายการที่ต้องจ่าย');
  tableHeader_(sh.getRange(FIRST - 1, 1, 1, 11), ['ลำดับ', 'ความเร่งด่วน', 'ครบกำหนด', 'เหลือ (วัน)', 'ธนาคาร', 'รายการ', 'คน', 'ประเภทบิล', 'ต้องจ่าย', 'รายละเอียด', 'เทียบยอด'], '#334155');
  sh.setRowHeight(FIRST - 1, 30);

  var formulas = [];
  for (var r = FIRST; r <= LAST; r++) {
    var T = hc('ประเภท', r), dv = colLetter_(dvCol) + r;
    sh.getRange(r, dvCol).setFormula('=IF(' + T + '="","",IFERROR(DATEVALUE(' + hc('วันที่', r) + '),' + hc('วันที่', r) + '))');
    var kind = hc('รูปแบบการจ่าย', r), cur = hc('งวดที่', r), tot = hc('รวมงวด', r), per = hc('ขั้นต่ำ / ต่องวด', r),
        full = hc('ยอดเต็มบิล', r), rem = hc('คงค้าง', r);
    var endDate = 'EDATE(' + dv + ',' + tot + '-' + cur + ')';
    var detail = '=IF(' + T + '="","",IF(' + kind + '="ผ่อนบัตร: จ่ายเป็นงวด","งวด "&' + cur + '&"/"&' + tot + '&" · ต่องวด "&TEXT(' + per + ',"#,##0")&" · ผ่อนหมด "&' + monthName(endDate) + '&" "&RIGHT(YEAR(' + endDate + ')+543,2),' +
      'IF(' + kind + '="ผ่อนบัตร: จ่ายขั้นต่ำ","ยอดเต็ม "&TEXT(' + full + ',"#,##0")&" · ขั้นต่ำ "&TEXT(' + per + ',"#,##0")&" · ค้างหลังจ่าย "&TEXT(' + rem + ',"#,##0"),"")))';
    sh.getRange(r, 1).setFormula('=IF(' + T + '="","",ROW()-' + (FIRST - 1) + ')');
    sh.getRange(r, 4).setFormula('=IF(' + T + '="","",' + dv + '-TODAY())');
    sh.getRange(r, 2).setFormula('=IF(' + T + '="","",IF(D' + r + '<0,"🔴 เกินกำหนด",IF(D' + r + '<=7,"🟠 ภายใน 7 วัน",IF(D' + r + '<=31,"🔵 ภายใน 1 เดือน","⚪ ถัดไป"))))');
    sh.getRange(r, 3).setFormula('=IF(' + T + '="","",' + thai(dv) + ')');
    sh.getRange(r, 5).setFormula('=IF(' + T + '="","",' + hc('ธนาคาร', r) + ')');
    sh.getRange(r, 6).setFormula('=IF(' + T + '="","",' + hc('รายการ', r) + ')');
    sh.getRange(r, 7).setFormula('=IF(' + T + '="","",' + hc('คนทำรายการ', r) + ')');
    sh.getRange(r, 8).setFormula('=IF(' + T + '="","",' + kind + ')');
    sh.getRange(r, 9).setFormula('=IF(' + T + '="","",' + hc('จำนวนเงิน', r) + ')');
    sh.getRange(r, 10).setFormula(detail);
    sh.getRange(r, 11).setFormula('=IF(' + T + '="","",SPARKLINE(I' + r + ',{"charttype","bar";"max",MAX($I$' + FIRST + ':$I$' + LAST + ');"color1","#f97316"}))');
  }
  var body = sh.getRange(FIRST, 1, ROWS, 11);
  body.setBorder(null, null, true, null, null, true, '#e5e7eb', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(FIRST, 1, ROWS, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(FIRST, 2, ROWS, 4).setHorizontalAlignment('center');
  sh.getRange(FIRST, 5, ROWS, 1).setHorizontalAlignment('center');
  sh.getRange(FIRST, 7, ROWS, 2).setHorizontalAlignment('center');
  sh.getRange(FIRST, 4, ROWS, 1).setNumberFormat('0').setFontWeight('bold');
  sh.getRange(FIRST, 9, ROWS, 1).setNumberFormat('฿#,##0.00').setHorizontalAlignment('right').setFontWeight('bold').setFontColor('#b91c1c');
  sh.getRange(FIRST, 10, ROWS, 1).setFontSize(9).setFontColor('#6b7280');
  sh.getRange(FIRST, 6, ROWS, 1).setFontWeight('bold');

  // สรุปด้านขวา (ใช้ทำกราฟ)
  var I = '$I$' + FIRST + ':$I$' + LAST, D = '$D$' + FIRST + ':$D$' + LAST, E = '$E$' + FIRST + ':$E$' + LAST;
  sectionTitle_(sh, 'L8:M8', '⏱ ยอดตามความเร่งด่วน');
  tableHeader_(sh.getRange('L9:M9'), ['ช่วง', 'ยอด'], '#334155');
  var groups = [
    ['เกินกำหนด', '=SUMIFS(' + I + ',' + D + ',"<0")', '#fee2e2', '#b91c1c'],
    ['ภายใน 7 วัน', '=SUMIFS(' + I + ',' + D + ',">=0",' + D + ',"<=7")', '#ffedd5', '#c2410c'],
    ['ภายใน 1 เดือน', '=SUMIFS(' + I + ',' + D + ',">7",' + D + ',"<=31")', '#e0f2fe', '#0369a1'],
    ['ถัดไป', '=SUMIFS(' + I + ',' + D + ',">31")', '#f3f4f6', '#4b5563']
  ];
  for (var g = 0; g < groups.length; g++) {
    sh.getRange(10 + g, 12).setValue(groups[g][0]).setBackground(groups[g][2]).setFontColor(groups[g][3]).setFontWeight('bold');
    sh.getRange(10 + g, 13).setFormula(groups[g][1]).setNumberFormat('#,##0').setHorizontalAlignment('right');
  }
  sectionTitle_(sh, 'L16:M16', '🏦 ยอดค้างจ่ายตามธนาคาร');
  tableHeader_(sh.getRange('L17:M17'), ['ธนาคาร', 'ยอด'], '#334155');
  for (var b = 0; b < BANK_ORDER.length; b++) {
    var br = 18 + b;
    sh.getRange(br, 12).setValue(BANK_ORDER[b]).setBackground(BANK_COLORS[BANK_ORDER[b]][0]).setFontColor(BANK_COLORS[BANK_ORDER[b]][1]).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(br, 13).setFormula('=SUMIFS(' + I + ',' + E + ',$L' + br + ')').setNumberFormat('#,##0').setHorizontalAlignment('right');
  }

  // การ์ดสรุปด้านบน
  var kpis = [
    {r: 'A4:C4', v: 'A5:C5', label: 'ค้างจ่ายทั้งหมด', color: '#b91c1c', f: '=SUM(' + I + ')', fmt: '฿#,##0.00'},
    {r: 'D4:F4', v: 'D5:F5', label: '🔴 เกินกำหนดแล้ว', color: '#dc2626', f: '=M10', fmt: '฿#,##0.00'},
    {r: 'G4:H4', v: 'G5:H5', label: '🟠 ภายใน 7 วัน', color: '#ea580c', f: '=M11', fmt: '฿#,##0.00'},
    {r: 'I4:J4', v: 'I5:J5', label: 'จำนวนบิลที่ค้าง', color: '#334155', f: '=COUNT(' + D + ')&" บิล"', fmt: '@'}
  ];
  kpis.forEach(function (k) {
    sh.getRange(k.r).merge().setValue(k.label).setFontSize(10).setFontColor('#6b7280').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.v).merge().setFormula(k.f).setNumberFormat(k.fmt).setFontSize(18).setFontWeight('bold').setFontColor(k.color).setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.r.split(':')[0] + ':' + k.v.split(':')[1]).setBorder(true, true, true, true, false, false, '#fed7aa', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(4, 24); sh.setRowHeight(5, 42);

  // กราฟ
  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('L9:M13')).setNumHeaders(1)
    .setOption('title', 'ยอดค้างจ่ายตามความเร่งด่วน')
    .setOption('pieHole', 0.5).setOption('colors', ['#ef4444', '#f97316', '#0ea5e9', '#9ca3af'])
    .setOption('legend', {position: 'right'}).setOption('pieSliceText', 'value')
    .setOption('width', 440).setOption('height', 300).setPosition(8, 1, 0, 4).build());
  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('L17:M26')).setNumHeaders(1)
    .setOption('title', 'ยอดค้างจ่ายตามธนาคาร')
    .setOption('pieHole', 0.5).setOption('colors', bankColorList_())
    .setOption('legend', {position: 'right'}).setOption('pieSliceText', 'value')
    .setOption('width', 560).setOption('height', 300).setPosition(8, 6, 10, 4).build());

  // สีตามความเร่งด่วน / ธนาคาร / ประเภทบิล
  var area = sh.getRange(FIRST, 1, ROWS, 11);
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($D' + FIRST + '<>"",$D' + FIRST + '<0)').setBackground('#fee2e2').setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($D' + FIRST + '<>"",$D' + FIRST + '<=7)').setBackground('#ffedd5').setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($D' + FIRST + '<>"",$D' + FIRST + '<=31)').setBackground('#f0f9ff').setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('ขั้นต่ำ').setBackground('#fef3c7').setFontColor('#b45309').setBold(true).setRanges([sh.getRange(FIRST, 8, ROWS, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('เป็นงวด').setBackground('#ede9fe').setFontColor('#6d28d9').setBold(true).setRanges([sh.getRange(FIRST, 8, ROWS, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('จ่ายปกติ').setBackground('#e0f2fe').setFontColor('#0369a1').setBold(true).setRanges([sh.getRange(FIRST, 8, ROWS, 1)]).build()
  ];
  for (var k = 0; k < BANK_ORDER.length; k++) {
    var bank = BANK_ORDER[k];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(bank)
      .setBackground(BANK_COLORS[bank][0]).setFontColor(BANK_COLORS[bank][1]).setBold(true).setRanges([sh.getRange(FIRST, 5, ROWS, 1)]).build());
  }
  sh.setConditionalFormatRules(rules);

  sh.hideColumns(HS, nCols + 1);
  protectWarn_(sh, 'คำนวณอัตโนมัติจากแท็บ รายการ', null);
}

// ------------------------------------------------------------
//  แท็บ "รายเดือน": ตารางรายการของเดือน เลือกดู ทั้งหมด / รายรับ / รายจ่าย
// ------------------------------------------------------------
function buildMonthly_(ss) {
  var F = dataRanges_(ss);
  var sh = resetSheet_(ss, SHEET_MONTH);
  sh.setTabColor('#8b5cf6');
  sh.setHiddenGridlines(true);
  ensureSize_(sh, 320, 10);
  sh.getRange(1, 1, 320, 10).setFontFamily('Sarabun').setVerticalAlignment('middle');
  var widths = [100, 90, 110, 240, 90, 100, 150, 120, 120, 24];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  sh.getRange('A1:I1').merge().setValue('📅  รายการรายเดือน')
    .setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontSize(20).setFontWeight('bold');
  sh.setRowHeight(1, 56);

  var thisMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
  sh.getRange('A2').setValue('เดือน ▸').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
  sh.getRange('B2:C2').merge().setNumberFormat('@').setValue(thisMonth)
    .setBackground('#ffffff').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(monthValidationRange_(ss), true).setAllowInvalid(true).build());
  sh.getRange('A3').setValue('มุมมอง ▸').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
  sh.getRange('B3:C3').merge().setValue('ทั้งหมด')
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ทั้งหมด', 'รายรับ', 'รายจ่าย'], true).setAllowInvalid(false).build());
  sh.getRange('D2').setValue('เลือกเดือนและมุมมอง (ทั้งหมด / รายรับ / รายจ่าย) ตารางด้านล่างจะเปลี่ยนตาม').setFontColor('#9ca3af').setFontSize(9);
  sh.setRowHeight(2, 32); sh.setRowHeight(3, 32);

  var kpis = [
    {r: 'A5:B5', v: 'A6:B6', label: 'รายรับ', color: COLOR_INCOME, f: '=SUMIFS(' + F.amt + ',' + F.typ + ',"รายรับ",' + F.mon + ',$B$2)'},
    {r: 'C5:D5', v: 'C6:D6', label: 'รายจ่าย', color: COLOR_EXPENSE, f: '=SUMIFS(' + F.amt + ',' + F.typ + ',"รายจ่าย",' + F.mon + ',$B$2)'},
    {r: 'E5:G5', v: 'E6:G6', label: 'คงเหลือ', color: COLOR_DARK, f: '=A6-C6'},
    {r: 'H5:I5', v: 'H6:I6', label: 'บิลรอจ่าย', color: '#f59e0b', f: '=COUNTIFS(' + F.typ + ',"รายจ่าย",' + F.sta + ',"รอดำเนินการ",' + F.mon + ',$B$2)&" รายการ"'}
  ];
  kpis.forEach(function (k) {
    sh.getRange(k.r).merge().setValue(k.label).setFontSize(10).setFontColor('#6b7280').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.v).merge().setFormula(k.f).setNumberFormat('฿#,##0.00').setFontSize(16).setFontWeight('bold').setFontColor(k.color).setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.r.split(':')[0] + ':' + k.v.split(':')[1]).setBorder(true, true, true, true, false, false, '#fecdd3', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(5, 24); sh.setRowHeight(6, 36);

  var headers = ['วันที่', 'ประเภท', 'หมวดหมู่', 'รายการ', 'คน', 'ธนาคาร', 'รูปแบบการจ่าย', 'จำนวนเงิน', 'สถานะ'];
  tableHeader_(sh.getRange('A8:I8'), headers, COLOR_DARK);
  sh.setRowHeight(8, 30);

  var lastL = colLetter_(getDataSheet_(ss).getLastColumn());
  var L = F.col;
  var sel = [L('วันที่'), L('ประเภท'), L('หมวดหมู่'), L('รายการ'), L('คนทำรายการ'), L('ธนาคาร'), L('รูปแบบการจ่าย'), L('จำนวนเงิน'), L('สถานะ')].join(',');
  var T = L('ประเภท');
  sh.getRange('A9').setFormula(
    '=IFERROR(QUERY(\'' + SHEET_DATA + '\'!$A$2:$' + lastL + ',"select ' + sel + ' where ' + L('เดือน-ปี') + '=\'"&$B$2&"\'"&IF($B$3="รายรับ"," and ' + T + '=\'รายรับ\'",IF($B$3="รายจ่าย"," and ' + T + '=\'รายจ่าย\'",""))&" order by ' + L('วันที่') + ' desc",0),"ไม่มีรายการตามที่เลือก")');
  sh.getRange('A9:C320').setHorizontalAlignment('center');
  sh.getRange('E9:G320').setHorizontalAlignment('center');
  sh.getRange('I9:I320').setHorizontalAlignment('center');
  sh.getRange('H9:H320').setNumberFormat('#,##0.00').setHorizontalAlignment('right').setFontWeight('bold');

  var all = sh.getRange('A9:I320');
  var typeAndAmt = [sh.getRange('B9:B320'), sh.getRange('H9:H320')];
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายรับ"').setFontColor('#047857').setRanges(typeAndAmt).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายจ่าย"').setFontColor('#b91c1c').setRanges(typeAndAmt).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายรับ"').setBackground('#ecfdf5').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายจ่าย"').setBackground('#fff1f2').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$I9="รอดำเนินการ"').setFontColor('#b45309').setBold(true).setRanges([sh.getRange('I9:I320')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายรับ').setBackground('#d1fae5').setFontColor('#047857').setBold(true).setRanges([sh.getRange('B3:C3')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายจ่าย').setBackground('#fee2e2').setFontColor('#b91c1c').setBold(true).setRanges([sh.getRange('B3:C3')]).build()
  ];
  for (var k = 0; k < BANK_ORDER.length; k++) {
    var bank = BANK_ORDER[k];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(bank)
      .setBackground(BANK_COLORS[bank][0]).setFontColor(BANK_COLORS[bank][1]).setBold(true).setRanges([sh.getRange('F9:F320')]).build());
  }
  sh.setConditionalFormatRules(rules);
  sh.setFrozenRows(8);
  protectWarn_(sh, 'คำนวณอัตโนมัติ แก้ได้เฉพาะช่องเดือน/มุมมอง', [sh.getRange('B2:C2'), sh.getRange('B3:C3')]);
}

// ------------------------------------------------------------
//  แท็บ "ค้นหา": เลือกเงื่อนไขกรองเองได้ (เดือน/ประเภท/คน/ธนาคาร/หมวด/สถานะ/คำค้น)
// ------------------------------------------------------------
function buildFilter_(ss) {
  var F = dataRanges_(ss);
  var sh = resetSheet_(ss, SHEET_FILTER);
  sh.setTabColor('#0ea5e9');
  sh.setHiddenGridlines(true);
  ensureSize_(sh, 340, 10);
  sh.getRange(1, 1, 340, 10).setFontFamily('Sarabun').setVerticalAlignment('middle');
  var widths = [100, 90, 110, 240, 90, 100, 150, 120, 120, 24];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  sh.getRange('A1:I1').merge().setValue('🔎  ค้นหา / กรองข้อมูลตามที่เลือก')
    .setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontSize(20).setFontWeight('bold');
  sh.setRowHeight(1, 56);

  var ALL = 'ทั้งหมด';
  var cats = EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES);
  var controls = [
    {row: 2, label: 'เดือน ▸', list: null},
    {row: 3, label: 'ประเภท ▸', list: [ALL, 'รายรับ', 'รายจ่าย']},
    {row: 4, label: 'คน ▸', list: [ALL, 'Anas', 'Phada']},
    {row: 5, label: 'ธนาคาร ▸', list: [ALL].concat(BANK_ORDER)},
    {row: 6, label: 'หมวดหมู่ ▸', list: [ALL].concat(cats)},
    {row: 7, label: 'สถานะ ▸', list: [ALL, 'เสร็จสิ้น', 'รอดำเนินการ']},
    {row: 8, label: 'คำค้น ▸', list: null}
  ];
  controls.forEach(function (ct) {
    sh.getRange('A' + ct.row).setValue(ct.label).setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
    var box = sh.getRange('B' + ct.row + ':C' + ct.row).merge().setBackground('#ffffff').setFontWeight('bold').setHorizontalAlignment('center')
      .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    if (ct.list) box.setValue(ALL).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ct.list, true).setAllowInvalid(false).build());
    sh.setRowHeight(ct.row, 30);
  });
  sh.getRange('B2:C2').setNumberFormat('@').setValue(ALL)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(monthValidationRange_(ss), true).setAllowInvalid(true).build());
  sh.getRange('B8:C8').setNumberFormat('@').setValue('');
  sh.getRange('D2').setValue('เลือกเงื่อนไขได้หลายช่องพร้อมกัน ตารางด้านล่างเปลี่ยนตามทันที').setFontColor('#9ca3af').setFontSize(9);
  sh.getRange('D3').setValue('ตั้งช่องใดเป็น "ทั้งหมด" = ไม่กรองช่องนั้น (เดือนพิมพ์ ทั้งหมด หรือเลือก yyyy-MM)').setFontColor('#9ca3af').setFontSize(9);
  sh.getRange('D8').setValue('พิมพ์บางส่วนของชื่อรายการ เช่น ไฟ, ผ่อน').setFontColor('#9ca3af').setFontSize(9);

  // ลิงก์ลัดไปแท็บอื่น
  try {
    var links = [['D5', SHEET_DASH, '⬅ กลับหน้าสรุป'], ['D6', SHEET_PLAN, '📋 ดูลำดับจ่าย'], ['D7', SHEET_MONTH, '📅 ดูรายเดือน']];
    links.forEach(function (l) {
      var target = ss.getSheetByName(l[1]);
      if (target) sh.getRange(l[0]).setFormula('=HYPERLINK("#gid=' + target.getSheetId() + '","' + l[2] + '")').setFontColor('#0369a1').setFontWeight('bold');
    });
  } catch (err) {}

  var kpis = [
    {r: 'F4:G4', v: 'F5:G5', label: 'รายรับ', color: COLOR_INCOME, f: '=SUMIF($B$12:$B$340,"รายรับ",$H$12:$H$340)'},
    {r: 'H4:I4', v: 'H5:I5', label: 'รายจ่าย', color: COLOR_EXPENSE, f: '=SUMIF($B$12:$B$340,"รายจ่าย",$H$12:$H$340)'},
    {r: 'F6:G6', v: 'F7:G7', label: 'คงเหลือ', color: COLOR_DARK, f: '=F5-H5'},
    {r: 'H6:I6', v: 'H7:I7', label: 'พบ', color: '#0ea5e9', f: '=(COUNTIF($B$12:$B$340,"รายรับ")+COUNTIF($B$12:$B$340,"รายจ่าย"))&" รายการ"'}
  ];
  kpis.forEach(function (k) {
    sh.getRange(k.r).merge().setValue(k.label).setFontSize(10).setFontColor('#6b7280').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.v).merge().setFormula(k.f).setNumberFormat('฿#,##0.00').setFontSize(14).setFontWeight('bold').setFontColor(k.color).setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.r.split(':')[0] + ':' + k.v.split(':')[1]).setBorder(true, true, true, true, false, false, '#fecdd3', SpreadsheetApp.BorderStyle.SOLID);
  });

  var headers = ['วันที่', 'ประเภท', 'หมวดหมู่', 'รายการ', 'คน', 'ธนาคาร', 'รูปแบบการจ่าย', 'จำนวนเงิน', 'สถานะ'];
  tableHeader_(sh.getRange('A11:I11'), headers, COLOR_DARK);
  sh.setRowHeight(11, 30);

  var lastL = colLetter_(getDataSheet_(ss).getLastColumn());
  var L = F.col;
  var sel = [L('วันที่'), L('ประเภท'), L('หมวดหมู่'), L('รายการ'), L('คนทำรายการ'), L('ธนาคาร'), L('รูปแบบการจ่าย'), L('จำนวนเงิน'), L('สถานะ')].join(',');
  var where = L('วันที่') + ' is not null'
    + '"&IF(OR($B$2="' + ALL + '",$B$2=""),""," and ' + L('เดือน-ปี') + '=\'"&$B$2&"\'")'
    + '&IF($B$3="' + ALL + '",""," and ' + L('ประเภท') + '=\'"&$B$3&"\'")'
    + '&IF($B$4="' + ALL + '",""," and ' + L('คนทำรายการ') + '=\'"&$B$4&"\'")'
    + '&IF($B$5="' + ALL + '",""," and ' + L('ธนาคาร') + '=\'"&$B$5&"\'")'
    + '&IF($B$6="' + ALL + '",""," and ' + L('หมวดหมู่') + '=\'"&$B$6&"\'")'
    + '&IF($B$7="' + ALL + '",""," and ' + L('สถานะ') + '=\'"&$B$7&"\'")'
    + '&IF($B$8="",""," and (lower(' + L('รายการ') + ') contains \'"&LOWER(SUBSTITUTE($B$8,"\'",""))&"\' or lower(' + L('โน้ต') + ') contains \'"&LOWER(SUBSTITUTE($B$8,"\'",""))&"\')")';
  sh.getRange('A12').setFormula(
    '=IFERROR(QUERY(\'' + SHEET_DATA + '\'!$A$2:$' + lastL + ',"select ' + sel + ' where ' + where + '&" order by ' + L('วันที่') + ' desc",0),"ไม่พบรายการตามเงื่อนไขที่เลือก")');
  sh.getRange('A12:C340').setHorizontalAlignment('center');
  sh.getRange('E12:G340').setHorizontalAlignment('center');
  sh.getRange('I12:I340').setHorizontalAlignment('center');
  sh.getRange('H12:H340').setNumberFormat('#,##0.00').setHorizontalAlignment('right').setFontWeight('bold');

  var all = sh.getRange('A12:I340');
  var typeAndAmt = [sh.getRange('B12:B340'), sh.getRange('H12:H340')];
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B12="รายรับ"').setFontColor('#047857').setRanges(typeAndAmt).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B12="รายจ่าย"').setFontColor('#b91c1c').setRanges(typeAndAmt).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B12="รายรับ"').setBackground('#ecfdf5').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B12="รายจ่าย"').setBackground('#fff1f2').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$I12="รอดำเนินการ"').setFontColor('#b45309').setBold(true).setRanges([sh.getRange('I12:I340')]).build()
  ];
  for (var k = 0; k < BANK_ORDER.length; k++) {
    var bank = BANK_ORDER[k];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(bank)
      .setBackground(BANK_COLORS[bank][0]).setFontColor(BANK_COLORS[bank][1]).setBold(true).setRanges([sh.getRange('F12:F340')]).build());
  }
  sh.setConditionalFormatRules(rules);
  sh.setFrozenRows(11);
  protectWarn_(sh, 'คำนวณอัตโนมัติ แก้ได้เฉพาะช่องเงื่อนไขด้านบน', [sh.getRange('B2:C2'), sh.getRange('B3:C3'), sh.getRange('B4:C4'), sh.getRange('B5:C5'), sh.getRange('B6:C6'), sh.getRange('B7:C7'), sh.getRange('B8:C8')]);
}

function ensureSheetOrder_(ss) {
  var order = [SHEET_DASH, SHEET_PLAN, SHEET_MONTH, SHEET_FILTER, SHEET_DATA, SHEET_SET];
  for (var i = 0; i < order.length; i++) {
    var sh = ss.getSheetByName(order[i]);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
  }
  var dash = ss.getSheetByName(SHEET_DASH);
  if (dash) ss.setActiveSheet(dash);
}
