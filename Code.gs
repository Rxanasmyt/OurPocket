// ============================================================
//  Our Wallet - Google Apps Script backend
//  แท็บที่ระบบสร้างให้:
//    "สรุป"     แดชบอร์ด + กราฟ (คำนวณจากสูตร อัปเดตเองอัตโนมัติ)
//    "รายการ"   ตารางข้อมูลรายรับ-รายจ่าย (แอปอ่าน/เขียนที่แท็บนี้)
//    "ตั้งค่า"   งบประมาณรายเดือน
//  ความปลอดภัย: ตั้งรหัสผ่านที่ Project Settings > Script properties > เพิ่ม WALLET_KEY = รหัสของคุณ
//    แล้วใส่รหัสเดียวกันในแอป (ปุ่มเฟือง). ถ้าไม่ตั้ง WALLET_KEY ใครรู้ URL ก็อ่าน/เขียนข้อมูลได้
//  วิธีสร้างแดชบอร์ดใหม่: เมนู Our Wallet > จัดรูปแบบและสร้างแดชบอร์ดใหม่
// ============================================================

var SHEET_DATA = 'รายการ';
var SHEET_DASH = 'สรุป';
var SHEET_SET = 'ตั้งค่า';
var SHEET_MONTH = 'รายเดือน';
var SETUP_VERSION = 'v4';
var HEADERS = ["ประเภท", "วันที่", "เดือน-ปี", "หมวดหมู่", "รายการ", "คนทำรายการ", "ธนาคาร", "งวดที่", "รวมงวด", "จำนวนเงิน", "สถานะ", "บันทึกเมื่อ", "ID", "RAW_JSON", "รูปแบบการจ่าย", "ยอดเต็มบิล", "ขั้นต่ำ / ต่องวด", "คงค้าง"];
var COL_ID = 12;   // index (0-based) ของคอลัมน์ ID
var COL_JSON = 13; // index (0-based) ของคอลัมน์ RAW_JSON
var EXPENSE_CATEGORIES = ['อาหาร', 'เดินทาง', 'ช้อปปิ้ง', 'ที่พัก', 'สุขภาพ', 'หนี้สิน', 'อื่นๆ'];
var PEOPLE = ['Anas', 'Phada'];
var INCOME_CATEGORIES = ['เงินเดือน', 'ค่าเสี่ยงภัย', 'ค่า พตส', 'ค่าเวร', 'ค่าใบประกอบ', 'ค่า ฉ.10', 'ค่า ฉ.11'];

var COLOR_PRIMARY = '#ff4d6d';
var COLOR_DARK = '#c9184a';
var COLOR_SOFT = '#fff0f3';
var COLOR_INCOME = '#10b981';
var COLOR_EXPENSE = '#ef4444';

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function walletKey_() {
  return PropertiesService.getScriptProperties().getProperty('WALLET_KEY') || '';
}

function authorized_(key) {
  var k = walletKey_();
  return !k || String(key || '') === k;
}

function unauthorized_() {
  return json_({status: "error", code: "unauthorized", message: "รหัสผ่านไม่ถูกต้อง"});
}

