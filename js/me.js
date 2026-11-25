/* Real-life Quest — character (level, stats, equipment), identity check, career ranks, job-card deck. */
(() => {
  const { sb, S, CATS, tier, tierTag, RANKS, RANK_LABEL, $, esc, num, when, hours, rating, toast, rpc, refresh, loaders, renderers, openSheet, closeSheet, upload } = App;
  const STATS = [['str', 'STR', 'แรง'], ['agi', 'AGI', 'คล่องตัว'], ['vit', 'VIT', 'ทนทาน'], ['int', 'INT', 'ปัญญา'], ['dex', 'DEX', 'ฝีมือ'], ['luk', 'LUK', 'โชค']];
  const SLOTS = [['head', 'หมวก'], ['body', 'เสื้อ'], ['feet', 'รองเท้า'], ['tool', 'เครื่องมือ'], ['acc', 'เครื่องประดับ'], ['frame', 'กรอบโปรไฟล์']];

  function levelInfo(exp) {
    const lv = Math.floor(Math.sqrt(exp / 550)) + 1, from = 550 * (lv - 1) ** 2, to = 550 * lv ** 2;
    return { lv, cur: exp - from, need: to - from, pct: Math.round(((exp - from) / (to - from)) * 100) };
  }

  loaders.careers = async function () {
    const [c, pr, im, lt, ul, la] = await Promise.all([
      sb.rpc('my_careers'),
      sb.from('promotion_requests').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10),
      sb.from('career_imports').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10),
      sb.from('license_titles').select('*').eq('active', true),
      sb.from('user_licenses').select('*').eq('user_id', S.user.id).is('revoked_at', null),
      sb.from('license_applications').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10)
    ]);
    S.careers = c.data || []; S.promos = pr.data || []; S.imports = im.data || [];
    S.licenseTitles = lt.data || []; S.myLicenses = new Set((ul.data || []).map((r) => r.occupation_id)); S.licenseApps = la.data || [];
  };
  loaders.cards = async function () {
    const uid = S.user.id;
    const [c, mine, d, done, pk] = await Promise.all([
      sb.from('job_cards').select('*').order('sort'),
      sb.from('user_cards').select('card_id').eq('user_id', uid),
      sb.from('decks').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('quests').select('category').eq('worker_id', uid).eq('status', 'completed'),
      sb.rpc('card_pack_info')
    ]);
    S.pack = pk.data || null;
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
  const _rankOrd = (r) => 'FEDCBAS'.indexOf(r);
  const gate = (ok, label) => `<li style="display:flex;gap:6px;align-items:flex-start"><span aria-hidden="true" style="color:${ok ? 'var(--teal-600)' : 'var(--ink-muted)'};font-weight:700">${ok ? '✓' : '○'}</span><span>${label}</span></li>`;
  function licenseSection(c) {
    const lt = (S.licenseTitles || []).find((l) => l.occupation_id === c.occupation);
    if (!lt) return '';
    if ((S.myLicenses || new Set()).has(c.occupation)) {
      return `<div class="card wood stack" style="margin-top:8px"><b>${esc(lt.label)}</b><span class="small">สมาคมวิชาชีพรับรองแล้ว — มีตำแหน่งนี้</span></div>`;
    }
    const pending = (S.licenseApps || []).find((a) => a.occupation_id === c.occupation && a.status === 'pending');
    const approved = (S.licenseApps || []).find((a) => a.occupation_id === c.occupation && a.status === 'approved');
    const rejected = (S.licenseApps || []).filter((a) => a.occupation_id === c.occupation && a.status === 'rejected').slice(0, 1);
    const okRank = _rankOrd(c.rank) >= _rankOrd(lt.min_rank);
    let body;
    if (pending) body = '<span class="small" style="color:var(--teal-ink)">ส่งคำขอขึ้นทะเบียนแล้ว · รอสมาคมวิชาชีพตรวจ</span>';
    else if (approved) body = `<span class="small" style="color:var(--teal-ink)">สมาคมอนุมัติแล้ว — ซื้อตำแหน่งได้</span>
      <button class="btn primary" type="button" data-license-buy="${approved.id}">ซื้อตำแหน่ง (${num(lt.price_gold)} G)</button>`;
    else if (!okRank) body = `<span class="small muted">ต้องถึงขั้น ${esc(lt.min_rank)} (${esc(RANK_LABEL[lt.min_rank] || '')}) ก่อนขอขึ้นทะเบียน</span>`;
    else body = `<form class="stack" data-license-apply="${c.occupation}">
        <label class="f">หลักฐานเพิ่มเติม (ไม่บังคับ — รูปหรือ PDF)<input type="file" name="file" accept="image/*,application/pdf"></label>
        <button class="btn sec" type="submit">ขอขึ้นทะเบียนกับสมาคมวิชาชีพ</button></form>`;
    return `<div class="card stack" style="margin-top:8px"><b>${esc(lt.label)}</b><span class="small muted">ราคา ${num(lt.price_gold)} G · ต้องขั้น ${esc(lt.min_rank)} ขึ้นไป</span>${body}
      ${rejected.map((r) => `<span class="small" style="color:var(--danger-ink)">คำขอล่าสุดไม่ผ่าน: ${esc(r.note || '')}</span>`).join('')}</div>`;
  }
  function careerCard(c) {
    const occ = S.occupations.find((o) => o.id === c.occupation) || { label: c.occupation };
    if (!c.next) return `<div class="card stack"><div class="row between"><b>${esc(occ.label)}</b><span class="rank">ขั้น ${c.rank}</span></div><span class="small">${esc(c.rank_label)} — ขั้นสูงสุดแล้ว</span>${licenseSection(c)}</div>`;
    const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 100;
    const timeOk = c.months_in_rank >= c.min_months;
    return `<div class="card stack">
      <div class="row between"><b style="font-size:16px">${esc(occ.label)}</b><span class="rank">ขั้น ${c.rank} · ${esc(c.rank_label)}</span></div>
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
      ${licenseSection(c)}
    </div>`;
  }
  function renderCareers() {
    const started = new Set(S.careers.map((c) => c.occupation));
    const avail = S.occupations.filter((o) => !started.has(o.id));
    const pendingImports = (S.imports || []).filter((i) => i.status === 'pending');
    return `<div class="section" id="careerSection"><div class="row between"><h2 style="font-size:19px">อาชีพและขั้น</h2></div>
      <details class="dash"><summary class="small" style="cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center">ℹ️ กติกาขั้นอาชีพ</summary><p class="small muted" style="margin:0">ผู้รับงานต้องตรงกับอาชีพและถึงขั้นที่งานกำหนด · งานทั่วไปและขั้น F ใครก็รับได้หลังยืนยันตัวตน · F→E ≥ 3 เดือน, E→D ≥ 2 ปี, เอ็กซ์เพิร์ต→มาสเตอร์ ≥ 5 ปี</p></details>
      <div class="grid" style="align-items:start">${S.careers.map(careerCard).join('') || '<div class="empty"><b>สถานะปัจจุบัน: โนวิส</b><br><span class="small muted">ยังไม่มีอาชีพ — เลือกอาชีพแรกด้านล่างเพื่อเริ่มเส้นทางอาชีพ</span></div>'}</div>
      <details class="dash" style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center">➕ เริ่มอาชีพใหม่ · เทียบโอนประสบการณ์ · รับรองเพื่อนร่วมงาน</summary>
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
          <span class="small muted">เอ็กซ์เพิร์ต (C) ขึ้นไปรับรองคนที่เคยทำงานด้วยกันได้ ใช้ประกอบการเลื่อนขั้น</span>
          <label class="f">ชื่อผู้ใช้<input name="u" required pattern="[A-Za-z0-9_]{3,20}" autocomplete="off"></label>
          <label class="f">อาชีพ<select name="occ">${S.occupations.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>
          <label class="f">คำรับรองสั้น ๆ (ไม่บังคับ)<input name="note" maxlength="300"></label>
          <button class="btn sec" type="submit">รับรอง</button></form>
      </div></details></div>`;
  }

  /* ---------- character tab ---------- */
  function renderChar() {
    const p = S.profile, L = levelInfo(Number(p.base_exp)), b = deckBonus(), pts = p.stat_points;
    const equipped = {}; Object.entries(S.myItems || {}).forEach(([id, it]) => { const s = (S.shop || []).find((x) => x.id === id); if (s && it.equipped) equipped[s.kind === 'frame' ? 'frame' : s.slot] = s; });
    const kyc = { none: ['ยังไม่ยืนยันตัวตน', 'var(--danger-ink)'], pending: ['รอตรวจเอกสาร', 'var(--gold-ink)'], verified: ['ยืนยันตัวตนแล้ว', 'var(--teal-ink)'], rejected: ['ยืนยันไม่ผ่าน', 'var(--danger-ink)'] }[p.kyc_status];
    $('view-char').innerHTML = `
      <div class="section"><div class="dress">
        <div class="card wood dress-stage"><div class="row between"><h2 style="font-size:17px">${esc(p.display_name || p.username)}</h2><span class="small" style="color:var(--on-wood-muted)">${p.title ? esc(p.title) : 'Lv.' + L.lv}</span></div>
          <div id="avatarSlot"></div></div>
        ${wardrobe(equipped)}
      </div></div>
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
          <div class="grid" id="statPanel" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">${STATS.map(([k, Lb, Th]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;background:var(--parchment-200);border-radius:8px;padding:6px 8px">
              <span style="font-family:var(--font-rpg);font-weight:700;font-size:12px;color:var(--ink-muted)">${Lb}<span class="stat-th">${Th}</span></span>
              <span style="font-family:var(--font-rpg);font-weight:700;font-size:16px">${p[k] + (b[k] || 0)}</span>
              ${pts ? `<button class="btn sec" data-stat="${k}" aria-label="เพิ่ม ${Lb} ${Th}" style="min-height:32px;padding:0 8px">+</button>` : ''}</div>`).join('')}</div>
          <span class="small muted">ได้ 3 แต้มทุกเลเวลอัป · การ์ดในเด็คเพิ่มค่าสถานะ</span></div>
      </div></div>
      ${renderCareers()}
      <div class="section"><details class="dash"><summary class="small" style="cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center">✏️ แก้ชื่อที่แสดง · วันเกิด</summary><form class="card row" id="nameForm" style="align-items:flex-end"><label class="f" style="flex:1 1 200px">ชื่อที่แสดง<input id="nameInput" maxlength="40" value="${esc(p.display_name || '')}"></label><button class="btn sec" type="submit">บันทึกชื่อ</button></form>
      <form class="card row" id="birthdateForm" style="align-items:flex-end"><label class="f" style="flex:1 1 200px">วันเกิด<input id="birthdateInput" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc((S.priv && S.priv.birthdate) || '')}"></label><button class="btn sec" type="submit">บันทึกวันเกิด</button></form>
      <p class="small muted" style="margin:4px 0 0">ใช้แสดงวันเกิดของคุณให้สมาชิกกิลด์เห็นแค่วัน/เดือน (ไม่โชว์ปีเกิด) เพื่อฉลองกัน</p></details></div>`;
    mountAvatar();
  }

  /* ---------- dressing room (3D avatar + wardrobe) ---------- */
  const WSLOTS = [['all', 'ทั้งหมด'], ['head', 'หมวก'], ['body', 'เสื้อ'], ['feet', 'รองเท้า'], ['tool', 'เครื่องมือ'], ['acc', 'เครื่องประดับ'], ['frame', 'กรอบ'], ['title', 'ฉายา']];
  const COLORS = { skin: ['ผิว', ['#f6d7b0', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e']], hair: ['ผม', ['#2a1b11', '#5a3d27', '#a0522d', '#d9b56b', '#b3261e', '#6a3fb5']],
    shirt: ['เสื้อ', ['#1f6f6b', '#b3261e', '#e8b13a', '#2e7d4f', '#6a3fb5', '#f3e6c8']], pants: ['กางเกง', ['#3a2618', '#24486a', '#2a1e14', '#6b5540', '#1f5a45', '#8a6a3a']],
    shoes: ['รองเท้า', ['#2a1b11', '#fbf3df', '#b3261e', '#24486a', '#6b5540', '#e8b13a']] };
  const slotOf = (i) => i.kind === 'frame' ? 'frame' : i.kind === 'title' ? 'title' : i.slot;
  function owned() { return (S.shop || []).filter((i) => S.myItems && S.myItems[i.id] && i.kind !== 'boost'); }
  function wardrobe(equipped) {
    const ws = S.wslot || 'all', list = owned().filter((i) => ws === 'all' || slotOf(i) === ws);
    const av = S.avatarDraft || S.profile.avatar || {};
    return `<div class="card stack dress-side">
      <div class="row between"><h2 style="font-size:16px">ตู้เสื้อผ้า</h2><a class="btn sec sm" href="#wallet">ร้านค้า</a></div>
      <div class="row scroll-x">${WSLOTS.map(([k, v]) => `<button class="pill" data-wslot="${k}" aria-pressed="${ws === k}">${v}</button>`).join('')}</div>
      <div class="ward-grid">${list.length ? list.map((i) => { const on = S.myItems[i.id].equipped, t = tier(i.tier);
        return `<button class="ward-item${on ? ' on' : ''}" data-wear="${i.id}" data-on="${on ? 0 : 1}" style="border-color:${on ? 'var(--teal-600)' : t.color}" aria-pressed="${on}">
          <span class="small" style="color:${t.color};font-weight:600">${esc(t.label)}</span><b class="small">${esc(i.name)}</b><span class="small muted">${on ? '✓ ใส่อยู่ · แตะเพื่อถอด' : 'แตะเพื่อใส่'}</span></button>`; }).join('')
        : `<div class="empty" style="grid-column:1/-1">ยังไม่มีของในช่องนี้ — ซื้อได้ที่ร้านค้า Crystal</div>`}</div>
      <details class="dash"${S.avatarDraft ? ' open' : ''}><summary class="small" style="cursor:pointer;font-weight:600">สีตัวละคร (ฟรี)</summary>
        <div class="stack" style="margin-top:8px">${Object.entries(COLORS).map(([k, [lab, sw]]) => `<div class="row"><span class="small" style="width:56px">${lab}</span>
          ${sw.map((c) => `<button class="swatch${av[k] === c ? ' on' : ''}" data-color="${k}" data-v="${c}" style="background:${c}" aria-label="${lab} ${c}" aria-pressed="${av[k] === c}"></button>`).join('')}
          <input type="color" data-color-input="${k}" value="${esc(av[k] || '#000000')}" aria-label="เลือก${lab}เอง" class="swatch-custom"></div>`).join('')}
          ${S.avatarDraft ? '<div class="row"><button class="btn primary sm" data-avsave="1">บันทึกสี</button><button class="btn sec sm" data-avcancel="1">ยกเลิก</button></div>' : ''}
        </div></details>
    </div>`;
  }
  function avatarSpec() {
    const items = owned().filter((i) => S.myItems[i.id].equipped && i.kind === 'costume').map((i) => Object.assign({}, i, { tierColor: tier(i.tier).color }));
    return { avatar: S.avatarDraft || S.profile.avatar, items, frame: S.profile.frame };
  }
  function mountAvatar() { const slot = $('avatarSlot'); if (slot && App.avatar) App.avatar.show(slot, avatarSpec()); }
  $('view-char').addEventListener('click', async (ev) => {
    const ws = ev.target.closest('[data-wslot]'); if (ws) { S.wslot = ws.dataset.wslot; return renderChar(); }
    const w = ev.target.closest('[data-wear]');
    if (w) { w.disabled = true; await rpc('equip_item', { p_item: w.dataset.wear, p_on: w.dataset.on === '1' }, w.dataset.on === '1' ? 'ใส่แล้ว' : 'ถอดแล้ว'); return; }
    const sw = ev.target.closest('[data-color]');
    if (sw) { S.avatarDraft = Object.assign({}, S.profile.avatar, S.avatarDraft, { [sw.dataset.color]: sw.dataset.v }); return renderChar(); }
    if (ev.target.closest('[data-avcancel]')) { S.avatarDraft = null; return renderChar(); }
    if (ev.target.closest('[data-avsave]')) {
      const a = S.avatarDraft; const ok = await rpc('set_avatar', { p_skin: a.skin, p_hair: a.hair, p_shirt: a.shirt, p_pants: a.pants, p_shoes: a.shoes }, 'บันทึกสีแล้ว');
      if (ok) { S.avatarDraft = null; renderChar(); }
    }
    const lb = ev.target.closest('[data-license-buy]');
    if (lb) { lb.disabled = true; if (await rpc('buy_license', { p_app: lb.dataset.licenseBuy }, 'ได้ตำแหน่งแล้ว!')) refresh(['careers']); else lb.disabled = false; }
  });
  $('view-char').addEventListener('input', (ev) => {
    const ci = ev.target.closest('[data-color-input]'); if (!ci) return;
    S.avatarDraft = Object.assign({}, S.profile.avatar, S.avatarDraft, { [ci.dataset.colorInput]: ci.value });
    if (App.avatar) App.avatar.show($('avatarSlot'), avatarSpec());
  });
  $('view-char').addEventListener('change', (ev) => { if (ev.target.closest('[data-color-input]')) renderChar(); });

  /* ---------- deck tab ---------- */
  const price = (r) => { const o = ((S.pack || {}).odds || []).find((x) => x.rarity === r); return o ? o.shop_price : 0; };
  function cardTile(c) {
    const gold = Number(S.wallet ? S.wallet.gold : 0);
    const owned = S.myCards.has(c.id), done = S.doneByCat[c.category] || 0;
    return `<article class="card" style="display:flex;flex-direction:column;gap:6px;${owned ? '' : 'opacity:.75;border-style:dashed'}">
      <h3 style="font-size:16px">${esc(c.name)}</h3>
      <span class="small" style="color:var(--teal-ink)">EXP +${c.exp_bonus_pct}% ${c.category === 'general' ? 'ทุกเควสต์' : 'เควสต์' + esc((CATS[c.category] || {}).label || c.category)}${Object.keys(c.stats || {}).length ? ' · ' + Object.entries(c.stats).map(([s, v]) => s.toUpperCase() + ' +' + v).join(' ') : ''}</span>
      <span class="small muted">${owned ? 'มีแล้ว' : c.source === 'special' ? 'ได้จากภารกิจพิเศษ · ' + esc(c.description) : c.source === 'boss' ? 'ได้จากตู้บอสในเกม · ' + esc(c.description) : c.source === 'shop' ? 'การ์ดกิลด์ · ' + esc(c.description) : (c.unlock_count < 9999 ? 'ปลดล็อกจากงานจริง: ' + esc(c.description) + ` (${Math.min(done, c.unlock_count)}/${c.unlock_count})` : esc(c.description) + ' · ได้จากการสุ่ม')}</span>
      <span class="small" style="color:var(--ink-soft)">ระดับ: ${esc(c.rarity)}</span>
      ${!owned && c.source === 'shop' && (c.shop_price || price(c.rarity)) ? `<button type="button" class="btn sec sm" data-cardbuy="${c.id}" ${gold >= (c.shop_price || price(c.rarity)) ? '' : 'disabled'}>ซื้อ ${num(c.shop_price || price(c.rarity))} G</button>` : ''}</article>`;
  }
  const DSLOTS = [['main', 'main_card', 'การ์ดหลัก'], ['s1', 'support1', 'เสริม 1'], ['s2', 'support2', 'เสริม 2'], ['s3', 'support3', 'เสริม 3']];
  const bonusText = (c) => `EXP +${c.exp_bonus_pct}% ${c.category === 'general' ? 'ทุกเควสต์' : 'เควสต์' + ((CATS[c.category] || {}).label || '')}`;
  const statsText = (c) => { const e = Object.entries(c.stats || {}); return e.length ? e.map(([k, v]) => k.toUpperCase() + ' +' + v).join(' · ') : 'ไม่มีค่าสถานะเพิ่ม'; };
  function renderPack() {
    const el = $('packPanel'), P = S.pack; if (!el) return;
    if (!P) { el.innerHTML = ''; return; }
    const cry = Number(S.wallet ? S.wallet.crystal : 0), left = P.daily_max - P.drawn_today, can = cry >= P.price && left > 0;
    const total = (P.odds || []).reduce((a, o) => a + o.weight, 0) || 1;
    el.innerHTML = `<div class="card wood stack">
      <div class="row between"><b style="font-family:var(--font-display);font-size:17px">🎴 ตู้สุ่มการ์ดอาชีพ</b><span class="small" style="color:var(--on-wood-muted)">วันนี้สุ่มแล้ว ${P.drawn_today} / ${P.daily_max}</span></div>
      <span class="small" style="color:var(--on-wood-muted)">นอกจากการ์ดเริ่มต้น ไม่มีการแจกฟรี — สุ่มได้ด้วย Crystal เท่านั้น (Crystal ต้องเติมเงินซื้อ ตอนนี้ยังไม่เปิดเติม) · ปลดล็อกจากงานจริง · การ์ดกิลด์ซื้อตรงด้วย Gold · การ์ดสมาคมได้จากภารกิจพิเศษหรือตู้บอสในเกม การ์ดซ้ำคืน ${num(P.refund)} C</span>
      <div class="row" style="gap:6px;flex-wrap:wrap">${(P.odds || []).map((o) => `<span class="fchip gold-chip">${esc(o.rarity)} ${Math.round(o.weight / total * 1000) / 10}%</span>`).join('')}</div>
      <span class="small" style="color:var(--on-wood-muted)">การันตีระดับอีปิกขึ้นไป ภายใน ${P.pity} ครั้ง (สุ่มมาแล้ว ${Math.min(P.since_epic, P.pity)} ครั้งนับจากอีปิกล่าสุด) · การ์ด Gold และ Crystal แลกเป็นเงินสดไม่ได้</span>
      <button type="button" class="btn primary" data-draw="1" ${can ? '' : 'disabled'}>${left <= 0 ? 'วันนี้สุ่มครบแล้ว' : `สุ่มการ์ด ${num(P.price)} C`}</button>
    </div>`;
  }
  function renderDeck() {
    const d = S.deck || {}, owned = S.cards.filter((c) => S.myCards.has(c.id));
    const saved = DSLOTS.map(([k, col]) => d[col] || '').join('|');
    if (S.deckSavedKey !== saved) { S.deckSavedKey = saved; S.deckDraft = Object.fromEntries(DSLOTS.map(([k, col]) => [k, d[col] || ''])); }
    const dr = S.deckDraft, cur = S.deckSlot || 'main', dirty = DSLOTS.some(([k, col]) => (dr[k] || '') !== (d[col] || ''));
    const main = cardById(dr.main);
    const slot = ([k, , label]) => { const c = cardById(dr[k]), on = k === cur;
      const big = k === 'main';
      return `<button type="button" data-dslot="${k}" aria-pressed="${on}" style="text-align:left;display:flex;flex-direction:column;gap:4px;justify-content:${big ? 'flex-end' : 'center'};min-height:${big ? 150 : 84}px;padding:12px;border-radius:14px;cursor:pointer;color:var(--on-wood);background:${big ? '#2f4a3e' : 'var(--wood-800)'};border:${on ? '3px solid var(--gold-500)' : '2px dashed var(--wood-line)'};${big ? 'grid-column:1/-1' : ''}">
        <span style="font-family:var(--font-rpg);font-weight:700;font-size:12px;color:var(--gold-500)">${big ? 'อาชีพหลัก · MAIN JOB' : label}</span>
        ${c ? `<b style="font-size:${big ? 22 : 15}px">${esc(c.name)}</b><span class="small" style="color:#d9ede4">${big ? bonusText(c) : statsText(c)}</span>` : `<span class="small" style="color:var(--on-wood-muted)">ว่าง — แตะเพื่อเลือกการ์ด</span>`}</button>`; };
    const slotLabel = (DSLOTS.find((x) => x[0] === cur) || [])[2];
    $('deckPanel').innerHTML = `<div class="stack">
      <p class="small muted" style="margin:0">การ์ดหลักให้โบนัส EXP เมื่อทำเควสต์ตามหมวด · การ์ดเสริมเพิ่มค่าสถานะ · ไม่เพิ่มขั้นอาชีพ (ขั้นได้จากงานจริงเท่านั้น)</p>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${DSLOTS.map(slot).join('')}</div>
      <div class="card stack"><b>เลือกการ์ดใส่ช่อง “${esc(slotLabel)}”</b>
        ${owned.length ? `<div class="stack" style="gap:6px">${owned.map((c) => { const used = DSLOTS.find(([k]) => dr[k] === c.id); const here = dr[cur] === c.id;
          return `<button type="button" class="btn ${here ? 'primary' : 'sec'}" data-dpick="${c.id}" style="justify-content:space-between;text-align:left;height:auto;padding:8px 12px"><span><b>${esc(c.name)}</b><br><span class="small">${bonusText(c)} · ${statsText(c)}</span></span><span class="small">${here ? '✓ ใช้อยู่' : used ? 'อยู่ช่อง' + used[2] : 'ใส่'}</span></button>`; }).join('')}
          ${cur !== 'main' && dr[cur] ? '<button type="button" class="btn sec sm" data-dclear="1">เอาการ์ดออกจากช่องนี้</button>' : ''}</div>`
          : '<div class="empty">ยังไม่มีการ์ด — ปลดล็อกจากการทำเควสต์ตามหมวด ดูเงื่อนไขในคลังการ์ดด้านล่าง</div>'}
      </div>
      <button type="button" class="btn primary" data-dsave="1" ${dirty && dr.main ? '' : 'disabled'}>${dirty ? 'บันทึกเด็ค' : 'บันทึกแล้ว'}</button>
    </div>`;
    renderPack();
    $('cardList').innerHTML = S.cards.map(cardTile).join('');
  }
  renderers.push(renderChar, renderDeck);

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
      if (f.id === 'birthdateForm') {
        const v = $('birthdateInput').value;
        if (!v) { toast('เลือกวันเกิดก่อน', true); }
        else await rpc('set_birthdate', { p_birthdate: v }, 'บันทึกวันเกิดแล้ว');
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
      if (f.dataset.licenseApply) {
        const file = f.elements.file && f.elements.file.files[0];
        const path = file ? await upload('private-docs', S.user.id, file, 'license') : null;
        const ok = await rpc('apply_license', { p_occ: f.dataset.licenseApply, p_doc_path: path }, 'ส่งคำขอขึ้นทะเบียนแล้ว รอสมาคมวิชาชีพตรวจ');
        if (ok) refresh(['careers']);
      }
    } catch (e) { toast(App.errText(e), true); }
    if (btn && btn.isConnected) btn.disabled = false;
  });
  $('packPanel').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-draw]'); if (!b) return;
    b.disabled = true;
    const r = await rpc('draw_card');
    if (r && r.card) openSheet('ได้การ์ดแล้ว!', `<div class="stack" style="text-align:center"><div class="card wood stack"><span class="small" style="color:var(--gold-500)">${esc(r.rarity)}</span><b style="font-family:var(--font-display);font-size:24px">${esc(r.name)}</b><span class="small" style="color:#d9ede4">EXP +${r.exp_bonus_pct}% ${r.category === 'general' ? 'ทุกเควสต์' : 'เควสต์' + esc((CATS[r.category] || {}).label || '')}</span></div>${r.dupe ? `<p class="small">ซ้ำกับที่มีอยู่ — คืน ${num(r.refund)} C</p>` : '<p class="small">เพิ่มเข้าคลังแล้ว ไปใส่ในช่องการ์ดได้เลย</p>'}<button type="button" class="btn primary" id="packOk">ตกลง</button></div>`);
    const ok = document.getElementById('packOk'); if (ok) ok.onclick = () => App.closeSheet();
  });
  $('cardList').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-cardbuy]'); if (!b) return;
    const c = S.cards.find((x) => x.id === b.dataset.cardbuy); if (!c) return;
    if (!confirm(`ซื้อ “${c.name}” ราคา ${num(c.shop_price || price(c.rarity))} G ใช่ไหม?`)) return;
    b.disabled = true; await rpc('buy_card', { p_card: c.id }, `ซื้อ ${c.name} แล้ว`);
  });
  $('deckPanel').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    const dr = S.deckDraft; if (!dr) return;
    if (t.dataset.dslot) { S.deckSlot = t.dataset.dslot; renderDeck(); return; }
    const cur = S.deckSlot || 'main';
    if (t.dataset.dpick) { const id = t.dataset.dpick; const other = DSLOTS.find(([k]) => k !== cur && dr[k] === id); if (other) dr[other[0]] = dr[cur] || ''; dr[cur] = id; renderDeck(); return; }
    if (t.dataset.dclear) { dr[cur] = ''; renderDeck(); return; }
    if (t.dataset.dsave) { t.disabled = true; await rpc('set_deck', { p_main: dr.main || null, p_s1: dr.s1 || null, p_s2: dr.s2 || null, p_s3: dr.s3 || null }, 'บันทึกเด็คแล้ว'); }
  });

  Object.assign(App, { openKyc, levelInfo });
})();
