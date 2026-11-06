-- Real-life Quest — planner: daily, monthly and personal quests, the daily chest and streaks.
-- These raise the LIFE level only. Career ranks come from confirmed real work and are never touched here.
-- Days and months follow Bangkok time.

alter table public.profiles
  add column streak_days int not null default 0,
  add column last_chest_day date;

create table public.level_tiers (
  min_level int primary key,
  daily_slots int not null,
  monthly_slots int not null,
  personal_slots int not null
);
insert into public.level_tiers values
  (1, 3, 1, 3), (5, 4, 2, 5), (10, 5, 3, 8), (20, 6, 4, 10), (35, 6, 5, 12), (50, 7, 6, 15), (70, 8, 8, 20);

create function public._tier(p_level int)
returns public.level_tiers
language sql
stable
set search_path = public
as $$ select * from public.level_tiers where min_level <= greatest(p_level, 1) order by min_level desc limit 1 $$;

create function public._bkk_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

create function public._bkk_start(p_day date)
returns timestamptz
language sql
stable
as $$ select (p_day::timestamp at time zone 'Asia/Bangkok') $$;

-- ---------- daily system quests ----------
create table public.daily_templates (
  id text primary key,
  title text not null,
  min_level int not null default 1,
  metric text not null check (metric in ('login','quest_done','review','guild_action','checkin','personal_done','family','apply','post')),
  target int not null default 1,
  exp int not null,
  sort int not null default 0
);
insert into public.daily_templates (id, title, min_level, metric, target, exp, sort) values
  ('d_login', 'เข้าเกมและเช็กกระเป๋าเงิน', 1, 'login', 1, 10, 1),
  ('d_personal', 'ทำเควสต์ส่วนตัวสำเร็จ 1 ข้อ', 1, 'personal_done', 1, 15, 2),
  ('d_quest', 'ทำเควสต์ในกระดานสำเร็จ 1 งาน', 1, 'quest_done', 1, 40, 3),
  ('d_review', 'ให้รีวิวหลังจบงาน 1 ครั้ง', 5, 'review', 1, 15, 4),
  ('d_guild', 'สมทบหรือโหวตในกิลด์ 1 ครั้ง', 10, 'guild_action', 1, 20, 5),
  ('d_checkin', 'เช็กอินหน้างาน 1 ครั้ง', 20, 'checkin', 1, 20, 6),
  ('d_family', 'มอบหรือทำเควสต์ครอบครัว 1 งาน', 50, 'family', 1, 20, 7),
  ('d_post', 'จ้างงานคนอื่น 1 งาน', 70, 'post', 1, 20, 8);

create table public.daily_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  template_id text not null references public.daily_templates(id),
  exp int not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, day, template_id)
);
create index daily_claims_template_idx on public.daily_claims (template_id);

create table public.daily_chests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  exp int not null,
  streak int not null,
  primary key (user_id, day)
);

-- ---------- personal quests ----------
create table public.personal_quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  category text not null check (category in ('health','study','money','home','discipline','other')),
  repeat text not null check (repeat in ('daily','weekly','monthly')),
  target int not null default 1 check (target between 1 and 1000),
  unit text check (char_length(unit) <= 20),
  difficulty int not null default 1 check (difficulty between 1 and 3),
  exp int not null,
  family_verify boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index personal_quests_user_idx on public.personal_quests (user_id, active);

create table public.personal_logs (
  pq_id uuid not null references public.personal_quests(id) on delete cascade,
  period_key text not null,
  progress int not null default 0,
  done_at timestamptz,
  exp_awarded int not null default 0,
  verify_status text not null default 'none' check (verify_status in ('none','self','pending','verified')),
  verified_by uuid references public.profiles(id),
  primary key (pq_id, period_key)
);
create index personal_logs_done_idx on public.personal_logs (done_at);
create index personal_logs_verifier_idx on public.personal_logs (verified_by);

create function public._period_key(p_repeat text, p_day date)
returns text
language sql
immutable
as $$
  select case p_repeat when 'daily' then to_char(p_day, 'YYYY-MM-DD')
                       when 'weekly' then to_char(p_day, 'IYYY-"W"IW')
                       else to_char(p_day, 'YYYY-MM') end
$$;

-- Personal EXP already earned today, split by how it was verified.
create function public._personal_exp_today(p_user uuid, p_status text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.exp_awarded), 0)::int from personal_logs l join personal_quests p on p.id = l.pq_id
   where p.user_id = p_user and l.verify_status = p_status
     and l.done_at >= _bkk_start(_bkk_today()) and l.done_at < _bkk_start(_bkk_today() + 1)
