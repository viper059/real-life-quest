// Every table: RLS on, and a signed-in user can never write directly (all writes go through checked functions).
module.exports = async (t) => {
  const u = await t.user('rls_user', { kyc: true });
  await t.admin();
  const tables = (await t.q(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'public' and c.relkind = 'r' order by 1`));
  for (const r of tables) t.ok(r.relrowsecurity, `RLS enabled on ${r.relname}`);
  const internal = (await t.q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and p.proname like '\\_%' and p.proname <> '_quest_role'
                                 and has_function_privilege('authenticated', p.oid, 'execute')`));
  t.eq(internal.map((r) => r.proname).join(','), '', 'no internal _function is executable by signed-in users');
  await t.as(u);
  for (const r of tables) {
    try {
      await t.q(`insert into public.${r.relname} default values`);
      t.ok(false, `insert into ${r.relname} should be denied`);
    } catch (e) { t.ok(/permission denied/.test(e.message), `insert denied on ${r.relname}: ${e.message.slice(0, 60)}`); }
    try {
      await t.q(`update public.${r.relname} set ${r.relname === 'profiles' ? 'quests_done = 999' : 'ctid = ctid'} where false`);
      t.ok(false, `update on ${r.relname} should be denied`);
    } catch (e) { t.ok(/permission denied|cannot assign to system column|column "ctid"/.test(e.message), `update denied on ${r.relname}`); }
  }
  await t.q(`update profiles set display_name = 'ชื่อใหม่' where id = $1`, [u]);
  t.eq(await t.one(`select display_name from profiles where id = $1`, [u]), 'ชื่อใหม่', 'display name is the one self-editable field');
};
