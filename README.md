# PSA Grading Tracker

Dashboard ติดตามการ์ดที่ส่งเกรดกับ PSA: จำนวนตามเกรด, มูลค่าล่าสุด, สถานะการส่งเกรด และภาพการ์ด

## หลักการด้านความปลอดภัย

```
GitHub Secrets ──> GitHub Actions (sync.mjs) ──> portfolio.json ──> GitHub Pages
 (อ่านค่ากลับไม่ได้)    (ฝั่ง server เท่านั้น)      (ไม่มี secret)     (หน้าเว็บอ่านอย่างเดียว)
```

- Token อยู่ใน GitHub Secrets เท่านั้น ไม่อยู่ในโค้ด และไม่ถูกส่งถึง browser
- หน้า Secrets เขียนทับได้อย่างเดียว แม้แต่เจ้าของ repo ก็เปิดดูค่าเดิมไม่ได้
- หน้าเว็บไม่มีฟอร์มแก้ไขข้อมูล การเปลี่ยนแปลงทุกอย่างทำผ่าน GitHub
- `scripts/lib.mjs` เลือกเฉพาะฟิลด์ที่อนุญาตให้เผยแพร่ เลขพัสดุไม่ถูกเผยแพร่ และเลข order ถูกปิดเหลือ 4 ตัวท้าย

**ข้อควรรู้:** GitHub Pages เป็นเว็บสาธารณะ ใครมีลิงก์ก็เห็นรายการการ์ดและมูลค่าได้ แต่ไม่เห็น token

## ตั้งค่า Secrets

ไปที่ **Settings → Secrets and variables → Actions → New repository secret**

| Secret | จำเป็น | ใช้ทำอะไร |
|---|---|---|
| `PSA_API_TOKEN` | ใช่ | สร้างจาก [PSA Public API](https://www.psacard.com/publicapi/documentation) |
| `PSA_ORDER_NUMBERS` | ไม่ | เลข order คั่นด้วยจุลภาค เช่น `12345678,23456789` |
| `PSA_SUBMISSION_NUMBERS` | ไม่ | เลข submission คั่นด้วยจุลภาค |
| `PRICECHARTING_TOKEN` | ไม่ | ราคาอัตโนมัติจาก PriceCharting (บริการแบบเสียเงิน) |

## เพิ่มการ์ด

แก้ไฟล์ `collection.json` บน GitHub มีแค่ `cert` ที่จำเป็น

```json
{
  "cards": [
    { "cert": "12345678" },
    { "cert": "23456789", "value": 150, "valueDate": "2026-11-01", "note": "ซื้อจากงาน" },
    { "cert": "34567890", "pricechartingId": "6910" }
  ]
}
```

- `value` คือราคา USD ที่กรอกเอง ใช้เมื่อไม่มีราคาจาก PriceCharting
- `pricechartingId` คือรหัสสินค้าของ PriceCharting ใช้กับเกรด 7 ขึ้นไป (เกรดต่ำกว่านั้นให้กรอก `value`)

## การอัปเดตข้อมูล

ระบบดึงข้อมูลทุกวันเวลา 08:00 น. (เวลาไทย) และทุกครั้งที่ push ขึ้น `main`
สั่งเองได้ที่ **Actions → Sync and deploy → Run workflow**

- บัญชี PSA ฟรีเรียก API ได้ 100 ครั้งต่อวัน ระบบตั้งเพดานไว้ 80 ครั้ง การ์ดใหม่ใช้ 2 ครั้งต่อใบ ถ้าเกินเพดานจะดึงต่อในวันถัดไป
- ข้อมูลการ์ดเดิมจะดึงใหม่ทุก 7 วัน
- GitHub จะหยุดงานตามเวลาอัตโนมัติ หาก repo สาธารณะไม่มีความเคลื่อนไหว 60 วัน ต้องกดเปิดใหม่ในแท็บ Actions

## พัฒนาในเครื่อง

```bash
npm test
```

ดูหน้าตัวอย่างได้ที่ `?demo=1` (ข้อมูลสมมติ)