function syncPayload_(ss) {
  ensureSetup_(ss);
  var sheet = getDataSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i][COL_JSON];
    if (raw && typeof raw === 'string' && raw.indexOf('{') === 0) {
      try { data.push(JSON.parse(raw)); } catch (err) {}
    }
  }
  return {status: "success", data: data, budgets: readBudgets_(ss)};
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
  return ContentService.createTextOutput("✅ Our Wallet: Web App is running successfully!").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData) return json_({status: "error"});
    var data = JSON.parse(e.postData.contents);
    if (!authorized_(data.key)) return unauthorized_();
    delete data.key; // ห้ามเก็บรหัสผ่านลงชีต

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return json_({status: "error"});

    // อ่านข้อมูลทั้งหมด (ซิงค์)
    if (data.action === 'sync') return json_(syncPayload_(ss));

    lock.waitLock(20000);
    ensureSetup_(ss);
    var sheet = getDataSheet_(ss);

    // ตั้งงบประมาณรายเดือน
    if (data.action === 'budget' && data.month) {
      saveBudget_(ss, data.month, Number(data.amount) || 0);
      return json_({status: "success", message: "budget saved"});
    }

    // ลบรายการ
    if (data.action === 'delete' && data.id) {
      var rowToDelete = findRowById_(sheet, data.id);
      if (rowToDelete > -1) {
        sheet.deleteRow(rowToDelete);
        return json_({status: "success", message: "deleted"});
      }
      return json_({status: "success", message: "already deleted"});
    }

    // เพิ่ม / แก้ไขรายการ
    var type = data.type === 'income' ? 'รายรับ' : 'รายจ่าย';
    var amount = data.type === 'income' ? data.netAmount : data.amount;
    var status = data.type === 'income' ? '-' : (data.isCompleted ? 'เสร็จสิ้น' : 'รอดำเนินการ');
    var savedAt = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

    var row = [
      type, data.date || '-', data.monthYear || '-', data.category || '-', data.description || '-',
      data.who || '-', data.bank || '-', data.currentInstallment || '-', data.totalInstallments || '-',
      Number(amount) || 0, status, savedAt, data.id || '-', JSON.stringify(data),
      payModeLabel_(data), data.fullAmount || '-', data.minAmount || data.installmentAmount || '-',
      data.payMode === 'minpay' ? (Number(data.remainingAmount) || 0) : '-'
    ];

    var rowIndex = findRowById_(sheet, data.id);
    if (rowIndex > -1) {
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      var target = Math.max(sheet.getLastRow() + 1, 2);
      if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
      sheet.getRange(target, 1, 1, row.length).setValues([row]);
    }
    return json_({status: "success"});
  } catch (error) {
    return json_({status: "error", message: error.toString()});
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function payModeLabel_(data) {
  if (data.type === 'income') return '-';
  if (data.payMode === 'minpay') return 'ผ่อนบัตร: จ่ายขั้นต่ำ';
  if (data.payMode === 'installment' || (!data.payMode && data.totalInstallments)) return 'ผ่อนบัตร: จ่ายเป็นงวด';
  return 'จ่ายปกติ';
}

function findRowById_(sheet, id) {
  if (!id) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, COL_ID + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
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
    for (var i = 0; i < months.length; i++) {
      if (String(months[i][0]) === String(month)) { row = i + 2; break; }
    }
  }
  if (row === -1) row = Math.max(last + 1, 2);
  sh.getRange(row, 1, 1, 2).setValues([[month, amount]]);
}

// ------------------------------------------------------------
//  ตั้งค่าครั้งแรก (ทำอัตโนมัติ 1 ครั้ง) / รันใหม่เองได้จากเมนู
// ------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💖 Our Wallet')
    .addItem('จัดรูปแบบและสร้างแดชบอร์ดใหม่', 'setupAll')
    .addToUi();
}

function setupAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().deleteProperty('setup');
  ensureSetup_(ss);
}

function ensureSetup_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('setup') === SETUP_VERSION) return;
  var dataSheet = getDataSheet_(ss);
  formatDataSheet_(dataSheet);
  ensureSettingsSheet_(ss);
  buildDashboard_(ss);
  buildMonthly_(ss);
  ensureSheetOrder_(ss);
  props.setProperty('setup', SETUP_VERSION);
}

function getDataSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_DATA);
  if (!sh) {
    var first = ss.getSheets()[0];
    // ใช้แท็บเดิมที่มีข้อมูลอยู่แล้ว ถ้ายังไม่ใช่แท็บสรุป/ตั้งค่า
    if (first && first.getName() !== SHEET_DASH && first.getName() !== SHEET_SET) {
      first.setName(SHEET_DATA);
      sh = first;
    } else {
      sh = ss.insertSheet(SHEET_DATA);
    }
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sh;
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
//  จัดรูปแบบตารางข้อมูล
// ------------------------------------------------------------
function formatDataSheet_(sh) {
  var cols = HEADERS.length;
  var minRows = 2000;
  if (sh.getMaxRows() < minRows) sh.insertRowsAfter(sh.getMaxRows(), minRows - sh.getMaxRows());
  var n = sh.getMaxRows();

  sh.getRange(1, 1, 1, cols).setValues([HEADERS]);
  sh.setTabColor(COLOR_PRIMARY);

  var all = sh.getRange(1, 1, n, cols);
  all.setFontFamily('Sarabun').setFontSize(10).setVerticalAlignment('middle');

  var header = sh.getRange(1, 1, 1, cols);
  header.setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontWeight('bold')
        .setHorizontalAlignment('center').setFontSize(11);
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);

  // รูปแบบข้อมูลต่อคอลัมน์ (วันที่/เดือนเก็บเป็นข้อความ เพื่อให้สูตรสรุปจับคู่ได้ตรง)
  sh.getRange(2, 2, n - 1, 2).setNumberFormat('@');   // B,C
  sh.getRange(2, 12, n - 1, 1).setNumberFormat('@');  // L
  sh.getRange(2, 10, n - 1, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 1, n - 1, 1).setHorizontalAlignment('center');
  sh.getRange(2, 2, n - 1, 2).setHorizontalAlignment('center');
  sh.getRange(2, 6, n - 1, 1).setHorizontalAlignment('center');
  sh.getRange(2, 8, n - 1, 2).setHorizontalAlignment('center');
  sh.getRange(2, 10, n - 1, 1).setHorizontalAlignment('right').setFontWeight('bold');
  sh.getRange(2, 11, n - 1, 1).setHorizontalAlignment('center');
  sh.getRange(2, 12, n - 1, 1).setHorizontalAlignment('center').setFontColor('#9ca3af');
  sh.getRange(2, 15, n - 1, 1).setHorizontalAlignment('center');
  sh.getRange(2, 16, n - 1, 3).setNumberFormat('#,##0.00').setHorizontalAlignment('right');

  var widths = [80, 100, 80, 110, 240, 100, 100, 70, 80, 120, 120, 150, 120, 120, 170, 110, 130, 110];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  // สลับสีแถว
  var bandings = sh.getBandings();
  for (var b = 0; b < bandings.length; b++) bandings[b].remove();
  var banding = sh.getRange(1, 1, n, cols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  banding.setHeaderRowColor(COLOR_PRIMARY).setFirstRowColor('#ffffff').setSecondRowColor(COLOR_SOFT);

  // สีตามประเภทและสถานะ
  var typeRange = sh.getRange(2, 1, n - 1, 1);
  var statusRange = sh.getRange(2, 11, n - 1, 1);
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายรับ').setBackground('#d1fae5').setFontColor('#047857').setBold(true).setRanges([typeRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายจ่าย').setBackground('#fee2e2').setFontColor('#b91c1c').setBold(true).setRanges([typeRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('เสร็จสิ้น').setBackground('#d1fae5').setFontColor('#047857').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รอดำเนินการ').setBackground('#fef3c7').setFontColor('#b45309').setBold(true).setRanges([statusRange]).build()
  ];
  sh.setConditionalFormatRules(rules);

  // ตัวกรอง + ซ่อนคอลัมน์ที่ระบบใช้ภายใน (ID, RAW_JSON)
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, n, cols).createFilter();
  sh.hideColumns(COL_ID + 1, 2);
}

