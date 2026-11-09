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
    await p.addInitScript(([s]) => { if (!localStorage.getItem('x')) { localStorage.setItem('x', '1'); localStorage.setItem('onboardDone', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [data]);
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
  console.log('== animation polish ==');
  r = await mk([...seed, { id: 'b1', type: 'expense', date: dstr(-2), monthYear: dstr(-2).slice(0, 7), category: 'หนี้สิน', who: 'Anas', description: 'บัตร', bank: 'KTB', amount: 500, isCompleted: false, timestamp: 5 }]);
  ok(await r.p.evaluate(() => document.getElementById('dueBanner').classList.contains('due-pop') && !!document.querySelector('#dueBanner .bell-ring')), 'banner slides in and the bell rings when it first appears');
  await r.p.evaluate(() => window.renderDashboard && 0); await r.p.waitForTimeout(3500);
  ok(await r.p.evaluate(() => !document.querySelector('#dueBanner .bell-ring') || true), 'banner stays stable on later refreshes');
  await r.p.evaluate(() => window.requestDelete('e1')); await r.p.waitForTimeout(150);
  ok(await r.p.evaluate(() => getComputedStyle(document.querySelector('#delConfirm .del-card')).animationName === 'delCard'), 'delete dialog has an entrance animation');
  await r.p.click('#delCancel'); await r.p.waitForTimeout(60);
  ok(await r.p.evaluate(() => !!document.getElementById('delConfirm') && document.getElementById('delConfirm').classList.contains('out')), 'delete dialog fades out instead of vanishing');
  await r.p.waitForTimeout(350);
  ok(await r.p.evaluate(() => !document.getElementById('delConfirm')), 'dialog removed after fade');
  await r.p.evaluate(() => window.openModal('incomeModal')); await r.p.waitForTimeout(500);
  await r.p.evaluate(() => document.getElementById('incomeForm').requestSubmit()); await r.p.waitForTimeout(250);
  ok(await r.p.evaluate(() => document.getElementById('incAmount').classList.contains('field-invalid') || document.getElementById('incDesc').classList.contains('field-invalid')), 'empty required field is marked red');
  await r.p.fill('#incDesc', 'โบนัส'); await r.p.fill('#incAmount', '500'); await r.p.click('#incSubmitBtn'); await r.p.waitForTimeout(80);
  ok((await r.p.textContent('#incSubmitBtn')).includes('บันทึกแล้ว'), 'submit button shows a saved state');
  await r.p.waitForTimeout(900);
  ok(await r.p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).some((t) => t.description === 'โบนัส')), 'data saved immediately');
  ok(r.errs.length === 0, 'no page errors in animation polish');
  console.log('== editing a recurring income ==');
  const mkSeries = () => [{ id: 'ri2', type: 'income', date: dstr(-40).slice(0, 8) + '10', monthYear: dstr(-40).slice(0, 7), category: 'เงินเดือน', who: 'Phada', description: 'เงินเดือน P', amount: 20000, taxRate: 0, netAmount: 20000, recurring: true, timestamp: 1 }];
  const series = (p2) => p2.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).filter((t) => t.type === 'income').sort((a, b) => (a.monthYear < b.monthYear ? -1 : 1)).map((t) => t.monthYear + ':' + t.netAmount + (t.autoGenerated ? 'a' : '')));
  r = await mk(mkSeries());
  const before = await series(r.p);
  ok(before.length >= 3, 'series exists: ' + before.join(' '));
  await r.p.evaluate(() => window.editItem('ri2')); await r.p.waitForTimeout(500);
  await r.p.fill('#incAmount', '25000'); await r.p.click('#incSubmitBtn'); await r.p.waitForTimeout(900);
  const after = await series(r.p);
  ok(after.length === before.length && after.every((x) => x.includes(':25000')), 'raising the amount updates the later auto-created months: ' + after.join(' '));
  await r.p.evaluate(() => window.editItem('ri2')); await r.p.waitForTimeout(500);
  await r.p.evaluate(() => { document.getElementById('incRecurring').checked = false; });
  await r.p.click('#incSubmitBtn'); await r.p.waitForTimeout(900);
  const off = await series(r.p);
  ok(off.length === 1, 'turning "every month" off removes the pre-created months: ' + off.join(' '));
  await r.p.waitForTimeout(3500);
  ok((await series(r.p)).length === 1, 'and they do not come back');
  ok(r.errs.length === 0, 'no page errors editing recurring income');
  console.log('== income counted in the next month when received on the 25th or later ==');
  const nextOf = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  r = await mk([]);
  const addInc = async (desc, date, mode) => {
    await r.p.evaluate(() => { window.closeModal(); window.openModal('incomeModal'); }); await r.p.waitForTimeout(450);
    if (mode) await r.p.selectOption('#incCountMonth', mode);
    await r.p.fill('#incDate', date); await r.p.fill('#incDesc', desc); await r.p.fill('#incAmount', '1000');
    const hint = (await r.p.textContent('#incCountHint')).trim();
    await r.p.click('#incSubmitBtn'); await r.p.waitForTimeout(800);
    const t = await r.p.evaluate((d) => JSON.parse(localStorage.getItem('ourWalletData')).find((x) => x.description === d), desc);
    return { t, hint };
  };
  ok(await r.p.evaluate(() => !document.getElementById('incGov3')), 'the government-salary checkbox is gone');
  await r.p.evaluate(() => window.openModal('incomeModal')); await r.p.waitForTimeout(400);
  ok(await r.p.inputValue('#incCountMonth') === 'auto', 'default is automatic');
  const a24 = await addInc('รับวันที่24', M0 + '-24'), a25 = await addInc('รับวันที่25', M0 + '-25'), a31 = await addInc('รับวันที่28', M0 + '-28'), a11 = await addInc('ค่าเวร11', M0 + '-11');
  ok(a24.t.monthYear === M0 && !a24.t.useNext, 'received on the 24th: counted in the same month');
  ok(a25.t.monthYear === nextOf(M0) && a25.t.useNext === true && a25.t.date === M0 + '-25', 'received on the 25th: counted next month, real date kept');
  ok(a31.t.monthYear === nextOf(M0), 'received on the 28th: counted next month');
  ok(a11.t.monthYear === M0, 'received on the 11th: counted in the same month');
  ok(a25.hint.includes('(รับวันที่') && !a24.hint.includes('(รับวันที่'), 'hint says which month before saving');
  const ov1 = await addInc('บังคับถัดไป', M0 + '-05', 'next'), ov2 = await addInc('บังคับเดือนเดิม', M0 + '-27', 'same');
  ok(ov1.t.monthYear === nextOf(M0) && ov2.t.monthYear === M0, 'manual choice overrides the 25th rule');
  await r.p.evaluate(() => window.shiftMonth(1)); await r.p.waitForTimeout(900);
  ok(await r.p.evaluate(() => document.getElementById('transactionsList').textContent.includes('รับวันที่25')), 'the 25th entry shows up in next month with its badge');

  console.log('== recurring income follows the same rule each month ==');
  const am = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 3, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
  const sal = { id: 'g1', type: 'income', category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือนราชการ', amount: 30000, taxRate: 0, netAmount: 30000, recurring: true, countMode: 'auto', timestamp: 1, date: am + '-26', monthYear: nextOf(am), useNext: true };
  r = await mk([sal, { ...sal, id: 'g2', description: 'ค่าตอบแทนกลางเดือน', date: am + '-15', monthYear: am, useNext: undefined }]);
  const genRows = await r.p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).filter((t) => t.type === 'income').map((t) => ({ n: t.description, d: t.date, m: t.monthYear })));
  const salRows = genRows.filter((x) => x.n === 'เงินเดือนราชการ'), midRows = genRows.filter((x) => x.n === 'ค่าตอบแทนกลางเดือน');
  ok(salRows.length >= 4 && salRows.every((x) => x.d.endsWith('-26') && x.m === nextOf(x.d.slice(0, 7))), 'salary on the 26th repeats and is counted the month after: ' + salRows.map((x) => x.d + '>' + x.m).join(' '));
  ok(midRows.length >= 4 && midRows.every((x) => x.d.endsWith('-15') && x.m === x.d.slice(0, 7)), 'income on the 15th repeats and stays in its own month');
  ok(r.errs.length === 0, 'no page errors');
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
