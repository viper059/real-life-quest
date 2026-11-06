-- Real-life Quest — identity verification, bans, and real-world career ranks.
-- Career ranks follow real promotion timelines: minimum time in each rank cannot be skipped,
-- and progress only comes from jobs the employer confirmed.

-- ---------- new permissions ----------
insert into public.permissions (id, label, grp, sort) values
  ('u.kyc', 'ตรวจยืนยันตัวตนผู้ใช้', 'เควสต์และผู้ใช้', 5),
  ('q.dispute', 'ตัดสินข้อพิพาท', 'เควสต์และผู้ใช้', 6),
  ('c.review', 'ตรวจเลื่อนขั้นและเทียบโอนอาชีพ', 'อาชีพ', 7),
  ('m.topup', 'ยืนยันการเติม Gold และ Crystal', 'เงิน', 12),
  ('m.shop', 'จัดการร้านค้า', 'เงิน', 13)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id, level)
select r.role_id, m.perm, case substr(m.spec, r.pos, 1) when 'F' then 'full' else 'view' end
from (values ('u.kyc','FFNVF'),('q.dispute','FFFVN'),('c.review','FFVNN'),('m.topup','FNNFN'),('m.shop','FVNVN')) as m(perm, spec)
cross join (values ('owner',1),('admin',2),('mod',3),('finance',4),('support',5)) as r(role_id, pos)
where substr(m.spec, r.pos, 1) <> 'N'
on conflict (role_id, permission_id) do nothing;

-- ---------- profile additions ----------
alter table public.profiles
  add column kyc_status text not null default 'none' check (kyc_status in ('none','pending','verified','rejected')),
  add column kyc_verified_at timestamptz,
  add column banned_until timestamptz,
  add column ban_reason text,
  add column rating_sum int not null default 0,
  add column rating_count int not null default 0,
  add column poster_rating_sum int not null default 0,
  add column poster_rating_count int not null default 0,
  add column no_show_count int not null default 0;

-- Sensitive identity data lives apart from the public profile.
create table public.private_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  legal_name text check (char_length(legal_name) <= 120),
  phone text check (phone ~ '^0[0-9]{8,9}$'),
  kyc_note text,
  updated_at timestamptz not null default now()
);

create table public.kyc_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 4 and 120),
  phone text not null check (phone ~ '^0[0-9]{8,9}$'),
  id_card_path text not null,
  selfie_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index kyc_requests_status_idx on public.kyc_requests (status, created_at);
create index kyc_requests_user_idx on public.kyc_requests (user_id);
create index kyc_requests_reviewer_idx on public.kyc_requests (reviewed_by);

