# Our Wallet

แอปบันทึกรายรับรายจ่ายสำหรับสองคน (เว็บแอปไฟล์เดียว + Google Apps Script)

- `index.html` ตัวแอป
- `Code.gs` โค้ดฝั่ง Google Apps Script (วางใน Extensions > Apps Script แล้ว Deploy เป็น Web app)
- `tailwind.css` CSS สำเร็จรูป สร้างจาก `index.html`
- `sw.js` service worker ให้เปิดแอปได้แม้ออฟไลน์
- `tests/gas/` ชุดทดสอบฝั่งชีต (จำลอง Apps Script รันโค้ดจริง + ตรวจสูตรด้วย HyperFormula)
- `CLAUDE.md` กติกาเมื่อต้องปรับโครงสร้างข้อมูลและชีต

## Google Sheet ที่ระบบสร้างให้
`สรุป` (แดชบอร์ด+กราฟ) · `ลำดับจ่าย` (บิลที่ต้องจ่ายเรียงตามวันครบกำหนด) · `รายเดือน` (ดูทั้งหมด/รายรับ/รายจ่าย) · `รายการ` (ข้อมูลทั้งหมด) · `ตั้งค่า` (งบประมาณ)

## คำสั่ง

```
npm install
npm run build:css     # หลังแก้คลาส Tailwind ใน index.html
npm run test:sheet    # ทดสอบการบันทึกลงชีต + สูตรแดชบอร์ด/ลำดับจ่าย
npm run test:e2e      # ทดสอบแอป <-> ชีตแบบครบวงจร (ต้องเปิด python3 -m http.server 8080 ก่อน)
```