// ------------------------------------------------------------
//  แดชบอร์ดสรุป + กราฟ
// ------------------------------------------------------------
function buildDashboard_(ss) {
  var sh = ss.getSheetByName(SHEET_DASH);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DASH, 0);
  } else {
    sh.getCharts().forEach(function (ch) { sh.removeChart(ch); });
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
    sh.clear();
  }
  sh.setTabColor(COLOR_DARK);
  sh.setHiddenGridlines(true);
  if (sh.getMaxColumns() < 12) sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());
  if (sh.getMaxRows() < 80) sh.insertRowsAfter(sh.getMaxRows(), 80 - sh.getMaxRows());

  var D = "'" + SHEET_DATA + "'!";
  var S = "'" + SHEET_SET + "'!";
  var amt = D + '$J$2:$J', typ = D + '$A$2:$A', mon = D + '$C$2:$C', cat = D + '$D$2:$D', who = D + '$F$2:$F', sta = D + '$K$2:$K';

  sh.getRange(1, 1, 80, 12).setFontFamily('Sarabun').setVerticalAlignment('middle');
  var widths = [110, 110, 110, 110, 24, 120, 110, 100, 24, 110, 110, 24];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  // หัวเรื่อง
  sh.getRange('A1:L1').merge().setValue('💖  Our Wallet — สรุปการเงิน')
    .setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontSize(20).setFontWeight('bold')
    .setHorizontalAlignment('left');
  sh.setRowHeight(1, 56);

  // เลือกเดือน
  var thisMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
  sh.getRange('A2').setValue('เลือกเดือนที่ดู ▸').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
  sh.getRange('B2').setNumberFormat('@').setValue(thisMonth)
    .setBackground('#ffffff').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange('A11:A22'), true).setAllowInvalid(true).build());
  sh.getRange('C2').setValue('(ตารางและกราฟด้านล่างเปลี่ยนตามเดือนที่เลือก)').setFontColor('#9ca3af').setFontSize(9);
  sh.setRowHeight(2, 32);
  sh.getRange('A3:L3').setBackground(COLOR_SOFT);
  sh.setRowHeight(3, 8);

  // การ์ดตัวเลขสำคัญ
  var cards = [
    {range: 'A4:B4', valRange: 'A5:B5', subRange: 'A6:B6', label: 'รายรับ', color: COLOR_INCOME,
     formula: '=SUMIFS(' + amt + ',' + typ + ',"รายรับ",' + mon + ',$B$2)', sub: '="เดือน "&$B$2'},
    {range: 'C4:D4', valRange: 'C5:D5', subRange: 'C6:D6', label: 'รายจ่าย', color: COLOR_EXPENSE,
     formula: '=SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + mon + ',$B$2)', sub: '="จ่ายแล้ว "&TEXT(SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + sta + ',"เสร็จสิ้น",' + mon + ',$B$2),"#,##0")'},
    {range: 'F4:G4', valRange: 'F5:G5', subRange: 'F6:G6', label: 'คงเหลือ', color: COLOR_DARK,
     formula: '=A5-C5', sub: '=IF(A5=0,"-",TEXT((A5-C5)/A5,"0%")&" ของรายรับ")'},
    {range: 'H4:K4', valRange: 'H5:K5', subRange: 'H6:K6', label: 'บิลรอจ่าย', color: '#f59e0b',
     formula: '=SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + sta + ',"รอดำเนินการ",' + mon + ',$B$2)',
     sub: '=COUNTIFS(' + typ + ',"รายจ่าย",' + sta + ',"รอดำเนินการ",' + mon + ',$B$2)&" รายการ"'}
  ];
  cards.forEach(function (card) {
    sh.getRange(card.range).merge().setValue(card.label).setFontSize(10).setFontColor('#6b7280').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(card.valRange).merge().setFormula(card.formula).setNumberFormat('฿#,##0.00').setFontSize(18).setFontWeight('bold')
      .setFontColor(card.color).setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(card.subRange).merge().setFormula(card.sub).setFontSize(9).setFontColor('#9ca3af').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(card.range.split(':')[0] + ':' + card.subRange.split(':')[1])
      .setBorder(true, true, true, true, false, false, '#fecdd3', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(4, 24); sh.setRowHeight(5, 40); sh.setRowHeight(6, 22);

  // งบประมาณ
  sh.getRange('A7:K7').merge()
    .setFormula('=IFERROR(IF(VLOOKUP($B$2,' + S + '$A:$B,2,FALSE)>0,"🎯 งบเดือนนี้ "&TEXT(VLOOKUP($B$2,' + S + '$A:$B,2,FALSE),"#,##0")&" บาท  •  ใช้ไป "&TEXT(C5/VLOOKUP($B$2,' + S + '$A:$B,2,FALSE),"0%")&IF(C5>VLOOKUP($B$2,' + S + '$A:$B,2,FALSE),"  ⚠️ เกินงบ",""),"🎯 ยังไม่ได้ตั้งงบเดือนนี้ (ตั้งได้ในแอป)"),"🎯 ยังไม่ได้ตั้งงบเดือนนี้ (ตั้งได้ในแอป)")')
    .setHorizontalAlignment('center').setFontColor(COLOR_DARK).setFontWeight('bold').setBackground(COLOR_SOFT);
  sh.setRowHeight(7, 30);

  // ตารางที่ 1: 12 เดือนล่าสุด
  sectionTitle_(sh, 'A9:D9', '📈 รายรับ–รายจ่าย 12 เดือนล่าสุด');
  tableHeader_(sh.getRange('A10:D10'), ['เดือน', 'รายรับ', 'รายจ่าย', 'คงเหลือ']);
  for (var r = 11; r <= 22; r++) {
    var offset = r - 22;
    sh.getRange(r, 1).setFormula('=YEAR(EDATE(TODAY(),' + offset + '))&"-"&TEXT(MONTH(EDATE(TODAY(),' + offset + ')),"00")');
    sh.getRange(r, 2).setFormula('=SUMIFS(' + amt + ',' + typ + ',"รายรับ",' + mon + ',$A' + r + ')');
    sh.getRange(r, 3).setFormula('=SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + mon + ',$A' + r + ')');
    sh.getRange(r, 4).setFormula('=B' + r + '-C' + r);
  }
  sh.getRange('A11:A22').setHorizontalAlignment('center');
  sh.getRange('B11:D22').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('A11:D22').setBorder(null, null, true, null, null, true, '#fce7eb', SpreadsheetApp.BorderStyle.SOLID);

  // ตารางที่ 2: ตามหมวดหมู่
  sectionTitle_(sh, 'F9:H9', '🍩 รายจ่ายตามหมวด');
  tableHeader_(sh.getRange('F10:H10'), ['หมวด', 'จำนวน', '%']);
  for (var i = 0; i < EXPENSE_CATEGORIES.length; i++) {
    var rr = 11 + i;
    sh.getRange(rr, 6).setValue(EXPENSE_CATEGORIES[i]);
    sh.getRange(rr, 7).setFormula('=SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + cat + ',$F' + rr + ',' + mon + ',$B$2)');
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
    sh.getRange(ir, 11).setFormula('=SUMIFS(' + amt + ',' + typ + ',"รายรับ",' + cat + ',$J' + ir + ',' + mon + ',$B$2)');
  }
  sh.getRange('K11:K17').setNumberFormat('#,##0').setHorizontalAlignment('right').setFontColor('#047857');
  sh.getRange('J11:K17').setBorder(null, null, true, null, null, true, '#d1fae5', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('J18:K18').setValues([['รวม', '']]);
  sh.getRange('K18').setFormula('=SUM(K11:K17)').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('J18:K18').setFontWeight('bold').setBackground('#ecfdf5');

  // ตารางที่ 4: แยกตามคน
  sectionTitle_(sh, 'F19:H19', '👫 แยกตามคน (เดือนที่เลือก)');
  tableHeader_(sh.getRange('F20:H20'), ['คน', 'รายรับ', 'รายจ่าย']);
  for (var p = 0; p < PEOPLE.length; p++) {
    var pr = 21 + p;
    sh.getRange(pr, 6).setValue(PEOPLE[p]).setFontWeight('bold');
    sh.getRange(pr, 7).setFormula('=SUMIFS(' + amt + ',' + typ + ',"รายรับ",' + who + ',$F' + pr + ',' + mon + ',$B$2)').setFontColor('#047857');
    sh.getRange(pr, 8).setFormula('=SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + who + ',$F' + pr + ',' + mon + ',$B$2)').setFontColor('#b91c1c');
  }
  sh.getRange('G21:H22').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange('F21:H22').setBorder(null, null, true, null, null, true, '#fce7eb', SpreadsheetApp.BorderStyle.SOLID);

  // กราฟ
  sectionTitle_(sh, 'A24:K24', '📊 กราฟสรุป');
  var PINKS = ['#ff4d6d', '#f59e0b', '#8b5cf6', '#0ea5e9', '#10b981', '#c9184a', '#9ca3af'];
  var GREENS = ['#059669', '#10b981', '#34d399', '#6ee7b7', '#047857', '#065f46', '#a7f3d0'];

  sh.insertChart(sh.newChart().asColumnChart()
    .addRange(sh.getRange('A10:C22')).setNumHeaders(1)
    .setOption('title', 'รายรับ vs รายจ่าย รายเดือน')
    .setOption('colors', [COLOR_INCOME, COLOR_EXPENSE])
    .setOption('legend', {position: 'bottom'})
    .setOption('vAxis', {format: '#,##0', gridlines: {color: '#f3f4f6'}})
    .setOption('bar', {groupWidth: '65%'})
    .setOption('width', 450).setOption('height', 300)
    .setPosition(25, 1, 0, 6).build());

  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('F10:G17')).setNumHeaders(1)
    .setOption('title', 'รายจ่ายตามหมวด (เดือนที่เลือก)')
    .setOption('pieHole', 0.5).setOption('colors', PINKS)
    .setOption('legend', {position: 'right'}).setOption('pieSliceText', 'percentage')
    .setOption('width', 520).setOption('height', 300)
    .setPosition(25, 6, 10, 6).build());

  sh.insertChart(sh.newChart().asLineChart()
    .addRange(sh.getRange('A10:A22')).addRange(sh.getRange('D10:D22')).setNumHeaders(1)
    .setOption('title', 'เงินคงเหลือสุทธิรายเดือน')
    .setOption('colors', [COLOR_DARK]).setOption('legend', {position: 'none'})
    .setOption('curveType', 'function').setOption('pointSize', 5)
    .setOption('vAxis', {format: '#,##0', gridlines: {color: '#f3f4f6'}})
    .setOption('width', 450).setOption('height', 300)
    .setPosition(41, 1, 0, 6).build());

  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange('J10:K17')).setNumHeaders(1)
    .setOption('title', 'รายรับตามประเภท (เดือนที่เลือก)')
    .setOption('pieHole', 0.5).setOption('colors', GREENS)
    .setOption('legend', {position: 'right'}).setOption('pieSliceText', 'percentage')
    .setOption('width', 520).setOption('height', 300)
    .setPosition(41, 6, 10, 6).build());

  sh.insertChart(sh.newChart().asColumnChart()
    .addRange(sh.getRange('F20:H22')).setNumHeaders(1)
    .setOption('title', 'รายรับ vs รายจ่าย แยกตามคน (เดือนที่เลือก)')
    .setOption('colors', [COLOR_INCOME, COLOR_EXPENSE])
    .setOption('legend', {position: 'bottom'})
    .setOption('vAxis', {format: '#,##0', gridlines: {color: '#f3f4f6'}})
    .setOption('width', 450).setOption('height', 300)
    .setPosition(57, 1, 0, 6).build());

  sh.getRange('F57').setValue('ดูรายการรายเดือนแยกรายรับ/รายจ่ายได้ที่แท็บ "รายเดือน"')
    .setFontColor(COLOR_DARK).setFontWeight('bold');
  sh.getRange('A74').setValue('ข้อมูลทั้งหมดคำนวณจากแท็บ "รายการ" อัตโนมัติ  •  อย่าแก้ตัวเลขในแท็บนี้ (แก้ได้เฉพาะช่อง "เลือกเดือนที่ดู")')
    .setFontSize(9).setFontColor('#9ca3af');
  sh.setFrozenRows(2);
  ss.setActiveSheet(sh);
}

