-- Real-life Quest — quests v2: career-matched applications, job-site location, check-in hours,
-- reviews, disputes, chat. Wages are real baht paid by the poster straight to the worker (PromptPay QR or cash);
-- the platform never holds wage money. Posting costs a small Gold fee (platform revenue, burned).
-- Family quests keep their Gold reward held in escrow inside the app.

insert into public.app_settings (key, value) values
  ('post_fee_gold', '10'),
  ('urgent_fee_gold', '20'),
  ('career_min_wage_hour', '40'),
  ('auto_release_hours', '72'),
  ('checkin_radius_m', '300')
on conflict (key) do nothing;

alter table public.quests
  add column est_minutes int not null default 60 check (est_minutes between 10 and 10080),
  add column due_at timestamptz,
  add column instant boolean not null default false,
  add column remote boolean not null default false,
  add column approx_lat numeric(6,2),
  add column approx_lng numeric(6,2),
  add column applicant_count int not null default 0,
  add column dispute_open boolean not null default false,
  add column assigned_at timestamptz,
  add column submitted_at timestamptz,
  add column auto_release_at timestamptz,
  add column completed_at timestamptz,
  add column worker_minutes int not null default 0,
  add column career_counted boolean not null default false,
  add column wage_baht numeric(10,2) not null default 0 check (wage_baht >= 0 and wage_baht <= 100000),
  add column pay_method text not null default 'either' check (pay_method in ('promptpay','cash','either')),
  add column payment_status text not null default 'none'
    check (payment_status in ('none','due','paid','received','unpaid_reported','written_off')),
  add column payment_due_baht numeric(10,2),
  add column paid_at timestamptz,
  add column received_at timestamptz,
  add column post_fee_gold bigint not null default 0;
-- Public quests carry no Gold reward any more (wage is paid in baht outside the app).
alter table public.quests drop constraint quests_reward_gold_check;
alter table public.quests add constraint quests_reward_gold_check check (reward_gold >= 0);
create index quests_payment_idx on public.quests (poster_id, payment_status);

alter table public.profiles add column unpaid_count int not null default 0;
-- Where the worker receives wages. Shown only to the poster of a quest they finished.
alter table public.private_profiles
  add column promptpay_id text check (promptpay_id ~ '^([0-9]{10}|[0-9]{13})$');
create index quests_due_idx on public.quests (status, due_at);
create index quests_release_idx on public.quests (status, auto_release_at);

