# ต่อระบบแลก ส่งด่วน → Gold ของ Real-life Quest

ส่งเอกสารนี้ให้แชตที่ทำแอป ส่งด่วน ทำต่อได้เลย

## กติกาของแอปนี้

- แลกได้จาก **ยอดเงินที่ผู้ใช้เติม** เท่านั้น
- ยอดที่ถูกแลกออกต้องมีรายงานรายเดือนแยกตามจังหวัด เพราะเงินจริงอยู่กับแอดมินจังหวัด ใช้กระทบยอดตอนส่งส่วนแบ่ง

## ระบบฝั่ง Real-life Quest (ทำเสร็จแล้ว ไม่ต้องแก้)

- Endpoint: `POST https://hkujzoluicokvvwlnffd.supabase.co/functions/v1/exchange`
- Header `x-signature` = hex ของ HMAC-SHA256(secret, raw body) · `Content-Type: application/json`
- Secret ของแอปนี้: ตั้งค่าเดียวกันทั้งสองฝั่ง — ฝั่ง RLQ ชื่อ `EXCHANGE_SECRET_SONGDUAN` ฝั่งแอปนี้ตั้งชื่อ `RLQ_EXCHANGE_SECRET` (สุ่มยาว 32+ ตัว เก็บฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามอยู่ในโค้ดหน้าเว็บ)
- `ts` = unix วินาที ห่างเวลาจริงไม่เกิน 5 นาที
- แลกได้ทางเดียว: บาท (ยอดเงินที่เติม) ของแอปนี้ → Gold ของ RLQ · **อัตรา 1 บาท (ยอดเงินที่เติม) = 5 Gold** · วงเงิน 25,000 G ต่อคนต่อวัน (ฝั่ง RLQ ตรวจเอง)

**เชื่อมบัญชี** (ผู้ใช้เอารหัส 8 ตัวจากหน้ากระเป๋า RLQ มากรอก)
```json
{"partner":"songduan","ts":1762480000,"action":"link","code":"AB12CD34","partner_user":"<user id ของแอปนี้>"}
```
→ `200 {"linked":true,"username":"<ชื่อใน RLQ>"}` · `422 {"error":"code invalid or expired"}`

**แลก**
```json
{"partner":"songduan","ts":1762480000,"action":"exchange","ref":"<id รายการ ไม่ซ้ำ>","partner_user":"<user id>","units":100}
```
→ `200 {"gold":500,"duplicate":false}` · `422 {"error":"...","refund":true}` = RLQ ไม่รับ ต้องคืนยอดให้ผู้ใช้

## สิ่งที่ต้องทำในแอปนี้

1. **ตาราง** `rlq_links (user_id pk, rlq_username, linked_at)` และ `rlq_exchanges (id uuid pk, user_id, units, gold, status 'pending'|'done'|'refunded', error, created_at)` เปิด RLS ให้เห็นเฉพาะของตัวเอง เขียนผ่านฟังก์ชันฝั่งเซิร์ฟเวอร์เท่านั้น
2. **ฟังก์ชันฝั่งเซิร์ฟเวอร์** (Supabase edge function หรือ Worker) ชื่อ `rlq-exchange` ตรวจผู้ใช้จาก JWT แล้ว:
   - `link(code)`: ส่ง action link ไป RLQ ถ้าสำเร็จบันทึก `rlq_links`
   - `exchange(units)`:
     1. ใน transaction เดียว: ตรวจยอด ยอดเงินที่เติม พอ → หักยอด → สร้างแถว `rlq_exchanges` status pending (ใช้ id แถวเป็น `ref`)
     2. เรียก RLQ action exchange ด้วย ref นั้น
     3. 200 → status done, เก็บ gold · 422 → คืนยอด ยอดเงินที่เติม และ status refunded พร้อม error · เน็ตหลุด/5xx → ปล่อย pending ไว้ แล้วลองใหม่ด้วย ref เดิม (RLQ ไม่จ่ายซ้ำ)
3. **หน้าจอ** "แลกเป็น Gold ของ Real-life Quest":
   - ยังไม่เชื่อม: ช่องกรอกรหัส 8 ตัว + ปุ่มเชื่อม + คำอธิบาย "สร้างรหัสที่กระเป๋าในแอป Real-life Quest"
   - เชื่อมแล้ว: แสดงชื่อ RLQ, ช่องจำนวน บาท (ยอดเงินที่เติม), แสดงผล "= X Gold" (×5), ปุ่มแลก, ประวัติการแลก
   - ข้อความเตือน: "แลกแล้วเปลี่ยนกลับไม่ได้ · Gold ถอนเป็นเงินไม่ได้"
4. แจ้งเจ้าของเมื่อเสร็จ เพื่อตั้ง secret ฝั่ง RLQ และเปิดการแลกในหลังบ้าน RLQ
