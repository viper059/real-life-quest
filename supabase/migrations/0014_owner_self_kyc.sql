-- Allow the sole 'owner' staff role to approve/reject their own KYC request.
-- Rationale: a solo-operator account has no second admin to review it, and
-- the owner role already holds full authority over bans/roles/economy, so
-- self-approving identity verification adds no new trust the owner doesn't
-- already have. Non-owner staff (admin/mod/finance/support) still cannot
-- review their own request.
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
  select exists(select 1 from staff_members where user_id = auth.uid() and role_id = 'owner') into v_is_owner;
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
