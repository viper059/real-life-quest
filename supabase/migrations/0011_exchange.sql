-- Real-life Quest — bring credits from the owner's other apps (ปักหมุด/feedTH, ส่งด่วน, …) into RLQ Gold.
-- One way only: partner credit → Gold. Gold never goes back out, so there is no loop to farm and nothing is cashed out.
-- Flow
--   1. In RLQ the player makes a one-time link code (10 minutes).
--   2. In the partner app they type it; the partner's server calls the RLQ `exchange` edge function (HMAC-signed)
--      to link their partner account to the RLQ account.
--   3. To exchange, the partner app burns its own credit first, then calls `exchange` with a unique reference.
--      RLQ credits Gold exactly once per (partner, reference); a refused call tells the partner to refund.
-- Rates and daily caps are set by RLQ staff per partner (imported Gold is new money, so caps keep inflation in check).

create table public.exchange_partners (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null,
  unit_name text not null,
  gold_per_unit numeric(12,4) check (gold_per_unit > 0),
  daily_cap_gold int not null default 1000 check (daily_cap_gold > 0),
  active boolean not null default false,
  sort int not null default 0
);
insert into public.exchange_partners (id, name, unit_name, gold_per_unit, daily_cap_gold, active, sort) values
  -- Owner's rates: 1 credit / 1 baht of top-up = 5 Gold. Opened from the back office once each partner is wired up.
  ('feedth',   'ปักหมุด (feedTH)', 'เครดิต',            5, 5000,  false, 1),
  ('songduan', 'ส่งด่วน',          'บาท (ยอดเงินที่เติม)', 5, 25000, false, 2);

-- Gold sells at the same rate (1 baht = 5 G) so no route is cheaper than another.
update public.app_settings set value = '0.2' where key = 'gold_thb_rate' and coalesce(value, '') = '';

create table public.exchange_links (
  user_id uuid not null references public.profiles(id) on delete cascade,
  partner_id text not null references public.exchange_partners(id),
  code_hash text,
  code_expires timestamptz,
  partner_user text,
  linked_at timestamptz,
  primary key (user_id, partner_id),
  unique (partner_id, partner_user)
);
create index exchange_links_code_idx on public.exchange_links (partner_id, code_hash);

create table public.exchange_in (
  id bigint generated always as identity primary key,
  partner_id text not null references public.exchange_partners(id),
  partner_ref text not null check (char_length(partner_ref) between 4 and 100),
  user_id uuid not null references public.profiles(id),
  units numeric(14,2) not null check (units > 0),
  gold bigint not null check (gold > 0),
  created_at timestamptz not null default now(),
  unique (partner_id, partner_ref)
);
create index exchange_in_user_idx on public.exchange_in (user_id, created_at);

alter table public.exchange_partners enable row level security;
alter table public.exchange_links enable row level security;
alter table public.exchange_in enable row level security;
create policy "partners readable" on public.exchange_partners for select to authenticated using (true);
create policy "own links" on public.exchange_links for select to authenticated using (user_id = (select auth.uid()));
create policy "own exchanges" on public.exchange_in for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('m.ledger', 'view'));
revoke insert, update, truncate on public.exchange_partners, public.exchange_links, public.exchange_in from anon, authenticated;
-- The link-code hash is never readable by the client.
revoke select on public.exchange_links from anon, authenticated;
grant select (user_id, partner_id, code_expires, partner_user, linked_at) on public.exchange_links to authenticated;

