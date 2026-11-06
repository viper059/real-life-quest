// send-push: called by the database (notifications_push trigger) with { id } of a new notification.
// Sends it as a Web Push to every active subscription of that user and switches off dead endpoints.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SECRET (same value as private.secrets 'push_secret').
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUSH_SECRET = Deno.env.get("PUSH_SECRET") ?? "";

webpush.setVapidDetails(
  "mailto:support@real-life-quest.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST" || !PUSH_SECRET || req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return new Response("missing id", { status: 400 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: n } = await db.from("notifications").select("user_id, title, body, link").eq("id", id).single();
  if (!n) return new Response("not found", { status: 404 });
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth")
    .eq("user_id", n.user_id).eq("active", true);

  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", link: n.link ?? "index.html" });
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").update({ active: false }).eq("id", s.id);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
