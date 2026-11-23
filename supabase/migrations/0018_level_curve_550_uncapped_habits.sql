-- Level curve: total EXP for level L = 550 * (L-1)^2  (Lv2 = 550, Lv3 = 2,200, Lv5 = 8,800, Lv10 = 44,550)
-- Habit EXP cap: habit_exp_cap = 0 now means "no daily cap" — every habit pays its full EXP.

create or replace function public._habit_room(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when _setting_int('habit_exp_cap', 0) <= 0 then 2147483647
              else greatest(0, _setting_int('habit_exp_cap', 0) - _habit_exp_today(p_user)) end
$$;
revoke execute on function public._habit_room(uuid) from public, anon, authenticated;

do $$
declare
  fn text; def text; newdef text;
  old_room constant text := 'greatest(0, _setting_int(''habit_exp_cap'', 60) - _habit_exp_today(v_uid))';
begin
  foreach fn in array array['public.log_habit(text,double precision,double precision,text)', 'public.log_walk(text,numeric,integer)'] loop
    def := pg_get_functiondef(fn::regprocedure);
    newdef := replace(def, old_room, '_habit_room(v_uid)');
    if newdef = def then raise exception 'cap line not found in %', fn; end if;
    execute newdef;
  end loop;

  def := pg_get_functiondef('public._grant_exp(uuid,integer)'::regprocedure);
  newdef := replace(def, '/ 250.0', '/ 550.0');
  if newdef = def then raise exception 'level formula not found in _grant_exp'; end if;
  execute newdef;

  def := pg_get_functiondef('public.my_planner_day()'::regprocedure);
  newdef := replace(def, '250 * power(', '550 * power(');
  if newdef = def then raise exception 'level formula not found in my_planner_day'; end if;
  execute newdef;
end $$;

update public.app_settings set value = '0', updated_at = now() where key = 'habit_exp_cap';
update public.profiles set base_level = floor(sqrt(base_exp / 550.0))::int + 1;
