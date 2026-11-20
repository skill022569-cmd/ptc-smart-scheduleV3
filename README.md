# PTC Smart Schedule

ระบบตารางเรียน-ตารางสอน วิทยาลัยการอาชีพโพนทอง
Next.js 14 (App Router) + Prisma + TiDB Cloud ติดตั้งบน Vercel

## โครงสร้าง

| ที่อยู่ | หน้าที่ |
|---|---|
| `lib/core.js` | ตัวตรวจเงื่อนไข ตัวจัดตาราง (CSP + MRV) และคะแนนความเหมาะสม ใช้ร่วมกันทั้งหน้าเว็บและเซิร์ฟเวอร์ |
| `lib/ui.js` | หน้าเว็บทุกบทบาท (สาธารณะ / ครู / แอดมิน) |
| `lib/server.js`, `lib/store.js` | โหลดข้อมูล, session (JWT ใน httpOnly cookie), บันทึกคาบพร้อม `slot_occupancy` |
| `app/api/*` | API: `bootstrap`, `act` (ทุกการแก้ไข), `auth/*`, `public/student-lookup` |
| `prisma/schema.prisma` | ตารางในฐานข้อมูล |
| `prisma/seed.js` | ข้อมูลตัวอย่าง (รันครั้งแรกครั้งเดียว ถ้ามีข้อมูลแล้วจะข้าม) |

ทุกการบันทึกคาบผ่าน 3 ด่าน: ตรวจที่หน้าเว็บ (สีเขียว/เหลือง/แดง) → ตรวจซ้ำที่เซิร์ฟเวอร์ด้วยฟังก์ชันเดียวกัน → unique index ใน `slot_occupancy` กันชนเป็นด่านสุดท้าย และใช้ `rowVersion` กันการแก้ทับกัน

## ติดตั้งบน Vercel + TiDB Cloud (ครั้งแรก)

### 1. สร้างฐานข้อมูล TiDB Cloud (ฟรี)
1. ไปที่ <https://tidbcloud.com> → **Sign up / Log in** (ใช้ Google ได้)
2. **Create Cluster** → เลือก **Serverless** → Region **Singapore (ap-southeast-1)** → **Create**
3. เข้า cluster → **Connect** → เลือก **Connect With: Prisma**
4. กด **Generate Password** แล้วจดไว้ (แสดงครั้งเดียว)
5. ช่อง Database เปลี่ยนเป็น `ptc_schedule` (ระบบสร้างให้อัตโนมัติ)
6. คัดลอกค่า `DATABASE_URL` ที่ได้ ต้องลงท้ายด้วย `?sslaccept=strict`

### 2. Deploy บน Vercel
1. ไปที่ <https://vercel.com> → **Sign up / Log in with GitHub**
2. **Add New… → Project** → เลือก repo `ptc-smart-schedule` → **Import**
3. เปิด **Environment Variables** แล้วเพิ่ม 3 ค่า:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | ค่าจาก TiDB ข้อ 1.6 |
   | `AUTH_SECRET` | สุ่มตัวอักษรอย่างน้อย 32 ตัว เช่นจาก <https://generate-secret.vercel.app/32> |
   | `INITIAL_PASSWORD` | รหัสผ่านเริ่มต้นของทุกบัญชี (8 ตัวขึ้นไป) |

4. กด **Deploy** ระบบจะสร้างตาราง ใส่ข้อมูลตัวอย่าง และ build ให้เอง (ประมาณ 2 นาที)

### 3. เข้าใช้งาน
- หน้าสาธารณะเปิดได้ทันทีที่ URL ที่ Vercel ให้
- ผู้ดูแลระบบ: ชื่อผู้ใช้ `admin` + `INITIAL_PASSWORD`
- ครู: รหัสบุคลากร `PT-001` ถึง `PT-022` + `INITIAL_PASSWORD`
- ทุกบัญชีถูกบังคับให้เปลี่ยนรหัสผ่านตอนเข้าครั้งแรก

## พัฒนาในเครื่อง

```bash
cp .env.example .env   # ใส่ DATABASE_URL ของ MySQL/TiDB, AUTH_SECRET, INITIAL_PASSWORD
npm install
npm run db:push && npm run db:seed
npm run dev
npm test               # ทดสอบตัวตรวจเงื่อนไขและตัวจัดตาราง
```

## สิ่งที่ยังไม่ได้ทำ (เฟสถัดไปตามสเปก)
- แยกตัวจัดตารางไป Worker (ตอนนี้รันใน API route ใช้เวลาไม่ถึง 1 วินาทีกับข้อมูลตัวอย่าง) และขั้น GA
- AI ถาม-ตอบด้วย Google Gemini + TiDB Vector (ตอนนี้ตอบด้วยกฎในหน้าเว็บ)
- Export PDF/Excel, แจ้งเตือนทางอีเมลและ LINE OA (ตอนนี้บันทึกแจ้งเตือนในระบบ)
- Backup อัตโนมัติ, 2FA สำหรับแอดมิน, หน้ารีเซ็ตรหัสผ่านครู
- การ migrate ใช้ `prisma db push`; เมื่อมีข้อมูลจริงควรเปลี่ยนเป็น `prisma migrate deploy`
