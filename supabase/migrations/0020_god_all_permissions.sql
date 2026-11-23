-- GOD must hold every permission at 'full'. The back-office UI reads role_permissions to decide which pages to show,
-- so god (who passes has_perm() server-side) was seeing none of them. Grant all, and auto-grant any future permission.
insert into public.role_permissions (role_id, permission_id, level)
select 'god', id, 'full' from public.permissions
on conflict (role_id, permission_id) do update set level = 'full';

create or replace function public._grant_new_permission_to_god()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_permissions (role_id, permission_id, level) values ('god', new.id, 'full')
  on conflict (role_id, permission_id) do update set level = 'full';
  return new;
end $$;
revoke execute on function public._grant_new_permission_to_god() from public, anon, authenticated;

drop trigger if exists permissions_grant_god on public.permissions;
create trigger permissions_grant_god after insert on public.permissions
  for each row execute function public._grant_new_permission_to_god();
