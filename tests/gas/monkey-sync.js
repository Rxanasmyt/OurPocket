// Monkey test ของการซิงค์: มือถือ 2 เครื่อง + ชีต (Code.gs จริงในตัวจำลอง) สุ่มเพิ่ม/แก้/ลบ/จ่าย บางช่วงตัดเน็ต
// แล้วต้อง "ลงตัว" คือข้อมูลของทั้งสองเครื่องและในชีตเหมือนกันทุกประการ ไม่มีคิวค้าง
// ใช้: node tests/gas/monkey-sync.js [seed] [จำนวนครั้ง]
const http = require('http');
const { chromium } = require('playwright');
const { makeEnv } = require('./mock');
const seed0 = Number(process.argv[2] || 1), N = Number(process.argv[3] || 50);
let s = seed0 * 7919 + 104729;
const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

(async () => {
  const env = makeEnv({ sheets: ['Sheet1'] });
  const srv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' };
    if (req.method === 'GET') { res.writeHead(200, cors); return res.end(env.get({})); }
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => { res.writeHead(200, cors); res.end(env.ctx.doPost({ postData: { contents: body } }).text); });
  });
  await new Promise((r) => srv.listen(8940, r));
  const URL_ = 'http://localhost:8940/exec';
  const b = await chromium.launch();
  const errs = [];
  const phones = [];
  for (const name of ['A', 'B']) {
    const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`)); p.on('dialog', (d) => d.dismiss());
    await p.addInitScript(([u]) => { localStorage.setItem('sheetsWebhookUrl', u); localStorage.setItem('sheetsSeeded_' + u, '1'); }, [URL_]);
    await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
    phones.push({ name, ctx, p, offline: false });
  }
  await phones[0].p.waitForTimeout(2500);
  const dateIn = () => { const d = new Date(); d.setDate(d.getDate() + int(-20, 20)); return d.toISOString().slice(0, 10); };
  const form = (p, o) => p.evaluate((x) => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    if (x.kind === 'income') { window.openModal('incomeModal'); set('incDesc', x.desc); set('incAmount', x.amount); set('incDate', x.date); document.getElementById('incomeForm').requestSubmit(); }
    else {
      window.openModal('expenseModal'); set('expDesc', x.desc); set('expDueDate', x.date); set('expPayMode', x.mode);
      if (x.mode === 'installment') { set('expInstallAmount', x.per); set('expCurInstall', x.cur); set('expTotalInstall', x.tot); set('expAmount', x.per); } else set('expAmount', x.amount);
      document.getElementById('expenseForm').requestSubmit();
    }
  }, o);
  const ids = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]').map((t) => t.id));
  for (let n = 0; n < N; n++) {
    const ph = pick(phones);
    const roll = rnd();
    if (roll < 0.08) { ph.offline = !ph.offline; await ph.ctx.setOffline(ph.offline); }
    else if (roll < 0.30) await form(ph.p, { kind: 'income', desc: 'รับ' + n, amount: int(10, 9999), date: dateIn() });
    else if (roll < 0.50) await form(ph.p, { kind: 'expense', desc: 'จ่าย' + n, amount: int(10, 9999), date: dateIn(), mode: 'normal' });
    else if (roll < 0.58) { const tot = int(2, 5); await form(ph.p, { kind: 'expense', desc: 'ผ่อน' + n, per: int(100, 900), cur: int(1, tot), tot, date: dateIn(), mode: 'installment' }); }
    else {
      const all = await ids(ph.p); if (all.length) {
        const id = pick(all), k = pick(['edit', 'delete', 'toggle', 'toggle', 'edit']);
        await ph.p.evaluate(([kind, i]) => {
          if (kind === 'delete') window.deleteItem(i);
          else if (kind === 'toggle') window.toggleStatus(i);
          else { window.editItem(i); const m = document.getElementById('expenseModal').classList.contains('flex'); const e = document.getElementById(m ? 'expAmount' : 'incAmount'); e.value = String(Number(e.value || 0) + 7); e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById(m ? 'expenseForm' : 'incomeForm').requestSubmit(); }
        }, [k, id]);
      }
    }
    await ph.p.waitForTimeout(int(60, 350));
  }
  for (const ph of phones) { if (ph.offline) { ph.offline = false; await ph.ctx.setOffline(false); } await ph.p.evaluate(() => window.closeModal()); }
  // รอให้ลงตัว
  const sig = (arr) => JSON.stringify([...arr].sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)).map((t) => [t.id, t.type, t.date, t.description, t.amount, t.netAmount, t.isCompleted === true, t.currentInstallment || null, !!t.stopAuto]));
  const snap = async () => {
    const [a, c] = await Promise.all(phones.map((x) => x.p.evaluate(() => ({ d: JSON.parse(localStorage.getItem('ourWalletData') || '[]'), q: JSON.parse(localStorage.getItem('walletQueue') || '[]').length }))));
    const sheet = env.post({ action: 'sync' }).data;
    return { a, c, sheet };
  };
  let st, converged = false;
  for (let i = 0; i < 40; i++) {
    await phones[0].p.waitForTimeout(1000);
    st = await snap();
    if (st.a.q === 0 && st.c.q === 0 && sig(st.a.d) === sig(st.c.d) && sig(st.a.d) === sig(st.sheet)) { converged = true; break; }
  }
  const lines = [];
  if (!converged) {
    lines.push(`NOT CONVERGED: A=${st.a.d.length} (queue ${st.a.q}) B=${st.c.d.length} (queue ${st.c.q}) sheet=${st.sheet.length}`);
    const sa = new Set(st.a.d.map((t) => t.id)), sb = new Set(st.c.d.map((t) => t.id)), ss = new Set(st.sheet.map((t) => t.id));
    const diff = (x, y) => [...x].filter((i) => !y.has(i)).slice(0, 5);
    lines.push(`  in A not in B: ${diff(sa, sb)}  in B not in A: ${diff(sb, sa)}  in A not in sheet: ${diff(sa, ss)}  in sheet not in A: ${diff(ss, sa)}`);
  }
  const dupIds = st.sheet.length !== new Set(st.sheet.map((t) => t.id)).size;
  if (dupIds) lines.push('duplicate ids in sheet data');
  const rows = env.ss.getSheetByName('รายการ'); const map = {}; let rowDupes = 0;
  if (rows) { const ido = rows.getRange(1, 1, 1, rows.getLastColumn()).getValues()[0].indexOf('ID'); for (let r = 2; r <= rows.getLastRow(); r++) { const id = rows.get(r, ido + 1); if (map[id]) rowDupes++; map[id] = 1; } }
  if (rowDupes) lines.push(`duplicate rows in sheet: ${rowDupes}`);
  console.log(`seed ${seed0}: ${N} ops, converged=${converged}, records=${st.sheet.length}, page errors=${errs.length}`);
  lines.forEach((l) => console.log('  ISSUE ' + l)); [...new Set(errs)].slice(0, 5).forEach((e) => console.log('  ' + e));
  srv.close(); await b.close(); process.exit(lines.length || errs.length ? 1 : 0);
})();
