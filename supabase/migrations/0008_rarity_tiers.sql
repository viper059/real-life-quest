-- Real-life Quest — eight rarity tiers for job cards and shop items:
--   ธรรมดา · ไม่ธรรมดา · อีปิก · รีเจน · มิสติก · ซูเปอร์มิสติก · ดีวาย · สวรรค์
-- The old N/R/SR/SSR column stays for older app versions; the app reads `tier`.
-- Mythic and above also need a real career rank in that trade, so the top cards come from years of work, never from money.
-- Divine and Heaven shop items cannot be bought: they are granted when a career reaches rank A or S.

create table public.rarity_tiers (
  id text primary key,
  ord int not null unique,
  label text not null,
  label_en text not null,
  color text not null,
  glow boolean not null default false
);
insert into public.rarity_tiers (id, ord, label, label_en, color, glow) values
  ('common',       1, 'ธรรมดา',        'Common',       '#6b5540', false),
  ('uncommon',     2, 'ไม่ธรรมดา',     'Uncommon',     '#2e7d4f', false),
  ('epic',         3, 'อีปิก',          'Epic',         '#6a3fb5', false),
  ('legend',       4, 'รีเจน',          'Legend',       '#c27a0e', true),
  ('mythic',       5, 'มิสติก',         'Mythic',       '#b3261e', true),
  ('super_mythic', 6, 'ซูเปอร์มิสติก',  'Super Mythic', '#c2185b', true),
  ('divine',       7, 'ดีวาย',          'Divine',       '#1f8fb3', true),
  ('heaven',       8, 'สวรรค์',         'Heaven',       '#e8b13a', true);
alter table public.rarity_tiers enable row level security;
create policy "tiers readable" on public.rarity_tiers for select to authenticated using (true);
revoke insert, update, truncate on public.rarity_tiers from anon, authenticated;

-- ---------- job cards ----------
alter table public.job_cards
  add column tier text not null default 'common' references public.rarity_tiers(id),
  add column min_career_rank text check (min_career_rank in ('F','E','D','C','B','A','S'));
update public.job_cards set tier = case rarity when 'N' then 'common' when 'R' then 'uncommon' when 'SR' then 'epic' else 'legend' end;
create index job_cards_tier_idx on public.job_cards (tier);