$$;

-- ---------- metrics ----------
create function public._daily_metric(p_user uuid, p_metric text, p_day date)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare a timestamptz := _bkk_start(p_day); b timestamptz := _bkk_start(p_day + 1);
begin
  return case p_metric
    when 'login' then 1
    when 'quest_done' then (select count(*) from quests where worker_id = p_user and status = 'completed' and family_id is null and completed_at >= a and completed_at < b)
    when 'review' then (select count(*) from reviews where reviewer_id = p_user and created_at >= a and created_at < b)
    when 'guild_action' then (select count(*) from transactions where user_id = p_user and kind = 'guild_contribute' and created_at >= a and created_at < b)
                          + (select count(*) from guild_votes where user_id = p_user and voted_at >= a and voted_at < b)
    when 'checkin' then (select count(*) from work_sessions where worker_id = p_user and started_at >= a and started_at < b)
    when 'personal_done' then (select count(*) from personal_logs l join personal_quests p on p.id = l.pq_id
                                where p.user_id = p_user and l.done_at >= a and l.done_at < b)
    when 'family' then (select count(*) from quests where family_id is not null and (poster_id = p_user or worker_id = p_user)
                          and ((status = 'completed' and completed_at >= a and completed_at < b) or (created_at >= a and created_at < b)))
    when 'apply' then (select count(*) from quest_applications where worker_id = p_user and created_at >= a and created_at < b)
    when 'post' then (select count(*) from quests where poster_id = p_user and family_id is null and created_at >= a and created_at < b)
    else 0 end;
end $$;

-- ---------- today ----------
create function public.my_planner_day()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  v_day date := _bkk_today();
  p profiles%rowtype;
  t level_tiers%rowtype;
  v_dailies jsonb; v_personal jsonb; v_all_claimed boolean; v_personal_done boolean; v_streak int;
begin
  select * into p from profiles where id = v_uid;
  t := _tier(p.base_level);
  select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb), coalesce(bool_and((x->>'claimed')::boolean), true)
    into v_dailies, v_all_claimed
    from (select jsonb_build_object('id', d.id, 'title', d.title, 'target', d.target, 'exp', d.exp, 'sort', lpad(d.sort::text, 3, '0'),
                   'progress', least(d.target, _daily_metric(v_uid, d.metric, v_day)),
                   'claimed', exists (select 1 from daily_claims c where c.user_id = v_uid and c.day = v_day and c.template_id = d.id)) x
            from daily_templates d where d.min_level <= p.base_level order by d.sort limit t.daily_slots) s;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'category', q.category, 'repeat', q.repeat,
           'target', q.target, 'unit', q.unit, 'exp', q.exp, 'family_verify', q.family_verify,
           'period', _period_key(q.repeat, v_day), 'progress', coalesce(l.progress, 0),
           'done', l.done_at is not null, 'verify_status', coalesce(l.verify_status, 'none')) order by q.created_at), '[]'::jsonb),
         coalesce(bool_and(l.done_at is not null) filter (where q.repeat = 'daily'), true)
    into v_personal, v_personal_done
    from personal_quests q left join personal_logs l on l.pq_id = q.id and l.period_key = _period_key(q.repeat, v_day)
   where q.user_id = v_uid and q.active;
  v_streak := case when p.last_chest_day >= v_day - 1 then p.streak_days else 0 end;
  return jsonb_build_object(
    'day', v_day, 'level', p.base_level, 'exp', p.base_exp,
    'next_level_exp', 250 * power(p.base_level, 2), 'level_start_exp', 250 * power(p.base_level - 1, 2),
    'tier', to_jsonb(t), 'extra_personal_slots', p.extra_personal_slots,
    'streak', v_streak, 'chest_claimed', p.last_chest_day = v_day,
    'chest_ready', p.last_chest_day is distinct from v_day and v_all_claimed and v_personal_done,
    'chest_exp', round(150 * (1 + least(v_streak, 10) * 0.05)),
    'dailies', v_dailies, 'personal', v_personal,
    'personal_exp_today', _personal_exp_today(v_uid, 'self'),
    'personal_cap', _setting_int('personal_exp_cap', 100));
end $$;

