/* Real-life Quest — quest board, map radar, posting, quest detail (apply, choose, check-in, submit, confirm, review, dispute, chat). */
(() => {
  const { sb, S, CATS, RANKS, RANK_LABEL, $, esc, num, ago, when, hours, rating, toast, rpc, refresh, loaders, renderers, openSheet, closeSheet,
    distanceKm, geolocate, parseMapsLink, mapsUrl, navUrl, upload, signedUrl } = App;

  const QSTATUS = { open: 'รอคนรับ', in_progress: 'กำลังทำ', submitted: 'ส่งงานแล้ว · รอตรวจ', completed: 'สำเร็จ', cancelled: 'ยกเลิก', suspended: 'ถูกระงับ' };
  const PROF = 'username,display_name,base_level,rating_sum,rating_count,poster_rating_sum,poster_rating_count,kyc_status,frame';
  const QSEL = `*,poster:profiles!quests_poster_id_fkey(${PROF}),worker:profiles!quests_worker_id_fkey(${PROF})`;
  const nameOf = (p) => p ? (p.display_name || p.username) : '';
  const urgentLeft = (q) => q.urgent_until && q.status === 'open' ? Math.round((new Date(q.urgent_until) - Date.now()) / 60000) : 0;
  const myRankIn = (occ) => { const c = S.careers.find((x) => x.occupation === occ); return c ? c.rank : null; };
  const rankOrd = (r) => RANKS.indexOf(r);

  // What the board should tell me before I open the quest.
  function fitOf(q) {
    if (q.poster_id === S.user.id) return { ok: false, text: 'เควสต์ของคุณ' };
    if (S.profile.kyc_status !== 'verified') return { ok: false, text: 'ต้องยืนยันตัวตน' };
    const occ = S.occupations.find((o) => o.id === q.category);
    if (occ && (occ.license_required || q.rank !== 'F')) {
      const r = myRankIn(q.category);
      if (!r || rankOrd(r) < rankOrd(q.rank)) return { ok: false, text: `ต้องเป็น${occ.label} ขั้น ${q.rank} ขึ้นไป` };
    }
    return { ok: true };
  }

  loaders.quests = async function () {
    const uid = S.user.id;
    const [b, apps, w, p, h, rv] = await Promise.all([
      sb.from('quests').select(QSEL).eq('status', 'open').eq('moderation', 'approved').is('family_id', null).order('created_at', { ascending: false }).limit(100),
      sb.from('quest_applications').select('status,created_at,quest:quests(' + QSEL + ')').eq('worker_id', uid).eq('status', 'pending').order('created_at', { ascending: false }),
      sb.from('quests').select(QSEL).eq('worker_id', uid).in('status', ['in_progress', 'submitted']).order('updated_at', { ascending: false }),
      sb.from('quests').select(QSEL).eq('poster_id', uid).in('status', ['open', 'in_progress', 'submitted', 'suspended']).order('created_at', { ascending: false }),
      sb.from('quests').select(QSEL).or(`poster_id.eq.${uid},worker_id.eq.${uid}`).in('status', ['completed', 'cancelled']).order('updated_at', { ascending: false }).limit(20),
      sb.from('reviews').select('quest_id').eq('reviewer_id', uid)
    ]);
    if (b.error) throw b.error;
    S.board = b.data || [];
    S.mine = { applied: (apps.data || []).map((a) => a.quest).filter(Boolean), working: w.data || [], posted: p.data || [], history: h.data || [] };
    S.myReviews = new Set((rv.data || []).map((r) => r.quest_id));
  };

  /* ---------- cards ---------- */
  function questCard(q, ctx) {
    const c = CATS[q.category] || CATS.general, mins = urgentLeft(q), urgent = mins > 0;
    const d = S.myPos && q.approx_lat != null ? distanceKm(S.myPos, { lat: +q.approx_lat, lng: +q.approx_lng }) : null;
    let right = '';
    if (ctx === 'board') { const f = fitOf(q); right = f.ok ? `<span class="btn ${urgent ? 'urgent' : 'action'} sm">${q.instant ? 'รับทันที' : 'ดูและสมัคร'}</span>` : `<span class="small muted">${esc(f.text)}</span>`; }
    else if (ctx === 'posted' && q.status === 'open') right = `<span class="small" style="font-weight:600;color:var(--teal-ink)">${q.applicant_count} คนสมัคร</span>`;
    else if (ctx === 'history' && q.status === 'completed' && !S.myReviews.has(q.id)) right = '<span class="btn primary sm">ให้รีวิว</span>';
    else right = `<span class="small" style="font-weight:600;color:var(--ink-soft)">${esc(q.dispute_open ? 'มีข้อพิพาท' : QSTATUS[q.status])}</span>`;
    return `<button type="button" class="card q${urgent ? ' is-urgent' : ''}" data-quest="${q.id}">
      <div class="row">
        ${urgent ? `<span class="tag" style="background:var(--danger);color:#fff">ด่วน · ${mins} นาที</span>` : ''}
        <span class="tag" style="background:${c.bg};color:${c.fg}">${c.label}</span>
        <span class="rank">RANK ${esc(q.rank)}</span>
        ${q.remote ? '<span class="tag" style="background:var(--parchment-200);color:var(--ink-soft)">ออนไลน์</span>' : d != null ? `<span class="small muted">${d < 1 ? Math.round(d * 1000) + ' ม.' : d.toFixed(1) + ' กม.'}</span>` : ''}
      </div>
      <h3>${esc(q.title)}</h3>
      <span class="small muted">${ctx === 'board' || ctx === 'applied' ? esc(nameOf(q.poster)) + ' · ' + rating(q.poster && q.poster.poster_rating_sum, q.poster && q.poster.poster_rating_count) + ' · ' : ''}ประมาณ ${hours(q.est_minutes)}${q.due_at ? ' · ส่งภายใน ' + when(q.due_at) : ''}</span>
      <div class="foot dash">
        <div><span class="gold" style="font-size:18px">${num(q.reward_gold)} G</span> <span class="small muted">+${num(q.reward_exp)} EXP</span></div>
        ${right}
      </div>
    </button>`;
  }
  const list = (items, ctx, empty) => items.length ? items.map((q) => questCard(q, ctx)).join('') : `<div class="empty">${empty}</div>`;

  /* ---------- board ---------- */
  function boardItems() {
    let items = S.board.filter((q) => S.cat === 'all' || q.category === S.cat);
    if (S.near && S.myPos) items = items.filter((q) => q.remote || (q.approx_lat != null && distanceKm(S.myPos, { lat: +q.approx_lat, lng: +q.approx_lng }) <= 15));
    const dist = (q) => q.remote || q.approx_lat == null || !S.myPos ? 9999 : distanceKm(S.myPos, { lat: +q.approx_lat, lng: +q.approx_lng });
    return items.sort((a, b) => (urgentLeft(b) > 0) - (urgentLeft(a) > 0) || (S.near ? dist(a) - dist(b) : 0) || new Date(b.created_at) - new Date(a.created_at));
  }
  function renderBoard() {
    const cats = ['all', ...Object.keys(CATS).filter((k) => k !== 'family')];
    $('catFilters').innerHTML = cats.map((k) => `<button class="pill" data-cat="${k}" aria-pressed="${S.cat === k}">${k === 'all' ? 'ทั้งหมด' : CATS[k].label}</button>`).join('');
    $('nearBtn').setAttribute('aria-pressed', S.near);
    const items = boardItems();
    $('boardList').innerHTML = list(items, 'board', S.near ? 'ไม่มีเควสต์ในระยะ 15 กม. — ลองปิด "ใกล้ฉัน"' : 'ยังไม่มีเควสต์ในหมวดนี้ — ลองโพสต์เควสต์แรกดูไหม');
    $('boardList').classList.toggle('hidden', S.view === 'map');
    $('radar').classList.toggle('hidden', S.view !== 'map');
    if (S.view === 'map') drawRadar(items);
  }
  function renderMine() {
    const m = S.mine;
    $('qsub-mine').innerHTML = `
      <div class="section" style="margin-top:14px"><h2 style="font-size:17px">งานที่กำลังทำ</h2><div class="grid">${list(m.working, 'working', 'ยังไม่มีงานที่กำลังทำ')}</div></div>
      <div class="section"><h2 style="font-size:17px">งานที่สมัครไว้ · รอผู้โพสต์เลือก</h2><div class="grid">${list(m.applied, 'applied', 'ยังไม่ได้สมัครงาน')}</div></div>
      <div class="section"><h2 style="font-size:17px">เควสต์ที่ฉันโพสต์</h2><div class="grid">${list(m.posted, 'posted', 'ยังไม่ได้โพสต์เควสต์')}</div></div>
      <div class="section"><h2 style="font-size:17px">ประวัติล่าสุด</h2><div class="grid">${list(m.history, 'history', 'ยังไม่มีประวัติ')}</div></div>`;
  }
  renderers.push(renderBoard, renderMine);

  $('catFilters').onclick = (ev) => { const b = ev.target.closest('[data-cat]'); if (b) { S.cat = b.dataset.cat; renderBoard(); } };
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => {
    S.view = b.dataset.view; document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderBoard();
  }; });
  $('nearBtn').onclick = async () => {
    if (!S.near) { try { S.myPos = await geolocate(); } catch (e) { return toast(e.message, true); } }
    S.near = !S.near; renderBoard();
  };
  document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-quest]'); if (b) openQuestSheet(b.dataset.quest); });

  /* ---------- radar (OpenStreetMap via Leaflet, no paid API) ---------- */
  let L = null, map = null, layer = null;
  function loadLeaflet() {
    if (L) return Promise.resolve(L);
    return new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = () => { L = window.L; res(L); }; s.onerror = () => rej(new Error('โหลดแผนที่ไม่ได้')); document.head.appendChild(s);
    });
  }
  async function drawRadar(items) {
    try { await loadLeaflet(); } catch (e) { $('radar').innerHTML = '<div class="empty">โหลดแผนที่ไม่ได้ ใช้มุมมองรายการแทน</div>'; return; }
    if (!map) {
      map = L.map('radar', { zoomControl: true }).setView(S.myPos ? [S.myPos.lat, S.myPos.lng] : [13.7563, 100.5018], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 50);
    layer.clearLayers();
    if (S.myPos) L.circleMarker([S.myPos.lat, S.myPos.lng], { radius: 8, color: '#1f6f6b', fillColor: '#1f6f6b', fillOpacity: 0.9 }).addTo(layer).bindTooltip('คุณอยู่ที่นี่');
    const pts = [];
    items.filter((q) => q.approx_lat != null).forEach((q) => {
      const ll = [+q.approx_lat, +q.approx_lng]; pts.push(ll);
      const urgent = urgentLeft(q) > 0;
      // Approximate area only (about 1 km); the exact pin is shown to the chosen worker.
      L.circle(ll, { radius: 600, color: urgent ? '#b3261e' : '#8a5a0b', fillColor: urgent ? '#b3261e' : '#e8b13a', fillOpacity: 0.25, weight: 2 })
        .addTo(layer).bindPopup(`<b>${esc(q.title)}</b><br>${num(q.reward_gold)} G · RANK ${esc(q.rank)}<br><a href="#quest-${q.id}">ดูรายละเอียด</a>`);
    });
    if (pts.length && !S.myPos) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
  }

  /* ---------- post a quest ---------- */
  function postForm() {
    const occs = S.occupations;
    return `<form id="postForm" class="stack">
      <label class="f">ชื่องาน<input name="title" required minlength="4" maxlength="120" placeholder="เช่น ส่งเอกสารด่วนไปสีลม"></label>
      <label class="f">รายละเอียด<textarea name="desc" rows="3" maxlength="2000" placeholder="บอกสิ่งที่ต้องทำ เครื่องมือที่ต้องใช้ จุดนัดพบ"></textarea></label>
      <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
        <label class="f">อาชีพที่ต้องการ<select name="cat"><option value="general">ทั่วไป (ใครก็รับได้)</option>${occs.map((o) => `<option value="${o.id}">${esc(o.label)}${o.license_required ? ' · ต้องมีใบอนุญาต' : ''}</option>`).join('')}</select></label>
        <label class="f">ขั้นขั้นต่ำของผู้รับ<select name="rank">${RANKS.slice(0, 6).map((r) => `<option value="${r}">${r} · ${RANK_LABEL[r]}</option>`).join('')}</select></label>
        <label class="f">รางวัล (G) — ล็อกจากกระเป๋าคุณ<input name="gold" type="number" min="1" step="1" required inputmode="numeric"></label>
        <label class="f">เวลาทำโดยประมาณ (นาที)<input name="est" type="number" min="10" max="10080" step="5" value="60" required inputmode="numeric"></label>
        <label class="f">ต้องเสร็จภายใน (ไม่บังคับ)<input name="due" type="datetime-local"></label>
        <label class="f">ด่วน (นาที, ไม่บังคับ)<input name="urgent" type="number" min="10" max="1440" step="5" inputmode="numeric" placeholder="เช่น 60"></label>
      </div>
      <label class="row small"><input type="checkbox" name="instant" style="width:20px;height:20px"> รับงานทันที — คนแรกที่ผ่านเงื่อนไขได้งานเลย (ไม่ต้องเลือกผู้สมัคร)</label>
      <fieldset class="card stack" style="margin:0"><legend class="small" style="font-weight:600;padding:0 6px">สถานที่ทำงาน</legend>
        <label class="row small"><input type="checkbox" name="remote" style="width:20px;height:20px"> งานออนไลน์ ไม่ต้องไปหน้างาน</label>
        <div id="locBox" class="stack">
          <div class="row"><button class="btn sec sm" type="button" id="useHere">ใช้ตำแหน่งปัจจุบัน</button><span class="small muted">หรือวางลิงก์ Google Maps / พิกัด</span></div>
          <label class="f">ลิงก์ Google Maps หรือ "ละติจูด, ลองจิจูด"<input name="maps" placeholder="https://maps.google.com/... หรือ 13.7563, 100.5018"></label>
          <label class="f">ที่อยู่/จุดสังเกต (เห็นเฉพาะผู้รับงานที่คุณเลือก)<input name="addr" maxlength="300" placeholder="เช่น ตึก A ชั้น 3 หน้าลิฟต์"></label>
          <span class="small" id="locMsg" style="color:var(--teal-ink)"></span>
        </div>
      </fieldset>
      <p class="small muted" id="postNote" style="margin:0"></p>
      <button class="btn primary" type="submit" id="postSubmit">โพสต์เควสต์</button>
      <p class="small muted" style="margin:0">บนกระดานจะแสดงแค่ย่านโดยประมาณ (~1 กม.) ตำแหน่งจริงเปิดให้เฉพาะผู้รับงาน · ทั่วไป = ขั้น F ใครก็รับได้ที่ยืนยันตัวตนแล้ว</p>
    </form>`;
  }
  function openPost() {
    if (S.profile.kyc_status !== 'verified') { toast('ต้องยืนยันตัวตนก่อนโพสต์งาน', true); return App.openKyc(); }
    openSheet('โพสต์เควสต์ใหม่', postForm());
    const f = $('postForm'); let pos = null;
    const note = () => {
      const r = Number(f.elements.gold.value || 0), th = Number(S.settings.review_reward_threshold || 5000), g = Number(S.wallet.gold), fee = Number(S.settings.platform_fee_pct || 0);
      $('postNote').textContent = r > g ? 'Gold ไม่พอ — มีอยู่ ' + num(g) + ' G (เติมได้ที่กระเป๋า)'
        : r >= th ? 'รางวัลตั้งแต่ ' + num(th) + ' G ต้องรอผู้ตรวจอนุมัติก่อนขึ้นกระดาน'
        : r > 0 ? `ผู้รับงานได้ ${num(Math.floor(r * (100 - fee) / 100))} G${fee ? ` (หักค่าธรรมเนียม ${fee}%)` : ''} · ระบบจ่ายให้อัตโนมัติ ${S.settings.auto_release_hours || 72} ชม. หลังส่งงานถ้าคุณไม่ตอบ` : '';
    };
    const sync = () => { $('locBox').classList.toggle('hidden', f.elements.remote.checked); f.elements.rank.disabled = f.elements.cat.value === 'general'; if (f.elements.cat.value === 'general') f.elements.rank.value = 'F'; };
    f.elements.gold.oninput = note; f.elements.remote.onchange = sync; f.elements.cat.onchange = sync; sync(); note();
    f.elements.maps.oninput = () => { const p = parseMapsLink(f.elements.maps.value); pos = p || pos; $('locMsg').textContent = p ? `ปักหมุดแล้ว ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : f.elements.maps.value ? 'อ่านพิกัดจากลิงก์นี้ไม่ได้ — ลิงก์ย่อ (maps.app.goo.gl) ให้เปิดก่อนแล้วคัดลอกลิงก์เต็ม' : ''; };
    $('useHere').onclick = async () => { try { pos = await geolocate(); f.elements.maps.value = pos.lat.toFixed(6) + ', ' + pos.lng.toFixed(6); $('locMsg').textContent = `ปักหมุดตำแหน่งปัจจุบันแล้ว (แม่นยำ ~${Math.round(pos.acc)} ม.)`; } catch (e) { toast(e.message, true); } };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const remote = f.elements.remote.checked;
      if (!remote && !pos) return toast('ปักหมุดตำแหน่งงานก่อน หรือเลือกงานออนไลน์', true);
      $('postSubmit').disabled = true;
      const id = await rpc('post_quest_v2', {
        p_title: f.elements.title.value.trim(), p_description: f.elements.desc.value.trim() || null, p_category: f.elements.cat.value, p_rank: f.elements.rank.value,
        p_reward_gold: Number(f.elements.gold.value), p_est_minutes: Number(f.elements.est.value), p_due_at: f.elements.due.value ? new Date(f.elements.due.value).toISOString() : null,
        p_urgent_minutes: f.elements.urgent.value ? Number(f.elements.urgent.value) : null, p_instant: f.elements.instant.checked, p_remote: remote,
        p_lat: remote ? null : pos.lat, p_lng: remote ? null : pos.lng, p_address: remote ? null : f.elements.addr.value.trim() || null
      }, 'โพสต์เควสต์แล้ว');
      $('postSubmit') && ($('postSubmit').disabled = false);
      if (id) { closeSheet(); App.setQsub('mine'); }
    };
  }
  $('openPost').onclick = openPost;

  /* ---------- quest detail ---------- */
  async function loadDetail(id) {
    const [q, loc, apps, ses, msgs, dis, revs, elig] = await Promise.all([
      sb.from('quests').select(QSEL).eq('id', id).maybeSingle(),
      sb.from('quest_locations').select('*').eq('quest_id', id).maybeSingle(),
      sb.from('quest_applications').select('worker_id,note,status,created_at,w:profiles!quest_applications_worker_id_fkey(' + PROF + ')').eq('quest_id', id).order('created_at'),
      sb.from('work_sessions').select('*').eq('quest_id', id).order('started_at'),
      sb.from('messages').select('*').eq('quest_id', id).order('created_at').limit(200),
      sb.from('disputes').select('*').eq('quest_id', id).order('created_at', { ascending: false }),
      sb.from('reviews').select('*').eq('quest_id', id),
      sb.rpc('quest_eligibility', { p_quest: id })
    ]);
    return { q: q.data, loc: loc.data, apps: apps.data || [], ses: ses.data || [], msgs: msgs.data || [], dis: dis.data || [], revs: revs.data || [], elig: elig.data };
  }

  function workerCareerLine(p, occ) { return p ? `Lv.${p.base_level} · ${rating(p.rating_sum, p.rating_count)}` : ''; }

  function detailHtml(D) {
    const q = D.q, me = S.user.id, isPoster = q.poster_id === me, isWorker = q.worker_id === me, c = CATS[q.category] || CATS.general;
    const myApp = D.apps.find((a) => a.worker_id === me), open = D.ses.find((s) => !s.ended_at), dispute = D.dis.find((d) => d.status === 'open');
    const fee = Number(S.settings.platform_fee_pct || 0), mins = urgentLeft(q);
    const parts = [];

    parts.push(`<div class="card stack">
      <div class="row">${mins > 0 ? `<span class="tag" style="background:var(--danger);color:#fff">ด่วน · ${mins} นาที</span>` : ''}
        <span class="tag" style="background:${c.bg};color:${c.fg}">${c.label}</span><span class="rank">RANK ${esc(q.rank)}</span>
        <span class="small" style="margin-left:auto;font-weight:600">${esc(q.dispute_open ? 'มีข้อพิพาท · รอทีมงานตัดสิน' : QSTATUS[q.status])}</span></div>
      ${q.description ? `<p style="margin:0;white-space:pre-line">${esc(q.description)}</p>` : ''}
      <dl class="kv">
        <div><dt>รางวัล</dt><dd class="gold" style="font-size:18px">${num(q.reward_gold)} G</dd></div>
        <div><dt>EXP</dt><dd>+${num(q.reward_exp)}</dd></div>
        <div><dt>เวลาโดยประมาณ</dt><dd>${hours(q.est_minutes)}</dd></div>
        <div><dt>ส่งภายใน</dt><dd>${q.due_at ? when(q.due_at) : 'ไม่กำหนด'}</dd></div>
        <div><dt>ผู้โพสต์</dt><dd>${esc(nameOf(q.poster))} <span class="small muted">${rating(q.poster && q.poster.poster_rating_sum, q.poster && q.poster.poster_rating_count)}</span></dd></div>
        <div><dt>ผู้รับงาน</dt><dd>${q.worker ? esc(nameOf(q.worker)) : q.instant ? 'คนแรกที่กดรับ' : q.applicant_count + ' คนสมัคร'}</dd></div>
      </dl>
      ${fee && (isWorker || isPoster) ? `<span class="small muted">ผู้รับงานได้สุทธิ ${num(Math.floor(q.reward_gold * (100 - fee) / 100))} G หลังหักค่าธรรมเนียม ${fee}%</span>` : ''}
    </div>`);

    // Location: approximate area for everyone, exact pin for the parties.
    if (q.remote) parts.push('<div class="card small">งานออนไลน์ — ไม่ต้องไปหน้างาน (เช็กอินเพื่อเริ่มจับเวลาทำงาน)</div>');
    else if (D.loc) parts.push(`<div class="card stack"><b>ตำแหน่งหน้างาน</b>${D.loc.address ? `<span>${esc(D.loc.address)}</span>` : ''}
      <span class="small muted">${D.loc.lat.toFixed(5)}, ${D.loc.lng.toFixed(5)}${S.myPos ? ' · ห่างจากคุณ ' + distanceKm(S.myPos, D.loc).toFixed(1) + ' กม.' : ''}</span>
      <div class="row"><a class="btn action sm" href="${navUrl(D.loc.lat, D.loc.lng)}" target="_blank" rel="noopener">นำทางด้วย Google Maps</a>
      <a class="btn sec sm" href="${mapsUrl(D.loc.lat, D.loc.lng)}" target="_blank" rel="noopener">ดูหมุด</a></div></div>`);
    else if (q.approx_lat != null) parts.push(`<div class="card stack"><b>ย่านโดยประมาณ</b><span class="small muted">ตำแหน่งจริงเปิดให้เมื่อคุณได้รับงาน${S.myPos ? ' · ห่างประมาณ ' + distanceKm(S.myPos, { lat: +q.approx_lat, lng: +q.approx_lng }).toFixed(1) + ' กม.' : ''}</span>
      <a class="btn sec sm" href="${mapsUrl(q.approx_lat, q.approx_lng)}" target="_blank" rel="noopener" style="align-self:flex-start">ดูย่านบน Google Maps</a></div>`);

    // Actions for a visitor or applicant.
    if (!isPoster && !isWorker && q.status === 'open') {
      if (myApp && myApp.status === 'pending') parts.push(`<div class="card stack"><b>คุณสมัครงานนี้แล้ว</b><span class="small muted">รอผู้โพสต์เลือก — จะแจ้งเตือนเมื่อได้งาน</span><button class="btn sec" data-a="withdraw">ถอนใบสมัคร</button></div>`);
      else if (D.elig && D.elig.ok) parts.push(`<form class="card stack" data-form="apply">
        ${q.instant ? '<b>งานนี้รับได้ทันที</b><span class="small muted">กดแล้วได้งานเลย ไปหน้างานแล้วเช็กอินเพื่อเริ่มนับเวลา</span>'
          : '<label class="f">แนะนำตัวสั้น ๆ ให้ผู้โพสต์ (ไม่บังคับ)<input name="note" maxlength="300" placeholder="เช่น อยู่ใกล้ ไปถึงใน 20 นาที มีเครื่องมือครบ"></label>'}
        <button class="btn ${mins > 0 ? 'urgent' : 'action'}" type="submit">${q.instant ? 'รับงานนี้' : 'สมัครงานนี้'}</button></form>`);
      else {
        const r = D.elig && D.elig.reason;
        const occ = S.occupations.find((o) => o.id === q.category);
        const why = { 'identity not verified': 'ต้องยืนยันตัวตนก่อนรับงาน', 'career rank too low': `งานนี้ต้องเป็น${occ ? occ.label : ''} ขั้น ${q.rank} (${RANK_LABEL[q.rank]}) ขึ้นไป`,
          'account banned': 'บัญชีของคุณถูกระงับชั่วคราว', 'family only': 'เฉพาะลูกในบ้านนี้' }[r] || App.errText({ message: r || '' });
        parts.push(`<div class="card stack" style="border-color:var(--danger)"><b>${esc(why)}</b>
          ${r === 'identity not verified' ? '<button class="btn primary" data-a="kyc">ยืนยันตัวตน</button>' : ''}
          ${r === 'career rank too low' ? `<span class="small muted">ขั้นของคุณในอาชีพนี้: ${myRankIn(q.category) || 'ยังไม่เริ่ม'} · เริ่มอาชีพหรือเทียบโอนประสบการณ์ได้ที่แท็บตัวละคร</span><a class="btn sec" href="#career">ไปหน้าอาชีพ</a>` : ''}</div>`);
      }
      parts.push('<button class="btn sec sm" data-a="report" style="align-self:flex-start">รายงานเควสต์นี้</button>');
    }

    // Poster choosing among applicants.
    if (isPoster && q.status === 'open') {
      const pend = D.apps.filter((a) => a.status === 'pending');
      parts.push(`<div class="card stack"><b>ผู้สมัคร (${pend.length})</b>${pend.length ? pend.map((a) => `<div class="tx" style="flex-wrap:wrap">
        <div style="flex:1 1 200px;min-width:0"><b style="font-weight:600">${esc(nameOf(a.w))}</b> <span class="small muted">${workerCareerLine(a.w)}</span>
          ${a.note ? `<div class="small" style="color:var(--ink-soft)">${esc(a.note)}</div>` : ''}<div class="small muted">สมัคร ${ago(a.created_at)}</div></div>
        <button class="btn action sm" data-a="choose" data-w="${a.worker_id}">เลือกคนนี้</button></div>`).join('') : '<span class="small muted">ยังไม่มีคนสมัคร — ระบบจะแจ้งเตือนเมื่อมีคนสมัคร</span>'}
        <button class="btn sec" data-a="cancel">ยกเลิกเควสต์ (คืน Gold)</button></div>`);
    }

    // Work sessions (check-in and out).
    if ((isWorker || isPoster) && q.worker_id) {
      const total = D.ses.reduce((s, x) => s + (x.minutes || 0), 0);
      parts.push(`<div class="card stack"><div class="row between"><b>บันทึกเวลาทำงาน</b><span class="small muted">รวม ${hours(total)}</span></div>
        ${D.ses.length ? D.ses.map((s) => `<div class="tx"><div style="flex:1">${when(s.started_at)} → ${s.ended_at ? when(s.ended_at) : '<b style="color:var(--teal-ink)">กำลังทำ</b>'}</div>
          <span class="small muted">${s.ended_at ? hours(s.minutes) : ''}</span>${s.start_photo || s.end_photo ? `<button class="btn sec sm" data-a="photos" data-s="${s.id}">รูป</button>` : ''}</div>`).join('') : '<span class="small muted">ยังไม่ได้เช็กอิน</span>'}
        ${isWorker && q.status === 'in_progress' && !q.dispute_open ? `<label class="f">แนบรูปหน้างาน (ไม่บังคับ)<input type="file" accept="image/*" capture="environment" id="sesPhoto"></label>
          ${open ? '<button class="btn action" data-a="checkout">เช็กเอาต์ · หยุดนับเวลา</button>' : `<button class="btn action" data-a="checkin">${q.remote ? 'เริ่มทำงาน · เริ่มนับเวลา' : 'เช็กอินหน้างาน'}</button>`}
          ${!q.remote ? `<span class="small muted">ต้องอยู่ห่างหน้างานไม่เกิน ${num(S.settings.checkin_radius_m || 300)} ม.</span>` : ''}` : ''}
      </div>`);
    }

    if (isWorker && q.status === 'in_progress' && !q.dispute_open) parts.push(`<div class="row">
      <button class="btn primary" data-a="submit" ${open || !D.ses.length ? 'disabled' : ''}>ส่งงาน</button>
      <button class="btn sec" data-a="abandon">คืนงาน</button>
      ${open || !D.ses.length ? '<span class="small muted">เช็กอินและเช็กเอาต์อย่างน้อย 1 ครั้งก่อนส่งงาน</span>' : ''}</div>`);
    if (isWorker && q.status === 'submitted') parts.push(`<div class="card small">ส่งงานแล้ว — ถ้าผู้โพสต์ไม่ตอบ ระบบจะจ่ายให้อัตโนมัติ ${q.auto_release_at ? when(q.auto_release_at) : ''}</div>`);
    if (isPoster && q.status === 'submitted' && !q.dispute_open) parts.push(`<div class="card stack" style="border-color:var(--gold-500)"><b>ผู้รับงานส่งงานแล้ว</b>
      <span class="small muted">ตรวจงานแล้วกดยืนยัน หรือเปิดข้อพิพาทถ้ามีปัญหา · ระบบจะจ่ายอัตโนมัติ ${q.auto_release_at ? when(q.auto_release_at) : ''}</span>
      <button class="btn primary" data-a="confirm">ยืนยันงานเสร็จ · จ่าย ${num(q.reward_gold)} G</button></div>`);
    if (isPoster && q.status === 'in_progress' && !q.dispute_open) parts.push(`<button class="btn sec" data-a="cancel">ยกเลิกงาน${q.due_at && new Date(q.due_at) < Date.now() ? ' (ผู้รับงานไม่มา/เลยกำหนด)' : ''}</button>`);

    // Disputes.
    if (dispute) parts.push(`<div class="card stack" style="border-color:var(--danger)"><b>ข้อพิพาท · รอทีมงานตัดสิน</b>
      <span class="small">${esc(dispute.reason)}</span><span class="small muted">เปิดเมื่อ ${when(dispute.created_at)} · หลักฐาน ${dispute.evidence.length} ไฟล์</span>
      <label class="f">เพิ่มหลักฐาน (รูป/PDF)<input type="file" accept="image/*,application/pdf" id="evFile"></label><button class="btn sec sm" data-a="evidence" data-d="${dispute.id}">อัปโหลดหลักฐาน</button></div>`);
    D.dis.filter((d) => d.status === 'resolved').forEach((d) => parts.push(`<div class="card small"><b>ผลข้อพิพาท:</b> ผู้รับงานได้ ${d.worker_pct}% · ${esc(d.resolution_note || '')}</div>`));
    if ((isPoster || isWorker) && ['in_progress', 'submitted'].includes(q.status) && !q.dispute_open) parts.push(`<details class="card"><summary class="small" style="cursor:pointer;font-weight:600">มีปัญหา? เปิดข้อพิพาท</summary>
      <form class="stack" data-form="dispute" style="margin-top:10px"><label class="f">เล่าปัญหา<textarea name="reason" rows="3" required minlength="5" maxlength="1000"></textarea></label>
      <label class="f">แนบหลักฐาน (ไม่บังคับ)<input type="file" name="file" accept="image/*,application/pdf"></label>
      <span class="small muted">Gold ที่ล็อกไว้จะถูกพักไว้จนทีมงานตัดสิน ทีมงานอ่านแชตได้</span><button class="btn danger" type="submit">เปิดข้อพิพาท</button></form></details>`);

    // Reviews.
    if (q.status === 'completed' && (isPoster || isWorker)) {
      const mine = D.revs.find((r) => r.reviewer_id === me), theirs = D.revs.find((r) => r.reviewer_id !== me);
      const closed = q.completed_at && Date.now() - new Date(q.completed_at) > 14 * 864e5;
      parts.push(`<div class="card stack"><b>รีวิว</b>
        ${theirs ? `<span>${'★'.repeat(theirs.stars)}${'☆'.repeat(5 - theirs.stars)} <span class="small muted">จาก${isPoster ? 'ผู้รับงาน' : 'ผู้โพสต์'}</span></span>${theirs.comment ? `<span class="small">${esc(theirs.comment)}</span>` : ''}` : ''}
        ${mine ? `<span class="small muted">คุณให้ ${mine.stars} ดาวแล้ว</span>` : closed ? '<span class="small muted">เลยเวลารีวิว 14 วันแล้ว</span>' : `<form class="stack" data-form="review">
          <div class="row" role="radiogroup" aria-label="ให้ดาว">${[1, 2, 3, 4, 5].map((n) => `<label class="pill" style="display:inline-flex;align-items:center;gap:4px"><input type="radio" name="stars" value="${n}" ${n === 5 ? 'checked' : ''}> ${n} ★</label>`).join('')}</div>
          <label class="f">ความเห็น (ไม่บังคับ)<input name="comment" maxlength="500"></label>
          <span class="small muted">${isPoster ? 'รีวิวของคุณนับเข้าคะแนนอาชีพของผู้รับงาน ใช้เลื่อนขั้น' : 'รีวิวผู้โพสต์ช่วยให้คนอื่นเลือกงานได้ปลอดภัย'}</span>
          <button class="btn primary" type="submit">ส่งรีวิว</button></form>`}</div>`);
    }

    // Chat between the two parties (staff joins during a dispute).
    if ((isPoster || isWorker) && q.worker_id) {
      parts.push(`<div class="card stack"><b>แชตงานนี้</b><div class="chat" id="chatBox">${D.msgs.length ? D.msgs.map((m) =>
        `<div class="msg ${m.is_staff ? 'staff' : m.sender_id === me ? 'me' : 'them'}">${m.is_staff ? '<b>ทีมงาน:</b> ' : ''}${esc(m.body)}<div class="small muted" style="${m.is_staff ? 'color:var(--on-wood-muted)' : ''}">${ago(m.created_at)}</div></div>`).join('')
        : '<span class="small muted center">เริ่มคุยกันได้เลย — ห้ามแชร์รหัส OTP หรือชวนจ่ายเงินนอกแอป</span>'}</div>
        ${['in_progress', 'submitted', 'completed'].includes(q.status) ? `<form class="row" data-form="chat"><input name="body" required maxlength="1000" autocomplete="off" placeholder="พิมพ์ข้อความ" style="flex:1;border:1.5px solid var(--brass-600);border-radius:10px;padding:10px;min-height:44px;background:#fffdf6"><button class="btn action" type="submit">ส่ง</button></form>` : ''}</div>`);
    }
    return '<div class="stack">' + parts.join('') + '</div>';
  }

  let current = null;
  async function openQuestSheet(id) {
    S.openQuest = id;
    if (location.hash !== '#quest-' + id) history.replaceState(null, '', '#quest-' + id);
    openSheet('กำลังโหลด…', '<div class="empty">กำลังโหลด…</div>');
    await refreshQuestSheet();
  }
  async function refreshQuestSheet() {
    const id = S.openQuest; if (!id) return;
    const D = await loadDetail(id);
    if (S.openQuest !== id) return;
    if (!D.q) { $('sheetTitle').textContent = 'ไม่พบเควสต์'; $('sheetBody').innerHTML = '<div class="empty">เควสต์นี้ถูกปิดหรือคุณไม่มีสิทธิ์ดู</div>'; return; }
    current = D;
    const draft = $('sheetBody').querySelector('[data-form="chat"] input');
    const keep = draft ? draft.value : '';
    $('sheetTitle').textContent = D.q.title; $('sheetBody').innerHTML = detailHtml(D);
    const cb = $('chatBox'); if (cb) cb.scrollTop = cb.scrollHeight;
    const nd = $('sheetBody').querySelector('[data-form="chat"] input'); if (nd && keep) nd.value = keep;
  }

  async function sessionPhoto(q) {
    const f = $('sesPhoto') && $('sesPhoto').files[0];
    return f ? await upload('quest-media', `${q.id}/${S.user.id}`, f, 'site') : null;
  }
  async function here(q) {
    if (q.remote) return { lat: null, lng: null };
    const p = await geolocate(); S.myPos = p; return p;
  }

  $('sheetBody').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-a]'); if (!b || !current || !S.openQuest) return;
    const q = current.q, a = b.dataset.a;
    b.disabled = true;
    try {
      if (a === 'withdraw') await rpc('withdraw_application', { p_quest: q.id }, 'ถอนใบสมัครแล้ว');
      if (a === 'kyc') { closeSheet(); App.openKyc(); return; }
      if (a === 'report') {
        const reason = prompt('รายงานเควสต์นี้เพราะอะไร? (เช่น เสี่ยงหลอกลวง, ผิดกฎหมาย, ข้อมูลไม่ครบ)');
        if (reason && reason.trim().length >= 3) await rpc('report_quest', { p_quest: q.id, p_reason: reason.trim() }, 'ส่งรายงานแล้ว ทีมงานจะตรวจสอบ');
      }
      if (a === 'choose' && confirm('เลือกผู้สมัครคนนี้? ผู้สมัครคนอื่นจะได้รับแจ้งว่าไม่ได้งาน')) await rpc('choose_worker', { p_quest: q.id, p_worker: b.dataset.w }, 'เลือกผู้รับงานแล้ว');
      if (a === 'cancel' && confirm(q.status === 'open' ? 'ยกเลิกเควสต์นี้? Gold ที่ล็อกไว้จะคืนเข้ากระเป๋า' : 'ยกเลิกงานที่มอบไปแล้ว? ทำได้เฉพาะเมื่อผู้รับงานยังไม่เคยเช็กอิน — ถ้าเลยกำหนดจะนับว่าผู้รับงานไม่มา')) await rpc('cancel_quest', { p_quest: q.id }, 'ยกเลิกแล้ว คืน Gold ให้แล้ว');
      if (a === 'checkin') { toast('กำลังหาตำแหน่ง…'); const p = await here(q); const photo = await sessionPhoto(q); await rpc('check_in', { p_quest: q.id, p_lat: p.lat, p_lng: p.lng, p_photo: photo }, 'เช็กอินแล้ว เริ่มนับเวลา'); }
      if (a === 'checkout') { toast('กำลังหาตำแหน่ง…'); const p = await here(q).catch(() => ({ lat: null, lng: null })); const photo = await sessionPhoto(q); await rpc('check_out', { p_quest: q.id, p_lat: p.lat, p_lng: p.lng, p_photo: photo }, (m) => 'เช็กเอาต์แล้ว · ' + hours(m)); }
      if (a === 'submit' && confirm('ส่งงานให้ผู้โพสต์ตรวจ?')) await rpc('submit_quest', { p_quest: q.id }, 'ส่งงานแล้ว รอผู้โพสต์ยืนยัน');
      if (a === 'abandon' && confirm('คืนงานนี้? เควสต์จะกลับขึ้นกระดาน และนับในประวัติของคุณ')) { const ok = await rpc('abandon_quest', { p_quest: q.id }, 'คืนงานแล้ว'); if (ok) closeSheet(); return; }
      if (a === 'confirm' && confirm('ยืนยันว่างานเสร็จ? Gold ที่ล็อกไว้จะโอนให้ผู้รับงานทันที')) await rpc('confirm_quest', { p_quest: q.id }, 'โอนรางวัลแล้ว — อย่าลืมรีวิว');
      if (a === 'evidence') {
        const f = $('evFile').files[0]; if (!f) return toast('เลือกไฟล์ก่อน', true);
        const path = await upload('quest-media', `${q.id}/${S.user.id}`, f, 'evidence');
        await rpc('add_dispute_evidence', { p_dispute: b.dataset.d, p_path: path }, 'เพิ่มหลักฐานแล้ว');
      }
      if (a === 'photos') {
        const s = current.ses.find((x) => String(x.id) === b.dataset.s);
        const urls = await Promise.all([s.start_photo, s.end_photo].map((p) => signedUrl('quest-media', p)));
        urls.filter(Boolean).forEach((u) => window.open(u, '_blank', 'noopener'));
      }
    } catch (e) { toast(App.errText(e), true); }
    finally { if (b.isConnected) b.disabled = false; }
  });

  $('sheetBody').addEventListener('submit', async (ev) => {
    const f = ev.target.closest('form[data-form]'); if (!f || !current || !S.openQuest) return;
    ev.preventDefault();
    const q = current.q, kind = f.dataset.form, btn = f.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      if (kind === 'apply') {
        const r = await rpc('apply_quest', { p_quest: q.id, p_note: f.elements.note ? f.elements.note.value.trim() || null : null }, (s) => s === 'assigned' ? 'ได้งานแล้ว! ไปหน้างานแล้วเช็กอิน' : 'สมัครแล้ว รอผู้โพสต์เลือก');
        if (r === 'assigned' && !q.remote) geolocate().then((p) => { S.myPos = p; }).catch(() => {});
      }
      if (kind === 'dispute') {
        const file = f.elements.file.files[0];
        const ev1 = file ? [await upload('quest-media', `${q.id}/${S.user.id}`, file, 'evidence')] : [];
        await rpc('open_dispute', { p_quest: q.id, p_reason: f.elements.reason.value.trim(), p_evidence: ev1 }, 'เปิดข้อพิพาทแล้ว ทีมงานจะติดต่อในแชต');
      }
      if (kind === 'review') await rpc('submit_review', { p_quest: q.id, p_stars: Number(f.elements.stars.value), p_comment: f.elements.comment.value.trim() || null }, 'ขอบคุณสำหรับรีวิว');
      if (kind === 'chat') {
        const body = f.elements.body.value.trim(); if (!body) return;
        const { error } = await sb.rpc('send_message', { p_quest: q.id, p_body: body });
        if (error) toast(App.errText(error), true); else { f.elements.body.value = ''; refreshQuestSheet(); }
      }
    } catch (e) { toast(App.errText(e), true); }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  });

  Object.assign(App, { openQuestSheet, refreshQuestSheet, questCard, QSTATUS, QSEL, nameOf });
})();
