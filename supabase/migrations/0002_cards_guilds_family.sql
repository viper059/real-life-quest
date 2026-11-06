-- Real-life Quest — baseline schema, part 2 (applied to project RLS on 2026-10-19 as rlq_07 … rlq_10).
-- Job cards and stats, guilds with insurance fund and claim voting, family quests.
-- Functions that were later replaced are written here in their final form.

-- ===== rlq_07_cards_stats =====
alter table public.profiles
  add column str int not null default 1 check (str >= 1),
  add column agi int not null default 1 check (agi >= 1),
  add column vit int not null default 1 check (vit >= 1),
  add column "int" int not null default 1 check ("int" >= 1),
  add column dex int not null default 1 check (dex >= 1),
  add column luk int not null default 1 check (luk >= 1),
  add column stat_points int not null default 0 check (stat_points >= 0);

create table public.job_cards (
  id text primary key,
  name text not null,
  rarity text not null check (rarity in ('N','R','SR','SSR')),
  category text not null,
  unlock_count int not null default 0,
  exp_bonus_pct int not null default 0 check (exp_bonus_pct between 0 and 100),
  stats jsonb not null default '{}'::jsonb,
  description text,
  sort int not null default 0
);
insert into public.job_cards (id, name, rarity, category, unlock_count, exp_bonus_pct, stats, description, sort) values
  ('adventurer','นักผจญภัย','N','general',0,5,'{}','การ์ดเริ่มต้น EXP +5% ทุกเควสต์',1),
  ('home_helper','แม่บ้านมือโปร','R','home',3,10,'{"vit":2,"dex":1}','ทำงานบ้านสำเร็จ 3 ครั้ง',2),
  ('home_guard','ผู้พิทักษ์บ้าน','SR','home',15,20,'{"vit":5,"dex":3}','ทำงานบ้านสำเร็จ 15 ครั้ง',3),
  ('courier','คนขับส่งของ','R','delivery',3,10,'{"agi":3}','ส่งของสำเร็จ 3 ครั้ง',4),
  ('courier_sr','สายฟ้าส่งด่วน','SR','delivery',15,20,'{"agi":6,"luk":2}','ส่งของสำเร็จ 15 ครั้ง',5),
  ('tutor','ติวเตอร์','R','tutor',3,10,'{"int":3}','สอนพิเศษสำเร็จ 3 ครั้ง',6),
  ('sage','ปราชญ์ประจำหมู่บ้าน','SR','tutor',15,20,'{"int":6,"luk":2}','สอนพิเศษสำเร็จ 15 ครั้ง',7),
  ('repair','ช่างซ่อม','R','repair',3,10,'{"dex":3,"str":1}','งานช่างสำเร็จ 3 ครั้ง',8),
  ('master_smith','ปรมาจารย์ช่าง','SSR','repair',20,30,'{"dex":8,"str":4}','งานช่างสำเร็จ 20 ครั้ง',9),
  ('family_hero','ฮีโร่ประจำบ้าน','R','family',3,10,'{"luk":3}','เควสต์ครอบครัวสำเร็จ 3 ครั้ง',10);

create table public.user_cards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id text not null references public.job_cards(id),
  obtained_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index user_cards_card_idx on public.user_cards (card_id);

create table public.decks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  main_card text references public.job_cards(id),
  support1 text references public.job_cards(id),
  support2 text references public.job_cards(id),
  support3 text references public.job_cards(id),
  updated_at timestamptz not null default now()
);
create index decks_main_idx on public.decks (main_card);
create index decks_s1_idx on public.decks (support1);
create index decks_s2_idx on public.decks (support2);
create index decks_s3_idx on public.decks (support3);

create or replace function public.handle_new_user()
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
  insert into public.profiles (id, username, job_class) values (new.id, v_name, 'นักผจญภัย');
  insert into public.wallets (user_id, gold) values (new.id, v_bonus);
  insert into public.user_cards (user_id, card_id) values (new.id, 'adventurer');
  insert into public.decks (user_id, main_card) values (new.id, 'adventurer');
  return new;
end $$;

insert into public.user_cards (user_id, card_id) select id, 'adventurer' from public.profiles on conflict do nothing;
insert into public.decks (user_id, main_card) select id, 'adventurer' from public.profiles on conflict do nothing;
update public.profiles set job_class = 'นักผจญภัย' where job_class is null;

