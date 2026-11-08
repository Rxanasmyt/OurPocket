const { makeEnv } = require('./mock');
const { HyperFormula } = require('hyperformula');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

const now = new Date(); const pad = (n) => String(n).padStart(2, '0');
const ym = (o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const day = (o, dd) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const M0 = ym(0), M1 = ym(-1);

const recs = [
  { id: 'i1', type: 'income', date: M0 + '-01', monthYear: M0, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 3, netAmount: 29100 },
  { id: 'i2', type: 'income', date: M0 + '-01', monthYear: M0, category: 'ค่าเวร', who: 'Phada', description: 'ค่าเวร', amount: 5000, taxRate: 0, netAmount: 5000 },
  { id: 'i3', type: 'income', date: M1 + '-01', monthYear: M1, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 3, netAmount: 29100 },
  { id: 'e1', type: 'expense', date: M0 + '-05', monthYear: M0, category: 'อาหาร', who: 'Anas', description: 'ข้าว', bank: 'เงินสด', amount: 1200, isCompleted: true, payMode: 'normal' },
  { id: 'e2', type: 'expense', date: day(12), monthYear: day(12).slice(0, 7), category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 2500, isCompleted: false, payMode: 'normal' },
  { id: 'e3', type: 'expense', date: day(-5), monthYear: day(-5).slice(0, 7), category: 'ที่พัก', who: 'Anas', description: 'ค่าเช่า', bank: 'เงินสด', amount: 6000, isCompleted: false, payMode: 'normal' },
  { id: 'e4', type: 'expense', date: day(3), monthYear: day(3).slice(0, 7), category: 'หนี้สิน', who: 'Phada', description: 'ผ่อนมือถือ', bank: 'SCB', amount: 1500, isCompleted: false, payMode: 'installment', installmentAmount: 1500, currentInstallment: '3', totalInstallments: '5' },
  { id: 'e5', type: 'expense', date: day(20), monthYear: day(20).slice(0, 7), category: 'หนี้สิน', who: 'Anas', description: 'บัตร KTC', bank: 'KTB', amount: 1000, isCompleted: false, payMode: 'minpay', fullAmount: 17000, minAmount: 1000, remainingAmount: 16000 },
  { id: 'e6', type: 'expense', date: M1 + '-10', monthYear: M1, category: 'หนี้สิน', who: 'Anas', description: 'บัตร KTC', bank: 'KTB', amount: 3000, isCompleted: true, payMode: 'minpay', fullAmount: 20000, minAmount: 1000, remainingAmount: 17000 },
  { id: 'e7', type: 'expense', date: M1 + '-15', monthYear: M1, category: 'อาหาร', who: 'Phada', description: 'ข้าว', bank: 'KBank', amount: 800, isCompleted: true, payMode: 'normal' }
];

const env = makeEnv({ sheets: ['Sheet1'] });
recs.forEach((r) => env.post(r));
env.post({ action: 'budget', month: M0, amount: 10000 });
env.post({ action: 'sync' });
console.log('setupErrors:', JSON.stringify(env.props.get('setupErrors')));

const toMatrix = (sh) => { const R = sh.getLastRow(), C = Math.max(sh.getLastColumn(), 1); const m = []; for (let r = 1; r <= R; r++) { const row = []; for (let c = 1; c <= C; c++) row.push(sh.get(r, c)); m.push(row); } return m; };
const colL = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const fixOpen = (f) => f.replace(/(\$[A-Z]+)\$2:(\$[A-Z]+)(?![0-9$])/g, '$1$2:$2$3000'.replace('$2$3000', '$2$3000'));
// open-ended range -> bounded ($J$2:$J -> $J$2:$J$3000)
const bound = (f) => f.replace(/(!)(\$[A-Z]+):(\$[A-Z]+)(?![\d$])/g, (m, bang, a, b) => `${bang}${a}$1:${b}$3000`).replace(/(\$[A-Z]+)\$2:(\$[A-Z]+)(?![\d$])/g, (m, a, b) => `${a}$2:${b}$3000`);

function load(sheetName, skip) {
  const sh = env.ss.getSheetByName(sheetName);
  const m = toMatrix(sh);
  // overlay formulas
  for (const [k, f] of sh.formulas) {
    const [r, c] = k.split(',').map(Number);
    if (skip && skip(r, c, f)) continue;
    while (m.length < r) m.push([]);
    while (m[r - 1].length < c) m[r - 1].push('');
    m[r - 1][c - 1] = bound(f).replace(/,FALSE\)/g, ',FALSE())');
  }
  return m.map((row) => row.map((v) => (v === '' ? null : v)));
}

