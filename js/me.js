/* Real-life Quest — character (level, stats, equipment), identity check, career ranks, job-card deck. */
(() => {
  const { sb, S, CATS, tier, tierTag, RANKS, RANK_LABEL, $, esc, num, when, hours, rating, toast, rpc, refresh, loaders, renderers, openSheet, closeSheet, upload } = App;
  const STATS = [['str', 'STR'], ['agi', 'AGI'], ['vit', 'VIT'], ['int', 'INT'], ['dex', 'DEX'], ['luk', 'LUK']];
  const SLOTS = [['head', 'หมวก'], ['body', 'เสื้อ'], ['feet', 'รองเท้า'], ['tool', 'เครื่องมือ'], ['acc', 'เครื่องประดับ'], ['frame', 'กรอบโปรไฟล์']];

  function levelInfo(exp) {
    const lv = Math.floor(Math.sqrt(exp / 250)) + 1, from = 250 * (lv - 1) ** 2, to = 250 * lv ** 2;
    return { lv, cur: exp - from, need: to - from, pct: Math.round(((exp - from) / (to - from)) * 100) };
  }

  loaders.careers = async function () {
    const [c, pr, im] = await Promise.all([
      sb.rpc('my_careers'),
      sb.from('promotion_requests').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10),
      sb.from('career_imports').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10)
    ]);
    S.careers = c.data || []; S.promos = pr.data || []; S.imports = im.data || [];
  };
  loaders.cards = async function () {
    const uid = S.user.id;
    const [c, mine, d, done] = await Promise.all([
      sb.from('job_cards').select('*').order('sort'),
      sb.from('user_cards').select('card_id').eq('user_id', uid),
      sb.from('decks').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('quests').select('category').eq('worker_id', uid).eq('status', 'completed')
    ]);
    S.cards = c.data || []; S.myCards = new Set((mine.data || []).map((r) => r.card_id)); S.deck = d.data;
    S.doneByCat = {}; (done.data || []).forEach((q) => { S.doneByCat[q.category] = (S.doneByCat[q.category] || 0) + 1; });
  };

  const cardById = (id) => S.cards.find((c) => c.id === id);
  function deckBonus() {
    const b = {}; if (!S.deck) return b;
    ['main_card', 'support1', 'support2', 'support3'].forEach((k) => { const c = cardById(S.deck[k]); if (c) Object.entries(c.stats || {}).forEach(([s, v]) => { b[s] = (b[s] || 0) + v; }); });
    return b;
  }
  function radarSvg(vals) {
    const n = 6, R = 80, cx = 100, cy = 100, max = Math.max(10, ...vals);
    const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const ring = (f) => Array.from({ length: n }, (_, i) => pt(i, R * f).join(',')).join(' ');
    const poly = vals.map((v, i) => pt(i, R * v / max).join(',')).join(' ');
    return `<svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="กราฟค่าสถานะ">
      ${[0.33, 0.66, 1].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="#d8c39a" stroke-width="1"/>`).join('')}
      <polygon points="${poly}" fill="rgba(31,111,107,.35)" stroke="#1f6f6b" stroke-width="2"/>
      ${STATS.map(([, L], i) => { const [x, y] = pt(i, R + 14); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="700" fill="#6b5540" font-family="Cinzel,serif">${L}</text>`; }).join('')}
    </svg>`;
  }

  /* ---------- careers ---------- */
  const gate = (ok, label) => `<li style="display:flex;gap:6px;align-items:flex-start"><span aria-hidden="true" style="color:${ok ? 'var(--teal-600)' : 'var(--ink-muted)'};font-weight:700">${ok ? '✓' : '○'}</span><span>${label}</span></li>`;
  function careerCard(c) {
    const occ = S.occupations.find((o) => o.id === c.occupation) || { label: c.occupation };
    if (!c.next) return `<div class="card stack"><div class="row between"><b>${esc(occ.label)}</b><span class="rank">RANK ${c.rank}</span></div><span class="small">${esc(c.rank_label)} — ขั้นสูงสุดแล้ว</span></div>`;
    const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 100;
    const timeOk = c.months_in_rank >= c.min_months;
    return `<div class="card stack">
      <div class="row between"><b style="font-size:16px">${esc(occ.label)}</b><span class="rank">RANK ${c.rank} · ${esc(c.rank_label)}</span></div>
      <span class="small muted">อยู่ขั้นนี้ ${c.months_in_rank} เดือน · ขั้นต่อไป ${c.next} (${esc(c.next_label)})${c.imported ? ' · เทียบโอนประสบการณ์แล้ว' : ''}</span>
      <div class="bar" role="progressbar" aria-label="ความคืบหน้าเลื่อนขั้น" aria-valuenow="${pct(c.jobs, c.jobs_needed)}" aria-valuemax="100"><div style="width:${pct(c.jobs, c.jobs_needed)}%;background:var(--teal-600)"></div></div>
      <ul class="small" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px">
        ${gate(timeOk, `อยู่ในขั้นนี้ครบ ${c.min_months} เดือน${timeOk ? '' : ' · เร็วสุด ' + new Date(c.earliest).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })}`)}
        ${gate(c.jobs >= c.jobs_needed, `งานสำเร็จ ${num(c.jobs)} / ${num(c.jobs_needed)} งาน`)}
        ${gate(c.minutes >= c.minutes_needed, `ชั่วโมงทำงานที่เช็กอินจริง ${num(Math.floor(c.minutes / 60))} / ${num(Math.floor(c.minutes_needed / 60))} ชม.`)}
        ${gate(c.rating_count && c.rating >= c.min_rating, `คะแนนเฉลี่ย ${c.rating_count ? Number(c.rating).toFixed(2) : '—'} / ต้อง ${c.min_rating} ขึ้นไป`)}
        ${c.endorsements_needed ? gate(c.endorsements >= c.endorsements_needed, `คำรับรองจากขั้น ${c.endorser_min_rank}+ ${c.endorsements} / ${c.endorsements_needed} คน`) : ''}
        ${c.committee ? gate(false, 'ส่งผลงานให้คณะกรรมการพิจารณา') : ''}
      </ul>
      ${c.pending_request ? '<span class="small" style="font-weight:600;color:var(--teal-ink)">ส่งคำขอเลื่อนขั้นแล้ว · รอพิจารณา</span>'
        : c.ok ? `<form class="stack" data-promo="${c.occupation}">${c.committee ? '<label class="f">แฟ้มผลงาน (รูปหรือ PDF)<input type="file" name="file" accept="image/*,application/pdf" required></label>' : ''}
          <button class="btn primary" type="submit">${c.committee ? 'ส่งผลงานขอเลื่อนขั้น' : 'เลื่อนขั้นเป็น ' + c.next}</button></form>`
        : '<span class="small muted">ยังไม่ผ่านทุกเงื่อนไข — เลื่อนขั้นจริงใช้เวลาหลายปีเหมือนงานจริง</span>'}
    </div>`;
  }
  function renderCareers() {
    const started = new Set(S.careers.map((c) => c.occupation));
    const avail = S.occupations.filter((o) => !started.has(o.id));
    const pendingImports = (S.imports || []).filter((i) => i.status === 'pending');
    return `<div class="section" id="careerSection"><div class="row between"><h2 style="font-size:19px">อาชีพและขั้น</h2></div>
      <p class="small muted" style="margin:0">ผู้รับงานต้องตรงกับอาชีพและถึงขั้นที่งานกำหนด · งานทั่วไปและขั้น F ใครก็รับได้หลังยืนยันตัวตน · F→E ≥ 3 เดือน, E→D ≥ 2 ปี, จูเนียร์→ซีเนียร์ ≥ 5 ปี</p>
      <div class="grid" style="align-items:start">${S.careers.map(careerCard).join('') || '<div class="empty">ยังไม่ได้เริ่มอาชีพ — เลือกอาชีพแรกด้านล่าง</div>'}</div>
      <div class="grid" style="align-items:start">
        ${avail.length ? `<form class="card stack" id="startCareer"><b>เริ่มอาชีพใหม่ (ขั้น F)</b>
          <label class="f">อาชีพ<select name="occ">${avail.filter((o) => !o.license_required).map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>
          <button class="btn action" type="submit">เริ่มอาชีพ</button>
          ${avail.some((o) => o.license_required) ? '<span class="small muted">อาชีพที่ต้องมีใบอนุญาต (เช่น ช่างไฟฟ้า) ต้องเทียบโอนพร้อมใบอนุญาต</span>' : ''}</form>` : ''}
        <form class="card stack" id="importCareer"><b>เทียบโอนประสบการณ์เดิม</b>
          <span class="small muted">มีประสบการณ์จริงอยู่แล้ว? ส่งหลักฐาน (ใบอนุญาต, หนังสือรับรองการทำงาน) ขอเริ่มที่ขั้นสูงสุด C</span>
          <label class="f">อาชีพ<select name="occ">${S.occupations.map((o) => `<option value="${o.id}">${esc(o.label)}${o.license_required ? ' (ใบอนุญาต)' : ''}</option>`).join('')}</select></label>
          <div class="row"><label class="f" style="flex:1">ขอขั้น<select name="rank">${['F', 'E', 'D', 'C'].map((r) => `<option value="${r}">${r} · ${RANK_LABEL[r]}</option>`).join('')}</select></label>
          <label class="f" style="flex:1">ประสบการณ์ (ปี)<input name="years" type="number" min="0" max="60" step="0.5" required inputmode="decimal"></label></div>
          <label class="f">หลักฐาน (รูปหรือ PDF)<input type="file" name="file" accept="image/*,application/pdf" required></label>
          <label class="f">หมายเหตุ (ไม่บังคับ)<input name="note" maxlength="500"></label>
          <button class="btn sec" type="submit">ส่งเทียบโอน</button>
          ${pendingImports.length ? `<span class="small" style="color:var(--teal-ink)">มีคำขอรอตรวจ ${pendingImports.length} รายการ</span>` : ''}
          ${(S.imports || []).filter((i) => i.status === 'rejected').slice(0, 1).map((i) => `<span class="small" style="color:var(--danger-ink)">คำขอล่าสุดไม่ผ่าน: ${esc(i.review_note || '')}</span>`).join('')}</form>
        <form class="card stack" id="endorseForm"><b>รับรองเพื่อนร่วมงาน</b>
          <span class="small muted">ซีเนียร์ (C) ขึ้นไปรับรองคนที่เคยทำงานด้วยกันได้ ใช้ประกอบการเลื่อนขั้น</span>
          <label class="f">ชื่อผู้ใช้<input name="u" required pattern="[A-Za-z0-9_]{3,20}" autocomplete="off"></label>
          <label class="f">อาชีพ<select name="occ">${S.occupations.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>
          <label class="f">คำรับรองสั้น ๆ (ไม่บังคับ)<input name="note" maxlength="300"></label>
          <button class="btn sec" type="submit">รับรอง</button></form>
      </div></div>`;
  }

  /* ---------- character tab ---------- */
  function renderChar() {
    const p = S.profile, L = levelInfo(Number(p.base_exp)), b = deckBonus(), pts = p.stat_points;
    const equipped = {}; Object.entries(S.myItems || {}).forEach(([id, it]) => { const s = (S.shop || []).find((x) => x.id === id); if (s && it.equipped) equipped[s.kind === 'frame' ? 'frame' : s.slot] = s; });
    const kyc = { none: ['ยังไม่ยืนยันตัวตน', 'var(--danger-ink)'], pending: ['รอตรวจเอกสาร', 'var(--gold-ink)'], verified: ['ยืนยันตัวตนแล้ว', 'var(--teal-ink)'], rejected: ['ยืนยันไม่ผ่าน', 'var(--danger-ink)'] }[p.kyc_status];
    $('view-char').innerHTML = `
      <div class="section"><div class="grid" style="align-items:start">
        <div class="card wood stack" style="${p.frame ? `border:3px solid ${esc(p.frame)}` : ''}">
          <div class="row"><div class="lv" style="width:56px;height:56px;font-size:22px">${L.lv}</div>
            <div style="flex:1;min-width:0"><h1 style="font-size:22px">${esc(p.display_name || p.username)}</h1>
              <span class="small" style="color:var(--on-wood-muted)">@${esc(p.username)}${p.title ? ' · ' + esc(p.title) : ''}</span></div></div>
          <div class="row between small" style="color:var(--on-wood-muted)"><span>EXP ${num(L.cur)} / ${num(L.need)}</span><span>${L.pct}%</span></div>
          <div class="bar dark" role="progressbar" aria-label="EXP" aria-valuenow="${L.pct}" aria-valuemax="100"><div style="width:${L.pct}%;background:var(--exp)"></div></div>
          <dl class="kv" style="color:var(--on-wood)">
            <div><dt style="color:var(--on-wood-muted)">งานสำเร็จ</dt><dd>${num(p.quests_done)}</dd></div>
            <div><dt style="color:var(--on-wood-muted)">คะแนนผู้รับงาน</dt><dd>${rating(p.rating_sum, p.rating_count)}</dd></div>
            <div><dt style="color:var(--on-wood-muted)">คะแนนผู้โพสต์</dt><dd>${rating(p.poster_rating_sum, p.poster_rating_count)}</dd></div>
            <div><dt style="color:var(--on-wood-muted)">ตัวตน</dt><dd style="color:${p.kyc_status === 'verified' ? 'var(--crystal)' : 'var(--gold-500)'}">${kyc[0]}</dd></div>
          </dl>
          ${p.kyc_status !== 'verified' && p.kyc_status !== 'pending' ? '<button class="btn primary" type="button" onclick="App.openKyc()">ยืนยันตัวตน</button>' : ''}
          ${p.no_show_count ? `<span class="small" style="color:var(--gold-500)">ไม่มาทำงานตามนัด ${p.no_show_count} ครั้ง</span>` : ''}
        </div>
        <div class="card stack"><div class="row between"><h2 style="font-size:16px">ค่าสถานะ</h2><span class="small" style="font-weight:600;color:${pts ? 'var(--gold-ink)' : 'var(--ink-muted)'}">แต้มเหลือ ${pts}</span></div>
          <div class="row" style="justify-content:center">${radarSvg(STATS.map(([k]) => p[k] + (b[k] || 0)))}</div>
          <div class="grid" id="statPanel" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">${STATS.map(([k, Lb]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;background:var(--parchment-200);border-radius:8px;padding:6px 8px">
              <span style="font-family:var(--font-rpg);font-weight:700;font-size:12px;color:var(--ink-muted)">${Lb}</span>
              <span style="font-family:var(--font-rpg);font-weight:700;font-size:16px">${p[k] + (b[k] || 0)}</span>
              ${pts ? `<button class="btn sec" data-stat="${k}" aria-label="เพิ่ม ${Lb}" style="min-height:32px;padding:0 8px">+</button>` : ''}</div>`).join('')}</div>
          <span class="small muted">ได้ 3 แต้มทุกเลเวลอัป · การ์ดในเด็คเพิ่มค่าสถานะ</span></div>
        <div class="card stack"><h2 style="font-size:16px">อุปกรณ์</h2>
          <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">${SLOTS.map(([k, lab]) => `<div style="border:1.5px ${equipped[k] ? 'solid var(--gold-500)' : 'dashed var(--brass-600)'};border-radius:10px;padding:8px;min-height:64px;display:flex;flex-direction:column;justify-content:center;text-align:center;background:var(--parchment-200)">
            <span class="small muted">${lab}</span><b class="small">${equipped[k] ? esc(equipped[k].name) : '—'}</b></div>`).join('')}</div>
          <a class="btn sec sm" href="#wallet" style="align-self:flex-start">ร้านค้า Crystal</a></div>
      </div></div>
      ${renderCareers()}
      <div class="section"><form class="card row" id="nameForm" style="align-items:flex-end"><label class="f" style="flex:1 1 200px">ชื่อที่แสดง<input id="nameInput" maxlength="40" value="${esc(p.display_name || '')}"></label><button class="btn sec" type="submit">บันทึกชื่อ</button></form></div>`;
  }

  /* ---------- deck tab ---------- */
  function cardTile(c) {
    const owned = S.myCards.has(c.id), done = S.doneByCat[c.category] || 0, t = tier(c.tier);
    const rankNote = c.min_career_rank ? ` · ต้องขั้นอาชีพ ${c.min_career_rank} ขึ้นไป` : '';
    return `<article class="card job-card tier-${esc(t.id)}${t.glow && owned ? ' tier-glow' : ''}" style="display:flex;flex-direction:column;gap:6px;border-color:${t.color};border-width:2px;${owned ? '' : 'opacity:.7;border-style:dashed'}">
      <div class="row between">${tierTag(c.tier)}<span class="small muted">${owned ? 'มีแล้ว' : 'ยังไม่ปลดล็อก'}</span></div>
      <h3 style="font-size:16px">${esc(c.name)}</h3>
      <span class="small" style="color:var(--teal-ink)">EXP +${c.exp_bonus_pct}% ${c.category === 'general' ? 'ทุกเควสต์' : 'เควสต์' + esc((CATS[c.category] || {}).label || c.category)}${Object.keys(c.stats || {}).length ? ' · ' + Object.entries(c.stats).map(([s, v]) => s.toUpperCase() + ' +' + v).join(' ') : ''}</span>
      ${owned ? '' : `<span class="small muted">ปลดล็อก: ${esc(c.description)} (${num(Math.min(done, c.unlock_count))}/${num(c.unlock_count)})${rankNote}</span>`}</article>`;
  }
  function renderDeck() {
    const d = S.deck || {}, owned = S.cards.filter((c) => S.myCards.has(c.id));
    const sel = (name, cur, empty) => `<select name="${name}">${empty ? '<option value="">— ว่าง —</option>' : ''}${owned.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)} (${esc(tier(c.tier).label)})</option>`).join('')}</select>`;
    const main = cardById(d.main_card), mt = main ? tier(main.tier) : null;
    $('deckPanel').innerHTML = `<div class="grid" style="align-items:start">
      ${main ? `<div class="${mt.glow ? 'tier-glow ' : ''}tier-${esc(mt.id)}" style="background:linear-gradient(160deg,${mt.color} 0%,#2a1b11 85%);border:3px solid ${mt.color};border-radius:14px;padding:16px;color:var(--on-wood);display:flex;flex-direction:column;gap:6px;box-shadow:0 6px 0 var(--brass-600);min-height:200px;justify-content:flex-end">
        <span style="font-family:var(--font-rpg);font-weight:700;font-size:12px;color:var(--gold-500)">MAIN JOB · ${esc(mt.label)}</span>
        <h2 style="font-size:24px">${esc(main.name)}</h2>
        <span class="small" style="color:#d9ede4">EXP +${main.exp_bonus_pct}% ${main.category === 'general' ? 'ทุกเควสต์' : 'เมื่อทำเควสต์' + esc((CATS[main.category] || {}).label || '')}</span></div>` : '<div class="empty">ยังไม่ได้เลือกการ์ดหลัก</div>'}
      <form id="deckForm" class="card stack">
        <label class="f">การ์ดหลัก (ได้โบนัส EXP)${sel('main', d.main_card, false)}</label>
        <label class="f">การ์ดเสริม 1${sel('s1', d.support1, true)}</label><label class="f">การ์ดเสริม 2${sel('s2', d.support2, true)}</label><label class="f">การ์ดเสริม 3${sel('s3', d.support3, true)}</label>
        <button class="btn primary" type="submit">บันทึกเด็ค</button>
        <span class="small muted">การ์ดอาชีพเพิ่ม EXP ชีวิต ไม่เพิ่มขั้นอาชีพ — ขั้นอาชีพได้จากงานจริงเท่านั้น</span></form></div>`;
    const ord = (c) => tier(c.tier).ord;
    const counts = {}; S.cards.forEach((c) => { if (S.myCards.has(c.id)) counts[c.tier] = (counts[c.tier] || 0) + 1; });
    $('cardList').innerHTML = `<div class="row scroll-x" style="grid-column:1/-1">${['all', ...S.tiers.map((t) => t.id)].map((k) => `<button class="pill" data-tierf="${k}" aria-pressed="${(S.tierFilter || 'all') === k}">${k === 'all' ? 'ทุกระดับ' : esc(tier(k).label) + (counts[k] ? ' · ' + counts[k] : '')}</button>`).join('')}</div>`
      + S.cards.filter((c) => !S.tierFilter || S.tierFilter === 'all' || c.tier === S.tierFilter)
        .sort((a, b) => ord(a) - ord(b) || (S.myCards.has(b.id) - S.myCards.has(a.id)) || a.sort - b.sort).map(cardTile).join('');
  }
  renderers.push(renderChar, renderDeck);
  $('cardList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tierf]'); if (b) { S.tierFilter = b.dataset.tierf; renderDeck(); } });

  /* ---------- identity check ---------- */
  function openKyc() {
    const p = S.profile;
    if (p.kyc_status === 'verified') return toast('ยืนยันตัวตนแล้ว');
    if (p.kyc_status === 'pending') return toast('ส่งเอกสารแล้ว กำลังรอตรวจ');
    openSheet('ยืนยันตัวตน', `<form id="kycForm" class="stack">
      <p class="small muted" style="margin:0">ทุกคนที่รับหรือโพสต์งานต้องยืนยันตัวตน เพื่อความปลอดภัยของทั้งสองฝ่าย เอกสารเก็บในที่เก็บส่วนตัว เห็นเฉพาะคุณและทีมตรวจสอบ — ดู<a href="privacy.html" target="_blank">นโยบายความเป็นส่วนตัว</a></p>
      <label class="f">ชื่อ-นามสกุลตามบัตรประชาชน<input name="name" required minlength="4" maxlength="120" value="${esc((S.priv && S.priv.legal_name) || '')}"></label>
      <label class="f">เบอร์มือถือ<input name="phone" required pattern="0[0-9]{8,9}" inputmode="tel" placeholder="08xxxxxxxx" value="${esc((S.priv && S.priv.phone) || '')}"></label>
      <label class="f">รูปบัตรประชาชนด้านหน้า<input name="card" type="file" accept="image/*" required></label>
      <label class="f">รูปเซลฟีถือบัตร<input name="selfie" type="file" accept="image/*" capture="user" required></label>
      <span class="small muted">ปิดเลขหลังบัตร (Laser ID) ได้ ไม่ต้องใช้ · ทีมงานใช้เวลาตรวจไม่เกิน 1 วันทำการ</span>
      <button class="btn primary" type="submit" id="kycSubmit">ส่งยืนยันตัวตน</button></form>`);
    $('kycForm').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target; $('kycSubmit').disabled = true; toast('กำลังอัปโหลด…');
      try {
        const [card, selfie] = await Promise.all([upload('private-docs', S.user.id, f.elements.card.files[0], 'idcard'), upload('private-docs', S.user.id, f.elements.selfie.files[0], 'selfie')]);
        const ok = await rpc('submit_kyc', { p_legal_name: f.elements.name.value.trim(), p_phone: f.elements.phone.value.trim(), p_id_card_path: card, p_selfie_path: selfie }, 'ส่งเอกสารแล้ว รอทีมงานตรวจ');
        if (ok) closeSheet();
      } catch (e) { toast(App.errText(e), true); }
      if ($('kycSubmit')) $('kycSubmit').disabled = false;
    };
  }

  /* ---------- events ---------- */
  $('view-char').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-stat]'); if (!b) return;
    b.disabled = true; await rpc('allocate_stat', { p_stat: b.dataset.stat, p_points: 1 }, b.dataset.stat.toUpperCase() + ' +1');
  });
  $('view-char').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target, btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    try {
      if (f.id === 'nameForm') {
        const { error } = await sb.from('profiles').update({ display_name: $('nameInput').value.trim() || null }).eq('id', S.user.id);
        if (error) toast(App.errText(error), true); else { toast('บันทึกชื่อแล้ว'); refresh(['me']); }
      }
      if (f.id === 'startCareer') await rpc('start_career', { p_occ: f.elements.occ.value }, 'เริ่มอาชีพแล้ว — รับงานขั้น F ในอาชีพนี้ได้เลย');
      if (f.dataset.promo) {
        const file = f.elements.file && f.elements.file.files[0];
        const path = file ? await upload('private-docs', S.user.id, file, 'portfolio') : null;
        await rpc('request_promotion', { p_occ: f.dataset.promo, p_portfolio_path: path }, (r) => r === 'promoted' ? 'เลื่อนขั้นแล้ว!' : 'ส่งคำขอแล้ว รอคณะกรรมการพิจารณา');
      }
      if (f.id === 'importCareer') {
        const path = await upload('private-docs', S.user.id, f.elements.file.files[0], 'career');
        await rpc('request_career_import', { p_occ: f.elements.occ.value, p_rank: f.elements.rank.value, p_years: Number(f.elements.years.value), p_doc_path: path, p_note: f.elements.note.value.trim() || null }, 'ส่งคำขอเทียบโอนแล้ว');
      }
      if (f.id === 'endorseForm') {
        const { data: u } = await sb.from('profiles').select('id').eq('username', f.elements.u.value.trim()).maybeSingle();
        if (!u) toast('ไม่พบชื่อผู้ใช้นี้', true);
        else await rpc('endorse_worker', { p_user: u.id, p_occ: f.elements.occ.value, p_note: f.elements.note.value.trim() || null }, 'รับรองแล้ว');
      }
    } catch (e) { toast(App.errText(e), true); }
    if (btn && btn.isConnected) btn.disabled = false;
  });
  $('deckPanel').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target, v = (n) => f.elements[n].value || null;
    await rpc('set_deck', { p_main: v('main'), p_s1: v('s1'), p_s2: v('s2'), p_s3: v('s3') }, 'บันทึกเด็คแล้ว');
  });

  Object.assign(App, { openKyc, levelInfo });
})();
