-- 0023: (1) KYC message no longer implies cash-out, (2) habits pay a little Gold (daily cap),
-- (3) food shop: buy Thai dishes with Gold, eat them for short EXP / Gold buffs.
-- Gold and Crystal still can never be withdrawn as money.

-- ---------- 1) KYC wording ----------
do $$
declare d text;
begin
  d := pg_get_functiondef('public.review_kyc'::regproc);
  if position('รับเควสต์และถอนเงินได้แล้ว' in d) = 0 then raise exception 'review_kyc anchor not found'; end if;
  execute replace(d, 'รับเควสต์และถอนเงินได้แล้ว', 'รับเควสต์และโพสต์งานได้แล้ว');
end $$;

-- ---------- 2) settings ----------
insert into public.app_settings (key, value) values ('habit_gold_cap', '40') on conflict (key) do nothing;

-- ---------- 3) food tables ----------
create table public.food_items (
  id text primary key,
  name text not null,
  emoji text not null,
  cat text not null check (cat in ('meal','snack','drink','dessert','fruit')),
  price integer not null check (price > 0),
  buff_kind text not null check (buff_kind in ('exp','gold')),
  buff_pct integer not null check (buff_pct between 1 and 20),
  buff_min integer not null check (buff_min between 10 and 720),
  description text,
  active boolean not null default true,
  sort integer not null default 100
);
create table public.user_food (
  user_id uuid not null references public.profiles(id) on delete cascade,
  food_id text not null references public.food_items(id),
  qty integer not null default 0 check (qty >= 0),
  primary key (user_id, food_id)
);
create table public.user_buffs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('exp','gold')),
  pct integer not null,
  until timestamptz not null,
  source text,
  primary key (user_id, kind)
);
alter table public.food_items enable row level security;
alter table public.user_food enable row level security;
alter table public.user_buffs enable row level security;
create policy food_items_read on public.food_items for select to authenticated using (active);
create policy user_food_own on public.user_food for select to authenticated using (user_id = auth.uid());
create policy user_buffs_own on public.user_buffs for select to authenticated using (user_id = auth.uid());

insert into public.food_items (id, name, emoji, cat, price, buff_kind, buff_pct, buff_min, description, sort) values
 ('joke_moo',     'โจ๊กหมู',            '🥣', 'meal',    40,  'exp',  6, 120, 'อุ่นท้อง เบาๆ เริ่มเช้าสดชื่น', 10),
 ('krapao',       'ข้าวกะเพราไข่ดาว',   '🍳', 'meal',    60,  'exp', 10, 180, 'จานยอดฮิต เผ็ดร้อนปลุกพลัง', 11),
 ('boat_noodle',  'ก๋วยเตี๋ยวเรือ',      '🍜', 'meal',    60,  'exp',  8, 150, 'น้ำซุปเข้มข้น ชามเล็กแต่อร่อย', 12),
 ('khaomankai',   'ข้าวมันไก่',          '🍗', 'meal',    70,  'exp', 10, 180, 'ไก่นุ่ม ข้าวมันหอม', 13),
 ('padthai',      'ผัดไทยกุ้งสด',        '🍤', 'meal',    70,  'exp', 10, 180, 'เส้นเหนียวนุ่ม ถั่วป่นกรุบๆ', 14),
 ('somtam_set',   'ส้มตำไก่ย่างข้าวเหนียว','🥗', 'meal',   80,  'exp', 12, 180, 'ครบรสเปรี้ยวหวานเผ็ด', 15),
 ('khaosoi',      'ข้าวซอยไก่',          '🍛', 'meal',    90,  'exp', 12, 180, 'น้ำแกงกะทิหอมเครื่องเทศ', 16),
 ('tomyum',       'ต้มยำกุ้งน้ำข้น',     '🦐', 'meal',   120,  'exp', 15, 240, 'จานพิเศษ พลังเต็มสูบนานกว่าเดิม', 17),
 ('moo_ping',     'หมูปิ้งข้าวเหนียว',   '🍢', 'snack',   35,  'gold', 8, 120, 'ของกินเล่นยามเช้า', 20),
 ('luk_chin',     'ลูกชิ้นปิ้ง',         '🍡', 'snack',   30,  'gold', 8, 120, 'จิ้มน้ำจิ้มรสจัด', 21),
 ('banana_fry',   'กล้วยทอด',            '🍌', 'snack',   25,  'gold', 6, 120, 'กรอบนอกนุ่มใน', 22),
 ('khanom_krok',  'ขนมครก',              '🥞', 'snack',   25,  'gold', 6, 120, 'หอมกะทิ ร้อนๆ อร่อยสุด', 23),
 ('kai_tod',      'ไก่ทอดหาดใหญ่',       '🍖', 'snack',   45,  'gold',10, 150, 'กรอบนาน ทอดหอมหอมแดง', 24),
 ('cha_yen',      'ชาไทยเย็น',           '🧋', 'drink',   25,  'exp',  4,  90, 'หวานมัน ชื่นใจ', 30),
 ('coconut',      'น้ำมะพร้าวน้ำหอม',    '🥥', 'drink',   30,  'exp',  5,  90, 'สดชื่น ดับร้อน', 31),
 ('orange',       'น้ำส้มคั้นสด',        '🍊', 'drink',   30,  'exp',  5,  90, 'วิตามินซีเต็มแก้ว', 32),
 ('iced_coffee',  'กาแฟเย็น',            '☕', 'drink',   35,  'exp',  5, 120, 'ตาสว่างเลย', 33),
 ('fruit_mix',    'ผลไม้รวมจานเล็ก',     '🍉', 'fruit',   30,  'exp',  5, 120, 'ของดีต่อสุขภาพ', 40),
 ('coconut_ice',  'ไอศกรีมกะทิ',         '🍨', 'dessert', 45,  'gold',10, 150, 'เย็นหวานหอมกะทิ', 50),
 ('tub_tim',      'ทับทิมกรอบ',          '🍧', 'dessert', 40,  'gold', 9, 150, 'น้ำแข็งใสหวานเย็น', 51),
 ('bualoy',       'บัวลอยไข่หวาน',       '🍥', 'dessert', 45,  'gold',10, 150, 'เหนียวนุ่ม กะทิหอม', 52),
 ('mango_sticky', 'ข้าวเหนียวมะม่วง',    '🥭', 'dessert', 70,  'gold',12, 180, 'ขนมไทยยอดนิยม หวานกำลังดี', 53);

