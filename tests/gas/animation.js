// ทดสอบแอนิเมชันและท่าทางสัมผัส — เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const APP = 'http://localhost:8080/index.html';
const ym = new Date().toISOString().slice(0, 7);
const seed = [
  { id: 'i1', type: 'income', date: ym + '-01', monthYear: ym, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 1 },
  { id: 'e1', type: 'expense', date: ym + '-28', monthYear: ym, category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 2500, isCompleted: false, timestamp: 2 },
  { id: 'e2', type: 'expense', date: ym + '-27', monthYear: ym, category: 'อาหาร', who: 'Anas', description: 'ข้าว', bank: 'เงินสด', amount: 100, isCompleted: true, timestamp: 3 }
];
async function open(browser, reduced) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.addInitScript(([s]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [seed]);
  await p.goto(APP, { waitUntil: 'load' }); await p.waitForTimeout(1500);
  return { p, errs, ctx };
}
const touch = (p, sel, type, y, x = 100) => p.evaluate(([s, t, yy, xx]) => {
  const target = s === 'document' ? document.body : document.querySelector(s);
  const tc = new Touch({ identifier: 1, target, clientX: xx, clientY: yy });
  target.dispatchEvent(new TouchEvent(t, { touches: t === 'touchend' ? [] : [tc], targetTouches: t === 'touchend' ? [] : [tc], changedTouches: [tc], bubbles: true, cancelable: true }));
}, [sel, type, y, x]);
const swipe = async (p, sel, from, to) => { await touch(p, sel, 'touchstart', from); for (let y = from; y <= to; y += 20) await touch(p, sel, 'touchmove', y); await touch(p, sel, 'touchmove', to); await touch(p, sel, 'touchend', to); };

