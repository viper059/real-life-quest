/* Real-life Quest — planner: daily quests + streak chest, monthly quests + reward track, personal goals (family-verified for 2× EXP). */
(() => {
  const { sb, S, $, esc, num, toast, rpc, refresh, loaders, renderers, geolocate, upload } = App;
  const PCAT = { health: 'สุขภาพ', study: 'เรียนรู้', money: 'การเงิน', home: 'บ้าน', discipline: 'วินัย', other: 'อื่น ๆ' };
  const REPEAT = { daily: 'ทุกวัน', weekly: 'ทุกสัปดาห์', monthly: 'ทุกเดือน' };
  const DIFF = { 1: 'ง่าย', 2: 'กลาง', 3: 'ยาก' };

  loaders.planner = async function () {
    if (S.qsub !== 'plan') return;
    const [d, m, h] = await Promise.all([sb.rpc('my_planner_day'), sb.rpc('my_planner_month'), sb.rpc('my_habits')]);
    if (d.error) throw d.error;
    S.day = d.data; S.month = m.data; S.habits = h.data;
  };
  App.loadPlanner = () => refresh(['planner']);

  const check = (done, label) => `<span class="check${done ? ' done' : ''}" aria-hidden="true">${done ? '✓' : ''}</span>`;
  const bar = (p, t, color) => `<div class="bar" style="flex:1"><div style="width:${t ? Math.min(100, Math.round(p / t * 100)) : 0}%;background:${color || 'var(--teal-600)'}"></div></div>`;

  function dayView(D) {
    const lvPct = Math.round((D.exp - D.level_start_exp) / Math.max(1, D.next_level_exp - D.level_start_exp) * 100);
    const slots = D.tier.personal_slots + (D.extra_personal_slots || 0), used = D.personal.length;
    return `<div class="grid" style="align-items:start">
      <div class="card wood stack">
        <div class="row between"><b style="font-family:var(--font-display);font-size:17px">วันนี้</b><span class="small" style="color:var(--on-wood-muted)">${new Date(D.day).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
        <div class="row between small" style="color:var(--on-wood-muted)"><span>Lv.${D.level} → ${D.level + 1}</span><span>${num(D.exp - D.level_start_exp)} / ${num(D.next_level_exp - D.level_start_exp)} EXP</span></div>
        <div class="bar dark"><div style="width:${lvPct}%;background:var(--exp)"></div></div>
        <div class="row between"><span>ต่อเนื่อง <b style="font-family:var(--font-rpg);color:var(--gold-500);font-size:20px">${D.streak}</b> วัน</span>
          <button class="btn primary${D.chest_ready ? ' chest-ready' : ''}" data-p="chest" ${D.chest_ready ? '' : 'disabled'}>${D.chest_claimed ? 'เปิดหีบวันนี้แล้ว' : `เปิดหีบ +${D.chest_exp} EXP`}</button></div>
        <span class="small" style="color:var(--on-wood-muted)">ทำภารกิจรายวันครบทุกช่อง + เป้าหมายส่วนตัวรายวันครบ → เปิดหีบได้ · ต่อเนื่องทุกวันได้โบนัสเพิ่มสูงสุด +50%</span>
      </div>
      <div class="card stack"><div class="row between"><h2 style="font-size:16px">ภารกิจรายวัน</h2><span class="small muted">${D.dailies.length} ช่อง (Lv.${D.level})</span></div>
        ${D.dailies.map((q) => `<div class="tx">${check(q.claimed)}<div style="flex:1;min-width:0"><div>${esc(q.title)}</div><div class="row small muted">${bar(q.progress, q.target)} ${q.progress}/${q.target}</div></div>
          ${q.claimed ? `<span class="small muted">+${q.exp}</span>` : `<button class="btn ${q.progress >= q.target ? 'action' : 'sec'} sm" data-p="daily" data-id="${q.id}" ${q.progress >= q.target ? '' : 'disabled'}>รับ +${q.exp}</button>`}</div>`).join('')}
        <span class="small muted">เลเวลสูงขึ้นปลดช่องภารกิจเพิ่ม · รีเซ็ตเที่ยงคืน (เวลาไทย)</span></div>
      <div class="card stack"><div class="row between"><h2 style="font-size:16px">เป้าหมายส่วนตัว</h2><span class="small muted">${used}/${slots} ช่อง · EXP วันนี้ ${D.personal_exp_today}/${D.personal_cap}</span></div>
        ${D.personal.length ? D.personal.map((q) => `<div class="tx">${check(q.done)}<div style="flex:1;min-width:0"><div>${esc(q.title)} <span class="small muted">${REPEAT[q.repeat]}</span></div>
          <div class="row small muted">${bar(q.progress, q.target, 'var(--exp)')} ${q.progress}/${q.target}${q.unit ? ' ' + esc(q.unit) : ''}${q.verify_status === 'pending' ? ' · รอผู้ปกครองรับรอง' : q.verify_status === 'verified' ? ' · รับรองแล้ว ×2' : ''}</div></div>
          ${q.done ? `<span class="small muted">+${q.exp}</span>` : `<button class="btn action sm" data-p="log" data-id="${q.id}" aria-label="บันทึกความคืบหน้า ${esc(q.title)}">+1</button>`}</div>`).join('')
          : '<div class="empty">ยังไม่มีเป้าหมาย — เพิ่มที่แท็บ "ส่วนตัว"</div>'}
        <span class="small muted">EXP จากเป้าหมายส่วนตัวมีเพดานต่อวัน เพื่อให้เลเวลมาจากงานจริงเป็นหลัก</span></div>
    </div>`;
  }

  function monthView(M) {
    const full = (S.day && S.day.dailies.length) || 3;
    const first = new Date(M.days[0] ? M.days[0].day : Date.now());
    const lead = (first.getDay() + 6) % 7;
    return `<div class="grid" style="align-items:start">
      <div class="card stack"><div class="row between"><h2 style="font-size:16px">${first.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</h2><span class="small muted">ช่องเขียว = ครบ + เปิดหีบ</span></div>
        <div class="cal" style="grid-template-columns:repeat(7,minmax(0,1fr))">${['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map((d) => `<span style="background:none">${d}</span>`).join('')}
          ${'<span style="background:none"></span>'.repeat(lead)}${M.days.map((d) => { const n = new Date(d.day).getDate(); const cls = d.chest || d.claims >= full ? 'full' : d.claims ? 'part' : ''; return `<span class="${cls}${d.day === M.today ? ' today' : ''}" title="${d.claims} ภารกิจ${d.chest ? ' · เปิดหีบ' : ''}">${n}</span>`; }).join('')}</div></div>
      <div class="card stack"><div class="row between"><h2 style="font-size:16px">ภารกิจประจำเดือน</h2><span class="small muted">${M.slots} ช่อง${M.next_slot_level ? ' · ช่องถัดไปที่ Lv.' + M.next_slot_level : ''}</span></div>
        ${M.templates.map((q) => `<div class="tx">${check(q.claimed)}<div style="flex:1;min-width:0"><div>${esc(q.title)}</div><div class="row small muted">${bar(q.progress, q.target, 'var(--exp)')} ${num(q.progress)}/${num(q.target)}</div></div>
          ${q.claimed ? `<span class="small muted">+${q.exp}</span>` : `<button class="btn ${q.progress >= q.target ? 'action' : 'sec'} sm" data-p="monthly" data-id="${q.id}" ${q.progress >= q.target ? '' : 'disabled'}>รับ +${q.exp}</button>`}</div>`).join('')}</div>
      <div class="card wood stack"><h2 style="font-size:16px">รางวัลสะสมเดือนนี้</h2><span class="small" style="color:var(--on-wood-muted)">สำเร็จภารกิจประจำเดือนแล้ว ${M.claimed} อย่าง</span>
        ${M.track.map((t) => { const need = t.step; const can = !t.claimed && M.claimed >= need; return `<div class="row between dash" style="border-color:var(--wood-line)"><span>ขั้น ${t.step}: ${esc(t.label)} <span class="small" style="color:var(--on-wood-muted)">(ครบ ${need} อย่าง)</span></span>
          ${t.claimed ? '<span class="small" style="color:var(--crystal)">รับแล้ว</span>' : `<button class="btn primary sm" data-p="track" data-step="${t.step}" ${can ? '' : 'disabled'}>รับ</button>`}</div>`; }).join('')}</div>
    </div>`;
  }

  function personalView(D) {
    const slots = D.tier.personal_slots + (D.extra_personal_slots || 0), full = D.personal.length >= slots;
    return `<div class="grid" style="align-items:start">
      <form class="card stack" id="pqForm"><h2 style="font-size:16px">เพิ่มเป้าหมายส่วนตัว</h2>
        <label class="f">เป้าหมาย<input name="t" required minlength="2" maxlength="80" placeholder="เช่น วิ่ง 3 กม., อ่านหนังสือ 20 หน้า"></label>
        <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          <label class="f">หมวด<select name="c">${Object.entries(PCAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="f">ทำซ้ำ<select name="r">${Object.entries(REPEAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="f">จำนวนต่อรอบ<input name="n" type="number" min="1" max="1000" value="1" required inputmode="numeric"></label>
          <label class="f">หน่วย (ไม่บังคับ)<input name="u" maxlength="20" placeholder="ครั้ง, หน้า, กม."></label>
          <label class="f">ความยาก<select name="d">${Object.entries(DIFF).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div>
        ${S.family && S.famRole === 'child' ? '<label class="row small"><input type="checkbox" name="fv" style="width:20px;height:20px"> ให้ผู้ปกครองรับรอง (ได้ EXP 2 เท่า)</label>' : ''}
        <button class="btn primary" type="submit" ${full ? 'disabled' : ''}>${full ? 'ช่องเต็ม — เลเวลอัปหรือซื้อช่องเพิ่ม' : 'เพิ่มเป้าหมาย'}</button>
        <span class="small muted">ใช้ ${D.personal.length}/${slots} ช่อง · EXP: ง่าย 10 · กลาง 15 · ยาก 30 (×3 รายสัปดาห์, ×8 รายเดือน)</span></form>
      <div class="card stack"><h2 style="font-size:16px">เป้าหมายของฉัน</h2>
        ${D.personal.length ? D.personal.map((q) => `<div class="tx"><div style="flex:1;min-width:0"><div>${esc(q.title)}</div><div class="small muted">${PCAT[q.category]} · ${REPEAT[q.repeat]} · ${q.target}${q.unit ? ' ' + esc(q.unit) : ''} · ${q.exp} EXP${q.family_verify ? ' · ผู้ปกครองรับรอง' : ''}</div></div>
          <button class="btn sec sm" data-p="archive" data-id="${q.id}">เลิก</button></div>`).join('') : '<div class="empty">ยังไม่มีเป้าหมาย</div>'}</div>
    </div>`;
  }


  /* ---------- everyday-life habits (กิจวัตร) ---------- */
  const HGRP = [['body', 'ร่างกาย'], ['food', 'อาหาร'], ['health', 'สุขภาพ'], ['home', 'งานบ้าน'], ['mind', 'ใจและวินัย'], ['student', 'นักเรียน'], ['worker', 'คนทำงาน']];
  const PLACE = { home: 'บ้าน', school: 'โรงเรียน', work: 'ที่ทำงาน' };
  const hm = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  function blockText(h) {
    switch (h.block) {
      case 'done for today': return h.pending ? 'รอผู้ปกครองรับรอง' : 'ครบวันนี้แล้ว';
      case 'too soon': return 'ทำได้อีกครั้ง ' + hm(h.next_at);
      case 'outside time window': return `ทำได้ช่วง ${h.from}–${h.to}`;
      case 'weekdays only': return 'เฉพาะวันจันทร์–ศุกร์';
      case 'do the earlier step first': return 'ต้องเช็กอินไปเรียน/ทำงานก่อน';
      case 'set your place first': return `ตั้งตำแหน่ง${PLACE[h.place]}ก่อน`;
      default: return h.block || '';
    }
  }
  function habitsView(H) {
    const pct = Math.min(100, Math.round(H.exp_today / H.cap * 100)), full = H.exp_today >= H.cap;
    const f = S.habitGrp || 'all';
    const groups = HGRP.filter(([g]) => f === 'all' || f === g);
    const needPlace = ['school', 'work', 'home'];
    return `<div class="stack">
      <div class="card wood stack">
        <div class="row between"><b style="font-family:var(--font-display);font-size:17px">กิจวัตรวันนี้</b><span class="small" style="color:var(--on-wood-muted)">ตอนนี้ ${esc(H.now)} น.</span></div>
        <div class="row between small" style="color:var(--on-wood-muted)"><span>EXP จากกิจวัตร</span><span>${H.exp_today} / ${H.cap}</span></div>
        <div class="bar dark"><div style="width:${pct}%;background:${full ? 'var(--crystal)' : 'var(--exp)'}"></div></div>
        <span class="small" style="color:var(--on-wood-muted)">${full ? 'ครบเพดานวันนี้แล้ว — ทำต่อได้เพื่อสุขภาพ แต่ไม่ได้ EXP เพิ่ม' : 'แต่ละอย่างได้ EXP ไม่เท่ากัน มีจำนวนครั้งต่อวัน ระยะห่าง และช่วงเวลา กันกดรัว'}</span>
      </div>
      <div class="row scroll-x">${[['all', 'ทั้งหมด'], ...HGRP].map(([k, v]) => `<button class="pill" data-hgrp="${k}" aria-pressed="${f === k}">${v}</button>`).join('')}</div>
      ${(f === 'all' || f === 'student' || f === 'worker') ? `<div class="card stack"><b>ตำแหน่งสำหรับเช็กอิน</b>
        <span class="small muted">ตั้งตอนอยู่ที่นั่นจริง · ตั้งแล้วเปลี่ยนได้อีกครั้งหลัง 30 วัน · เห็นเฉพาะคุณ</span>
        <div class="row">${needPlace.map((k) => { const p = H.places[k]; const locked = p && new Date(p.locked_until) > Date.now();
          return `<button class="btn ${p ? 'sec' : 'action'} sm" data-hplace="${k}" ${locked ? 'disabled' : ''}>${p ? '✓ ' : ''}${PLACE[k]}${locked ? ' · ล็อกถึง ' + new Date(p.locked_until).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : p ? ' · ตั้งใหม่' : ' · ตั้งที่นี่'}</button>`; }).join('')}</div></div>` : ''}
      ${groups.map(([g, label]) => { const list = H.habits.filter((h) => h.grp === g); if (!list.length) return '';
        return `<div class="card stack" style="gap:2px"><h2 style="font-size:16px">${label}</h2>${list.map((h) => {
          const can = !h.block, proof = h.verify === 'photo' || (h.verify === 'parent' && !H.has_parent);
          return `<div class="tx">
            <span aria-hidden="true" style="font-size:24px;width:36px;text-align:center;flex:none">${h.icon}</span>
            <div style="flex:1;min-width:0"><div>${esc(h.title)} <span class="gold" style="font-size:13px">+${h.exp}</span></div>
              <div class="small muted">${h.count}/${h.max} วันนี้${h.verify === 'location' ? ' · เช็กอินที่' + PLACE[h.place] : ''}${proof ? ' · แนบรูป' : ''}${h.verify === 'parent' && H.has_parent ? ' · ผู้ปกครองรับรอง' : ''}${can ? '' : ' · <span style="color:var(--danger-ink)">' + esc(blockText(h)) + '</span>'}</div>
              ${h.hint ? `<div class="small muted">${esc(h.hint)}</div>` : ''}</div>
            ${proof && can ? `<label class="btn action sm" style="cursor:pointer">📷 ทำแล้ว<input type="file" accept="image/*" capture="environment" data-hphoto="${h.id}" hidden></label>`
              : `<button class="btn ${can ? 'action' : 'sec'} sm" data-p="habit" data-id="${h.id}" data-loc="${h.verify === 'location' ? 1 : 0}" ${can ? '' : 'disabled'}>${h.count >= h.max ? '✓' : 'ทำแล้ว'}</button>`}
          </div>`; }).join('')}</div>`; }).join('')}
    </div>`;
  }
  const habitMsg = (x) => x.status === 'pending' ? 'บันทึกแล้ว รอผู้ปกครองรับรอง' : x.exp ? `+${x.exp} EXP${x.capped ? ' (ถึงเพดานวันนี้)' : ''}` : 'บันทึกแล้ว (ครบเพดาน EXP วันนี้)';

  function renderPlan() {
    const el = $('qsub-plan');
    if (S.qsub !== 'plan') return;
    if (!S.day) { el.innerHTML = '<div class="empty" style="margin-top:14px">กำลังโหลดแผน…</div>'; return; }
    el.innerHTML = `<div class="row" style="margin:14px 0 12px">${[['day', 'วันนี้'], ['habit', 'กิจวัตร'], ['month', 'เดือนนี้'], ['personal', 'ส่วนตัว']].map(([k, v]) => `<button class="pill" data-psub="${k}" aria-pressed="${S.psub === k}">${v}</button>`).join('')}</div>
      ${S.psub === 'day' ? dayView(S.day) : S.psub === 'habit' ? (S.habits ? habitsView(S.habits) : '') : S.psub === 'month' ? (S.month ? monthView(S.month) : '') : personalView(S.day)}`;
  }
  renderers.push(renderPlan);

  $('qsub-plan').addEventListener('click', async (ev) => {
    const s = ev.target.closest('[data-psub]'); if (s) { S.psub = s.dataset.psub; return renderPlan(); }
    const g = ev.target.closest('[data-hgrp]'); if (g) { S.habitGrp = g.dataset.hgrp; return renderPlan(); }
    const pl = ev.target.closest('[data-hplace]');
    if (pl) {
      const k = pl.dataset.hplace, name = { home: 'บ้าน', school: 'โรงเรียน', work: 'ที่ทำงาน' }[k];
      if (!confirm(`ตั้งตำแหน่งตอนนี้เป็น${name}? เปลี่ยนได้อีกครั้งหลัง 30 วัน`)) return;
      pl.disabled = true;
      try { const p = await geolocate(); await rpc('set_place', { p_kind: k, p_lat: p.lat, p_lng: p.lng }, `บันทึกตำแหน่ง${name}แล้ว`); }
      catch (e) { toast(App.errText(e), true); pl.disabled = false; }
      return;
    }
    const b = ev.target.closest('button[data-p]'); if (!b) return;
    b.disabled = true; const id = b.dataset.id;
    switch (b.dataset.p) {
      case 'chest': await rpc('claim_daily_chest', {}, (x) => `เปิดหีบ +${x.exp} EXP · ต่อเนื่อง ${x.streak} วัน`); break;
      case 'daily': await rpc('claim_daily', { p_template: id }, (x) => `+${x} EXP`); break;
      case 'monthly': await rpc('claim_monthly', { p_template: id }, (x) => `+${x} EXP`); break;
      case 'track': await rpc('claim_monthly_track', { p_step: Number(b.dataset.step) }, (x) => 'ได้รับ ' + (x || 'รางวัล')); break;
      case 'log': await rpc('log_personal', { p_pq: id, p_amount: 1 }, (x) => x && x.done ? (x.verify_status === 'pending' ? 'สำเร็จ! รอผู้ปกครองรับรอง' : `สำเร็จ! +${x.exp} EXP`) : 'บันทึกแล้ว'); break;
      case 'habit': {
        let p = { lat: null, lng: null };
        if (b.dataset.loc === '1') { try { toast('กำลังหาตำแหน่ง…'); p = await geolocate(); } catch (e) { toast(e.message, true); b.disabled = false; break; } }
        await rpc('log_habit', { p_habit: id, p_lat: p.lat, p_lng: p.lng, p_photo: null }, habitMsg); break;
      }
      case 'archive': if (confirm('เลิกเป้าหมายนี้? ช่องจะว่างให้เพิ่มเป้าหมายใหม่')) await rpc('archive_personal_quest', { p_id: id }, 'เลิกแล้ว'); else b.disabled = false; break;
    }
  });
  $('qsub-plan').addEventListener('change', async (ev) => {
    const inp = ev.target.closest('[data-hphoto]'); if (!inp || !inp.files[0]) return;
    try { toast('กำลังอัปโหลดรูป…'); const path = await upload('private-docs', S.user.id, inp.files[0], 'habit-' + inp.dataset.hphoto);
      await rpc('log_habit', { p_habit: inp.dataset.hphoto, p_lat: null, p_lng: null, p_photo: path }, habitMsg); }
    catch (e) { toast(App.errText(e), true); }
  });
  $('qsub-plan').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target; if (f.id !== 'pqForm') return;
    const ok = await rpc('create_personal_quest', { p_title: f.elements.t.value.trim(), p_category: f.elements.c.value, p_repeat: f.elements.r.value, p_target: Number(f.elements.n.value),
      p_unit: f.elements.u.value.trim() || null, p_difficulty: Number(f.elements.d.value), p_family_verify: !!(f.elements.fv && f.elements.fv.checked) }, 'เพิ่มเป้าหมายแล้ว');
    if (ok) { S.psub = 'day'; renderPlan(); }
  });
})();
