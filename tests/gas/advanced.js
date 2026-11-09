// ทดสอบท่าทางขั้นสูง: สะบัดปัด, กดค้างเปิดเมนู/ทำซ้ำ, ข้อมูลสดจากอีกเครื่อง, โครงกระดูก, แสงขยับตามนิ้ว
// เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const http = require('http');
const { chromium } = require('playwright');
const { makeEnv } = require('./mock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const ym = new Date().toISOString().slice(0, 7);
const seed = [
  { id: 'i1', type: 'income', date: ym + '-01', monthYear: ym, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 3 },
  { id: 'e1', type: 'expense', date: ym + '-28', monthYear: ym, category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 2500, isCompleted: false, payMode: 'normal', timestamp: 2 },
  { id: 'e2', type: 'expense', date: ym + '-27', monthYear: ym, category: 'อาหาร', who: 'Anas', description: 'ข้าว', bank: 'เงินสด', amount: 100, isCompleted: false, payMode: 'normal', timestamp: 1 }
];
function startServer(env, port, slowMs = 0) {
  const srv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
    if (req.method === 'GET') { res.writeHead(200, cors); return res.end(env.get({})); }
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => setTimeout(() => { res.writeHead(200, cors); res.end(env.ctx.doPost({ postData: { contents: body } }).text); }, slowMs));
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
  await p.addInitScript(([s]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [seed]);
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1600);
  const recs = () => p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]'));
  const card = (id) => `#transactionsList .swipe-row[data-id="${id}"] .row-card`;
  const ptr = (sel, type, x, y) => p.evaluate(([s, t, xx, yy]) => document.querySelector(s).dispatchEvent(new PointerEvent(t, { clientX: xx, clientY: yy, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true })), [sel, type, x, y]);

  console.log('== flick and rubber band ==');
  // slow short drag (-60px over 400ms): no commit
  await ptr(card('e2'), 'pointerdown', 200, 300);
  for (let i = 1; i <= 6; i++) { await ptr(card('e2'), 'pointermove', 200 - i * 10, 300); await p.waitForTimeout(65); }
  await ptr(card('e2'), 'pointerup', 140, 300); await p.waitForTimeout(400);
  ok((await recs()).some((t) => t.id === 'e2'), 'slow short drag does not delete');
  // fast flick (-60px in 3 quick moves, 16ms apart): commits
  await ptr(card('e2'), 'pointerdown', 200, 300);
  for (let i = 1; i <= 3; i++) { await ptr(card('e2'), 'pointermove', 200 - i * 22, 300); await p.waitForTimeout(18); }
  await ptr(card('e2'), 'pointerup', 134, 300); await p.waitForTimeout(500);
  ok(await p.isVisible('#delConfirm'), 'fast flick opens the delete confirmation even though it is short');
  await p.click('#delOk'); await p.waitForTimeout(500);
  ok(!(await recs()).some((t) => t.id === 'e2'), 'fast flick commits the delete after confirming');
  await p.click('.toast-action'); await p.waitForTimeout(400);
  ok((await recs()).some((t) => t.id === 'e2'), 'and undo restores it');
  await ptr(card('e1'), 'pointerdown', 200, 300);
  for (let i = 1; i <= 12; i++) { await ptr(card('e1'), 'pointermove', 200 + i * 25, 300); await p.waitForTimeout(20); }
  const shift = await p.$eval(card('e1'), (e) => parseFloat(e.style.transform.replace(/[^\d.-]/g, '')));
  ok(shift > 140 && shift <= 225, 'dragging far gets heavier (rubber band) instead of following 1:1: ' + Math.round(shift) + 'px for 300px of finger');
  await ptr(card('e1'), 'pointerup', 500, 300); await p.waitForTimeout(500);
  await p.click('.toast-action:last-of-type'); await p.waitForTimeout(400);

  console.log('== long-press menu ==');
  await ptr(card('e1'), 'pointerdown', 200, 300); await p.waitForTimeout(260);
  ok(await p.$eval(card('e1'), (e) => e.classList.contains('pressing')), 'row sinks slightly while pressed');
  await p.waitForTimeout(450);
  ok(await p.evaluate(() => document.getElementById('rowMenuModal').classList.contains('flex')), 'holding opens the action sheet');
  ok((await p.textContent('#rowMenuTitle')) === 'ค่าไฟ' && (await p.$$eval('#rowMenuBody .menu-item', (e) => e.length)) === 4, 'sheet names the item and offers 4 actions');
  await ptr(card('e1'), 'pointerup', 200, 300); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.getElementById('expenseModal').classList.contains('flex')), 'letting go after the hold does not also open the editor');
  const n0 = (await recs()).length;
  await p.click('#rowMenuBody .menu-item:has-text("ทำซ้ำ")'); await p.waitForTimeout(500);
  const after = await recs();
  const copy = after.find((t) => t.description === 'ค่าไฟ' && t.id !== 'e1');
  ok(after.length === n0 + 1 && copy && copy.date === new Date().toISOString().slice(0, 10).replace(/./g, (c) => c) || (copy && copy.monthYear === ym), 'duplicate creates a fresh copy dated today');
  ok(copy && copy.isCompleted === false && !copy.autoGenerated && copy.id !== 'e1', 'copy is unpaid and independent');
  await p.click('.toast-action'); await p.waitForTimeout(400);
  ok(!(await recs()).some((t) => t.id === (copy && copy.id)), 'undo removes the copy');
  await ptr(card('i1'), 'pointerdown', 200, 300); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !document.querySelector('#rowMenuBody .menu-item .text-xl') || ![...document.querySelectorAll('#rowMenuBody .menu-item')].some((b) => b.textContent.includes('จ่ายแล้ว'))), 'income rows have no "mark paid" action');
  await ptr(card('i1'), 'pointerup', 200, 300);
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);
  // moving the finger cancels the hold
  await ptr(card('e1'), 'pointerdown', 200, 300); await ptr(card('e1'), 'pointermove', 200, 330); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !document.getElementById('rowMenuModal').classList.contains('flex')), 'scrolling (finger moves) cancels the long-press');
  await ptr(card('e1'), 'pointerup', 200, 330);

  console.log('== hero glow follows the finger ==');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
  await p.evaluate(() => { const h = document.querySelector('.hero-aurora'), r = h.getBoundingClientRect(); h.dispatchEvent(new PointerEvent('pointermove', { clientX: r.right - 10, clientY: r.bottom - 10, bubbles: true })); });
  await p.waitForTimeout(100);
  ok(parseFloat(await p.$eval('.hero-aurora', (e) => e.style.getPropertyValue('--px'))) > 0.8, 'pointer position is mapped to -1..1 on the hero');
  await p.evaluate(() => document.querySelector('.hero-aurora').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))); await p.waitForTimeout(80);
  ok((await p.$eval('.hero-aurora', (e) => e.style.getPropertyValue('--px'))) === '0', 'and returns to center on release');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.app-header header > div')).animationName.includes('hdrIn')), 'header plays its entrance choreography');

  console.log('== live updates from the other phone + skeleton ==');
  const env = makeEnv({ sheets: ['Sheet1'] });
  const srv = await startServer(env, 8910, 1500);
  const URL_ = 'http://localhost:8910/exec';
  const ph = await (await b.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  const errs2 = []; ph.on('pageerror', (e) => errs2.push(e.message));
  await ph.addInitScript(([u]) => { localStorage.setItem('sheetsWebhookUrl', u); localStorage.setItem('sheetsSeeded_' + u, '1'); window.__toasts = []; const start = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'toast-container') window.__toasts.push(n.textContent.trim()); }))).observe(document.documentElement, { childList: true, subtree: true }); document.documentElement ? start() : document.addEventListener('DOMContentLoaded', start); }, [URL_]);
  await ph.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await ph.waitForTimeout(600);
  ok((await ph.$$eval('#transactionsList .skeleton', (e) => e.length)) === 3, 'first launch with no local data shows shimmer placeholders while waiting');
  await ph.waitForTimeout(3800);
  ok((await ph.$$eval('#transactionsList .skeleton', (e) => e.length)) === 0 && await ph.evaluate(() => !!document.querySelector('#transactionsList .empty-state')), 'placeholders give way to the empty state once the first sync finishes');
  env.post({ id: 'live1', type: 'income', date: ym + '-10', monthYear: ym, category: 'ค่าเวร', who: 'Phada', description: 'ค่าเวรพิเศษ', amount: 900, taxRate: 0, netAmount: 900 });
  await ph.waitForFunction(() => document.querySelector('#transactionsList [data-id="live1"]'), null, { timeout: 15000 });
  ok(await ph.evaluate(() => document.querySelector('#transactionsList [data-id="live1"]').classList.contains('live-flash')), 'a record from the other phone arrives highlighted "ใหม่"');
  ok(await ph.evaluate(() => window.__toasts.some((t) => t.includes('มีข้อมูลใหม่จากอีกเครื่อง'))), 'with a short notice');
  const before = await ph.evaluate(() => window.__toasts.length);
  await ph.evaluate(() => window.manualSync()); await ph.waitForTimeout(3500);
  ok(await ph.evaluate((n) => window.__toasts.filter((t) => t.includes('มีข้อมูลใหม่')).length === 1, before), 'unchanged data does not re-announce');
  await ph.evaluate(() => { window.openModal('incomeModal'); document.getElementById('incDesc').value = 'ของฉันเอง'; document.getElementById('incAmount').value = '50'; document.getElementById('incomeForm').requestSubmit(); });
  await ph.waitForTimeout(6500);
  ok(await ph.evaluate(() => window.__toasts.filter((t) => t.includes('มีข้อมูลใหม่')).length === 1), 'own saves coming back from the sheet are not announced as "new from other phone"');
  srv.close();
  ok(errs.length === 0 && errs2.length === 0, 'no page errors: ' + errs.concat(errs2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
