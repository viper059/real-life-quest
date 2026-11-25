-- สุ่มการ์ดด้วย Crystal เท่านั้น (Crystal ได้จากการเติมเงินเท่านั้น และยังไม่เปิดเติม จึงมีแต่แอดมินที่สุ่มได้)
-- ซื้อตรงยังใช้ Gold ตามเดิม · การ์ดซ้ำคืนเป็น Crystal (ไม่คืนเป็น Gold กันแปลง Crystal -> Gold)
update public.app_settings set value = '30' where key = 'card_pack_price';
update public.app_settings set value = '5' where key = 'card_dupe_refund';

create or replace function public.draw_card() returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._assert_active(); v_price int := _setting_int('card_pack_price', 30);
  v_refund int := _setting_int('card_dupe_refund', 5); v_since int; v_force boolean; v_total int; v_roll numeric;
  v_rarity text; v_card job_cards%rowtype; v_dupe boolean;
begin
  perform 1 from profiles where id = v_uid for update;
  if (select count(*) from user_card_draws where user_id = v_uid and day = _bkk_day()) >= _setting_int('card_pack_daily_max', 3) then raise exception 'draw limit'; end if;
  update wallets set crystal = crystal - v_price, updated_at = now() where user_id = v_uid and crystal >= v_price;
  if not found then raise exception 'not enough crystal'; end if;
  perform _ledger_c(v_uid, 'card_pack', -v_price, 'สุ่มการ์ด');
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
    update wallets set crystal = crystal + v_refund, updated_at = now() where user_id = v_uid;
    perform _ledger_c(v_uid, 'card_dupe', v_refund, 'การ์ดซ้ำ ' || v_card.name);
  else
    insert into user_cards (user_id, card_id) values (v_uid, v_card.id);
  end if;
  insert into user_card_draws (user_id, card_id, rarity, day, dupe) values (v_uid, v_card.id, v_card.rarity, _bkk_day(), v_dupe);
  return jsonb_build_object('card', v_card.id, 'name', v_card.name, 'rarity', v_card.rarity, 'exp_bonus_pct', v_card.exp_bonus_pct,
                            'category', v_card.category, 'stats', v_card.stats, 'dupe', v_dupe, 'refund', case when v_dupe then v_refund else 0 end, 'paid', v_price);
end $$;

create or replace function public.card_pack_info() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._assert_active();
begin
  return jsonb_build_object(
    'price', _setting_int('card_pack_price', 30), 'daily_max', _setting_int('card_pack_daily_max', 3),
    'refund', _setting_int('card_dupe_refund', 5), 'pity', _setting_int('card_pity_epic', 20),
    'drawn_today', (select count(*) from user_card_draws where user_id = v_uid and day = _bkk_day()),
    'since_epic', (select count(*) from user_card_draws where user_id = v_uid
                    and id > coalesce((select max(id) from user_card_draws where user_id = v_uid and rarity in ('อีปิก', 'เลเจนด์')), 0)),
    'odds', (select jsonb_agg(jsonb_build_object('rarity', rarity, 'weight', weight, 'shop_price', shop_price) order by sort) from card_rarity_cfg));
end $$;
