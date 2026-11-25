-- 0025: keep Gold from inflating.
-- Faucet: habits pay 50% of the EXP earned (min 1 G) and at most 30 G/day (settings habit_gold_pct, habit_gold_cap).
-- Sinks: food shop (+ shop items). Pantry capped at 10 per dish so Gold is spent, not hoarded as stock.
-- Monitoring: admin_gold_flow() shows Gold issued vs spent per day.
insert into public.app_settings (key, value) values ('habit_gold_pct', '50') on conflict (key) do nothing;
update public.app_settings set value = '30' where key = 'habit_gold_cap';

create or replace function public._habit_gold(p_user uuid, p_exp integer, p_title text) returns integer language plpgsql security definer set search_path = public as $$
declare v_amt int; v_room int;
begin
  if p_exp is null or p_exp <= 0 then return 0; end if;
  v_amt := greatest(1, round(p_exp * _setting_int('habit_gold_pct', 50) / 100.0 * (1 + _buff_pct(p_user, 'gold') / 100.0))::int);
  v_room := greatest(0, _setting_int('habit_gold_cap', 30) - _habit_gold_today(p_user));
  v_amt := least(v_amt, v_room);
  if v_amt <= 0 then return 0; end if;
  update wallets set gold = gold + v_amt, updated_at = now() where user_id = p_user;
  if not found then insert into wallets (user_id, gold) values (p_user, v_amt); end if;
  perform _ledger(p_user, 'habit_gold', v_amt, 0, null, null, p_title);
  return v_amt;
end $$;
revoke execute on function public._habit_gold(uuid, integer, text) from public, anon, authenticated;

create or replace function public.buy_food(p_food text, p_qty integer default 1) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._assert_active(); f food_items%rowtype; v_total int; v_have int;
begin
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'bad quantity'; end if;
  select * into f from food_items where id = p_food and active;
  if not found then raise exception 'food not available'; end if;
  select coalesce(qty, 0) into v_have from user_food where user_id = v_uid and food_id = f.id;
  if coalesce(v_have, 0) + p_qty > 10 then raise exception 'pantry full'; end if;
  v_total := f.price * p_qty;
  update wallets set gold = gold - v_total, updated_at = now() where user_id = v_uid and gold >= v_total;
  if not found then raise exception 'not enough gold'; end if;
  perform _ledger(v_uid, 'food_buy', -v_total, 0, null, null, f.name || ' x' || p_qty);
  insert into user_food (user_id, food_id, qty) values (v_uid, f.id, p_qty)
    on conflict (user_id, food_id) do update set qty = user_food.qty + p_qty;
  select qty into v_have from user_food where user_id = v_uid and food_id = f.id;
  return jsonb_build_object('food', f.id, 'qty', v_have, 'paid', v_total);
end $$;
grant execute on function public.buy_food(text, integer) to authenticated;

-- Gold issued by habits vs Gold spent on food/shop, per Bangkok day
create function public.admin_gold_flow(p_days integer default 14) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('m.topup') then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'gold_in_wallets', (select coalesce(sum(gold), 0) from wallets),
    'days', coalesce((select jsonb_agg(x order by x->>'day' desc) from (
      select jsonb_build_object('day', d::text,
        'habit_in',  coalesce((select sum(gold_delta) from transactions t where t.kind = 'habit_gold' and (t.created_at at time zone 'Asia/Bangkok')::date = d), 0),
        'food_out',  coalesce((select -sum(gold_delta) from transactions t where t.kind = 'food_buy' and (t.created_at at time zone 'Asia/Bangkok')::date = d), 0),
        'shop_out',  coalesce((select -sum(gold_delta) from transactions t where t.kind = 'shop_buy' and (t.created_at at time zone 'Asia/Bangkok')::date = d), 0)) x
      from generate_series(_bkk_day() - (greatest(1, least(p_days, 60)) - 1), _bkk_day(), interval '1 day') d) s), '[]'::jsonb));
end $$;
grant execute on function public.admin_gold_flow(integer) to authenticated;
revoke execute on function public.admin_gold_flow(integer) from anon, public;
