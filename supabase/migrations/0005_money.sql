-- Real-life Quest — money: buying Gold and Crystal with PromptPay (confirmed by finance),
-- Crystal gifting, the Crystal shop, and identity-checked withdrawals.
--   Gold    = real money. Earned from work, bought to pay for work, withdrawable.
--   Crystal = bought from the platform. Can be given to family or anyone, never withdrawn, spent in the shop.

insert into public.app_settings (key, value) values
  ('crystal_thb_rate', ''),
  ('promptpay_id', ''),
  ('promptpay_name', ''),
  ('topup_min_thb', '20'),
  ('crystal_daily_transfer_max', '5000'),
  ('personal_exp_cap', '100')
on conflict (key) do nothing;

create or replace function public.set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v text := trim(coalesce(p_value, ''));
begin
  if not has_perm('m.rate') then raise exception 'forbidden'; end if;
  if p_key in ('gold_thb_rate', 'crystal_thb_rate') then
    if v <> '' and v !~ '^[0-9]{1,6}(\.[0-9]{1,4})?$' then raise exception 'bad rate'; end if;
  elsif p_key = 'promptpay_id' then
    if v <> '' and v !~ '^([0-9]{10}|[0-9]{13})$' then raise exception 'promptpay must be a 10-digit phone or 13-digit ID'; end if;
  elsif p_key = 'promptpay_name' then
    if char_length(v) > 100 then raise exception 'name too long'; end if;
  elsif p_key in ('signup_bonus_gold','review_reward_threshold','withdraw_min_gold','withdraw_dual_threshold',
                  'platform_fee_pct','auto_release_hours','checkin_radius_m','topup_min_thb',
                  'crystal_daily_transfer_max','personal_exp_cap') then
    if v !~ '^[0-9]{1,12}$' then raise exception 'must be a whole number'; end if;
    if p_key = 'platform_fee_pct' and v::int > 30 then raise exception 'fee must be 0-30%%'; end if;
    if p_key = 'auto_release_hours' and v::int not between 12 and 336 then raise exception 'auto release must be 12-336 hours'; end if;
    if p_key = 'checkin_radius_m' and v::int not between 50 and 5000 then raise exception 'radius must be 50-5000 m'; end if;
  else
    raise exception 'unknown setting';
  end if;
  update app_settings set value = v, updated_at = now() where key = p_key;
  perform _audit('setting.set', 'setting', p_key, jsonb_build_object('value', v));
end $$;

create function public._ledger_c(p_user uuid, p_kind text, p_crystal bigint, p_note text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.transactions (user_id, kind, crystal_delta, note) values (p_user, p_kind, p_crystal, p_note);
$$;

-- ---------- buying Gold and Crystal ----------
create table public.topup_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  currency text not null check (currency in ('gold','crystal')),
  units bigint not null check (units > 0),
  amount_thb numeric(12,2) not null check (amount_thb > 0),
  ref_code text not null unique,
  status text not null default 'pending' check (status in ('pending','notified','paid','rejected','cancelled')),
  slip_path text,
  note text,
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  decided_at timestamptz
);
create index topup_orders_status_idx on public.topup_orders (status, created_at);
create index topup_orders_user_idx on public.topup_orders (user_id, created_at desc);
create index topup_orders_decided_by_idx on public.topup_orders (decided_by);

