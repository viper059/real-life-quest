-- Real-life Quest — rarity tiers for items and gear (not job cards):
--   ธรรมดา · ไม่ธรรมดา · อีปิก · รีเจน · มิสติก · ซูเปอร์มิสติก · ดีวาย · สวรรค์
-- For now ordinary players can get up to Epic. Legend and above are defined but closed:
-- no item in those tiers can be on sale or handed out until the tier is opened (decided later).

create table public.rarity_tiers (
  id text primary key,
  ord int not null unique,
  label text not null,
  label_en text not null,
  color text not null,
  glow boolean not null default false,
  obtainable boolean not null default false
);
insert into public.rarity_tiers (id, ord, label, label_en, color, glow, obtainable) values
  ('common',       1, 'ธรรมดา',        'Common',       '#6b5540', false, true),
  ('uncommon',     2, 'ไม่ธรรมดา',     'Uncommon',     '#2e7d4f', false, true),
  ('epic',         3, 'อีปิก',          'Epic',         '#6a3fb5', true,  true),
  ('legend',       4, 'รีเจน',          'Legend',       '#c27a0e', true,  false),
  ('mythic',       5, 'มิสติก',         'Mythic',       '#b3261e', true,  false),
  ('super_mythic', 6, 'ซูเปอร์มิสติก',  'Super Mythic', '#c2185b', true,  false),
  ('divine',       7, 'ดีวาย',          'Divine',       '#1f8fb3', true,  false),
  ('heaven',       8, 'สวรรค์',         'Heaven',       '#e8b13a', true,  false);
alter table public.rarity_tiers enable row level security;
create policy "tiers readable" on public.rarity_tiers for select to authenticated using (true);
revoke insert, update, truncate on public.rarity_tiers from anon, authenticated;

-- ---------- items ----------
alter table public.shop_items add column tier text not null default 'common' references public.rarity_tiers(id);
create index shop_items_tier_idx on public.shop_items (tier);
update public.shop_items set tier = case id
  when 'frame_jade' then 'uncommon' when 'jacket_explorer' then 'uncommon' when 'boots_travel' then 'uncommon'
  when 'charm_luck' then 'uncommon' when 'boost_personal_slots' then 'uncommon'
  when 'wrench_gold' then 'epic' when 'title_monthly_hero' then 'epic' else 'common' end;
insert into public.shop_items (id, name, kind, slot, price, currency, stock, description, data, active, sort, tier) values
  ('frame_epic',    'กรอบอเมทิสต์',     'frame',   null,   199, 'crystal', 300, 'กรอบโปรไฟล์ระดับอีปิก รุ่นจำกัด', '{"color":"#6a3fb5"}', true, 11, 'epic'),
  ('cape_epic',     'ผ้าคลุมนักเดินทาง', 'costume', 'body', 249, 'crystal', 300, 'ชุดระดับอีปิก รุ่นจำกัด ช่องเสื้อ', '{}', true, 12, 'epic'),
  ('gloves_worker', 'ถุงมือช่าง',        'costume', 'tool', 490, 'gold', null, 'ของใช้ ช่องเครื่องมือ', '{}', true, 13, 'common'),
  ('bag_courier',   'กระเป๋าส่งของ',     'costume', 'acc',  890, 'gold', null, 'ของใช้ ช่องเครื่องประดับ', '{}', true, 14, 'uncommon');

-- An item in a closed tier can exist (staff may draft it) but cannot be on sale.
create or replace function public._guard_item_tier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.active and not (select obtainable from rarity_tiers where id = new.tier) then
    raise exception 'tier not open yet';
  end if;
  return new;
end $$;
create trigger shop_items_tier_guard before insert or update on public.shop_items
  for each row execute function public._guard_item_tier();

-- Rewards (monthly track, future events) must also respect closed tiers.
create or replace function public._give_item(p_user uuid, p_item text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare i shop_items%rowtype;
begin
  select * into i from shop_items where id = p_item;
  if not found then return false; end if;
  if not (select obtainable from rarity_tiers where id = i.tier) then raise exception 'tier not open yet'; end if;
  insert into user_items (user_id, item_id) values (p_user, p_item) on conflict do nothing;
  if not found then return false; end if;
  if i.kind = 'boost' and (i.data->>'personal_slots') is not null then
    update profiles set extra_personal_slots = extra_personal_slots + (i.data->>'personal_slots')::int where id = p_user;
  end if;
  return true;
end $$;

create or replace function public.set_shop_item_tier(p_id text, p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('m.shop') then raise exception 'forbidden'; end if;
  update shop_items set tier = p_tier where id = p_id;
  if not found then raise exception 'item not found'; end if;
  perform _audit('shop.tier', 'shop_item', p_id, jsonb_build_object('tier', p_tier));
end $$;

revoke execute on function public._guard_item_tier(), public._give_item(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_shop_item_tier(text, text) from public, anon;
grant execute on function public.set_shop_item_tier(text, text) to authenticated;

-- Owners still see items that are no longer on sale (rewards, retired items).
alter policy "shop readable" on public.shop_items
  using (active
         or exists (select 1 from public.user_items u where u.item_id = shop_items.id and u.user_id = (select auth.uid()))
         or public.has_perm('m.shop', 'view'));
