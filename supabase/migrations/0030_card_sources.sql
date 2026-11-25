-- ช่องทางได้การ์ด: draw (สุ่ม) · mission (ภารกิจของระบบ/งานจริง) · shop (ซื้อตรง = การ์ดกิลด์) · special (ภารกิจพิเศษ) · boss (ตู้บอสในเกม)
-- การ์ดสมาคมที่ "แจก" ได้เฉพาะ special/boss เท่านั้น ซื้อหรือสุ่มไม่ได้
alter table public.job_cards add column source text not null default 'mission'
  check (source in ('start', 'draw', 'mission', 'shop', 'special', 'boss'));
alter table public.job_cards add column shop_price int check (shop_price > 0);
update public.job_cards set source = 'start' where id = 'adventurer';
update public.job_cards set source = 'draw' where id in ('grit_n', 'grit_u', 'grit_e', 'grit_l');

-- ซื้อตรงได้เฉพาะการ์ดที่ source = 'shop' (การ์ดกิลด์) · ราคาเฉพาะใบ (shop_price) หรือราคาตามระดับ
create or replace function public.buy_card(p_card text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); c job_cards%rowtype; v_price int;
begin
  perform 1 from profiles where id = v_uid for update;
  select * into c from job_cards where id = p_card and source = 'shop';
  if not found then raise exception 'card not for sale'; end if;
  if exists (select 1 from user_cards where user_id = v_uid and card_id = c.id) then raise exception 'already owned'; end if;
  v_price := coalesce(c.shop_price, (select shop_price from card_rarity_cfg where rarity = c.rarity));
  if v_price is null then raise exception 'card not for sale'; end if;
  update wallets set gold = gold - v_price, updated_at = now() where user_id = v_uid and gold >= v_price;
  if not found then raise exception 'not enough gold'; end if;
  perform _ledger(v_uid, 'card_buy', -v_price, 0, null, null, c.name);
  insert into user_cards (user_id, card_id) values (v_uid, c.id);
  return jsonb_build_object('card', c.id, 'name', c.name, 'paid', v_price);
end $$;

-- บันทึกการแจกการ์ด (ภารกิจพิเศษ / ตู้บอส / เกม) กันแจกซ้ำด้วย (partner, ref)
create table public.card_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id text not null references public.job_cards(id),
  source text not null check (source in ('special', 'boss')),
  partner_id text references public.exchange_partners(id),
  ref text check (char_length(ref) between 4 and 100),
  note text,
  dupe boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index card_grants_ref on public.card_grants (coalesce(partner_id, ''), ref) where ref is not null;
create index card_grants_user on public.card_grants (user_id, id);
alter table public.card_grants enable row level security;
create policy card_grants_own on public.card_grants for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.card_grants from anon, authenticated;

-- ใช้ภายใน (ภารกิจพิเศษฝั่งเว็บ และ svc_grant_card ของเกมเรียกใช้) — ไม่เปิดให้ผู้เล่นเรียกเอง
create function public._grant_card(p_user uuid, p_card text, p_source text, p_partner text, p_ref text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c job_cards%rowtype; v_dupe boolean;
begin
  select * into c from job_cards where id = p_card and source = p_source;
  if not found then raise exception 'card not grantable'; end if;
  insert into user_cards (user_id, card_id) values (p_user, c.id) on conflict do nothing;
  v_dupe := not found;
  insert into card_grants (user_id, card_id, source, partner_id, ref, note, dupe) values (p_user, c.id, p_source, p_partner, p_ref, p_note, v_dupe);
  if not v_dupe then
    perform _notify(p_user, 'career', 'ได้การ์ดใหม่: ' || c.name, coalesce(p_note, 'ไปใส่ช่องการ์ดในหน้าเด็คได้เลย'), 'index.html#deck');
  end if;
  return jsonb_build_object('card', c.id, 'name', c.name, 'dupe', v_dupe, 'duplicate', false);
end $$;
revoke execute on function public._grant_card(uuid, text, text, text, text, text) from public, anon, authenticated;

-- เกม (หรือแอปพาร์ตเนอร์) แจกการ์ดผ่าน edge function `exchange` (action = grant_card) ที่เซ็น HMAC เท่านั้น
alter table public.exchange_partners add column can_grant_cards boolean not null default false;
insert into public.exchange_partners (id, name, unit_name, gold_per_unit, daily_cap_gold, active, sort, can_grant_cards)
values ('game', 'เกม Real-life Quest', 'หน่วย', null, 1000, false, 3, true) on conflict (id) do nothing;

create function public.svc_grant_card(p_partner text, p_partner_user text, p_card text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p exchange_partners%rowtype; v_user uuid; prev card_grants%rowtype; v_src text;
begin
  if p_ref is null or char_length(p_ref) not between 4 and 100 then raise exception 'bad ref'; end if;
  select * into prev from card_grants where partner_id = p_partner and ref = p_ref;
  if found then return jsonb_build_object('card', prev.card_id, 'dupe', prev.dupe, 'duplicate', true); end if;
  select * into p from exchange_partners where id = p_partner;
  if not found or not p.can_grant_cards then raise exception 'partner cannot grant cards'; end if;
  select user_id into v_user from exchange_links where partner_id = p_partner and partner_user = p_partner_user and linked_at is not null;
  if v_user is null then raise exception 'account not linked'; end if;
  if exists (select 1 from profiles where id = v_user and banned_until > now()) then raise exception 'account banned'; end if;
  perform 1 from profiles where id = v_user for update;
  select source into v_src from job_cards where id = p_card and source in ('special', 'boss');
  if v_src is null then raise exception 'card not grantable'; end if;
  return public._grant_card(v_user, p_card, v_src, p_partner, p_ref, 'จาก ' || p.name);
end $$;
revoke execute on function public.svc_grant_card(text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_grant_card(text, text, text, text) to service_role;
