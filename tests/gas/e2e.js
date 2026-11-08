// ทดสอบแอปจริง (index.html ที่เปิดที่ http://localhost:8080) กับ Code.gs จริงที่รันในตัวจำลอง Apps Script
// เปิดเซิร์ฟเวอร์ก่อน:  python3 -m http.server 8080   แล้วรัน:  node tests/gas/e2e.js
const http = require('http');
const { chromium } = require('playwright');
const { makeEnv } = require('./mock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const APP = 'http://localhost:8080/index.html';

// intercept(kind, bodyObj) -> string | undefined  (ใช้จำลองสคริปต์เก่า / ผิดพลาด / ตอบเป็น HTML)
function startServer(env, { port, intercept }) {
  const stats = { posts: 0, gets: 0, unchanged: 0, fullSyncs: 0, batches: 0 };
  const srv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET') {
      stats.gets++;
      const o = intercept && intercept('get', null);
      res.writeHead(200, cors); return res.end(o !== undefined ? o : env.get(Object.fromEntries(url.searchParams)));
    }
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      stats.posts++;
      let obj = {}; try { obj = JSON.parse(body); } catch (e) {}
      const o = intercept && intercept('post', obj);
      let out = o !== undefined ? o : env.ctx.doPost({ postData: { contents: body } }).text;
      if (o === undefined) {
        if (obj.action === 'sync') { if (JSON.parse(out).unchanged) stats.unchanged++; else stats.fullSyncs++; }
        if (obj.action === 'batch') stats.batches++;
      }
      res.writeHead(200, cors); res.end(out);
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, stats })));
}

const newPhone = async (browser, { url, key, extra } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // เก็บข้อความ toast ทั้งหมดที่เคยแสดง (toast หายเร็ว จึงอ่านตรงๆ ไม่ทัน)
  await page.addInitScript(() => {
    window.__toasts = [];
    const start = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'toast-container') window.__toasts.push(n.textContent.trim()); }))).observe(document.documentElement, { childList: true, subtree: true });
    document.documentElement ? start() : document.addEventListener('DOMContentLoaded', start);
  });
  if (url) await page.addInitScript(([u, k, ex]) => { localStorage.setItem('sheetsWebhookUrl', u); if (k) localStorage.setItem('sheetsKey', k); if (ex) ex(); }, [url, key, null]);
  return { ctx, page, errs };
};
const pillOf = (p) => p.textContent('#syncStatus').then((t) => t.trim());
const records = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]'));
const addIncome = async (p, desc, amount) => {
  await p.evaluate(() => window.openModal('incomeModal'));
  await p.fill('#incDesc', desc); await p.fill('#incAmount', String(amount));
  await p.evaluate(() => document.getElementById('incomeForm').requestSubmit());
};
const modalText = async (p) => { await p.evaluate(() => window.openSyncStatus()); return (await p.textContent('#syncModalBody')).replace(/\s+/g, ' '); };

