// ทดสอบกราฟิกแดชบอร์ด ไอคอน ตัวเลือก และลูกเล่น — เปิดเซิร์ฟเวอร์ก่อน: python3 -m http.server 8080
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const dstr = (o) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymOf = (o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const M0 = ymOf(0);
const seed = [
  { id: 'i0', type: 'income', date: M0 + '-01', monthYear: M0, category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 30000, taxRate: 0, netAmount: 30000, timestamp: 9 },
  { id: 'i1', type: 'income', date: ymOf(-1) + '-01', monthYear: ymOf(-1), category: 'เงินเดือน', who: 'Anas', description: 'เงินเดือน', amount: 25000, taxRate: 0, netAmount: 25000, timestamp: 8 },
  { id: 'e1', type: 'expense', date: M0 + '-05', monthYear: M0, category: 'อาหาร', who: 'Anas', description: 'ข้าว', bank: 'เงินสด', amount: 3000, isCompleted: true, timestamp: 7 },
  { id: 'e2', type: 'expense', date: M0 + '-06', monthYear: M0, category: 'ที่พัก', who: 'Phada', description: 'ค่าไฟ', bank: 'กรุงศรี', amount: 1000, isCompleted: true, timestamp: 6 },
  { id: 'b1', type: 'expense', date: dstr(-3), monthYear: dstr(-3).slice(0, 7), category: 'ที่พัก', who: 'Anas', description: 'ค่าเช่า', bank: 'เงินสด', amount: 500, isCompleted: false, timestamp: 5 },
  { id: 'b2', type: 'expense', date: dstr(5), monthYear: dstr(5).slice(0, 7), category: 'หนี้สิน', who: 'Phada', description: 'ผ่อนมือถือ', bank: 'SCB', amount: 700, isCompleted: false, timestamp: 4 },
  { id: 'b3', type: 'expense', date: dstr(20), monthYear: dstr(20).slice(0, 7), category: 'หนี้สิน', who: 'Anas', description: 'บัตร KTC', bank: 'KTB', amount: 800, isCompleted: false, timestamp: 3 }
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(([s]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ourWalletData', JSON.stringify(s)); } }, [seed]);
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1800);

  console.log('== dashboard graphics ==');
  const expTotal = 3000 + 1000 + 500 + 700 + 800;
  const pct = Math.round(expTotal / 30000 * 100);
  const off = await p.$eval('#flowRing', (e) => parseFloat(e.style.strokeDashoffset));
  ok(Math.abs(off - 213.6 * (1 - expTotal / 30000)) < 1 && (await p.textContent('#flowRingText')) === pct + '%', `ring shows ${pct}% of income spent (offset ${off.toFixed(1)})`);
  await p.evaluate(() => window.toggleStats()); await p.waitForTimeout(900);
  const segs = await p.$$eval('#catDonut svg circle.donut-seg', (e) => e.length);
  ok(segs === 3, 'category donut has one arc per category: ' + segs);
  ok((await p.textContent('#catDonut')).includes('ใช้มากที่สุด') && (await p.textContent('#catDonut')).includes('อาหาร'), 'donut names the top category');
  await p.click('#trendChart .trend-col:last-child'); await p.waitForTimeout(200);
  const info = await p.textContent('#trendInfo');
  ok(info.includes('รายรับ') && info.includes('30,000') && await p.$eval('#trendChart', (e) => e.classList.contains('trend-dim')), 'tap a bar: shows that month and dims the others: ' + info.trim());
  await p.click('#trendChart .trend-col:last-child'); await p.waitForTimeout(150);
  ok(await p.$eval('#trendChart', (e) => !e.classList.contains('trend-dim')), 'tap again clears');
  const dots = await p.$$eval('#payTimeline .timeline-dot', (e) => e.map((d) => parseFloat(d.style.left)));
  ok(dots.length === 3 && dots[0] === 0 && dots[1] > 10 && dots[1] < 25 && dots[2] > 60, 'bill timeline: overdue at the left edge, others spaced by days: ' + dots.map((d) => d.toFixed(0) + '%').join(', '));
  ok(await p.$eval('#payTimeline', (e) => !e.classList.contains('hidden')), 'timeline visible while bills are pending');

  console.log('== budget mood ==');
  await p.evaluate(() => { localStorage.setItem('budget_' + new Date().toISOString().slice(0, 7), '1000'); window.openModal('budgetModal'); document.getElementById('budgetInput').value = 1000; window.saveBudget(); }); await p.waitForTimeout(400);
  const mood = await p.$eval('#budgetStatusText', (e) => [e.textContent, e.classList.contains('wiggle')]);
  ok(mood[0].includes('😱') && mood[1], 'over budget: worried face + wiggle: ' + mood[0]);

  console.log('== privacy mode ==');
  const blur = () => p.evaluate(() => getComputedStyle(document.getElementById('totalBalance')).filter);
  ok((await blur()) === 'none', 'numbers visible by default');
  await p.click('#privacyBtn'); await p.waitForTimeout(600);
  ok((await blur()).includes('blur') && await p.evaluate(() => getComputedStyle(document.querySelector('#transactionsList .money')).filter.includes('blur')), 'eye button blurs balance and list amounts');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => document.body.classList.contains('privacy')), 'choice is remembered after reload');
  await p.click('#privacyBtn'); await p.waitForTimeout(600);
  ok((await blur()) === 'none', 'tap again reveals');

  console.log('== selectors & icons ==');
  const thumb = () => p.evaluate(() => getComputedStyle(document.querySelector('.switch-thumb')).transform);
  const t0 = await thumb();
  await p.evaluate(() => { const t = document.getElementById('carryForwardToggle'); t.click(); }); await p.waitForTimeout(700);
  ok((await p.evaluate(() => document.getElementById('carryForwardToggle').checked)) && (await thumb()) !== t0 && await p.evaluate(() => getComputedStyle(document.querySelector('.switch-track')).backgroundColor === 'rgb(16, 185, 129)'), 'switch slides its thumb and turns green');
  await p.evaluate(() => document.getElementById('carryForwardToggle').click()); await p.waitForTimeout(500);
  await p.evaluate(() => window.openModal('expenseModal')); await p.waitForTimeout(700);
  const cb = () => p.evaluate(() => getComputedStyle(document.getElementById('expCompleted')).backgroundColor);
  const cb0 = await cb(); await p.click('#expCompleted'); await p.waitForTimeout(450);
  ok(cb0 !== (await cb()) && await p.evaluate(() => getComputedStyle(document.getElementById('expCompleted'), '::after').transform !== 'none'), 'checkbox fills and draws its tick');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#expenseModal .chip.active'), '::before').content.includes('✓')), 'selected chip shows a check mark');
  await p.evaluate(() => window.closeModal()); await p.waitForTimeout(350);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#appLogo'); await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.getElementById('appLogo').classList.contains('logo-spin')), 'tapping the logo spins it');
  ok(await p.evaluate(() => getComputedStyle(document.body, '::after').position === 'fixed' && getComputedStyle(document.body, '::before').position === 'fixed'), 'background has both the drifting glow and the ring layer');
  await p.evaluate(() => { document.getElementById('syncBtn').classList.add('x'); });
  await p.screenshot({ path: '/tmp/claude-0/g1.png' });
  await p.evaluate(() => document.getElementById('remindersSection').scrollIntoView({ block: 'start' })); await p.waitForTimeout(900);
  await p.screenshot({ path: '/tmp/claude-0/g2.png' });
  ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
