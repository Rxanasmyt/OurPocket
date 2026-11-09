// ทดสอบหน้าต้อนรับครั้งแรก + ไอคอนที่ฝังในไฟล์ (ไม่พึ่งอินเทอร์เน็ต)
// เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const http = require('http');
const { chromium } = require('playwright');
const { makeEnv } = require('./mock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
(async () => {
  const env = makeEnv({ sheets: ['Sheet1'] });
  const srv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
    if (req.method === 'GET') { res.writeHead(200, cors); return res.end(env.get({})); }
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => { res.writeHead(200, cors); res.end(env.ctx.doPost({ postData: { contents: body } }).text); });
  });
  await new Promise((r) => srv.listen(8941, r));
  const browser = await chromium.launch();
  const open = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
    // บล็อกอินเทอร์เน็ตภายนอกทั้งหมด เพื่อพิสูจน์ว่าไอคอนไม่ต้องใช้เน็ต
    await p.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    if (init) await p.addInitScript(init);
    await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(2300);
    return { p, errs };
  };

  console.log('== icons embedded ==');
  let r = await open((() => { localStorage.setItem('onboardDone', '1'); }));
  ok(await r.p.evaluate(() => { const e = document.querySelector('.ph-gear'); const c = getComputedStyle(e); return c.width === '18px' && c.maskImage.includes('svg'); }), 'icons render from icons.css while external sites are blocked');
  ok(await r.p.evaluate(() => ![...document.querySelectorAll('script[src]')].some((s) => /unpkg|jsdelivr/.test(s.src))), 'no external icon script');

  console.log('== first-run welcome ==');
  r = await open(null);
  ok(await r.p.isVisible('#onboard'), 'welcome shows on a fresh install');
  ok((await r.p.textContent('#onboard')).includes('ยินดีต้อนรับ'), 'step 1 content');
  await r.p.click('#obSkip'); await r.p.waitForTimeout(500);
  ok(!(await r.p.$('#onboard')) && await r.p.evaluate(() => localStorage.getItem('onboardDone') === '1'), 'skip closes it and remembers');
  await r.p.reload(); await r.p.waitForTimeout(2300);
  ok(!(await r.p.$('#onboard')), 'does not show again after skipping');

  console.log('== connect from the welcome ==');
  r = await open(null);
  await r.p.click('#obNext'); await r.p.waitForTimeout(300);
  ok(await r.p.isVisible('#obUrl'), 'step 2 asks for URL and password');
  await r.p.click('#obGo'); await r.p.waitForTimeout(200);
  ok((await r.p.textContent('#obResult')).includes('URL') && await r.p.evaluate(() => document.getElementById('obUrl').classList.contains('field-invalid')), 'empty URL: clear message + red field');
  await r.p.fill('#obUrl', 'https://example.com/x'); await r.p.click('#obGo'); await r.p.waitForTimeout(200);
  ok((await r.p.textContent('#obResult')).includes('script.google.com'), 'wrong URL explains what to paste');
  await r.p.fill('#obUrl', 'http://localhost:8941/exec'); await r.p.click('#obGo'); await r.p.waitForTimeout(2500);
  ok(await r.p.evaluate(() => localStorage.getItem('sheetsWebhookUrl') === 'http://localhost:8941/exec'), 'URL saved after a successful test');
  ok(!(await r.p.$('#onboard')), 'welcome closes after connecting');
  ok(r.errs.length === 0, 'no page errors');

  console.log('== not shown when it should not ==');
  r = await open(() => { localStorage.setItem('ourWalletData', JSON.stringify([{ id: 'a', type: 'expense', date: '2026-11-01', monthYear: '2026-11', category: 'อาหาร', who: 'Anas', description: 'x', bank: 'เงินสด', amount: 1, isCompleted: true, timestamp: 1 }])); });
  ok(!(await r.p.$('#onboard')), 'existing data: no welcome');
  r = await open(() => { localStorage.setItem('sheetsWebhookUrl', 'http://localhost:8941/exec'); });
  ok(!(await r.p.$('#onboard')), 'already linked: no welcome');

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
