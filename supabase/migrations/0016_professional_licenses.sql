create table public.license_titles (
  occupation_id text primary key references public.occupations(id),
  label text not null check (char_length(label) between 2 and 60),
  min_rank text not null default 'C' references public.career_ranks(rank),
  price_gold bigint not null default 0 check (price_gold >= 0),
  slots_total int check (slots_total is null or slots_total > 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.license_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occupation_id text not null references public.license_titles(occupation_id),
  doc_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index license_applications_one_pending on public.license_applications (user_id, occupation_id) where status = 'pending';
create index license_applications_status_idx on public.license_applications (status, created_at);
create index license_applications_user_idx on public.license_applications (user_id);

create table public.user_licenses (
  user_id uuid not null references public.profiles(id) on delete cascade,
  occupation_id text not null references public.license_titles(occupation_id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, occupation_id)
);

insert into public.license_titles (occupation_id, label, min_rank, price_gold, slots_total, active) values
  ('electric', 'ช่างไฟควบคุม (สมาคมวิชาชีพรับรอง)', 'C', 500, null, true)
on conflict (occupation_id) do nothing;

create function public.set_license_title(p_occ text, p_label text, p_min_rank text, p_price_gold bigint, p_slots int default null, p_active boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('c.review') then raise exception 'forbidden'; end if;
  if not exists (select 1 from occupations where id = p_occ) then raise exception 'unknown occupation'; end if;
  if not exists (select 1 from career_ranks where rank = p_min_rank) then raise exception 'bad rank'; end if;
  insert into license_titles (occupation_id, label, min_rank, price_gold, slots_total, active, updated_at)
  values (p_occ, trim(p_label), p_min_rank, p_price_gold, p_slots, p_active, now())
  on conflict (occupation_id) do update set label = excluded.label, min_rank = excluded.min_rank,
    price_gold = excluded.price_gold, slots_total = excluded.slots_total, active = excluded.active, updated_at = now();
  perform _audit('license.set_title', 'occupation', p_occ, jsonb_build_object('label', p_label, 'min_rank', p_min_rank, 'price_gold', p_price_gold, 'slots', p_slots, 'active', p_active));
end $$;

create function public.apply_license(p_occ text, p_doc_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_verified(); lt license_titles%rowtype; v_rank text; v_id uuid;
begin
  select * into lt from license_titles where occupation_id = p_occ and active;
  if not found then raise exception 'unknown occupation'; end if;
  select rank into v_rank from user_careers where user_id = v_uid and occupation_id = p_occ;
  if v_rank is null or _rank_ord(v_rank) < _rank_ord(lt.min_rank) then raise exception 'career rank too low'; end if;
  if exists (select 1 from user_licenses where user_id = v_uid and occupation_id = p_occ and revoked_at is null) then
    raise exception 'already owned';
  end if;
  if p_doc_path is not null and split_part(p_doc_path, '/', 1) <> v_uid::text then raise exception 'bad file path'; end if;
  insert into license_applications (user_id, occupation_id, doc_path) values (v_uid, p_occ, p_doc_path) returning id into v_id;
  perform _notify_perm('c.review', 'license', 'มีคำขอขึ้นทะเบียนใบอนุญาตใหม่', lt.label, 'admin.html#licenses');
  return v_id;
end $$;

create function public.review_license(p_app uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r license_applications%rowtype; lt license_titles%rowtype;
begin
  if not has_perm('c.review') then raise exception 'forbidden'; end if;
  select * into r from license_applications where id = p_app and status = 'pending' for update;
  if not found then raise exception 'request not pending'; end if;
  select * into lt from license_titles where occupation_id = r.occupation_id;
  update license_applications set status = case when p_approve then 'approved' else 'rejected' end,
         note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
  perform _notify(r.user_id, 'license',
    case when p_approve then 'สมาคมวิชาชีพอนุมัติแล้ว' else 'สมาคมวิชาชีพไม่อนุมัติ' end,
    case when p_approve then 'ซื้อตำแหน่ง ' || lt.label || ' ได้เลย' else coalesce(p_note, '') end,
    'index.html#career');
  perform _audit('license.' || case when p_approve then 'approve' else 'reject' end, 'license_application', r.id::text, jsonb_build_object('note', p_note));
end $$;

create function public.buy_license(p_app uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_verified(); app license_applications%rowtype; lt license_titles%rowtype;
begin
  select * into app from license_applications where id = p_app and user_id = v_uid and status = 'approved';
  if not found then raise exception 'request not pending'; end if;
  if exists (select 1 from user_licenses where user_id = v_uid and occupation_id = app.occupation_id and revoked_at is null) then
    raise exception 'already owned';
  end if;
  select * into lt from license_titles where occupation_id = app.occupation_id;
  if lt.slots_total is not null and
     (select count(*) from user_licenses where occupation_id = lt.occupation_id and revoked_at is null) >= lt.slots_total then
    raise exception 'sold out';
  end if;
  if (select gold from wallets where user_id = v_uid) < lt.price_gold then raise exception 'not enough gold'; end if;
  update wallets set gold = gold - lt.price_gold, updated_at = now() where user_id = v_uid;
  perform _ledger(v_uid, 'license_purchase', -lt.price_gold, 0, null, null, lt.occupation_id);
  insert into user_licenses (user_id, occupation_id, granted_at, revoked_at) values (v_uid, lt.occupation_id, now(), null)
  on conflict (user_id, occupation_id) do update set granted_at = now(), revoked_at = null;
  perform _audit('license.buy', 'user', v_uid::text, jsonb_build_object('occupation', lt.occupation_id, 'price_gold', lt.price_gold));
end $$;

alter table public.license_titles enable row level security;
alter table public.license_applications enable row level security;
alter table public.user_licenses enable row level security;

create policy "license titles readable" on public.license_titles for select to authenticated using (true);
create policy "licenses readable" on public.user_licenses for select to authenticated using (true);
create policy "own license applications or reviewers" on public.license_applications for select to authenticated
  using (user_id = (select auth.uid()) or public.has_perm('c.review', 'view'));

revoke execute on function public.set_license_title(text, text, text, bigint, int, boolean),
  public.apply_license(text, text), public.review_license(uuid, boolean, text), public.buy_license(uuid)
  from public, anon;
grant execute on function public.set_license_title(text, text, text, bigint, int, boolean),
  public.apply_license(text, text), public.review_license(uuid, boolean, text), public.buy_license(uuid)
  to authenticated;
