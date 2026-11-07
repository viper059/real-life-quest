// One-way exchange of partner-app credit into Gold: link codes, idempotency, caps, permissions.
module.exports = async (t) => {
  const U = await t.user('ex_user'); const V = await t.user('ex_other'); const owner = await t.user('ex_owner', { staff: 'owner' });
  await t.as(U);
  await t.throws(`select create_link_code('feedth')`, 'partner not open', 'closed partner cannot link');
  await t.admin();
  t.eq(Number(await t.one(`select gold_per_unit from exchange_partners where id = 'songduan'`)), 5, 'ส่งด่วน 1 baht = 5 G');
  t.eq(Number(await t.one(`select gold_per_unit from exchange_partners where id = 'feedth'`)), 5, 'ปักหมุด 1 credit = 5 G');
  await t.as(owner);
  await t.throws(`select set_exchange_partner('feedth', null, 500, true)`, 'set a rate', 'needs a rate to open');
  await t.q(`select set_exchange_partner('feedth', 0.5, 500, true)`);
  await t.as(U);
  await t.throws(`select set_exchange_partner('feedth', 100, 99999, true)`, 'forbidden', 'players cannot set rates');
  const code = await t.one(`select create_link_code('feedth')`);
  t.ok(/^[0-9A-F]{8}$/.test(code), 'eight-character code');
  await t.throws(`select code_hash from exchange_links`, 'permission denied', 'code hash hidden');
  t.eq(await t.one(`select count(*) from exchange_links where code_expires > now()`), 1, 'own link row visible without the hash');
  await t.throws(`select svc_exchange_in('feedth', 'ref-1', 'fb-1', 100)`, 'permission denied', 'players cannot call partner functions');

  await t.admin();
  await t.throws(`select svc_link_account('feedth', 'WRONG123', 'fb-1')`, 'code invalid', 'wrong code refused');
  const l = await t.one(`select svc_link_account('feedth', $1, 'fb-1')`, [code.toLowerCase()]);
  t.eq(l.username, 'ex_user', 'link returns the RLQ username');
  await t.throws(`select svc_link_account('feedth', '${code}', 'fb-2')`, 'code invalid', 'code is single-use');

  let r = await t.one(`select svc_exchange_in('feedth', 'ref-1', 'fb-1', 300)`);
  t.eq(Number(r.gold), 150, '300 credits × 0.5 = 150 G');
  r = await t.one(`select svc_exchange_in('feedth', 'ref-1', 'fb-1', 300)`);
  t.eq(r.duplicate, true, 'same reference does not pay twice');
  t.eq(await t.one(`select gold from wallets where user_id = $1`, [U]), 150, 'credited once');
  await t.throws(`select svc_exchange_in('feedth', 'ref-2', 'fb-9', 10)`, 'not linked', 'unknown partner user refused');
  await t.throws(`select svc_exchange_in('feedth', 'ref-3', 'fb-1', 800)`, 'daily exchange cap', 'daily cap 500 G');
  await t.throws(`select svc_exchange_in('songduan', 'ref-4', 'fb-1', 10)`, 'partner not open', 'closed partner refused');
  t.eq(await t.one(`select count(*) from transactions where user_id = $1 and kind = 'exchange_in'`, [U]), 1, 'ledger entry');

  // moving a partner account to another RLQ account
  await t.as(V); const c2 = await t.one(`select create_link_code('feedth')`);
  await t.admin(); await t.q(`select svc_link_account('feedth', $1, 'fb-1')`, [c2]);
  t.eq(await t.one(`select count(*) from exchange_links where partner_user = 'fb-1'`), 1, 'one RLQ account per partner account');
  await t.q(`select svc_exchange_in('feedth', 'ref-5', 'fb-1', 20)`);
  t.eq(await t.one(`select gold from wallets where user_id = $1`, [V]), 10, 'now credits the new owner');
  await t.as(U);
  t.eq(await t.one(`select count(*) from exchange_in`), 1, 'players see only their own exchanges');
};