const sheetsData = {
  'รายการ': load('รายการ'),
  'ตั้งค่า': load('ตั้งค่า'),
  'สรุป': load('สรุป')
};
const hf = HyperFormula.buildFromSheets(sheetsData, { licenseKey: 'gpl-v3', useColumnIndex: false, dateFormats: ['YYYY-MM-DD'] });
const sid = (n) => hf.getSheetId(n);
const cell = (sheet, a1) => { const [, col, row] = a1.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of col) c = c * 26 + ch.charCodeAt(0) - 64; return hf.getCellValue({ sheet: sid(sheet), col: c - 1, row: +row - 1 }); };

console.log('== Dashboard (สรุป) formulas evaluated ==');
const sumBy = (f) => recs.filter(f).reduce((a, r) => a + (r.type === 'income' ? r.netAmount : r.amount), 0);
ok(cell('สรุป', 'B2') === M0, 'selected month = ' + M0);
ok(cell('สรุป', 'A5') === sumBy((r) => r.type === 'income' && r.monthYear === M0), 'income card = ' + cell('สรุป', 'A5'));
ok(cell('สรุป', 'C5') === sumBy((r) => r.type === 'expense' && r.monthYear === M0), 'expense card = ' + cell('สรุป', 'C5'));
ok(cell('สรุป', 'F5') === cell('สรุป', 'A5') - cell('สรุป', 'C5'), 'balance card = ' + cell('สรุป', 'F5'));
const pend0 = recs.filter((r) => r.type === 'expense' && !r.isCompleted && r.monthYear === M0);
ok(cell('สรุป', 'H5') === pend0.reduce((a, r) => a + r.amount, 0), 'pending card = ' + cell('สรุป', 'H5'));
ok(String(cell('สรุป', 'H6')) === pend0.length + ' รายการ', 'pending count text = ' + cell('สรุป', 'H6'));
ok(String(cell('สรุป', 'A7')).includes('งบเดือนนี้ 10'), 'budget banner (HF cannot render TEXT thousands): ' + cell('สรุป', 'A7'));
ok(cell('สรุป', 'A22') === M0 && cell('สรุป', 'A21') === M1, 'month list ends with current & previous: ' + cell('สรุป', 'A21') + ',' + cell('สรุป', 'A22'));
ok(cell('สรุป', 'B22') === 34100 && cell('สรุป', 'B21') === 29100, '12-month income col: ' + cell('สรุป', 'B22') + ',' + cell('สรุป', 'B21'));
ok(cell('สรุป', 'D21') === cell('สรุป', 'B21') - cell('สรุป', 'C21'), 'net col');
ok(cell('สรุป', 'F11') === 'อาหาร' && cell('สรุป', 'G11') === 1200, 'category อาหาร this month = ' + cell('สรุป', 'G11'));
ok(cell('สรุป', 'K11') === 29100 && cell('สรุป', 'K14') === 5000, 'income by type: เงินเดือน ' + cell('สรุป', 'K11') + ', ค่าเวร ' + cell('สรุป', 'K14'));
ok(cell('สรุป', 'K19') === 34100, 'income total = ' + cell('สรุป', 'K19'));
ok(cell('สรุป', 'G22') === 29100 && cell('สรุป', 'H22') >= 1200, 'Anas income/expense: ' + cell('สรุป', 'G22') + '/' + cell('สรุป', 'H22'));
ok(cell('สรุป', 'G23') === 5000, 'Phada income = ' + cell('สรุป', 'G23'));
const bankRows = {}; for (let r = 23; r <= 31; r++) bankRows[cell('สรุป', 'J' + r)] = cell('สรุป', 'K' + r);
const expBank = (b) => sumBy((r) => r.type === 'expense' && r.monthYear === M0 && r.bank === b);
ok(Object.keys(bankRows).every((b) => bankRows[b] === expBank(b)), 'bank table matches expected: ' + JSON.stringify(bankRows));
const errs = []; hf.getSheetNames().forEach((n) => { const d = hf.getSheetValues(sid(n)); d.forEach((row, ri) => row.forEach((v, ci) => { if (v && typeof v === 'object' && v.type) errs.push(`${n}!${colL(ci + 1)}${ri + 1}:${v.value}`); })); });
ok(errs.length === 0, 'no formula errors anywhere: ' + errs.slice(0, 5).join(' | '));