-- Exact address is shown only to the poster, the assigned worker and staff.
create table public.quest_locations (
  quest_id uuid primary key references public.quests(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  address text check (char_length(address) <= 300)
);

create table public.quest_applications (
  quest_id uuid not null references public.quests(id) on delete cascade,
  worker_id uuid not null references public.profiles(id) on delete cascade,
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  primary key (quest_id, worker_id)
);
create index quest_applications_worker_idx on public.quest_applications (worker_id, status);

create table public.work_sessions (
  id bigint generated always as identity primary key,
  quest_id uuid not null references public.quests(id) on delete cascade,
  worker_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_lat double precision, start_lng double precision,
  end_lat double precision, end_lng double precision,
  start_photo text, end_photo text,
  minutes int not null default 0
);
create unique index work_sessions_one_open on public.work_sessions (quest_id) where ended_at is null;
create index work_sessions_quest_idx on public.work_sessions (quest_id);
create index work_sessions_worker_idx on public.work_sessions (worker_id, started_at);

create table public.reviews (
  id bigint generated always as identity primary key,
  quest_id uuid not null references public.quests(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_role text not null check (reviewee_role in ('worker','poster')),
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (quest_id, reviewer_id)
);
create index reviews_reviewee_idx on public.reviews (reviewee_id, created_at desc);
create index reviews_reviewer_idx on public.reviews (reviewer_id, created_at);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  opened_by uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 5 and 1000),
  evidence text[] not null default '{}',
  status text not null default 'open' check (status in ('open','resolved')),
  worker_pct int check (worker_pct between 0 and 100),
  resolution_note text,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index disputes_one_open on public.disputes (quest_id) where status = 'open';
create index disputes_status_idx on public.disputes (status, created_at);
create index disputes_opened_by_idx on public.disputes (opened_by);
create index disputes_resolved_by_idx on public.disputes (resolved_by);

create table public.messages (
  id bigint generated always as identity primary key,
  quest_id uuid not null references public.quests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  is_staff boolean not null default false,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_quest_idx on public.messages (quest_id, created_at);
create index messages_sender_idx on public.messages (sender_id);

-- ---------- helpers ----------
create function public._distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create function public._setting_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public
as $$ select coalesce(nullif((select value from public.app_settings where key = p_key), '')::int, p_default) $$;

-- Life level: slow square-root curve, 3 stat points per level gained.
create function public._grant_exp(p_user uuid, p_exp int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_old bigint; v_old_lv int; v_new_lv int;
begin
  if p_exp <= 0 then return (select base_level from profiles where id = p_user); end if;
  select base_exp into v_old from profiles where id = p_user for update;
  v_old_lv := floor(sqrt(v_old / 250.0))::int + 1;
  v_new_lv := floor(sqrt((v_old + p_exp) / 250.0))::int + 1;
  update profiles set base_exp = base_exp + p_exp, base_level = v_new_lv,
         stat_points = stat_points + 3 * greatest(0, v_new_lv - v_old_lv)
   where id = p_user;
  if v_new_lv > v_old_lv then
    perform _notify(p_user, 'level', 'เลเวลอัป! Lv ' || v_new_lv, 'ได้แต้มค่าสถานะ +' || 3 * (v_new_lv - v_old_lv), 'index.html#char');
  end if;
  return v_new_lv;
end $$;

-- Existing users move onto the new curve.
update public.profiles set base_level = floor(sqrt(base_exp / 250.0))::int + 1;

-- Why a person may not take a quest (null = allowed).
create function public._eligibility(p_uid uuid, p_quest uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare q quests%rowtype; p profiles%rowtype; o occupations%rowtype; v_rank text;
begin
  select * into q from quests where id = p_quest;
  if not found then return 'quest not found'; end if;
  select * into p from profiles where id = p_uid;
  if p.banned_until is not null and p.banned_until > now() then return 'account banned'; end if;
  if q.poster_id = p_uid then return 'own quest'; end if;
  if q.family_id is not null then
    return case when exists (select 1 from family_members where user_id = p_uid and family_id = q.family_id
                              and role = 'child' and left_at is null) then null else 'family only' end;
  end if;
  if p.kyc_status <> 'verified' then return 'identity not verified'; end if;
  select * into o from occupations where id = q.category;
  if found and (o.license_required or q.rank <> 'F') then
    select rank into v_rank from user_careers where user_id = p_uid and occupation_id = q.category;
    if v_rank is null or _rank_ord(v_rank) < _rank_ord(q.rank) then return 'career rank too low'; end if;
  end if;
  return null;
end $$;

create function public.quest_eligibility(p_quest uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', r is null, 'reason', r) from (select public._eligibility(auth.uid(), p_quest) as r) x
$$;

-- ---------- posting ----------
create function public.post_quest_v2(
  p_title text, p_description text, p_category text, p_rank text, p_wage_baht numeric, p_pay_method text,
  p_est_minutes int, p_due_at timestamptz, p_urgent_minutes int, p_instant boolean,
  p_remote boolean, p_lat double precision, p_lng double precision, p_address text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_verified();
  v_id uuid;
  v_rank text := coalesce(p_rank, 'F');
  v_threshold numeric := coalesce(nullif((select value from app_settings where key = 'review_reward_threshold'), '')::numeric, 5000);
  v_fee bigint := _setting_int('post_fee_gold', 10) + case when p_urgent_minutes is not null then _setting_int('urgent_fee_gold', 20) else 0 end;
begin
  if p_category <> 'general' and not exists (select 1 from occupations where id = p_category) then raise exception 'unknown category'; end if;
  if p_category = 'general' then v_rank := 'F'; end if;
  if v_rank not in ('F','E','D','C','B','A','S') then raise exception 'bad rank'; end if;
  if p_wage_baht is null or p_wage_baht <= 0 or p_wage_baht > 100000 then raise exception 'wage must be 1-100000 baht'; end if;
  if coalesce(p_pay_method, 'either') not in ('promptpay','cash','either') then raise exception 'bad pay method'; end if;
  if p_est_minutes is null or p_est_minutes < 10 or p_est_minutes > 10080 then raise exception 'estimated time must be 10 minutes to 7 days'; end if;
  if p_due_at is not null and p_due_at < now() + interval '10 minutes' then raise exception 'due time must be in the future'; end if;
  if p_urgent_minutes is not null and (p_urgent_minutes < 10 or p_urgent_minutes > 1440) then
    raise exception 'urgent window must be 10-1440 minutes';
  end if;
  if not coalesce(p_remote, false) and (p_lat is null or p_lng is null) then raise exception 'location required'; end if;
  if exists (select 1 from quests where poster_id = v_uid and payment_status = 'unpaid_reported') then
    raise exception 'unpaid wages outstanding';
  end if;
  if v_fee > 0 then
    update wallets set gold = gold - v_fee, updated_at = now() where user_id = v_uid and gold >= v_fee;
    if not found then raise exception 'not enough gold for the posting fee'; end if;
  end if;
  insert into quests (poster_id, title, description, category, rank, reward_gold, reward_exp, moderation, urgent_until,
                      est_minutes, due_at, instant, remote, approx_lat, approx_lng, wage_baht, pay_method, post_fee_gold)
  values (v_uid, trim(p_title), nullif(trim(p_description), ''), p_category, v_rank, 0,
          least(240, greatest(5, p_est_minutes / 2)),
          case when p_wage_baht >= v_threshold then 'pending' else 'approved' end,
          case when p_urgent_minutes is null then null else now() + make_interval(mins => p_urgent_minutes) end,
          p_est_minutes, p_due_at, coalesce(p_instant, false), coalesce(p_remote, false),
          case when p_remote then null else round(p_lat::numeric, 2) end,
          case when p_remote then null else round(p_lng::numeric, 2) end,
          round(p_wage_baht, 2), coalesce(p_pay_method, 'either'), v_fee)
  returning id into v_id;
  if not coalesce(p_remote, false) then
    insert into quest_locations (quest_id, lat, lng, address) values (v_id, p_lat, p_lng, nullif(trim(p_address), ''));
  end if;
  if v_fee > 0 then perform _ledger(v_uid, 'post_fee', -v_fee, 0, v_id); end if;
  if p_wage_baht >= v_threshold then
    perform _notify_perm('q.review', 'moderation', 'มีเควสต์รอตรวจ', trim(p_title), 'admin.html#quests');
  end if;
  return v_id;
end $$;

-- The original call keeps working for older app versions: an online job with no location.
create or replace function public.post_quest(p_title text, p_description text, p_category text,
                                             p_rank text, p_reward_gold bigint, p_urgent_minutes int default null)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.post_quest_v2(p_title, p_description, p_category, p_rank, p_reward_gold::numeric, 'either', 60, null,
                              p_urgent_minutes, false, true, null, null, null)
$$;

-- ---------- applying and choosing ----------
create function public._assign(p_quest uuid, p_worker uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_title text;
begin
  update quests set worker_id = p_worker, status = 'in_progress', assigned_at = now(), updated_at = now()
   where id = p_quest returning title into v_title;
  insert into quest_applications (quest_id, worker_id, status) values (p_quest, p_worker, 'accepted')
  on conflict (quest_id, worker_id) do update set status = 'accepted';
  update quest_applications set status = 'rejected' where quest_id = p_quest and worker_id <> p_worker and status = 'pending';
  insert into notifications (user_id, kind, title, body, link)
  select worker_id, 'quest', 'งานนี้ได้คนแล้ว', v_title, 'index.html#board'
    from quest_applications where quest_id = p_quest and status = 'rejected' and worker_id <> p_worker;
  perform _notify(p_worker, 'quest', 'คุณได้รับงานแล้ว', v_title, 'index.html#quest-' || p_quest);
end $$;

create function public.apply_quest(p_quest uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype; v_reason text;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.status <> 'open' or q.moderation <> 'approved' or q.worker_id is not null or q.dispute_open then
    raise exception 'quest not available';
  end if;
  v_reason := _eligibility(v_uid, p_quest);
  if v_reason is not null then raise exception '%', v_reason; end if;
  if q.family_id is null and q.pay_method = 'promptpay'
     and not exists (select 1 from private_profiles where user_id = v_uid and promptpay_id is not null) then
    raise exception 'set your PromptPay first';
  end if;
  if q.instant or q.family_id is not null then
    perform _assign(p_quest, v_uid);
    perform _notify(q.poster_id, 'quest', 'มีคนรับงานแล้ว', q.title, 'index.html#quest-' || q.id);
    return 'assigned';
  end if;
  insert into quest_applications (quest_id, worker_id, note) values (p_quest, v_uid, nullif(trim(p_note), ''))
  on conflict (quest_id, worker_id) do update set status = 'pending', note = excluded.note, created_at = now()
    where quest_applications.status = 'withdrawn';
  update quests set applicant_count = (select count(*) from quest_applications where quest_id = p_quest and status = 'pending')
   where id = p_quest;
  perform _notify(q.poster_id, 'quest', 'มีผู้สมัครงานใหม่', q.title, 'index.html#quest-' || q.id);
  return 'applied';
end $$;

create function public.withdraw_application(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update quest_applications set status = 'withdrawn' where quest_id = p_quest and worker_id = auth.uid() and status = 'pending';
  if not found then raise exception 'no pending application'; end if;
  update quests set applicant_count = (select count(*) from quest_applications where quest_id = p_quest and status = 'pending')
   where id = p_quest;
end $$;

create function public.choose_worker(p_quest uuid, p_worker uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype; v_reason text;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> v_uid or q.status <> 'open' then raise exception 'cannot choose for this quest'; end if;
  if not exists (select 1 from quest_applications where quest_id = p_quest and worker_id = p_worker and status = 'pending') then
    raise exception 'not an applicant';
  end if;
  v_reason := _eligibility(p_worker, p_quest);
  if v_reason is not null then raise exception '%', v_reason; end if;
  perform _assign(p_quest, p_worker);
end $$;

-- Family quests keep the one-tap accept; everything else goes through apply_quest.
create or replace function public.accept_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apply_quest(p_quest, null);
end $$;

-- ---------- on the job ----------
create function public.check_in(p_quest uuid, p_lat double precision, p_lng double precision, p_photo text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._assert_active();
  q quests%rowtype; l quest_locations%rowtype; v_id bigint; v_dist double precision;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.worker_id is distinct from v_uid or q.status <> 'in_progress' or q.dispute_open then
    raise exception 'cannot check in';
  end if;
  if exists (select 1 from work_sessions where quest_id = p_quest and ended_at is null) then raise exception 'already checked in'; end if;
  select * into l from quest_locations where quest_id = p_quest;
  if found then
    if p_lat is null or p_lng is null then raise exception 'location required'; end if;
    v_dist := _distance_m(p_lat, p_lng, l.lat, l.lng);
    if v_dist > _setting_int('checkin_radius_m', 300) then raise exception 'too far from the job site (% m)', round(v_dist); end if;
  end if;
  if p_photo is not null and p_photo not like p_quest::text || '/' || v_uid::text || '/%' then raise exception 'bad file path'; end if;
  insert into work_sessions (quest_id, worker_id, start_lat, start_lng, start_photo)
  values (p_quest, v_uid, p_lat, p_lng, p_photo) returning id into v_id;
  if (select count(*) from work_sessions where quest_id = p_quest) = 1 then
    perform _notify(q.poster_id, 'quest', 'ผู้รับงานเช็กอินหน้างานแล้ว', q.title, 'index.html#quest-' || q.id);
  end if;
  return v_id;
end $$;

create function public.check_out(p_quest uuid, p_lat double precision, p_lng double precision, p_photo text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); s work_sessions%rowtype; v_min int;
begin
  select * into s from work_sessions where quest_id = p_quest and worker_id = v_uid and ended_at is null for update;
  if not found then raise exception 'not checked in'; end if;
  if p_photo is not null and p_photo not like p_quest::text || '/' || v_uid::text || '/%' then raise exception 'bad file path'; end if;
  v_min := least(960, greatest(1, round(extract(epoch from now() - s.started_at) / 60)::int));
  update work_sessions set ended_at = now(), end_lat = p_lat, end_lng = p_lng, end_photo = p_photo, minutes = v_min where id = s.id;
  return v_min;
end $$;

create or replace function public.submit_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.worker_id is distinct from v_uid or q.status <> 'in_progress' or q.dispute_open then
    raise exception 'cannot submit this quest';
  end if;
  if exists (select 1 from work_sessions where quest_id = p_quest and ended_at is null) then raise exception 'check out first'; end if;
  if q.family_id is null and not exists (select 1 from work_sessions where quest_id = p_quest) then raise exception 'check in first'; end if;
  update quests set status = 'submitted', submitted_at = now(), updated_at = now(),
         auto_release_at = now() + make_interval(hours => _setting_int('auto_release_hours', 72))
   where id = p_quest;
  perform _notify(q.poster_id, 'quest', 'ผู้รับงานส่งงานแล้ว — ตรวจและยืนยัน',
    q.title || ' · ระบบจะจ่ายให้อัตโนมัติใน ' || _setting_int('auto_release_hours', 72) || ' ชม. ถ้าไม่มีข้อโต้แย้ง', 'index.html#quest-' || q.id);
end $$;

-- Worker hands the job back before finishing; the quest returns to the board.
create function public.abandon_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.worker_id is distinct from v_uid or q.status <> 'in_progress' or q.dispute_open then
    raise exception 'cannot leave this quest';
  end if;
  update work_sessions set ended_at = now(), minutes = least(960, greatest(1, round(extract(epoch from now() - started_at) / 60)::int))
   where quest_id = p_quest and ended_at is null;
  update quests set worker_id = null, status = 'open', assigned_at = null, updated_at = now() where id = p_quest;
  update quest_applications set status = 'withdrawn' where quest_id = p_quest and worker_id = v_uid;
  perform _notify(q.poster_id, 'quest', 'ผู้รับงานคืนงาน — เควสต์กลับขึ้นกระดาน', q.title, 'index.html#quest-' || q.id);
end $$;

-- ---------- settlement ----------
-- Pays p_worker_pct of the escrow to the worker (minus the platform fee) and refunds the rest to the poster.
-- The job counts toward the worker's career only when they receive at least half.
-- Grants every job card the worker now qualifies for in a category (0008 adds career-rank gates).
create function public._unlock_cards(p_user uuid, p_cat text, p_done int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into user_cards (user_id, card_id)
  select p_user, jc.id from job_cards jc where jc.category = p_cat and jc.unlock_count <= p_done
  on conflict do nothing;
$$;
revoke execute on function public._unlock_cards(uuid, text, int) from public, anon, authenticated;

create function public._settle(p_quest uuid, p_worker_pct int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q quests%rowtype;
  v_gross bigint; v_refund bigint; v_pct int := 0;
  v_exp int; v_minutes int := 0; v_counted boolean := false; v_done int;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.status not in ('in_progress','submitted') then raise exception 'quest not settleable'; end if;
  v_gross := floor(q.reward_gold * p_worker_pct / 100.0);
  v_refund := q.reward_gold - v_gross;

  -- Gold escrow exists only for family quests; public wages are paid in baht outside the app.
  if q.reward_gold > 0 then
  update wallets set gold_locked = gold_locked - q.reward_gold, gold = gold + v_refund, updated_at = now()
   where user_id = q.poster_id and gold_locked >= q.reward_gold;
  if not found then raise exception 'escrow mismatch'; end if;
  if v_gross > 0 then perform _ledger(q.poster_id, 'quest_paid', 0, -v_gross, q.id, null, p_reason); end if;
  if v_refund > 0 then perform _ledger(q.poster_id, 'quest_refund', v_refund, -v_refund, q.id, null, p_reason); end if;

  if v_gross > 0 then
    update wallets set gold = gold + v_gross, updated_at = now() where user_id = q.worker_id;
    perform _ledger(q.worker_id, 'quest_reward', v_gross, 0, q.id, null, p_reason);
  end if;
  end if;

  if p_worker_pct >= 50 then
    -- life EXP, boosted by a matching main job card
    select coalesce(jc.exp_bonus_pct, 0) into v_pct
      from decks d join job_cards jc on jc.id = d.main_card
     where d.user_id = q.worker_id and (jc.category = 'general' or jc.category = q.category);
    v_exp := q.reward_exp + (q.reward_exp * coalesce(v_pct, 0)) / 100;
    perform _grant_exp(q.worker_id, v_exp);
    update profiles set quests_done = quests_done + 1 where id = q.worker_id;
    select count(*) into v_done from quests where worker_id = q.worker_id and status = 'completed' and category = q.category;
    perform _unlock_cards(q.worker_id, q.category, v_done + 1);

    -- career credit: verified hours (capped at 1.5x the estimate); at most 5 counted jobs per poster per 30 days
    if exists (select 1 from occupations where id = q.category) then
      select least(coalesce(sum(minutes), 0), (q.est_minutes * 3) / 2) into v_minutes from work_sessions where quest_id = q.id;
      v_counted := (select count(*) from quests x
                     where x.worker_id = q.worker_id and x.poster_id = q.poster_id and x.career_counted
                       and x.completed_at > now() - interval '30 days') < 5
                   -- a believable wage: at least career_min_wage_hour baht per estimated hour
                   and (q.family_id is not null or q.wage_baht * 60 / greatest(q.est_minutes, 1) >= _setting_int('career_min_wage_hour', 40));
      insert into user_careers (user_id, occupation_id) values (q.worker_id, q.category) on conflict do nothing;
      if v_counted then
        update user_careers set jobs = jobs + 1, minutes = minutes + v_minutes
         where user_id = q.worker_id and occupation_id = q.category;
      end if;
    end if;
  end if;

  update quests set status = case when p_worker_pct > 0 then 'completed' else 'cancelled' end,
         completed_at = now(), updated_at = now(), dispute_open = false,
         worker_minutes = v_minutes, career_counted = v_counted,
         payment_status = case when q.family_id is null and p_worker_pct > 0 and q.wage_baht > 0 then 'due' else 'none' end,
         payment_due_baht = case when q.family_id is null and p_worker_pct > 0 then round(q.wage_baht * p_worker_pct / 100.0, 2) end
   where id = q.id;
  if q.family_id is null and p_worker_pct > 0 and q.wage_baht > 0 then
    perform _notify(q.poster_id, 'money', 'จ่ายค่าจ้าง ' || round(q.wage_baht * p_worker_pct / 100.0, 2) || ' บาท ให้ผู้รับงาน',
      q.title || ' · เปิดดู QR พร้อมเพย์ของผู้รับงานในแอป', 'index.html#quest-' || q.id);
  end if;
  update quest_applications set status = 'rejected' where quest_id = q.id and status = 'pending';

  if v_gross > 0 then
    perform _notify(q.worker_id, 'money', 'ได้รับ ' || v_gross || ' G', q.title, 'index.html#wallet');
  end if;
  if v_refund > 0 then
    perform _notify(q.poster_id, 'money', 'คืน ' || v_refund || ' G เข้ากระเป๋า', q.title, 'index.html#wallet');
  end if;
end $$;

create or replace function public.confirm_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> v_uid or q.status <> 'submitted' or q.dispute_open then raise exception 'cannot confirm this quest'; end if;
  perform _settle(p_quest, 100, 'confirmed');
end $$;

-- Before anyone has started work the poster can cancel and get the escrow back.
-- If the worker never showed up by the due time, they get a no-show strike.
create or replace function public.cancel_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> v_uid then raise exception 'cannot cancel this quest'; end if;
  if q.status = 'open' then
    if q.reward_gold > 0 then
      update wallets set gold = gold + q.reward_gold, gold_locked = gold_locked - q.reward_gold, updated_at = now() where user_id = q.poster_id;
      perform _ledger(q.poster_id, 'quest_refund', q.reward_gold, -q.reward_gold, q.id);
    end if;
    update quests set status = 'cancelled', updated_at = now() where id = q.id;
    update quest_applications set status = 'rejected' where quest_id = q.id and status = 'pending';
  elsif q.status = 'in_progress' and not q.dispute_open and not exists (select 1 from work_sessions where quest_id = q.id) then
    if q.due_at is not null and q.due_at < now() then
      update profiles set no_show_count = no_show_count + 1 where id = q.worker_id;
      perform _notify(q.worker_id, 'quest', 'ไม่มาทำงานตามกำหนด — บันทึกการผิดนัด 1 ครั้ง', q.title, 'index.html#board');
    else
      perform _notify(q.worker_id, 'quest', 'ผู้โพสต์ยกเลิกงาน', q.title, 'index.html#board');
    end if;
    perform _settle(q.id, 0, 'cancelled before start');
  else
    raise exception 'cannot cancel this quest';
  end if;
end $$;

-- ---------- reviews ----------
create function public.submit_review(p_quest uuid, p_stars int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype; v_target uuid; v_role text;
begin
  select * into q from quests where id = p_quest;
  if not found or q.status <> 'completed' or q.worker_id is null then raise exception 'quest not reviewable'; end if;
  if q.completed_at < now() - interval '14 days' then raise exception 'review window closed'; end if;
  if v_uid = q.poster_id then v_target := q.worker_id; v_role := 'worker';
  elsif v_uid = q.worker_id then v_target := q.poster_id; v_role := 'poster';
  else raise exception 'not part of this quest'; end if;
  insert into reviews (quest_id, reviewer_id, reviewee_id, reviewee_role, stars, comment)
  values (q.id, v_uid, v_target, v_role, p_stars, nullif(trim(p_comment), ''));
  if v_role = 'worker' then
    update profiles set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1 where id = v_target;
    update user_careers set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1
     where user_id = v_target and occupation_id = q.category;
  else
    update profiles set poster_rating_sum = poster_rating_sum + p_stars, poster_rating_count = poster_rating_count + 1 where id = v_target;
  end if;
  perform _notify(v_target, 'review', 'ได้รับรีวิว ' || p_stars || ' ดาว', q.title, 'index.html#char');
end $$;

-- ---------- disputes ----------
create function public.open_dispute(p_quest uuid, p_reason text, p_evidence text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype; v_id uuid; v_path text;
begin
  select * into q from quests where id = p_quest for update;
  if not found or v_uid not in (q.poster_id, coalesce(q.worker_id, q.poster_id)) or q.worker_id is null
     or q.status not in ('in_progress','submitted') or q.dispute_open then
    raise exception 'cannot open a dispute';
  end if;
  foreach v_path in array coalesce(p_evidence, '{}') loop
    if v_path not like p_quest::text || '/' || v_uid::text || '/%' then raise exception 'bad file path'; end if;
  end loop;
  insert into disputes (quest_id, opened_by, reason, evidence) values (p_quest, v_uid, trim(p_reason), coalesce(p_evidence, '{}'))
  returning id into v_id;
  update quests set dispute_open = true, updated_at = now() where id = p_quest;
  perform _notify(case when v_uid = q.poster_id then q.worker_id else q.poster_id end, 'dispute',
    'มีการเปิดข้อพิพาท — ทีมงานจะตัดสิน', q.title, 'index.html#quest-' || q.id);
  perform _notify_perm('q.dispute', 'dispute', 'ข้อพิพาทใหม่', q.title, 'admin.html#disputes');
  return v_id;
end $$;

create function public.add_dispute_evidence(p_dispute uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); d disputes%rowtype; q quests%rowtype;
begin
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status <> 'open' then raise exception 'dispute not open'; end if;
  select * into q from quests where id = d.quest_id;
  if v_uid not in (q.poster_id, q.worker_id) then raise exception 'not part of this quest'; end if;
  if p_path not like q.id::text || '/' || v_uid::text || '/%' then raise exception 'bad file path'; end if;
  update disputes set evidence = array_append(evidence, p_path) where id = d.id;
end $$;

create function public.resolve_dispute(p_dispute uuid, p_worker_pct int, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare d disputes%rowtype; q quests%rowtype;
begin
  if not has_perm('q.dispute') then raise exception 'forbidden'; end if;
  if p_worker_pct is null or p_worker_pct < 0 or p_worker_pct > 100 then raise exception 'percent must be 0-100'; end if;
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status <> 'open' then raise exception 'dispute not open'; end if;
  select * into q from quests where id = d.quest_id;
  if auth.uid() in (q.poster_id, q.worker_id) then raise exception 'cannot judge your own quest'; end if;
  perform _settle(d.quest_id, p_worker_pct, 'dispute: ' || p_worker_pct || '% to worker');
  update disputes set status = 'resolved', worker_pct = p_worker_pct, resolution_note = p_note,
         resolved_by = auth.uid(), resolved_at = now() where id = d.id;
  perform _notify(q.poster_id, 'dispute', 'ข้อพิพาทได้ข้อยุติแล้ว', coalesce(p_note, ''), 'index.html#quest-' || q.id);
  perform _notify(q.worker_id, 'dispute', 'ข้อพิพาทได้ข้อยุติแล้ว', coalesce(p_note, ''), 'index.html#quest-' || q.id);
  perform _audit('dispute.resolve', 'quest', q.id::text, jsonb_build_object('worker_pct', p_worker_pct, 'note', p_note));
end $$;

-- ---------- chat ----------
create function public.send_message(p_quest uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype; v_staff boolean := false; v_id bigint;
begin
  select * into q from quests where id = p_quest;
  if not found then raise exception 'quest not found'; end if;
  if v_uid not in (q.poster_id, coalesce(q.worker_id, q.poster_id)) or q.worker_id is null then
    if q.dispute_open and has_perm('q.dispute') then v_staff := true; else raise exception 'not part of this quest'; end if;
  end if;
  insert into messages (quest_id, sender_id, is_staff, body) values (p_quest, v_uid, v_staff, trim(p_body)) returning id into v_id;
  if v_uid <> q.poster_id then perform _notify(q.poster_id, 'chat', 'ข้อความใหม่', left(trim(p_body), 80), 'index.html#quest-' || q.id); end if;
  if q.worker_id is not null and v_uid <> q.worker_id then
    perform _notify(q.worker_id, 'chat', 'ข้อความใหม่', left(trim(p_body), 80), 'index.html#quest-' || q.id);
  end if;
  return v_id;
end $$;

-- ---------- job photos and dispute evidence ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quest-media', 'quest-media', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;


-- ---------- row level security ----------
-- The caller's role on a quest, read without RLS so the policies below never loop into each other.
create function public._quest_role(p_quest text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() = q.poster_id then 'poster'
              when auth.uid() = q.worker_id then 'worker'
              when exists (select 1 from quest_applications a where a.quest_id = q.id and a.worker_id = auth.uid()) then 'applicant'
         end
    from quests q where q.id::text = p_quest
$$;
grant execute on function public._quest_role(text) to authenticated;

alter table public.quest_locations enable row level security;
alter table public.quest_applications enable row level security;
alter table public.work_sessions enable row level security;
alter table public.reviews enable row level security;
alter table public.disputes enable row level security;
alter table public.messages enable row level security;
revoke insert, update, truncate on public.quest_locations, public.quest_applications, public.work_sessions,
  public.reviews, public.disputes, public.messages from anon, authenticated;
revoke all on public.quest_locations, public.quest_applications, public.work_sessions,
  public.reviews, public.disputes, public.messages from anon;

create policy "location for parties or staff" on public.quest_locations for select to authenticated
  using (public._quest_role(quest_id::text) in ('poster','worker')
         or public.has_perm('q.review', 'view') or public.has_perm('q.dispute', 'view'));
create policy "applications for applicant, poster or staff" on public.quest_applications for select to authenticated
  using (worker_id = (select auth.uid()) or public._quest_role(quest_id::text) = 'poster'
         or public.has_perm('q.review', 'view'));
create policy "sessions for parties or staff" on public.work_sessions for select to authenticated
  using (public._quest_role(quest_id::text) in ('poster','worker') or public.has_perm('q.dispute', 'view'));
create policy "reviews readable" on public.reviews for select to authenticated using (true);
create policy "disputes for parties or staff" on public.disputes for select to authenticated
  using (public._quest_role(quest_id::text) in ('poster','worker') or public.has_perm('q.dispute', 'view'));
create policy "messages for parties or staff" on public.messages for select to authenticated
  using (public._quest_role(quest_id::text) in ('poster','worker') or public.has_perm('q.dispute', 'view'));

-- Applicants can still see a quest they applied to after it is assigned.
alter policy "board, own quests, or reviewers" on public.quests
  using ((status = 'open' and moderation = 'approved' and family_id is null)
         or (family_id is not null and family_id = public.my_family())
         or poster_id = (select auth.uid()) or worker_id = (select auth.uid())
         or public._quest_role(id::text) = 'applicant'
         or public.has_perm('q.review', 'view') or public.has_perm('q.dispute', 'view'));

revoke execute on function public._distance_m(double precision, double precision, double precision, double precision),
  public._setting_int(text, int), public._grant_exp(uuid, int), public._eligibility(uuid, uuid), public._assign(uuid, uuid),
  public._settle(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.quest_eligibility(uuid),
  public.post_quest_v2(text, text, text, text, numeric, text, int, timestamptz, int, boolean, boolean, double precision, double precision, text),
  public.apply_quest(uuid, text), public.withdraw_application(uuid), public.choose_worker(uuid, uuid),
  public.check_in(uuid, double precision, double precision, text), public.check_out(uuid, double precision, double precision, text),
  public.abandon_quest(uuid), public.submit_review(uuid, int, text), public.open_dispute(uuid, text, text[]),
  public.add_dispute_evidence(uuid, text), public.resolve_dispute(uuid, int, text), public.send_message(uuid, text)
  from public, anon;
grant execute on function public.quest_eligibility(uuid),
  public.post_quest_v2(text, text, text, text, numeric, text, int, timestamptz, int, boolean, boolean, double precision, double precision, text),
  public.apply_quest(uuid, text), public.withdraw_application(uuid), public.choose_worker(uuid, uuid),
  public.check_in(uuid, double precision, double precision, text), public.check_out(uuid, double precision, double precision, text),
  public.abandon_quest(uuid), public.submit_review(uuid, int, text), public.open_dispute(uuid, text, text[]),
  public.add_dispute_evidence(uuid, text), public.resolve_dispute(uuid, int, text), public.send_message(uuid, text),
  public.post_quest(text, text, text, text, bigint, int), public.accept_quest(uuid), public.submit_quest(uuid),
  public.confirm_quest(uuid), public.cancel_quest(uuid)
  to authenticated;

create policy "rlq quest-media upload by party" on storage.objects for insert to authenticated
  with check (bucket_id = 'quest-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public._quest_role((storage.foldername(name))[1]) in ('poster','worker'));
create policy "rlq quest-media read by party or staff" on storage.objects for select to authenticated
  using (bucket_id = 'quest-media' and (
    public._quest_role((storage.foldername(name))[1]) in ('poster','worker') or public.has_perm('q.dispute', 'view')));

alter publication supabase_realtime add table public.messages, public.quest_applications;

-- ---------- wages: paid by the poster straight to the worker ----------
-- Worker sets where they receive money (needs a verified identity).
create function public.set_payout(p_promptpay text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_verified(); v_id text := regexp_replace(coalesce(p_promptpay, ''), '\D', '', 'g');
begin
  if v_id !~ '^([0-9]{10}|[0-9]{13})$' then raise exception 'promptpay must be 10 or 13 digits'; end if;
  insert into private_profiles (user_id, promptpay_id) values (v_uid, v_id)
  on conflict (user_id) do update set promptpay_id = excluded.promptpay_id, updated_at = now();
end $$;

-- What the poster needs to pay: amount, method and the worker's PromptPay with a masked legal name to check.
create function public.payment_info(p_quest uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare q quests%rowtype; pp private_profiles%rowtype;
begin
  select * into q from quests where id = p_quest;
  if not found or (q.poster_id <> auth.uid() and q.worker_id is distinct from auth.uid()) then raise exception 'not part of this quest'; end if;
  if q.payment_status = 'none' then return jsonb_build_object('status', 'none'); end if;
  select * into pp from private_profiles where user_id = q.worker_id;
  return jsonb_build_object('status', q.payment_status, 'amount', q.payment_due_baht, 'method', q.pay_method,
    'promptpay', case when q.poster_id = auth.uid() then pp.promptpay_id end,
    'name_hint', case when pp.legal_name is null then null
                      else split_part(pp.legal_name, ' ', 1) || ' ' || left(split_part(pp.legal_name, ' ', 2), 1) || '***' end,
    'paid_at', q.paid_at, 'received_at', q.received_at);
end $$;

create function public.mark_paid(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> v_uid or q.payment_status not in ('due','unpaid_reported') then raise exception 'nothing to pay'; end if;
  update quests set payment_status = 'paid', paid_at = now(), updated_at = now() where id = q.id;
  perform _notify(q.worker_id, 'money', 'ผู้จ้างแจ้งว่าจ่ายค่าจ้าง ' || q.payment_due_baht || ' บาทแล้ว — ตรวจแล้วกดยืนยัน', q.title, 'index.html#quest-' || q.id);
end $$;

create function public.confirm_received(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.worker_id is distinct from v_uid or q.payment_status not in ('due','paid','unpaid_reported') then
    raise exception 'nothing to confirm';
  end if;
  update quests set payment_status = 'received', received_at = now(), updated_at = now() where id = q.id;
  perform _notify(q.poster_id, 'money', 'ผู้รับงานยืนยันว่าได้รับค่าจ้างแล้ว', q.title, 'index.html#quest-' || q.id);
end $$;

-- Worker says the money never came (after 24 h). The poster cannot post again until it is settled.
create function public.report_unpaid(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.worker_id is distinct from v_uid or q.payment_status not in ('due','paid') then raise exception 'nothing to report'; end if;
  if q.completed_at > now() - interval '24 hours' then raise exception 'wait 24 hours before reporting'; end if;
  update quests set payment_status = 'unpaid_reported', updated_at = now() where id = q.id;
  perform _notify(q.poster_id, 'money', 'ผู้รับงานแจ้งว่ายังไม่ได้รับค่าจ้าง — คุณจะโพสต์งานใหม่ไม่ได้จนกว่าจะจ่าย', q.title, 'index.html#quest-' || q.id);
  perform _notify_perm('q.dispute', 'money', 'แจ้งไม่ได้รับค่าจ้าง', q.title || ' · ' || q.payment_due_baht || ' บาท', 'admin.html#unpaid');
end $$;

-- Staff close an unpaid report: proven paid → received; not paid → written off and a strike on the poster.
create function public.resolve_unpaid(p_quest uuid, p_paid boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare q quests%rowtype;
begin
  if not has_perm('q.dispute') then raise exception 'forbidden'; end if;
  select * into q from quests where id = p_quest for update;
  if not found or q.payment_status <> 'unpaid_reported' then raise exception 'not reported'; end if;
  if auth.uid() in (q.poster_id, q.worker_id) then raise exception 'cannot judge your own quest'; end if;
  update quests set payment_status = case when p_paid then 'received' else 'written_off' end, updated_at = now() where id = q.id;
  if not p_paid then update profiles set unpaid_count = unpaid_count + 1 where id = q.poster_id; end if;
  perform _audit('quest.unpaid', 'quest', q.id::text, jsonb_build_object('paid', p_paid, 'note', p_note));
  perform _notify(q.worker_id, 'money', case when p_paid then 'ทีมงานยืนยันว่าจ่ายแล้ว' else 'ทีมงานบันทึกว่าผู้จ้างไม่จ่าย และลงโทษผู้จ้างแล้ว' end, coalesce(p_note, q.title), 'index.html#quest-' || q.id);
  perform _notify(q.poster_id, 'money', case when p_paid then 'เรื่องค่าจ้างปิดแล้ว' else 'คุณถูกบันทึกว่าไม่จ่ายค่าจ้าง 1 ครั้ง' end, coalesce(p_note, q.title), 'index.html#quest-' || q.id);
end $$;

revoke execute on function public.set_payout(text), public.payment_info(uuid), public.mark_paid(uuid), public.confirm_received(uuid),
  public.report_unpaid(uuid), public.resolve_unpaid(uuid, boolean, text) from public, anon;
grant execute on function public.set_payout(text), public.payment_info(uuid), public.mark_paid(uuid), public.confirm_received(uuid),
  public.report_unpaid(uuid), public.resolve_unpaid(uuid, boolean, text) to authenticated;