create function public.claim_daily(p_template text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); v_day date := _bkk_today(); p profiles%rowtype; d daily_templates%rowtype;
begin
  select * into p from profiles where id = v_uid;
  select * into d from daily_templates where id = p_template;
  if not found or d.id not in (select x.id from daily_templates x where x.min_level <= p.base_level
                                order by x.sort limit (_tier(p.base_level)).daily_slots) then
    raise exception 'quest not in your slots';
  end if;
  if _daily_metric(v_uid, d.metric, v_day) < d.target then raise exception 'not done yet'; end if;
  insert into daily_claims (user_id, day, template_id, exp) values (v_uid, v_day, d.id, d.exp);
  return _grant_exp(v_uid, d.exp);
end $$;

-- All of today's system quests claimed and every daily personal quest done -> chest. Streak bonus up to +50%.
create function public.claim_daily_chest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active(); v_day date := _bkk_today();
  s jsonb; p profiles%rowtype; v_streak int; v_exp int;
begin
  s := my_planner_day();
  if (s->>'chest_claimed')::boolean then raise exception 'already opened today'; end if;
  if not (s->>'chest_ready')::boolean then raise exception 'not done yet'; end if;
  select * into p from profiles where id = v_uid for update;
  v_streak := case when p.last_chest_day = v_day - 1 then p.streak_days + 1 else 1 end;
  v_exp := round(150 * (1 + least(v_streak - 1, 10) * 0.05));
  update profiles set streak_days = v_streak, last_chest_day = v_day where id = v_uid;
  insert into daily_chests (user_id, day, exp, streak) values (v_uid, v_day, v_exp, v_streak);
  perform _grant_exp(v_uid, v_exp);
  return jsonb_build_object('exp', v_exp, 'streak', v_streak);
end $$;

-- ---------- personal quests ----------
create function public.create_personal_quest(p_title text, p_category text, p_repeat text, p_target int,
                                             p_unit text, p_difficulty int, p_family_verify boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); p profiles%rowtype; v_id uuid;
begin
  select * into p from profiles where id = v_uid;
  if (select count(*) from personal_quests where user_id = v_uid and active) >= (_tier(p.base_level)).personal_slots + p.extra_personal_slots then
    raise exception 'no free personal slots';
  end if;
  if coalesce(p_family_verify, false) and public.my_family() is null then raise exception 'join a family to use family verification'; end if;
  insert into personal_quests (user_id, title, category, repeat, target, unit, difficulty, exp, family_verify)
  values (v_uid, trim(p_title), p_category, p_repeat, coalesce(p_target, 1), nullif(trim(p_unit), ''), coalesce(p_difficulty, 1),
          case coalesce(p_difficulty, 1) when 1 then 10 when 2 then 15 else 30 end
            * case p_repeat when 'weekly' then 3 when 'monthly' then 8 else 1 end,
          coalesce(p_family_verify, false))
  returning id into v_id;
  return v_id;
end $$;

