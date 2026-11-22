-- ===== God tier + deputy + geographic admin ladder =====
-- Ladder: god (bypasses every permission check, immune to ban/removal) > deputy (full
-- power like the old "owner", second-in-command) > continent/country/region/province/
-- district/subdistrict admins (geographically scoped moderators). The existing
-- functional roles (admin/mod/finance/support) are untouched and keep working exactly
-- as before, on a separate axis from this geographic ladder.

insert into public.staff_roles (id, label, sort) values
  ('god', 'GOD (เหนือทุกกฎ)', 0),
  ('deputy', 'แอดมินรองสูงสุด', 1),
  ('continent_admin', 'แอดมินระดับทวีป', 6),
  ('country_admin', 'แอดมินระดับประเทศ', 7),
  ('region_admin', 'แอดมินระดับภาค', 8),
  ('province_admin', 'แอดมินระดับจังหวัด', 9),
  ('district_admin', 'แอดมินระดับอำเภอ', 10),
  ('subdistrict_admin', 'แอดมินระดับตำบล', 11)
on conflict (id) do nothing;

-- scope columns: which geographic unit a geo-tier admin governs. Null for every
-- non-geo role (god/deputy/owner/admin/mod/finance/support).
alter table public.staff_members
  add column if not exists scope_level text check (scope_level in ('continent','country','region','province','district','subdistrict')),
  add column if not exists scope_value text check (scope_value is null or char_length(scope_value) between 1 and 80);
alter table public.staff_members add constraint staff_members_scope_pair
  check ((scope_level is null) = (scope_value is null));

-- structured locality on a quest's job site, so geo-tier admins have something to
-- scope against. Free text for now (no boundary/geocoding dataset wired up yet) —
-- filled by the poster alongside the address.
alter table public.quest_locations
  add column if not exists region text check (char_length(region) <= 60),
  add column if not exists province text check (char_length(province) <= 60),
  add column if not exists district text check (char_length(district) <= 60),
  add column if not exists subdistrict text check (char_length(subdistrict) <= 60);

-- deputy mirrors full access on every permission that currently exists (same as owner).
insert into public.role_permissions (role_id, permission_id, level)
select 'deputy', id, 'full' from public.permissions
on conflict (role_id, permission_id) do update set level = 'full';

-- geo-tier admins start with quest moderation + reports + disputes (full) and
-- read-only user lookup. God/deputy can broaden any of this later from the existing
-- "จัดการบทบาทและสิทธิ์" admin screen — no code change needed for that.
insert into public.role_permissions (role_id, permission_id, level)
select r.role_id, p.perm, p.level
from (values ('q.review','full'),('q.reports','full'),('q.dispute','full'),('u.view','view')) as p(perm, level)
cross join (values ('continent_admin'),('country_admin'),('region_admin'),('province_admin'),('district_admin'),('subdistrict_admin')) as r(role_id)
on conflict (role_id, permission_id) do nothing;

-- god bypasses every permission check outright.
create or replace function public.has_perm(p_perm text, p_min text default 'full')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid() and role_id = 'god')
  or exists (
    select 1 from public.staff_members s
    join public.role_permissions rp on rp.role_id = s.role_id
    where s.user_id = auth.uid()
      and rp.permission_id = p_perm
      and (rp.level = 'full' or p_min = 'view')
  );
$$;

create or replace function public.is_god()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid() and role_id = 'god');
$$;

-- Whether the caller's own jurisdiction (if any) covers the given quest locality.
-- Non-geo roles (god/deputy/owner/admin/mod/finance/support), or a geo role with no
-- matching case below, are left unrestricted by this check — it only narrows the six
-- geo-tier roles. Continent/country tiers are effectively global while the app only
-- operates in Thailand/Asia; they start mattering once it expands abroad.
create or replace function public._in_geo_scope(p_region text, p_province text, p_district text, p_subdistrict text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case s.role_id
      when 'continent_admin' then true
      when 'country_admin' then true
      when 'region_admin' then s.scope_value = p_region
      when 'province_admin' then s.scope_value = p_province
      when 'district_admin' then s.scope_value = p_district
      when 'subdistrict_admin' then s.scope_value = p_subdistrict
      else true
    end
    from public.staff_members s where s.user_id = auth.uid()
  ), true);
$$;