-- ---------- notifications (used by everything below) ----------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create function public._notify(p_user uuid, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
$$;

-- Notify every staff member whose role holds a permission.
create function public._notify_perm(p_perm text, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select s.user_id, p_kind, p_title, p_body, p_link
    from public.staff_members s join public.role_permissions rp on rp.role_id = s.role_id
   where rp.permission_id = p_perm and rp.level = 'full';
$$;

create function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$ update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null; $$;

-- ---------- guards used by every user action ----------
create function public._assert_active()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_ban timestamptz;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select banned_until into v_ban from profiles where id = v_uid;
  if v_ban is not null and v_ban > now() then raise exception 'account banned'; end if;
  return v_uid;
end $$;

create function public._assert_verified()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active();
begin
  if (select kyc_status from profiles where id = v_uid) <> 'verified' then raise exception 'identity not verified'; end if;
  return v_uid;
end $$;

-- ---------- identity verification ----------
create function public.submit_kyc(p_legal_name text, p_phone text, p_id_card_path text, p_selfie_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active(); v_id uuid;
begin
  if (select kyc_status from profiles where id = v_uid) in ('pending','verified') then raise exception 'already submitted'; end if;
  if split_part(p_id_card_path, '/', 1) <> v_uid::text or split_part(p_selfie_path, '/', 1) <> v_uid::text then
    raise exception 'bad file path';
  end if;
  insert into kyc_requests (user_id, legal_name, phone, id_card_path, selfie_path)
  values (v_uid, trim(p_legal_name), p_phone, p_id_card_path, p_selfie_path) returning id into v_id;
  update profiles set kyc_status = 'pending' where id = v_uid;
  perform _notify_perm('u.kyc', 'kyc', 'มีคำขอยืนยันตัวตนใหม่', trim(p_legal_name), 'admin.html#kyc');
  return v_id;
end $$;

create function public.review_kyc(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r kyc_requests%rowtype;
begin
  if not has_perm('u.kyc') then raise exception 'forbidden'; end if;
  select * into r from kyc_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'request not pending'; end if;
  if r.user_id = auth.uid() then raise exception 'cannot review your own request'; end if;
  update kyc_requests set status = case when p_approve then 'approved' else 'rejected' end,
         note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  if p_approve then
    update profiles set kyc_status = 'verified', kyc_verified_at = now() where id = r.user_id;
    insert into private_profiles (user_id, legal_name, phone, kyc_note) values (r.user_id, r.legal_name, r.phone, p_note)
    on conflict (user_id) do update set legal_name = excluded.legal_name, phone = excluded.phone,
      kyc_note = excluded.kyc_note, updated_at = now();
    perform _notify(r.user_id, 'kyc', 'ยืนยันตัวตนสำเร็จ', 'รับเควสต์และถอนเงินได้แล้ว', 'index.html#board');
  else
    update profiles set kyc_status = 'rejected' where id = r.user_id;
    perform _notify(r.user_id, 'kyc', 'ยืนยันตัวตนไม่ผ่าน', coalesce(p_note, 'กรุณาส่งเอกสารใหม่'), 'index.html#char');
  end if;
  perform _audit('kyc.' || case when p_approve then 'approve' else 'reject' end, 'user', r.user_id::text, jsonb_build_object('note', p_note));
end $$;

-- ---------- bans ----------
-- p_days null = permanent, 0 = lift the ban.
create function public.ban_user(p_user uuid, p_days int, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('u.ban') then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  if exists (select 1 from staff_members where user_id = p_user and role_id = 'owner') then raise exception 'cannot ban an owner'; end if;
  update profiles set
    banned_until = case when p_days = 0 then null when p_days is null then 'infinity'::timestamptz else now() + make_interval(days => p_days) end,
    ban_reason = case when p_days = 0 then null else p_reason end
  where id = p_user;
  if not found then raise exception 'user not found'; end if;
  perform _audit(case when p_days = 0 then 'user.unban' else 'user.ban' end, 'user', p_user::text,
                 jsonb_build_object('days', p_days, 'reason', p_reason));
end $$;

-- ---------- careers ----------
create table public.occupations (
  id text primary key,
  label text not null,
  license_required boolean not null default false,
  sort int not null default 0
);
insert into public.occupations (id, label, license_required, sort) values
  ('home', 'งานบ้าน', false, 1),
  ('delivery', 'ส่งของ', false, 2),
  ('tutor', 'สอนพิเศษ', false, 3),
  ('repair', 'งานช่าง', false, 4),
  ('electric', 'ช่างไฟฟ้า', true, 5);

-- Requirements to move OUT of each rank to the next one. Jobs and minutes are career totals.
create table public.career_ranks (
  rank text primary key check (rank in ('F','E','D','C','B','A','S')),
  ord int not null unique,
  label text not null,
  min_months int,
  jobs_needed int,
  minutes_needed int,
  min_rating numeric(3,2),
  endorsements_needed int not null default 0,
  endorser_min_rank text,
  committee boolean not null default false
);
insert into public.career_ranks values
  ('F', 1, 'ฝึกหัด',        3,    20,    1200, 4.00, 0, null, false),
  ('E', 2, 'จูเนียร์',      24,  150,   90000, 4.50, 2, 'C',  false),
  ('D', 3, 'มีประสบการณ์',  36,  400,  300000, 4.60, 3, 'B',  true),
  ('C', 4, 'ซีเนียร์',      42,  800,  600000, 4.70, 3, 'B',  true),
  ('B', 5, 'หัวหน้างาน',    48, 1500, 1200000, 4.70, 3, 'A',  true),
  ('A', 6, 'ผู้เชี่ยวชาญ',  84, 3000, 2400000, 4.80, 3, 'A',  true),
  ('S', 7, 'ปรมาจารย์',   null, null,    null, null, 0, null, true);

create function public._rank_ord(p_rank text)
returns int
language sql
immutable
as $$ select position(p_rank in 'FEDCBAS') $$;

create table public.user_careers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  occupation_id text not null references public.occupations(id),
  rank text not null default 'F' references public.career_ranks(rank),
  rank_since timestamptz not null default now(),
  jobs int not null default 0,
  minutes int not null default 0,
  rating_sum int not null default 0,
  rating_count int not null default 0,
  started_at timestamptz not null default now(),
  imported boolean not null default false,
  primary key (user_id, occupation_id)
);
create index user_careers_occ_idx on public.user_careers (occupation_id, rank);
create index user_careers_rank_idx on public.user_careers (rank);

create table public.endorsements (
  endorser_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  occupation_id text not null references public.occupations(id),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (endorser_id, user_id, occupation_id),
  check (endorser_id <> user_id)
);
create index endorsements_user_idx on public.endorsements (user_id, occupation_id);
create index endorsements_occ_idx on public.endorsements (occupation_id);

create table public.promotion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occupation_id text not null references public.occupations(id),
  from_rank text not null,
  to_rank text not null,
  portfolio_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index promotion_requests_one_pending on public.promotion_requests (user_id, occupation_id) where status = 'pending';
create index promotion_requests_status_idx on public.promotion_requests (status, created_at);
create index promotion_requests_occ_idx on public.promotion_requests (occupation_id);
create index promotion_requests_reviewer_idx on public.promotion_requests (reviewed_by);

create table public.career_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occupation_id text not null references public.occupations(id),
  requested_rank text not null check (requested_rank in ('F','E','D','C')),
  years_experience numeric(4,1) not null check (years_experience between 0 and 60),
  doc_path text not null,
  note text check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_rank text,
  review_note text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index career_imports_one_pending on public.career_imports (user_id, occupation_id) where status = 'pending';
create index career_imports_status_idx on public.career_imports (status, created_at);
create index career_imports_occ_idx on public.career_imports (occupation_id);
create index career_imports_reviewer_idx on public.career_imports (reviewed_by);

-- Start a career path at rank F. Licensed trades can only be entered through a reviewed import.
create function public.start_career(p_occ text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_verified();
begin
  if (select license_required from occupations where id = p_occ) is null then raise exception 'unknown occupation'; end if;
  if (select license_required from occupations where id = p_occ) then raise exception 'license required'; end if;
  insert into user_careers (user_id, occupation_id) values (v_uid, p_occ) on conflict do nothing;
end $$;

-- Where a person stands against every promotion requirement.
create function public.career_gates(p_user uuid, p_occ text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c user_careers%rowtype;
  r career_ranks%rowtype;
  v_next text;
  v_months numeric;
  v_rating numeric;
  v_endorse int;
  v_ok boolean;
  v_earliest timestamptz;
begin
  select * into c from user_careers where user_id = p_user and occupation_id = p_occ;
  if not found then return null; end if;
  select * into r from career_ranks where rank = c.rank;
  select rank into v_next from career_ranks where ord = r.ord + 1;
  v_months := round((extract(epoch from now() - c.rank_since) / 2629746)::numeric, 1);
  v_rating := case when c.rating_count > 0 then round(c.rating_sum::numeric / c.rating_count, 2) end;
  select count(*) into v_endorse
    from endorsements e join user_careers ec on ec.user_id = e.endorser_id and ec.occupation_id = e.occupation_id
   where e.user_id = p_user and e.occupation_id = p_occ
     and r.endorser_min_rank is not null and _rank_ord(ec.rank) >= _rank_ord(r.endorser_min_rank);
  v_earliest := c.rank_since + make_interval(months => coalesce(r.min_months, 0));
  v_ok := v_next is not null and r.min_months is not null
      and now() >= v_earliest
      and c.jobs >= r.jobs_needed and c.minutes >= r.minutes_needed
      and coalesce(v_rating, 0) >= r.min_rating
      and v_endorse >= r.endorsements_needed;
  return jsonb_build_object(
    'occupation', p_occ, 'rank', c.rank, 'rank_label', r.label, 'next', v_next,
    'next_label', (select label from career_ranks where rank = v_next),
    'rank_since', c.rank_since, 'months_in_rank', v_months, 'min_months', r.min_months, 'earliest', v_earliest,
    'jobs', c.jobs, 'jobs_needed', r.jobs_needed, 'minutes', c.minutes, 'minutes_needed', r.minutes_needed,
    'rating', v_rating, 'rating_count', c.rating_count, 'min_rating', r.min_rating,
    'endorsements', v_endorse, 'endorsements_needed', r.endorsements_needed, 'endorser_min_rank', r.endorser_min_rank,
    'committee', r.committee, 'ok', v_ok, 'imported', c.imported, 'started_at', c.started_at,
    'pending_request', exists (select 1 from promotion_requests where user_id = p_user and occupation_id = p_occ and status = 'pending'));
end $$;

create function public.my_careers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.career_gates(auth.uid(), occupation_id) order by occupation_id), '[]'::jsonb)
    from public.user_careers where user_id = auth.uid();
$$;

-- An endorser must hold the required rank and have finished a job together with the person in that trade.
create function public.endorse_worker(p_user uuid, p_occ text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_verified(); v_rank text;
begin
  if p_user = v_uid then raise exception 'cannot endorse yourself'; end if;
  select rank into v_rank from user_careers where user_id = v_uid and occupation_id = p_occ;
  if v_rank is null or _rank_ord(v_rank) < _rank_ord('C') then raise exception 'endorser rank too low'; end if;
  if not exists (select 1 from quests q
                  where q.status = 'completed' and q.category = p_occ
                    and ((q.poster_id = v_uid and q.worker_id = p_user) or (q.poster_id = p_user and q.worker_id = v_uid))) then
    raise exception 'no job together';
  end if;
  insert into endorsements (endorser_id, user_id, occupation_id, note) values (v_uid, p_user, p_occ, p_note)
  on conflict do nothing;
  perform _notify(p_user, 'career', 'มีคนรับรองฝีมือคุณ', (select label from occupations where id = p_occ), 'index.html#career');
end $$;

create function public._promote(p_user uuid, p_occ text, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update user_careers set rank = p_to, rank_since = now() where user_id = p_user and occupation_id = p_occ;
  perform _notify(p_user, 'career', 'เลื่อนขั้นสำเร็จ',
    (select label from occupations where id = p_occ) || ' · ' || (select label from career_ranks where rank = p_to), 'index.html#career');
end $$;

create function public.request_promotion(p_occ text, p_portfolio_path text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_verified(); g jsonb;
begin
  g := career_gates(v_uid, p_occ);
  if g is null then raise exception 'no career in this occupation'; end if;
  if not (g->>'ok')::boolean then raise exception 'requirements not met'; end if;
  if (g->>'committee')::boolean then
    if p_portfolio_path is null or split_part(p_portfolio_path, '/', 1) <> v_uid::text then raise exception 'portfolio required'; end if;
    insert into promotion_requests (user_id, occupation_id, from_rank, to_rank, portfolio_path)
    values (v_uid, p_occ, g->>'rank', g->>'next', p_portfolio_path);
    perform _notify_perm('c.review', 'career', 'มีคำขอเลื่อนขั้นรอตรวจ', (select label from occupations where id = p_occ), 'admin.html#careers');
    return 'pending';
  end if;
  perform _promote(v_uid, p_occ, g->>'next');
  return 'promoted';
end $$;

create function public.review_promotion(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r promotion_requests%rowtype;
begin
  if not has_perm('c.review') then raise exception 'forbidden'; end if;
  select * into r from promotion_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'request not pending'; end if;
  if r.user_id = auth.uid() then raise exception 'cannot review your own request'; end if;
  update promotion_requests set status = case when p_approve then 'approved' else 'rejected' end,
         note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  if p_approve then
    if (select rank from user_careers where user_id = r.user_id and occupation_id = r.occupation_id) <> r.from_rank then
      raise exception 'rank changed since request';
    end if;
    perform _promote(r.user_id, r.occupation_id, r.to_rank);
  else
    perform _notify(r.user_id, 'career', 'คำขอเลื่อนขั้นยังไม่ผ่าน', p_note, 'index.html#career');
  end if;
  perform _audit('career.promotion_' || case when p_approve then 'approve' else 'reject' end, 'user', r.user_id::text,
                 jsonb_build_object('occupation', r.occupation_id, 'to', r.to_rank, 'note', p_note));
end $$;

-- Bring real experience from outside the app. Highest starting rank is C; time in rank starts now.
create function public.request_career_import(p_occ text, p_rank text, p_years numeric, p_doc_path text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_verified(); v_id uuid;
begin
  if not exists (select 1 from occupations where id = p_occ) then raise exception 'unknown occupation'; end if;
  if split_part(p_doc_path, '/', 1) <> v_uid::text then raise exception 'bad file path'; end if;
  insert into career_imports (user_id, occupation_id, requested_rank, years_experience, doc_path, note)
  values (v_uid, p_occ, p_rank, p_years, p_doc_path, p_note) returning id into v_id;
  perform _notify_perm('c.review', 'career', 'มีคำขอเทียบโอนประสบการณ์', (select label from occupations where id = p_occ), 'admin.html#careers');
  return v_id;
end $$;

create function public.review_career_import(p_request uuid, p_approve boolean, p_rank text default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r career_imports%rowtype; v_rank text;
begin
  if not has_perm('c.review') then raise exception 'forbidden'; end if;
  select * into r from career_imports where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'request not pending'; end if;
  if r.user_id = auth.uid() then raise exception 'cannot review your own request'; end if;
  v_rank := coalesce(p_rank, r.requested_rank);
  if p_approve and v_rank not in ('F','E','D','C') then raise exception 'imports go up to rank C'; end if;
  update career_imports set status = case when p_approve then 'approved' else 'rejected' end,
         approved_rank = case when p_approve then v_rank end, review_note = p_note,
         reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  if p_approve then
    insert into user_careers (user_id, occupation_id, rank, rank_since, started_at, imported)
    values (r.user_id, r.occupation_id, v_rank, now(), now() - make_interval(months => (r.years_experience * 12)::int), true)
    on conflict (user_id, occupation_id) do update
      set rank = case when _rank_ord(excluded.rank) > _rank_ord(user_careers.rank) then excluded.rank else user_careers.rank end,
          rank_since = case when _rank_ord(excluded.rank) > _rank_ord(user_careers.rank) then now() else user_careers.rank_since end,
          started_at = least(user_careers.started_at, excluded.started_at),
          imported = true;
    perform _notify(r.user_id, 'career', 'เทียบโอนประสบการณ์สำเร็จ',
      (select label from occupations where id = r.occupation_id) || ' · ' || (select label from career_ranks where rank = v_rank), 'index.html#career');
  else
    perform _notify(r.user_id, 'career', 'เทียบโอนยังไม่ผ่าน', p_note, 'index.html#career');
  end if;
  perform _audit('career.import_' || case when p_approve then 'approve' else 'reject' end, 'user', r.user_id::text,
                 jsonb_build_object('occupation', r.occupation_id, 'rank', v_rank, 'note', p_note));
end $$;

-- ---------- private file storage (ID cards, selfies, career documents, payment slips) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-docs', 'private-docs', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "rlq private-docs upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "rlq private-docs read own or reviewers" on storage.objects for select to authenticated
  using (bucket_id = 'private-docs' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.has_perm('u.kyc', 'view') or public.has_perm('c.review', 'view') or public.has_perm('m.topup', 'view')));

-- ---------- row level security ----------
alter table public.private_profiles enable row level security;
alter table public.kyc_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.occupations enable row level security;
alter table public.career_ranks enable row level security;
alter table public.user_careers enable row level security;
alter table public.endorsements enable row level security;
alter table public.promotion_requests enable row level security;
alter table public.career_imports enable row level security;

revoke insert, update, truncate on public.private_profiles, public.kyc_requests, public.notifications, public.occupations,
  public.career_ranks, public.user_careers, public.endorsements, public.promotion_requests, public.career_imports from anon, authenticated;
revoke all on public.private_profiles, public.kyc_requests, public.notifications, public.occupations, public.career_ranks,
  public.user_careers, public.endorsements, public.promotion_requests, public.career_imports from anon;

create policy "own identity or kyc staff" on public.private_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('u.kyc', 'view'));
create policy "own kyc or kyc staff" on public.kyc_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('u.kyc', 'view'));
create policy "own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "occupations readable" on public.occupations for select to authenticated using (true);
create policy "ranks readable" on public.career_ranks for select to authenticated using (true);
create policy "careers readable" on public.user_careers for select to authenticated using (true);
create policy "endorsements readable" on public.endorsements for select to authenticated using (true);
create policy "own promotions or reviewers" on public.promotion_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('c.review', 'view'));
create policy "own imports or reviewers" on public.career_imports for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('c.review', 'view'));

revoke execute on function public._notify(uuid, text, text, text, text), public._notify_perm(text, text, text, text, text),
  public._assert_active(), public._assert_verified(), public._rank_ord(text), public._promote(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.mark_notifications_read(), public.submit_kyc(text, text, text, text),
  public.review_kyc(uuid, boolean, text), public.ban_user(uuid, int, text), public.start_career(text),
  public.career_gates(uuid, text), public.my_careers(), public.endorse_worker(uuid, text, text),
  public.request_promotion(text, text), public.review_promotion(uuid, boolean, text),
  public.request_career_import(text, text, numeric, text, text), public.review_career_import(uuid, boolean, text, text)
  from public, anon;
grant execute on function public.mark_notifications_read(), public.submit_kyc(text, text, text, text),
  public.review_kyc(uuid, boolean, text), public.ban_user(uuid, int, text), public.start_career(text),
  public.career_gates(uuid, text), public.my_careers(), public.endorse_worker(uuid, text, text),
  public.request_promotion(text, text), public.review_promotion(uuid, boolean, text),
  public.request_career_import(text, text, numeric, text, text), public.review_career_import(uuid, boolean, text, text)
  to authenticated;

alter publication supabase_realtime add table public.notifications;
