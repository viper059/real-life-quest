// Everyday-life habits: fixed EXP, daily caps, gaps, time windows, places, parent approval, daily ceiling.
module.exports = async (t) => {
  const U = await t.user('habit_user');
  const clock = async (bkk) => { await t.admin(); await t.q(`create or replace function public._clock() returns timestamptz language sql stable as $$ select '${bkk}+07'::timestamptz $$`); };
  const exp = async () => { await t.admin(); return t.one(`select base_exp from profiles where id = $1`, [U]); };

  // Wednesday 2026-11-04
  await clock('2026-11-04 07:00');
  await t.as(U);
  let r = await t.one(`select log_habit('water')`);
  t.eq(r.exp, 2, 'water gives 2 EXP');
  await t.throws(`select log_habit('water')`, 'too soon', 'water needs a 45-minute gap');
  await clock('2026-11-04 07:46'); await t.as(U);
  await t.q(`select log_habit('water')`);
  t.eq(await exp(), 4, 'two glasses = 4 EXP');

  // meals: one each, inside their windows
  await t.as(U);
  t.eq((await t.one(`select log_habit('breakfast')`)).exp, 5, 'breakfast 5 EXP');
  await t.throws(`select log_habit('breakfast')`, 'done for today', 'one breakfast a day');
  await t.throws(`select log_habit('lunch')`, 'outside time window', 'lunch not at 7 am');
  await t.throws(`select log_habit('sleep_early')`, 'outside time window', 'cannot log bedtime in the morning');
  await t.q(`select log_habit('brush')`);
  await clock('2026-11-04 12:00'); await t.as(U);
  await t.q(`select log_habit('lunch')`);
  await t.throws(`select log_habit('brush')`, 'too soon', 'brushing twice needs 6 hours');
  await clock('2026-11-04 21:00'); await t.as(U);
  await t.q(`select log_habit('dinner')`); await t.q(`select log_habit('brush')`);
  await t.throws(`select log_habit('brush')`, 'done for today', 'brush max twice');

  // photo proof
  await t.throws(`select log_habit('exercise')`, 'photo required', 'exercise needs a photo');
  await t.throws(`select log_habit('exercise', null, null, 'someone/x.jpg')`, 'bad file path', 'photo must be own folder');
  await t.q(`select log_habit('exercise', null, null, '${U}/run.jpg')`);

  // student or worker
  await clock('2026-11-05 07:30'); await t.as(U);
  await t.throws(`select log_habit('go_school', 13.75, 100.5)`, 'choose your role', 'must pick student or worker first');
  await t.q(`select set_life_role('student')`);
  await t.throws(`select log_habit('plan_day')`, 'not your role', 'student cannot log worker habits');
  await t.throws(`select set_life_role('worker')`, 'locked for 30 days', 'role switch locked 30 days');
  // places and school day
  await t.throws(`select log_habit('go_school', 13.75, 100.5)`, 'set your place first', 'school must be saved');
  await t.q(`select set_place('school', 13.75, 100.50)`); await t.q(`select set_place('home', 13.80, 100.55)`);
  await t.throws(`select set_place('school', 13.0, 100.0)`, 'locked for 30 days', 'cannot move school to cheat');
  await t.throws(`select log_habit('go_school', 13.80, 100.55)`, 'too far', 'must be at school');
  await t.q(`select log_habit('go_school', 13.7502, 100.5001)`);
  await clock('2026-11-05 16:00'); await t.as(U);
  await t.q(`select log_habit('back_home', 13.8001, 100.5501)`);
  await clock('2026-11-06 16:00'); await t.as(U);
  await t.throws(`select log_habit('back_home', 13.8001, 100.5501)`, 'earlier step first', 'back home needs school first');
  await clock('2026-11-07 08:00'); await t.as(U);
  await t.throws(`select log_habit('go_school', 13.7502, 100.5001)`, 'weekdays only', 'no school check-in on Saturday');

  // daily ceiling: 60 EXP for all habits
  await clock('2026-11-09 05:30'); await t.as(U);
  await t.q(`select log_habit('wake_early')`);                                  // 5
  await t.q(`select log_habit('exercise', null, null, '${U}/a.jpg')`);          // 10
  await t.q(`select log_habit('go_school', 13.7502, 100.5001)`).catch(() => {}); // outside window at 05:30 → ignored
  await clock('2026-11-09 07:00'); await t.as(U);
  for (const h of ['breakfast', 'brush', 'shower', 'make_bed', 'meditate', 'save_money', 'read', 'veggie', 'trash', 'review_lesson']) await t.q(`select log_habit('${h}')`);
  await t.q(`select log_habit('go_school', 13.7502, 100.5001)`);
  const before = await exp();
  await clock('2026-11-09 08:00'); await t.as(U);
  r = await t.one(`select log_habit('water')`);
  t.eq(r.exp, 1, 'only the room left under the 60 EXP ceiling (59 → 60)'); t.eq(r.capped, true, 'reports capped');
  await clock('2026-11-09 08:50'); await t.as(U);
  r = await t.one(`select log_habit('water')`);
  t.eq(r.exp, 0, 'past the ceiling gives 0');
  t.eq(await exp(), before + 1, 'no EXP past the ceiling');
  await t.as(U);
  const m = await t.one(`select my_habits()`);
  t.eq(m.exp_today, 60, 'my_habits shows 60/60');
  t.eq(m.habits.find((h) => h.id === 'water').block, 'too soon', 'block reason exposed');
  t.eq(m.habits.find((h) => h.id === 'water').count, 2, 'count today');

  // homework with a parent
  const P = await t.user('habit_parent'); const K = await t.user('habit_kid'); const X = await t.user('habit_other');
  await t.as(P); await t.q(`select create_family('บ้านกิจวัตร')`);
  await t.admin(); const code = await t.one(`select join_code from families where name = 'บ้านกิจวัตร'`);
  await t.as(K); await t.q(`select join_family($1, 'child')`, [code]); await t.q(`select set_life_role('student')`);
  await clock('2026-11-09 18:00'); await t.as(K);
  r = await t.one(`select log_habit('homework')`);
  t.eq(r.status, 'pending', 'homework waits for parent');
  await t.admin(); t.eq(await t.one(`select base_exp from profiles where id = $1`, [K]), 0, 'no EXP before approval');
  await t.as(X); await t.throws(`select verify_habit(${r.id}, true)`, 'parents only', 'stranger cannot approve');
  await t.as(K); await t.throws(`select verify_habit(${r.id}, true)`, 'parents only', 'kid cannot approve self');
  await t.as(P);
  t.eq((await t.one(`select family_pending_habits()`)).length, 1, 'parent sees pending homework');
  await t.q(`select verify_habit(${r.id}, true)`);
  await t.admin(); t.eq(await t.one(`select base_exp from profiles where id = $1`, [K]), 10, 'homework 10 EXP after approval');
  // worker path
  const Wk = await t.user('habit_worker');
  await clock('2026-11-10 07:00'); await t.as(Wk);
  await t.q(`select set_life_role('worker')`);
  await t.throws(`select log_habit('homework')`, 'not your role', 'worker cannot log homework');
  await t.q(`select log_habit('plan_day')`);
  await t.throws(`select log_habit('done_plan')`, 'outside time window', 'close-out only in the evening');
  await t.q(`select set_place('work', 13.70, 100.40)`); await t.q(`select set_place('home', 13.80, 100.55)`);
  await t.q(`select log_habit('go_work', 13.7001, 100.4001)`);
  await clock('2026-11-10 08:30'); await t.as(Wk);
  await t.q(`select log_habit('stretch')`); await t.throws(`select log_habit('stretch')`, 'too soon', 'stretch every 2 hours');
  await clock('2026-11-10 18:30'); await t.as(Wk);
  await t.q(`select log_habit('done_plan')`); await t.q(`select log_habit('back_home_work', 13.8001, 100.5501)`);
  await t.admin(); t.eq(await t.one(`select base_exp from profiles where id = $1`, [Wk]), 24, 'worker day: 3+10+1+5+5');
  await t.as(Wk); t.eq((await t.one(`select my_habits()`)).life_role, 'worker', 'my_habits reports role');
  await t.as(U); await clock('2026-11-10 18:00'); await t.as(U);
  await t.throws(`select log_habit('homework')`, 'photo required', 'no parent → photo needed');

  // privacy and tampering
  await t.as(X);
  t.eq(await t.one(`select count(*) from habit_logs where user_id = $1`, [U]), 0, 'others cannot read habit logs');
  t.eq(await t.one(`select count(*) from user_places where user_id = $1`, [U]), 0, 'others cannot read saved places');
  await t.as(U);
  await t.throws(`insert into habit_logs (user_id, habit_id, day, logged_at, exp) values ('${U}', 'water', current_date, now(), 20)`, 'permission denied', 'cannot insert logs directly');
  await t.throws(`select _clock()`, 'permission denied', 'cannot call the clock hook');
  await t.admin(); await t.q(`create or replace function public._clock() returns timestamptz language sql stable as $$ select now() $$`);
};
