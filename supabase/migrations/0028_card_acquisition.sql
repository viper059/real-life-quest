-- 0028: job cards are no longer handed out (except the starter card). Ways to get them:
--  1) random draw with Gold (odds shown, daily limit, pity), 2) buy a specific card with Gold, 3) existing real-work unlocks.
alter table public.job_cards drop constraint job_cards_rarity_check;
update public.job_cards set rarity = 'เลเจนด์' where rarity = 'รีเจน';
update public.job_cards set rarity = 'ดิไวน์' where rarity = 'ดีวาย';
alter table public.job_cards add constraint job_cards_rarity_check check (rarity in ('ธรรมดา','ไม่ธรรมดา','อีปิก','เลเจนด์','มิสติก','ซูเปอร์มิสติก','ดิไวน์','สวรรค์'));
alter table public.job_cards add column in_pack boolean not null default true;
update public.job_cards set in_pack = false where id = 'adventurer';

insert into public.job_cards (id, name, rarity, category, unlock_count, exp_bonus_pct, stats, description, sort) values
  ('grit_n', 'ผู้ขยันหมั่นเพียร', 'ธรรมดา', 'general', 9999, 3, '{}', 'ได้จากตู้สุ่มหรือร้านการ์ด', 20),
  ('grit_u', 'นักสู้ชีวิต', 'ไม่ธรรมดา', 'general', 9999, 8, '{"vit":1,"luk":1}', 'ได้จากตู้สุ่มหรือร้านการ์ด', 21),
  ('grit_e', 'ผู้มีวินัยเหล็ก', 'อีปิก', 'general', 9999, 15, '{"vit":3,"int":2}', 'ได้จากตู้สุ่มหรือร้านการ์ด', 22),
  ('grit_l', 'ตำนานแห่งเมือง', 'เลเจนด์', 'general', 9999, 25, '{"str":3,"vit":3,"int":3,"luk":3}', 'ได้จากตู้สุ่มหรือร้านการ์ด', 23)
on conflict (id) do nothing;

create table public.card_rarity_cfg (
  rarity text primary key, weight int not null check (weight >= 0), shop_price int not null check (shop_price > 0), sort int not null
);
insert into public.card_rarity_cfg values ('ธรรมดา', 55, 300, 1), ('ไม่ธรรมดา', 30, 800, 2), ('อีปิก', 12, 2500, 3), ('เลเจนด์', 3, 8000, 4);
alter table public.card_rarity_cfg enable row level security;
create policy card_cfg_read on public.card_rarity_cfg for select to authenticated using (true);

insert into public.app_settings (key, value) values
  ('card_pack_price', '150'), ('card_pack_daily_max', '3'), ('card_dupe_refund', '40'), ('card_pity_epic', '20')
on conflict (key) do nothing;

create table public.user_card_draws (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id text not null references public.job_cards(id),
  rarity text not null, day date not null, dupe boolean not null default false, drawn_at timestamptz not null default now()
);
create index user_card_draws_user on public.user_card_draws (user_id, id);
alter table public.user_card_draws enable row level security;
create policy card_draws_own on public.user_card_draws for select to authenticated using (user_id = auth.uid());

create function public.card_pack_info() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._assert_active();
begin
  return jsonb_build_object(
    'price', _setting_int('card_pack_price', 150), 'daily_max', _setting_int('card_pack_daily_max', 3),
    'refund', _setting_int('card_dupe_refund', 40), 'pity', _setting_int('card_pity_epic', 20),
    'drawn_today', (select count(*) from user_card_draws where user_id = v_uid and day = _bkk_day()),
    'since_epic', (select count(*) from user_card_draws where user_id = v_uid
                    and id > coalesce((select max(id) from user_card_draws where user_id = v_uid and rarity in ('อีปิก', 'เลเจนด์')), 0)),
    'odds', (select jsonb_agg(jsonb_build_object('rarity', rarity, 'weight', weight, 'shop_price', shop_price) order by sort) from card_rarity_cfg));
