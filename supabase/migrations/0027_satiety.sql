-- 0027: satiety (ความอิ่ม). 0-100, falls with time; each dish restores some. You can only eat when not already full.
insert into public.app_settings (key, value) values
  ('satiety_decay_per_hour', '12'),   -- ~8 h from full to empty
  ('satiety_eat_below', '70')         -- can eat only while satiety is at or below this
on conflict (key) do nothing;

alter table public.food_items add column fill int not null default 20 check (fill between 1 and 100);
update public.food_items set fill = case cat when 'meal' then 45 when 'snack' then 20 when 'dessert' then 20
  when 'fruit' then 20 when 'drink' then 10 else 20 end;

create table public.user_satiety (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  value numeric not null default 50 check (value between 0 and 100),
  updated_at timestamptz not null default now()
);
alter table public.user_satiety enable row level security;
create policy user_satiety_own on public.user_satiety for select to authenticated using (user_id = auth.uid());

-- current satiety after decay (new players start at 50)
create function public._satiety(p_user uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select greatest(0, value - _setting_int('satiety_decay_per_hour', 12) * extract(epoch from (_clock() - updated_at)) / 3600.0)
                     from user_satiety where user_id = p_user), 50);
$$;
revoke execute on function public._satiety(uuid) from anon, public, authenticated;

create or replace function public.my_food_today() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._assert_active();
begin
  return jsonb_build_object('eaten', (select count(*) from food_eats where user_id = v_uid and day = _bkk_day()),
                            'max', _setting_int('food_daily_max', 4),
                            'satiety', round(_satiety(v_uid))::int,
                            'eat_below', _setting_int('satiety_eat_below', 70),
                            'decay', _setting_int('satiety_decay_per_hour', 12));
end $$;

create or replace function public.eat_food(p_food text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); f food_items%rowtype; b user_buffs%rowtype; v_until timestamptz; v_pct int; v_now timestamptz := _clock(); v_sat numeric;
begin
  select * into f from food_items where id = p_food;
  if not found then raise exception 'food not available'; end if;
  perform 1 from profiles where id = v_uid for update;
  if (select count(*) from food_eats where user_id = v_uid and day = _bkk_day()) >= _setting_int('food_daily_max', 4) then raise exception 'eat limit'; end if;
  v_sat := _satiety(v_uid);
  if v_sat > _setting_int('satiety_eat_below', 70) then raise exception 'too full'; end if;
  update user_food set qty = qty - 1 where user_id = v_uid and food_id = p_food and qty > 0;
  if not found then raise exception 'none left'; end if;
  insert into food_eats (user_id, food_id, day, eaten_at) values (v_uid, p_food, _bkk_day(), v_now);
  insert into user_satiety (user_id, value, updated_at) values (v_uid, least(100, v_sat + f.fill), v_now)
    on conflict (user_id) do update set value = excluded.value, updated_at = excluded.updated_at;
  select * into b from user_buffs where user_id = v_uid and kind = f.buff_kind for update;
  if found and b.until > v_now then
    v_pct := greatest(b.pct, f.buff_pct);
    v_until := least(v_now + interval '12 hours', b.until + make_interval(mins => f.buff_min));
  else
    v_pct := f.buff_pct; v_until := v_now + make_interval(mins => f.buff_min);
  end if;
  insert into user_buffs (user_id, kind, pct, until, source) values (v_uid, f.buff_kind, v_pct, v_until, f.name)
    on conflict (user_id, kind) do update set pct = excluded.pct, until = excluded.until, source = excluded.source;
  return jsonb_build_object('food', f.id, 'kind', f.buff_kind, 'pct', v_pct, 'until', v_until, 'satiety', round(least(100, v_sat + f.fill))::int);
end $$;
