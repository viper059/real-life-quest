-- Real-life Quest — everyday-life quests (กิจวัตร): drink water, brush teeth, eat meals, go to school, do homework…
-- Each action has a fixed small EXP and anti-farming rules:
--   max per day · minimum gap between logs · time-of-day window (Bangkok) · weekdays only
--   location check against the player's saved home/school/work (places lock for 30 days)
--   photo proof, or parent approval for children in a family
--   'after' dependency (e.g. "back home" only after "arrived at school/work" today)
--   one daily EXP ceiling for all habits together (setting habit_exp_cap)

insert into public.app_settings (key, value) values ('habit_exp_cap', '60') on conflict (key) do nothing;

-- Test hook: the clock habits use. Production always returns now().
create function public._clock()
returns timestamptz
language sql
stable
as $$ select now() $$;

create table public.habit_templates (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  title text not null,
  grp text not null check (grp in ('body','food','health','home','mind','student','worker')),
  icon text not null default '•',
  exp int not null check (exp between 1 and 20),
  max_per_day int not null check (max_per_day between 1 and 12),
  min_gap_min int not null default 0 check (min_gap_min between 0 and 1440),
  window_start time,
  window_end time,
  weekdays_only boolean not null default false,
  verify text not null default 'none' check (verify in ('none','photo','location','parent')),
  place text check (place in ('home','school','work')),
  after_any text[] not null default '{}',
  hint text,
  sort int not null default 0,
  active boolean not null default true
);
insert into public.habit_templates (id, title, grp, icon, exp, max_per_day, min_gap_min, window_start, window_end, weekdays_only, verify, place, after_any, hint, sort) values
  ('water',        'ดื่มน้ำ 1 แก้ว',              'body',    '💧', 2, 8, 45,  null,    null,    false, 'none',     null,     '{}', 'วันละไม่เกิน 8 แก้ว ห่างกันอย่างน้อย 45 นาที', 1),
  ('brush',        'แปรงฟัน',                     'body',    '🪥', 3, 2, 360, null,    null,    false, 'none',     null,     '{}', 'เช้าและก่อนนอน ห่างกันอย่างน้อย 6 ชม.', 2),
  ('shower',       'อาบน้ำ',                       'body',    '🚿', 3, 2, 360, null,    null,    false, 'none',     null,     '{}', 'วันละ 2 ครั้ง ห่างกันอย่างน้อย 6 ชม.', 3),
  ('breakfast',    'กินข้าวเช้า',                  'food',    '🍳', 5, 1, 0,   '05:00', '10:30', false, 'none',     null,     '{}', 'ช่วง 05:00–10:30', 10),
  ('lunch',        'กินข้าวกลางวัน',               'food',    '🍛', 5, 1, 0,   '10:30', '15:00', false, 'none',     null,     '{}', 'ช่วง 10:30–15:00', 11),
  ('dinner',       'กินข้าวเย็น',                  'food',    '🍲', 5, 1, 0,   '16:00', '22:00', false, 'none',     null,     '{}', 'ช่วง 16:00–22:00', 12),
  ('veggie',       'กินผักหรือผลไม้',              'food',    '🥦', 3, 2, 180, null,    null,    false, 'none',     null,     '{}', 'วันละ 2 ครั้ง ห่างกัน 3 ชม.', 13),
  ('wake_early',   'ตื่นก่อน 6 โมงเช้า',           'health',  '🌅', 5, 1, 0,   '04:00', '06:00', false, 'none',     null,     '{}', 'กดได้เฉพาะ 04:00–06:00', 20),
  ('exercise',     'ออกกำลังกาย 30 นาที',          'health',  '🏃', 10, 1, 0,  null,    null,    false, 'photo',    null,     '{}', 'แนบรูประหว่างหรือหลังออกกำลังกาย', 21),
  ('sleep_early',  'เข้านอนก่อน 4 ทุ่ม',           'health',  '🌙', 5, 1, 0,   '20:00', '22:00', false, 'none',     null,     '{}', 'กดได้เฉพาะ 20:00–22:00', 22),
  ('make_bed',     'จัดที่นอน',                    'home',    '🛏️', 2, 1, 0,   '04:00', '12:00', false, 'none',     null,     '{}', 'ช่วงเช้า', 30),
  ('dishes',       'ล้างจาน',                      'home',    '🍽️', 3, 2, 180, null,    null,    false, 'none',     null,     '{}', 'วันละ 2 ครั้ง ห่างกัน 3 ชม.', 31),
  ('trash',        'ทิ้งขยะ / ช่วยงานบ้าน',         'home',    '🗑️', 2, 1, 0,   null,    null,    false, 'none',     null,     '{}', null, 32),
  ('read',         'อ่านหนังสือ 20 นาที',           'mind',    '📖', 5, 2, 120, null,    null,    false, 'none',     null,     '{}', 'วันละ 2 ครั้ง ห่างกัน 2 ชม.', 40),
  ('meditate',     'นั่งสมาธิ 10 นาที',            'mind',    '🧘', 3, 1, 0,   null,    null,    false, 'none',     null,     '{}', null, 41),
  ('save_money',   'เก็บเงินออมวันนี้',             'mind',    '🐷', 3, 1, 0,   null,    null,    false, 'none',     null,     '{}', null, 42),
  ('go_school',    'ไปถึงโรงเรียน',                'student', '🏫', 10, 1, 0,  '06:00', '09:30', true,  'location', 'school', '{}', 'เช็กอินที่โรงเรียน 06:00–09:30 วันจันทร์–ศุกร์', 50),
  ('back_home',    'กลับถึงบ้าน',                  'student', '🏠', 5, 1, 0,   '12:00', '21:00', true,  'location', 'home',   '{go_school,go_work}', 'เช็กอินที่บ้าน หลังไปเรียนหรือไปทำงานวันนี้', 51),
  ('homework',     'ทำการบ้าน',                    'student', '✏️', 10, 1, 0,  '12:00', '23:30', false, 'parent',   null,     '{}', 'ผู้ปกครองรับรอง หรือแนบรูปการบ้านถ้าไม่มีผู้ปกครองในระบบ', 52),
  ('review_lesson','ทบทวนบทเรียน 30 นาที',          'student', '📚', 5, 1, 0,   null,    null,    false, 'none',     null,     '{}', null, 53),
  ('pack_bag',     'จัดกระเป๋าสำหรับพรุ่งนี้',       'student', '🎒', 2, 1, 0,   '17:00', '23:30', false, 'none',     null,     '{}', 'ช่วงเย็น', 54),
  ('go_work',      'ไปถึงที่ทำงานตรงเวลา',         'worker',  '🏢', 10, 1, 0,  '05:00', '10:00', true,  'location', 'work',   '{}', 'เช็กอินที่ทำงาน 05:00–10:00 วันจันทร์–ศุกร์', 60);

