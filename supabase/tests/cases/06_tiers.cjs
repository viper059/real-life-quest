// Rarity tiers for items: eight defined, only Common–Epic open; job cards untouched.
module.exports = async (t) => {
  const U = await t.user('tier_user', { kyc: true, crystal: 2000, gold: 5000 });
  const shop = await t.user('tier_shop', { staff: 'owner', kyc: true });

  await t.admin();
  t.eq(await t.one(`select string_agg(label, ',' order by ord) from rarity_tiers`), 'ธรรมดา,ไม่ธรรมดา,อีปิก,รีเจน,มิสติก,ซูเปอร์มิสติก,ดีวาย,สวรรค์', 'eight tiers in order');
  t.eq(await t.one(`select string_agg(id, ',' order by ord) from rarity_tiers where obtainable`), 'common,uncommon,epic', 'only up to epic is open');
  t.eq(await t.one(`select count(*) from shop_items s join rarity_tiers r on r.id = s.tier where not r.obtainable`), 0, 'no item above epic');
  t.eq(await t.one(`select count(*) from information_schema.columns where table_name = 'job_cards' and column_name = 'tier'`), 0, 'job cards have no tier');

  await t.as(U);
  await t.q(`select buy_item('frame_epic')`);
  t.eq(await t.one(`select count(*) from user_items where user_id = $1 and item_id = 'frame_epic'`, [U]), 1, 'epic item can be bought');
  await t.throws(`update rarity_tiers set obtainable = true`, 'permission denied', 'users cannot open tiers');
  await t.throws(`select set_shop_item_tier('frame_jade', 'epic')`, 'forbidden', 'users cannot change item tiers');

  await t.as(shop);
  await t.throws(`select set_shop_item_tier('frame_jade', 'legend')`, 'tier not open yet', 'cannot sell a legend item');
  await t.q(`select save_shop_item('frame_jade', 'กรอบหยก', 'frame', null, 99, 'gold', null, null, false)`);
  await t.q(`select set_shop_item_tier('frame_jade', 'legend')`);
  t.eq(await t.one(`select tier from shop_items where id = 'frame_jade'`), 'legend', 'staff can draft an inactive legend item');
  await t.throws(`select save_shop_item('frame_jade', 'กรอบหยก', 'frame', null, 99, 'gold', null, null, true)`, 'tier not open yet', 'draft cannot go on sale');
  await t.admin();
  await t.throws(`select _give_item('${U}', 'frame_jade')`, 'tier not open yet', 'closed tiers cannot be given as rewards');
  t.eq(await t.one(`select _give_item($1, 'boost_personal_slots')`, [U]), true, 'boost still grants');
  t.eq(await t.one(`select extra_personal_slots from profiles where id = $1`, [U]), 2, 'boost still adds slots');
};
