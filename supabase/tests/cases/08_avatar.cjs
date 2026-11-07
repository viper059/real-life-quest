// Avatar colours and wearing items.
module.exports = async (t) => {
  const U = await t.user('av_user', { gold: 2000 });
  const X = await t.user('av_other');
  await t.as(U);
  t.eq((await t.one(`select avatar from profiles where id = $1`, [U])).skin, '#f1c27d', 'default skin');
  await t.q(`select set_avatar('#8D5524', '#000000', '#B3261E', '#1F6F6B', '#FFFFFF')`);
  t.eq((await t.one(`select avatar from profiles where id = $1`, [U])).shirt, '#b3261e', 'colours saved lower-case');
  await t.throws(`select set_avatar('red', '#000000', '#b3261e', '#1f6f6b', '#ffffff')`, 'colours must be', 'colour format checked');
  await t.throws(`update profiles set avatar = '{}' where id = '${U}'`, 'permission denied', 'avatar only via function');
  await t.q(`select buy_item('cap_basic')`); await t.q(`select buy_item('helmet_safety')`);
  await t.q(`select equip_item('cap_basic', true)`); await t.q(`select equip_item('helmet_safety', true)`);
  t.eq(await t.one(`select string_agg(item_id, ',') from user_items where user_id = $1 and equipped`, [U]), 'helmet_safety', 'one hat at a time');
  await t.as(X);
  await t.throws(`select equip_item('helmet_safety', true)`, 'item not owned', 'cannot wear items you do not own');
  t.eq((await t.one(`select avatar from profiles where id = $1`, [U])).shirt, '#b3261e', 'others can see your avatar');
};