create table public.user_places (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('home','school','work')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  set_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table public.habit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  habit_id text not null references public.habit_templates(id),
  day date not null,
  logged_at timestamptz not null,
  exp int not null default 0,
  status text not null default 'ok' check (status in ('ok','pending','rejected')),
  lat double precision, lng double precision,
  photo_path text,
  verified_by uuid references public.profiles(id)
);
create index habit_logs_user_day_idx on public.habit_logs (user_id, day);
create index habit_logs_habit_idx on public.habit_logs (habit_id);
create index habit_logs_verified_by_idx on public.habit_logs (verified_by);

alter table public.habit_templates enable row level security;
alter table public.user_places enable row level security;
alter table public.habit_logs enable row level security;
create policy "habits readable" on public.habit_templates for select to authenticated using (true);
create policy "own places" on public.user_places for select to authenticated using (user_id = (select auth.uid()));
create policy "own habit logs" on public.habit_logs for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, truncate on public.habit_templates, public.user_places, public.habit_logs from anon, authenticated;

-- ---------- helpers ----------
create function public._bkk_now_time() returns time language sql stable set search_path = public
as $$ select (public._clock() at time zone 'Asia/Bangkok')::time $$;
create function public._bkk_day() returns date language sql stable set search_path = public
as $$ select (public._clock() at time zone 'Asia/Bangkok')::date $$;

create function public._has_parent(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from family_members me join family_members p on p.family_id = me.family_id
                  where me.user_id = p_user and me.role = 'child' and me.left_at is null
                    and p.role = 'parent' and p.left_at is null and p.user_id <> p_user)
$$;

