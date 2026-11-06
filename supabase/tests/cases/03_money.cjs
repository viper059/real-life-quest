// Buying Gold/Crystal via PromptPay orders, Crystal gifting, the shop, settings validation, KYC-gated withdrawals.
module.exports = async (t) => {
  const owner = await t.user('mn_owner', { staff: 'owner', kyc: true });
  const fin = await t.user('mn_finance', { staff: 'finance', kyc: true });
  const A = await t.user('mn_alice', { crystal: 100 });
  const B = await t.user('mn_bob');

  await t.as(A);
  await t.throws(`select create_topup('gold', 500)`, 'top-up not open yet', 'no rate set yet');
  await t.as(owner);
  await t.throws(`select set_setting('promptpay_id', '12345')`, 'promptpay must be', 'promptpay format checked');
  await t.throws(`select set_setting('gold_thb_rate', 'abc')`, 'bad rate', 'rate format checked');
  await t.q(`select set_setting('promptpay_id', '0812345678')`);
  await t.q(`select set_setting('promptpay_name', 'ธนฤกษ์ โคตรประทุม')`);
  await t.q(`select set_setting('gold_thb_rate', '1')`);
  await t.q(`select set_setting('crystal_thb_rate', '1')`);

  await t.as(A);
  const o = await t.one(`select create_topup('gold', 500)`);
  t.eq(o.amount_thb, 500, 'price computed from the rate');
  t.eq(o.promptpay_id, '0812345678', 'order carries the PromptPay id');
  await t.throws(`select notify_topup_paid('${o.id}', 'someone/slip.jpg')`, 'slip required', 'slip must be in own folder');
  await t.q(`select notify_topup_paid($1, $2)`, [o.id, `${A}/slip.jpg`]);
  await t.as(B);
  t.eq(await t.one(`select count(*) from topup_orders`), 0, 'others cannot see orders');
  await t.throws(`select decide_topup('${o.id}', true, null)`, 'forbidden', 'only finance can confirm');
  await t.as(fin);
  await t.q(`select decide_topup($1, true, 'ยอดเข้าแล้ว')`, [o.id]);
  await t.as(A);
  t.eq(await t.one(`select gold from wallets where user_id = $1`, [A]), 500, 'gold credited after confirmation');
  const o2 = await t.one(`select create_topup('crystal', 50)`);
  await t.as(fin); await t.q(`select decide_topup($1, false, 'ไม่พบยอด')`, [o2.id]);
  await t.as(A);
  t.eq(await t.one(`select crystal from wallets where user_id = $1`, [A]), 100, 'rejected order adds nothing');

  // crystal gifting
  await t.q(`select transfer_crystal('mn_bob', 30, 'ค่าขนม')`);
  await t.admin();
  t.eq(await t.one(`select crystal from wallets where user_id = $1`, [A]), 70, 'sender debited');
  t.eq(await t.one(`select crystal from wallets where user_id = $1`, [B]), 30, 'receiver credited');
  await t.as(A);
  await t.throws(`select transfer_crystal('mn_alice', 1, null)`, 'cannot send to yourself', 'no self transfer');
  await t.throws(`select transfer_crystal('mn_bob', 6000, null)`, 'daily transfer limit', 'daily limit');
  await t.as(owner); await t.q(`select set_setting('crystal_daily_transfer_max', '50')`);
  await t.as(A); await t.throws(`select transfer_crystal('mn_bob', 30, null)`, 'daily transfer limit', 'lowered limit applies to the day total');

  // shop
  await t.q(`select buy_item('hat_straw')`);
  t.eq(await t.one(`select crystal from wallets where user_id = $1`, [A]), 31, 'item price deducted');
  await t.throws(`select buy_item('hat_straw')`, 'already owned', 'no double buy');
  await t.throws(`select buy_item('title_monthly_hero')`, 'item not available', 'reward-only items are not for sale');
  await t.q(`select buy_item('title_hardworker')`);
  await t.q(`select equip_item('title_hardworker', true)`);
  t.eq(await t.one(`select title from profiles where id = $1`, [A]), 'ขยันไม่มีวันหยุด', 'title equipped');
  await t.throws(`select buy_item('boost_personal_slots')`, 'not enough crystal', 'cannot overspend');
  await t.admin(); await t.q(`update wallets set crystal = 100 where user_id = $1`, [A]);
  await t.as(A); await t.q(`select buy_item('boost_personal_slots')`);
  t.eq(await t.one(`select extra_personal_slots from profiles where id = $1`, [A]), 2, 'boost adds personal slots');

  // withdrawals need identity; crystal can never be withdrawn
  await t.throws(`select request_withdrawal(200, 'กสิกร •••• 1234')`, 'identity not verified', 'withdraw needs KYC');
  await t.admin(); await t.q(`update profiles set kyc_status = 'verified' where id = $1`, [A]);
  await t.as(A);
  await t.q(`select request_withdrawal(200, 'กสิกร •••• 1234')`);
  t.eq(await t.one(`select gold_locked from wallets where user_id = $1`, [A]), 200, 'withdrawal held');
};
