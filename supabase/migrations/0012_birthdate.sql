-- Birthdate lives in private_profiles (sensitive identity data, same as legal_name/phone),
-- never in the publicly-readable profiles table.
alter table public.private_profiles add column if not exists birthdate date;

-- Self-service: let any signed-in user set their own birthdate.
create or replace function public.set_birthdate(p_birthdate date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_birthdate is null then raise exception 'birthdate required'; end if;
  if p_birthdate > current_date then raise exception 'birthdate must be in the past'; end if;
  if p_birthdate < current_date - interval '100 years' then raise exception 'invalid birthdate'; end if;
  insert into private_profiles (user_id, birthdate)
  values (auth.uid(), p_birthdate)
  on conflict (user_id) do update set birthdate = excluded.birthdate, updated_at = now();
end;
$$;
grant execute on function public.set_birthdate(date) to authenticated;

-- Player-facing: upcoming birthdays among my current guildmates (month/day only — never exposes birth year).
create or replace function public.guild_birthdays()
returns table(user_id uuid, username text, display_name text, next_birthday date, days_until int, is_today boolean)
language plpgsql security definer set search_path = public as $$
declare v_guild uuid;
begin
  select guild_id into v_guild from guild_members where user_id = auth.uid() and left_at is null;
  if v_guild is null then return; end if;
  return query
  select p.id, p.username, p.display_name, nb.next_birthday, (nb.next_birthday - current_date)::int,
    (nb.next_birthday = current_date)
  from private_profiles pp
  join profiles p on p.id = pp.user_id
  join guild_members gm on gm.user_id = pp.user_id and gm.left_at is null and gm.guild_id = v_guild
  cross join lateral (
    select case
      when (date_trunc('year', current_date) + (pp.birthdate - date_trunc('year', pp.birthdate)))::date >= current_date
      then (date_trunc('year', current_date) + (pp.birthdate - date_trunc('year', pp.birthdate)))::date
      else (date_trunc('year', current_date) + interval '1 year' + (pp.birthdate - date_trunc('year', pp.birthdate)))::date
    end as next_birthday
  ) nb
  where pp.birthdate is not null
  order by nb.next_birthday
  limit 20;
end;
$$;
grant execute on function public.guild_birthdays() to authenticated;

-- Staff-facing (requires u.kyc view, same permission that already gates seeing legal_name/phone):
-- full birthdate + age + days until next birthday, for every user who has set one.
create or replace function public.admin_birthdays()
returns table(user_id uuid, username text, display_name text, birthdate date, next_birthday date, days_until int)
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('u.kyc', 'view') then raise exception 'not authorized'; end if;
  return query
  select p.id, p.username, p.display_name, pp.birthdate, nb.next_birthday, (nb.next_birthday - current_date)::int
  from private_profiles pp
  join profiles p on p.id = pp.user_id
  cross join lateral (
    select case
      when (date_trunc('year', current_date) + (pp.birthdate - date_trunc('year', pp.birthdate)))::date >= current_date
      then (date_trunc('year', current_date) + (pp.birthdate - date_trunc('year', pp.birthdate)))::date
      else (date_trunc('year', current_date) + interval '1 year' + (pp.birthdate - date_trunc('year', pp.birthdate)))::date
    end as next_birthday
  ) nb
  where pp.birthdate is not null
  order by nb.next_birthday;
end;
$$;
grant execute on function public.admin_birthdays() to authenticated;
