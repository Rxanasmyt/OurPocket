// ทดสอบฟีเจอร์ใช้งานจริง: กรอกเร็ว (ชิป), ปัดแถว, เลิกทำ, เส้นแนวโน้ม, ฉลอง, ปุ่มลอย — เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const ymOf = (o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const M0 = ymOf(0), M1 = ymOf(-1), M2 = ymOf(-2);
const seed = [
  { id: 'i0', type: 'income', date: M0 + '-01', monthYear: M0, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 10 },
  { id: 'i1', type: 'income', date: M1 + '-01', monthYear: M1, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 25000, taxRate: 0, netAmount: 25000, timestamp: 9 },
  { id: 'i2', type: 'income', date: M2 + '-01', monthYear: M2, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 20000, taxRate: 0, netAmount: 20000, timestamp: 8 },
  { id: 'e1', type: 'expense', date: M0 + '-28', monthYear: M0, category: 'เดินทาง', who: 'Phada', description: 'ค่าน้ำมัน', bank: 'KBank', amount: 800, isCompleted: false, timestamp: 7 },
  { id: 'e2', type: 'expense', date: M0 + '-27', monthYear: M0, category: 'ที่พัก', who: 'Anas', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 2500, isCompleted: false, timestamp: 6 },
  { id: 'e3', type: 'expense', date: M1 + '-10', monthYear: M1, category: 'อาหาร', who: 'Anas', description: 'ข้าวมันไก่', bank: 'เงินสด', amount: 60, isCompleted: true, timestamp: 5 }
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
  await p.addInitScript(([s]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [seed]);
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const recs = () => p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]'));
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('#toast-container > div')].map((d) => d.textContent.trim()));
  const ptr = (sel, type, x, y) => p.evaluate(([s, t, xx, yy]) => {
    const el = document.querySelector(s);
    el.dispatchEvent(new PointerEvent(t, { clientX: xx, clientY: yy, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }));
  }, [sel, type, x, y]);
  const drag = async (sel, dx, dy = 0) => { await ptr(sel, 'pointerdown', 200, 300); for (let i = 1; i <= 8; i++) await ptr(sel, 'pointermove', 200 + (dx * i) / 8, 300 + (dy * i) / 8); await ptr(sel, 'pointerup', 200 + dx, 300 + dy); };

  console.log('== quick entry chips ==');
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(600);
  ok(await p.$$eval('#expenseModal .chips[data-for="expCategory"] .chip', (e) => e.length) === 7, 'category chips: 7');
  ok(await p.$$eval('#expenseModal .chips[data-for="expBank"] .chip', (e) => e.length) === 9, 'bank chips: 9');
  await p.click('#expenseModal .chips[data-for="expCategory"] .chip[data-value="เดินทาง"]');
  ok((await p.inputValue('#expCategory')) === 'เดินทาง' && await p.$eval('.chips[data-for="expCategory"] .chip[data-value="เดินทาง"]', (e) => e.classList.contains('active')), 'tap category chip -> select value + highlighted');
  await p.fill('#expDesc', 'ค่าไฟบ้าน'); await p.dispatchEvent('#expDesc', 'input');
  ok((await p.inputValue('#expCategory')) === 'เดินทาง', 'manual category choice is not overridden by auto-guess');
  await p.click('#expenseModal .chips[data-for="expBank"] .chip[data-value="SCB"]');
  ok((await p.inputValue('#expBank')) === 'SCB', 'bank chip sets bank');
  await p.click('#expenseModal .chips[data-for="expPayMode"] .chip[data-value="installment"]');
  ok(await p.evaluate(() => !document.getElementById('expInstallBox').classList.contains('hidden')), 'pay-mode chip reveals installment fields');
  await p.click('#expenseModal .chips[data-for="expPayMode"] .chip[data-value="normal"]');
  await p.fill('#expAmount', ''); await p.click('#expenseModal >> text=+500'); await p.click('#expenseModal >> text=+100');
  ok((await p.inputValue('#expAmount')) === '600', 'amount shortcuts add up: ' + await p.inputValue('#expAmount'));
  await p.click('#expenseModal >> text=พรุ่งนี้');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  ok((await p.inputValue('#expDueDate')) === `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`, 'date shortcut: tomorrow');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);

  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(500);
  const recent = await p.$$eval('#expRecent .chip', (e) => e.map((x) => x.textContent));
  ok(recent.includes('ค่าน้ำมัน') && recent.includes('ค่าไฟ'), 'recent descriptions as chips: ' + recent.join(', '));
  await p.click('#expRecent .chip:has-text("ค่าน้ำมัน")');
  ok((await p.inputValue('#expDesc')) === 'ค่าน้ำมัน' && (await p.inputValue('#expCategory')) === 'เดินทาง' && (await p.inputValue('#expBank')) === 'KBank' && (await p.inputValue('#expAmount')) === '800', 'tapping a recent chip fills category, bank and amount from last time');
  await p.evaluate(() => document.getElementById('expenseForm').requestSubmit()); await p.waitForTimeout(500);
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(500);
  ok((await p.inputValue('#expWho')) === 'Phada' && (await p.inputValue('#expBank')) === 'KBank', 'remembers last person and bank for the next entry');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);

  console.log('== swipe rows + undo ==');
  const rowSel = (id) => `#transactionsList .swipe-row[data-id="${id}"] .row-card`;
  const before = (await recs()).length;
  await drag(rowSel('e2'), -40);
  ok((await recs()).length === before && await p.evaluate(() => !document.getElementById('expenseModal').classList.contains('flex')), 'short swipe: nothing happens (springs back)');
  await drag(rowSel('e2'), 0, 120);
  ok((await recs()).length === before, 'vertical drag (scrolling) is ignored');
  await p.click(rowSel('e2') + ' p.font-medium'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.getElementById('expenseModal').classList.contains('flex') && document.getElementById('expDesc').value === 'ค่าไฟ'), 'tap on a row opens it for editing');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);
  await drag(rowSel('e2'), 130); await p.waitForTimeout(300);
  ok((await recs()).find((t) => t.id === 'e2').isCompleted === true, 'swipe right marks the bill paid');
  ok((await toasts()).some((t) => t.includes('จ่ายแล้ว')) , 'toast confirms');
  await p.click('.toast-action:last-of-type'); await p.waitForTimeout(300);
  ok((await recs()).find((t) => t.id === 'e2').isCompleted === false, 'undo reverts the payment');
  await drag(rowSel('e2'), -130); await p.waitForTimeout(500);
  ok((await recs()).some((t) => t.id === 'e2') && await p.isVisible('#delConfirm'), 'swipe left asks for confirmation first (nothing deleted yet)');
  await p.click('#delOk'); await p.waitForTimeout(500);
  ok(!(await recs()).some((t) => t.id === 'e2'), 'confirming deletes the item');
  await p.click('.toast-action'); await p.waitForTimeout(500);
  ok((await recs()).some((t) => t.id === 'e2') && await p.evaluate(() => !!document.querySelector('#transactionsList .swipe-row[data-id="e2"]')), 'undo brings the deleted item back (data + screen)');

  console.log('== undo of a recurring bill delete restores auto-generation ==');
  await p.evaluate(() => { window.openModal('expenseModal'); document.getElementById('expDesc').value = 'ผ่อนทีวี'; document.getElementById('expPayMode').value = 'installment'; document.getElementById('expPayMode').dispatchEvent(new Event('change')); document.getElementById('expInstallAmount').value = 500; document.getElementById('expCurInstall').value = 1; document.getElementById('expTotalInstall').value = 6; document.getElementById('expAmount').value = 500; document.getElementById('expenseForm').requestSubmit(); });
  await p.waitForTimeout(600);
  let tv = (await recs()).filter((t) => t.description === 'ผ่อนทีวี');
  const auto = tv.find((t) => t.autoGenerated);
  ok(tv.length === 2 && auto, 'series created: ' + tv.map((t) => t.monthYear).join(','));
  await p.evaluate((id) => window.deleteItem(id), auto.id); await p.waitForTimeout(500);
  ok((await recs()).find((t) => t.description === 'ผ่อนทีวี' && !t.autoGenerated).stopAuto === true, 'deleting the latest bill stops the series');
  await p.click('.toast-action'); await p.waitForTimeout(500);
  const live = (await recs()).filter((t) => t.description === 'ผ่อนทีวี');
  ok(live.length === 2 && !live.find((t) => !t.autoGenerated).stopAuto, 'undo restores the bill and re-enables the series');

  console.log('== trend lines, celebration, floating buttons, ripple ==');
  ok(await p.$eval('#sparkInc', (e) => !!e.querySelector('polyline')) && await p.$eval('#sparkExp', (e) => !!e.querySelector('polyline')), 'income & expense cards show a 6-month trend line');
  await p.evaluate(() => { document.getElementById('toast-container').innerHTML = ''; });
  // pay all but one -> no confetti; pay the last -> confetti
  const unpaid = (await recs()).filter((t) => t.type === 'expense' && !t.isCompleted && t.monthYear <= ymOf(1));
  for (let i = 0; i < unpaid.length - 1; i++) { await p.evaluate((id) => window.toggleStatus(id), unpaid[i].id); await p.waitForTimeout(150); }
  ok(await p.evaluate(() => !document.querySelector('.confetti-box')), 'no confetti while bills remain');
  await p.evaluate((id) => window.toggleStatus(id), unpaid[unpaid.length - 1].id); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !!document.querySelector('.confetti-box')) && (await toasts()).some((t) => t.includes('จ่ายครบทุกบิล')), 'paying the last bill celebrates with confetti');
  await p.waitForTimeout(2200);
  ok(await p.evaluate(() => !document.querySelector('.confetti-box')), 'confetti cleans itself up');
  await p.evaluate(() => { document.body.style.minHeight = '3000px'; });
  await p.evaluate(() => window.scrollTo(0, 400)); await p.waitForTimeout(80); await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(250);
  ok(await p.evaluate(() => document.getElementById('fabBar').classList.contains('fab-hidden')), 'floating buttons hide when scrolling down');
  await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(250);
  ok(await p.evaluate(() => !document.getElementById('fabBar').classList.contains('fab-hidden')), 'and return when scrolling up');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => { const b = document.getElementById('syncBtn'); b.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 20, bubbles: true })); });
  ok(await p.evaluate(() => !!document.querySelector('#syncBtn .ripple-dot')), 'buttons show a ripple on touch');
  await p.waitForTimeout(900);
  ok(await p.evaluate(() => !document.querySelector('.ripple-dot')), 'ripple removes itself');
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
