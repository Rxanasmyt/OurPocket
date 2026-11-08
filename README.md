# Our Wallet

แอปบันทึกรายรับรายจ่ายสำหรับสองคน (เว็บแอปไฟล์เดียว + Google Apps Script)

- `index.html` ตัวแอป
- `Code.gs` โค้ดฝั่ง Google Apps Script (วางใน Extensions > Apps Script)
- `tailwind.css` CSS สำเร็จรูป สร้างจาก `index.html`
- `sw.js` service worker ให้เปิดแอปได้แม้ออฟไลน์

## แก้คลาส Tailwind ใน index.html แล้วต้อง build CSS ใหม่

```
npm install
npm run build:css
```