-- ---------- player ----------
create function public.create_link_code(p_partner text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_uid uuid := public._assert_active(); v_code text;
begin
  if not exists (select 1 from exchange_partners where id = p_partner and active) then raise exception 'partner not open'; end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into exchange_links (user_id, partner_id, code_hash, code_expires)
  values (v_uid, p_partner, md5(p_partner || ':' || v_code), now() + interval '10 minutes')
  on conflict (user_id, partner_id) do update set code_hash = excluded.code_hash, code_expires = excluded.code_expires;
  return v_code;
end $$;

create function public.unlink_partner(p_partner text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active();
begin
  update exchange_links set partner_user = null, linked_at = null, code_hash = null, code_expires = null
   where user_id = v_uid and partner_id = p_partner;
end $$;

create function public.set_exchange_partner(p_id text, p_rate numeric, p_cap int, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('m.rate') then raise exception 'forbidden'; end if;
  if p_active and (p_rate is null or p_rate <= 0) then raise exception 'set a rate before opening'; end if;
  update exchange_partners set gold_per_unit = p_rate, daily_cap_gold = p_cap, active = p_active where id = p_id;
  if not found then raise exception 'partner not found'; end if;
  perform _audit('exchange.partner', 'exchange_partner', p_id, jsonb_build_object('rate', p_rate, 'cap', p_cap, 'active', p_active));
end $$;

-- ---------- partner servers (called only by the `exchange` edge function with the service role) ----------
create function public.svc_link_account(p_partner text, p_code text, p_partner_user text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l exchange_links%rowtype;
begin
  if p_partner_user is null or char_length(p_partner_user) not between 1 and 100 then raise exception 'bad partner user'; end if;
  select * into l from exchange_links
   where partner_id = p_partner and code_hash = md5(p_partner || ':' || upper(trim(coalesce(p_code, '')))) for update;
  if not found or l.code_expires < now() then raise exception 'code invalid or expired'; end if;
  -- one partner account can belong to only one RLQ account
  update exchange_links set partner_user = null, linked_at = null where partner_id = p_partner and partner_user = p_partner_user;
  update exchange_links set partner_user = p_partner_user, linked_at = now(), code_hash = null, code_expires = null
   where user_id = l.user_id and partner_id = p_partner;
  perform _notify(l.user_id, 'money', 'เชื่อมบัญชี ' || (select name from exchange_partners where id = p_partner) || ' แล้ว',
                  'แลกเครดิตเป็น Gold ได้จากแอปนั้น', 'index.html#wallet');
  return jsonb_build_object('linked', true, 'username', (select username from profiles where id = l.user_id));
end $$;

create function public.svc_exchange_in(p_partner text, p_ref text, p_partner_user text, p_units numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p exchange_partners%rowtype; v_user uuid; v_gold bigint; v_today bigint; prev exchange_in%rowtype;
begin
  -- same reference again → same answer, never a second credit
  select * into prev from exchange_in where partner_id = p_partner and partner_ref = p_ref;
  if found then return jsonb_build_object('gold', prev.gold, 'duplicate', true); end if;
  select * into p from exchange_partners where id = p_partner;
  if not found or not p.active or p.gold_per_unit is null then raise exception 'partner not open'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad amount'; end if;
  select user_id into v_user from exchange_links where partner_id = p_partner and partner_user = p_partner_user;
  if v_user is null then raise exception 'account not linked'; end if;
  if exists (select 1 from profiles where id = v_user and banned_until > now()) then raise exception 'account banned'; end if;
  v_gold := floor(p_units * p.gold_per_unit);
  if v_gold < 1 then raise exception 'amount too small'; end if;
  perform 1 from profiles where id = v_user for update;
  select coalesce(sum(gold), 0) into v_today from exchange_in
   where user_id = v_user and partner_id = p_partner and created_at >= date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  if v_today + v_gold > p.daily_cap_gold then raise exception 'daily exchange cap reached'; end if;
  insert into exchange_in (partner_id, partner_ref, user_id, units, gold) values (p_partner, p_ref, v_user, p_units, v_gold);
  update wallets set gold = gold + v_gold, updated_at = now() where user_id = v_user;
  perform _ledger(v_user, 'exchange_in', v_gold, 0, null, null, p.name || ' ' || p_units || ' ' || p.unit_name);
  perform _notify(v_user, 'money', 'ได้รับ ' || v_gold || ' G จาก ' || p.name, p_units || ' ' || p.unit_name, 'index.html#wallet');
  return jsonb_build_object('gold', v_gold, 'duplicate', false);
end $$;

revoke execute on function public.svc_link_account(text, text, text), public.svc_exchange_in(text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.svc_link_account(text, text, text), public.svc_exchange_in(text, text, text, numeric) to service_role;
revoke execute on function public.create_link_code(text), public.unlink_partner(text), public.set_exchange_partner(text, numeric, int, boolean) from public, anon;
grant execute on function public.create_link_code(text), public.unlink_partner(text), public.set_exchange_partner(text, numeric, int, boolean) to authenticated;
