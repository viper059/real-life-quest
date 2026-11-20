-- "เดินเพื่อสุขภาพ" — GPS-measured walking-distance quests. Self-verifying (no parent needed for
-- anyone, including students without a parent in the system): the distance + a plausible-speed
-- check (reject car/teleport-speed submissions) IS the proof, same spirit as the existing
-- location-based go_school/go_work check-ins which also skip the parent gate.

alter table public.habit_templates drop constraint habit_templates_grp_check;
alter table public.habit_templates add constraint habit_templates_grp_check
  check (grp in ('body','food','health','home','mind','student','worker','walk'));

alter table public.habit_templates drop constraint habit_templates_verify_check;
alter table public.habit_templates add constraint habit_templates_verify_check
  check (verify in ('none','photo','location','parent','gps'));

alter table public.habit_templates add column if not exists target_m integer check (target_m is null or target_m between 10 and 50000);

insert into public.habit_templates (id, title, grp, icon, exp, max_per_day, min_gap_min, verify, target_m, hint, sort) values
  ('walk_50',  'เดิน 50 เมตร',        'walk', '🚶', 2,  4, 20, 'gps', 50,   'กดเริ่มเดิน แอปจะวัดระยะทางจาก GPS ให้อัตโนมัติ', 70),
  ('walk_100', 'เดิน 100 เมตร',       'walk', '🚶', 3,  4, 20, 'gps', 100,  'กดเริ่มเดิน แอปจะวัดระยะทางจาก GPS ให้อัตโนมัติ', 71),
  ('walk_400', 'เดิน 400 เมตร',       'walk', '🏃', 6,  3, 30, 'gps', 400,  'กดเริ่มเดิน แอปจะวัดระยะทางจาก GPS ให้อัตโนมัติ', 72),
  ('walk_1km', 'เดิน 1 กิโลเมตร',     'walk', '🏃', 12, 2, 45, 'gps', 1000, 'กดเริ่มเดิน แอปจะวัดระยะทางจาก GPS ให้อัตโนมัติ', 73)
on conflict (id) do nothing;

create or replace function public.my_habits()
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
    'life_role', (select life_role from profiles where id = v_uid),
    'role_locked_until', (select life_role_set_at + interval '30 days' from profiles where id = v_uid),
    'places', coalesce((select jsonb_object_agg(kind, jsonb_build_object('set_at', set_at,
                 'locked_until', set_at + interval '30 days')) from user_places where user_id = v_uid), '{}'::jsonb),
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'title', h.title, 'grp', h.grp, 'icon', h.icon, 'exp', h.exp, 'max', h.max_per_day,
        'gap', h.min_gap_min, 'from', to_char(h.window_start, 'HH24:MI'), 'to', to_char(h.window_end, 'HH24:MI'),
        'weekdays_only', h.weekdays_only, 'verify', h.verify, 'place', h.place, 'target_m', h.target_m, 'hint', h.hint,
        'count', (select count(*) from habit_logs l where l.user_id = v_uid and l.habit_id = h.id and l.day = v_day and l.status <> 'rejected'),
        'pending', (select count(*) from habit_logs l where l.user_id = v_uid and l.habit_id = h.id and l.day = v_day and l.status = 'pending'),
        'next_at', (select max(logged_at) + make_interval(mins => h.min_gap_min) from habit_logs l
                     where l.user_id = v_uid and l.habit_id = h.id and l.day = v_day and l.status <> 'rejected'),
        'block', _habit_block(v_uid, h)) order by h.sort) from habit_templates h where h.active), '[]'::jsonb));
end $$;

create or replace function public.log_walk(p_habit text, p_distance_m numeric, p_duration_s int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  h habit_templates%rowtype; v_block text; v_exp int; v_room int; v_id bigint; v_speed numeric;
begin
  select * into h from habit_templates where id = p_habit and verify = 'gps';
  if not found then raise exception 'habit not found'; end if;
  perform 1 from profiles where id = v_uid for update;  -- one log at a time per player
  v_block := _habit_block(v_uid, h);
  if v_block is not null then raise exception '%', v_block; end if;
  if p_distance_m is null or p_duration_s is null or p_duration_s <= 0 then raise exception 'invalid walk data'; end if;
  if p_distance_m < h.target_m * 0.95 then raise exception 'not far enough yet'; end if;
  v_speed := p_distance_m / p_duration_s; -- m/s
  if v_speed > 4.0 then raise exception 'too fast to be walking'; end if;
  if p_duration_s < h.target_m / 4.0 then raise exception 'too fast to be walking'; end if;

  v_room := greatest(0, _setting_int('habit_exp_cap', 60) - _habit_exp_today(v_uid));
  v_exp := least(h.exp, v_room);
  insert into habit_logs (user_id, habit_id, day, logged_at, exp, status)
  values (v_uid, h.id, _bkk_day(), _clock(), v_exp, 'ok')
  returning id into v_id;
  if v_exp > 0 then perform _grant_exp(v_uid, v_exp); end if;
  return jsonb_build_object('id', v_id, 'exp', v_exp, 'status', 'ok', 'capped', v_exp < h.exp);
end $$;

revoke execute on function public.log_walk(text, numeric, int) from public, anon;
grant execute on function public.log_walk(text, numeric, int) to authenticated;
