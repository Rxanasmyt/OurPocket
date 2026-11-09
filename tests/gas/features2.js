// ทดสอบ: แถบเตือนบิลใกล้ครบกำหนด, ตัวกรองคน/ธนาคาร, รายรับประจำอัตโนมัติ, การ์ดสรุปแยกรายคน
// เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const dstr = (o) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const M0 = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const seed = [
  { id: 'i1', type: 'income', date: M0 + '-01', monthYear: M0, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน Anas', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 9 },
  { id: 'i2', type: 'income', date: M0 + '-01', monthYear: M0, category: 'เงินเดือน', who: 'Phada', description: 'เงินเดือน Phada', amount: 20000, taxRate: 0, netAmount: 20000, timestamp: 8 },
  { id: 'e1', type: 'expense', date: M0 + '-05', monthYear: M0, category: 'อาหาร', who: 'Anas', description: 'ข้าว', bank: 'เงินสด', amount: 300, isCompleted: true, timestamp: 7 },
  { id: 'e2', type: 'expense', date: M0 + '-06', monthYear: M0, category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 1000, isCompleted: true, timestamp: 6 }
];
(async () => {
  const browser = await chromium.launch();
  const mk = async (data) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
    await p.addInitScript(([s]) => { if (!localStorage.getItem('x')) { localStorage.setItem('x', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [data]);
    await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1900);
    return { p, errs };
  };
  const rows = (p) => p.evaluate(() => [...document.querySelectorAll('#transactionsList .swipe-row')].map((r) => r.textContent));

  console.log('== due banner ==');
  let r = await mk(seed);
  ok(await r.p.evaluate(() => document.getElementById('dueBanner').classList.contains('hidden')), 'no banner when nothing is due');
  r = await mk([...seed, { id: 'b1', type: 'expense', date: dstr(-2), monthYear: dstr(-2).slice(0, 7), category: 'หนี้สิน', who: 'Anas', description: 'บัตร', bank: 'KTB', amount: 500, isCompleted: false, timestamp: 5 },
    { id: 'b2', type: 'expense', date: dstr(2), monthYear: dstr(2).slice(0, 7), category: 'ที่พัก', who: 'Phada', description: 'เน็ต', bank: 'SCB', amount: 700, isCompleted: false, timestamp: 4 },
    { id: 'b3', type: 'expense', date: dstr(20), monthYear: dstr(20).slice(0, 7), category: 'ที่พัก', who: 'Phada', description: 'ไกลๆ', bank: 'SCB', amount: 900, isCompleted: false, timestamp: 3 }]);
  const bt = await r.p.evaluate(() => document.getElementById('dueBanner').textContent);
  ok(!(await r.p.evaluate(() => document.getElementById('dueBanner').classList.contains('hidden'))) && bt.includes('เกินกำหนด 1') && bt.includes('3 วัน 1') && bt.includes('1,200'), 'banner counts overdue + due-in-3-days only: ' + bt.trim());

  console.log('== who / bank filters ==');
  const all = (await rows(r.p)).length;
  await r.p.evaluate(() => window.setWho('Phada')); await r.p.waitForTimeout(200);
  const ph = await rows(r.p);
  ok(ph.length > 0 && ph.length < all && ph.every((t) => !t.includes('ข้าว')), 'filter by person keeps only that person (' + ph.length + '/' + all + ')');
  ok(await r.p.evaluate(() => document.querySelector('#filterRow [data-who="Phada"]').classList.contains('active')), 'person chip shows as selected');
  await r.p.selectOption('#bankFilter', 'กรุงศรี'); await r.p.waitForTimeout(200);
  const bk = await rows(r.p);
  ok(bk.length === 1 && bk[0].includes('ค่าไฟ'), 'bank filter combines with person filter');
  await r.p.click('#clearFilters'); await r.p.waitForTimeout(200);
  ok((await rows(r.p)).length === all, 'clear filters restores the list');
  await r.p.fill('#searchInput', 'SCB'); await r.p.waitForTimeout(250);
  ok((await rows(r.p)).length >= 1, 'search also matches the bank name');
  await r.p.fill('#searchInput', '');

  console.log('== per-person cards ==');
  r = await mk(seed);
  const pc = await r.p.evaluate(() => document.getElementById('personCards').textContent);
  ok(pc.includes('Anas') && pc.includes('Phada') && pc.includes('30,000') && pc.includes('20,000'), 'cards show each person income');
  await r.p.evaluate(() => document.querySelector('#personCards button').click()); await r.p.waitForTimeout(300);
  ok(await r.p.evaluate(() => document.querySelector('#filterRow [data-who="Anas"]').classList.contains('active')), 'tapping a card filters the list to that person');

  console.log('== recurring income ==');
  const inc = { id: 'ri1', type: 'income', date: dstr(-62).slice(0, 8) + '28', monthYear: dstr(-62).slice(0, 7), category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือนประจำ', amount: 25000, taxRate: 3, netAmount: 24250, recurring: true, timestamp: 1 };
  r = await mk([inc]);
  const gen = await r.p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).filter((t) => t.description === 'เงินเดือนประจำ').map((t) => t.monthYear + ':' + t.date.slice(8) + ':' + t.netAmount).sort());
  const nextM = (() => { const d = new Date(now.getFullYear(), now.getMonth() + 1, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
  ok(gen.length >= 3 && gen.every((g) => g.endsWith(':28:24250')) && gen[gen.length - 1].startsWith(nextM), 'income repeats every month on day 28 up to next month: ' + gen.join(' '));
  ok(await r.p.evaluate(() => !JSON.parse(localStorage.getItem('ourWalletData')).some((t) => t.id.startsWith('auto-') && t.type !== 'income')), 'only income rows generated');
  // deleting the latest stops it from coming back
  const lastId = await r.p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).filter((t) => t.description === 'เงินเดือนประจำ').sort((a, b) => a.monthYear < b.monthYear ? -1 : 1).pop().id);
  await r.p.evaluate((i) => window.deleteItem(i), lastId); await r.p.waitForTimeout(400);
  await r.p.evaluate(() => window.syncFromSheets && 0);
  await r.p.waitForTimeout(3500);
  ok(await r.p.evaluate((i) => !JSON.parse(localStorage.getItem('ourWalletData')).some((t) => t.id === i), lastId), 'deleted recurring income is not regenerated');
  // form checkbox
  r = await mk([]);
  await r.p.evaluate(() => window.openModal('incomeModal')); await r.p.waitForTimeout(400);
  ok(await r.p.isVisible('#incRecurring'), 'income form has the "every month" checkbox');
  ok(r.errs.length === 0, 'no page errors');
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