(async () => {
  const browser = await chromium.launch();
  let { p, errs } = await open(browser, false);

  console.log('== modal exit animation ==');
  await p.evaluate(() => window.openModal('debtModal')); await p.waitForTimeout(700);
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(60);
  ok(await p.evaluate(() => document.getElementById('debtModal').classList.contains('modal-closing') && document.getElementById('debtModal').classList.contains('flex')), 'sheet animates out (still mounted right after close)');
  await p.waitForTimeout(350);
  ok(await p.evaluate(() => document.getElementById('modalContainer').classList.contains('hidden') && document.getElementById('debtModal').classList.contains('hidden')), 'fully hidden afterwards');
  await p.evaluate(() => { window.openModal('debtModal'); window.closeModal(); window.openModal('sheetsModal'); }); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.getElementById('sheetsModal').classList.contains('flex') && !document.getElementById('sheetsModal').classList.contains('modal-closing') && document.getElementById('debtModal').classList.contains('hidden')), 'open right after close: new sheet shows, old one gone');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);

  console.log('== swipe down to close ==');
  await p.evaluate(() => window.openModal('debtModal')); await p.waitForTimeout(700);
  await swipe(p, '#debtModal > div:first-child', 300, 340); await p.waitForTimeout(700);
  ok(await p.evaluate(() => document.getElementById('debtModal').classList.contains('flex') && document.getElementById('debtModal').style.transform === ''), 'short drag springs back, sheet stays open');
  await swipe(p, '#debtModal > div:first-child', 300, 480); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.getElementById('debtModal').classList.contains('hidden') && document.getElementById('modalContainer').classList.contains('hidden')), 'long drag closes the sheet');
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !document.getElementById('expenseModal').classList.contains('sheet-grab')), 'forms have no swipe-to-close (protects typed data)');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);

  console.log('== accordion / segmented control / slide ==');
  const h = () => p.evaluate(() => document.getElementById('statsWrap').getBoundingClientRect().height);
  ok((await h()) < 2, 'charts collapsed at start: ' + (await h()));
  await p.evaluate(() => window.toggleStats()); await p.waitForTimeout(800);
  ok((await h()) > 200, 'charts expand smoothly: ' + Math.round(await h()) + 'px');
  ok((await p.$$eval('.bar-x, .bar-y', (e) => e.length)) > 0, 'bars re-animate when opened');
  await p.evaluate(() => window.toggleStats()); await p.waitForTimeout(800);
  ok((await h()) < 2, 'collapses back');
  const tx = async (v) => { await p.evaluate((x) => window.setView(x), v); await p.waitForTimeout(150); return p.evaluate(() => document.getElementById('segThumb').style.transform); };
  ok(await tx('income') === 'translateX(100%)' && await tx('expense') === 'translateX(200%)' && await tx('all') === 'translateX(0%)', 'segmented thumb slides under the chosen tab');
  // เบราว์เซอร์ที่รองรับใช้ View Transitions (ตั้ง data-vt-dir) ที่ไม่รองรับใช้คลาส slide-*
  const dirOf = () => p.evaluate(() => document.documentElement.dataset.vtDir || (document.getElementById('transactionsList').classList.contains('slide-next') ? 'next' : document.getElementById('transactionsList').classList.contains('slide-prev') ? 'prev' : ''));
  await p.evaluate(() => window.shiftMonth(1));
  ok((await dirOf()) === 'next', 'next month slides in from the right');
  await p.waitForTimeout(700);
  await p.evaluate(() => window.shiftMonth(-2));
  ok((await dirOf()) === 'prev', 'previous month slides in from the left');
  await p.waitForTimeout(700);
  await p.evaluate(() => window.shiftMonth(1)); await p.waitForTimeout(700);

  console.log('== delete / pay animations ==');
  await p.evaluate(() => window.deleteItem('e2'));
  ok(await p.evaluate(() => document.querySelector('#transactionsList [data-id="e2"]').classList.contains('removing')), 'row collapses out');
  ok((await p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).some((t) => t.id === 'e2'))) === false, 'data removed immediately (safe even if closed mid-animation)');
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => !document.querySelector('#transactionsList [data-id="e2"]')), 'row gone after animation');
  await p.evaluate(() => window.payBill('e1'));
  ok(await p.evaluate(() => { const c = document.querySelector('[data-pay-id="e1"]'); return c && c.classList.contains('removing') && c.classList.contains('paid'); }), 'paid bill flashes green and leaves the plan');
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).find((t) => t.id === 'e1').isCompleted === true), 'paid state saved immediately');
  await p.waitForTimeout(700);
  ok(await p.evaluate(() => !document.querySelector('[data-pay-id="e1"]')), 'plan card removed after animation');

  console.log('== number pop + pull to refresh ==');
  await p.evaluate(() => { window.openModal('incomeModal'); document.getElementById('incDesc').value = 'โบนัส'; document.getElementById('incAmount').value = '500'; document.getElementById('incomeForm').requestSubmit(); });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById('totalIncome').classList.contains('value-flash')), 'changed total pops');
  await p.waitForTimeout(500);
  await p.evaluate(() => window.scrollTo(0, 0));
  await touch(p, 'document', 'touchstart', 100); await touch(p, 'document', 'touchmove', 200); await touch(p, 'document', 'touchend', 200);
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.getElementById('ptr').classList.contains('spin')), 'pull down 100px+ triggers refresh spinner');
  ok(await p.evaluate(() => [...document.querySelectorAll('#toast-container > div')].some((d) => d.textContent.includes('ยังไม่ได้ตั้งค่า Google Sheet'))), 'with no sheet linked it says why instead of failing silently');
  await p.waitForTimeout(900);
  await touch(p, 'document', 'touchstart', 100); await touch(p, 'document', 'touchmove', 140); await touch(p, 'document', 'touchend', 140);
  ok(await p.evaluate(() => !document.getElementById('ptr').classList.contains('spin')), 'short pull does nothing');

  await p.evaluate(() => window.toggleStats()); await p.waitForTimeout(900);
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: '/tmp/claude-0/anim1.png' });
  await p.evaluate(() => window.openModal('debtModal')); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/claude-0/anim2.png' });
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

  console.log('== reduced motion: everything is instant ==');
  const r = await open(browser, true); p = r.p;
  await p.evaluate(() => window.openModal('debtModal')); await p.waitForTimeout(100);
  await p.evaluate(() => window.closeModal());
  ok(await p.evaluate(() => document.getElementById('modalContainer').classList.contains('hidden')), 'modal closes immediately');
  await p.evaluate(() => window.deleteItem('e2'));
  ok(await p.evaluate(() => !document.querySelector('#transactionsList [data-id="e2"]')), 'row removed immediately (no collapse delay)');
  ok(r.errs.length === 0, 'no page errors: ' + r.errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
