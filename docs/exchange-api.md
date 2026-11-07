# แลกเครดิตจากแอปอื่นเป็น Gold ของ Real-life Quest

ทางเดียว: เครดิตแอปพาร์ทเนอร์ → Gold ของ RLQ (Gold แลกกลับไม่ได้ ถอนไม่ได้)

## ตั้งค่า (ครั้งเดียวต่อพาร์ทเนอร์)

1. RLQ: ตั้ง secret ของ edge function `exchange` เช่น `EXCHANGE_SECRET_FEEDTH=<สุ่มยาว 32+ ตัว>`
2. แอปพาร์ทเนอร์: เก็บ secret เดียวกันไว้ฝั่งเซิร์ฟเวอร์เท่านั้น (edge function / Cloudflare Worker) ห้ามอยู่ในหน้าเว็บ
3. หลังบ้าน RLQ › ตั้งค่าเศรษฐกิจ › แลกเครดิตจากแอปอื่น: ใส่อัตรา (Gold ต่อ 1 เครดิต) วงเงินต่อวัน แล้วเปิด

## เชื่อมบัญชี

1. ผู้ใช้กด "สร้างรหัสเชื่อมบัญชี" ในกระเป๋า RLQ ได้รหัส 8 ตัว ใช้ได้ 10 นาที
2. ผู้ใช้กรอกรหัสในแอปพาร์ทเนอร์ แล้วเซิร์ฟเวอร์พาร์ทเนอร์เรียก:

```
POST https://hkujzoluicokvvwlnffd.supabase.co/functions/v1/exchange
x-signature: hex(HMAC-SHA256(secret, rawBody))
{"partner":"feedth","ts":1762480000,"action":"link","code":"AB12CD34","partner_user":"<user id ฝั่งพาร์ทเนอร์>"}
→ 200 {"linked":true,"username":"somchai"}
```

## แลก

ฝั่งพาร์ทเนอร์ต้อง **หักเครดิตก่อน** (ใน transaction เดียวกับสร้าง `ref` ไม่ซ้ำ) แล้วค่อยเรียก:

```
{"partner":"feedth","ts":...,"action":"exchange","ref":"<id รายการ ไม่ซ้ำ>","partner_user":"...","units":300}
→ 200 {"gold":150,"duplicate":false}
→ 422 {"error":"daily exchange cap reached","refund":true}   ← คืนเครดิตให้ผู้ใช้
```

- เรียกซ้ำด้วย `ref` เดิมได้อย่างปลอดภัย (เช่นเน็ตหลุด) ได้ผลเดิม ไม่จ่ายซ้ำ
- ตอบ 422 = RLQ ไม่รับ ต้องคืนเครดิต · เชื่อมไม่ได้/ผิดพลาดเครือข่าย = ลองใหม่ด้วย `ref` เดิม
- `ts` ต้องห่างเวลาจริงไม่เกิน 5 นาที

## ตัวอย่างฝั่งพาร์ทเนอร์ (Deno / Supabase edge function)

```ts
const body = JSON.stringify({ partner: "feedth", ts: Math.floor(Date.now() / 1000), action: "exchange", ref, partner_user: userId, units });
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("RLQ_EXCHANGE_SECRET")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const res = await fetch("https://hkujzoluicokvvwlnffd.supabase.co/functions/v1/exchange", { method: "POST", headers: { "x-signature": sig, "Content-Type": "application/json" }, body });
```

## กันเงินเฟ้อ

Gold ที่แลกเข้ามาเป็นเงินใหม่ในระบบ จึงมีวงเงินต่อวันต่อคนต่อพาร์ทเนอร์ ควรให้แลกเฉพาะเครดิตที่ผู้ใช้ซื้อด้วยเงินจริง หรือถ้าเป็นแต้มที่ได้ฟรีให้ตั้งอัตราต่ำ
