-- Real-life Quest — monsters at real places. Staff place a monster at a map point; players walk there,
-- fight it, and earn EXP (and a little Gold if staff set it). Anti-farming: per-monster cooldown,
-- daily kill limit, GPS radius, impossible-travel check, minimum fight length.

insert into public.app_settings (key, value) values
  ('monster_radius_m', '60'),        -- how close you must be to fight
  ('monster_cooldown_min', '240'),   -- same monster is resting this long after you beat it
  ('monster_daily_max', '10')        -- monsters per player per day
on conflict (key) do nothing;

create table public.monsters (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  kind text not null default 'slime' check (kind in ('slime','goblin','bat','golem','dragon')),
  level int not null default 1 check (level between 1 and 10),
  hp int not null default 8 check (hp between 3 and 60),          -- taps needed to win
  exp int not null default 10 check (exp between 1 and 200),
  gold int not null default 0 check (gold between 0 and 50),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index monsters_active_idx on public.monsters (active) where active;
create index monsters_created_by_idx on public.monsters (created_by);

create table public.monster_kills (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  monster_id uuid not null references public.monsters(id) on delete cascade,
  killed_at timestamptz not null default now(),
  day date not null,
  lat double precision not null,
  lng double precision not null,
  exp int not null,
  gold int not null default 0
);
create index monster_kills_user_monster_idx on public.monster_kills (user_id, monster_id, killed_at desc);
create index monster_kills_user_day_idx on public.monster_kills (user_id, day);
create index monster_kills_monster_idx on public.monster_kills (monster_id);

alter table public.monsters enable row level security;
alter table public.monster_kills enable row level security;
create policy "own monster kills" on public.monster_kills for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.monsters, public.monster_kills from anon, authenticated;
grant select on public.monster_kills to authenticated;

-- Monsters within 5 km of the player, with this player's cooldown and daily progress.
create function public.nearby_monsters(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); v_radius int := _setting_int('monster_radius_m', 60);
        v_cool int := _setting_int('monster_cooldown_min', 240);
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'location required'; end if;
  return jsonb_build_object(
    'radius_m', v_radius, 'daily_max', _setting_int('monster_daily_max', 10),
    'kills_today', (select count(*) from monster_kills where user_id = v_uid and day = _bkk_day()),
    'monsters', coalesce((select jsonb_agg(x order by (x->>'distance_m')::numeric) from (
      select jsonb_build_object('id', m.id, 'name', m.name, 'kind', m.kind, 'level', m.level, 'hp', m.hp, 'exp', m.exp, 'gold', m.gold,
               'lat', m.lat, 'lng', m.lng, 'distance_m', round(d.dist::numeric),
               'in_range', d.dist <= v_radius,
               'rest_until', (select k.killed_at + make_interval(mins => v_cool) from monster_kills k
                               where k.user_id = v_uid and k.monster_id = m.id and k.killed_at > now() - make_interval(mins => v_cool)
                               order by k.killed_at desc limit 1)) x
        from monsters m cross join lateral (select _distance_m(p_lat, p_lng, m.lat, m.lng) dist) d
       where m.active and d.dist <= 5000) s), '[]'::jsonb));
end $$;

create function public.defeat_monster(p_monster uuid, p_lat double precision, p_lng double precision, p_taps int, p_duration_s numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active(); m monsters%rowtype; v_last monster_kills%rowtype; v_level int; v_id bigint;
begin
  select * into m from monsters where id = p_monster and active;
  if not found then raise exception 'monster not found'; end if;
  perform 1 from profiles where id = v_uid for update;  -- one fight at a time per player
  if p_lat is null or p_lng is null then raise exception 'location required'; end if;
  if _distance_m(p_lat, p_lng, m.lat, m.lng) > _setting_int('monster_radius_m', 60) then raise exception 'too far from monster'; end if;
  if exists (select 1 from monster_kills where user_id = v_uid and monster_id = m.id
              and killed_at > now() - make_interval(mins => _setting_int('monster_cooldown_min', 240))) then
    raise exception 'monster is resting';
  end if;
  if (select count(*) from monster_kills where user_id = v_uid and day = _bkk_day()) >= _setting_int('monster_daily_max', 10) then
    raise exception 'daily monster limit';
  end if;
  -- impossible travel: more than 40 m/s (144 km/h) between this fight and the last one
  select * into v_last from monster_kills where user_id = v_uid order by killed_at desc limit 1;
  if found and now() - v_last.killed_at < interval '2 hours'
     and _distance_m(p_lat, p_lng, v_last.lat, v_last.lng) / greatest(1, extract(epoch from now() - v_last.killed_at)) > 40 then
    raise exception 'location jump detected';
  end if;
  if p_taps is null or p_duration_s is null or p_taps < m.hp or p_duration_s < m.hp * 0.2 then raise exception 'fight too short'; end if;

  insert into monster_kills (user_id, monster_id, day, lat, lng, exp, gold)
  values (v_uid, m.id, _bkk_day(), p_lat, p_lng, m.exp, m.gold) returning id into v_id;
  v_level := _grant_exp(v_uid, m.exp);
  if m.gold > 0 then
    update wallets set gold = gold + m.gold, updated_at = now() where user_id = v_uid;
    perform _ledger(v_uid, 'monster', m.gold, 0, null, null, m.name);
  end if;
  return jsonb_build_object('id', v_id, 'exp', m.exp, 'gold', m.gold, 'level', v_level);
end $$;

-- Staff: list every monster, and create/edit/retire one.
create function public.admin_monsters()
returns setof public.monsters
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_perm('q.review', 'view') then raise exception 'forbidden'; end if;
  return query select * from monsters order by created_at desc;
end $$;

create function public.admin_set_monster(p_id uuid, p_name text, p_kind text, p_level int, p_hp int, p_exp int, p_gold int,
                                         p_lat double precision, p_lng double precision, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := p_id;
begin
  if not has_perm('q.review') then raise exception 'forbidden'; end if;
  if v_id is null then
    insert into monsters (name, kind, level, hp, exp, gold, lat, lng, active, created_by)
    values (trim(p_name), p_kind, p_level, p_hp, p_exp, p_gold, p_lat, p_lng, coalesce(p_active, true), auth.uid()) returning id into v_id;
  else
    update monsters set name = trim(p_name), kind = p_kind, level = p_level, hp = p_hp, exp = p_exp, gold = p_gold,
           lat = p_lat, lng = p_lng, active = coalesce(p_active, active) where id = v_id;
    if not found then raise exception 'monster not found'; end if;
  end if;
  perform _audit('monster.set', 'monster', v_id::text, jsonb_build_object('name', p_name, 'lat', p_lat, 'lng', p_lng, 'active', p_active));
  return v_id;
end $$;

revoke execute on function public.nearby_monsters(double precision, double precision), public.defeat_monster(uuid, double precision, double precision, int, numeric),
  public.admin_monsters(), public.admin_set_monster(uuid, text, text, int, int, int, int, double precision, double precision, boolean) from public, anon;
grant execute on function public.nearby_monsters(double precision, double precision), public.defeat_monster(uuid, double precision, double precision, int, numeric),
  public.admin_monsters(), public.admin_set_monster(uuid, text, text, int, int, int, int, double precision, double precision, boolean) to authenticated;

-- Let staff tune the three monster settings from the back office.
do $$
declare def text; newdef text;
begin
  def := pg_get_functiondef('public.set_setting(text,text)'::regprocedure);
  newdef := replace(def, '''personal_exp_cap'',''habit_exp_cap'')', '''personal_exp_cap'',''habit_exp_cap'',''monster_radius_m'',''monster_cooldown_min'',''monster_daily_max'')');
  if newdef = def then raise exception 'setting list not found'; end if;
  execute newdef;
end $$;