-- ---------- 4) helpers ----------
create function public._habit_gold_today(p_user uuid) returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(gold_delta), 0)::int from transactions
   where user_id = p_user and kind = 'habit_gold' and (created_at at time zone 'Asia/Bangkok')::date = _bkk_day()
$$;
create function public._buff_pct(p_user uuid, p_kind text) returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select pct from user_buffs where user_id = p_user and kind = p_kind and until > _clock()), 0)
$$;
-- pays Gold for a finished habit: 1 G per EXP earned (+gold buff), capped per day
create function public._habit_gold(p_user uuid, p_exp integer, p_title text) returns integer language plpgsql security definer set search_path = public as $$
declare v_amt int; v_room int;
begin
  if p_exp is null or p_exp <= 0 then return 0; end if;
  v_amt := round(p_exp * (1 + _buff_pct(p_user, 'gold') / 100.0))::int;
  v_room := greatest(0, _setting_int('habit_gold_cap', 40) - _habit_gold_today(p_user));
  v_amt := least(v_amt, v_room);
  if v_amt <= 0 then return 0; end if;
  update wallets set gold = gold + v_amt, updated_at = now() where user_id = p_user;
  if not found then insert into wallets (user_id, gold) values (p_user, v_amt); end if;
  perform _ledger(p_user, 'habit_gold', v_amt, 0, null, null, p_title);
  return v_amt;
end $$;
revoke execute on function public._habit_gold_today(uuid), public._buff_pct(uuid, text), public._habit_gold(uuid, integer, text) from public, anon, authenticated;