create function public.archive_personal_quest(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update personal_quests set active = false where id = p_id and user_id = auth.uid() and active;
  if not found then raise exception 'quest not found'; end if;
end $$;

create function public.log_personal(p_pq uuid, p_amount int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  q personal_quests%rowtype; l personal_logs%rowtype;
  v_key text; v_exp int := 0; v_status text;
begin
  select * into q from personal_quests where id = p_pq and user_id = v_uid and active;
  if not found then raise exception 'quest not found'; end if;
  v_key := _period_key(q.repeat, _bkk_today());
  insert into personal_logs (pq_id, period_key) values (q.id, v_key) on conflict do nothing;
  select * into l from personal_logs where pq_id = q.id and period_key = v_key for update;
  if l.done_at is not null then return jsonb_build_object('progress', l.progress, 'done', true, 'exp', 0, 'verify_status', l.verify_status); end if;
  update personal_logs set progress = greatest(0, least(q.target, progress + coalesce(p_amount, 1)))
   where pq_id = q.id and period_key = v_key returning * into l;
  if l.progress >= q.target then
    if q.family_verify and exists (select 1 from family_members f where f.family_id = public.my_family()
                                     and f.role = 'parent' and f.left_at is null and f.user_id <> v_uid) then
      v_status := 'pending';
      insert into notifications (user_id, kind, title, body, link)
      select f.user_id, 'family', 'รอคุณยืนยันเควสต์ส่วนตัวของลูก', q.title, 'index.html#guild'
        from family_members f where f.family_id = public.my_family() and f.role = 'parent' and f.left_at is null and f.user_id <> v_uid;
    else
      v_status := 'self';
      v_exp := greatest(0, least(q.exp, _setting_int('personal_exp_cap', 100) - _personal_exp_today(v_uid, 'self')));
    end if;
    update personal_logs set done_at = now(), verify_status = v_status, exp_awarded = v_exp
     where pq_id = q.id and period_key = v_key returning * into l;
    if v_exp > 0 then perform _grant_exp(v_uid, v_exp); end if;
  end if;
  return jsonb_build_object('progress', l.progress, 'done', l.done_at is not null, 'exp', v_exp, 'verify_status', l.verify_status);
end $$;

-- A parent in the same family confirms a child's (or partner's) personal quest: double EXP, double cap.
create function public.verify_personal(p_pq uuid, p_period text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q personal_quests%rowtype; v_exp int;
begin
  select * into q from personal_quests where id = p_pq;
  if not found or q.user_id = v_uid then raise exception 'cannot verify this quest'; end if;
  if not exists (select 1 from family_members me join family_members them on them.family_id = me.family_id
                  where me.user_id = v_uid and me.role = 'parent' and me.left_at is null
                    and them.user_id = q.user_id and them.left_at is null) then
    raise exception 'parents in the same family only';
  end if;
  v_exp := greatest(0, least(q.exp * 2, _setting_int('personal_exp_cap', 100) * 2 - _personal_exp_today(q.user_id, 'verified')));
  update personal_logs set verify_status = 'verified', verified_by = v_uid, exp_awarded = v_exp
   where pq_id = p_pq and period_key = p_period and verify_status = 'pending';
  if not found then raise exception 'nothing to verify'; end if;
  perform _grant_exp(q.user_id, v_exp);
  perform _notify(q.user_id, 'family', 'ผู้ปกครองยืนยันเควสต์ของคุณแล้ว', q.title || ' · +' || v_exp || ' EXP', 'index.html#plan');
  return v_exp;
end $$;

create function public.family_pending_verifications()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('pq_id', q.id, 'period', l.period_key, 'title', q.title, 'exp', q.exp * 2,
           'user', (select coalesce(display_name, username) from profiles where id = q.user_id), 'done_at', l.done_at)
           order by l.done_at), '[]'::jsonb)
    from personal_logs l join personal_quests q on q.id = l.pq_id
   where l.verify_status = 'pending'
     and exists (select 1 from family_members me join family_members them on them.family_id = me.family_id
                  where me.user_id = auth.uid() and me.role = 'parent' and me.left_at is null
                    and them.user_id = q.user_id and them.left_at is null and them.user_id <> auth.uid())
$$;

-- ---------- monthly quests ----------
create table public.monthly_templates (
  id text primary key,
  title text not null,
  min_level int not null default 1,
  metric text not null check (metric in ('quests_done','chest_days','five_star','guild_gold','endorsements_given','work_minutes','personal_done','family_done')),
  target int not null,
  exp int not null,
  sort int not null default 0
);
insert into public.monthly_templates (id, title, min_level, metric, target, exp, sort) values
  ('m_chest', 'เปิดหีบประจำวันครบ 20 วัน', 1, 'chest_days', 20, 500, 1),
  ('m_quests', 'ทำเควสต์ในกระดานสำเร็จ 20 งาน', 5, 'quests_done', 20, 600, 2),
  ('m_stars', 'ได้รีวิว 5 ดาว 10 ครั้ง', 10, 'five_star', 10, 400, 3),
  ('m_guild', 'สมทบกองทุนกิลด์รวม 500 G', 20, 'guild_gold', 500, 400, 4),
  ('m_mentor', 'รับรองฝีมือคนที่ทำงานด้วย 3 คน', 35, 'endorsements_given', 3, 500, 5),
  ('m_hours', 'ทำงานจริงรวม 80 ชั่วโมง', 50, 'work_minutes', 4800, 800, 6),
  ('m_personal', 'ทำเควสต์ส่วนตัวสำเร็จ 60 ครั้ง', 70, 'personal_done', 60, 600, 7),
  ('m_family', 'ทำเควสต์ครอบครัวร่วมกัน 10 งาน', 70, 'family_done', 10, 600, 8);

create table public.monthly_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  template_id text not null references public.monthly_templates(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, month, template_id)
);
create index monthly_claims_template_idx on public.monthly_claims (template_id);

create table public.monthly_track_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  step int not null check (step between 1 and 3),
  reward text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, month, step)
);