create function public.create_topup(p_currency text, p_units bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  v_rate numeric;
  v_amount numeric(12,2);
  v_pp text := (select value from app_settings where key = 'promptpay_id');
  o topup_orders%rowtype;
begin
  if p_currency not in ('gold','crystal') then raise exception 'bad currency'; end if;
  v_rate := nullif((select value from app_settings where key = p_currency || '_thb_rate'), '')::numeric;
  if v_rate is null or v_rate <= 0 or coalesce(v_pp, '') = '' then raise exception 'top-up not open yet'; end if;
  if p_units is null or p_units <= 0 then raise exception 'amount must be positive'; end if;
  v_amount := round(p_units * v_rate, 2);
  if v_amount < _setting_int('topup_min_thb', 20) then raise exception 'below minimum top-up'; end if;
  if v_amount > 50000 then raise exception 'above maximum top-up'; end if;
  if (select count(*) from topup_orders where user_id = v_uid and status in ('pending','notified')) >= 3 then
    raise exception 'too many open orders';
  end if;
  insert into topup_orders (user_id, currency, units, amount_thb, ref_code)
  values (v_uid, p_currency, p_units, v_amount, upper(substr(md5(gen_random_uuid()::text), 1, 6)))
  returning * into o;
  return jsonb_build_object('id', o.id, 'currency', o.currency, 'units', o.units, 'amount_thb', o.amount_thb,
    'ref_code', o.ref_code, 'promptpay_id', v_pp,
    'promptpay_name', (select value from app_settings where key = 'promptpay_name'));
end $$;

create function public.notify_topup_paid(p_order uuid, p_slip_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); o topup_orders%rowtype;
begin
  select * into o from topup_orders where id = p_order for update;
  if not found or o.user_id <> v_uid or o.status <> 'pending' then raise exception 'order not pending'; end if;
  if p_slip_path is null or split_part(p_slip_path, '/', 1) <> v_uid::text then raise exception 'slip required'; end if;
  update topup_orders set status = 'notified', slip_path = p_slip_path, notified_at = now() where id = o.id;
  perform _notify_perm('m.topup', 'money', 'มีการแจ้งโอนเติม ' || case o.currency when 'gold' then 'Gold' else 'Crystal' end,
    o.amount_thb || ' บาท · ' || o.ref_code, 'admin.html#topups');
end $$;

create function public.cancel_topup(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update topup_orders set status = 'cancelled' where id = p_order and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'order not pending'; end if;
end $$;

create function public.decide_topup(p_order uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare o topup_orders%rowtype;
begin
  if not has_perm('m.topup') then raise exception 'forbidden'; end if;
  select * into o from topup_orders where id = p_order for update;
  if not found or o.status not in ('pending','notified') then raise exception 'order not open'; end if;
  if o.user_id = auth.uid() then raise exception 'cannot decide your own order'; end if;
  update topup_orders set status = case when p_approve then 'paid' else 'rejected' end, note = p_note,
         decided_by = auth.uid(), decided_at = now() where id = o.id;
  if p_approve then
    if o.currency = 'gold' then
      update wallets set gold = gold + o.units, updated_at = now() where user_id = o.user_id;
      perform _ledger(o.user_id, 'topup_gold', o.units, 0, null, null, o.ref_code || ' · ' || o.amount_thb || ' บาท');
    else
      update wallets set crystal = crystal + o.units, updated_at = now() where user_id = o.user_id;
      perform _ledger_c(o.user_id, 'topup_crystal', o.units, o.ref_code || ' · ' || o.amount_thb || ' บาท');
    end if;
    perform _notify(o.user_id, 'money', 'เติม' || case o.currency when 'gold' then ' Gold ' else ' Crystal ' end || o.units || ' สำเร็จ',
      o.amount_thb || ' บาท', 'index.html#wallet');
  else
    perform _notify(o.user_id, 'money', 'การเติมเงินไม่ผ่าน', coalesce(p_note, 'ตรวจไม่พบยอดโอน'), 'index.html#wallet');
  end if;
  perform _audit('topup.' || case when p_approve then 'paid' else 'rejected' end, 'topup', o.id::text,
                 jsonb_build_object('currency', o.currency, 'units', o.units, 'thb', o.amount_thb, 'note', p_note));
end $$;

-- ---------- giving Crystal ----------
create function public.transfer_crystal(p_to_username text, p_amount bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); v_to uuid; v_today bigint;
begin
  select id into v_to from profiles where username = trim(p_to_username);
  if v_to is null then raise exception 'user not found'; end if;
  if v_to = v_uid then raise exception 'cannot send to yourself'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  select coalesce(-sum(crystal_delta), 0) into v_today from transactions
   where user_id = v_uid and kind = 'crystal_sent' and created_at > now() - interval '1 day';
  if v_today + p_amount > _setting_int('crystal_daily_transfer_max', 5000) then raise exception 'daily transfer limit reached'; end if;
  update wallets set crystal = crystal - p_amount, updated_at = now() where user_id = v_uid and crystal >= p_amount;
  if not found then raise exception 'not enough crystal'; end if;
  update wallets set crystal = crystal + p_amount, updated_at = now() where user_id = v_to;
  perform _ledger_c(v_uid, 'crystal_sent', -p_amount, '→ ' || trim(p_to_username) || coalesce(' · ' || left(p_note, 80), ''));
  perform _ledger_c(v_to, 'crystal_received', p_amount,
    '← ' || (select username from profiles where id = v_uid) || coalesce(' · ' || left(p_note, 80), ''));
  perform _notify(v_to, 'money', 'ได้รับ ' || p_amount || ' Crystal', coalesce(left(p_note, 80), ''), 'index.html#wallet');
end $$;

-- ---------- Crystal shop: looks, titles and conveniences; nothing that buys career progress ----------
alter table public.profiles
  add column title text,
  add column frame text,
  add column extra_personal_slots int not null default 0;

create table public.shop_items (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  kind text not null check (kind in ('frame','title','costume','boost')),
  slot text check (slot in ('head','body','feet','tool','acc')),
  price_crystal int not null check (price_crystal >= 0),
  description text check (char_length(description) <= 200),
  data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.shop_items (id, name, kind, slot, price_crystal, description, data, active, sort) values
  ('frame_brass', 'กรอบทองเหลือง', 'frame', null, 49, 'กรอบรูปโปรไฟล์ลายทองเหลือง', '{"color":"#c9a86a"}', true, 1),
  ('frame_jade', 'กรอบหยก', 'frame', null, 99, 'กรอบรูปโปรไฟล์สีหยก', '{"color":"#1f6f6b"}', true, 2),
  ('title_hardworker', 'ขยันไม่มีวันหยุด', 'title', null, 29, 'ฉายาแสดงใต้ชื่อ', '{}', true, 3),
  ('title_nightowl', 'นกฮูกยามดึก', 'title', null, 29, 'ฉายาแสดงใต้ชื่อ', '{}', true, 4),
  ('hat_straw', 'หมวกสาน', 'costume', 'head', 39, 'ชุดแต่งตัวละคร ช่องหมวก', '{}', true, 5),
  ('jacket_explorer', 'แจ็กเก็ตนักผจญภัย', 'costume', 'body', 79, 'ชุดแต่งตัวละคร ช่องเสื้อ', '{}', true, 6),
  ('boots_travel', 'รองเท้าบูทเดินทาง', 'costume', 'feet', 59, 'ชุดแต่งตัวละคร ช่องรองเท้า', '{}', true, 7),
  ('wrench_gold', 'ประแจทองคำ', 'costume', 'tool', 149, 'ของสะสม ช่องเครื่องมือ', '{}', true, 8),
  ('charm_luck', 'เครื่องรางนำโชค', 'costume', 'acc', 69, 'ของสะสม ช่องเครื่องประดับ', '{}', true, 9),
  ('boost_personal_slots', 'ช่องเควสต์ส่วนตัว +2', 'boost', null, 59, 'เพิ่มช่องเควสต์ส่วนตัวถาวร 2 ช่อง (ไม่เพิ่ม EXP สูงสุดต่อวัน)', '{"personal_slots":2}', true, 10),
  ('title_monthly_hero', 'วีรชนประจำเดือน', 'title', null, 0, 'ได้จากรางวัลสะสมประจำเดือน', '{}', false, 99);

create table public.user_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index user_items_item_idx on public.user_items (item_id);

create function public._give_item(p_user uuid, p_item text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare i shop_items%rowtype;
begin
  select * into i from shop_items where id = p_item;
  if not found then return false; end if;
  insert into user_items (user_id, item_id) values (p_user, p_item) on conflict do nothing;
  if not found then return false; end if;
  if i.kind = 'boost' and (i.data->>'personal_slots') is not null then
    update profiles set extra_personal_slots = extra_personal_slots + (i.data->>'personal_slots')::int where id = p_user;
  end if;
  return true;
end $$;

create function public.buy_item(p_item text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); i shop_items%rowtype;
begin
  select * into i from shop_items where id = p_item and active;
  if not found then raise exception 'item not available'; end if;
  if exists (select 1 from user_items where user_id = v_uid and item_id = p_item) then raise exception 'already owned'; end if;
  update wallets set crystal = crystal - i.price_crystal, updated_at = now() where user_id = v_uid and crystal >= i.price_crystal;
  if not found then raise exception 'not enough crystal'; end if;
  perform _give_item(v_uid, p_item);
  perform _ledger_c(v_uid, 'shop_buy', -i.price_crystal, i.name);
end $$;

create function public.equip_item(p_item text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); i shop_items%rowtype;
begin
  select s.* into i from shop_items s join user_items u on u.item_id = s.id where u.user_id = v_uid and s.id = p_item;
  if not found then raise exception 'item not owned'; end if;
  if i.kind = 'boost' then raise exception 'boosts are always on'; end if;
  if p_on then
    update user_items u set equipped = false from shop_items s
     where u.item_id = s.id and u.user_id = v_uid and s.kind = i.kind and s.slot is not distinct from i.slot;
  end if;
  update user_items set equipped = p_on where user_id = v_uid and item_id = p_item;
  if i.kind = 'title' then update profiles set title = case when p_on then i.name end where id = v_uid; end if;
  if i.kind = 'frame' then update profiles set frame = case when p_on then i.data->>'color' end where id = v_uid; end if;
end $$;

create function public.save_shop_item(p_id text, p_name text, p_kind text, p_slot text, p_price int,
                                      p_description text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('m.shop') then raise exception 'forbidden'; end if;
  insert into shop_items (id, name, kind, slot, price_crystal, description, active)
  values (p_id, p_name, p_kind, nullif(p_slot, ''), p_price, p_description, p_active)
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, slot = excluded.slot,
    price_crystal = excluded.price_crystal, description = excluded.description, active = excluded.active;
  perform _audit('shop.save', 'shop_item', p_id, jsonb_build_object('price', p_price, 'active', p_active));
end $$;

-- ---------- withdrawals now need a verified identity ----------
create or replace function public.request_withdrawal(p_amount bigint, p_bank_label text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_verified();
  v_min bigint := coalesce(nullif((select value from app_settings where key = 'withdraw_min_gold'), '')::bigint, 100);
  v_id uuid;
begin
  if p_amount is null or p_amount < v_min then raise exception 'below minimum withdrawal'; end if;
  update wallets set gold = gold - p_amount, gold_locked = gold_locked + p_amount, updated_at = now()
   where user_id = v_uid and gold >= p_amount;
  if not found then raise exception 'not enough gold'; end if;
  insert into withdrawals (user_id, amount_gold, bank_label) values (v_uid, p_amount, p_bank_label)
  returning id into v_id;
  perform _ledger(v_uid, 'withdraw_hold', -p_amount, p_amount, null, v_id);
  perform _notify_perm('m.withdraw', 'money', 'มีคำขอถอนเงินใหม่', p_amount || ' G', 'admin.html#withdrawals');
  return v_id;
end $$;

-- ---------- row level security ----------
alter table public.topup_orders enable row level security;
alter table public.shop_items enable row level security;
alter table public.user_items enable row level security;
revoke insert, update, truncate on public.topup_orders, public.shop_items, public.user_items from anon, authenticated;
revoke all on public.topup_orders, public.shop_items, public.user_items from anon;
create policy "own topups or topup staff" on public.topup_orders for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('m.topup', 'view'));
create policy "shop readable" on public.shop_items for select to authenticated using (active or public.has_perm('m.shop', 'view'));
create policy "items readable" on public.user_items for select to authenticated using (true);

revoke execute on function public._ledger_c(uuid, text, bigint, text), public._give_item(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_topup(text, bigint), public.notify_topup_paid(uuid, text), public.cancel_topup(uuid),
  public.decide_topup(uuid, boolean, text), public.transfer_crystal(text, bigint, text), public.buy_item(text),
  public.equip_item(text, boolean), public.save_shop_item(text, text, text, text, int, text, boolean) from public, anon;
grant execute on function public.create_topup(text, bigint), public.notify_topup_paid(uuid, text), public.cancel_topup(uuid),
  public.decide_topup(uuid, boolean, text), public.transfer_crystal(text, bigint, text), public.buy_item(text),
  public.equip_item(text, boolean), public.save_shop_item(text, text, text, text, int, text, boolean),
  public.request_withdrawal(bigint, text), public.set_setting(text, text) to authenticated;
