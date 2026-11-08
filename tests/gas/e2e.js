const http = require('http');
const { chromium } = require('playwright');
const { makeEnv } = require('./mock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

function startServer(env, { old = false, port }) {
  const stats = { posts: 0, gets: 0 };
  const srv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET') { stats.gets++; res.writeHead(200, cors); return res.end(old ? '✅ Our Wallet: Web App is running successfully!' : env.get(Object.fromEntries(url.searchParams))); }
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      stats.posts++;
      const out = env.ctx.doPost({ postData: { contents: body } }).text;
      res.writeHead(200, cors); res.end(out);
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, stats })));
}

(async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date(); const M0 = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const nextM = (o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const browser = await chromium.launch();

  console.log('== A) app <-> real Code.gs (mock sheet), key protected ==');
  const env = makeEnv({ sheets: ['Sheet1'], props: { WALLET_KEY: 'pw123' } });
  const { srv, stats } = await startServer(env, { port: 8791 });
  const URL_ = 'http://localhost:8791/exec';
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
  const pill = () => p.textContent('#syncStatus').then((t) => t.trim());
  await p.evaluate(() => window.openModal('sheetsModal'));
  await p.fill('#sheetsUrlInput', URL_); await p.fill('#sheetsKeyInput', 'wrong');
  await p.evaluate(() => window.testConnection()); await p.waitForTimeout(800);
  const t1 = await p.textContent('#connResult'); console.log('   test (wrong key):', t1.replace(/\n/g, ' / '));
  ok(t1.includes('รหัสผ่านไม่ตรง'), 'testConnection reports wrong password');
  await p.fill('#sheetsKeyInput', 'pw123');
  await p.evaluate(() => window.testConnection()); await p.waitForTimeout(1500);
  const t2 = await p.textContent('#connResult'); console.log('   test (right key):', t2.replace(/\n/g, ' / '));
  ok(t2.includes('✅') && t2.includes('ตั้งแล้ว'), 'testConnection OK, key protection reported');
  ok((env.ss.getSheetByName('รายการ').getLastRow() || 0) <= 1, 'selftest left no rows behind');
  await p.evaluate(() => window.saveSheetsUrl()); await p.waitForTimeout(2500);
  ok((await pill()).includes('ซิงค์แล้ว'), 'status pill: ' + await pill());

  // add an income through the real form
  await p.evaluate(() => window.openModal('incomeModal'));
  await p.fill('#incDesc', 'เงินเดือน'); await p.fill('#incAmount', '30000'); await p.selectOption('#incTaxRate', '3'); await p.selectOption('#incWho', 'Anas');
  await p.evaluate(() => document.getElementById('incomeForm').requestSubmit()); await p.waitForTimeout(1800);
  // add an installment expense through the form (should auto-roll)
  await p.evaluate(() => window.openModal('expenseModal'));
  await p.fill('#expDesc', 'ผ่อนมือถือ iPhone'); await p.selectOption('#expPayMode', 'installment');
  await p.fill('#expInstallAmount', '1500'); await p.fill('#expCurInstall', '2'); await p.fill('#expTotalInstall', '5'); await p.selectOption('#expBank', 'SCB'); await p.selectOption('#expWho', 'Phada');
  const cat = await p.inputValue('#expCategory'); ok(cat === 'หนี้สิน', 'category auto-picked from description: ' + cat);
  await p.evaluate(() => document.getElementById('expenseForm').requestSubmit()); await p.waitForTimeout(3500);
  const ds = env.ss.getSheetByName('รายการ');
  const hdr = ds.getRange(1, 1, 1, ds.getLastColumn()).getValues()[0];
  const rows = []; for (let r = 2; r <= ds.getLastRow(); r++) { const o = {}; ds.getRange(r, 1, 1, hdr.length).getValues()[0].forEach((v, i) => (o[hdr[i]] = v)); rows.push(o); }
  console.log('   sheet rows:', rows.map((o) => `${o['ประเภท']}|${o['เดือน-ปี']}|${o['รายการ']}|${o['ธนาคาร']}|งวด${o['งวดที่']}/${o['รวมงวด']}|${o['จำนวนเงิน']}|${o['สถานะ']}|${o['ที่มา']}`));
  ok(rows.length === 3, 'sheet has income + installment 2/5 + auto-generated 3/5 for next month: ' + rows.length);
  const inc = rows.find((o) => o['ประเภท'] === 'รายรับ');
  ok(inc && inc['จำนวนเงิน'] === 29100 && inc['ยอดก่อนหัก'] === 30000 && inc['หัก ณ ที่จ่าย %'] === 3 && inc['คนทำรายการ'] === 'Anas', 'income complete in sheet');
  const instRows = rows.filter((o) => o['รูปแบบการจ่าย'] === 'ผ่อนบัตร: จ่ายเป็นงวด');
  ok(instRows.length === 2 && instRows.every((o) => o['ธนาคาร'] === 'SCB' && o['หมวดหมู่'] === 'หนี้สิน' && o['คนทำรายการ'] === 'Phada'), '2 installment rows with bank/category/person');
  ok(instRows.filter((o) => o['ที่มา'] === 'สร้างอัตโนมัติ').length === 1 && instRows.some((o) => o['งวดที่'] === 3), 'the next-month row (งวด 3/5) is marked สร้างอัตโนมัติ');
  let leak = false; for (const v of ds.cells.values()) if (String(v).includes('pw123')) leak = true; ok(!leak, 'password never written to sheet');
  ok((await pill()).includes('ซิงค์แล้ว'), 'status after saves: ' + await pill());

  // second device: fresh browser pulls everything
  const p2 = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await p2.addInitScript(([u]) => { localStorage.setItem('sheetsWebhookUrl', u); localStorage.setItem('sheetsKey', 'pw123'); }, [URL_]);
  await p2.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p2.waitForTimeout(3000);
  const n2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]').length);
  ok(n2 === 3, 'second phone sees all 3 records after sync: ' + n2);
  // delete on phone 1 -> disappears on phone 2
  const idDel = await p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData')).find(t => t.type === 'income').id);
  p.once('dialog', (d) => d.accept());
  await p.evaluate((id) => window.deleteItem(id), idDel); await p.waitForTimeout(2000);
  ok(env.ss.getSheetByName('รายการ').getLastRow() === 3, 'delete removed the row from the sheet');
  await p2.waitForTimeout(6500);
  const n3 = await p2.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]').length);
  ok(n3 === 2, 'second phone sees the deletion within ~6s: ' + n3);
  console.log('   errors:', errs);
  srv.close();

  console.log('== B) old (not redeployed) script: app must not send anything ==');
  const env2 = makeEnv({ sheets: ['Sheet1'] });
  const s2 = await startServer(env2, { old: true, port: 8792 });
  const p3 = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await p3.addInitScript(([u]) => { localStorage.setItem('sheetsWebhookUrl', u); localStorage.setItem('sheetsKey', 'pw123'); localStorage.setItem('sheetsSeeded_' + u, '1'); }, ['http://localhost:8792/exec']);
  await p3.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p3.waitForTimeout(1500);
  await p3.evaluate(() => window.openModal('incomeModal')); await p3.fill('#incDesc', 'x'); await p3.fill('#incAmount', '100');
  await p3.evaluate(() => document.getElementById('incomeForm').requestSubmit()); await p3.waitForTimeout(2500);
  const pillOld = (await p3.textContent('#syncStatus')).trim();
  ok(pillOld.includes('สคริปต์เก่า'), 'status pill warns: ' + pillOld);
  ok(s2.stats.posts === 0, 'no POST sent to old script (so no junk rows/key leak): posts=' + s2.stats.posts);
  ok(await p3.evaluate(() => JSON.parse(localStorage.getItem('walletQueue')).length) === 1, 'data kept in queue, not lost');
  s2.srv.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