// ------------------------------------------------------------
//  แท็บ "รายเดือน": ตารางรายการของเดือน เลือกดู ทั้งหมด / รายรับ / รายจ่าย
// ------------------------------------------------------------
function buildMonthly_(ss) {
  var sh = ss.getSheetByName(SHEET_MONTH);
  if (!sh) {
    sh = ss.insertSheet(SHEET_MONTH);
  } else {
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
    sh.clearConditionalFormatRules();
    sh.clear();
  }
  sh.setTabColor('#8b5cf6');
  sh.setHiddenGridlines(true);
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8 - sh.getMaxColumns());
  if (sh.getMaxRows() < 320) sh.insertRowsAfter(sh.getMaxRows(), 320 - sh.getMaxRows());

  var D = "'" + SHEET_DATA + "'!";
  var amt = D + '$J$2:$J', typ = D + '$A$2:$A', mon = D + '$C$2:$C', sta = D + '$K$2:$K';

  sh.getRange(1, 1, 320, 8).setFontFamily('Sarabun').setVerticalAlignment('middle');
  var widths = [100, 90, 110, 240, 90, 120, 120, 24];
  for (var c = 0; c < widths.length; c++) sh.setColumnWidth(c + 1, widths[c]);

  sh.getRange('A1:G1').merge().setValue('📅  รายการรายเดือน')
    .setBackground(COLOR_PRIMARY).setFontColor('#ffffff').setFontSize(20).setFontWeight('bold');
  sh.setRowHeight(1, 56);

  var thisMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
  sh.getRange('A2').setValue('เดือน ▸').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
  sh.getRange('B2:C2').merge().setNumberFormat('@').setValue(thisMonth)
    .setBackground('#ffffff').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(SHEET_DASH).getRange('A11:A22'), true).setAllowInvalid(true).build());
  sh.getRange('A3').setValue('มุมมอง ▸').setFontWeight('bold').setHorizontalAlignment('right').setFontColor(COLOR_DARK);
  sh.getRange('B3:C3').merge().setValue('ทั้งหมด')
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR_PRIMARY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ทั้งหมด', 'รายรับ', 'รายจ่าย'], true).setAllowInvalid(false).build());
  sh.getRange('D2').setValue('เลือกเดือนและมุมมอง (ทั้งหมด / รายรับ / รายจ่าย) ตารางด้านล่างจะเปลี่ยนตาม').setFontColor('#9ca3af').setFontSize(9);
  sh.setRowHeight(2, 32); sh.setRowHeight(3, 32);

  // การ์ดสรุป
  var kpis = [
    {r: 'A5:B5', v: 'A6:B6', label: 'รายรับ', color: COLOR_INCOME, f: '=SUMIFS(' + amt + ',' + typ + ',"รายรับ",' + mon + ',$B$2)'},
    {r: 'C5:D5', v: 'C6:D6', label: 'รายจ่าย', color: COLOR_EXPENSE, f: '=SUMIFS(' + amt + ',' + typ + ',"รายจ่าย",' + mon + ',$B$2)'},
    {r: 'E5:F5', v: 'E6:F6', label: 'คงเหลือ', color: COLOR_DARK, f: '=A6-C6'},
    {r: 'G5:G5', v: 'G6:G6', label: 'บิลรอจ่าย', color: '#f59e0b', f: '=COUNTIFS(' + typ + ',"รายจ่าย",' + sta + ',"รอดำเนินการ",' + mon + ',$B$2)&" รายการ"'}
  ];
  kpis.forEach(function (k) {
    if (k.r.split(':')[0] !== k.r.split(':')[1]) { sh.getRange(k.r).merge(); sh.getRange(k.v).merge(); }
    sh.getRange(k.r).setValue(k.label).setFontSize(10).setFontColor('#6b7280').setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.v).setFormula(k.f).setNumberFormat('฿#,##0.00').setFontSize(16).setFontWeight('bold').setFontColor(k.color)
      .setHorizontalAlignment('center').setBackground('#ffffff');
    sh.getRange(k.r.split(':')[0] + ':' + k.v.split(':')[1]).setBorder(true, true, true, true, false, false, '#fecdd3', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(5, 24); sh.setRowHeight(6, 36);

  // หัวตาราง + ผลลัพธ์จาก QUERY
  var headers = ['วันที่', 'ประเภท', 'หมวดหมู่', 'รายการ', 'คน', 'จำนวนเงิน', 'สถานะ'];
  sh.getRange('A8:G8').setValues([headers]).setBackground(COLOR_DARK).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sh.setRowHeight(8, 30);
  sh.getRange('A9').setFormula(
    '=IFERROR(QUERY(' + D + '$A$2:$K,"select B,A,D,E,F,J,K where C=\'"&$B$2&"\'"&IF($B$3="รายรับ"," and A=\'รายรับ\'",IF($B$3="รายจ่าย"," and A=\'รายจ่าย\'",""))&" order by B desc",0),"ไม่มีรายการตามที่เลือก")');
  sh.getRange('A9:A320').setHorizontalAlignment('center');
  sh.getRange('B9:B320').setHorizontalAlignment('center');
  sh.getRange('E9:E320').setHorizontalAlignment('center');
  sh.getRange('G9:G320').setHorizontalAlignment('center');
  sh.getRange('F9:F320').setNumberFormat('#,##0.00').setHorizontalAlignment('right').setFontWeight('bold');

  var body = sh.getRange('A9:G320');
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายรับ"').setFontColor('#047857').setRanges([sh.getRange('B9:B320'), sh.getRange('F9:F320')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายจ่าย"').setFontColor('#b91c1c').setRanges([sh.getRange('B9:B320'), sh.getRange('F9:F320')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายรับ"').setBackground('#ecfdf5').setRanges([body]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B9="รายจ่าย"').setBackground('#fff1f2').setRanges([body]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G9="รอดำเนินการ"').setFontColor('#b45309').setBold(true).setRanges([sh.getRange('G9:G320')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายรับ').setBackground('#d1fae5').setFontColor('#047857').setBold(true).setRanges([sh.getRange('B3:C3')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('รายจ่าย').setBackground('#fee2e2').setFontColor('#b91c1c').setBold(true).setRanges([sh.getRange('B3:C3')]).build()
  ];
  sh.setConditionalFormatRules(rules);
  sh.setFrozenRows(8);
}

function ensureSheetOrder_(ss) {
  var order = [SHEET_DASH, SHEET_MONTH, SHEET_DATA, SHEET_SET];
  for (var i = 0; i < order.length; i++) {
    var sh = ss.getSheetByName(order[i]);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
  }
  var dash = ss.getSheetByName(SHEET_DASH);
  if (dash) ss.setActiveSheet(dash);
}

function sectionTitle_(sh, a1, text) {
  sh.getRange(a1).merge().setValue(text).setFontWeight('bold').setFontSize(12).setFontColor(COLOR_DARK).setHorizontalAlignment('left');
}

function tableHeader_(range, labels, color) {
  range.setValues([labels]).setBackground(color || COLOR_PRIMARY).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
}