-- Why a habit cannot be logged right now (null = it can). Shared by my_habits and log_habit.
create function public._habit_block(p_user uuid, h habit_templates)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_day date := _bkk_day(); v_now time := _bkk_now_time(); v_count int; v_last timestamptz; v_dow int;
begin
  if not h.active then return 'not available'; end if;
  select count(*), max(logged_at) into v_count, v_last from habit_logs
   where user_id = p_user and habit_id = h.id and day = v_day and status <> 'rejected';
  if v_count >= h.max_per_day then return 'done for today'; end if;
  if h.weekdays_only then
    v_dow := extract(isodow from v_day);
    if v_dow > 5 then return 'weekdays only'; end if;
  end if;
  if h.window_start is not null and (v_now < h.window_start or v_now > h.window_end) then return 'outside time window'; end if;
  if v_last is not null and h.min_gap_min > 0 and _clock() < v_last + make_interval(mins => h.min_gap_min) then return 'too soon'; end if;
  if cardinality(h.after_any) > 0 and not exists (select 1 from habit_logs where user_id = p_user and day = v_day
                                                   and habit_id = any (h.after_any) and status = 'ok') then
    return 'do the earlier step first';
  end if;
  if h.place is not null and not exists (select 1 from user_places where user_id = p_user and kind = h.place) then
    return 'set your place first';
  end if;
  return null;
end $$;

create function public._habit_exp_today(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$ select coalesce(sum(exp), 0)::int from habit_logs where user_id = p_user and day = _bkk_day() and status <> 'rejected' $$;

-- ---------- player ----------
create function public.my_habits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); v_day date := _bkk_day();
begin
  return jsonb_build_object(
    'day', v_day, 'now', to_char(_bkk_now_time(), 'HH24:MI'),
    'exp_today', _habit_exp_today(v_uid), 'cap', _setting_int('habit_exp_cap', 60),
    'has_parent', _has_parent(v_uid),
    'places', coalesce((select jsonb_object_agg(kind, jsonb_build_object('set_at', set_at,
                 'locked_until', set_at + interval '30 days')) from user_places where user_id = v_uid), '{}'::jsonb),
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'title', h.title, 'grp', h.grp, 'icon', h.icon, 'exp', h.exp, 'max', h.max_per_day,
        'gap', h.min_gap_min, 'from', to_char(h.window_start, 'HH24:MI'), 'to', to_char(h.window_end, 'HH24:MI'),
        'weekdays_only', h.weekdays_only, 'verify', h.verify, 'place', h.place, 'hint', h.hint,
        'count', (select count(*) from habit_logs l where l.user_id = v_uid and l.habit_id = h.id and l.day = v_day and l.status <> 'rejected'),
        'pending', (select count(*) from habit_logs l where l.user_id = v_uid and l.habit_id = h.id and l.day = v_day and l.status = 'pending'),
        'next_at', (select max(logged_at) + make_interval(mins => h.min_gap_min) from habit_logs l
                     where l.user_id = v_uid and l.habit_id = h.id and l.day = v_day and l.status <> 'rejected'),
        'block', _habit_block(v_uid, h)) order by h.sort) from habit_templates h where h.active), '[]'::jsonb));
end $$;

create function public.set_place(p_kind text, p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); v_set timestamptz;
begin
  if p_kind not in ('home','school','work') then raise exception 'bad place'; end if;
  if p_lat is null or p_lng is null then raise exception 'location required'; end if;
  select set_at into v_set from user_places where user_id = v_uid and kind = p_kind;
  if v_set is not null and _clock() < v_set + interval '30 days' then raise exception 'place locked for 30 days'; end if;
  insert into user_places (user_id, kind, lat, lng, set_at) values (v_uid, p_kind, p_lat, p_lng, _clock())
  on conflict (user_id, kind) do update set lat = excluded.lat, lng = excluded.lng, set_at = excluded.set_at;
end $$;

