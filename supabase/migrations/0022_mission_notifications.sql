-- Real-life Quest — mission push notifications.
-- 1) success pushes: habit done / quest completed, with the EXP actually earned
-- 2) reminder pushes: "ภารกิจ “X” ยังไม่สำเร็จ" at a time set per habit
-- Pushes ride the existing pipeline: every row inserted into notifications is sent by the send-push function.

alter table public.habit_templates add column if not exists remind_at time;
alter table public.profiles
  add column if not exists notify_success boolean not null default true,
  add column if not exists notify_remind boolean not null default true;

-- one reminder per user, habit and day
create table if not exists public.habit_reminders_sent (
  user_id uuid not null references public.profiles(id) on delete cascade,
  habit_id text not null references public.habit_templates(id) on delete cascade,
  day date not null,
  primary key (user_id, habit_id, day)
);
alter table public.habit_reminders_sent enable row level security;
revoke all on public.habit_reminders_sent from anon, authenticated;

-- ---------- helpers ----------
create or replace function public._notify_done(p_user uuid, p_title text, p_body text, p_link text default 'index.html#plan')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select notify_success from profiles where id = p_user), true) then
    perform _notify(p_user, 'done', p_title, p_body, p_link);
  end if;
end $$;

create or replace function public.set_notify_prefs(p_success boolean, p_remind boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active();
begin
  update profiles set notify_success = coalesce(p_success, notify_success), notify_remind = coalesce(p_remind, notify_remind) where id = v_uid;
end $$;

-- ---------- success pushes: patch the live functions ----------
do $$
declare def text; newdef text;
begin
  -- habits with a photo / place / none check
  def := pg_get_functiondef('public.log_habit(text,double precision,double precision,text)'::regprocedure);
  newdef := replace(def, 'return jsonb_build_object(''id'', v_id, ''exp'', v_exp, ''status'', v_status',
    'if v_status = ''ok'' then perform _notify_done(v_uid, ''“'' || h.title || ''” สำเร็จ'', case when v_exp > 0 then ''+'' || v_exp || '' EXP'' else ''บันทึกแล้ว'' end);
     else perform _notify_done(v_uid, ''“'' || h.title || ''” ส่งแล้ว'', ''รอผู้ปกครองรับรอง''); end if;
  return jsonb_build_object(''id'', v_id, ''exp'', v_exp, ''status'', v_status');
  if newdef = def then raise exception 'log_habit anchor not found'; end if;
  execute newdef;

  -- GPS walking habits
  def := pg_get_functiondef('public.log_walk(text,numeric,integer)'::regprocedure);
  newdef := replace(def, 'return jsonb_build_object(''id'', v_id, ''exp'', v_exp, ''status'', ''ok''',
    'perform _notify_done(v_uid, ''“'' || h.title || ''” สำเร็จ'', case when v_exp > 0 then ''+'' || v_exp || '' EXP'' else ''บันทึกแล้ว'' end);
  return jsonb_build_object(''id'', v_id, ''exp'', v_exp, ''status'', ''ok''');
  if newdef = def then raise exception 'log_walk anchor not found'; end if;
  execute newdef;

  -- quests: tell the worker when the job is settled in their favour
  def := pg_get_functiondef('public._settle(uuid,integer,text)'::regprocedure);
  newdef := replace(def, 'update profiles set quests_done = quests_done + 1 where id = q.worker_id;',
    'update profiles set quests_done = quests_done + 1 where id = q.worker_id;
    perform _notify_done(q.worker_id, ''เควสต์ “'' || q.title || ''” สำเร็จ'',
      ''+'' || v_exp || '' EXP'' || case when v_gross > 0 then '' · +'' || v_gross || '' G'' else '''' end, ''index.html#quest-'' || q.id);');
  if newdef = def then raise exception '_settle anchor not found'; end if;
  execute newdef;
end $$;

-- ---------- reminders ----------
create or replace function public.send_habit_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare h habit_templates%rowtype; u record; v_day date := _bkk_day(); v_now time := _bkk_now_time(); v_n int := 0;
begin
  delete from habit_reminders_sent where day < v_day - 7;
  for h in select * from habit_templates
            where active and remind_at is not null and v_now >= remind_at and v_now < remind_at + interval '15 minutes' loop
    for u in select p.id from profiles p
              where p.notify_remind
                and exists (select 1 from push_subscriptions s where s.user_id = p.id and s.active)
                and not exists (select 1 from habit_reminders_sent r where r.user_id = p.id and r.habit_id = h.id and r.day = v_day)
                and not exists (select 1 from habit_logs l where l.user_id = p.id and l.habit_id = h.id and l.day = v_day and l.status <> 'rejected') loop
      -- only people who can actually do it right now (right role, inside the time window, place set ...)
      if _habit_block(u.id, h) is null then
        insert into habit_reminders_sent (user_id, habit_id, day) values (u.id, h.id, v_day) on conflict do nothing;
        perform _notify(u.id, 'reminder', 'ภารกิจ “' || h.title || '” ยังไม่สำเร็จ', 'ทำตอนนี้ได้ +' || h.exp || ' EXP', 'index.html#plan');
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('rlq-habit-reminders', '*/5 * * * *', 'select public.send_habit_reminders()');
  end if;
exception when others then raise notice 'could not schedule reminders: %', sqlerrm;
end $$;

-- sensible starting times (staff can change them in the back office)
update public.habit_templates set remind_at = case id
  when 'brush' then '07:30' when 'breakfast' then '08:00' when 'water' then '10:00' when 'lunch' then '12:30'
  when 'exercise' then '17:30' when 'dinner' then '18:30' when 'homework' then '19:00' when 'budget' then '21:00'
  when 'sleep_early' then '21:00' end::time
where id in ('brush','breakfast','water','lunch','exercise','dinner','homework','budget','sleep_early') and remind_at is null;

-- ---------- back office ----------
create or replace function public.admin_habits()
returns table (id text, title text, grp text, exp int, remind_at time, active boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_perm('q.review', 'view') then raise exception 'forbidden'; end if;
  return query select t.id, t.title, t.grp, t.exp, t.remind_at, t.active from habit_templates t order by t.sort;
end $$;

create or replace function public.admin_set_habit_reminder(p_habit text, p_time time)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('q.review') then raise exception 'forbidden'; end if;
  update habit_templates set remind_at = p_time where id = p_habit;
  if not found then raise exception 'habit not found'; end if;
end $$;

revoke all on function public._notify_done(uuid, text, text, text), public.send_habit_reminders() from public, anon, authenticated;
revoke all on function public.set_notify_prefs(boolean, boolean), public.admin_habits(), public.admin_set_habit_reminder(text, time) from public, anon;
grant execute on function public.set_notify_prefs(boolean, boolean), public.admin_habits(), public.admin_set_habit_reminder(text, time) to authenticated;
