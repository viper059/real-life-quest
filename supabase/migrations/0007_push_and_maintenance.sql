-- Real-life Quest — web push for notifications, and a maintenance job every 10 minutes:
-- auto-pay submitted work nobody disputed, expire unfilled quests, close stale guild votes and top-up orders.

do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net not available: %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron not available: %', sqlerrm; end $$;

insert into public.app_settings (key, value) values
  ('vapid_public_key', 'BPxUEjOVm5LeotFS4fAMAfbcMBmTbrjV63o1wVR8k4EIvn0XFbe6IA3ZrYdwI94pPDEUTHltjxP1UNXgN5FwRHU'),
  ('push_function_url', 'https://hkujzoluicokvvwlnffd.supabase.co/functions/v1/send-push')
on conflict (key) do nothing;

-- Secrets the database needs but clients must never read. The schema is not exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.secrets (key text primary key, value text not null);
insert into private.secrets (key, value)
values ('push_secret', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
on conflict (key) do nothing;

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where active;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active();
begin
  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, active = true;
end $$;

create function public.disable_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$ update public.push_subscriptions set active = false where endpoint = p_endpoint and user_id = auth.uid(); $$;

-- Every new notification is handed to the send-push edge function. Failures never block the notification itself.
create function public._push_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_url text := (select value from app_settings where key = 'push_function_url'); v_secret text;
begin
  if coalesce(v_url, '') = '' or not exists (select 1 from push_subscriptions where user_id = new.user_id and active) then
    return new;
  end if;
  select value into v_secret from private.secrets where key = 'push_secret';
  begin
    perform net.http_post(url := v_url, body := jsonb_build_object('id', new.id),
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret));
  exception when others then null;
  end;
  return new;
end $$;

create trigger notifications_push after insert on public.notifications
  for each row execute function public._push_notify();

-- ---------- maintenance ----------
create function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_released int := 0; v_expired int := 0; v_claims int; v_orders int;
begin
  -- 1. submitted work the poster neither confirmed nor disputed in time is paid automatically
  for r in select id, poster_id, title from quests
            where status = 'submitted' and not dispute_open and auto_release_at < now() for update skip locked loop
    perform _settle(r.id, 100, 'auto release');
    perform _notify(r.poster_id, 'quest', 'ระบบปิดงานให้อัตโนมัติ — อย่าลืมจ่ายค่าจ้าง', r.title, 'index.html#quest-' || r.id);
    v_released := v_released + 1;
  end loop;
  -- 2. open quests nobody took before the due time go back to the poster
  for r in select * from quests where status = 'open' and due_at < now() for update skip locked loop
    if r.reward_gold > 0 then
      update wallets set gold = gold + r.reward_gold, gold_locked = gold_locked - r.reward_gold, updated_at = now() where user_id = r.poster_id;
      perform _ledger(r.poster_id, 'quest_refund', r.reward_gold, -r.reward_gold, r.id, null, 'expired');
    end if;
    update quests set status = 'cancelled', updated_at = now() where id = r.id;
    update quest_applications set status = 'rejected' where quest_id = r.id and status = 'pending';
    perform _notify(r.poster_id, 'quest', 'เควสต์หมดเวลา ไม่มีคนรับ', r.title, 'index.html#quest-' || r.id);
    v_expired := v_expired + 1;
  end loop;
  -- 3. guild claims whose vote window closed without a majority are rejected
  update guild_claims set status = 'rejected', decided_at = now() where status = 'voting' and closes_at < now();
  get diagnostics v_claims = row_count;
  -- 4. unpaid top-up orders older than two days are cancelled
  update topup_orders set status = 'cancelled' where status = 'pending' and created_at < now() - interval '2 days';
  get diagnostics v_orders = row_count;
  return jsonb_build_object('released', v_released, 'expired', v_expired, 'claims_closed', v_claims, 'orders_cancelled', v_orders);
end $$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('rlq-maintenance', '*/10 * * * *', 'select public.run_maintenance()');
  end if;
exception when others then raise notice 'could not schedule maintenance: %', sqlerrm;
end $$;

alter table public.push_subscriptions enable row level security;
revoke insert, update, truncate on public.push_subscriptions from anon, authenticated;
revoke all on public.push_subscriptions from anon;
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

revoke execute on function public._push_notify(), public.run_maintenance() from public, anon, authenticated;
revoke execute on function public.save_push_subscription(text, text, text), public.disable_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.disable_push_subscription(text) to authenticated;
