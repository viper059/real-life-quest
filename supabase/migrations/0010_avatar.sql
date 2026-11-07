-- Real-life Quest — 3D avatar: free body colours plus wearable items shown on the model.
alter table public.profiles
  add column avatar jsonb not null default '{"skin":"#f1c27d","hair":"#2a1b11","shirt":"#1f6f6b","pants":"#3a2618","shoes":"#2a1b11"}'::jsonb;

create function public.set_avatar(p_skin text, p_hair text, p_shirt text, p_pants text, p_shoes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := public._assert_active();
begin
  if not (p_skin ~ '^#[0-9a-fA-F]{6}$' and p_hair ~ '^#[0-9a-fA-F]{6}$' and p_shirt ~ '^#[0-9a-fA-F]{6}$'
          and p_pants ~ '^#[0-9a-fA-F]{6}$' and p_shoes ~ '^#[0-9a-fA-F]{6}$') then
    raise exception 'colours must be #rrggbb';
  end if;
  update profiles set avatar = jsonb_build_object('skin', lower(p_skin), 'hair', lower(p_hair), 'shirt', lower(p_shirt),
                                                  'pants', lower(p_pants), 'shoes', lower(p_shoes)) where id = v_uid;
end $$;
revoke execute on function public.set_avatar(text, text, text, text, text) from public, anon;
grant execute on function public.set_avatar(text, text, text, text, text) to authenticated;

-- More wearables (all within the open tiers).
insert into public.shop_items (id, name, kind, slot, price, currency, stock, description, data, active, sort, tier) values
  ('cap_basic',     'หมวกแก๊ป',        'costume', 'head', 190, 'gold', null, 'ชุดแต่งตัว ช่องหมวก', '{"color":"#1f6f6b"}', true, 15, 'common'),
  ('helmet_safety', 'หมวกเซฟตี้',       'costume', 'head', 590, 'gold', null, 'หมวกนิรภัยสำหรับช่าง', '{"color":"#e8b13a"}', true, 16, 'uncommon'),
  ('apron_work',    'ผ้ากันเปื้อนช่าง',  'costume', 'body', 390, 'gold', null, 'ชุดแต่งตัว ช่องเสื้อ', '{"color":"#6b4a2a"}', true, 17, 'common'),
  ('glasses_round', 'แว่นกลมนักปราชญ์', 'costume', 'acc',  490, 'gold', null, 'ของประดับ ช่องเครื่องประดับ', '{"color":"#2a1b11"}', true, 18, 'uncommon');
