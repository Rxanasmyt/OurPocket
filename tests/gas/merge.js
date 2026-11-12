// ทดสอบการรวมข้อมูลจาก 2 เครื่องที่แก้ชนกันตอนออฟไลน์: เวอร์ชันที่แก้ล่าสุดชนะ, รายการที่ลบแล้วไม่กลับมา, ทั้งสองเครื่องจบด้วยข้อมูลเดียวกัน
// เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const http = require('http');
const { chromium } = require('playwright');
const { makeEnv } = require('./mock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
(async () => {
  const env = makeEnv({ sheets: ['Sheet1'], code: process.env.GS_CODE });
  const srv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
    if (req.method === 'GET') { res.writeHead(200, cors); return res.end(env.get({})); }
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => { res.writeHead(200, cors); res.end(env.ctx.doPost({ postData: { contents: body } }).text); });
  });
  await new Promise((r) => srv.listen(8942, r));
  const URL_ = 'http://localhost:8942/exec';
  const b = await chromium.launch();
  const errs = [];
  const mkPhone = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`)); p.on('dialog', (d) => d.dismiss());
    await p.addInitScript(([u]) => { localStorage.setItem('onboardDone', '1'); localStorage.setItem('sheetsWebhookUrl', u); localStorage.setItem('sheetsSeeded_' + u, '1'); }, [URL_]);
    await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
    return { name, ctx, p };
  };
  const A = await mkPhone('A'), B = await mkPhone('B');
  await A.p.waitForTimeout(2000);
  const recs = (ph) => ph.p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]'));
  const queue = (ph) => ph.p.evaluate(() => JSON.parse(localStorage.getItem('walletQueue') || '[]').length);
  const addExpense = async (ph, desc, amount) => {
    await ph.p.evaluate(([d, a]) => { window.openModal('expenseModal'); const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; set('expDesc', d); set('expAmount', a); document.getElementById('expenseForm').requestSubmit(); }, [desc, amount]);
  };
  const editAmount = async (ph, id, amount) => {
    await ph.p.evaluate(([i, a]) => { window.editItem(i); const e = document.getElementById('expAmount'); e.value = a; e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('expenseForm').requestSubmit(); }, [id, amount]);
  };
  const settle = async (label) => {
    for (let i = 0; i < 25; i++) {
      await A.p.waitForTimeout(1000);
      const [qa, qb] = [await queue(A), await queue(B)];
      const a = await recs(A), c = await recs(B), sh = env.post({ action: 'sync' }).data;
      const sig = (x) => JSON.stringify([...x].sort((m, n) => (m.id < n.id ? -1 : 1)).map((t) => [t.id, t.amount]));
      if (qa === 0 && qb === 0 && sig(a) === sig(c) && sig(c) === sig(sh)) return { a, c, sh, ok: true };
    }
    return { a: await recs(A), c: await recs(B), sh: env.post({ action: 'sync' }).data, ok: false };
  };
  const amountOf = (arr, d) => { const t = arr.find((x) => x.description === d); return t ? t.amount : null; };

  console.log('== newest edit wins ==');
  await addExpense(A, 'รายการทดสอบ1', 100);
  let st = await settle('created');
  ok(st.ok && st.c.length === 1, 'both phones have the new record');
  const id1 = st.c[0].id;
  await B.ctx.setOffline(true);
  await editAmount(B, id1, 200); await B.p.waitForTimeout(500);   // เครื่อง B แก้ตอนออฟไลน์ (เก่ากว่า)
  await editAmount(A, id1, 300); await A.p.waitForTimeout(1500);   // เครื่อง A แก้ทีหลัง (ใหม่กว่า)
  await B.ctx.setOffline(false);
  st = await settle('conflict');
  ok(st.ok, 'phones and sheet converge');
  ok(amountOf(st.c, 'รายการทดสอบ1') === 300 && amountOf(st.a, 'รายการทดสอบ1') === 300 && amountOf(st.sh, 'รายการทดสอบ1') === 300, 'the later edit (300) won everywhere, the offline older edit (200) did not overwrite it');

  console.log('== edit after an offline delete survives ==');
  await B.ctx.setOffline(true);
  await B.p.evaluate((i) => window.deleteItem(i), id1); await B.p.waitForTimeout(500);   // B ลบตอนออฟไลน์
  await editAmount(A, id1, 400); await A.p.waitForTimeout(800);                            // A แก้หลังจากนั้น
  await B.ctx.setOffline(false);
  st = await settle('delete-vs-edit');
  ok(st.ok && amountOf(st.a, 'รายการทดสอบ1') === 400 && amountOf(st.c, 'รายการทดสอบ1') === 400, 'record kept with the newer edit (400) on both phones');

  console.log('== deleted record does not come back ==');
  await B.ctx.setOffline(true);
  await editAmount(B, id1, 500); await B.p.waitForTimeout(500);                            // B แก้ตอนออฟไลน์ (เก่ากว่า)
  await A.p.evaluate((i) => window.deleteItem(i), id1); await A.p.waitForTimeout(1200);     // A ลบทีหลัง
  await B.ctx.setOffline(false);
  st = await settle('edit-vs-delete');
  ok(st.ok && st.a.length === 0 && st.c.length === 0 && st.sh.length === 0, 'the delete (newer) wins; nothing is resurrected on any device');

  console.log('== undo of a delete still works ==');
  await addExpense(A, 'รายการทดสอบ2', 50);
  st = await settle('created2');
  const id2 = st.a.find((t) => t.description === 'รายการทดสอบ2').id;
  await A.p.evaluate((i) => window.deleteItem(i), id2); await A.p.waitForTimeout(1000);
  await A.p.evaluate(() => { const b = document.querySelector('.toast-action'); if (b) b.click(); });
  st = await settle('undo');
  ok(st.ok && st.c.some((t) => t.id === id2) && st.sh.some((t) => t.id === id2), 'undo restores the record on both phones and the sheet');
  ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 2).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
