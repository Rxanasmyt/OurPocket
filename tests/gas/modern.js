// ทดสอบเทคนิคแอนิเมชันรุ่นใหม่: View Transitions, ตัวเลขหมุนแบบมิเตอร์, กรอบแสงหมุน, โดนัทแตะได้, เหรียญกระจาย, สะบัดปิดหน้าต่าง
// เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const dstr = (o) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const M0 = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const seed = [
  { id: 'i0', type: 'income', date: M0 + '-01', monthYear: M0, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 9 },
  { id: 'e1', type: 'expense', date: M0 + '-05', monthYear: M0, category: 'อาหาร', who: 'Anas', description: 'ข้าว', bank: 'เงินสด', amount: 3000, isCompleted: true, timestamp: 7 },
  { id: 'e2', type: 'expense', date: M0 + '-06', monthYear: M0, category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 1000, isCompleted: true, timestamp: 6 },
  { id: 'b1', type: 'expense', date: dstr(-3), monthYear: dstr(-3).slice(0, 7), category: 'ที่พัก', who: 'Anas', description: 'ค่าเช่า', bank: 'เงินสด', amount: 500, isCompleted: false, timestamp: 5 },
  { id: 'b2', type: 'expense', date: dstr(6), monthYear: dstr(6).slice(0, 7), category: 'หนี้สิน', who: 'Phada', description: 'ผ่อนมือถือ', bank: 'SCB', amount: 700, isCompleted: false, timestamp: 4 }
];
async function open(browser, reduced) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
  await p.addInitScript(([s]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [seed]);
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
  return { p, errs };
}
(async () => {
  const browser = await chromium.launch();
  let { p, errs } = await open(browser, false);

  console.log('== View Transitions ==');
  ok(await p.evaluate(() => typeof document.startViewTransition === 'function'), 'browser supports View Transitions');
  await p.evaluate(() => { window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; });
  await p.evaluate(() => window.shiftMonth(1));
  ok(await p.evaluate(() => window.__vt === 1 && document.documentElement.dataset.vtDir === 'next'), 'month change runs as a view transition (direction: next)');
  ok(await p.inputValue('#monthSelector') !== M0, 'state updates immediately');
  await p.waitForTimeout(900);
  ok(await p.evaluate(() => !document.documentElement.dataset.vtDir), 'direction flag is cleaned up afterwards');
  await p.evaluate(() => window.shiftMonth(-1)); await p.waitForTimeout(900);
  ok(await p.evaluate(() => document.querySelector('#transactionsList .swipe-row') !== null), 'list content is back after returning to this month');
  await p.evaluate(() => window.setView('income')); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.documentElement.dataset.vtDir === 'fade'), 'filter change cross-fades');
  await p.waitForTimeout(800);
  ok(await p.$$eval('#transactionsList .swipe-row', (e) => e.length) === 1, 'filter applied: income only');
  await p.evaluate(() => { window.setView('all'); window.shiftMonth(1); window.shiftMonth(-1); window.setView('expense'); window.setView('all'); }); await p.waitForTimeout(1200);
  const expectRows = seed.filter((x) => x.monthYear === M0).length;
  ok(await p.evaluate((n) => document.querySelectorAll('#transactionsList .swipe-row').length === n && !document.documentElement.dataset.vtDir, expectRows), `rapid back-to-back changes settle on the right state (${expectRows} rows) without leftovers`);

  console.log('== odometer digits ==');
  await p.evaluate(() => { window.openModal('incomeModal'); document.getElementById('incDesc').value = 'โบนัส'; document.getElementById('incAmount').value = '12345'; document.getElementById('incomeForm').requestSubmit(); });
  await p.waitForTimeout(250);
  ok(await p.$$eval('#totalIncome .dg', (e) => e.length) >= 3, 'changed digits are wrapped to roll: ' + await p.$$eval('#totalIncome .dg', (e) => e.length));
  ok(await p.$$eval('#totalIncome .dg', (e) => e.every((x) => x.dataset.prev !== undefined)), 'each rolling digit remembers the digit it replaces');
  ok((await p.textContent('#totalIncome')) === '฿42,345.00', 'real text stays intact and selectable: ' + await p.textContent('#totalIncome'));
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#totalIncome .dg > i')).animationName === 'dgIn'), 'new digit slides in');
  await p.waitForTimeout(1400);

  console.log('== glow ring, overdue pulse, donut ==');
  const ang = async () => p.evaluate(() => getComputedStyle(document.querySelector('.glow-ring')).getPropertyValue('--ang'));
  const a1 = await ang(); await p.waitForTimeout(800); const a2 = await ang();
  ok(a1 !== a2 && /deg/.test(a1), 'hero border light keeps rotating: ' + a1 + ' → ' + a2);
  ok(await p.evaluate(() => { const c = document.querySelector('[data-pay-id="b1"]'); return c && c.classList.contains('overdue-pulse'); }), 'overdue bill pulses softly');
  ok(await p.evaluate(() => { const c = document.querySelector('[data-pay-id="b2"]'); return c && !c.classList.contains('overdue-pulse'); }), 'upcoming bill does not');
  await p.evaluate(() => window.toggleStats()); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#catDonut circle.donut-seg').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await p.waitForTimeout(250);
  const center = (await p.textContent('#donutTop')) + ' | ' + (await p.textContent('#donutVal'));
  ok(center.includes('อาหาร') && center.includes('%'), 'tapping a donut slice shows its name and share in the middle: ' + center);
  ok(await p.evaluate(() => document.querySelector('#catDonut .donut-sel') !== null && document.getElementById('catDonut').classList.contains('donut-dim')), 'selected slice grows, others dim');
  await p.evaluate(() => document.querySelector('#catDonut .donut-sel').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await p.waitForTimeout(150);
  ok((await p.textContent('#donutTop')) === 'รวม' && await p.evaluate(() => !document.getElementById('catDonut').classList.contains('donut-dim')), 'tap again returns to the total');

  console.log('== coin burst + flick-to-dismiss ==');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => document.getElementById('remindersSection').scrollIntoView({ block: 'center' })); await p.waitForTimeout(600);
  await p.evaluate(() => window.payBill('b2'));
  ok(await p.$$eval('.mini-piece', (e) => e.length) === 12, 'paying a bill sprays 12 coins from the button');
  await p.waitForTimeout(1300);
  ok(await p.evaluate(() => !document.querySelector('.mini-piece')), 'and cleans them up');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => window.openModal('debtModal')); await p.waitForTimeout(700);
  const touch = (type, y) => p.evaluate(([t, yy]) => { const el = document.querySelector('#debtModal > div:first-child'); const tc = new Touch({ identifier: 1, target: el, clientX: 100, clientY: yy }); el.dispatchEvent(new TouchEvent(t, { touches: t === 'touchend' ? [] : [tc], changedTouches: [tc], bubbles: true, cancelable: true })); }, [type, y]);
  await touch('touchstart', 300);
  for (const y of [320, 345, 372]) { await touch('touchmove', y); await p.waitForTimeout(18); }   // 72px แต่เร็วมาก
  await touch('touchend', 372); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.getElementById('modalContainer').classList.contains('hidden')), 'a quick flick down closes the sheet even though it moved only ~70px');
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

  console.log('== reduced motion: plain and instant ==');
  const r = await open(browser, true); p = r.p;
  await p.evaluate(() => { window.openModal('incomeModal'); document.getElementById('incDesc').value = 'x'; document.getElementById('incAmount').value = '100'; document.getElementById('incomeForm').requestSubmit(); });
  await p.waitForTimeout(300);
  ok(await p.$$eval('#totalIncome .dg', (e) => e.length) === 0, 'numbers change without rolling digits');
  await p.evaluate(() => { window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; window.shiftMonth(1); });
  ok(await p.evaluate(() => window.__vt === 0), 'no view transition');
  ok(r.errs.length === 0, 'no page errors');

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
