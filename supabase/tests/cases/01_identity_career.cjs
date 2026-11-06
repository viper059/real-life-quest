// Identity verification, bans, career ranks with real-time gates, endorsements, promotions and imports.
module.exports = async (t) => {
  const u = await t.user('kyc_user');
  const support = await t.user('kyc_support', { staff: 'support', kyc: true });
  const admin = await t.user('kyc_admin', { staff: 'admin', kyc: true });
  const nosy = await t.user('kyc_nosy', { kyc: true });

  await t.as(u);
  await t.throws(`select start_career('home')`, 'identity not verified', 'unverified cannot start a career');
  await t.throws(`select submit_kyc('สมชาย ใจดี', '0812345678', 'someone-else/id.jpg', '${u}/selfie.jpg')`, 'bad file path', 'kyc paths must be own folder');
  const req = await t.one(`select submit_kyc('สมชาย ใจดี', '0812345678', '${u}/id.jpg', '${u}/selfie.jpg')`);
  t.eq(await t.one(`select kyc_status from profiles where id = $1`, [u]), 'pending', 'kyc pending after submit');
  await t.throws(`select submit_kyc('สมชาย ใจดี', '0812345678', '${u}/id.jpg', '${u}/selfie.jpg')`, 'already submitted', 'cannot submit twice');

  await t.as(nosy);
  await t.throws(`select review_kyc('${req}', true, null)`, 'forbidden', 'ordinary user cannot review kyc');
  t.eq(await t.one(`select count(*) from kyc_requests`), 0, 'others cannot see kyc requests');

  await t.as(support);
  t.eq(await t.one(`select count(*) from kyc_requests where id = $1`, [req]), 1, 'support sees the kyc request');
  await t.q(`select review_kyc($1, true, 'บัตรตรงกับใบหน้า')`, [req]);
  await t.as(u);
  t.eq(await t.one(`select kyc_status from profiles where id = $1`, [u]), 'verified', 'kyc verified');
  t.eq(await t.one(`select legal_name from private_profiles where user_id = $1`, [u]), 'สมชาย ใจดี', 'owner sees own legal name');
  await t.as(nosy);
  t.eq(await t.one(`select count(*) from private_profiles where user_id = $1`, [u]), 0, 'others cannot read legal name or phone');
  t.eq(await t.one(`select count(*) from notifications where user_id = $1`, [u]), 0, 'others cannot read notifications');
  await t.as(u);
  t.ok(await t.one(`select count(*) from notifications where user_id = $1 and kind = 'kyc'`, [u]) >= 1, 'user notified of kyc result');

  // careers
  await t.q(`select start_career('home')`);
  await t.throws(`select start_career('electric')`, 'license required', 'licensed trade needs an import');
  let g = await t.one(`select career_gates($1, 'home')`, [u]);
  t.eq(g.rank, 'F', 'starts at F');
  t.eq(g.ok, false, 'cannot promote on day one');
  await t.throws(`select request_promotion('home')`, 'requirements not met', 'promotion blocked until gates pass');

  await t.admin();
  await t.q(`update user_careers set rank_since = now() - interval '4 months', jobs = 20, minutes = 1200, rating_sum = 20, rating_count = 5 where user_id = $1`, [u]);
  await t.as(u);
  t.eq(await t.one(`select request_promotion('home')`), 'promoted', 'F -> E once 3 months, 20 jobs, 20 h and 4.0 rating are met');
  t.eq(await t.one(`select rank from user_careers where user_id = $1 and occupation_id = 'home'`, [u]), 'E', 'now E');

  // E -> D needs 24 months in rank and 2 endorsements from C or higher who worked with them
  await t.admin();
  await t.q(`update user_careers set rank_since = now() - interval '25 months', jobs = 150, minutes = 90000, rating_sum = 450, rating_count = 100 where user_id = $1`, [u]);
  const s1 = await t.user('senior_one', { kyc: true, career: { home: 'C' } });
  const s2 = await t.user('senior_two', { kyc: true, career: { home: 'B' } });
  await t.as(u);
  t.eq((await t.one(`select career_gates($1, 'home')`, [u])).ok, false, 'still blocked without endorsements');
  await t.as(s1);
  await t.throws(`select endorse_worker('${u}', 'home', 'ฝีมือดี')`, 'no job together', 'endorser must have worked with them');
  await t.admin();
  for (const s of [s1, s2]) {
    await t.q(`insert into quests (poster_id, worker_id, title, category, rank, reward_gold, status) values ($1, $2, 'งานร่วมกัน', 'home', 'E', 100, 'completed')`, [s, u]);
  }
  await t.as(s1); await t.q(`select endorse_worker($1, 'home', 'ฝีมือดี')`, [u]);
  await t.as(s2); await t.q(`select endorse_worker($1, 'home', null)`, [u]);
  await t.as(u);
  g = await t.one(`select career_gates($1, 'home')`, [u]);
  t.eq(g.endorsements, 2, 'two qualifying endorsements counted');
  t.eq(await t.one(`select request_promotion('home')`), 'promoted', 'E -> D');

  // D -> C goes to a committee with a portfolio
  await t.admin();
  await t.q(`update user_careers set rank_since = now() - interval '37 months', jobs = 400, minutes = 300000, rating_sum = 470, rating_count = 100 where user_id = $1`, [u]);
  const b3 = await t.user('lead_three', { kyc: true, career: { home: 'B' } });
  const b4 = await t.user('lead_four', { kyc: true, career: { home: 'A' } });
  for (const s of [b3, b4]) await t.q(`insert into quests (poster_id, worker_id, title, category, rank, reward_gold, status) values ($1, $2, 'งานร่วมกัน', 'home', 'D', 100, 'completed')`, [s, u]);
  await t.as(b3); await t.q(`select endorse_worker($1, 'home', null)`, [u]);
  await t.as(b4); await t.q(`select endorse_worker($1, 'home', null)`, [u]);
  await t.as(u);
  await t.throws(`select request_promotion('home')`, 'portfolio required', 'committee ranks need a portfolio');
  t.eq(await t.one(`select request_promotion('home', '${u}/portfolio.pdf')`), 'pending', 'D -> C waits for the committee');
  const pr = await t.one(`select id from promotion_requests where user_id = $1 and status = 'pending'`, [u]);
  await t.as(admin);
  await t.q(`select review_promotion($1, true, 'ผลงานผ่าน')`, [pr]);
  t.eq(await t.one(`select rank from user_careers where user_id = $1 and occupation_id = 'home'`, [u]), 'C', 'committee approved C');

  // importing outside experience
  await t.as(u);
  await t.throws(`select request_career_import('electric', 'B', 10, '${u}/license.pdf', null)`, 'check', 'imports cannot ask above C');
  const imp = await t.one(`select request_career_import('electric', 'C', 10, '${u}/license.pdf', 'ใบอนุญาตช่างไฟ')`);
  await t.as(admin);
  await t.q(`select review_career_import($1, true, 'D', 'ตรวจเอกสารแล้ว')`, [imp]);
  await t.as(u);
  const ec = (await t.q(`select rank, imported, started_at < now() - interval '9 years' as old from user_careers where user_id = $1 and occupation_id = 'electric'`, [u]))[0];
  t.eq(ec.rank, 'D', 'import approved at the reviewer’s rank');
  t.ok(ec.imported && ec.old, 'import marks experience start 10 years back');

  // bans
  await t.as(admin);
  await t.q(`select ban_user($1, 1, 'สแปม')`, [u]);
  await t.as(u);
  await t.throws(`select start_career('tutor')`, 'account banned', 'banned users are blocked');
  await t.as(admin);
  await t.q(`select ban_user($1, 0, null)`, [u]);
  await t.as(u);
  await t.q(`select start_career('tutor')`);
  t.ok(true, 'unban restores access');
};