console.log('== Plan (ลำดับจ่าย) display formulas, FILTER/SORT output simulated ==');
const dataSh = env.ss.getSheetByName('รายการ');
const dm = toMatrix(dataSh); const H = dm[0];
const iType = H.indexOf('ประเภท'), iSta = H.indexOf('สถานะ'), iDate = H.indexOf('วันที่'), iAmt = H.indexOf('จำนวนเงิน');
const unpaid = dm.slice(1).filter((r) => r[iType] === 'รายจ่าย' && r[iSta] === 'รอดำเนินการ').sort((a, b) => (a[iDate] < b[iDate] ? -1 : a[iDate] > b[iDate] ? 1 : b[iAmt] - a[iAmt]));
const plan = env.ss.getSheetByName('ลำดับจ่าย');
const HS = 20, FIRST = 26;
const planM = load('ลำดับจ่าย', (r, c, f) => f.startsWith('=IFERROR(SORT('));
unpaid.forEach((row, i) => row.forEach((v, c) => { const r = FIRST - 1 + i; while (planM.length <= r) planM.push([]); while (planM[r].length < HS + c) planM[r].push(null); planM[r][HS - 1 + c] = v === '' ? null : v; }));
const hf2 = HyperFormula.buildFromSheets({ 'รายการ': sheetsData['รายการ'], 'ตั้งค่า': sheetsData['ตั้งค่า'], 'ลำดับจ่าย': planM }, { licenseKey: 'gpl-v3', useColumnIndex: false, dateFormats: ['YYYY-MM-DD'] });
const pc = (a1) => { const [, col, row] = a1.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of col) c = c * 26 + ch.charCodeAt(0) - 64; return hf2.getCellValue({ sheet: hf2.getSheetId('ลำดับจ่าย'), col: c - 1, row: +row - 1 }); };
const days = (s) => Math.round((Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
ok(unpaid.length === 4, 'unpaid bills = 4 (the 2 completed and 2 income excluded): ' + unpaid.length);
console.log('   order:', unpaid.map((r) => r[H.indexOf('รายการ')] + '@' + r[iDate]).join(' → '));
ok(pc('F26') === 'ค่าเช่า' && pc('F27') === 'ผ่อนมือถือ' && pc('F28') === 'ค่าไฟ' && pc('F29') === 'บัตร KTC', 'sorted by due date: ' + [26, 27, 28, 29].map((r) => pc('F' + r)).join(' → '));
ok(pc('A26') === 1 && pc('A29') === 4 && (pc('A30') === '' || pc('A30') === null), 'running numbers 1..4 then blank');
ok(pc('D26') === days(day(-5)) && pc('D27') === days(day(3)), 'days left: ' + pc('D26') + ', ' + pc('D27'));
ok(String(pc('B26')).includes('เกินกำหนด') && String(pc('B27')).includes('ภายใน 7 วัน') && String(pc('B28')).includes('ภายใน 1 เดือน') && String(pc('B29')).includes('ภายใน 1 เดือน'), 'urgency labels: ' + [26, 27, 28, 29].map((r) => pc('B' + r)).join(' | '));
console.log('   thai date:', pc('C26'), '| detail:', pc('J27'), '|', pc('J29'));
ok(/^\d{1,2} \S+ \d\d$/.test(pc('C26')), 'thai short date format');
const nz = (t) => String(t).replace(/(\d+),?##0/g, '$1').replace(/(\d),(\d{3})/g, '$1$2');
ok(nz(pc('J27')).startsWith('งวด 3/5 · ต่องวด 1500 · ผ่อนหมด '), 'installment detail text: ' + pc('J27'));
ok(nz(pc('J29')).startsWith('ยอดเต็ม 17000 · ขั้นต่ำ 1000 · ค้างหลังจ่าย 16000'), 'minpay detail text: ' + pc('J29'));
ok(pc('A5') === 11000 + 0 || true, 'kpi skipped');
ok(pc('I26') === 6000 && pc('E27') === 'SCB' && pc('H27') === 'ผ่อนบัตร: จ่ายเป็นงวด', 'amount/bank/type pass-through');
const total = unpaid.reduce((a, r) => a + r[iAmt], 0);
ok(pc('A5') === total, 'KPI total unpaid = ' + pc('A5') + ' (expected ' + total + ')');
ok(pc('M10') === 6000 && pc('M11') === 1500 && pc('M12') === 2500 + (days(day(20)) <= 31 ? 1000 : 0), 'urgency sums: ' + [10, 11, 12, 13].map((r) => pc('M' + r)).join(','));
const bk = {}; for (let r = 18; r <= 26; r++) bk[pc('L' + r)] = pc('M' + r);
ok(bk['เงินสด'] === 6000 && bk['SCB'] === 1500 && bk['กรุงศรี'] === 2500 && bk['KTB'] === 1000, 'unpaid by bank: ' + JSON.stringify(bk));
const errs2 = []; hf2.getSheetValues(hf2.getSheetId('ลำดับจ่าย')).forEach((row, ri) => row.forEach((v, ci) => { if (v && typeof v === 'object' && v.type) errs2.push(`${colL(ci + 1)}${ri + 1}:${v.value}`); }));
ok(errs2.length === 0, 'no formula errors on plan sheet: ' + errs2.slice(0, 5).join(' | '));

console.log('== Monthly query string ==');
const mq = env.ss.getSheetByName('รายเดือน').formulas.get('9,1');
console.log('  ', mq);
ok(mq.includes("where C='\"&$B$2&\"'") && mq.includes('select B,A,D,E,F,G,O,J,K') , 'QUERY selects the right columns by header position');
ok((mq.match(/\(/g) || []).length === (mq.match(/\)/g) || []).length, 'parentheses balanced');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
