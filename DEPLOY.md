# Deploy Code.gs อัตโนมัติ (ตั้งค่าครั้งเดียว)

ทุกครั้งที่ `Code.gs` เปลี่ยนบน GitHub ระบบจะ **รันเทสต์ → อัปโหลดเข้า Apps Script → Deploy ทับ Deployment เดิม** ให้เอง
URL ของ Web App **ไม่เปลี่ยน** ไม่ต้องใส่ URL ในแอปใหม่ และไม่ต้องวางโค้ดเองอีก
ถ้าเทสต์ไม่ผ่าน จะไม่ Deploy ถ้ายังไม่ตั้ง Secret ครบ ระบบจะข้ามขั้นตอน Deploy เฉยๆ (ไม่ล้ม)

ไฟล์ที่เกี่ยวข้อง: `.github/workflows/deploy-apps-script.yml`, `appsscript.json`

## ขั้นตอนตั้งค่า (ทำครั้งเดียว บนคอมพิวเตอร์)

1. **เปิด Apps Script API**: ไปที่ https://script.google.com/home/usersettings แล้วเปิด "Google Apps Script API" เป็น On
2. **ล็อกอิน clasp** (ต้องมี Node.js):
   ```
   npx @google/clasp@2.4.2 login
   ```
   เบราว์เซอร์จะเปิดให้เลือกบัญชี Google **ของเจ้าของไฟล์ชีต** (บัญชีเดียวกับที่ Deploy Web App) เสร็จแล้วจะได้ไฟล์ `~/.clasprc.json`
3. **หา Script ID**: เปิด Apps Script → ไอคอนเฟือง (Project Settings) → คัดลอก "Script ID"
4. **หา Deployment ID**: Apps Script → ทำให้ใช้งานได้ (Deploy) → จัดการการทำให้ใช้งานได้ (Manage deployments) → เลือก Deployment ที่ใช้อยู่ → คัดลอก "Deployment ID"
   (เป็นรหัสยาวขึ้นต้น `AKfy...` ไม่ใช่ URL ของ Web App)
5. **ใส่ Secret ใน GitHub**: repo → Settings → Secrets and variables → Actions → New repository secret

   | ชื่อ Secret | ค่า |
   |---|---|
   | `CLASPRC_JSON` | เนื้อหาทั้งไฟล์ `~/.clasprc.json` |
   | `SCRIPT_ID` | Script ID จากข้อ 3 |
   | `DEPLOYMENT_ID` | Deployment ID จากข้อ 4 |
   | `WEBAPP_URL` (ไม่บังคับ) | URL Web App (ลงท้าย `/exec`) ใช้ให้ระบบตรวจว่า Deploy แล้วใช้งานได้จริง |

6. **ลองรัน**: แท็บ Actions → "Deploy Apps Script" → Run workflow (หรือรอรอบถัดไปที่ `Code.gs` เปลี่ยน)

## ตรวจสอบว่าทำงาน
- แท็บ Actions ต้องขึ้นเครื่องหมายถูกสีเขียว ถ้ามี Secret ครบ จะมีขั้นตอน "Push and deploy"
- ใน Apps Script → จัดการการทำให้ใช้งานได้ จะเห็นเวอร์ชันใหม่ที่มีคำอธิบาย `auto xxxxxxx`

## ข้อควรระวัง
- **ความปลอดภัย:** ไฟล์ `.clasprc.json` ให้สิทธิ์เข้าบัญชี Google ของคุณในขอบเขตของ clasp (Apps Script, Drive ฯลฯ)
  เก็บเป็น Secret เท่านั้น **ห้าม commit ลง repo** และให้ repo เป็น private ที่คุณคนเดียวมีสิทธิ์เขียน
  ถ้าสงสัยว่าหลุด ให้ไปเพิกถอนที่ https://myaccount.google.com/permissions แล้วทำข้อ 2 ใหม่
- **ไฟล์ `appsscript.json`** ในโปรเจกต์นี้จะถูกอัปโหลดทับของเดิมในโปรเจกต์ Apps Script (ตั้งเขตเวลา Asia/Bangkok, รันในฐานะเจ้าของ, ทุกคนเรียกได้)
  ถ้าโปรเจกต์คุณมีค่าที่ตั้งไว้เอง ให้เทียบกับ Project Settings → "Show appsscript.json manifest file" ก่อนครั้งแรก
- **สิทธิ์ใหม่:** ถ้าโค้ดต้องขอสิทธิ์ Google เพิ่ม (เช่นเข้า Drive หรือส่งอีเมล) การ Deploy อัตโนมัติไม่พอ ต้องเปิด Apps Script แล้วกดอนุญาตเองหนึ่งครั้ง
- **โทเค็นหมดอายุ:** ถ้า workflow ล้มที่ขั้นตอน Push แจ้งเรื่องสิทธิ์ ให้ทำข้อ 2 ใหม่แล้วอัปเดต Secret `CLASPRC_JSON`
- แอปยังใช้โค้ดชีตเวอร์ชันเก่าต่อได้ระหว่างที่ Deploy ล้ม (แอปมีระบบเช็กเวอร์ชันสคริปต์และแจ้งเตือนเอง)