(async () => {
  const browser = await chromium.launch();

  console.log('== A) app <-> real Code.gs, key protected, two phones ==');
  const env = makeEnv({ sheets: ['Sheet1'], props: { WALLET_KEY: 'pw123' } });
  const { srv, stats } = await startServer(env, { port: 8791 });
  const URL_ = 'http://localhost:8791/exec';
  const ph1 = await newPhone(browser); const p = ph1.page;
  await p.goto(APP, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.evaluate(() => window.openModal('sheetsModal'));
  await p.fill('#sheetsUrlInput', URL_); await p.fill('#sheetsKeyInput', 'wrong');
  await p.evaluate(() => window.testConnection()); await p.waitForTimeout(900);
  const t1 = await p.textContent('#connResult');
  ok(t1.includes('รหัสผ่านซิงค์ไม่ตรง') && t1.includes('วิธีแก้'), 'wrong password: explained with fix steps');
  await p.fill('#sheetsKeyInput', 'pw123');
  await p.evaluate(() => window.testConnection()); await p.waitForTimeout(1500);
  const t2 = await p.textContent('#connResult');
  ok(t2.includes('✅') && t2.includes('ตั้งแล้ว'), 'right password: connection OK');
  ok((env.ss.getSheetByName('รายการ').getLastRow() || 0) <= 1, 'selftest left no rows behind');
  await p.evaluate(() => window.saveSheetsUrl()); await p.waitForTimeout(2500);
  ok((await pillOf(p)).includes('ซิงค์แล้ว'), 'status pill: ' + await pillOf(p));

  await addIncome(p, 'เงินเดือน', 30000); await p.waitForTimeout(1500);
  await p.evaluate(() => window.openModal('expenseModal'));
  await p.fill('#expDesc', 'ผ่อนมือถือ iPhone'); await p.selectOption('#expPayMode', 'installment');
  await p.fill('#expInstallAmount', '1500'); await p.fill('#expCurInstall', '2'); await p.fill('#expTotalInstall', '5');
  await p.selectOption('#expBank', 'SCB'); await p.selectOption('#expWho', 'Phada');
  ok(await p.inputValue('#expCategory') === 'หนี้สิน', 'category auto-picked from description');
  await p.evaluate(() => document.getElementById('expenseForm').requestSubmit()); await p.waitForTimeout(3500);
  const ds = env.ss.getSheetByName('รายการ');
  ok(ds.getLastRow() === 4, 'sheet: income + installment 2/5 + auto 3/5 (+header): lastRow=' + ds.getLastRow());
  ok(stats.batches >= 1, 'writes were sent as batches: ' + stats.batches);
  let leak = false; for (const v of ds.cells.values()) if (String(v).includes('pw123')) leak = true; ok(!leak, 'password never written to sheet');

  const ph2 = await newPhone(browser, { url: URL_, key: 'pw123' }); const p2 = ph2.page;
  await p2.goto(APP, { waitUntil: 'load' }); await p2.waitForTimeout(3500);
  ok((await records(p2)).length === 3, 'phone 2 sees all 3 records');
  const before = stats.unchanged;
  await p2.waitForTimeout(7000);
  ok(stats.unchanged - before >= 2, 'idle polls are cheap "unchanged" replies: +' + (stats.unchanged - before));
  const t0 = Date.now();
  await addIncome(p, 'ค่าเวร', 5000);
  await p2.waitForFunction(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]').some((t) => t.description === 'ค่าเวร'), null, { timeout: 15000 });
  const lat = Date.now() - t0;
  ok(lat < 8000, 'phone 1 -> phone 2 realtime latency ' + (lat / 1000).toFixed(1) + 's');
  const idDel = (await records(p)).find((t) => t.description === 'ค่าเวร').id;
  p.once('dialog', (d) => d.accept());
  await p.evaluate((id) => window.deleteItem(id), idDel);
  await p2.waitForFunction(() => !JSON.parse(localStorage.getItem('ourWalletData') || '[]').some((t) => t.description === 'ค่าเวร'), null, { timeout: 15000 });
  ok(true, 'deletion on phone 1 reaches phone 2');
  const okModal = await modalText(p);
  ok(okModal.includes('ทุกอย่างปกติ'), 'sync status page says all OK');
  console.log('   page errors:', ph1.errs.concat(ph2.errs));
  srv.close();

  console.log('== B) old (not redeployed) script: app must not send anything ==');
  const envOld = makeEnv({ sheets: ['Sheet1'] });
  const sOld = await startServer(envOld, { port: 8792, intercept: (k) => (k === 'get' ? '✅ Our Wallet: Web App is running successfully!' : undefined) });
  const ph3 = await newPhone(browser, { url: 'http://localhost:8792/exec', key: 'x' }); const p3 = ph3.page;
  await p3.addInitScript(() => localStorage.setItem('sheetsSeeded_http://localhost:8792/exec', '1'));
  await p3.goto(APP, { waitUntil: 'load' }); await p3.waitForTimeout(1500);
  await addIncome(p3, 'x', 100); await p3.waitForTimeout(2500);
  ok((await pillOf(p3)).includes('สคริปต์เก่า'), 'pill: ' + await pillOf(p3));
  ok(sOld.stats.posts === 0, 'no POST sent to old script: ' + sOld.stats.posts);
  ok((await p3.evaluate(() => JSON.parse(localStorage.getItem('walletQueue')).length)) === 1, 'data waits in queue');
  ok((await modalText(p3)).includes('Deploy'), 'status page explains how to fix');
  sOld.srv.close();

  console.log('== C) every failure shows its own cause ==');
  const cases = [
    { name: 'server down (wrong URL / no access)', port: null, expectPill: 'ติดต่อ Google ไม่ได้', expectModal: 'Anyone' },
    { name: 'Google returns a web page', intercept: (k) => '<html><body><h1>Sorry, unable to open the file</h1></body></html>', expectPill: 'Google ตอบผิดปกติ', expectModal: 'Sorry, unable to open the file' },
    { name: 'wrong password', props: { WALLET_KEY: 'right' }, expectPill: 'รหัสไม่ถูกต้อง', expectModal: 'WALLET_KEY' },
    { name: 'sheet error with message', intercept: (k, b) => (b && b.action === 'batch' ? JSON.stringify({ status: 'error', code: 'exception', message: 'Exception: Service Spreadsheets failed while accessing document' }) : undefined), expectPill: 'ชีตแจ้งข้อผิดพลาด', expectModal: 'Service Spreadsheets failed' },
    { name: 'quota exceeded', intercept: (k, b) => (b && b.action === 'batch' ? JSON.stringify({ status: 'error', code: 'exception', message: 'Exception: Service invoked too many times for one day: urlfetch.' }) : undefined), expectPill: 'โควตา Google เต็ม', expectModal: '5–10 นาที' },
    { name: 'sheet busy (lock)', intercept: (k, b) => (b && b.action === 'batch' ? JSON.stringify({ status: 'error', code: 'lock_timeout', message: 'busy' }) : undefined), expectPill: 'ชีตไม่ว่าง', expectModal: 'รอสักครู่' },
    { name: 'script not bound to a spreadsheet', intercept: (k, b) => (b && b.action === 'sync' ? JSON.stringify({ status: 'error', code: 'no_spreadsheet', message: 'x' }) : undefined), expectPill: 'สคริปต์ไม่ได้ผูกกับชีต', expectModal: 'Extensions' }
  ];
  let port = 8800;
  for (const c of cases) {
    const e = makeEnv({ sheets: ['Sheet1'], props: c.props || {} });
    let s = null; const myPort = c.port === null ? 8899 : port++;
    if (c.port !== null) s = await startServer(e, { port: myPort, intercept: c.intercept });
    const u = `http://localhost:${myPort}/exec`;
    const ph = await newPhone(browser, { url: u, key: 'bad' }); const pg = ph.page;
    await pg.addInitScript(([uu]) => localStorage.setItem('sheetsSeeded_' + uu, '1'), [u]);
    await pg.goto(APP, { waitUntil: 'load' }); await pg.waitForTimeout(1500);
    await addIncome(pg, 'ทดสอบ', 100); await pg.waitForTimeout(2800);
    const pill = await pillOf(pg); const modal = await modalText(pg);
    const toast = await pg.evaluate(() => window.__toasts.join(' | '));
    ok(pill.includes(c.expectPill), `[${c.name}] pill "${pill}"`);
    ok(modal.includes(c.expectModal) && modal.includes('วิธีแก้'), `[${c.name}] status page names the cause + fix`);
    ok(toast.includes('ซิงค์กับ Google Sheet ไม่ได้'), `[${c.name}] user told immediately (toast)`);
    ok((await pg.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).length)) === 1, `[${c.name}] data still safe on the phone`);
    if (s) s.srv.close();
    await ph.ctx.close();
  }
  // offline
  {
    const e = makeEnv({ sheets: ['Sheet1'] }); const s = await startServer(e, { port: 8850 });
    const ph = await newPhone(browser, { url: 'http://localhost:8850/exec' }); const pg = ph.page;
    await pg.addInitScript(() => localStorage.setItem('sheetsSeeded_http://localhost:8850/exec', '1'));
    await pg.goto(APP, { waitUntil: 'load' }); await pg.waitForTimeout(2000);
    await ph.ctx.setOffline(true);
    await addIncome(pg, 'ออฟไลน์', 100); await pg.waitForTimeout(1500);
    ok((await pillOf(pg)).includes('ออฟไลน์'), 'offline pill: ' + await pillOf(pg));
    await ph.ctx.setOffline(false); await pg.waitForTimeout(6000);
    ok((await pillOf(pg)).includes('ซิงค์แล้ว') && e.ss.getSheetByName('รายการ').getLastRow() === 2, 'back online: queued record delivered, pill: ' + await pillOf(pg));
    s.srv.close(); await ph.ctx.close();
  }

  console.log('== D) URL validation + first-link merge ==');
  {
    const e = makeEnv({ sheets: ['Sheet1'] }); const s = await startServer(e, { port: 8860 });
    const ph = await newPhone(browser); const pg = ph.page;
    await pg.goto(APP, { waitUntil: 'load' }); await pg.waitForTimeout(800);
    await addIncome(pg, 'ข้อมูลเดิมในเครื่อง', 700); await pg.waitForTimeout(500);
    await pg.evaluate(() => window.openModal('sheetsModal'));
    for (const [bad, expect] of [['https://example.com/x', 'script.google.com'], ['https://script.google.com/macros/s/AKfy123/dev', '/dev'], ['https://script.google.com/macros/s/AKfy123', '/exec']]) {
      await pg.fill('#sheetsUrlInput', bad); await pg.evaluate(() => window.saveSheetsUrl());
      const msg = await pg.textContent('#connResult');
      ok(msg.includes(expect) && (await pg.evaluate(() => localStorage.getItem('sheetsWebhookUrl'))) === null, `URL "${bad.slice(-20)}" rejected: ${msg.slice(0, 60)}`);
    }
    // remote already has a record from another device
    e.post({ id: 'remote1', type: 'income', date: new Date().toISOString().slice(0, 10), monthYear: new Date().toISOString().slice(0, 7), category: 'เงินเดือน', who: 'Phada', description: 'ข้อมูลเดิมในชีต', amount: 500, taxRate: 0, netAmount: 500 });
    await pg.fill('#sheetsUrlInput', 'http://localhost:8860/exec'); await pg.evaluate(() => window.saveSheetsUrl()); await pg.waitForTimeout(4500);
    const local = await records(pg);
    ok(local.length === 2, 'local data merged with sheet data (not overwritten): ' + local.map((t) => t.description).join(' + '));
    ok(e.ss.getSheetByName('รายการ').getLastRow() === 3, 'local-only record uploaded to the sheet');
    s.srv.close(); await ph.ctx.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