create function public._monthly_metric(p_user uuid, p_metric text, p_month date)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare a timestamptz := _bkk_start(p_month); b timestamptz := _bkk_start((p_month + interval '1 month')::date);
begin
  return case p_metric
    when 'quests_done' then (select count(*) from quests where worker_id = p_user and status = 'completed' and family_id is null and completed_at >= a and completed_at < b)
    when 'chest_days' then (select count(*) from daily_chests where user_id = p_user and day >= p_month and day < (p_month + interval '1 month')::date)
    when 'five_star' then (select count(*) from reviews where reviewee_id = p_user and reviewee_role = 'worker' and stars = 5 and created_at >= a and created_at < b)
    when 'guild_gold' then (select coalesce(-sum(gold_delta), 0) from transactions where user_id = p_user and kind = 'guild_contribute' and created_at >= a and created_at < b)
    when 'endorsements_given' then (select count(*) from endorsements where endorser_id = p_user and created_at >= a and created_at < b)
    when 'work_minutes' then (select coalesce(sum(minutes), 0) from work_sessions where worker_id = p_user and ended_at >= a and ended_at < b)
    when 'personal_done' then (select count(*) from personal_logs l join personal_quests q on q.id = l.pq_id where q.user_id = p_user and l.done_at >= a and l.done_at < b)
    when 'family_done' then (select count(*) from quests where family_id is not null and status = 'completed' and (poster_id = p_user or worker_id = p_user) and completed_at >= a and completed_at < b)
    else 0 end;
end $$;

create function public.my_planner_month()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  v_today date := _bkk_today();
  v_month date := date_trunc('month', v_today)::date;
  v_key text := to_char(v_today, 'YYYY-MM');
  p profiles%rowtype; t level_tiers%rowtype;
  v_templates jsonb; v_days jsonb; v_claimed int; v_track jsonb;
begin
  select * into p from profiles where id = v_uid;
  t := _tier(p.base_level);
  select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb) into v_templates
    from (select jsonb_build_object('id', m.id, 'title', m.title, 'target', m.target, 'exp', m.exp, 'min_level', m.min_level,
                   'sort', lpad(m.sort::text, 3, '0'),
                   'progress', least(m.target, _monthly_metric(v_uid, m.metric, v_month)),
                   'claimed', exists (select 1 from monthly_claims c where c.user_id = v_uid and c.month = v_key and c.template_id = m.id)) x
            from monthly_templates m where m.min_level <= p.base_level order by m.sort limit t.monthly_slots) s;
  select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
           'claims', (select count(*) from daily_claims c where c.user_id = v_uid and c.day = d::date),
           'chest', exists (select 1 from daily_chests c where c.user_id = v_uid and c.day = d::date)) order by d), '[]'::jsonb)
    into v_days
    from generate_series(v_month, (v_month + interval '1 month' - interval '1 day')::date, interval '1 day') d;
  select count(*) into v_claimed from monthly_claims where user_id = v_uid and month = v_key;
  select jsonb_agg(jsonb_build_object('step', s, 'claimed', exists (select 1 from monthly_track_claims c where c.user_id = v_uid and c.month = v_key and c.step = s),
           'label', case s when 1 then '+300 EXP' when 2 then 'การ์ดอาชีพ R สุ่ม' else 'ฉายา วีรชนประจำเดือน' end) order by s)
    into v_track from generate_series(1, 3) s;
  return jsonb_build_object('month', v_key, 'today', v_today, 'level', p.base_level, 'slots', t.monthly_slots,
    'templates', v_templates, 'days', v_days, 'claimed', v_claimed, 'track', v_track,
    'next_slot_level', (select min(min_level) from level_tiers where monthly_slots > t.monthly_slots));
end $$;

