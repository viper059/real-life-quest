-- Real-life Quest — baseline schema, part 1 (applied to project RLS on 2026-10-19 as rlq_01 … rlq_06).
-- Core tables, staff roles and permissions, quest flow with escrow, withdrawals, RLS and grants.

-- ===== rlq_01_core =====
create table public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('gold_thb_rate', ''),
  ('signup_bonus_gold', '0'),
  ('review_reward_threshold', '5000'),
  ('withdraw_min_gold', '100'),
  ('withdraw_dual_threshold', '5000');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  base_level int not null default 1,
  base_exp bigint not null default 0 check (base_exp >= 0),
  job_class text,
  job_level int not null default 1,
  rank text not null default 'F' check (rank in ('S','A','B','C','D','E','F')),
  quests_done int not null default 0,
  created_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gold bigint not null default 0 check (gold >= 0),
  gold_locked bigint not null default 0 check (gold_locked >= 0),
  crystal bigint not null default 0 check (crystal >= 0),
  updated_at timestamptz not null default now()
);

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  poster_id uuid not null references public.profiles(id),
  worker_id uuid references public.profiles(id),
  title text not null check (char_length(title) between 4 and 120),
  description text check (char_length(description) <= 2000),
  category text not null default 'general' check (char_length(category) <= 30),
  rank text not null default 'E' check (rank in ('S','A','B','C','D','E','F')),
  reward_gold bigint not null check (reward_gold > 0),
  reward_exp int not null default 0 check (reward_exp >= 0),
  status text not null default 'open'
    check (status in ('open','in_progress','submitted','completed','cancelled','suspended')),
  moderation text not null default 'approved'
    check (moderation in ('pending','approved','changes_requested','suspended')),
  moderation_note text,
  urgent_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (worker_id is null or worker_id <> poster_id)
);
create index quests_board_idx on public.quests (status, moderation, created_at desc);
create index quests_poster_idx on public.quests (poster_id);
create index quests_worker_idx on public.quests (worker_id);

create table public.transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  gold_delta bigint not null default 0,
  locked_delta bigint not null default 0,
  crystal_delta bigint not null default 0,
  quest_id uuid references public.quests(id),
  withdrawal_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index transactions_user_idx on public.transactions (user_id, created_at desc);
create index transactions_quest_idx on public.transactions (quest_id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := new.raw_user_meta_data->>'username';
  v_bonus bigint := coalesce(nullif((select value from public.app_settings where key = 'signup_bonus_gold'), '')::bigint, 0);
begin
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,20}$'
     or exists (select 1 from public.profiles where username = v_name) then
    v_name := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  insert into public.profiles (id, username) values (new.id, v_name);
  insert into public.wallets (user_id, gold) values (new.id, v_bonus);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== rlq_02_rbac =====
create table public.staff_roles (
  id text primary key,
  label text not null,
  sort int not null default 0
);
create table public.permissions (
  id text primary key,
  label text not null,
  grp text not null,
  sort int not null default 0
);
create table public.role_permissions (
  role_id text not null references public.staff_roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  level text not null check (level in ('full','view')),
  primary key (role_id, permission_id)
);
create table public.staff_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role_id text not null references public.staff_roles(id),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now()
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

insert into public.staff_roles (id, label, sort) values
  ('owner','เจ้าของระบบ',1),('admin','ผู้ดูแลระบบ',2),('mod','ผู้ตรวจเควสต์',3),
  ('finance','การเงิน',4),('support','ซัพพอร์ต',5);

insert into public.permissions (id, label, grp, sort) values
  ('q.review','ตรวจ อนุมัติ ระงับเควสต์','เควสต์และผู้ใช้',1),
  ('q.reports','จัดการรายงานและข้อร้องเรียน','เควสต์และผู้ใช้',2),
  ('u.view','ดูข้อมูลผู้ใช้','เควสต์และผู้ใช้',3),
  ('u.ban','ระงับหรือแบนบัญชี','เควสต์และผู้ใช้',4),
  ('g.manage','จัดการกิลด์','กิลด์',5),
  ('g.fund','จ่ายเคลมกองทุนกิลด์','กิลด์',6),
  ('m.withdraw','อนุมัติถอนเงิน','เงิน',7),
  ('m.ledger','ดูธุรกรรมทั้งหมด','เงิน',8),
  ('m.rate','ตั้งอัตรา Gold และราคา Crystal','เงิน',9),
  ('s.roles','จัดการบทบาทและสิทธิ์','ระบบ',10),
  ('s.audit','ดูบันทึกการตรวจสอบ','ระบบ',11);