create function public.allocate_stat(p_stat text, p_points int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_rows int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_stat not in ('str','agi','vit','int','dex','luk') then raise exception 'bad stat'; end if;
  if p_points is null or p_points < 1 then raise exception 'bad points'; end if;
  execute format('update public.profiles set %I = %I + $1, stat_points = stat_points - $1 where id = $2 and stat_points >= $1', p_stat, p_stat)
    using p_points, auth.uid();
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'not enough stat points'; end if;
end $$;

create function public.set_deck(p_main text, p_s1 text, p_s2 text, p_s3 text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cards text[] := array_remove(array[p_main, p_s1, p_s2, p_s3], null);
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_main is null then raise exception 'main card required'; end if;
  if (select count(distinct c) from unnest(v_cards) c) <> cardinality(v_cards) then raise exception 'duplicate card'; end if;
  if exists (select 1 from unnest(v_cards) c where not exists (select 1 from user_cards where user_id = v_uid and card_id = c)) then
    raise exception 'card not owned';
  end if;
  insert into decks (user_id, main_card, support1, support2, support3, updated_at)
  values (v_uid, p_main, p_s1, p_s2, p_s3, now())
  on conflict (user_id) do update set main_card = excluded.main_card, support1 = excluded.support1,
    support2 = excluded.support2, support3 = excluded.support3, updated_at = now();
  update profiles set job_class = (select name from job_cards where id = p_main) where id = v_uid;
end $$;

create or replace function public.confirm_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q quests%rowtype;
  v_pct int := 0;
  v_exp int;
  v_old_exp bigint;
  v_old_lv int;
  v_new_lv int;
  v_done int;
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
  select coalesce(jc.exp_bonus_pct, 0) into v_pct
    from decks d join job_cards jc on jc.id = d.main_card
   where d.user_id = q.worker_id and (jc.category = 'general' or jc.category = q.category);
  v_exp := q.reward_exp + (q.reward_exp * coalesce(v_pct, 0)) / 100;
  select base_exp into v_old_exp from profiles where id = q.worker_id for update;
  v_old_lv := floor(sqrt(v_old_exp / 100.0))::int + 1;
  v_new_lv := floor(sqrt((v_old_exp + v_exp) / 100.0))::int + 1;
  update profiles
     set base_exp = base_exp + v_exp,
         quests_done = quests_done + 1,
         base_level = v_new_lv,
         stat_points = stat_points + 3 * greatest(0, v_new_lv - v_old_lv)
   where id = q.worker_id;
  select count(*) into v_done from quests where worker_id = q.worker_id and status = 'completed' and category = q.category;
  insert into user_cards (user_id, card_id)
  select q.worker_id, jc.id from job_cards jc where jc.category = q.category and jc.unlock_count <= v_done
  on conflict do nothing;
  perform _ledger(q.poster_id, 'quest_paid', 0, -q.reward_gold, q.id);
  perform _ledger(q.worker_id, 'quest_reward', q.reward_gold, 0, q.id, null, case when v_pct > 0 then 'EXP +' || v_pct || '%' end);
end $$;

alter table public.job_cards enable row level security;
alter table public.user_cards enable row level security;
alter table public.decks enable row level security;
revoke insert, update, delete, truncate on public.job_cards, public.user_cards, public.decks from anon, authenticated;
revoke all on public.job_cards, public.user_cards, public.decks from anon;
create policy "cards catalog" on public.job_cards for select to authenticated using (true);
create policy "own cards or user staff" on public.user_cards for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('u.view','view'));
create policy "decks readable" on public.decks for select to authenticated using (true);
revoke execute on function public.allocate_stat(text, int), public.set_deck(text, text, text, text) from public, anon;
grant execute on function public.allocate_stat(text, int), public.set_deck(text, text, text, text), public.confirm_quest(uuid) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ===== rlq_08a/08b/08c guilds =====
create table public.guilds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 3 and 40),
  motto text check (char_length(motto) <= 120),
  leader_id uuid not null references public.profiles(id),
  fund_gold bigint not null default 0 check (fund_gold >= 0),
  member_cap int not null default 40 check (member_cap between 2 and 200),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index guilds_leader_idx on public.guilds (leader_id);