create function public.claim_monthly(p_template text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active(); v_today date := _bkk_today();
  p profiles%rowtype; m monthly_templates%rowtype;
begin
  select * into p from profiles where id = v_uid;
  select * into m from monthly_templates where id = p_template;
  if not found or m.id not in (select x.id from monthly_templates x where x.min_level <= p.base_level
                                order by x.sort limit (_tier(p.base_level)).monthly_slots) then
    raise exception 'quest not in your slots';
  end if;
  if _monthly_metric(v_uid, m.metric, date_trunc('month', v_today)::date) < m.target then raise exception 'not done yet'; end if;
  insert into monthly_claims (user_id, month, template_id) values (v_uid, to_char(v_today, 'YYYY-MM'), m.id);
  return _grant_exp(v_uid, m.exp);
end $$;

create function public.claim_monthly_track(p_step int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active(); v_key text := to_char(_bkk_today(), 'YYYY-MM');
  v_card text; v_reward text;
begin
  if p_step not between 1 and 3 then raise exception 'bad step'; end if;
  if (select count(*) from monthly_claims where user_id = v_uid and month = v_key) < p_step then raise exception 'not done yet'; end if;
  if exists (select 1 from monthly_track_claims where user_id = v_uid and month = v_key and step = p_step) then raise exception 'already claimed'; end if;
  if p_step = 1 then
    perform _grant_exp(v_uid, 300); v_reward := '+300 EXP';
  elsif p_step = 2 then
    select id into v_card from job_cards where rarity = 'R'
       and id not in (select card_id from user_cards where user_id = v_uid) order by random() limit 1;
    if v_card is null then perform _grant_exp(v_uid, 300); v_reward := '+300 EXP (มีการ์ด R ครบแล้ว)';
    else insert into user_cards (user_id, card_id) values (v_uid, v_card);
         v_reward := 'การ์ด ' || (select name from job_cards where id = v_card); end if;
  else
    if _give_item(v_uid, 'title_monthly_hero') then v_reward := 'ฉายา วีรชนประจำเดือน';
    else perform _grant_exp(v_uid, 500); v_reward := '+500 EXP (มีฉายาแล้ว)'; end if;
  end if;
  insert into monthly_track_claims (user_id, month, step, reward) values (v_uid, v_key, p_step, v_reward);
  return v_reward;
end $$;

-- ---------- row level security ----------
alter table public.level_tiers enable row level security;
alter table public.daily_templates enable row level security;
alter table public.daily_claims enable row level security;
alter table public.daily_chests enable row level security;
alter table public.personal_quests enable row level security;
alter table public.personal_logs enable row level security;
alter table public.monthly_templates enable row level security;
alter table public.monthly_claims enable row level security;
alter table public.monthly_track_claims enable row level security;
revoke insert, update, truncate on public.level_tiers, public.daily_templates, public.daily_claims, public.daily_chests,
  public.personal_quests, public.personal_logs, public.monthly_templates, public.monthly_claims, public.monthly_track_claims
  from anon, authenticated;
revoke all on public.level_tiers, public.daily_templates, public.daily_claims, public.daily_chests,
  public.personal_quests, public.personal_logs, public.monthly_templates, public.monthly_claims, public.monthly_track_claims from anon;
create policy "tiers readable" on public.level_tiers for select to authenticated using (true);
create policy "daily templates readable" on public.daily_templates for select to authenticated using (true);
create policy "monthly templates readable" on public.monthly_templates for select to authenticated using (true);
create policy "own daily claims" on public.daily_claims for select to authenticated using (user_id = (select auth.uid()));
create policy "own chests" on public.daily_chests for select to authenticated using (user_id = (select auth.uid()));
create policy "own personal quests" on public.personal_quests for select to authenticated using (user_id = (select auth.uid()));
create policy "own personal logs" on public.personal_logs for select to authenticated
  using (exists (select 1 from public.personal_quests q where q.id = pq_id and q.user_id = (select auth.uid())));
create policy "own monthly claims" on public.monthly_claims for select to authenticated using (user_id = (select auth.uid()));
create policy "own track claims" on public.monthly_track_claims for select to authenticated using (user_id = (select auth.uid()));

revoke execute on function public._tier(int), public._bkk_today(), public._bkk_start(date), public._period_key(text, date),
  public._personal_exp_today(uuid, text), public._daily_metric(uuid, text, date), public._monthly_metric(uuid, text, date)
  from public, anon, authenticated;
revoke execute on function public.my_planner_day(), public.claim_daily(text), public.claim_daily_chest(),
  public.create_personal_quest(text, text, text, int, text, int, boolean), public.archive_personal_quest(uuid),
  public.log_personal(uuid, int), public.verify_personal(uuid, text), public.family_pending_verifications(),
  public.my_planner_month(), public.claim_monthly(text), public.claim_monthly_track(int) from public, anon;
grant execute on function public.my_planner_day(), public.claim_daily(text), public.claim_daily_chest(),
  public.create_personal_quest(text, text, text, int, text, int, boolean), public.archive_personal_quest(uuid),
  public.log_personal(uuid, int), public.verify_personal(uuid, text), public.family_pending_verifications(),
  public.my_planner_month(), public.claim_monthly(text), public.claim_monthly_track(int) to authenticated;
