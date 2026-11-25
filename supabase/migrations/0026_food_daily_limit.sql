-- 0026: at most food_daily_max (default 4) dishes eaten per Bangkok day.
insert into public.app_settings (key, value) values ('food_daily_max', '4') on conflict (key) do nothing;
create table public.food_eats (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  food_id text not null references public.food_items(id),
  day date not null,
  eaten_at timestamptz not null default now()
);
create index food_eats_user_day on public.food_eats (user_id, day);
alter table public.food_eats enable row level security;
create policy food_eats_own on public.food_eats for select to authenticated using (user_id = auth.uid());

create function public.my_food_today() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._assert_active();
begin
  return jsonb_build_object('eaten', (select count(*) from food_eats where user_id = v_uid and day = _bkk_day()),
                            'max', _setting_int('food_daily_max', 4));
end $$;
grant execute on function public.my_food_today() to authenticated;
revoke execute on function public.my_food_today() from anon, public;

create or replace function public.eat_food(p_food text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); f food_items%rowtype; b user_buffs%rowtype; v_until timestamptz; v_pct int; v_now timestamptz := _clock();
begin
  select * into f from food_items where id = p_food;
  if not found then raise exception 'food not available'; end if;
  perform 1 from profiles where id = v_uid for update;
  if (select count(*) from food_eats where user_id = v_uid and day = _bkk_day()) >= _setting_int('food_daily_max', 4) then raise exception 'eat limit'; end if;
  update user_food set qty = qty - 1 where user_id = v_uid and food_id = p_food and qty > 0;
  if not found then raise exception 'none left'; end if;
  insert into food_eats (user_id, food_id, day, eaten_at) values (v_uid, p_food, _bkk_day(), v_now);
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
grant execute on function public.eat_food(text) to authenticated;
