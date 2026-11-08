// Monkey test: สุ่มกดใช้งานแอปหลายร้อยครั้ง แล้วตรวจกฎที่ต้องเป็นจริงเสมอ (ข้อมูลไม่เสีย ตัวเลขตรง ไม่มี NaN ไม่มีแถบเลื่อนข้าง ไม่มี error)
// ใช้: node tests/gas/monkey.js [seed] [จำนวนครั้ง]   (เปิด python3 -m http.server 8080 ก่อน)
const { chromium } = require('playwright');
const seed0 = Number(process.argv[2] || 1), N = Number(process.argv[3] || 150);
let s = seed0 * 9301 + 49297;
const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const issuesAll = [];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message)); p.on('dialog', (d) => d.dismiss());
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load|net::/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const log = [];
  const act = async (name, fn) => { log.push(name); try { await fn(); } catch (e) { issuesAll.push(`action "${name}" threw: ${String(e.message).split('\n')[0]}`); } };
  const ev = (f, a) => p.evaluate(f, a);
  const fillForm = (kind, o) => ev((x) => {
    const set = (id, v) => { const e = document.getElementById(id); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    if (x.kind === 'income') {
      window.openModal('incomeModal'); set('incDesc', x.desc); set('incAmount', x.amount); set('incTaxRate', x.tax); set('incCategory', x.cat); set('incWho', x.who); set('incDate', x.date);
      document.getElementById('incomeForm').requestSubmit();
    } else {
      window.openModal('expenseModal'); set('expDesc', x.desc); set('expWho', x.who); set('expBank', x.bank); set('expDueDate', x.date); set('expPayMode', x.mode);
      if (x.mode === 'minpay') { set('expFullAmount', x.full); set('expMinAmount', x.min); set('expAmount', x.amount); }
      else if (x.mode === 'installment') { set('expInstallAmount', x.per); set('expCurInstall', x.cur); set('expTotalInstall', x.tot); set('expAmount', x.per); }
      else set('expAmount', x.amount);
      document.getElementById('expenseForm').requestSubmit();
    }
  }, { kind, ...o });
  const dateIn = () => { const d = new Date(); d.setDate(d.getDate() + int(-40, 40)); return d.toISOString().slice(0, 10); };
  const words = ['ข้าว', 'ค่าไฟ', 'น้ำมัน', 'ผ่อนมือถือ', 'บัตร KTC', 'ค่าเช่า', 'shopee', 'ค่ายา', 'เงินเดือน', 'โบนัส', '<b>x</b>', "it's", 'ยาวมากๆ'.repeat(6)];
  const ids = async () => ev(() => JSON.parse(localStorage.getItem('ourWalletData') || '[]').map((t) => t.id));
  const randId = async () => { const a = await ids(); return a.length ? pick(a) : null; };

  const actions = [
    () => act('addIncome', () => fillForm('income', { desc: pick(words), amount: (int(1, 99999) + (rnd() < 0.5 ? 0.37 : 0)).toFixed(2), tax: pick(['0', '3']), cat: pick(['เงินเดือน', 'ค่าเวร', 'ค่าเงินประจำตำแหน่ง']), who: pick(['Anas', 'Phada']), date: dateIn() })),
    () => act('addExpense', () => fillForm('expense', { desc: pick(words), amount: int(1, 9999), who: pick(['Anas', 'Phada']), bank: pick(['เงินสด', 'KBank', 'SCB', 'กรุงศรี']), date: dateIn(), mode: 'normal' })),
    () => act('addMinpay', () => { const full = int(2000, 30000); const min = int(100, 1500); return fillForm('expense', { desc: 'บัตร ' + pick(['KTC', 'SCB', 'KBank']), who: pick(['Anas', 'Phada']), bank: 'Credit Card', date: dateIn(), mode: 'minpay', full, min, amount: int(min, full) }); }),
    () => act('addInstallment', () => { const tot = int(2, 8); return fillForm('expense', { desc: 'ผ่อน ' + pick(['มือถือ', 'ทีวี', 'ตู้เย็น']), who: pick(['Anas', 'Phada']), bank: pick(['SCB', 'KTB']), date: dateIn(), mode: 'installment', per: int(100, 3000), cur: int(1, tot), tot }); }),
    async () => { const id = await randId(); if (id) await act('edit', () => ev((i) => { window.editItem(i); const e = document.getElementById(document.getElementById('expenseModal').classList.contains('flex') ? 'expAmount' : 'incAmount'); if (e && e.value !== '') { e.value = String(Number(e.value) + 1); e.dispatchEvent(new Event('input', { bubbles: true })); } const f = document.getElementById(document.getElementById('expenseModal').classList.contains('flex') ? 'expenseForm' : 'incomeForm'); f.requestSubmit(); }, id)); },
    async () => { const id = await randId(); if (id) await act('delete', () => ev((i) => window.deleteItem(i), id)); },
    () => act('undo', () => ev(() => { const b = document.querySelector('.toast-action'); if (b) b.click(); })),
    async () => { const id = await randId(); if (id) await act('toggle', () => ev((i) => window.toggleStatus(i), id)); },
    async () => { const id = await randId(); if (id) await act('payBill', () => ev((i) => window.payBill(i), id)); },
    async () => { const id = await randId(); const kind = pick(['edit', 'paid', 'dup', 'del']); if (id) await act('rowMenu:' + kind, () => ev(([k, i]) => window.rowMenuAction(k, i), [kind, id])); },
    () => act('month', () => ev((d) => window.shiftMonth(d), pick([-3, -2, -1, 1, 2, 3]))),
    () => act('view', () => ev((v) => window.setView(v), pick(['all', 'income', 'expense']))),
    () => act('search', () => ev((q) => { const e = document.getElementById('searchInput'); e.value = q; e.dispatchEvent(new Event('input')); }, pick(['', 'ข้าว', 'zzz', '<b>', 'ค่า']))),
    () => act('stats', () => ev(() => window.toggleStats())),
    () => act('privacy', () => ev(() => window.togglePrivacy())),
    () => act('carry', () => ev(() => { const t = document.getElementById('carryForwardToggle'); t.checked = !t.checked; t.dispatchEvent(new Event('change')); })),
    () => act('modal', () => ev((m) => { window.openModal(m); }, pick(['debtModal', 'copyBillsModal', 'budgetModal', 'sheetsModal', 'syncModal']))),
    () => act('close', () => ev(() => window.closeModal())),
    () => act('budget', () => ev((v) => { window.openModal('budgetModal'); document.getElementById('budgetInput').value = v; window.saveBudget(); }, pick(['', '0', '1000', '50000']))),
    () => act('copyBills', () => ev(() => { window.shiftMonth(1); setTimeout(() => { window.openModal('copyBillsModal'); document.querySelectorAll('.copy-bill-checkbox').forEach((c) => (c.checked = true)); window.submitCopyBills(); }, 300); })),
    () => act('reload', async () => { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200); })
  ];

  const check = async (stepNo) => {
    await p.waitForTimeout(900);
    const issues = await ev(() => {
      const out = [];
      const data = JSON.parse(localStorage.getItem('ourWalletData') || '[]');
      const seen = new Set();
      data.forEach((t) => {
        if (!t || !t.id || !t.type) { out.push('bad record'); return; }
        if (seen.has(t.id)) out.push('duplicate id ' + t.id);
        seen.add(t.id);
        if (t.type === 'expense' && !(Number(t.amount) >= 0)) out.push('bad amount ' + t.id + ' ' + t.amount);
        if (t.type === 'income' && !(Number(t.netAmount) >= 0)) out.push('bad net ' + t.id);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') || (t.monthYear || '') !== (t.date || '').slice(0, 7)) out.push('date/month mismatch ' + t.id + ' ' + t.date + ' ' + t.monthYear);
      });
      const txt = document.body.innerText;
      const bad = txt.match(/.{0,25}(NaN|undefined|\[object|Infinity).{0,25}/);
      if (bad) out.push('bad text: ' + bad[0].replace(/\n/g, ' '));
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('horizontal scroll');
      // ยอดการ์ดต้องตรงกับข้อมูลของเดือนที่เลือก
      const ym = document.getElementById('monthSelector').value;
      const inc = data.filter((t) => t.type === 'income' && t.monthYear === ym).reduce((a, t) => a + Number(t.netAmount || 0), 0);
      const exp = data.filter((t) => t.type === 'expense' && t.monthYear === ym).reduce((a, t) => a + Number(t.amount || 0), 0);
      const num = (id) => Number((document.getElementById(id).textContent.replace(/[^\d.-]/g, '').replace(/^(-?)\./, '$10.')) || 0);
      const carry = document.getElementById('carryForwardToggle').checked;
      if (Math.abs(num('totalIncome') - inc) > 0.011) out.push(`income card ${num('totalIncome')} != ${inc.toFixed(2)} (${ym})`);
      if (Math.abs(num('totalExpense') - exp) > 0.011) out.push(`expense card ${num('totalExpense')} != ${exp.toFixed(2)} (${ym})`);
      if (!carry) { const bal = Number(document.getElementById('totalBalance').textContent.replace(/[^\d.-]/g, '')); if (Math.abs(bal - (inc - exp)) > 0.011) out.push(`balance ${bal} != ${(inc - exp).toFixed(2)}`); }
      if (document.querySelector('.removing') && !document.querySelector('.swipe-row')) { /* ok */ }
      return out;
    });
    issues.forEach((i) => issuesAll.push(`step ${stepNo}: ${i}  [last actions: ${log.slice(-4).join(', ')}]`));
  };

  for (let n = 1; n <= N; n++) {
    await pick(actions)();
    await p.waitForTimeout(int(40, 160));
    if (n % 6 === 0) await check(n);
  }
  await check('final');
  const uniq = [...new Set(issuesAll)];
  console.log(`seed ${seed0}: ${N} actions, ${uniq.length} distinct issue(s), ${errs.length} page error(s)`);
  uniq.slice(0, 12).forEach((i) => console.log('  ISSUE', i));
  [...new Set(errs)].slice(0, 8).forEach((e) => console.log('  ' + e));
  await b.close(); process.exit(uniq.length || errs.length ? 1 : 0);
})();