end $$;
grant execute on function public.card_pack_info() to authenticated;
revoke execute on function public.card_pack_info() from anon, public;

create function public.draw_card() returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._assert_active(); v_price int := _setting_int('card_pack_price', 150);
  v_refund int := _setting_int('card_dupe_refund', 40); v_since int; v_force boolean; v_total int; v_roll numeric;
  v_rarity text; v_card job_cards%rowtype; v_dupe boolean;
begin
  perform 1 from profiles where id = v_uid for update;
  if (select count(*) from user_card_draws where user_id = v_uid and day = _bkk_day()) >= _setting_int('card_pack_daily_max', 3) then raise exception 'draw limit'; end if;
  update wallets set gold = gold - v_price, updated_at = now() where user_id = v_uid and gold >= v_price;
  if not found then raise exception 'not enough gold'; end if;
  perform _ledger(v_uid, 'card_pack', -v_price, 0, null, null, 'สุ่มการ์ด');
  select count(*) into v_since from user_card_draws where user_id = v_uid
     and id > coalesce((select max(id) from user_card_draws where user_id = v_uid and rarity in ('อีปิก', 'เลเจนด์')), 0);
  v_force := v_since + 1 >= _setting_int('card_pity_epic', 20);
  select sum(weight) into v_total from card_rarity_cfg where not v_force or rarity in ('อีปิก', 'เลเจนด์');
  v_roll := random() * v_total;
  select rarity into v_rarity from (
    select rarity, sum(weight) over (order by sort) cum from card_rarity_cfg where not v_force or rarity in ('อีปิก', 'เลเจนด์')) t
   where cum > v_roll order by cum limit 1;
  select * into v_card from job_cards where in_pack and rarity = v_rarity order by random() limit 1;
  if not found then raise exception 'no card available'; end if;
  v_dupe := exists (select 1 from user_cards where user_id = v_uid and card_id = v_card.id);
  if v_dupe then
    update wallets set gold = gold + v_refund, updated_at = now() where user_id = v_uid;
    perform _ledger(v_uid, 'card_dupe', v_refund, 0, null, null, 'การ์ดซ้ำ ' || v_card.name);
  else
    insert into user_cards (user_id, card_id) values (v_uid, v_card.id);
  end if;
  insert into user_card_draws (user_id, card_id, rarity, day, dupe) values (v_uid, v_card.id, v_card.rarity, _bkk_day(), v_dupe);
  return jsonb_build_object('card', v_card.id, 'name', v_card.name, 'rarity', v_card.rarity, 'exp_bonus_pct', v_card.exp_bonus_pct,
                            'category', v_card.category, 'stats', v_card.stats, 'dupe', v_dupe, 'refund', case when v_dupe then v_refund else 0 end, 'paid', v_price);
end $$;
grant execute on function public.draw_card() to authenticated;
revoke execute on function public.draw_card() from anon, public;

create function public.buy_card(p_card text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); c job_cards%rowtype; v_price int;
begin
  perform 1 from profiles where id = v_uid for update;
  select * into c from job_cards where id = p_card and in_pack;
  if not found then raise exception 'card not for sale'; end if;
  if exists (select 1 from user_cards where user_id = v_uid and card_id = c.id) then raise exception 'already owned'; end if;
  select shop_price into v_price from card_rarity_cfg where rarity = c.rarity;
  if v_price is null then raise exception 'card not for sale'; end if;
  update wallets set gold = gold - v_price, updated_at = now() where user_id = v_uid and gold >= v_price;
  if not found then raise exception 'not enough gold'; end if;
  perform _ledger(v_uid, 'card_buy', -v_price, 0, null, null, c.name);
  insert into user_cards (user_id, card_id) values (v_uid, c.id);
  return jsonb_build_object('card', c.id, 'name', c.name, 'paid', v_price);
end $$;
grant execute on function public.buy_card(text) to authenticated;
revoke execute on function public.buy_card(text) from anon, public;
