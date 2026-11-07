// exchange: partner apps (ปักหมุด/feedTH, ส่งด่วน, …) link accounts and turn their credit into RLQ Gold.
// Each partner server signs the raw JSON body with its own secret: header x-signature = hex(HMAC-SHA256(secret, body)).
// Secrets: EXCHANGE_SECRET_<PARTNER ID IN CAPS>, e.g. EXCHANGE_SECRET_FEEDTH, EXCHANGE_SECRET_SONGDUAN.
// Body: { "partner": "feedth", "ts": <unix seconds>, "action": "link", "code": "AB12CD34", "partner_user": "<their user id>" }
//    or { "partner": "feedth", "ts": ..., "action": "exchange", "ref": "<unique id>", "partner_user": "...", "units": 300 }
// Deploy with verify_jwt = false (this function checks the signature itself).
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const enc = new TextEncoder();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const raw = await req.text();
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return json(400, { error: "bad json" }); }
  const partner = String(b.partner ?? "");
  if (!/^[a-z0-9_]{2,30}$/.test(partner)) return json(400, { error: "bad partner" });
  const secret = Deno.env.get("EXCHANGE_SECRET_" + partner.toUpperCase());
  if (!secret) return json(403, { error: "unknown partner" });
  if (!same(await hmacHex(secret, raw), (req.headers.get("x-signature") ?? "").toLowerCase())) return json(403, { error: "bad signature" });
  if (Math.abs(Date.now() / 1000 - Number(b.ts)) > 300) return json(403, { error: "stale request" });

  if (b.action === "link") {
    const { data, error } = await db.rpc("svc_link_account", { p_partner: partner, p_code: String(b.code ?? ""), p_partner_user: String(b.partner_user ?? "") });
    return error ? json(422, { error: error.message }) : json(200, data);
  }
  if (b.action === "exchange") {
    const { data, error } = await db.rpc("svc_exchange_in", {
      p_partner: partner, p_ref: String(b.ref ?? ""), p_partner_user: String(b.partner_user ?? ""), p_units: Number(b.units),
    });
    // 422 = refused: the partner must refund the credit it already took.
    return error ? json(422, { error: error.message, refund: true }) : json(200, data);
  }
  return json(400, { error: "unknown action" });
});
