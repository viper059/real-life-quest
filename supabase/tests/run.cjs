// Runs every migration against an in-process Postgres (PGlite) with Supabase stand-ins, then the scenario tests.
// Usage: NODE_PATH=<dir with @electric-sql/pglite> node supabase/tests/run.cjs
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');
const migDir = path.join(root, 'migrations');

(async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, 'stubs.sql'), 'utf8'));
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    try { await db.exec(fs.readFileSync(path.join(migDir, f), 'utf8')); console.log('applied', f); }
    catch (e) { console.error('MIGRATION FAILED', f, '\n', e.message, e.position ? '@' + e.position : ''); process.exit(1); }
  }
  let pass = 0, fail = 0;
  const t = {
    db,
    async as(uid) { await db.exec(`reset role; select set_config('request.jwt.claims', '${uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : ''}', false); ${uid ? 'set role authenticated;' : ''}`); },
    async admin() { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); },
    async q(sql, params) { return (await db.query(sql, params)).rows; },
    async one(sql, params) { const r = await db.query(sql, params); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; },
    ok(cond, label) { if (cond) { pass++; } else { fail++; console.log('  FAIL:', label); } },
    eq(a, b, label) { const ok = String(a) === String(b); if (ok) pass++; else { fail++; console.log(`  FAIL: ${label} — got ${a}, want ${b}`); } },
    async throws(sql, pattern, label) {
      try { await db.query(sql); fail++; console.log('  FAIL (no error):', label); }
      catch (e) { if (!pattern || e.message.includes(pattern)) pass++; else { fail++; console.log(`  FAIL: ${label} — error "${e.message}" lacks "${pattern}"`); } }
    },
    async user(name, extra = {}) {
      const id = crypto.randomUUID();
      await t.admin();
      await db.query(`insert into auth.users (id, aud, role, email, raw_user_meta_data) values ($1,'authenticated','authenticated',$2,$3)`,
        [id, name + '@t.local', JSON.stringify({ username: name })]);
      if (extra.gold) await db.query('update wallets set gold = $2 where user_id = $1', [id, extra.gold]);
      if (extra.crystal) await db.query('update wallets set crystal = $2 where user_id = $1', [id, extra.crystal]);
      if (extra.kyc) await db.query(`update profiles set kyc_status = 'verified', kyc_verified_at = now() where id = $1`, [id]);
      if (extra.career) for (const [occ, rank] of Object.entries(extra.career))
        await db.query(`insert into user_careers (user_id, occupation_id, rank) values ($1, $2, $3)`, [id, occ, rank]);
      if (extra.staff) await db.query('insert into staff_members (user_id, role_id) values ($1, $2)', [id, extra.staff]);
      return id;
    }
  };
  const testDir = path.join(__dirname, 'cases');
  const only = process.argv[2];
  for (const f of fs.readdirSync(testDir).filter((f) => f.endsWith('.cjs') && (!only || f.includes(only))).sort()) {
    console.log('▶', f);
    try { await require(path.join(testDir, f))(t); }
    catch (e) { fail++; console.log('  CRASH:', e.message); }
    await t.admin();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
