// Career-matched applications, location privacy, check-in hours, settlement, fees, reviews, disputes, chat, maintenance.
module.exports = async (t) => {
  const owner = await t.user('qf_owner', { staff: 'owner', kyc: true });
  const mod = await t.user('qf_mod', { staff: 'mod', kyc: true });
  const P = await t.user('qf_poster', { kyc: true, gold: 20000 });
  const W = await t.user('qf_worker', { kyc: true, career: { home: 'E' } });
  const W2 = await t.user('qf_newbie', { kyc: true });
  const U = await t.user('qf_unverified');
  const X = await t.user('qf_outsider', { kyc: true });
  const post = (args) => `select post_quest_v2('ล้างแอร์ 2 เครื่อง', 'ชั้นบน', ${args})`;

  await t.as(U);
  await t.throws(post(`'home', 'E', 500, 120, null, null, false, false, 13.75, 100.5, 'บ้านเลขที่ 1'`), 'identity not verified', 'unverified cannot post');

  await t.as(P);
  await t.throws(post(`'home', 'E', 500, 120, null, null, false, false, null, null, null`), 'location required', 'on-site quests need a pin');
  const q1 = await t.one(post(`'home', 'E', 500, 120, null, null, false, false, 13.75, 100.5, 'บ้านเลขที่ 1'`));
  t.eq(await t.one(`select approx_lat from quests where id = $1`, [q1]), '13.75', 'board shows rounded location');

  await t.as(U); await t.throws(`select apply_quest('${q1}', null)`, 'identity not verified', 'unverified cannot apply');
  await t.as(W2); await t.throws(`select apply_quest('${q1}', null)`, 'career rank too low', 'needs the trade and rank');
  await t.as(W);
  t.eq(await t.one(`select apply_quest('${q1}', 'ว่างพรุ่งนี้เช้า')`), 'applied', 'qualified worker applies');
  t.eq(await t.one(`select count(*) from quest_locations where quest_id = $1`, [q1]), 0, 'applicant cannot see exact address yet');
  await t.as(P);
  t.eq(await t.one(`select applicant_count from quests where id = $1`, [q1]), 1, 'applicant counted');
  await t.throws(`select choose_worker('${q1}', '${W2}')`, 'not an applicant', 'can only choose applicants');
  await t.q(`select choose_worker($1, $2)`, [q1, W]);
  await t.as(W);
  t.eq(await t.one(`select count(*) from quest_locations where quest_id = $1`, [q1]), 1, 'assigned worker sees the address');

  // chat
  await t.as(P); await t.q(`select send_message($1, 'ประตูหลังบ้านนะครับ')`, [q1]);
  await t.as(W); await t.q(`select send_message($1, 'รับทราบครับ')`, [q1]);
  t.eq(await t.one(`select count(*) from messages where quest_id = $1`, [q1]), 2, 'both sides read the chat');
  await t.as(X);
  await t.throws(`select send_message('${q1}', 'สวัสดี')`, 'not part of this quest', 'outsiders cannot chat');
  t.eq(await t.one(`select count(*) from messages where quest_id = $1`, [q1]), 0, 'outsiders cannot read the chat');

  // check-in hours
  await t.as(W);
  await t.throws(`select submit_quest('${q1}')`, 'check in first', 'cannot submit without working hours');
  await t.throws(`select check_in('${q1}', 14.0, 100.5, null)`, 'too far from the job site', 'check-in must be on site');
  await t.q(`select check_in($1, 13.7505, 100.5, null)`, [q1]);
  await t.throws(`select check_in('${q1}', 13.7505, 100.5, null)`, 'already checked in', 'one open session at a time');
  await t.throws(`select submit_quest('${q1}')`, 'check out first', 'must check out before submitting');
  await t.admin(); await t.q(`update work_sessions set started_at = now() - interval '150 minutes' where quest_id = $1`, [q1]);
  await t.as(W);
  t.eq(await t.one(`select check_out($1, 13.7505, 100.5, null)`, [q1]), 150, 'session minutes recorded');
  await t.q(`select submit_quest($1)`, [q1]);
  t.ok(await t.one(`select auto_release_at > now() + interval '71 hours' from quests where id = $1`, [q1]), 'auto release scheduled 72 h out');

  await t.as(P);
  await t.q(`select confirm_quest($1)`, [q1]);
  await t.admin();
  t.eq(await t.one(`select gold from wallets where user_id = $1`, [W]), 500, 'worker paid in full (fee 0%)');
  t.eq(await t.one(`select gold_locked from wallets where user_id = $1`, [P]), 0, 'escrow released');
  const c = (await t.q(`select jobs, minutes from user_careers where user_id = $1 and occupation_id = 'home'`, [W]))[0];
  t.eq(c.jobs, 1, 'career job counted'); t.eq(c.minutes, 150, 'career minutes counted');
  t.eq(await t.one(`select base_exp from profiles where id = $1`, [W]), 63, 'life EXP = est/2 with +5% starter card');

  // reviews
  await t.as(P); await t.q(`select submit_review($1, 5, 'สะอาดมาก')`, [q1]);
  await t.throws(`select submit_review('${q1}', 4, null)`, 'duplicate', 'one review per side');
  await t.as(W); await t.q(`select submit_review($1, 4, null)`, [q1]);
  await t.admin();
  t.eq(await t.one(`select rating_count from user_careers where user_id = $1 and occupation_id = 'home'`, [W]), 1, 'career rating updated');
  t.eq(await t.one(`select poster_rating_sum from profiles where id = $1`, [P]), 4, 'poster rating updated');

  // platform fee
  await t.as(owner); await t.q(`select set_setting('platform_fee_pct', '10')`);
  await t.throws(`select set_setting('platform_fee_pct', '50')`, 'fee must be', 'fee capped at 30%');
  await t.as(P);
  const q2 = await t.one(post(`'home', 'E', 1000, 60, null, null, true, false, 13.75, 100.5, null`));
  await t.as(W);
  t.eq(await t.one(`select apply_quest($1, null)`, [q2]), 'assigned', 'instant quest assigns on apply');
  await t.q(`select check_in($1, 13.75, 100.5, null)`, [q2]); await t.q(`select check_out($1, 13.75, 100.5, null)`, [q2]);
  await t.q(`select submit_quest($1)`, [q2]);

  // dispute: poster disputes, mod gives 60% to the worker
  await t.as(P);
  const d = await t.one(`select open_dispute($1, 'งานยังไม่เสร็จครบ', '{}')`, [q2]);
  await t.throws(`select confirm_quest('${q2}')`, 'cannot confirm', 'disputed work cannot be confirmed');
  await t.as(X); await t.throws(`select resolve_dispute('${d}', 50, 'x')`, 'forbidden', 'only dispute staff can judge');
  await t.as(mod);
  t.eq(await t.one(`select count(*) from messages where quest_id = $1`, [q2]), 0, 'staff can read dispute chat');
  await t.q(`select send_message($1, 'ทีมงานขอรูปเพิ่มครับ')`, [q2]);
  await t.q(`select resolve_dispute($1, 60, 'ทำได้ประมาณ 60%')`, [d]);
  await t.admin();
  t.eq(await t.one(`select gold from wallets where user_id = $1`, [W]), 500 + 600 - 60, 'worker gets 60% minus 10% fee');
  t.eq(await t.one(`select status from quests where id = $1`, [q2]), 'completed', 'quest closed');
  t.eq(await t.one(`select jobs from user_careers where user_id = $1 and occupation_id = 'home'`, [W]), 2, '>=50% still counts for career');
  const pg = await t.one(`select gold from wallets where user_id = $1`, [P]);
  t.eq(pg, 20000 - 500 - 1000 + 400, 'poster refunded 40%');

  // anti-farming: 5 counted jobs from the same poster in 30 days
  await t.q(`update quests set career_counted = true, completed_at = now() where id in ($1, $2)`, [q1, q2]);
  for (let i = 0; i < 3; i++) await t.q(`insert into quests (poster_id, worker_id, title, category, rank, reward_gold, status, career_counted, completed_at) values ($1, $2, 'ฟาร์ม', 'home', 'E', 10, 'completed', true, now())`, [P, W]);
  await t.as(P);
  const q3 = await t.one(post(`'home', 'E', 100, 60, null, null, true, false, 13.75, 100.5, null`));
  await t.as(W); await t.q(`select apply_quest($1, null)`, [q3]);
  await t.q(`select check_in($1, 13.75, 100.5, null)`, [q3]); await t.q(`select check_out($1, 13.75, 100.5, null)`, [q3]); await t.q(`select submit_quest($1)`, [q3]);
  await t.as(P); await t.q(`select confirm_quest($1)`, [q3]);
  await t.admin();
  t.eq(await t.one(`select jobs from user_careers where user_id = $1 and occupation_id = 'home'`, [W]), 2, '6th job from the same poster in 30 days does not count');

  // no-show: worker never checked in by the due time
  await t.as(owner); await t.q(`select set_setting('platform_fee_pct', '0')`);
  await t.as(P);
  const q4 = await t.one(post(`'general', 'A', 200, 60, (now() + interval '1 hour'), null, true, true, null, null, null`));
  t.eq(await t.one(`select rank from quests where id = $1`, [q4]), 'F', 'general quests are always entry level');
  await t.as(W2); t.eq(await t.one(`select apply_quest($1, null)`, [q4]), 'assigned', 'anyone verified can take an entry quest');
  await t.admin(); await t.q(`update quests set due_at = now() - interval '1 hour' where id = $1`, [q4]);
  await t.as(P); await t.q(`select cancel_quest($1)`, [q4]);
  await t.admin();
  t.eq(await t.one(`select no_show_count from profiles where id = $1`, [W2]), 1, 'no-show strike recorded');
  t.eq(await t.one(`select status from quests where id = $1`, [q4]), 'cancelled', 'quest cancelled and refunded');

  // abandon returns the quest to the board
  await t.as(P);
  const q5 = await t.one(post(`'general', 'F', 50, 30, null, null, true, true, null, null, null`));
  await t.as(W2); await t.q(`select apply_quest($1, null)`, [q5]); await t.q(`select abandon_quest($1)`, [q5]);
  t.eq(await t.one(`select status from quests where id = $1`, [q5]), 'open', 'abandoned quest is open again');

  // maintenance: auto release and expiry
  await t.as(W); await t.q(`select apply_quest($1, null)`, [q5]);
  await t.q(`select check_in($1, null, null, null)`, [q5]); await t.q(`select check_out($1, null, null, null)`, [q5]); await t.q(`select submit_quest($1)`, [q5]);
  await t.as(P);
  const q6 = await t.one(post(`'general', 'F', 70, 30, (now() + interval '1 hour'), null, false, true, null, null, null`));
  await t.admin();
  await t.q(`update quests set auto_release_at = now() - interval '1 minute' where id = $1`, [q5]);
  await t.q(`update quests set due_at = now() - interval '1 minute' where id = $1`, [q6]);
  const m = await t.one(`select run_maintenance()`);
  t.eq(m.released, 1, 'unconfirmed work auto-paid'); t.eq(m.expired, 1, 'unfilled quest expired');
  t.eq(await t.one(`select status from quests where id = $1`, [q6]), 'cancelled', 'expired quest cancelled');

  // family quests still need no identity check
  const parent = await t.user('qf_parent', { kyc: true, gold: 300 });
  const kid = await t.user('qf_kid');
  await t.as(parent);
  await t.q(`select create_family('บ้านทดสอบ')`);
  const code = await t.one(`select join_code from families where id = my_family()`);
  const fq = await t.one(`select post_family_quest('จัดโต๊ะ', null, 30, null)`);
  await t.as(kid); await t.q(`select join_family($1, 'child')`, [code]);
  await t.q(`select accept_quest($1)`, [fq]); await t.q(`select submit_quest($1)`, [fq]);
  await t.as(parent); await t.q(`select confirm_quest($1)`, [fq]);
  await t.admin();
  t.eq(await t.one(`select gold from wallets where user_id = $1`, [kid]), 30, 'child paid for family quest');

  // users can never call internal functions
  await t.as(X);
  await t.throws(`select _settle('${q1}', 100, 'x')`, 'permission denied', 'internal settle is not callable');
  await t.throws(`select run_maintenance()`, 'permission denied', 'maintenance is not callable');
  await t.throws(`select _grant_exp('${X}', 99999)`, 'permission denied', 'EXP cannot be self-granted');
};
