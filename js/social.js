/* Real-life Quest — guilds (insurance fund, claims, votes) and family (parents give quests, verify kids' personal goals). */
(() => {
  const { sb, S, $, esc, num, ago, toast, rpc, loaders, renderers } = App;
  const CLAIM = { voting: 'กำลังโหวต', approved: 'โหวตผ่าน · รอทีมงานจ่าย', rejected: 'ไม่ผ่าน', paid: 'จ่ายแล้ว' };

  loaders.guild = async function () {
    const uid = S.user.id;
    const [g, m] = await Promise.all([
      sb.from('guilds').select('*').is('closed_at', null).order('fund_gold', { ascending: false }).limit(50),
      sb.from('guild_members').select('user_id,guild_id,role,joined_at,p:profiles!guild_members_user_id_fkey(username,display_name,base_level)').is('left_at', null)
    ]);
    S.guilds = g.data || []; S.memberCount = {};
    (m.data || []).forEach((r) => { S.memberCount[r.guild_id] = (S.memberCount[r.guild_id] || 0) + 1; });
    const me = (m.data || []).find((r) => r.user_id === uid);
    S.myGuild = me ? S.guilds.find((x) => x.id === me.guild_id) || null : null; S.myGuildRole = me ? me.role : null;
    S.gMembers = S.myGuild ? (m.data || []).filter((r) => r.guild_id === S.myGuild.id) : [];
    S.claims = []; S.myVotes = {};
    if (S.myGuild) {
      const [cl, v] = await Promise.all([
        sb.from('guild_claims').select('*, claimant:profiles!guild_claims_claimant_id_fkey(username,display_name)').eq('guild_id', S.myGuild.id).order('created_at', { ascending: false }).limit(20),
        sb.from('guild_votes').select('claim_id,approve').eq('user_id', uid)
      ]);
      S.claims = cl.data || []; (v.data || []).forEach((x) => { S.myVotes[x.claim_id] = x.approve; });
    }
  };
  loaders.family = async function () {
    const uid = S.user.id;
    const { data: me } = await sb.from('family_members').select('family_id, role').eq('user_id', uid).is('left_at', null).maybeSingle();
    S.family = null; S.famRole = null; S.famMembers = []; S.famQuests = []; S.famPending = [];
    if (!me) return;
    const [f, mem, q, pend, ph] = await Promise.all([
      sb.from('families').select('*').eq('id', me.family_id).single(),
      sb.from('family_members').select('user_id, role, p:profiles!family_members_user_id_fkey(username,display_name,base_level)').eq('family_id', me.family_id).is('left_at', null),
      sb.from('quests').select(App.QSEL).eq('family_id', me.family_id).in('status', ['open', 'in_progress', 'submitted']).order('created_at', { ascending: false }),
      me.role === 'parent' ? sb.rpc('family_pending_verifications') : Promise.resolve({ data: [] }),
      me.role === 'parent' ? sb.rpc('family_pending_habits') : Promise.resolve({ data: [] })
    ]);
    S.family = f.data; S.famRole = me.role; S.famMembers = mem.data || []; S.famQuests = q.data || []; S.famPending = pend.data || []; S.famHabits = ph.data || [];
  };

  function health(g) {
    const n = S.memberCount[g.id] || 1, pct = Math.min(100, Math.round((Number(g.fund_gold) / (n * 500)) * 100));
    return pct >= 50 ? { pct, label: 'มั่นคง', color: 'var(--teal-600)', bg: 'var(--teal-tint)', fg: 'var(--teal-ink)' }
      : pct >= 20 ? { pct, label: 'ระวัง', color: 'var(--exp)', bg: '#f6e8cf', fg: '#7a4a06' }
      : { pct, label: 'เสี่ยง', color: 'var(--danger)', bg: 'var(--danger-tint)', fg: 'var(--danger-ink)' };
  }
  function renderGuild() {
    const el = $('guildPanel');
    if (!S.myGuild) {
      el.innerHTML = `<div class="grid" style="align-items:start">
        <form id="guildCreate" class="card stack"><h2 style="font-size:16px">ตั้งกิลด์ใหม่</h2>
          <label class="f">ชื่อกิลด์<input name="n" required minlength="3" maxlength="40"></label>
          <label class="f">คำขวัญ (ไม่บังคับ)<input name="m" maxlength="120"></label>
          <button class="btn primary" type="submit">ตั้งกิลด์</button>
          <span class="small muted">กิลด์มีกองทุนประกันร่วม สมาชิกช่วยกันสมทบ และโหวตจ่ายเมื่อมีคนเดือดร้อนจากงาน</span></form>
        <div class="card stack" style="gap:4px"><h2 style="font-size:16px">กิลด์ที่เปิดรับ</h2>
          ${S.guilds.length ? S.guilds.map((g) => { const n = S.memberCount[g.id] || 0, h = health(g); return `<div class="tx"><div style="flex:1;min-width:0"><b>${esc(g.name)}</b><div class="small muted">${n}/${g.member_cap} คน · กองทุน ${num(g.fund_gold)} G · ${h.label}</div></div>
            ${n < g.member_cap ? `<button class="btn action sm" data-gjoin="${g.id}">เข้าร่วม</button>` : '<span class="small muted">เต็ม</span>'}</div>`; }).join('') : '<div class="empty">ยังไม่มีกิลด์ — ตั้งกิลด์แรกเลย</div>'}
        </div></div>`;
      return;
    }
    const g = S.myGuild, h = health(g), n = S.gMembers.length, leader = S.myGuildRole === 'leader';
    el.innerHTML = `
      <div style="background:var(--wood-800);border:2px solid var(--brass-500);border-radius:14px;padding:16px;color:var(--on-wood);display:flex;gap:14px;align-items:center;margin-bottom:12px">
        <div aria-hidden="true" style="width:60px;height:72px;flex:none;background:#7a2e22;border:2px solid var(--gold-500);clip-path:polygon(0 0,100% 0,100% 78%,50% 100%,0 78%)"></div>
        <div style="min-width:0"><h2 style="font-size:22px">${esc(g.name)}</h2><div class="small" style="color:var(--on-wood-muted)">${esc(g.motto || '')}</div>
          <div class="small" style="color:var(--on-wood-muted)">สมาชิก ${n}/${g.member_cap} · คุณเป็น${{ leader: 'หัวกิลด์', officer: 'เจ้าหน้าที่', member: 'สมาชิก' }[S.myGuildRole]}</div></div></div>
      <div class="grid" style="align-items:start">
        <div class="card stack" style="border:2px solid ${h.color}">
          <div class="row between"><h2 style="font-size:16px">กองทุนประกันกิลด์</h2><span class="tag" style="background:${h.bg};color:${h.fg}">${h.label}</span></div>
          <span class="gold" style="font-size:30px">${num(g.fund_gold)} G</span>
          <div class="bar" role="progressbar" aria-label="สุขภาพกองทุน" aria-valuenow="${h.pct}" aria-valuemax="100"><div style="width:${h.pct}%;background:${h.color}"></div></div>
          <span class="small muted">เป้าหมาย 500 G ต่อสมาชิก · เสี่ยง &lt; 20% · ระวัง 20–50% · มั่นคง ≥ 50%</span>
          <form id="gContribute" class="row dash" style="align-items:flex-end"><label class="f" style="flex:1 1 120px">สมทบ (G)<input name="a" type="number" min="1" step="1" required inputmode="numeric"></label><button class="btn action" type="submit">สมทบ</button></form>
          <form id="gClaim" class="dash stack"><h3 style="font-size:14px">ขอเคลมจากกองทุน</h3>
            <label class="f">จำนวน (G)<input name="a" type="number" min="1" step="1" required inputmode="numeric"></label>
            <label class="f">เหตุผล (เช่น เครื่องมือเสียหายระหว่างเควสต์)<input name="r" required minlength="5" maxlength="500"></label>
            <button class="btn sec" type="submit">ส่งให้สมาชิกโหวต</button></form></div>
        <div class="card stack" style="gap:4px"><h2 style="font-size:16px">เคลมของกิลด์</h2>
          ${S.claims.length ? S.claims.map((c) => {
            const mine = c.claimant_id === S.user.id, voted = c.id in S.myVotes, open = c.status === 'voting' && new Date(c.closes_at) > Date.now();
            return `<div class="tx" style="flex-wrap:wrap"><div style="flex:1 1 200px;min-width:0"><b>${num(c.amount)} G</b> · ${esc(c.claimant ? (c.claimant.display_name || c.claimant.username) : '')}
              <div class="small" style="color:var(--ink-soft)">${esc(c.reason)}</div>
              <div class="small muted">${CLAIM[c.status]}${c.status === 'voting' ? ` · เห็นด้วย ${c.yes_votes} / ไม่เห็นด้วย ${c.no_votes}${voted ? ' · คุณโหวต' + (S.myVotes[c.id] ? 'เห็นด้วย' : 'ไม่เห็นด้วย') : ''}` : ''}</div></div>
              ${open && !mine ? `<div class="row"><button class="btn action sm" data-vote="${c.id}" data-yes="1">เห็นด้วย</button><button class="btn sec sm" data-vote="${c.id}" data-yes="0">ไม่เห็นด้วย</button></div>` : ''}</div>`;
          }).join('') : '<div class="empty">ยังไม่มีเคลม</div>'}</div>
        <div class="card stack" style="gap:4px"><h2 style="font-size:16px">สมาชิก</h2>
          ${S.gMembers.map((m) => `<div class="tx"><div style="flex:1;min-width:0">${esc(m.p ? (m.p.display_name || m.p.username) : '')} <span class="small muted">Lv.${m.p ? m.p.base_level : 1}${m.role === 'leader' ? ' · หัวกิลด์' : ''}</span></div>
            ${leader && m.user_id !== S.user.id ? `<button class="btn sec sm" data-glead="${m.user_id}">ให้เป็นหัวกิลด์</button>` : ''}</div>`).join('')}
          <button class="btn sec" id="gLeave" type="button" style="margin-top:8px">${n === 1 ? 'ออกและปิดกิลด์ (คืนเงินกองทุนให้คุณ)' : 'ออกจากกิลด์'}</button></div>
      </div>`;
  }

  function renderFamily() {
    const el = $('familyPanel');
    if (!S.family) {
      el.innerHTML = `<div class="grid" style="align-items:start">
        <form id="famCreate" class="card stack"><h3 style="font-size:15px">สร้างบ้านของฉัน (ผู้ปกครอง)</h3>
          <label class="f">ชื่อบ้าน<input name="n" required minlength="2" maxlength="40" placeholder="เช่น บ้านริมน้ำ"></label><button class="btn primary" type="submit">สร้าง</button>
          <span class="small muted">ผู้ปกครองมอบเควสต์ให้ลูกโดยใช้ Gold ของตัวเอง ส่ง Crystal ให้ลูกได้ และรับรองเป้าหมายส่วนตัวของลูก (ได้ EXP 2 เท่า)</span></form>
        <form id="famJoin" class="card stack"><h3 style="font-size:15px">เข้าบ้านด้วยรหัส</h3>
          <label class="f">รหัสบ้าน<input name="c" required maxlength="12" style="text-transform:uppercase"></label>
          <label class="f">ฉันเป็น<select name="r"><option value="child">ลูก</option><option value="parent">ผู้ปกครอง</option></select></label>
          <button class="btn action" type="submit">เข้าบ้าน</button></form></div>`;
      return;
    }
    const parent = S.famRole === 'parent';
    el.innerHTML = `<div class="grid" style="align-items:start">
      <div class="card stack" style="gap:6px"><h3 style="font-size:17px">${esc(S.family.name)}</h3>
        ${parent ? `<span class="small">รหัสเชิญ <b style="font-family:var(--font-rpg);letter-spacing:.08em">${esc(S.family.join_code)}</b> — ให้ลูกกรอกในแอปของเขา</span>` : ''}
        ${S.famMembers.map((m) => `<div class="tx"><span style="flex:1">${esc(m.p ? (m.p.display_name || m.p.username) : '')} <span class="small muted">Lv.${m.p ? m.p.base_level : 1}</span></span><span class="small muted">${m.role === 'parent' ? 'ผู้ปกครอง' : 'ลูก'}</span>
          ${parent && m.role === 'child' && m.p ? `<button class="btn sec sm" data-gift="${esc(m.p.username)}">ส่ง Crystal</button>` : ''}</div>`).join('')}
        <button class="btn sec" id="famLeave" type="button">ออกจากบ้าน</button></div>
      ${parent ? `<form id="famPost" class="card stack"><h3 style="font-size:15px">มอบเควสต์ให้ลูก</h3>
        <label class="f">งาน<input name="t" required minlength="4" maxlength="120" placeholder="เช่น จัดโต๊ะหนังสือให้เรียบร้อย"></label>
        <label class="f">รายละเอียด<input name="d" maxlength="2000"></label>
        <label class="f">รางวัล (G) — ล็อกจากกระเป๋าคุณ<input name="g" type="number" min="1" step="1" required inputmode="numeric"></label>
        <button class="btn primary" type="submit">มอบเควสต์</button></form>` : ''}
      ${parent ? `<div class="card stack" style="gap:4px"><h3 style="font-size:15px">รอคุณรับรอง (${S.famPending.length + (S.famHabits || []).length})</h3>
        ${(S.famHabits || []).map((v) => `<div class="tx"><span aria-hidden="true" style="font-size:20px">${v.icon}</span><div style="flex:1;min-width:0"><b style="font-weight:600">${esc(v.user)}</b> · ${esc(v.title)}<div class="small muted">${ago(v.logged_at)} · กิจวัตร +${v.exp} EXP</div></div>
          <button class="btn action sm" data-hverify="${v.id}" data-ok="1">รับรอง</button><button class="btn sec sm" data-hverify="${v.id}" data-ok="0">ไม่ใช่</button></div>`).join('')}
        ${S.famPending.length || (S.famHabits || []).length ? S.famPending.map((v) => `<div class="tx"><div style="flex:1;min-width:0"><b style="font-weight:600">${esc(v.user)}</b> · ${esc(v.title)}<div class="small muted">${ago(v.done_at)} · ได้ ${v.exp} EXP ถ้ารับรอง</div></div>
          <button class="btn action sm" data-verify="${v.pq_id}" data-period="${esc(v.period)}">รับรอง</button></div>`).join('') : '<span class="small muted">ยังไม่มีเป้าหมายที่รอรับรอง</span>'}</div>` : ''}
    </div>
    <h3 style="font-size:15px;margin:14px 0 8px">เควสต์ในบ้าน</h3>
    <div class="grid">${S.famQuests.length ? S.famQuests.map((q) => App.questCard(q, 'family')).join('') : '<div class="empty">ยังไม่มีเควสต์ในบ้าน</div>'}</div>`;
  }
  renderers.push(renderGuild, renderFamily);

  $('guildPanel').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    if (f.id === 'guildCreate') await rpc('create_guild', { p_name: f.elements.n.value.trim(), p_motto: f.elements.m.value.trim() || null }, 'ตั้งกิลด์แล้ว');
    if (f.id === 'gContribute') await rpc('contribute_guild', { p_amount: Number(f.elements.a.value) }, 'สมทบกองทุนแล้ว');
    if (f.id === 'gClaim') await rpc('file_guild_claim', { p_amount: Number(f.elements.a.value), p_reason: f.elements.r.value.trim() }, 'ส่งเคลมให้สมาชิกโหวตแล้ว');
  });
  $('guildPanel').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b || b.type === 'submit') return;
    if (b.dataset.gjoin) { b.disabled = true; await rpc('join_guild', { p_guild: b.dataset.gjoin }, 'เข้ากิลด์แล้ว'); }
    if (b.dataset.vote) { b.disabled = true; await rpc('vote_guild_claim', { p_claim: b.dataset.vote, p_approve: b.dataset.yes === '1' },
      (s) => s === 'approved' ? 'โหวตผ่านแล้ว รอทีมงานจ่าย' : s === 'rejected' ? 'เคลมไม่ผ่าน' : 'บันทึกโหวตแล้ว'); }
    if (b.dataset.glead && confirm('โอนตำแหน่งหัวกิลด์ให้สมาชิกคนนี้?')) await rpc('transfer_leader', { p_user: b.dataset.glead }, 'โอนตำแหน่งแล้ว');
    if (b.id === 'gLeave' && confirm(S.gMembers.length === 1 ? 'คุณเป็นคนสุดท้าย กิลด์จะปิดและเงินกองทุนคืนให้คุณ ตกลงไหม?' : 'ออกจากกิลด์นี้?')) await rpc('leave_guild', {}, 'ออกจากกิลด์แล้ว');
  });
  $('familyPanel').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    if (f.id === 'famCreate') await rpc('create_family', { p_name: f.elements.n.value.trim() }, 'สร้างบ้านแล้ว — ส่งรหัสเชิญให้ลูกได้เลย');
    if (f.id === 'famJoin') await rpc('join_family', { p_code: f.elements.c.value.trim(), p_role: f.elements.r.value }, 'เข้าบ้านแล้ว');
    if (f.id === 'famPost') await rpc('post_family_quest', { p_title: f.elements.t.value.trim(), p_description: f.elements.d.value.trim() || null, p_reward_gold: Number(f.elements.g.value), p_urgent_minutes: null }, 'มอบเควสต์แล้ว');
  });
  $('familyPanel').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'famLeave' && confirm('ออกจากบ้านนี้?')) await rpc('leave_family', {}, 'ออกจากบ้านแล้ว');
    if (b.dataset.verify) { b.disabled = true; await rpc('verify_personal', { p_pq: b.dataset.verify, p_period: b.dataset.period }, 'รับรองแล้ว ลูกได้ EXP 2 เท่า'); }
    if (b.dataset.gift) App.openSendCrystal(b.dataset.gift);
    if (b.dataset.hverify) { b.disabled = true; await rpc('verify_habit', { p_log: Number(b.dataset.hverify), p_approve: b.dataset.ok === '1' }, b.dataset.ok === '1' ? 'รับรองแล้ว' : 'แจ้งลูกแล้ว'); }
  });
})();
