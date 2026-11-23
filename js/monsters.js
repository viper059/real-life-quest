/* Real-life Quest — monsters at real places: map of nearby monsters, walk there, fight in a 3D scene, earn EXP.
   Safety first: fighting is a stand-still scene, blocked while you are moving, and starts with a warning. */
(() => {
  const { sb, S, $, esc, num, toast, rpc, openSheet, closeSheet } = App;
  const KIND = { slime: ['🟢', 'สไลม์'], goblin: ['👺', 'ก็อบลิน'], bat: ['🦇', 'ค้างคาว'], golem: ['🗿', 'โกเลม'], dragon: ['🐲', 'มังกร'] };
  const MOVING_MS = 2.5; // m/s — faster than a brisk walk means "on the move"
  let L = null, map = null, layer = null, M = null, timer = null;

  const loadScript = (src, test) => new Promise((res, rej) => {
    if (test()) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลดไลบรารีไม่ได้')); document.head.appendChild(s);
  });
  function loadLeaflet() {
    if (!document.querySelector('link[href*="leaflet.min.css"]')) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    }
    return loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', () => window.L).then(() => { L = window.L; });
  }
  const loadThree = () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', () => window.THREE).then(() => window.THREE);

  function getPos() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('อุปกรณ์นี้หาตำแหน่งไม่ได้'));
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed }),
        () => rej(new Error('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    });
  }

  async function load() {
    const el = $('qsub-monster'); if (!el) return;
    if (!M) el.innerHTML = '<div class="empty">กำลังหาตำแหน่งของคุณ…</div>';
    try {
      const pos = await getPos();
      const { data, error } = await sb.rpc('nearby_monsters', { p_lat: pos.lat, p_lng: pos.lng });
      if (error) throw error;
      M = { pos, ...data };
      render();
    } catch (e) { el.innerHTML = `<div class="empty">${esc(App.errText(e))}<br><button class="btn sec sm" id="monRetry" style="margin-top:10px">ลองใหม่</button></div>`; }
  }
  App.loadMonsters = () => { load(); clearInterval(timer); timer = setInterval(() => { if (S.qsub === 'monster' && S.tab === 'board' && !document.hidden && $('sheet').classList.contains('hidden')) load(); }, 30000); };

  const moving = () => M && M.pos.speed != null && M.pos.speed > MOVING_MS;
  function status(m) {
    if (m.rest_until && new Date(m.rest_until) > Date.now()) return { ok: false, text: 'พักอยู่ · กลับมาได้ ' + new Date(m.rest_until).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' };
    if (M.kills_today >= M.daily_max) return { ok: false, text: `ครบ ${M.daily_max} ตัวแล้ววันนี้` };
    if (!m.in_range) return { ok: false, text: `ห่าง ${num(m.distance_m)} ม. — เดินเข้าไปให้อยู่ใน ${M.radius_m} ม.` };
    if (moving()) return { ok: false, text: 'กำลังเคลื่อนที่เร็ว — หยุดก่อนจึงจะสู้ได้' };
    return { ok: true, text: 'อยู่ในระยะ — สู้ได้เลย' };
  }

  async function render() {
    const el = $('qsub-monster'); if (!el || !M) return;
    el.innerHTML = `<div class="row between" style="margin:14px 0 10px"><h1 style="font-size:24px">มอนสเตอร์</h1><button class="btn sec sm" id="monRetry" type="button">รีเฟรชตำแหน่ง</button></div>
      <div class="card wood stack"><div class="row between small" style="color:var(--on-wood-muted)"><span>สู้แล้ววันนี้</span><span>${M.kills_today} / ${M.daily_max} ตัว</span></div>
        <div class="bar dark"><div style="width:${Math.min(100, Math.round(M.kills_today / M.daily_max * 100))}%;background:var(--exp)"></div></div>
        <span class="small" style="color:var(--on-wood-muted)">เดินไปหามอนสเตอร์ตามจุดบนแผนที่ แล้วสู้เมื่ออยู่ในระยะ ${M.radius_m} ม. · ห้ามเล่นขณะเดินหรือขับรถ</span></div>
      <div id="monMap" class="radar" style="margin-top:12px" aria-label="แผนที่มอนสเตอร์"></div>
      <div class="stack" style="margin-top:12px">${M.monsters.length ? M.monsters.map((m) => { const s = status(m), k = KIND[m.kind];
        return `<div class="card row" style="align-items:center;gap:12px"><div style="font-size:34px;line-height:1" aria-hidden="true">${k[0]}</div>
          <div style="flex:1;min-width:0"><b>${esc(m.name)}</b> <span class="rank">Lv.${m.level}</span>
            <div class="small muted">${k[1]} · +${m.exp} EXP${m.gold ? ` · +${m.gold} G` : ''}</div>
            <div class="small" style="color:${s.ok ? 'var(--teal-ink)' : 'var(--ink-muted)'}">${esc(s.text)}</div></div>
          <button class="btn ${s.ok ? 'action' : 'sec'} sm" data-fight="${m.id}" ${s.ok ? '' : 'disabled'}>สู้</button></div>`; }).join('')
        : '<div class="empty">ยังไม่มีมอนสเตอร์ในรัศมี 5 กม. จากคุณ<br><span class="small muted">ทีมงานจะวางมอนสเตอร์ตามสถานที่ต่าง ๆ เรื่อย ๆ</span></div>'}</div>`;
    try { await loadLeaflet(); } catch (e) { $('monMap').innerHTML = '<div class="empty">โหลดแผนที่ไม่ได้ ใช้รายการด้านล่างแทน</div>'; return; }
    if (map) { map.remove(); map = null; }
    map = L.map('monMap', { zoomControl: true }).setView([M.pos.lat, M.pos.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    L.circleMarker([M.pos.lat, M.pos.lng], { radius: 8, color: '#1f6f6b', fillColor: '#1f6f6b', fillOpacity: 0.9 }).addTo(layer).bindTooltip('คุณอยู่ที่นี่');
    M.monsters.forEach((m) => {
      L.circle([m.lat, m.lng], { radius: M.radius_m, color: '#b3261e', fillColor: '#b3261e', fillOpacity: 0.12, weight: 1 }).addTo(layer);
      L.marker([m.lat, m.lng], { icon: L.divIcon({ className: 'mon-pin', html: KIND[m.kind][0], iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(layer)
        .bindPopup(`<b>${esc(m.name)}</b> Lv.${m.level}<br>ห่าง ${num(m.distance_m)} ม.`);
    });
    setTimeout(() => map && map.invalidateSize(), 50);
  }

  /* ---------- monster models ---------- */
  function buildMonster(T, kind, level) {
    const g = new T.Group(), mat = (c) => new T.MeshStandardMaterial({ color: c, roughness: 0.7 });
    const add = (w, h, d, c, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
    const eyes = (y, z, s) => { add(s, s, 0.05, 0xffffff, -0.3, y, z); add(s, s, 0.05, 0xffffff, 0.3, y, z); add(s * 0.4, s * 0.4, 0.06, 0x111111, -0.3, y, z + 0.02); add(s * 0.4, s * 0.4, 0.06, 0x111111, 0.3, y, z + 0.02); };
    if (kind === 'slime') { add(1.8, 1.2, 1.6, 0x58c46a, 0, 0.6, 0); eyes(0.85, 0.82, 0.3); }
    else if (kind === 'goblin') { add(1.1, 1.3, 0.8, 0x6a9a3a, 0, 1.0, 0); add(1.0, 0.9, 0.9, 0x7bb049, 0, 2.0, 0); add(0.5, 0.2, 0.1, 0x6a9a3a, -0.75, 2.15, 0); add(0.5, 0.2, 0.1, 0x6a9a3a, 0.75, 2.15, 0); eyes(2.05, 0.46, 0.22); add(0.3, 1.0, 0.3, 0x6a9a3a, -0.75, 1.0, 0); add(0.3, 1.0, 0.3, 0x6a9a3a, 0.75, 1.0, 0); }
    else if (kind === 'bat') { add(0.9, 0.9, 0.7, 0x3a2f4a, 0, 1.4, 0); add(1.6, 0.12, 0.8, 0x2a2238, -1.3, 1.6, 0).rotation.z = 0.35; add(1.6, 0.12, 0.8, 0x2a2238, 1.3, 1.6, 0).rotation.z = -0.35; eyes(1.5, 0.37, 0.18); add(0.12, 0.3, 0.1, 0x3a2f4a, -0.25, 2.0, 0); add(0.12, 0.3, 0.1, 0x3a2f4a, 0.25, 2.0, 0); }
    else if (kind === 'golem') { add(1.8, 1.8, 1.2, 0x8a8a8a, 0, 1.3, 0); add(1.0, 0.9, 0.9, 0x9a9a9a, 0, 2.7, 0); add(0.7, 1.6, 0.7, 0x7a7a7a, -1.35, 1.3, 0); add(0.7, 1.6, 0.7, 0x7a7a7a, 1.35, 1.3, 0); eyes(2.75, 0.47, 0.2); }
    else { add(1.6, 1.3, 2.4, 0xb3261e, 0, 1.3, 0); add(0.9, 0.9, 1.0, 0xc4372f, 0, 2.1, 1.4); add(0.15, 0.5, 0.15, 0xf3e6c8, -0.3, 2.7, 1.3); add(0.15, 0.5, 0.15, 0xf3e6c8, 0.3, 2.7, 1.3);
      add(2.0, 0.12, 1.2, 0x8a1a14, -1.7, 2.0, 0).rotation.z = 0.5; add(2.0, 0.12, 1.2, 0x8a1a14, 1.7, 2.0, 0).rotation.z = -0.5; add(0.2, 0.2, 0.05, 0xffd24a, -0.25, 2.25, 1.92); add(0.2, 0.2, 0.05, 0xffd24a, 0.25, 2.25, 1.92); }
    const s = 0.9 + level * 0.05; g.scale.set(s, s, s);
    return g;
  }

  /* ---------- battle scene (Ragnarok-style: click the monster, auto-attack, skills, HP/SP, damage numbers) ---------- */
  function buildHero(T) {
    const g = new T.Group(), mat = (c) => new T.MeshStandardMaterial({ color: c, roughness: 0.7 });
    const part = (w, h, d, c, x, y, z, parent) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); (parent || g).add(m); return m; };
    part(0.45, 0.9, 0.5, 0x3a2f4a, -0.25, 0.45, 0); part(0.45, 0.9, 0.5, 0x3a2f4a, 0.25, 0.45, 0);          // legs
    part(1.1, 1.1, 0.7, 0x1f6f6b, 0, 1.45, 0);                                                                // torso
    part(1.14, 0.18, 0.74, 0xc9a86a, 0, 1.0, 0);                                                               // belt
    part(0.8, 0.8, 0.8, 0xf1c9a0, 0, 2.4, 0); part(0.86, 0.3, 0.86, 0x5a3d27, 0, 2.8, 0);                    // head + hair
    part(0.12, 0.12, 0.05, 0x111111, -0.18, 2.42, 0.41); part(0.12, 0.12, 0.05, 0x111111, 0.18, 2.42, 0.41); // eyes
    part(0.35, 1.0, 0.35, 0xf1c9a0, -0.75, 1.45, 0);                                                           // off arm
    const arm = new T.Group(); arm.position.set(0.75, 1.9, 0); g.add(arm);                                     // sword arm (pivot at shoulder)
    part(0.35, 1.0, 0.35, 0xf1c9a0, 0, -0.45, 0, arm);
    part(0.12, 1.5, 0.3, 0xdfe6ee, 0, -0.45, 0.45, arm).rotation.x = 0.1; part(0.5, 0.12, 0.2, 0xc9a86a, 0, -0.95, 0.4, arm);
    g.userData.arm = arm; return g;
  }

  async function startFight(id) {
    const m = M.monsters.find((x) => x.id === id); if (!m) return;
    let T; try { T = await loadThree(); } catch (e) { return toast(e.message, true); }
    const P = S.profile || {}, lv = P.base_level || 1, st = { str: P.str || 1, agi: P.agi || 1, vit: P.vit || 1, int: P.int || 1, dex: P.dex || 1, luk: P.luk || 1 };
    if (S.cards && S.deck) ['main_card', 'support1', 'support2', 'support3'].forEach((k) => { const c = S.cards.find((x) => x.id === S.deck[k]); if (c) Object.entries(c.stats || {}).forEach(([s, v]) => { if (s in st) st[s] += v; }); });
    const maxHp = 100 + st.vit * 20 + lv * 10, maxSp = 30 + st.int * 3, atk = 8 + st.str * 2 + lv;
    const aInt = Math.max(0.55, 1.5 - st.agi * 0.04), mMax = m.hp * 12, mAtk = 3 + m.level * 2.5, mInt = { bat: 1.4, golem: 2.2, dragon: 2.0 }[m.kind] || 1.8;
    const hitCh = Math.min(0.98, Math.max(0.5, 0.75 + (st.dex - m.level) * 0.03)), critCh = Math.min(0.4, 0.02 + st.luk * 0.01), fleeCh = Math.min(0.5, 0.03 + st.agi * 0.01);
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pHp = maxHp, pSp = maxSp, mHp = mMax, engaged = false, over = false, done = false, attacks = 0, t0 = null, last = null, aT = 0, mT = 0, spT = 0, bashCd = 0, healCd = 0, swing = -9, lunge = -9, mShake = -9, raf = 0;

    const ov = document.createElement('div'); ov.className = 'battle';
    ov.innerHTML = `<div class="b-top"><div class="b-mon"><b>${esc(m.name)}</b> <span class="rank">Lv.${m.level}</span><div class="bar b-bar"><div id="bMHp" style="width:100%;background:var(--danger)"></div></div></div><button class="btn sec sm" id="bFlee" type="button">🏃 หนี</button></div>
      <div class="b-stage" id="bStage"><div class="b-hint small" id="bHint">แตะมอนสเตอร์เพื่อเริ่มโจมตี</div></div>
      <div class="b-hud"><div class="b-me"><div class="small"><b>Viper</b> Lv.${lv}</div>
        <div class="b-line"><span>HP</span><div class="bar b-bar"><div id="bHp" style="width:100%;background:#3aa86a"></div></div><span id="bHpT">${maxHp}</span></div>
        <div class="b-line"><span>SP</span><div class="bar b-bar"><div id="bSp" style="width:100%;background:#3a7ad8"></div></div><span id="bSpT">${maxSp}</span></div></div>
        <div class="b-skills"><button class="b-sk" id="bAtk" type="button">⚔️<small>โจมตี</small></button><button class="b-sk" id="bBash" type="button">💥<small>Bash · 10SP</small></button><button class="b-sk" id="bHeal" type="button">✨<small>ฮีล · 15SP</small></button></div></div>`;
    document.body.appendChild(ov); document.body.style.overflow = 'hidden';
    const $b = (x) => ov.querySelector('#' + x), stage = $b('bStage');

    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); stage.prepend(renderer.domElement);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(48, 1, 0.1, 80);
    scene.add(new T.HemisphereLight(0xfff3d6, 0x3a2618, 1.0)); const dl = new T.DirectionalLight(0xffffff, 0.8); dl.position.set(4, 8, 6); scene.add(dl);
    const ground = new T.Mesh(new T.CylinderGeometry(5.5, 5.8, 0.3, 40), new T.MeshStandardMaterial({ color: 0x6b4a2e })); ground.position.y = -0.15; scene.add(ground);
    const ring = new T.Mesh(new T.RingGeometry(4.4, 4.6, 40), new T.MeshBasicMaterial({ color: 0xc9a86a, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
    const HX = -2.1, MX = 2.1, hero = buildHero(T), mon = buildMonster(T, m.kind, m.level); hero.position.set(HX, 0, 0); hero.rotation.y = Math.PI / 2 - 0.3; mon.position.set(MX, 0, 0); mon.rotation.y = -Math.PI / 2 + 0.3; scene.add(hero, mon);
    const fit = () => { const w = stage.clientWidth || 320, h = stage.clientHeight || 400; renderer.setSize(w, h); cam.aspect = w / h; const d = Math.max(11, 4.2 / (Math.tan(cam.fov * Math.PI / 360) * cam.aspect)); cam.position.set(0, d * 0.42, d); cam.lookAt(0, 1.3, 0); cam.updateProjectionMatrix(); };
    fit(); window.addEventListener('resize', fit);

    const screenOf = (obj, dy) => { const v = new T.Vector3(); obj.getWorldPosition(v); v.y += dy; v.project(cam); return [(v.x * 0.5 + 0.5) * stage.clientWidth, (-v.y * 0.5 + 0.5) * stage.clientHeight]; };
    const float = (obj, dy, text, cls) => { const [x, y] = screenOf(obj, dy), n = document.createElement('div'); n.className = 'b-num ' + (cls || ''); n.textContent = text; n.style.left = x + 'px'; n.style.top = y + 'px'; stage.appendChild(n); setTimeout(() => n.remove(), 950); };
    const bars = () => { $b('bMHp').style.width = Math.max(0, mHp / mMax * 100) + '%'; $b('bHp').style.width = Math.max(0, pHp / maxHp * 100) + '%'; $b('bSp').style.width = pSp / maxSp * 100 + '%'; $b('bHpT').textContent = Math.max(0, Math.round(pHp)); $b('bSpT').textContent = Math.floor(pSp); $b('bBash').disabled = pSp < 10 || bashCd > 0 || over; $b('bHeal').disabled = pSp < 15 || healCd > 0 || over; };
    const rnd = () => 0.9 + Math.random() * 0.2;
    const engage = () => { if (over) return; engaged = true; $b('bHint').style.display = 'none'; $b('bAtk').classList.add('on'); };
    const heroHit = (mult, sure) => {
      attacks += 1; swing = lunge = performance.now() / 1000;
      if (!sure && Math.random() > hitCh) return float(mon, 2.6, 'MISS', 'miss');
      const crit = Math.random() < critCh, dmg = Math.max(1, Math.round(atk * mult * rnd() * (crit ? 1.6 : 1)));
      mHp -= dmg; mShake = performance.now() / 1000; float(mon, 2.6, (crit ? '✦' : '') + dmg, crit ? 'crit' : 'hit');
    };
    const monHit = () => {
      if (Math.random() < fleeCh) return float(hero, 3.2, 'MISS', 'miss');
      const dmg = Math.max(1, Math.round((mAtk * rnd()) - st.vit * 0.4)); pHp -= dmg; float(hero, 3.2, dmg, 'hurt');
      hero.position.x = HX - 0.12; setTimeout(() => { hero.position.x = HX; }, 90);
    };
    const finish = async (won) => {
      over = true; engaged = false; bars();
      const box = document.createElement('div'); box.className = 'mon-win';
      if (!won) { box.innerHTML = '<div style="font-size:46px">💀</div><b>แพ้แล้ว</b><div class="small">เลเวลหรือค่าสถานะยังไม่พอ — เก็บ EXP จากกิจวัตรและเควสต์แล้วกลับมาใหม่</div><button class="btn sec" id="bClose" type="button">กลับ</button>'; stage.appendChild(box); $b('bClose').onclick = close; return; }
      box.innerHTML = '<div style="font-size:46px">🏆</div><b>ชนะแล้ว!</b><div class="small">กำลังบันทึกรางวัล…</div>'; stage.appendChild(box); mon.visible = false;
      const dur = Math.max(0.1, (performance.now() - t0) / 1000);
      let p = M.pos; try { p = await getPos(); } catch (_) { /* keep the position the fight started at */ }
      const r = await rpc('defeat_monster', { p_monster: m.id, p_lat: p.lat, p_lng: p.lng, p_taps: attacks, p_duration_s: dur });
      box.innerHTML = r && r !== true ? `<div style="font-size:46px">🏆</div><b>ชนะแล้ว!</b><div>+${r.exp} EXP${r.gold ? ` · +${r.gold} G` : ''}</div><button class="btn primary" id="bClose" type="button">เสร็จสิ้น</button>`
        : '<div style="font-size:40px">⚠️</div><b>บันทึกชัยชนะไม่ได้</b><div class="small">ดูข้อความแจ้งเตือนด้านบน</div><button class="btn sec" id="bClose" type="button">ปิด</button>';
      $b('bClose').onclick = close;
    };
    const frame = (ts) => {
      if (done) return;
      const now = ts / 1000, dt = last == null ? 0 : Math.min(0.1, now - last); last = now;
      if (!over && engaged) {
        if (t0 == null) t0 = performance.now();
        aT += dt; mT += dt;
        if (aT >= aInt) { aT = 0; heroHit(1); }
        if (mT >= mInt) { mT = 0; monHit(); }
        if (mHp <= 0) finish(true); else if (pHp <= 0) finish(false);
      }
      if (!over) { spT += dt; if (spT >= 2 && pSp < maxSp) { spT = 0; pSp = Math.min(maxSp, pSp + 1); } bashCd = Math.max(0, bashCd - dt); healCd = Math.max(0, healCd - dt); }
      bars();
      const t = performance.now() / 1000, sw = t - swing, lg = t - lunge, sh = t - mShake;
      hero.userData.arm.rotation.x = sw < 0.3 && !reduced ? -Math.sin(sw / 0.3 * Math.PI) * 2.2 : 0;
      hero.position.x = HX + (lg < 0.3 && !reduced ? Math.sin(lg / 0.3 * Math.PI) * 0.9 : 0);
      mon.position.x = MX + (sh < 0.2 && !reduced ? Math.sin(sh * 50) * 0.15 : 0);
      if (!reduced) { hero.position.y = Math.abs(Math.sin(now * 2)) * 0.05; if (!over) mon.position.y = Math.abs(Math.sin(now * 2 + 1)) * 0.1; }
      if (over && mHp <= 0) mon.rotation.z = Math.min(Math.PI / 2, mon.rotation.z + dt * 3);
      renderer.render(scene, cam); raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const ray = new T.Raycaster();
    renderer.domElement.addEventListener('pointerdown', (ev) => { const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera({ x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 }, cam); if (ray.intersectObject(mon, true).length) engage(); });
    $b('bAtk').onclick = engage;
    $b('bBash').onclick = () => { if (over || pSp < 10 || bashCd > 0) return; engage(); pSp -= 10; bashCd = 4; heroHit(2.5, true); };
    $b('bHeal').onclick = () => { if (over || pSp < 15 || healCd > 0) return; engage(); pSp -= 15; healCd = 8; const h = Math.round(maxHp * 0.25); pHp = Math.min(maxHp, pHp + h); float(hero, 3.2, '+' + h, 'heal'); };
    function close() { done = true; cancelAnimationFrame(raf); window.removeEventListener('resize', fit); renderer.dispose(); ov.remove(); document.body.style.overflow = ''; load(); }
    $b('bFlee').onclick = close;
  }

  $('qsub-monster').addEventListener('click', (ev) => {
    if (ev.target.closest('#monRetry')) { load(); return; }
    const b = ev.target.closest('[data-fight]'); if (!b || b.disabled) return;
    const id = b.dataset.fight;
    openSheet('ก่อนสู้มอนสเตอร์', `<div class="stack"><div class="card" style="border-color:var(--gold-500)"><b>⚠️ ความปลอดภัยก่อน</b>
        <ul class="small" style="margin:6px 0 0;padding-left:18px"><li>หยุดยืนในที่ปลอดภัย ห่างจากถนนและรถวิ่ง</li><li>ห้ามเล่นขณะเดิน ขี่ หรือขับรถ</li><li>มองรอบตัวก่อนก้มดูจอ</li></ul></div>
        <button class="btn action" id="monGo" type="button">ฉันหยุดอยู่ในที่ปลอดภัยแล้ว — เริ่มสู้</button></div>`);
    $('monGo').onclick = () => { closeSheet(); startFight(id); };
  });
})();
