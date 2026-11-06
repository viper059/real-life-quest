// Eight rarity tiers: mapping, rank-gated mythic+ cards, earned-only Divine/Heaven items, shop guard.
module.exports = async (t) => {
  const W = await t.user('tier_worker', { kyc: true, career: { delivery: 'B' } });
  const shopAdmin = await t.user('tier_shop', { staff: 'owner', kyc: true });

  await t.admin();
  t.eq(await t.one(`select count(*) from rarity_tiers`), 8, 'eight tiers');
  t.eq(await t.one(`select string_agg(label, ',' order by ord) from rarity_tiers`), 'ธรรมดา,ไม่ธรรมดา,อีปิก,รีเจน,มิสติก,ซูเปอร์มิสติก,ดีวาย,สวรรค์', 'tier names in order');
  t.eq(await t.one(`select tier from job_cards where id = 'adventurer'`), 'common', 'N maps to common');
  t.eq(await t.one(`select tier from job_cards where id = 'master_smith'`), 'legend', 'SSR maps to legend');
  t.eq(await t.one(`select count(distinct tier) from job_cards`), 8, 'cards exist in every tier');

  // 300 delivery jobs at rank B: mythic + super mythic need 300/800 → only mythic
  await t.q(`select _unlock_cards($1, 'delivery', 300)`, [W]);
  t.eq(await t.one(`select count(*) from user_cards where user_id = $1 and card_id = 'delivery_mythic'`, [W]), 1, 'mythic unlocked at rank C+ with 300 jobs');
  t.eq(await t.one(`select count(*) from user_cards where user_id = $1 and card_id = 'delivery_super'`, [W]), 0, 'super mythic needs 800 jobs');
  await t.q(`select _unlock_cards($1, 'delivery', 3000)`, [W]);
  t.eq(await t.one(`select count(*) from user_cards where user_id = $1 and card_id = 'delivery_super'`, [W]), 1, 'super mythic at rank B with 800+ jobs');
  t.eq(await t.one(`select count(*) from user_cards where user_id = $1 and card_id in ('delivery_divine','delivery_heaven')`, [W]), 0, 'divine/heaven blocked by rank even with 3000 jobs');

  // promotion to A grants divine items; S grants heaven
  await t.q(`update user_careers set rank = 'A' where user_id = $1 and occupation_id = 'delivery'`, [W]);
  t.eq(await t.one(`select count(*) from user_items where user_id = $1 and item_id in ('frame_divine','title_divine')`, [W]), 2, 'rank A grants divine frame and title');
  t.eq(await t.one(`select count(*) from notifications where user_id = $1 and kind = 'career'`, [W]), 1, 'notified of divine reward');
  await t.q(`update user_careers set rank = 'S' where user_id = $1 and occupation_id = 'delivery'`, [W]);
  t.eq(await t.one(`select count(*) from user_items where user_id = $1 and item_id in ('frame_heaven','title_heaven')`, [W]), 2, 'rank S grants heaven items');
  t.eq(await t.one(`select count(*) from user_items where user_id = $1 and item_id = 'frame_divine'`, [W]), 1, 'no duplicate items');

  // import straight to a high rank also fires
  const I = await t.user('tier_import', { kyc: true, career: { home: 'A' } });
  await t.admin();
  t.eq(await t.one(`select count(*) from user_items where user_id = $1 and item_id = 'frame_divine'`, [I]), 1, 'career inserted at A grants divine');

  // shop
  await t.as(W);
  await t.throws(`select buy_item('frame_heaven')`, 'item not available', 'heaven items cannot be bought');
  await t.throws(`select set_shop_item_tier('frame_jade', 'epic')`, 'forbidden', 'users cannot change tiers');
  await t.as(shopAdmin);
  await t.throws(`select save_shop_item('frame_divine', 'กรอบดีวาย', 'frame', null, 10, null, true)`, 'cannot be sold', 'divine items cannot be put on sale');
  await t.q(`select set_shop_item_tier('frame_jade', 'epic')`);
  t.eq(await t.one(`select tier from shop_items where id = 'frame_jade'`), 'epic', 'shop staff can retier');
  await t.as(W);
  t.ok(await t.one(`select count(*) from rarity_tiers`) === 8, 'users can read tiers');
  t.eq(await t.one(`select count(*) from shop_items where id in ('frame_heaven','title_monthly_hero')`), 1, 'earned items visible; retired unowned items hidden');
  await t.throws(`update rarity_tiers set label = 'x'`, 'permission denied', 'users cannot edit tiers');
};
