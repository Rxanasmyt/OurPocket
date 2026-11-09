// สร้าง icons.css: ไอคอน Phosphor เฉพาะที่ index.html ใช้จริง ฝังเป็น SVG (ไม่พึ่งอินเทอร์เน็ต)
// ใช้: npm run build:icons   (ต้องมี @phosphor-icons/core ใน node_modules หรือกำหนด PHOSPHOR_DIR=.../assets)
// เมื่อเพิ่มไอคอนใหม่ใน index.html (class ph-xxx) ให้รันสคริปต์นี้แล้ว commit icons.css
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const assets = process.env.PHOSPHOR_DIR || path.join(root, 'node_modules', '@phosphor-icons', 'core', 'assets');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const skip = new Set(['ph-bold', 'ph-fill', 'ph-regular', 'ph-light', 'ph-thin', 'ph-duotone']);
const names = [...new Set((html.match(/\bph-[a-z0-9]+(?:-[a-z0-9]+)*/g) || []).filter((n) => !skip.has(n)))].sort();
const enc = (svg) => 'data:image/svg+xml,' + svg.replace(/\s*\n\s*/g, '').replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');
let css = `/* สร้างโดย tools/build-icons.js (ไอคอน Phosphor ฝังเป็น SVG) ห้ามแก้มือ */
.ph-bold, .ph-fill { display: inline-block; width: 1em; height: 1em; flex-shrink: 0; vertical-align: -0.125em; font-style: normal; background-color: currentColor; -webkit-mask: var(--ph) center / contain no-repeat; mask: var(--ph) center / contain no-repeat; }
`;
const missing = [];
for (const w of ['bold', 'fill']) {
  for (const n of names) {
    const file = path.join(assets, w, `${n.slice(3)}-${w}.svg`);
    if (!fs.existsSync(file)) { missing.push(`${w}/${n}`); continue; }
    css += `.ph-${w}.${n} { --ph: url("${enc(fs.readFileSync(file, 'utf8'))}"); }\n`;
  }
}
fs.writeFileSync(path.join(root, 'icons.css'), css);
console.log(`icons.css: ${names.length} icons x 2 weights, ${(css.length / 1024).toFixed(1)} KB` + (missing.length ? `\nmissing: ${missing.join(', ')}` : ''));