create function public.log_habit(p_habit text, p_lat double precision default null, p_lng double precision default null,
                                 p_photo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  h habit_templates%rowtype; v_block text; v_place user_places%rowtype; v_status text := 'ok';
  v_exp int; v_room int; v_id bigint; v_parent uuid;
begin
  select * into h from habit_templates where id = p_habit;
  if not found then raise exception 'habit not found'; end if;
  perform 1 from profiles where id = v_uid for update;  -- one log at a time per player
  v_block := _habit_block(v_uid, h);
  if v_block is not null then raise exception '%', v_block; end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> v_uid::text then raise exception 'bad file path'; end if;

  if h.verify = 'location' then
    select * into v_place from user_places where user_id = v_uid and kind = h.place;
    if p_lat is null or p_lng is null then raise exception 'location required'; end if;
    if _distance_m(p_lat, p_lng, v_place.lat, v_place.lng) > _setting_int('checkin_radius_m', 300) then
      raise exception 'too far from your saved place';
    end if;
  elsif h.verify = 'photo' then
    if p_photo is null then raise exception 'photo required'; end if;
  elsif h.verify = 'parent' then
    if _has_parent(v_uid) then v_status := 'pending';
    elsif p_photo is null then raise exception 'photo required';
    end if;
  end if;

  v_room := greatest(0, _setting_int('habit_exp_cap', 60) - _habit_exp_today(v_uid));
  v_exp := least(h.exp, v_room);
  insert into habit_logs (user_id, habit_id, day, logged_at, exp, status, lat, lng, photo_path)
  values (v_uid, h.id, _bkk_day(), _clock(), v_exp, v_status, p_lat, p_lng, p_photo)
  returning id into v_id;
  if v_status = 'ok' and v_exp > 0 then perform _grant_exp(v_uid, v_exp); end if;
  if v_status = 'pending' then
    for v_parent in select p.user_id from family_members me join family_members p on p.family_id = me.family_id
                     where me.user_id = v_uid and me.left_at is null and p.role = 'parent' and p.left_at is null loop
      perform _notify(v_parent, 'family', 'ลูกขอให้รับรอง: ' || h.title,
        (select coalesce(display_name, username) from profiles where id = v_uid), 'index.html#guild');
    end loop;
  end if;
  return jsonb_build_object('id', v_id, 'exp', v_exp, 'status', v_status, 'capped', v_exp < h.exp);
end $$;

-- ---------- parents ----------
create function public.family_pending_habits()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', h.title, 'icon', h.icon, 'exp', l.exp,
           'user', (select coalesce(display_name, username) from profiles where id = l.user_id), 'logged_at', l.logged_at)
           order by l.logged_at), '[]'::jsonb)
    from habit_logs l join habit_templates h on h.id = l.habit_id
   where l.status = 'pending' and l.day >= _bkk_day() - 2
     and exists (select 1 from family_members me join family_members kid on kid.family_id = me.family_id
                  where me.user_id = auth.uid() and me.role = 'parent' and me.left_at is null
                    and kid.user_id = l.user_id and kid.role = 'child' and kid.left_at is null and kid.user_id <> auth.uid())
$$;

create function public.verify_habit(p_log bigint, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); l habit_logs%rowtype;
begin
  select * into l from habit_logs where id = p_log for update;
  if not found or l.status <> 'pending' then raise exception 'not pending'; end if;
  if l.user_id = v_uid or not exists (select 1 from family_members me join family_members kid on kid.family_id = me.family_id
                  where me.user_id = v_uid and me.role = 'parent' and me.left_at is null
                    and kid.user_id = l.user_id and kid.role = 'child' and kid.left_at is null) then
    raise exception 'parents only';
  end if;
  update habit_logs set status = case when p_approve then 'ok' else 'rejected' end, verified_by = v_uid where id = p_log;
  if p_approve and l.exp > 0 then perform _grant_exp(l.user_id, l.exp); end if;
  perform _notify(l.user_id, 'family', case when p_approve then 'ผู้ปกครองรับรองแล้ว +' || l.exp || ' EXP' else 'ผู้ปกครองไม่รับรอง' end,
    (select title from habit_templates where id = l.habit_id), 'index.html#plan');
end $$;

revoke execute on function public._clock(), public._bkk_now_time(), public._bkk_day(), public._has_parent(uuid),
  public._habit_block(uuid, public.habit_templates), public._habit_exp_today(uuid) from public, anon, authenticated;
revoke execute on function public.my_habits(), public.set_place(text, double precision, double precision),
  public.log_habit(text, double precision, double precision, text), public.family_pending_habits(), public.verify_habit(bigint, boolean)
  from public, anon;
grant execute on function public.my_habits(), public.set_place(text, double precision, double precision),
  public.log_habit(text, double precision, double precision, text), public.family_pending_habits(), public.verify_habit(bigint, boolean)
  to authenticated;
