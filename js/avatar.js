/* Real-life Quest — 3D blocky avatar (three.js r128 from cdnjs, loaded on first use).
   Drag to spin, pinch or wheel to zoom, double-tap to reset. Equipped items appear on the model. */
(() => {
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  let T = null, loading = null;
  const load = () => T ? Promise.resolve(T) : (loading = loading || new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = THREE_URL;
    s.onload = () => { T = window.THREE; res(T); }; s.onerror = () => rej(new Error('โหลดโมเดล 3 มิติไม่ได้'));
    document.head.appendChild(s);
  }));

  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = document.createElement('div');
  stage.className = 'avatar-stage';
  stage.innerHTML = '<div class="avatar-hint small">ลากเพื่อหมุน · ถ่างนิ้วหรือเลื่อนลูกกลิ้งเพื่อซูม · แตะสองครั้งรีเซ็ต</div>';
  stage.setAttribute('role', 'img');

  let renderer, scene, camera, root, rig = {}, itemsGroup, platform, spec = null, started = false;
  let yaw = 0.5, pitch = 0.12, dist = 8.6, autoSpin = !reduced, t0 = performance.now(), visible = true;

  const mat = (c, opts) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0.05 }, opts || {}));
  const box = (w, h, d, m) => new T.Mesh(new T.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg) => new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 24), m);

  function build() {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = T.sRGBEncoding;
    stage.prepend(renderer.domElement);
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
    scene.add(new T.HemisphereLight(0xfff4dc, 0x3a2618, 0.9));
    const sun = new T.DirectionalLight(0xffffff, 0.8); sun.position.set(3, 6, 4); scene.add(sun);
    const rim = new T.DirectionalLight(0xe8b13a, 0.35); rim.position.set(-4, 3, -4); scene.add(rim);

    platform = cyl(1.5, 1.6, 0.18, mat('#c9a86a', { metalness: 0.3, roughness: 0.5 }), 48);
    platform.position.y = -0.09; scene.add(platform);
    const ring = new T.Mesh(new T.TorusGeometry(1.52, 0.06, 12, 64), mat('#8a6a3a', { metalness: 0.5 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; scene.add(ring); rig.ring = ring;

    root = new T.Group(); scene.add(root);
    // body parts (Roblox-like proportions, original design)
    rig.legL = new T.Group(); rig.legR = new T.Group();
    [[rig.legL, -0.26], [rig.legR, 0.26]].forEach(([g, x]) => {
      g.position.set(x, 1.5, 0);
      const leg = box(0.48, 1.2, 0.5, null); leg.position.y = -0.6; leg.name = 'leg'; g.add(leg);
      const shoe = box(0.5, 0.26, 0.6, null); shoe.position.set(0, -1.37, 0.05); shoe.name = 'shoe'; g.add(shoe);
      root.add(g);
    });
    rig.torso = box(1.04, 1.2, 0.54, null); rig.torso.position.y = 2.1; root.add(rig.torso);
    rig.armL = new T.Group(); rig.armR = new T.Group();
    [[rig.armL, -0.78], [rig.armR, 0.78]].forEach(([g, x]) => {
      g.position.set(x, 2.68, 0);
      const sleeve = box(0.48, 0.5, 0.5, null); sleeve.position.y = -0.25; sleeve.name = 'sleeve'; g.add(sleeve);
      const arm = box(0.46, 0.72, 0.48, null); arm.position.y = -0.86; arm.name = 'arm'; g.add(arm);
      root.add(g);
    });
    rig.head = new T.Group(); rig.head.position.y = 2.7; root.add(rig.head);
    const head = box(0.74, 0.74, 0.74, null); head.position.y = 0.37; head.name = 'skull'; rig.head.add(head);
    const hair = box(0.78, 0.22, 0.78, null); hair.position.y = 0.72; hair.name = 'hair'; rig.head.add(hair);
    const fringe = box(0.78, 0.16, 0.12, null); fringe.position.set(0, 0.6, 0.34); fringe.name = 'hair'; rig.head.add(fringe);
    const eyeM = mat('#2a1e14');
    [-0.15, 0.15].forEach((x) => { const e = box(0.09, 0.13, 0.02, eyeM); e.position.set(x, 0.42, 0.38); rig.head.add(e); });
    const mouth = box(0.2, 0.04, 0.02, mat('#8a3a0b')); mouth.position.set(0, 0.24, 0.38); rig.head.add(mouth);
    itemsGroup = new T.Group(); root.add(itemsGroup);
    bindControls();
    new ResizeObserver(resize).observe(stage);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(stage);
    resize(); started = true; requestAnimationFrame(tick);
  }

  function paint() {
    const a = Object.assign({ skin: '#f1c27d', hair: '#2a1b11', shirt: '#1f6f6b', pants: '#3a2618', shoes: '#2a1b11' }, spec.avatar || {});
    const set = (obj, name, color) => obj.traverse((o) => { if (o.isMesh && o.name === name) o.material = mat(color); });
    set(rig.head, 'skull', a.skin); set(rig.head, 'hair', a.hair);
    rig.torso.material = mat(a.shirt);
    [rig.armL, rig.armR].forEach((g) => { set(g, 'sleeve', a.shirt); set(g, 'arm', a.skin); });
    [rig.legL, rig.legR].forEach((g) => { set(g, 'leg', a.pants); set(g, 'shoe', a.shoes); });
    rig.ring.material = mat(spec.frame || '#8a6a3a', { metalness: 0.6, roughness: 0.35, emissive: spec.frame || '#000000', emissiveIntensity: spec.frame ? 0.25 : 0 });
  }

  // Item models. Unknown items fall back to a simple piece for their slot, tinted by item colour or tier.
  function wear(item) {
    const c = (item.data && item.data.color) || item.tierColor || '#c9a86a';
    const g = new T.Group(), M = mat(c, { metalness: item.tier === 'epic' ? 0.35 : 0.1, roughness: 0.55 });
    const add = (m, x, y, z, parent) => { m.position.set(x, y, z); (parent || g).add(m); return m; };
    switch (item.id) {
      case 'hat_straw': add(cyl(0.75, 0.75, 0.05, mat('#d9b56b')), 0, 0.78, 0, rig.head); add(cyl(0.36, 0.42, 0.3, mat('#d9b56b')), 0, 0.93, 0, rig.head);
        add(cyl(0.43, 0.43, 0.08, mat('#8a3a0b')), 0, 0.84, 0, rig.head); return;
      case 'cap_basic': add(cyl(0.42, 0.42, 0.26, M), 0, 0.86, 0, rig.head); add(box(0.6, 0.04, 0.34, M), 0, 0.76, 0.48, rig.head); return;
      case 'helmet_safety': { const h = add(new T.Mesh(new T.SphereGeometry(0.48, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M), 0, 0.74, 0, rig.head);
        add(cyl(0.58, 0.58, 0.05, M), 0, 0.75, 0.04, rig.head); add(box(0.1, 0.12, 0.92, M), 0, 0.98, 0, rig.head); return h; }
      case 'jacket_explorer': rig.torso.add(add(box(1.1, 1.24, 0.6, mat('#a07b47')), 0, 0, 0, null));
        [rig.armL, rig.armR].forEach((a) => add(box(0.52, 0.86, 0.54, mat('#a07b47')), 0, -0.42, 0, a));
        add(box(0.06, 1.1, 0.02, mat('#6b4a2a')), 0, 0, 0.31, rig.torso); return;
      case 'apron_work': add(box(0.86, 1.3, 0.04, M), 0, -0.12, 0.29, rig.torso); add(box(0.5, 0.24, 0.04, mat('#4a3726')), 0, -0.25, 0.32, rig.torso); return;
      case 'cape_epic': { const cape = add(box(1.0, 1.9, 0.06, mat(c, { side: T.DoubleSide, metalness: 0.3 })), 0, -0.45, -0.32, rig.torso); cape.rotation.x = 0.12; rig.cape = cape;
        add(box(1.08, 0.12, 0.6, M), 0, 0.56, 0, rig.torso); return; }
      case 'boots_travel': [rig.legL, rig.legR].forEach((l) => { add(box(0.54, 0.5, 0.64, mat('#5a3d27')), 0, -1.27, 0.05, l); add(box(0.56, 0.06, 0.66, mat('#c9a86a')), 0, -1.03, 0.05, l); }); return;
      case 'wrench_gold': { const w = new T.Group(); add(box(0.1, 0.9, 0.1, M), 0, -0.2, 0, w); add(new T.Mesh(new T.TorusGeometry(0.14, 0.06, 8, 16, Math.PI * 1.5), M), 0, 0.3, 0, w);
        w.position.set(0, -1.25, 0.18); w.rotation.x = Math.PI / 2.2; rig.armR.add(w); return; }
      case 'gloves_worker': [rig.armL, rig.armR].forEach((a) => add(box(0.5, 0.3, 0.52, mat('#c27a0e')), 0, -1.1, 0, a)); return;
      case 'charm_luck': add(new T.Mesh(new T.OctahedronGeometry(0.12), mat('#b3261e', { emissive: '#b3261e', emissiveIntensity: 0.3 })), 0.28, 0.25, 0.3, rig.torso);
        add(box(0.02, 0.5, 0.02, mat('#e8b13a')), 0.15, 0.4, 0.29, rig.torso).rotation.z = 0.6; return;
      case 'bag_courier': add(box(0.8, 0.7, 0.3, mat('#2e7d4f')), 0, -0.05, -0.43, rig.torso); { const s = add(box(0.1, 1.5, 0.58, mat('#1f5a45')), 0, 0, 0, rig.torso); s.rotation.z = 0.75; } return;
      case 'glasses_round': [-0.15, 0.15].forEach((x) => { const r = add(new T.Mesh(new T.TorusGeometry(0.1, 0.022, 8, 20), M), x, 0.42, 0.39, rig.head); });
        add(box(0.1, 0.02, 0.02, M), 0, 0.44, 0.39, rig.head); return;
    }
    // generic by slot
    if (item.slot === 'head') add(box(0.82, 0.26, 0.82, M), 0, 0.86, 0, rig.head);
    else if (item.slot === 'body') add(box(1.1, 1.24, 0.6, M), 0, 0, 0, rig.torso);
    else if (item.slot === 'feet') [rig.legL, rig.legR].forEach((l) => add(box(0.54, 0.4, 0.64, M), 0, -1.32, 0.05, l));
    else if (item.slot === 'tool') add(box(0.12, 0.9, 0.12, M), 0, -1.3, 0.2, rig.armR).rotation.x = Math.PI / 2.2;
    else if (item.slot === 'acc') add(new T.Mesh(new T.SphereGeometry(0.12, 12, 8), M), 0.3, 0.3, 0.3, rig.torso);
  }

  function dressUp() {
    // clear previous items from every body part
    const kill = [];
    root.traverse((o) => { if (o.userData.item) kill.push(o); });
    kill.forEach((o) => o.parent.remove(o));
    rig.cape = null;
    (spec.items || []).forEach((it) => {
      const before = new Set(); root.traverse((o) => before.add(o));
      wear(it);
      root.traverse((o) => { if (!before.has(o)) o.userData.item = true; });
    });
  }

  function resize() {
    if (!renderer) return;
    const w = stage.clientWidth || 300, h = stage.clientHeight || 340;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function bindControls() {
    const el = renderer.domElement; el.style.touchAction = 'none';
    const pts = new Map(); let lastPinch = 0, lastTap = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); autoSpin = false;
      const now = Date.now(); if (now - lastTap < 300) { yaw = 0.5; pitch = 0.12; dist = 8.6; autoSpin = !reduced; } lastTap = now;
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { yaw -= (e.clientX - p.x) * 0.012; pitch = Math.max(-0.35, Math.min(0.7, pitch + (e.clientY - p.y) * 0.006)); }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) dist = Math.max(3.6, Math.min(11, dist * lastPinch / d)); lastPinch = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) lastPinch = 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(3.6, Math.min(11, dist * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
    el.tabIndex = 0;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { yaw += 0.2; autoSpin = false; } if (e.key === 'ArrowRight') { yaw -= 0.2; autoSpin = false; }
      if (e.key === '+' || e.key === '=') dist = Math.max(3.6, dist * 0.9); if (e.key === '-') dist = Math.min(11, dist * 1.1);
    });
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible || !document.body.contains(stage)) return;
    const t = (now - t0) / 1000;
    if (autoSpin) yaw += 0.006;
    const cy = 1.75;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, cy + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, cy, 0);
    if (!reduced) {
      const s = Math.sin(t * 2);
      root.position.y = Math.abs(Math.sin(t * 2)) * 0.03;
      rig.armL.rotation.x = s * 0.12; rig.armR.rotation.x = -s * 0.12;
      rig.head.rotation.y = Math.sin(t * 0.7) * 0.15;
      if (rig.cape) rig.cape.rotation.x = 0.12 + Math.sin(t * 2.4) * 0.05;
    }
    renderer.render(scene, camera);
  }

  async function show(slot, newSpec) {
    spec = newSpec;
    if (stage.parentNode !== slot) slot.appendChild(stage);
    stage.setAttribute('aria-label', 'ตัวละคร 3 มิติ' + ((spec.items || []).length ? ' สวม ' + spec.items.map((i) => i.name).join(', ') : ''));
    try { await load(); } catch (e) { stage.innerHTML = '<div class="empty">โหลดโมเดล 3 มิติไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่</div>'; return; }
    if (!started) build();
    paint(); dressUp(); resize();
  }

  App.avatar = { show };
})();