-- legacy rarity must satisfy the old check, so top tiers are stored as SSR there.
insert into public.job_cards (id, name, rarity, tier, category, unlock_count, exp_bonus_pct, stats, description, sort, min_career_rank) values
  ('electric_apprentice', 'ช่างไฟฝึกหัด',        'R',   'uncommon',     'electric', 3,    10, '{"dex":2,"int":1}',          'งานช่างไฟฟ้าสำเร็จ 3 ครั้ง', 11, null),
  ('electric_epic',       'นายช่างกระแสไฟ',      'SR',  'epic',         'electric', 15,   20, '{"dex":4,"int":3}',          'งานช่างไฟฟ้าสำเร็จ 15 ครั้ง', 12, null),
  ('tutor_legend',        'อาจารย์ใหญ่',          'SSR', 'legend',       'tutor',    40,   30, '{"int":8,"luk":3}',          'สอนพิเศษสำเร็จ 40 ครั้ง', 13, null),
  ('home_legend',         'เจ้าบ้านในตำนาน',      'SSR', 'legend',       'home',     40,   30, '{"vit":8,"dex":4}',          'งานบ้านสำเร็จ 40 ครั้ง', 14, null),
  ('courier_legend',      'ตำนานถนนสายด่วน',     'SSR', 'legend',       'delivery', 40,   30, '{"agi":9,"luk":3}',          'ส่งของสำเร็จ 40 ครั้ง', 15, null),
  -- mythic: rank C (senior) + 300 jobs
  ('home_mythic',     'ผู้คุมปราสาท',          'SSR', 'mythic', 'home',     300, 40, '{"vit":12,"dex":6}',  'งานบ้าน 300 งาน + ขั้นซีเนียร์ (C)', 20, 'C'),
  ('delivery_mythic', 'ผู้เดินทางข้ามแดน',     'SSR', 'mythic', 'delivery', 300, 40, '{"agi":13,"luk":5}',  'ส่งของ 300 งาน + ขั้นซีเนียร์ (C)', 21, 'C'),
  ('tutor_mythic',    'นักปราชญ์แห่งหอคอย',    'SSR', 'mythic', 'tutor',    300, 40, '{"int":13,"luk":5}',  'สอน 300 งาน + ขั้นซีเนียร์ (C)', 22, 'C'),
  ('repair_mythic',   'ช่างตีเหล็กมนตรา',      'SSR', 'mythic', 'repair',   300, 40, '{"dex":12,"str":7}',  'งานช่าง 300 งาน + ขั้นซีเนียร์ (C)', 23, 'C'),
  ('electric_mythic', 'จอมเวทสายฟ้า',          'SSR', 'mythic', 'electric', 300, 40, '{"dex":11,"int":8}',  'งานไฟฟ้า 300 งาน + ขั้นซีเนียร์ (C)', 24, 'C'),
  -- super mythic: rank B (lead) + 800 jobs
  ('home_super',     'ผู้พิทักษ์อาณาจักร',     'SSR', 'super_mythic', 'home',     800, 50, '{"vit":16,"dex":9}',  'งานบ้าน 800 งาน + ขั้นหัวหน้างาน (B)', 30, 'B'),
  ('delivery_super', 'วายุผู้ไร้พรมแดน',       'SSR', 'super_mythic', 'delivery', 800, 50, '{"agi":17,"luk":8}',  'ส่งของ 800 งาน + ขั้นหัวหน้างาน (B)', 31, 'B'),
  ('tutor_super',    'มหาปราชญ์',              'SSR', 'super_mythic', 'tutor',    800, 50, '{"int":17,"luk":8}',  'สอน 800 งาน + ขั้นหัวหน้างาน (B)', 32, 'B'),
  ('repair_super',   'ปรมาจารย์หลอมโลหะ',      'SSR', 'super_mythic', 'repair',   800, 50, '{"dex":16,"str":10}', 'งานช่าง 800 งาน + ขั้นหัวหน้างาน (B)', 33, 'B'),
  ('electric_super', 'จ้าวแห่งพายุฟ้า',         'SSR', 'super_mythic', 'electric', 800, 50, '{"dex":15,"int":11}', 'งานไฟฟ้า 800 งาน + ขั้นหัวหน้างาน (B)', 34, 'B'),
  -- divine: rank A (expert) + 1,500 jobs
  ('home_divine',     'เทพแห่งเรือน',          'SSR', 'divine', 'home',     1500, 65, '{"vit":22,"dex":12}', 'งานบ้าน 1,500 งาน + ขั้นผู้เชี่ยวชาญ (A)', 40, 'A'),
  ('delivery_divine', 'เทพแห่งวิถี',           'SSR', 'divine', 'delivery', 1500, 65, '{"agi":23,"luk":11}', 'ส่งของ 1,500 งาน + ขั้นผู้เชี่ยวชาญ (A)', 41, 'A'),
  ('tutor_divine',    'เทพแห่งปัญญา',          'SSR', 'divine', 'tutor',    1500, 65, '{"int":23,"luk":11}', 'สอน 1,500 งาน + ขั้นผู้เชี่ยวชาญ (A)', 42, 'A'),
  ('repair_divine',   'เทพแห่งเตาหลอม',        'SSR', 'divine', 'repair',   1500, 65, '{"dex":22,"str":13}', 'งานช่าง 1,500 งาน + ขั้นผู้เชี่ยวชาญ (A)', 43, 'A'),
  ('electric_divine', 'เทพแห่งอัสนี',          'SSR', 'divine', 'electric', 1500, 65, '{"dex":21,"int":14}', 'งานไฟฟ้า 1,500 งาน + ขั้นผู้เชี่ยวชาญ (A)', 44, 'A'),
  -- heaven: rank S (grandmaster) + 3,000 jobs
  ('home_heaven',     'สวรรค์บันดาล · เรือนทิพย์',   'SSR', 'heaven', 'home',     3000, 80, '{"vit":30,"dex":16}', 'งานบ้าน 3,000 งาน + ขั้นปรมาจารย์ (S)', 50, 'S'),
  ('delivery_heaven', 'สวรรค์บันดาล · สายลมทิพย์',  'SSR', 'heaven', 'delivery', 3000, 80, '{"agi":31,"luk":15}', 'ส่งของ 3,000 งาน + ขั้นปรมาจารย์ (S)', 51, 'S'),
  ('tutor_heaven',    'สวรรค์บันดาล · ปัญญาทิพย์',  'SSR', 'heaven', 'tutor',    3000, 80, '{"int":31,"luk":15}', 'สอน 3,000 งาน + ขั้นปรมาจารย์ (S)', 52, 'S'),
  ('repair_heaven',   'สวรรค์บันดาล · หัตถ์ทิพย์',  'SSR', 'heaven', 'repair',   3000, 80, '{"dex":30,"str":17}', 'งานช่าง 3,000 งาน + ขั้นปรมาจารย์ (S)', 53, 'S'),
  ('electric_heaven', 'สวรรค์บันดาล · อัสนีทิพย์',  'SSR', 'heaven', 'electric', 3000, 80, '{"dex":29,"int":18}', 'งานไฟฟ้า 3,000 งาน + ขั้นปรมาจารย์ (S)', 54, 'S');

