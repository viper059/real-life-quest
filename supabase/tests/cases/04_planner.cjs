// Daily, personal and monthly quests, the daily chest, streaks, family verification, life-level slots.
module.exports = async (t) => {
  const owner = await t.user('pl_owner', { staff: 'owner', kyc: true });
  const U = await t.user('pl_user');

  await t.as(U);
  let day = await t.one(`select my_planner_day()`);
  t.eq(day.level, 1, 'starts at life level 1');
  t.eq(day.dailies.length, 3, 'level 1 has 3 daily slots');
  t.eq(day.tier.personal_slots, 3, 'level 1 has 3 personal slots');
  await t.q(`select claim_daily('d_login')`);
  await t.throws(`select claim_daily('d_login')`, 'duplicate', 'claim once a day');
  await t.throws(`select claim_daily('d_quest')`, 'not done yet', 'cannot claim unfinished work quest');
  await t.throws(`select claim_daily('d_guild')`, 'not in your slots', 'higher-level dailies are locked');

  const p1 = await t.one(`select create_personal_quest('ดื่มน้ำ', 'health', 'daily', 8, 'แก้ว', 1, false)`);
  const p2 = await t.one(`select create_personal_quest('เดิน 5,000 ก้าว', 'health', 'daily', 1, null, 2, false)`);
  const p3 = await t.one(`select create_personal_quest('ออมเงิน', 'money', 'weekly', 1, null, 1, false)`);
  await t.throws(`select create_personal_quest('เพิ่ม', 'other', 'daily', 1, null, 1, false)`, 'no free personal slots', 'slots limited by level');
  await t.throws(`select create_personal_quest('ให้ที่บ้านยืนยัน', 'other', 'daily', 1, null, 1, true)`, 'no free personal slots', 'still out of slots');

  let r = await t.one(`select log_personal($1, 5)`, [p1]);
  t.eq(r.progress, 5, 'counter progresses'); t.eq(r.done, false, 'not done at 5/8');
  r = await t.one(`select log_personal($1, 10)`, [p1]);
  t.eq(r.progress, 8, 'capped at target'); t.eq(r.exp, 10, 'easy daily quest gives 10 EXP');
  await t.as(owner); await t.q(`select set_setting('personal_exp_cap', '20')`);
  await t.as(U);
  r = await t.one(`select log_personal($1, 1)`, [p2]);
  t.eq(r.exp, 10, 'daily personal EXP capped (15 asked, 10 left under a cap of 20)');
  await t.q(`select claim_daily('d_personal')`);

  day = await t.one(`select my_planner_day()`);
  t.eq(day.chest_ready, false, 'chest locked until every daily is claimed');
  await t.admin();
  await t.q(`insert into quests (poster_id, worker_id, title, category, rank, reward_gold, status, completed_at) values ($1, $2, 'งานทดสอบ', 'general', 'F', 1, 'completed', now())`, [owner, U]);
  await t.as(U);
  await t.q(`select claim_daily('d_quest')`);
  day = await t.one(`select my_planner_day()`);
  t.eq(day.chest_ready, true, 'chest ready once dailies claimed and daily personal quests done (weekly ones do not block)');
  const ch = await t.one(`select claim_daily_chest()`);
  t.eq(ch.streak, 1, 'first chest starts a streak'); t.eq(ch.exp, 150, 'chest 150 EXP');
  await t.throws(`select claim_daily_chest()`, 'already opened today', 'one chest a day');

  await t.admin();
  await t.q(`delete from daily_chests where user_id = $1`, [U]);
  await t.q(`update profiles set last_chest_day = (now() at time zone 'Asia/Bangkok')::date - 1, streak_days = 5 where id = $1`, [U]);
  await t.as(U);
  const ch2 = await t.one(`select claim_daily_chest()`);
  t.eq(ch2.streak, 6, 'streak continues from yesterday'); t.eq(ch2.exp, 188, 'streak bonus +25% at day 6');
  t.eq(await t.one(`select base_level from profiles where id = $1`, [U]), 2, 'life level from EXP on the slow curve');

  // family verification doubles EXP
  const parent = await t.user('pl_parent');
  const kid = await t.user('pl_kid');
  await t.as(parent); await t.q(`select create_family('บ้านแผน')`);
  const code = await t.one(`select join_code from families where id = my_family()`);
  await t.as(kid); await t.q(`select join_family($1, 'child')`, [code]);
  const fq = await t.one(`select create_personal_quest('ทำการบ้าน', 'study', 'daily', 1, null, 1, true)`);
  r = await t.one(`select log_personal($1, 1)`, [fq]);
  t.eq(r.verify_status, 'pending', 'family-verified quest waits for a parent'); t.eq(r.exp, 0, 'no EXP until verified');
  await t.as(parent);
  const pend = await t.one(`select family_pending_verifications()`);
  t.eq(pend.length, 1, 'parent sees the pending check');
  t.eq(await t.one(`select verify_personal($1, $2)`, [fq, pend[0].period]), 20, 'verified EXP doubled');
  await t.as(kid);
  await t.throws(`select verify_personal('${fq}', '${pend[0].period}')`, 'cannot verify', 'cannot verify your own');

  // monthly
  await t.as(U);
  let mo = await t.one(`select my_planner_month()`);
  t.eq(mo.templates.length, 1, 'level 2 has 1 monthly slot');
  t.ok(mo.days.length >= 28, 'calendar covers the month');
  await t.throws(`select claim_monthly('m_chest')`, 'not done yet', 'monthly needs 20 chest days');
  await t.admin();
  await t.q(`insert into daily_chests (user_id, day, exp, streak)
             select $1, d::date, 150, 1 from generate_series(date_trunc('month', (now() at time zone 'Asia/Bangkok'))::date,
               date_trunc('month', (now() at time zone 'Asia/Bangkok'))::date + 19, interval '1 day') d
             on conflict do nothing`, [U]);
  await t.as(U);
  await t.q(`select claim_monthly('m_chest')`);
  t.eq(await t.one(`select claim_monthly_track(1)`), '+300 EXP', 'track step 1');
  await t.throws(`select claim_monthly_track(2)`, 'not done yet', 'step 2 needs two monthly quests');
  mo = await t.one(`select my_planner_month()`);
  t.eq(mo.claimed, 1, 'monthly claim recorded');
};
