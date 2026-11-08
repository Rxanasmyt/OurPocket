// ทดสอบระบบแอนิเมชันระดับแอปทางการ — เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const ym = new Date().toISOString().slice(0, 7);
const seed = [
  { id: 'i1', type: 'income', date: ym + '-01', monthYear: ym, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 1 },
  { id: 'e1', type: 'expense', date: ym + '-28', monthYear: ym, category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 2500, isCompleted: false, timestamp: 2 }
];
async function open(browser, { reduced = false, height = 600, data = seed } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height }, hasTouch: true, isMobile: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
  await p.addInitScript(([s]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [data]);
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1600);
  return { p, errs };
}
(async () => {
  const browser = await chromium.launch();
  let { p, errs } = await open(browser);

  console.log('== reveal on scroll ==');
  ok(await p.evaluate(() => document.documentElement.classList.contains('js')), 'html gets the "js" class early');
  ok(await p.evaluate(() => document.querySelector('.hero-aurora').classList.contains('in-view')), 'top card is revealed on load');
  const listBox = '#transactionsList';
  const inView = (sel) => p.evaluate((s) => document.querySelector(s).closest('.reveal').classList.contains('in-view'), sel);
  ok(!(await inView(listBox)), 'list section below the fold waits');
  await p.evaluate(() => document.getElementById('transactionsList').scrollIntoView({ block: 'center' })); await p.waitForTimeout(900);
  ok(await inView(listBox), 'and appears once scrolled into view');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.hero-aurora')).opacity) === '1', 'revealed card is fully opaque');

  console.log('== focus, validation, keyboard ==');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(700);
  await p.focus('#expDesc'); await p.waitForTimeout(350);
  ok((await p.evaluate(() => getComputedStyle(document.getElementById('expDesc')).boxShadow)).includes('255, 77, 109'), 'focused input gets a soft pink glow');
  await p.evaluate(() => { window.closeModal(); }); await p.waitForTimeout(350);
  await p.evaluate(() => window.openModal('incomeModal')); await p.waitForTimeout(700);
  await p.focus('#incDesc'); await p.waitForTimeout(350);
  ok((await p.evaluate(() => getComputedStyle(document.getElementById('incDesc')).boxShadow)).includes('16, 185, 129'), 'income form glows green');
  await p.evaluate(() => document.getElementById('incomeForm').requestSubmit()); await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.getElementById('incDesc').classList.contains('invalid-flash') || document.getElementById('incAmount').classList.contains('invalid-flash')), 'empty required field flashes red + shakes');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(600);
  await p.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }; set('expDesc', 'ผ่อน'); set('expPayMode', 'installment'); set('expInstallAmount', 100); set('expCurInstall', 9); set('expTotalInstall', 3); set('expAmount', 100); document.getElementById('expenseForm').requestSubmit(); });
  await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.getElementById('expSubmitBtn').classList.contains('shake')), 'rule violation shakes the save button');
  ok(await p.evaluate(() => [...document.querySelectorAll('#toast-container > div')].some((d) => d.textContent.includes('งวดที่ต้องไม่เกิน'))), 'and tells why');
  ok(await p.evaluate(() => !!document.querySelector('.toast-progress') && parseFloat(getComputedStyle(document.querySelector('.toast-progress')).animationDuration) > 2), 'toast shows a countdown bar');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);

  console.log('== modal content stagger ==');
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(80);
  const delays = await p.evaluate(() => [...document.querySelectorAll('#expenseForm > *')].slice(0, 6).map((e) => getComputedStyle(e).animationDelay));
  ok(delays[0] === '0s' && parseFloat(delays[4]) > parseFloat(delays[1]), 'form rows enter one after another: ' + delays.join(' '));
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);

  console.log('== success tick ==');
  await p.evaluate(() => { window.openModal('incomeModal'); document.getElementById('incDesc').value = 'โบนัส'; document.getElementById('incAmount').value = '500'; document.getElementById('incomeForm').requestSubmit(); });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!document.querySelector('.tick-overlay .tick-badge path')), 'saving a form shows an animated check mark');
  await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !document.querySelector('.tick-overlay')), 'it removes itself');
  await p.evaluate(() => window.toggleStatus('e1')); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.querySelector('.tick-overlay')), 'quick actions (mark paid) do not show it');

  console.log('== empty state + keyboard focus ring ==');
  await p.evaluate(() => window.shiftMonth(-5)); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const e = document.querySelector('#transactionsList .empty-state'); return !!e && e.textContent.includes('ยังไม่มีรายการเดือนนี้') && e.textContent.includes('รับเงิน'); }), 'empty month shows a friendly illustrated state');
  await p.fill('#searchInput', 'zzzz'); await p.waitForTimeout(250);
  ok(await p.evaluate(() => document.querySelector('#transactionsList .empty-state').textContent.includes('ไม่พบรายการที่ค้นหา')), 'search with no result says so');
  await p.fill('#searchInput', '');
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  await p.keyboard.press('Tab'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => { const a = document.activeElement; return a && a.tagName !== 'BODY' && getComputedStyle(a).outlineStyle !== 'none'; }), 'keyboard focus shows a visible ring');
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

  console.log('== reduced motion ==');
  const r = await open(browser, { reduced: true, height: 600 }); p = r.p;
  ok(await p.evaluate(() => [...document.querySelectorAll('.reveal')].every((e) => e.classList.contains('in-view'))), 'everything is visible immediately');
  await p.evaluate(() => { window.openModal('incomeModal'); document.getElementById('incDesc').value = 'x'; document.getElementById('incAmount').value = '5'; document.getElementById('incomeForm').requestSubmit(); });
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => !document.querySelector('.tick-overlay')), 'no check-mark animation');
  ok(r.errs.length === 0, 'no page errors');

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