create table public.guild_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  guild_id uuid not null references public.guilds(id) on delete cascade,
  role text not null default 'member' check (role in ('leader','officer','member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
create index guild_members_guild_idx on public.guild_members (guild_id);
create index guild_members_active_idx on public.guild_members (guild_id) where left_at is null;

create table public.guild_claims (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  claimant_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount > 0),
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'voting' check (status in ('voting','approved','rejected','paid')),
  yes_votes int not null default 0,
  no_votes int not null default 0,
  closes_at timestamptz not null default now() + interval '3 days',
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index guild_claims_guild_idx on public.guild_claims (guild_id, status);
create index guild_claims_claimant_idx on public.guild_claims (claimant_id);
create index guild_claims_decided_by_idx on public.guild_claims (decided_by);

create table public.guild_votes (
  claim_id uuid not null references public.guild_claims(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  approve boolean not null,
  voted_at timestamptz not null default now(),
  primary key (claim_id, user_id)
);
create index guild_votes_user_idx on public.guild_votes (user_id);

alter table public.guilds enable row level security;
alter table public.guild_members enable row level security;
alter table public.guild_claims enable row level security;
alter table public.guild_votes enable row level security;
revoke insert, update, delete, truncate on public.guilds, public.guild_members, public.guild_claims, public.guild_votes from anon, authenticated;
revoke all on public.guilds, public.guild_members, public.guild_claims, public.guild_votes from anon;

create function public.my_guild()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select guild_id from public.guild_members where user_id = auth.uid() and left_at is null; $$;

create policy "guilds readable" on public.guilds for select to authenticated using (true);
create policy "members readable" on public.guild_members for select to authenticated using (true);
create policy "own guild claims or fund staff" on public.guild_claims for select to authenticated
  using (guild_id = public.my_guild() or public.has_perm('g.fund','view'));
create policy "own guild votes or fund staff" on public.guild_votes for select to authenticated
  using (exists (select 1 from public.guild_claims c where c.id = claim_id and c.guild_id = public.my_guild())
         or public.has_perm('g.fund','view'));
alter publication supabase_realtime add table public.guilds, public.guild_claims;

create function public.create_guild(p_name text, p_motto text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.my_guild() is not null then raise exception 'already in a guild'; end if;
  insert into guilds (name, motto, leader_id) values (trim(p_name), nullif(trim(p_motto), ''), auth.uid()) returning id into v_id;
  insert into guild_members (user_id, guild_id, role) values (auth.uid(), v_id, 'leader')
  on conflict (user_id) do update set guild_id = excluded.guild_id, role = 'leader', joined_at = now(), left_at = null;
  return v_id;
end $$;

create function public.join_guild(p_guild uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare g guilds%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.my_guild() is not null then raise exception 'already in a guild'; end if;
  select * into g from guilds where id = p_guild and closed_at is null for update;
  if not found then raise exception 'guild not found'; end if;
  if (select count(*) from guild_members where guild_id = g.id and left_at is null) >= g.member_cap then raise exception 'guild is full'; end if;
  insert into guild_members (user_id, guild_id) values (auth.uid(), g.id)
  on conflict (user_id) do update set guild_id = excluded.guild_id, role = 'member', joined_at = now(), left_at = null;
end $$;

create function public.leave_guild()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare m guild_members%rowtype; g guilds%rowtype; v_left int;
begin
  select * into m from guild_members where user_id = auth.uid() and left_at is null;
  if not found then raise exception 'not in a guild'; end if;
  select * into g from guilds where id = m.guild_id for update;
  select count(*) - 1 into v_left from guild_members where guild_id = g.id and left_at is null;
  if m.role = 'leader' and v_left > 0 then raise exception 'transfer leadership first'; end if;
  if v_left = 0 then
    if g.fund_gold > 0 then
      update wallets set gold = gold + g.fund_gold, updated_at = now() where user_id = auth.uid();
      perform _ledger(auth.uid(), 'guild_refund', g.fund_gold, 0, null, null, 'guild closed');
    end if;
    update guilds set fund_gold = 0, closed_at = now() where id = g.id;
    update guild_claims set status = 'rejected', decided_at = now() where guild_id = g.id and status in ('voting','approved');
  end if;
  update guild_members set left_at = now(), role = 'member' where user_id = auth.uid();
end $$;

create function public.transfer_leader(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_g uuid := public.my_guild();
begin
  if not exists (select 1 from guild_members where user_id = auth.uid() and role = 'leader' and left_at is null) then raise exception 'leader only'; end if;
  if not exists (select 1 from guild_members where user_id = p_user and guild_id = v_g and left_at is null) then raise exception 'not a member'; end if;
  update guild_members set role = 'member' where user_id = auth.uid();
  update guild_members set role = 'leader' where user_id = p_user;
  update guilds set leader_id = p_user where id = v_g;
end $$;

create function public.contribute_guild(p_amount bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_g uuid := public.my_guild();
begin
  if v_g is null then raise exception 'not in a guild'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  update wallets set gold = gold - p_amount, updated_at = now() where user_id = auth.uid() and gold >= p_amount;
  if not found then raise exception 'not enough gold'; end if;
  update guilds set fund_gold = fund_gold + p_amount where id = v_g;
  perform _ledger(auth.uid(), 'guild_contribute', -p_amount, 0, null, null, v_g::text);
end $$;

create function public.file_guild_claim(p_amount bigint, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_g uuid := public.my_guild(); v_id uuid; v_others int;
begin
  if v_g is null then raise exception 'not in a guild'; end if;
  if exists (select 1 from guild_claims where claimant_id = auth.uid() and status in ('voting','approved')) then
    raise exception 'you already have an open claim';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > (select fund_gold from guilds where id = v_g) then
    raise exception 'claim exceeds fund';
  end if;
  select count(*) - 1 into v_others from guild_members where guild_id = v_g and left_at is null;
  insert into guild_claims (guild_id, claimant_id, amount, reason, status)
  values (v_g, auth.uid(), p_amount, p_reason, case when v_others = 0 then 'approved' else 'voting' end)
  returning id into v_id;
  return v_id;
end $$;

create function public.vote_guild_claim(p_claim uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare c guild_claims%rowtype; v_eligible int; v_yes int; v_no int; v_status text;
begin
  select * into c from guild_claims where id = p_claim for update;
  if not found or c.guild_id is distinct from public.my_guild() then raise exception 'claim not found'; end if;
  if c.claimant_id = auth.uid() then raise exception 'cannot vote on your own claim'; end if;
  if c.status <> 'voting' or c.closes_at < now() then raise exception 'voting closed'; end if;
  insert into guild_votes (claim_id, user_id, approve) values (c.id, auth.uid(), p_approve)
  on conflict (claim_id, user_id) do update set approve = excluded.approve, voted_at = now();
  select count(*) filter (where approve), count(*) filter (where not approve) into v_yes, v_no from guild_votes where claim_id = c.id;
  select count(*) - 1 into v_eligible from guild_members where guild_id = c.guild_id and left_at is null;
  v_status := case when v_yes * 2 > v_eligible then 'approved'
                   when v_no * 2 >= v_eligible then 'rejected' else 'voting' end;
  update guild_claims set yes_votes = v_yes, no_votes = v_no, status = v_status,
         decided_at = case when v_status <> 'voting' then now() end where id = c.id;
  return v_status;
end $$;

create function public.decide_guild_claim(p_claim uuid, p_pay boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare c guild_claims%rowtype;
begin
  if not has_perm('g.fund') then raise exception 'forbidden'; end if;
  select * into c from guild_claims where id = p_claim for update;
  if not found or c.status <> 'approved' then raise exception 'claim not approved'; end if;
  if p_pay then
    update guilds set fund_gold = fund_gold - c.amount where id = c.guild_id and fund_gold >= c.amount;
    if not found then raise exception 'fund too low'; end if;
    update wallets set gold = gold + c.amount, updated_at = now() where user_id = c.claimant_id;
    perform _ledger(c.claimant_id, 'guild_claim_paid', c.amount, 0, null, null, c.id::text);
    update guild_claims set status = 'paid', decided_by = auth.uid(), decided_at = now() where id = c.id;
  else
    update guild_claims set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = c.id;
  end if;
  perform _audit('guild_claim.' || case when p_pay then 'paid' else 'rejected' end, 'guild_claim', c.id::text,
                 jsonb_build_object('amount', c.amount, 'guild', c.guild_id));
  return case when p_pay then 'paid' else 'rejected' end;
end $$;

revoke execute on function public.my_guild(), public.create_guild(text, text), public.join_guild(uuid), public.leave_guild(),
  public.transfer_leader(uuid), public.contribute_guild(bigint), public.file_guild_claim(bigint, text),
  public.vote_guild_claim(uuid, boolean), public.decide_guild_claim(uuid, boolean) from public, anon;
grant execute on function public.my_guild(), public.create_guild(text, text), public.join_guild(uuid), public.leave_guild(),
  public.transfer_leader(uuid), public.contribute_guild(bigint), public.file_guild_claim(bigint, text),
  public.vote_guild_claim(uuid, boolean), public.decide_guild_claim(uuid, boolean) to authenticated;

-- ===== rlq_09_family_quests =====
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index families_created_by_idx on public.families (created_by);

create table public.family_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
create index family_members_family_idx on public.family_members (family_id) where left_at is null;

alter table public.quests add column family_id uuid references public.families(id);
create index quests_family_idx on public.quests (family_id, status);

create function public.my_family()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select family_id from public.family_members where user_id = auth.uid() and left_at is null; $$;

create function public.create_family(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.my_family() is not null then raise exception 'already in a family'; end if;
  insert into families (name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into family_members (user_id, family_id, role) values (auth.uid(), v_id, 'parent')
  on conflict (user_id) do update set family_id = excluded.family_id, role = 'parent', joined_at = now(), left_at = null;
  return v_id;
end $$;

create function public.join_family(p_code text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_role not in ('parent','child') then raise exception 'bad role'; end if;
  if public.my_family() is not null then raise exception 'already in a family'; end if;
  select id into v_id from families where join_code = upper(trim(p_code));
  if v_id is null then raise exception 'family code not found'; end if;
  insert into family_members (user_id, family_id, role) values (auth.uid(), v_id, p_role)
  on conflict (user_id) do update set family_id = excluded.family_id, role = excluded.role, joined_at = now(), left_at = null;
  return v_id;
end $$;

create function public.leave_family()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update family_members set left_at = now() where user_id = auth.uid() and left_at is null;
  if not found then raise exception 'not in a family'; end if;
end $$;

create function public.post_family_quest(p_title text, p_description text, p_reward_gold bigint, p_urgent_minutes int default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fam uuid := public.my_family();
  v_id uuid;
begin
  if v_fam is null or not exists (select 1 from family_members where user_id = v_uid and role = 'parent' and left_at is null) then
    raise exception 'parents only';
  end if;
  if p_reward_gold is null or p_reward_gold <= 0 then raise exception 'reward must be positive'; end if;
  if p_urgent_minutes is not null and (p_urgent_minutes < 10 or p_urgent_minutes > 1440) then
    raise exception 'urgent window must be 10-1440 minutes';
  end if;
  update wallets set gold = gold - p_reward_gold, gold_locked = gold_locked + p_reward_gold, updated_at = now()
   where user_id = v_uid and gold >= p_reward_gold;
  if not found then raise exception 'not enough gold'; end if;
  insert into quests (poster_id, title, description, category, rank, reward_gold, reward_exp, moderation, urgent_until, family_id)
  values (v_uid, p_title, p_description, 'family', 'F', p_reward_gold,
          least(1000, greatest(10, (p_reward_gold / 3)::int)), 'approved',
          case when p_urgent_minutes is null then null else now() + make_interval(mins => p_urgent_minutes) end, v_fam)
  returning id into v_id;
  perform _ledger(v_uid, 'quest_escrow', -p_reward_gold, p_reward_gold, v_id);
  return v_id;
end $$;

create or replace function public.accept_quest(p_quest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_fam uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select family_id into v_fam from quests where id = p_quest;
  if v_fam is not null and not exists (
       select 1 from family_members where user_id = auth.uid() and family_id = v_fam and role = 'child' and left_at is null) then
    raise exception 'quest not available';
  end if;
  update quests set worker_id = auth.uid(), status = 'in_progress', updated_at = now()
   where id = p_quest and status = 'open' and moderation = 'approved'
     and worker_id is null and poster_id <> auth.uid();
  if not found then raise exception 'quest not available'; end if;
end $$;

alter policy "board, own quests, or reviewers" on public.quests
  using ((status = 'open' and moderation = 'approved' and family_id is null)
         or (family_id is not null and family_id = public.my_family())
         or poster_id = (select auth.uid()) or worker_id = (select auth.uid())
         or public.has_perm('q.review','view'));

alter table public.families enable row level security;
alter table public.family_members enable row level security;
revoke insert, update, truncate on public.families, public.family_members from anon, authenticated;
revoke all on public.families, public.family_members from anon;
create policy "own family" on public.families for select to authenticated using (id = public.my_family());
create policy "own family members" on public.family_members for select to authenticated
  using (family_id = public.my_family() and left_at is null);
revoke execute on function public.my_family(), public.create_family(text), public.join_family(text, text), public.leave_family(),
  public.post_family_quest(text, text, bigint, int) from public, anon;
grant execute on function public.my_family(), public.create_family(text), public.join_family(text, text), public.leave_family(),
  public.post_family_quest(text, text, bigint, int), public.accept_quest(uuid) to authenticated;