-- assign_staff: now also carries the geo scope, and protects the god role the way
-- the old owner-protection worked (never leave the system with zero gods, and only
-- a god can grant or revoke the god role itself).
create or replace function public.assign_staff(p_user uuid, p_role text, p_scope_level text default null, p_scope_value text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('s.roles') then raise exception 'forbidden'; end if;
  if (p_role = 'god' or exists (select 1 from staff_members where user_id = p_user and role_id = 'god'))
     and not is_god() then
    raise exception 'only a god account can grant or change a god account';
  end if;
  if exists (select 1 from staff_members where user_id = p_user and role_id = 'god')
     and coalesce(p_role, '') <> 'god'
     and (select count(*) from staff_members where role_id = 'god') = 1 then
    raise exception 'cannot remove the last god';
  end if;
  if exists (select 1 from staff_members where user_id = p_user and role_id = 'owner')
     and coalesce(p_role, '') <> 'owner'
     and (select count(*) from staff_members where role_id = 'owner') = 1 then
    raise exception 'cannot remove the last owner';
  end if;
  if p_role in ('continent_admin','country_admin','region_admin','province_admin','district_admin','subdistrict_admin') then
    if p_scope_level is null or p_scope_value is null or trim(p_scope_value) = '' then
      raise exception 'geo admin needs a scope area';
    end if;
  else
    p_scope_level := null; p_scope_value := null;
  end if;
  if p_role is null then
    delete from staff_members where user_id = p_user;
  else
    insert into staff_members (user_id, role_id, scope_level, scope_value, added_by)
    values (p_user, p_role, p_scope_level, p_scope_value, auth.uid())
    on conflict (user_id) do update set role_id = excluded.role_id, scope_level = excluded.scope_level,
      scope_value = excluded.scope_value, added_by = excluded.added_by, added_at = now();
  end if;
  perform _audit('staff.assign', 'user', p_user::text, jsonb_build_object('role', p_role, 'scope_level', p_scope_level, 'scope_value', p_scope_value));
end $$;

-- geo-scope gate on quest moderation, report resolution and dispute judging.
create or replace function public.moderate_quest(p_quest uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q quests%rowtype; loc quest_locations%rowtype;
begin
  if not has_perm('q.review') then raise exception 'forbidden'; end if;
  if p_decision not in ('approve','changes','suspend') then raise exception 'bad decision'; end if;
  select * into q from quests where id = p_quest for update;
  if not found then raise exception 'quest not found'; end if;
  select * into loc from quest_locations where quest_id = q.id;
  if not public._in_geo_scope(loc.region, loc.province, loc.district, loc.subdistrict) then
    raise exception 'outside your region';
  end if;
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

create or replace function public.resolve_report(p_report bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_quest uuid; loc quest_locations%rowtype;
begin
  if not has_perm('q.reports') then raise exception 'forbidden'; end if;
  select quest_id into v_quest from reports where id = p_report and status = 'open';
  if not found then raise exception 'report not open'; end if;
  select * into loc from quest_locations where quest_id = v_quest;
  if not public._in_geo_scope(loc.region, loc.province, loc.district, loc.subdistrict) then
    raise exception 'outside your region';
  end if;
  update reports set status = 'resolved', resolved_by = auth.uid() where id = p_report;
  perform _audit('report.resolve', 'report', p_report::text);
end $$;

create or replace function public.resolve_dispute(p_dispute uuid, p_worker_pct int, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare d disputes%rowtype; q quests%rowtype; loc quest_locations%rowtype;
begin
  if not has_perm('q.dispute') then raise exception 'forbidden'; end if;
  if p_worker_pct is null or p_worker_pct < 0 or p_worker_pct > 100 then raise exception 'percent must be 0-100'; end if;
  select * into d from disputes where id = p_dispute for update;
  if not found or d.status <> 'open' then raise exception 'dispute not open'; end if;
  select * into q from quests where id = d.quest_id;
  if auth.uid() in (q.poster_id, q.worker_id) then raise exception 'cannot judge your own quest'; end if;
  select * into loc from quest_locations where quest_id = q.id;
  if not public._in_geo_scope(loc.region, loc.province, loc.district, loc.subdistrict) then
    raise exception 'outside your region';
  end if;
  perform _settle(d.quest_id, p_worker_pct, 'dispute: ' || p_worker_pct || '% to worker');
  update disputes set status = 'resolved', worker_pct = p_worker_pct, resolution_note = p_note,
         resolved_by = auth.uid(), resolved_at = now() where id = d.id;
  perform _notify(q.poster_id, 'dispute', 'ข้อพิพาทได้ข้อยุติแล้ว', coalesce(p_note, ''), 'index.html#quest-' || q.id);
  perform _notify(q.worker_id, 'dispute', 'ข้อพิพาทได้ข้อยุติแล้ว', coalesce(p_note, ''), 'index.html#quest-' || q.id);
  perform _audit('dispute.resolve', 'quest', q.id::text, jsonb_build_object('worker_pct', p_worker_pct, 'note', p_note));
end $$;

-- god (and the legacy owner) can never be banned by anyone.
create or replace function public.ban_user(p_user uuid, p_days int, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_perm('u.ban') then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  if exists (select 1 from staff_members where user_id = p_user and role_id in ('owner','god')) then raise exception 'cannot ban an owner'; end if;
  update profiles set
    banned_until = case when p_days = 0 then null when p_days is null then 'infinity'::timestamptz else now() + make_interval(days => p_days) end,
    ban_reason = case when p_days = 0 then null else p_reason end
  where id = p_user;
  if not found then raise exception 'user not found'; end if;
  perform _audit(case when p_days = 0 then 'user.unban' else 'user.ban' end, 'user', p_user::text,
                 jsonb_build_object('days', p_days, 'reason', p_reason));
end $$;

-- a god self-approves KYC the same way the sole owner could before.
create or replace function public.review_kyc(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r kyc_requests%rowtype; v_is_owner boolean;
begin
  if not has_perm('u.kyc') then raise exception 'forbidden'; end if;
  select * into r from kyc_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'request not pending'; end if;
  select exists(select 1 from staff_members where user_id = auth.uid() and role_id in ('owner','god')) into v_is_owner;
  if r.user_id = auth.uid() and not v_is_owner then raise exception 'cannot review your own request'; end if;
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

-- move Viper from 'owner' to the new top-of-ladder 'god' role.
update staff_members set role_id = 'god', scope_level = null, scope_value = null
where user_id = (select id from profiles where username = 'Viper');
