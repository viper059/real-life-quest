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

  /* ---------- fight scene ---------- */
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

  async function startFight(id) {
    const m = M.monsters.find((x) => x.id === id); if (!m) return;
    let T; try { T = await loadThree(); } catch (e) { return toast(e.message, true); }
    let hp = m.hp, taps = 0, t0 = null, raf = 0, done = false, hitAt = -10;
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    openSheet(m.name, `<div class="stack">
        <div class="row between small"><span class="rank">Lv.${m.level}</span><span id="monHp">HP ${hp} / ${m.hp}</span></div>
        <div class="bar"><div id="monHpBar" style="width:100%;background:var(--danger)"></div></div>
        <div class="avatar-stage" id="monStage" style="height:300px;touch-action:manipulation"></div>
        <button class="btn action" id="monHit" type="button" style="min-height:52px;font-size:17px">⚔️ โจมตี!</button>
        <span class="small muted" id="monMsg">แตะปุ่มรัว ๆ จนกว่ามอนสเตอร์จะล้ม (${m.hp} ครั้ง) · ยืนอยู่กับที่ในที่ปลอดภัย</span></div>`,
      () => { done = true; cancelAnimationFrame(raf); });
    const stage = $('monStage'), W = stage.clientWidth || 320, H = 300;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(W, H); stage.prepend(renderer.domElement);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, W / H, 0.1, 50); cam.position.set(0, 2.6, 8); cam.lookAt(0, 1.4, 0);
    scene.add(new T.HemisphereLight(0xfff3d6, 0x3a2618, 1.0)); const dl = new T.DirectionalLight(0xffffff, 0.7); dl.position.set(3, 6, 5); scene.add(dl);
    const floor = new T.Mesh(new T.CylinderGeometry(2.6, 2.8, 0.2, 32), new T.MeshStandardMaterial({ color: 0x5a3d27 })); floor.position.y = -0.1; scene.add(floor);
    const mon = buildMonster(T, m.kind, m.level); scene.add(mon);
    const frame = (ts) => {
      if (done) { renderer.dispose(); return; }
      const t = ts / 1000, since = t - hitAt;
      mon.position.y = reduced ? 0 : Math.abs(Math.sin(t * 2)) * 0.12;
      mon.rotation.y = reduced ? 0 : Math.sin(t * 0.8) * 0.25;
      mon.position.x = since < 0.18 && !reduced ? Math.sin(since * 60) * 0.18 : 0;
      renderer.render(scene, cam); raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const hit = async () => {
      if (done || hp <= 0) return;
      if (t0 == null) t0 = performance.now();
      hp -= 1; taps += 1; hitAt = performance.now() / 1000;
      $('monHp').textContent = `HP ${Math.max(0, hp)} / ${m.hp}`; $('monHpBar').style.width = Math.max(0, hp / m.hp * 100) + '%';
      if (hp > 0) return;
      $('monHit').disabled = true; $('monMsg').textContent = 'กำลังบันทึกชัยชนะ…';
      const dur = Math.max(0.1, (performance.now() - t0) / 1000);
      let p = M.pos; try { p = await getPos(); } catch (_) { /* fall back to the position the fight started at */ }
      const r = await rpc('defeat_monster', { p_monster: m.id, p_lat: p.lat, p_lng: p.lng, p_taps: taps, p_duration_s: dur });
      if (r && r !== true) {
        $('monStage').insertAdjacentHTML('beforeend', `<div class="mon-win"><div style="font-size:46px">🏆</div><b>ชนะแล้ว!</b><div>+${r.exp} EXP${r.gold ? ` · +${r.gold} G` : ''}</div></div>`);
        $('monMsg').innerHTML = '<button class="btn primary" id="monDone" type="button" style="width:100%">เสร็จสิ้น</button>';
        $('monDone').onclick = () => { closeSheet(); load(); };
        mon.visible = false;
      } else { $('monMsg').innerHTML = '<button class="btn sec" id="monDone" type="button" style="width:100%">ปิด</button>'; $('monDone').onclick = () => { closeSheet(); load(); }; }
    };
    $('monHit').onclick = hit;
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