-- Unlock now also checks the career rank for cards that name one.
create or replace function public._unlock_cards(p_user uuid, p_cat text, p_done int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into user_cards (user_id, card_id)
  select p_user, jc.id from job_cards jc
   where jc.category = p_cat and jc.unlock_count <= p_done
     and (jc.min_career_rank is null
          or exists (select 1 from user_careers c where c.user_id = p_user and c.occupation_id = p_cat
                      and public._rank_ord(c.rank) >= public._rank_ord(jc.min_career_rank)))
  on conflict do nothing;
$$;

-- ---------- shop items ----------
alter table public.shop_items add column tier text not null default 'common' references public.rarity_tiers(id);
update public.shop_items set tier = case id
  when 'frame_jade' then 'uncommon' when 'jacket_explorer' then 'uncommon' when 'boots_travel' then 'uncommon'
  when 'charm_luck' then 'uncommon' when 'boost_personal_slots' then 'uncommon' when 'wrench_gold' then 'epic'
  when 'title_monthly_hero' then 'legend' else 'common' end;
insert into public.shop_items (id, name, kind, slot, price_crystal, description, data, active, sort, tier) values
  ('frame_epic',     'กรอบอเมทิสต์',        'frame',   null,   199, 'กรอบโปรไฟล์ระดับอีปิก', '{"color":"#6a3fb5"}', true, 20, 'epic'),
  ('cape_legend',    'ผ้าคลุมรีเจน',          'costume', 'body', 399, 'ชุดแต่งตัวระดับรีเจน', '{}', true, 21, 'legend'),
  ('frame_mythic',   'กรอบเปลวมิสติก',       'frame',   null,   699, 'กรอบโปรไฟล์ระดับมิสติก', '{"color":"#b3261e"}', true, 22, 'mythic'),
  ('crown_super',    'มงกุฎซูเปอร์มิสติก',   'costume', 'head', 999, 'ชุดแต่งตัวระดับซูเปอร์มิสติก', '{}', true, 23, 'super_mythic'),
  ('frame_divine',   'กรอบดีวาย',            'frame',   null,     0, 'ได้เมื่อขั้นอาชีพถึงผู้เชี่ยวชาญ (A)', '{"color":"#1f8fb3"}', false, 90, 'divine'),
  ('title_divine',   'ผู้เชี่ยวชาญแห่งยุค',   'title',   null,     0, 'ได้เมื่อขั้นอาชีพถึงผู้เชี่ยวชาญ (A)', '{}', false, 91, 'divine'),
  ('frame_heaven',   'กรอบสวรรค์',           'frame',   null,     0, 'ได้เมื่อขั้นอาชีพถึงปรมาจารย์ (S)', '{"color":"#e8b13a"}', false, 92, 'heaven'),
  ('title_heaven',   'ปรมาจารย์สวรรค์',       'title',   null,     0, 'ได้เมื่อขั้นอาชีพถึงปรมาจารย์ (S)', '{}', false, 93, 'heaven');

-- Admins may not put Divine or Heaven items on sale: those are earned, never bought.
create or replace function public._guard_shop_tier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.active and new.tier in ('divine','heaven') then raise exception 'divine and heaven items cannot be sold'; end if;
  return new;
end $$;
create trigger shop_items_tier_guard before insert or update on public.shop_items
  for each row execute function public._guard_shop_tier();

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
revoke execute on function public.set_shop_item_tier(text, text) from public, anon;
grant execute on function public.set_shop_item_tier(text, text) to authenticated;

-- ---------- reaching a new career rank ----------
-- Unlocks rank-gated cards in that trade and grants the Divine (A) and Heaven (S) rewards.
create or replace function public._on_career_rank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_done int;
begin
  if new.rank is distinct from old.rank then
    select count(*) into v_done from quests where worker_id = new.user_id and status = 'completed' and category = new.occupation_id;
    perform _unlock_cards(new.user_id, new.occupation_id, v_done);
    if new.rank in ('A','S') then
      perform _give_item(new.user_id, 'frame_divine'); perform _give_item(new.user_id, 'title_divine');
      perform _notify(new.user_id, 'career', 'ได้รับของระดับดีวาย', 'กรอบและฉายาดีวายจากขั้นผู้เชี่ยวชาญ', 'index.html#char');
    end if;
    if new.rank = 'S' then
      perform _give_item(new.user_id, 'frame_heaven'); perform _give_item(new.user_id, 'title_heaven');
      perform _notify(new.user_id, 'career', 'ได้รับของระดับสวรรค์', 'กรอบและฉายาสวรรค์จากขั้นปรมาจารย์', 'index.html#char');
    end if;
  end if;
  return new;
end $$;
create trigger user_careers_rank_rewards after update of rank on public.user_careers
  for each row execute function public._on_career_rank();
-- Imports can create a career row straight at a high rank.
create trigger user_careers_rank_rewards_ins after insert on public.user_careers
  for each row when (new.rank <> 'F') execute function public._on_career_rank();

revoke execute on function public._on_career_rank(), public._guard_shop_tier() from public, anon, authenticated;

-- Owners must still see items that are no longer on sale (rewards, retired items).
alter policy "shop readable" on public.shop_items
  using (active or tier in ('divine','heaven')
         or exists (select 1 from public.user_items u where u.item_id = shop_items.id and u.user_id = (select auth.uid()))
         or public.has_perm('m.shop', 'view'));