-- ---------- 5) patch habit functions ----------
do $$
declare d text; r text;
begin
  -- log_habit
  d := pg_get_functiondef('public.log_habit'::regproc); r := d;
  r := replace(r, 'v_exp int; v_room int; v_id bigint; v_parent uuid;', 'v_exp int; v_gold int := 0; v_room int; v_id bigint; v_parent uuid;');
  r := replace(r, 'v_exp := least(h.exp, v_room);', 'v_exp := least(round(h.exp * (1 + _buff_pct(v_uid, ''exp'') / 100.0))::int, v_room);');
  r := replace(r, 'if v_status = ''ok'' and v_exp > 0 then perform _grant_exp(v_uid, v_exp); end if;',
                  'if v_status = ''ok'' and v_exp > 0 then perform _grant_exp(v_uid, v_exp); v_gold := _habit_gold(v_uid, v_exp, h.title); end if;');
  r := replace(r, '''+'' || v_exp || '' EXP'' else', '''+'' || v_exp || '' EXP'' || case when v_gold > 0 then '' · +'' || v_gold || '' G'' else '''' end else');
  r := replace(r, '''capped'', v_exp < h.exp);', '''capped'', v_exp < h.exp, ''gold'', v_gold);');
  if r = d or position('_habit_gold' in r) = 0 or position('''gold'', v_gold' in r) = 0 or position('v_gold > 0' in r) = 0 or position('_buff_pct' in r) = 0 then raise exception 'log_habit anchors not found'; end if;
  execute r;

  -- log_walk
  d := pg_get_functiondef('public.log_walk'::regproc); r := d;
  r := replace(r, 'v_exp int; v_room int; v_id bigint; v_speed numeric;', 'v_exp int; v_gold int := 0; v_room int; v_id bigint; v_speed numeric;');
  r := replace(r, 'v_exp := least(h.exp, v_room);', 'v_exp := least(round(h.exp * (1 + _buff_pct(v_uid, ''exp'') / 100.0))::int, v_room);');
  r := replace(r, 'if v_exp > 0 then perform _grant_exp(v_uid, v_exp); end if;', 'if v_exp > 0 then perform _grant_exp(v_uid, v_exp); v_gold := _habit_gold(v_uid, v_exp, h.title); end if;');
  r := replace(r, '''+'' || v_exp || '' EXP'' else', '''+'' || v_exp || '' EXP'' || case when v_gold > 0 then '' · +'' || v_gold || '' G'' else '''' end else');
  r := replace(r, '''capped'', v_exp < h.exp);', '''capped'', v_exp < h.exp, ''gold'', v_gold);');
  if r = d or position('_habit_gold' in r) = 0 or position('''gold'', v_gold' in r) = 0 or position('v_gold > 0' in r) = 0 or position('_buff_pct' in r) = 0 then raise exception 'log_walk anchors not found'; end if;
  execute r;

  -- verify_habit (parent approves → Gold too)
  d := pg_get_functiondef('public.verify_habit'::regproc);
  r := replace(d, 'if p_approve and l.exp > 0 then perform _grant_exp(l.user_id, l.exp); end if;',
                  'if p_approve and l.exp > 0 then perform _grant_exp(l.user_id, l.exp); perform _habit_gold(l.user_id, l.exp, (select title from habit_templates where id = l.habit_id)); end if;');
  if r = d then raise exception 'verify_habit anchor not found'; end if;
  execute r;

  -- my_habits: today's gold + active buffs
  d := pg_get_functiondef('public.my_habits'::regproc);
  r := replace(d, '''exp_today'', _habit_exp_today(v_uid),',
    '''exp_today'', _habit_exp_today(v_uid), ''gold_today'', _habit_gold_today(v_uid), ''gold_cap'', _setting_int(''habit_gold_cap'', 40), '
    || '''buffs'', coalesce((select jsonb_agg(jsonb_build_object(''kind'', kind, ''pct'', pct, ''until'', until, ''source'', source)) from user_buffs where user_id = v_uid and until > _clock()), ''[]''::jsonb),');
  if r = d then raise exception 'my_habits anchor not found'; end if;
  execute r;
end $$;

-- ---------- 6) buy / eat ----------
create function public.buy_food(p_food text, p_qty integer default 1) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); f food_items%rowtype; v_total int; v_have int;
begin
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'bad quantity'; end if;
  select * into f from food_items where id = p_food and active;
  if not found then raise exception 'food not available'; end if;
  v_total := f.price * p_qty;
  update wallets set gold = gold - v_total, updated_at = now() where user_id = v_uid and gold >= v_total;
  if not found then raise exception 'not enough gold'; end if;
  perform _ledger(v_uid, 'food_buy', -v_total, 0, null, null, f.name || ' x' || p_qty);
  insert into user_food (user_id, food_id, qty) values (v_uid, f.id, p_qty)
    on conflict (user_id, food_id) do update set qty = user_food.qty + p_qty;
  select qty into v_have from user_food where user_id = v_uid and food_id = f.id;
  return jsonb_build_object('food', f.id, 'qty', v_have, 'paid', v_total);
end $$;

create function public.eat_food(p_food text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); f food_items%rowtype; b user_buffs%rowtype; v_until timestamptz; v_pct int; v_now timestamptz := _clock();
begin
  select * into f from food_items where id = p_food;
  if not found then raise exception 'food not available'; end if;
  update user_food set qty = qty - 1 where user_id = v_uid and food_id = p_food and qty > 0;
  if not found then raise exception 'none left'; end if;
  select * into b from user_buffs where user_id = v_uid and kind = f.buff_kind for update;
  if found and b.until > v_now then
    v_pct := greatest(b.pct, f.buff_pct);
    v_until := least(v_now + interval '12 hours', b.until + make_interval(mins => f.buff_min));
  else
    v_pct := f.buff_pct; v_until := v_now + make_interval(mins => f.buff_min);
  end if;
  insert into user_buffs (user_id, kind, pct, until, source) values (v_uid, f.buff_kind, v_pct, v_until, f.name)
    on conflict (user_id, kind) do update set pct = excluded.pct, until = excluded.until, source = excluded.source;
  return jsonb_build_object('food', f.id, 'kind', f.buff_kind, 'pct', v_pct, 'until', v_until);
end $$;
grant execute on function public.buy_food(text, integer), public.eat_food(text) to authenticated;
revoke execute on function public.buy_food(text, integer), public.eat_food(text) from anon, public;
