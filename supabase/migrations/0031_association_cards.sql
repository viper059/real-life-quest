-- การ์ดสมาคม: สมาคมวิชาชีพ (คนควบคุมที่ถือตำแหน่งของอาชีพนั้น) ซื้อการ์ดจากระบบด้วย Gold ส่วนตัว
-- แล้วนำไปตั้งเป็นรางวัลเควสต์ ผู้ทำสำเร็จได้การ์ดเข้าคลัง · ซื้อ/สุ่มโดยผู้เล่นทั่วไปไม่ได้
-- source 'special' เปลี่ยนเป็น 'association' · 'boss' ยังเป็นของเกม (แจกผ่าน svc_grant_card)
alter table public.job_cards drop constraint job_cards_source_check;
update public.job_cards set source = 'association' where source = 'special';
alter table public.job_cards add constraint job_cards_source_check
  check (source in ('start', 'draw', 'mission', 'shop', 'association', 'boss'));
alter table public.job_cards add column assoc_occupation text references public.occupations(id);
alter table public.job_cards add constraint job_cards_assoc_chk check (source <> 'association' or assoc_occupation is not null);

alter table public.card_grants drop constraint card_grants_source_check;
alter table public.card_grants add constraint card_grants_source_check check (source in ('association', 'boss'));

create or replace function public.svc_grant_card(p_partner text, p_partner_user text, p_card text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p exchange_partners%rowtype; v_user uuid; prev card_grants%rowtype;
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
  if not exists (select 1 from job_cards where id = p_card and source = 'boss') then raise exception 'card not grantable'; end if;
  return public._grant_card(v_user, p_card, 'boss', p_partner, p_ref, 'จาก ' || p.name);
end $$;

-- สต็อกการ์ดสมาคมของคนควบคุม
create table public.association_cards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id text not null references public.job_cards(id),
  qty int not null default 0 check (qty >= 0),
  primary key (user_id, card_id)
);
alter table public.association_cards enable row level security;
create policy assoc_cards_own on public.association_cards for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.association_cards from anon, authenticated;

alter table public.quests add column reward_card text references public.job_cards(id);
alter table public.quests add column card_settled boolean not null default false;

create function public._holds_license(p_user uuid, p_occ text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_licenses where user_id = p_user and occupation_id = p_occ and revoked_at is null) $$;
revoke execute on function public._holds_license(uuid, text) from public, anon, authenticated;

create function public.buy_assoc_card(p_card text, p_qty int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); c job_cards%rowtype; v_price int; v_total bigint;
begin
  if p_qty is null or p_qty not between 1 and 20 then raise exception 'bad quantity'; end if;
  perform 1 from profiles where id = v_uid for update;
  select * into c from job_cards where id = p_card and source = 'association';
  if not found then raise exception 'card not for sale'; end if;
  if not _holds_license(v_uid, c.assoc_occupation) then raise exception 'not association controller'; end if;
  v_price := coalesce(c.shop_price, (select shop_price from card_rarity_cfg where rarity = c.rarity));
  if v_price is null then raise exception 'card not for sale'; end if;
  v_total := v_price::bigint * p_qty;
  update wallets set gold = gold - v_total, updated_at = now() where user_id = v_uid and gold >= v_total;
  if not found then raise exception 'not enough gold'; end if;
  perform _ledger(v_uid, 'card_buy', -v_total, 0, null, null, 'การ์ดสมาคม ' || c.name || ' x' || p_qty);
  insert into association_cards (user_id, card_id, qty) values (v_uid, c.id, p_qty)
    on conflict (user_id, card_id) do update set qty = association_cards.qty + p_qty;
  return jsonb_build_object('card', c.id, 'name', c.name, 'qty', p_qty, 'paid', v_total);
end $$;
grant execute on function public.buy_assoc_card(text, int) to authenticated;
revoke execute on function public.buy_assoc_card(text, int) from anon, public;

-- ตั้งการ์ดเป็นรางวัลเควสต์ (ล็อกการ์ดจากสต็อกทันที) ทำได้ตอนเควสต์ยังเปิดอยู่และยังไม่มีการ์ด
create function public.attach_quest_card(p_quest uuid, p_card text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> v_uid then raise exception 'quest not found'; end if;
  if q.status <> 'open' or q.reward_card is not null then raise exception 'cannot attach card'; end if;
  update association_cards set qty = qty - 1 where user_id = v_uid and card_id = p_card and qty >= 1;
  if not found then raise exception 'no card in stock'; end if;
  update quests set reward_card = p_card, updated_at = now() where id = p_quest;
end $$;
grant execute on function public.attach_quest_card(uuid, text) to authenticated;
revoke execute on function public.attach_quest_card(uuid, text) from anon, public;

-- ตอนเควสต์จบ: สำเร็จ → การ์ดไปที่ผู้รับงาน (ถ้ามีอยู่แล้ว คืนสต็อกผู้โพสต์) · ยกเลิก → คืนสต็อกผู้โพสต์
-- ใช้ trigger เพื่อให้ครอบคลุมทุกทางที่เควสต์ปิดจบ (ยืนยัน ข้อพิพาท ยกเลิก)
create function public._quest_card_settle() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reward_card is null or new.card_settled or new.status = old.status then return new; end if;
  if new.status = 'completed' and new.worker_id is not null then
    if exists (select 1 from user_cards where user_id = new.worker_id and card_id = new.reward_card) then
      insert into association_cards (user_id, card_id, qty) values (new.poster_id, new.reward_card, 1)
        on conflict (user_id, card_id) do update set qty = association_cards.qty + 1;
      perform _notify(new.poster_id, 'quest', 'การ์ดรางวัลคืนเข้าสต็อก', 'ผู้รับงานมีการ์ดใบนี้อยู่แล้ว', 'index.html#deck');
    else
      perform _grant_card(new.worker_id, new.reward_card, 'association', null, 'quest:' || new.id, 'รางวัลภารกิจสมาคม');
    end if;
    new.card_settled := true;
  elsif new.status = 'cancelled' then
    insert into association_cards (user_id, card_id, qty) values (new.poster_id, new.reward_card, 1)
      on conflict (user_id, card_id) do update set qty = association_cards.qty + 1;
    new.card_settled := true;
  end if;
  return new;
end $$;
create trigger quest_card_settle before update of status on public.quests
  for each row execute function public._quest_card_settle();