insert into public.role_permissions (role_id, permission_id, level)
select r.role_id, m.perm, case substr(m.spec, r.pos, 1) when 'F' then 'full' else 'view' end
from (values ('q.review','FFFNN'),('q.reports','FFFNF'),('u.view','FFVVV'),('u.ban','FFNNN'),
             ('g.manage','FFNNN'),('g.fund','FVNFN'),('m.withdraw','FNNFN'),('m.ledger','FVNFN'),
             ('m.rate','FNNVN'),('s.roles','FNNNN'),('s.audit','FVNVN')) as m(perm, spec)
cross join (values ('owner',1),('admin',2),('mod',3),('finance',4),('support',5)) as r(role_id, pos)
where substr(m.spec, r.pos, 1) <> 'N';

create function public.has_perm(p_perm text, p_min text default 'full')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members s
    join public.role_permissions rp on rp.role_id = s.role_id
    where s.user_id = auth.uid()
      and rp.permission_id = p_perm
      and (rp.level = 'full' or p_min = 'view')
  );
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid());
$$;

create function public._audit(p_action text, p_type text, p_id text, p_detail jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (actor, action, target_type, target_id, detail)
  values (auth.uid(), p_action, p_type, p_id, p_detail);
$$;

create function public._ledger(p_user uuid, p_kind text, p_gold bigint, p_locked bigint,
                               p_quest uuid default null, p_withdrawal uuid default null, p_note text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.transactions (user_id, kind, gold_delta, locked_delta, quest_id, withdrawal_id, note)
  values (p_user, p_kind, p_gold, p_locked, p_quest, p_withdrawal, p_note);
$$;

-- ===== rlq_03_quest_flow =====
create table public.reports (
  id bigint generated always as identity primary key,
  quest_id uuid not null references public.quests(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (quest_id, reporter_id)
);

create function public.post_quest(p_title text, p_description text, p_category text,
                                  p_rank text, p_reward_gold bigint, p_urgent_minutes int default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_threshold bigint := coalesce(nullif((select value from app_settings where key = 'review_reward_threshold'), '')::bigint, 5000);
  v_exp int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_reward_gold is null or p_reward_gold <= 0 then raise exception 'reward must be positive'; end if;
  if p_urgent_minutes is not null and (p_urgent_minutes < 10 or p_urgent_minutes > 1440) then
    raise exception 'urgent window must be 10-1440 minutes';
  end if;
  update wallets set gold = gold - p_reward_gold, gold_locked = gold_locked + p_reward_gold, updated_at = now()
   where user_id = v_uid and gold >= p_reward_gold;
  if not found then raise exception 'not enough gold'; end if;
  v_exp := least(1000, greatest(10, (p_reward_gold / 3)::int));
  insert into quests (poster_id, title, description, category, rank, reward_gold, reward_exp, moderation, urgent_until)
  values (v_uid, p_title, p_description, coalesce(p_category, 'general'), coalesce(p_rank, 'E'),
          p_reward_gold, v_exp,
          case when p_reward_gold >= v_threshold then 'pending' else 'approved' end,
          case when p_urgent_minutes is null then null else now() + make_interval(mins => p_urgent_minutes) end)
  returning id into v_id;
  perform _ledger(v_uid, 'quest_escrow', -p_reward_gold, p_reward_gold, v_id);
  return v_id;
end $$;

create function public.accept_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update quests set worker_id = auth.uid(), status = 'in_progress', updated_at = now()
   where id = p_quest and status = 'open' and moderation = 'approved'
     and worker_id is null and poster_id <> auth.uid();
  if not found then raise exception 'quest not available'; end if;
end $$;

create function public.submit_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update quests set status = 'submitted', updated_at = now()
   where id = p_quest and worker_id = auth.uid() and status = 'in_progress';
  if not found then raise exception 'cannot submit this quest'; end if;
end $$;

create function public.confirm_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> auth.uid() or q.status <> 'submitted' then
    raise exception 'cannot confirm this quest';
  end if;
  update wallets set gold_locked = gold_locked - q.reward_gold, updated_at = now()
   where user_id = q.poster_id and gold_locked >= q.reward_gold;
  if not found then raise exception 'escrow mismatch'; end if;
  update wallets set gold = gold + q.reward_gold, updated_at = now() where user_id = q.worker_id;
  update quests set status = 'completed', updated_at = now() where id = q.id;
  update profiles
     set base_exp = base_exp + q.reward_exp,
         quests_done = quests_done + 1,
         base_level = floor(sqrt((base_exp + q.reward_exp) / 100.0))::int + 1
   where id = q.worker_id;
  perform _ledger(q.poster_id, 'quest_paid', 0, -q.reward_gold, q.id);
  perform _ledger(q.worker_id, 'quest_reward', q.reward_gold, 0, q.id);
end $$;

create function public.cancel_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q quests%rowtype;
begin
  select * into q from quests where id = p_quest for update;
  if not found or q.poster_id <> auth.uid() or q.status <> 'open' then
    raise exception 'cannot cancel this quest';
  end if;
  update wallets set gold = gold + q.reward_gold, gold_locked = gold_locked - q.reward_gold, updated_at = now()
   where user_id = q.poster_id;
  update quests set status = 'cancelled', updated_at = now() where id = q.id;
  perform _ledger(q.poster_id, 'quest_refund', q.reward_gold, -q.reward_gold, q.id);
end $$;

create function public.report_quest(p_quest uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into reports (quest_id, reporter_id, reason) values (p_quest, auth.uid(), p_reason)
  on conflict (quest_id, reporter_id) do nothing;
end $$;

create function public.moderate_quest(p_quest uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q quests%rowtype;
begin
  if not has_perm('q.review') then raise exception 'forbidden'; end if;
  if p_decision not in ('approve','changes','suspend') then raise exception 'bad decision'; end if;
  select * into q from quests where id = p_quest for update;
  if not found then raise exception 'quest not found'; end if;
  if p_decision = 'approve' then
    update quests set moderation = 'approved', moderation_note = p_note, updated_at = now() where id = q.id;
  elsif p_decision = 'changes' then
    update quests set moderation = 'changes_requested', moderation_note = p_note, updated_at = now() where id = q.id;
  else
    if q.status in ('open','in_progress','submitted') then
      update wallets set gold = gold + q.reward_gold, gold_locked = gold_locked - q.reward_gold, updated_at = now()
       where user_id = q.poster_id;
      perform _ledger(q.poster_id, 'quest_refund', q.reward_gold, -q.reward_gold, q.id, null, 'suspended by moderator');
    end if;
    update quests set moderation = 'suspended', status = 'suspended', moderation_note = p_note, updated_at = now()
     where id = q.id;
  end if;
  perform _audit('quest.' || p_decision, 'quest', q.id::text, jsonb_build_object('note', p_note));
end $$;

create function public.resolve_report(p_report bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('q.reports') then raise exception 'forbidden'; end if;
  update reports set status = 'resolved', resolved_by = auth.uid() where id = p_report and status = 'open';
  if not found then raise exception 'report not open'; end if;
  perform _audit('report.resolve', 'report', p_report::text);
end $$;

-- ===== rlq_04_withdrawals_admin =====
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_gold bigint not null check (amount_gold > 0),
  bank_label text not null check (char_length(bank_label) between 3 and 60),
  status text not null default 'pending' check (status in ('pending','second_approval','paid','rejected')),
  first_approver uuid references public.profiles(id),
  second_approver uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index withdrawals_status_idx on public.withdrawals (status, created_at);
alter table public.transactions
  add constraint transactions_withdrawal_fk foreign key (withdrawal_id) references public.withdrawals(id);

create function public.request_withdrawal(p_amount bigint, p_bank_label text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_min bigint := coalesce(nullif((select value from app_settings where key = 'withdraw_min_gold'), '')::bigint, 100);
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_amount is null or p_amount < v_min then raise exception 'below minimum withdrawal'; end if;
  update wallets set gold = gold - p_amount, gold_locked = gold_locked + p_amount, updated_at = now()
   where user_id = v_uid and gold >= p_amount;
  if not found then raise exception 'not enough gold'; end if;
  insert into withdrawals (user_id, amount_gold, bank_label) values (v_uid, p_amount, p_bank_label)
  returning id into v_id;
  perform _ledger(v_uid, 'withdraw_hold', -p_amount, p_amount, null, v_id);
  return v_id;
end $$;

create function public.decide_withdrawal(p_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  w withdrawals%rowtype;
  v_uid uuid := auth.uid();
  v_dual bigint := coalesce(nullif((select value from app_settings where key = 'withdraw_dual_threshold'), '')::bigint, 5000);
  v_new text;
begin
  if not has_perm('m.withdraw') then raise exception 'forbidden'; end if;
  select * into w from withdrawals where id = p_id for update;
  if not found or w.status not in ('pending','second_approval') then raise exception 'withdrawal not open'; end if;
  if w.user_id = v_uid then raise exception 'cannot decide your own withdrawal'; end if;
  if not p_approve then
    update wallets set gold = gold + w.amount_gold, gold_locked = gold_locked - w.amount_gold, updated_at = now()
     where user_id = w.user_id;
    perform _ledger(w.user_id, 'withdraw_refund', w.amount_gold, -w.amount_gold, null, w.id, p_note);
    v_new := 'rejected';
    update withdrawals set status = v_new, note = p_note, decided_at = now(),
           first_approver = coalesce(first_approver, v_uid) where id = w.id;
  elsif w.status = 'pending' and w.amount_gold >= v_dual then
    v_new := 'second_approval';
    update withdrawals set status = v_new, first_approver = v_uid, note = p_note where id = w.id;
  else
    if w.status = 'second_approval' and w.first_approver = v_uid then
      raise exception 'second approval must come from a different person';
    end if;
    update wallets set gold_locked = gold_locked - w.amount_gold, updated_at = now()
     where user_id = w.user_id and gold_locked >= w.amount_gold;
    if not found then raise exception 'escrow mismatch'; end if;
    perform _ledger(w.user_id, 'withdraw_paid', 0, -w.amount_gold, null, w.id, p_note);
    v_new := 'paid';
    update withdrawals set status = v_new, decided_at = now(), note = coalesce(p_note, note),
           first_approver = coalesce(first_approver, v_uid),
           second_approver = case when w.status = 'second_approval' then v_uid else second_approver end
     where id = w.id;
  end if;
  perform _audit('withdrawal.' || v_new, 'withdrawal', w.id::text,
                 jsonb_build_object('amount', w.amount_gold, 'note', p_note));
  return v_new;
end $$;

create function public.set_role_permission(p_role text, p_perm text, p_level text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('s.roles') then raise exception 'forbidden'; end if;
  if p_role = 'owner' then raise exception 'owner permissions are locked'; end if;
  if p_level not in ('full','view','none') then raise exception 'bad level'; end if;
  if p_level = 'none' then
    delete from role_permissions where role_id = p_role and permission_id = p_perm;
  else
    insert into role_permissions (role_id, permission_id, level) values (p_role, p_perm, p_level)
    on conflict (role_id, permission_id) do update set level = excluded.level;
  end if;
  perform _audit('role.set_permission', 'role', p_role, jsonb_build_object('perm', p_perm, 'level', p_level));
end $$;

create function public.assign_staff(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('s.roles') then raise exception 'forbidden'; end if;
  if exists (select 1 from staff_members where user_id = p_user and role_id = 'owner')
     and coalesce(p_role, '') <> 'owner'
     and (select count(*) from staff_members where role_id = 'owner') = 1 then
    raise exception 'cannot remove the last owner';
  end if;
  if p_role is null then
    delete from staff_members where user_id = p_user;
  else
    insert into staff_members (user_id, role_id, added_by) values (p_user, p_role, auth.uid())
    on conflict (user_id) do update set role_id = excluded.role_id, added_by = excluded.added_by, added_at = now();
  end if;
  perform _audit('staff.assign', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

create function public.set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('m.rate') then raise exception 'forbidden'; end if;
  if p_key not in ('gold_thb_rate','signup_bonus_gold','review_reward_threshold','withdraw_min_gold','withdraw_dual_threshold') then
    raise exception 'unknown setting';
  end if;
  if p_key <> 'gold_thb_rate' and p_value !~ '^[0-9]{1,12}$' then raise exception 'must be a whole number'; end if;
  if p_key = 'gold_thb_rate' and p_value !~ '^[0-9]{1,6}(\.[0-9]{1,4})?$' then raise exception 'bad rate'; end if;
  update app_settings set value = p_value, updated_at = now() where key = p_key;
  perform _audit('setting.set', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ===== rlq_05_rls_and_grants =====
alter table public.app_settings     enable row level security;
alter table public.profiles         enable row level security;
alter table public.wallets          enable row level security;
alter table public.quests           enable row level security;
alter table public.transactions     enable row level security;
alter table public.reports          enable row level security;
alter table public.withdrawals      enable row level security;
alter table public.staff_roles      enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_members    enable row level security;
alter table public.audit_log        enable row level security;

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

create policy "settings readable" on public.app_settings for select to authenticated using (true);
create policy "profiles readable" on public.profiles for select to authenticated using (true);
grant update (display_name) on public.profiles to authenticated;
create policy "edit own display name" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own wallet or ledger staff" on public.wallets for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('m.ledger','view'));
create policy "board, own quests, or reviewers" on public.quests for select to authenticated
  using ((status = 'open' and moderation = 'approved')
         or poster_id = (select auth.uid()) or worker_id = (select auth.uid())
         or public.has_perm('q.review','view'));
create policy "own transactions or ledger staff" on public.transactions for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('m.ledger','view'));
create policy "own reports or report staff" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.has_perm('q.reports','view'));
create policy "own withdrawals or finance" on public.withdrawals for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('m.withdraw','view'));
create policy "staff read roles" on public.staff_roles for select to authenticated using (public.is_staff());
create policy "staff read permissions" on public.permissions for select to authenticated using (public.is_staff());
create policy "staff read matrix" on public.role_permissions for select to authenticated using (public.is_staff());
create policy "self or role managers" on public.staff_members for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('s.roles','view'));
create policy "auditors" on public.audit_log for select to authenticated using (public.has_perm('s.audit','view'));

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.has_perm(text, text), public.is_staff(),
  public.post_quest(text, text, text, text, bigint, int), public.accept_quest(uuid),
  public.submit_quest(uuid), public.confirm_quest(uuid), public.cancel_quest(uuid),
  public.report_quest(uuid, text), public.moderate_quest(uuid, text, text), public.resolve_report(bigint),
  public.request_withdrawal(bigint, text), public.decide_withdrawal(uuid, boolean, text),
  public.set_role_permission(text, text, text), public.assign_staff(uuid, text), public.set_setting(text, text)
to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter publication supabase_realtime add table public.quests, public.wallets;

-- ===== rlq_06_fk_indexes =====
create index reports_reporter_idx on public.reports (reporter_id);
create index reports_resolved_by_idx on public.reports (resolved_by);
create index role_permissions_perm_idx on public.role_permissions (permission_id);
create index staff_members_added_by_idx on public.staff_members (added_by);
create index staff_members_role_idx on public.staff_members (role_id);
create index transactions_withdrawal_idx on public.transactions (withdrawal_id);
create index withdrawals_first_approver_idx on public.withdrawals (first_approver);
create index withdrawals_second_approver_idx on public.withdrawals (second_approver);
create index withdrawals_user_idx on public.withdrawals (user_id, created_at desc);
