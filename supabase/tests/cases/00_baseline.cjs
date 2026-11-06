// Sanity check that the baseline (what is live on project RLS today) behaves as before.
module.exports = async (t) => {
  const a = await t.user('base_poster', { gold: 1000 });
  await t.as(a);
  const card = await t.one(`select card_id from user_cards where user_id = $1`, [a]);
  t.eq(card, 'adventurer', 'starter card granted');
  await t.throws(`update wallets set gold = 999999`, 'permission denied', 'client cannot write wallets');
  await t.as(null);
};
