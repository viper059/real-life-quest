/* Real-life Quest — core: client, state, helpers, auth, loading, routing, notifications, push. */
(() => {
  const SUPABASE_URL = 'https://hkujzoluicokvvwlnffd.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_EqpS2q5qOoQfT0i3pFFgJQ_LKRJpKpN';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const CATS = {
    general: { label: 'ทั่วไป', bg: '#efe6d2', fg: '#4a3726' },
    home: { label: 'งานบ้าน', bg: '#e4efe9', fg: '#1f5a45' },
    delivery: { label: 'ส่งของ', bg: '#f6e8cf', fg: '#7a4a06' },
    tutor: { label: 'สอนพิเศษ', bg: '#e8e4f3', fg: '#3f3576' },
    repair: { label: 'งานช่าง', bg: '#e3ecf3', fg: '#24486a' },
    electric: { label: 'ช่างไฟฟ้า', bg: '#f3eccf', fg: '#5c4a06' },
    family: { label: 'ครอบครัว', bg: '#f3e3ec', fg: '#7a2e58' }
  };
  const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
  const RANK_LABEL = { F: 'ฝึกหัด', E: 'จูเนียร์', D: 'มีประสบการณ์', C: 'ซีเนียร์', B: 'หัวหน้างาน', A: 'ผู้เชี่ยวชาญ', S: 'ปรมาจารย์' };
  const TX = {
    quest_escrow: 'ล็อกรางวัลเควสต์', quest_paid: 'จ่ายรางวัลเควสต์', quest_reward: 'รางวัลเควสต์', quest_refund: 'คืน Gold เควสต์',
    platform_fee: 'ค่าธรรมเนียมแพลตฟอร์ม', withdraw_hold: 'ล็อกเพื่อถอน', withdraw_paid: 'ถอนสำเร็จ', withdraw_refund: 'คืน Gold (ถอนไม่ผ่าน)',
    guild_contribute: 'สมทบกองทุนกิลด์', guild_refund: 'คืนเงินกองทุน (ปิดกิลด์)', guild_claim_paid: 'ได้รับเงินเคลมกองทุน',
    topup_gold: 'เติม Gold', topup_crystal: 'เติม Crystal', crystal_sent: 'ส่ง Crystal', crystal_received: 'ได้รับ Crystal', shop_buy: 'ซื้อของในร้าน'
  };
  const ERR = [
    ['not enough gold', 'Gold ไม่พอ'], ['not enough crystal', 'Crystal ไม่พอ'], ['quest not available', 'เควสต์นี้ไม่ว่างแล้ว'],
    ['identity not verified', 'ต้องยืนยันตัวตนก่อน'], ['career rank too low', 'ขั้นอาชีพยังไม่ถึงที่งานนี้กำหนด'], ['account banned', 'บัญชีถูกระงับ'],
    ['family only', 'เฉพาะลูกในบ้านนี้'], ['own quest', 'เป็นเควสต์ของคุณเอง'], ['location required', 'ต้องปักหมุดตำแหน่งงาน'],
    ['too far from the job site', 'อยู่ไกลจากหน้างานเกินไป'], ['already checked in', 'เช็กอินอยู่แล้ว'], ['check out first', 'ต้องเช็กเอาต์ก่อน'],
    ['check in first', 'ต้องเช็กอินหน้างานก่อนส่งงาน'], ['not checked in', 'ยังไม่ได้เช็กอิน'], ['cannot cancel', 'ยกเลิกไม่ได้ — มีการเริ่มงานแล้ว ใช้ข้อพิพาทแทน'],
    ['cannot confirm', 'ยืนยันไม่ได้ (อาจมีข้อพิพาทอยู่)'], ['review window closed', 'เลยเวลารีวิว 14 วันแล้ว'], ['duplicate key', 'ทำรายการนี้ไปแล้ว'],
    ['withdrawals are closed', 'Gold และ Crystal ถอนเป็นเงินไม่ได้'], ['not signed in', 'กรุณาเข้าสู่ระบบใหม่'], ['urgent window', 'ช่วงเวลาด่วนต้องอยู่ระหว่าง 10 นาทีถึง 24 ชม.'],
    ['due time must be in the future', 'กำหนดส่งต้องเป็นเวลาในอนาคต'], ['top-up not open yet', 'ยังไม่เปิดเติมเงิน'], ['below minimum top-up', 'ต่ำกว่ายอดเติมขั้นต่ำ'],
    ['too many open orders', 'มีคำสั่งเติมเงินค้างอยู่ 3 รายการแล้ว'], ['daily transfer limit', 'เกินวงเงินส่ง Crystal ต่อวัน'], ['user not found', 'ไม่พบชื่อผู้ใช้นี้'],
    ['already owned', 'มีของชิ้นนี้แล้ว'], ['no free personal slots', 'ช่องเควสต์ส่วนตัวเต็ม — เลเวลอัปหรือซื้อช่องเพิ่ม'], ['not done yet', 'ยังทำไม่ครบ'], ['too soon', 'เร็วเกินไป รออีกสักพัก'], ['outside time window', 'ไม่อยู่ในช่วงเวลาที่ทำได้'], ['done for today', 'ครบจำนวนวันนี้แล้ว'], ['weekdays only', 'เฉพาะวันจันทร์–ศุกร์'], ['earlier step first', 'ต้องเช็กอินไปเรียนหรือไปทำงานก่อน'], ['set your place first', 'ตั้งตำแหน่งก่อน'], ['too far from your saved place', 'ไม่ได้อยู่ที่ตำแหน่งที่ตั้งไว้'], ['place locked', 'ตั้งตำแหน่งใหม่ได้หลังครบ 30 วัน'], ['photo required', 'ต้องแนบรูป'], ['choose your role', 'เลือกก่อนว่าเป็นนักเรียนหรือคนทำงาน'], ['not your role', 'กิจวัตรนี้ไม่ใช่ของบทบาทคุณ'], ['role locked', 'เปลี่ยนบทบาทได้หลังครบ 30 วัน'],
    ['already opened today', 'เปิดหีบวันนี้แล้ว'], ['requirements not met', 'ยังไม่ผ่านเงื่อนไขเลื่อนขั้น'], ['portfolio required', 'ต้องแนบผลงาน'],
    ['license required', 'อาชีพนี้ต้องเทียบโอนพร้อมใบอนุญาต'], ['endorser rank too low', 'ต้องเป็นซีเนียร์ (C) ขึ้นไปจึงรับรองได้'],
    ['no job together', 'ต้องเคยทำงานด้วยกันในอาชีพนี้'], ['already submitted', 'ส่งคำขอไปแล้ว'], ['already in a guild', 'คุณอยู่ในกิลด์อื่นแล้ว'],
    ['guild is full', 'กิลด์เต็มแล้ว'], ['transfer leadership first', 'ต้องโอนตำแหน่งหัวกิลด์ก่อน'], ['claim exceeds fund', 'ยอดเคลมเกินเงินในกองทุน'],
    ['you already have an open claim', 'คุณมีเคลมค้างอยู่'], ['voting closed', 'ปิดโหวตแล้ว'], ['cannot vote on your own claim', 'โหวตเคลมของตัวเองไม่ได้'],
    ['guilds_name_key', 'ชื่อกิลด์นี้มีคนใช้แล้ว'], ['already in a family', 'คุณอยู่ในครอบครัวอื่นแล้ว'], ['family code not found', 'ไม่พบรหัสบ้านนี้'],
    ['parents only', 'เฉพาะผู้ปกครอง'], ['not enough stat points', 'แต้มไม่พอ'], ['card not owned', 'ยังไม่มีการ์ดใบนี้'], ['duplicate card', 'ใส่การ์ดซ้ำไม่ได้'],
    ['Invalid login credentials', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'], ['Email not confirmed', 'ยังไม่ได้ยืนยันอีเมล — เช็กกล่องจดหมาย'],
    ['User already registered', 'อีเมลนี้สมัครแล้ว'], ['cannot open a dispute', 'เปิดข้อพิพาทไม่ได้ในสถานะนี้'], ['not part of this quest', 'คุณไม่ได้อยู่ในงานนี้']
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const errText = (e) => { const m = (e && (e.message || e.error_description)) || String(e); const hit = ERR.find(([k]) => m.includes(k)); return hit ? hit[1] : m; };
  const ago = (iso) => { if (!iso) return ''; const s = (Date.now() - new Date(iso)) / 1000; if (s < 0) return when(iso); if (s < 60) return 'เมื่อสักครู่'; if (s < 3600) return Math.floor(s / 60) + ' นาที'; if (s < 86400) return Math.floor(s / 3600) + ' ชม.'; return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); };
  const when = (iso) => iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const hours = (min) => { min = Number(min || 0); const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h} ชม. ${m} นาที` : `${h} ชม.`) : `${m} นาที`; };
  const rating = (sum, count) => count ? (sum / count).toFixed(1) + ' ★ (' + count + ')' : 'ยังไม่มีรีวิว';

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3600);
  }

  /* ---------- geometry, maps, files ---------- */
  function distanceKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function geolocate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('อุปกรณ์นี้หาตำแหน่งไม่ได้'));
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => rej(new Error('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  // Same approach as our delivery app: coordinates and Google Maps pins, no paid map API.
  function parseMapsLink(text) {
    const s = String(text || '').trim();
    const pats = [/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|ll|query|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/];
    for (const p of pats) { const m = s.match(p); if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
    return null;
  }
  const mapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const navUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  async function resizeImage(file, max = 1600) {
    if (!file || !/^image\//.test(file.type)) return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.85));
  }
  async function upload(bucket, folder, file, prefix) {
    if (!file) return null;
    const isPdf = file.type === 'application/pdf';
    const body = isPdf ? file : await resizeImage(file);
    const path = `${folder}/${prefix}-${Date.now()}${isPdf ? '.pdf' : '.jpg'}`;
    const { error } = await sb.storage.from(bucket).upload(path, body, { contentType: isPdf ? 'application/pdf' : 'image/jpeg', upsert: false });
    if (error) throw error;
    return path;
  }
  async function signedUrl(bucket, path) {
    if (!path) return null;
    const { data } = await sb.storage.from(bucket).createSignedUrl(path, 600);
    return data ? data.signedUrl : null;
  }

  /* ---------- PromptPay QR (EMVCo payload + CRC16-CCITT) ---------- */
  function crc16(s) {
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function promptpayPayload(id, amount) {
    const f = (tag, v) => tag + String(v.length).padStart(2, '0') + v;
    let target = String(id).replace(/\D/g, ''), acc;
    if (target.length >= 13) acc = f('02', target);
    else acc = f('01', ('0000000000000' + target.replace(/^0/, '66')).slice(-13));
    const p = f('00', '01') + f('01', amount ? '12' : '11') + f('29', f('00', 'A000000677010111') + acc)
      + f('53', '764') + (amount ? f('54', Number(amount).toFixed(2)) : '') + f('58', 'TH') + '6304';
    return p + crc16(p);
  }
  function qrSvg(text) {
    if (!window.qrcode) return '<p class="small muted">โหลด QR ไม่ได้ — โอนด้วยเลขพร้อมเพย์ด้านล่าง</p>';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  /* ---------- rarity tiers (ธรรมดา → สวรรค์) ---------- */
  const TIER_FALLBACK = { id: 'common', ord: 1, label: 'ธรรมดา', color: '#6b5540', glow: false };
  const tier = (id) => (S.tiers.find((t) => t.id === id) || TIER_FALLBACK);
  const tierTag = (id) => { const t = tier(id); return `<span class="tag tier-tag tier-${esc(t.id)}" style="background:${t.color};color:#fff">${esc(t.label)}</span>`; };

  /* ---------- state ---------- */
  const S = {
    user: null, profile: null, priv: null, kycReq: null, wallet: null, settings: {}, occupations: [],
    board: [], mine: { applied: [], working: [], posted: [], history: [] }, myReviews: new Set(),
    tx: [], wd: [], orders: [], careers: [], cards: [], myCards: new Set(), deck: null, doneByCat: {},
    guilds: [], memberCount: {}, myGuild: null, myGuildRole: null, gMembers: [], claims: [], myVotes: {},
    family: null, famRole: null, famMembers: [], famQuests: [], famPending: [],
    shop: [], myItems: {}, tiers: [], notifs: [], unread: 0, day: null, month: null,
    tab: 'board', qsub: 'board', psub: 'day', cat: 'all', view: 'list', near: false, myPos: null, openQuest: null, channel: null
  };

  async function rpc(fn, args, okMsg) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) { toast(errText(error), true); return null; }
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(data) : okMsg);
    await refresh();
    return data ?? true;
  }

  /* ---------- loaders (feature files add more) ---------- */
  const loaders = {
    async me() {
      const uid = S.user.id;
      const [p, w, st, pv, kr, oc, tr] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).single(),
        sb.from('wallets').select('*').eq('user_id', uid).single(),
        sb.from('app_settings').select('key,value'),
        sb.from('private_profiles').select('*').eq('user_id', uid).maybeSingle(),
        sb.from('kyc_requests').select('status,note,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        sb.from('occupations').select('*').order('sort'),
        S.tiers.length ? Promise.resolve({ data: S.tiers }) : sb.from('rarity_tiers').select('*').order('ord')
      ]);
      if (p.error) throw p.error; if (w.error) throw w.error;
      S.profile = p.data; S.wallet = w.data; S.priv = pv.data; S.kycReq = kr.data; S.occupations = oc.data || []; S.tiers = tr.data || [];
      S.settings = Object.fromEntries((st.data || []).map((r) => [r.key, r.value]));
    },
    async notifs() {
      const { data } = await sb.from('notifications').select('*').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(40);
      S.notifs = data || []; S.unread = S.notifs.filter((n) => !n.read_at).length;
    }
  };
  const renderers = [];
  const ALL = () => Object.keys(loaders);

  async function refresh(parts) {
    if (!S.user) return;
    try {
      await Promise.all((parts || ALL()).map((p) => loaders[p] && loaders[p]()));
      render();
    } catch (e) { toast(errText(e), true); }
  }

  function render() {
    const p = S.profile, w = S.wallet; if (!p || !w) return;
    $('hLevel').textContent = p.base_level; $('hName').textContent = p.display_name || p.username;
    $('hSub').textContent = 'Lv.' + p.base_level + ' · ' + (p.title || p.job_class || 'นักผจญภัย');
    $('hGold').textContent = num(w.gold); $('hCrystal').textContent = num(w.crystal);
    $('bellCount').textContent = S.unread > 9 ? '9+' : S.unread; $('bellCount').classList.toggle('hidden', !S.unread);
    renderKycBanner();
    for (const r of renderers) { try { r(); } catch (e) { console.error(e); } }
    if (S.openQuest && App.refreshQuestSheet) App.refreshQuestSheet();
  }

  function renderKycBanner() {
    const b = $('kycBanner'), k = S.profile.kyc_status;
    if (k === 'verified' || S.tab !== 'board') { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.innerHTML = k === 'pending'
      ? `<div style="flex:1;min-width:200px"><b>กำลังตรวจเอกสารยืนยันตัวตน</b><div class="small muted">ทีมงานจะแจ้งผลผ่านการแจ้งเตือน ระหว่างนี้ดูกระดานได้ แต่ยังรับงานไม่ได้</div></div>`
      : `<div style="flex:1;min-width:200px"><b>${k === 'rejected' ? 'ยืนยันตัวตนไม่ผ่าน — ส่งใหม่ได้' : 'ยืนยันตัวตนก่อนรับหรือโพสต์งาน'}</b><div class="small muted">${k === 'rejected' && S.kycReq && S.kycReq.note ? esc(S.kycReq.note) : 'ใช้บัตรประชาชนและรูปถ่ายคู่บัตร ใช้เวลาตรวจไม่นาน'}</div></div>
         <button class="btn primary" type="button" onclick="App.openKyc()">ยืนยันตัวตน</button>`;
  }

  /* ---------- tabs and routing ---------- */
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('nav.tabs button').forEach((x) => x.setAttribute('aria-current', x.dataset.tab === tab ? 'page' : 'false'));
    ['board', 'char', 'deck', 'guild', 'wallet'].forEach((t) => $('view-' + t).classList.toggle('hidden', t !== tab));
    renderKycBanner();
    window.scrollTo({ top: 0 });
  }
  function setQsub(sub) {
    S.qsub = sub;
    document.querySelectorAll('[data-qsub]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.qsub === sub));
    ['board', 'mine', 'plan'].forEach((s) => $('qsub-' + s).classList.toggle('hidden', s !== sub));
    if (sub === 'plan' && App.loadPlanner) App.loadPlanner();
  }
  function route(hash) {
    const h = (hash || location.hash || '').replace(/^#/, '');
    if (!h) return;
    if (h.startsWith('quest-')) { setTab('board'); App.openQuestSheet && App.openQuestSheet(h.slice(6)); }
    else if (h === 'plan') { setTab('board'); setQsub('plan'); }
    else if (h === 'career') { setTab('char'); setTimeout(() => { const el = $('careerSection'); if (el && el.scrollIntoView) el.scrollIntoView(); }, 100); }
    else if (['board', 'char', 'deck', 'guild', 'wallet'].includes(h)) setTab(h);
  }
  window.addEventListener('hashchange', () => route());
  document.querySelector('nav.tabs').onclick = (ev) => { const b = ev.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); };
  document.querySelectorAll('[data-qsub]').forEach((b) => { b.onclick = () => setQsub(b.dataset.qsub); });

  /* ---------- sheet ---------- */
  let sheetOnClose = null;
  function openSheet(title, html, onClose) {
    $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html;
    $('sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden';
    sheetOnClose = onClose || null;
  }
  function closeSheet() {
    $('sheet').classList.add('hidden'); document.body.style.overflow = '';
    S.openQuest = null; if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
    if (location.hash.startsWith('#quest-')) history.replaceState(null, '', location.pathname + location.search);
  }
  $('sheetClose').onclick = closeSheet;
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').classList.contains('hidden')) closeSheet(); });

  /* ---------- notifications + push ---------- */
  function urlB64ToUint8Array(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('อุปกรณ์นี้ไม่รองรับการแจ้งเตือน (iPhone ต้องติดตั้งแอปลงหน้าจอโฮมก่อน)');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('ยังไม่ได้อนุญาตการแจ้งเตือน');
      const reg = await navigator.serviceWorker.ready;
      const key = S.settings.vapid_public_key;
      if (!key) throw new Error('ระบบแจ้งเตือนยังไม่พร้อม');
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      const j = sub.toJSON();
      await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }, 'เปิดการแจ้งเตือนแล้ว');
    } catch (e) { toast(errText(e), true); }
  }
  function openNotifs() {
    const list = S.notifs.length ? S.notifs.map((n) => `<a class="tx" href="${esc(n.link ? '#' + (n.link.split('#')[1] || '') : '#')}" data-notif style="text-decoration:none;color:inherit">
        <span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;flex:none;background:${n.read_at ? 'transparent' : 'var(--danger)'}"></span>
        <div style="flex:1;min-width:0"><b style="font-weight:600">${esc(n.title)}</b>${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}</div>
        <span class="small muted" style="white-space:nowrap">${ago(n.created_at)}</span></a>`).join('') : '<div class="empty">ยังไม่มีการแจ้งเตือน</div>';
    const pushOn = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    openSheet('การแจ้งเตือน', `<div class="stack">
      ${pushOn ? '' : `<div class="card row"><span style="flex:1">รับแจ้งเตือนแม้ไม่ได้เปิดแอป (มีคนรับงาน, ได้เงิน, ข้อความใหม่)</span><button class="btn action sm" id="pushBtn" type="button">เปิดแจ้งเตือน</button></div>`}
      <div class="card" style="padding:4px 14px">${list}</div></div>`);
    const pb = $('pushBtn'); if (pb) pb.onclick = enablePush;
    $('sheetBody').querySelectorAll('[data-notif]').forEach((a) => a.addEventListener('click', () => setTimeout(closeSheet, 0)));
    if (S.unread) sb.rpc('mark_notifications_read').then(() => refresh(['notifs']));
  }
  $('bellBtn').onclick = openNotifs;

  let rtTimer;
  function subscribe() {
    if (S.channel) sb.removeChannel(S.channel);
    const later = (parts) => { clearTimeout(rtTimer); rtTimer = setTimeout(() => refresh(parts), 350); };
    S.channel = sb.channel('rlq-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quests' }, () => later(['quests', 'family']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quest_applications' }, () => later(['quests']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: 'user_id=eq.' + S.user.id }, () => later(['me', 'money']))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + S.user.id }, (p) => {
        if (p.new) toast(p.new.title); later(['notifs', 'me']);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        if (p.new && S.openQuest === p.new.quest_id && App.refreshQuestSheet) App.refreshQuestSheet();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guilds' }, () => later(['guild']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_claims' }, () => later(['guild']))
      .subscribe();
  }

  /* ---------- auth ---------- */
  let mode = 'login';
  function setMode(m) {
    mode = m;
    $('tabLogin').setAttribute('aria-pressed', m === 'login'); $('tabSignup').setAttribute('aria-pressed', m === 'signup');
    $('usernameWrap').classList.toggle('hidden', m !== 'signup'); $('termsWrap').classList.toggle('hidden', m !== 'signup');
    $('authSubmit').textContent = m === 'login' ? 'เข้าสู่ระบบ' : 'สมัครและเริ่มผจญภัย';
    $('authPassword').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('authMsg').textContent = '';
  }
  $('tabLogin').onclick = () => setMode('login');
  $('tabSignup').onclick = () => setMode('signup');
  $('authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const email = $('authEmail').value.trim(), password = $('authPassword').value;
    $('authSubmit').disabled = true; $('authMsg').textContent = 'กำลังดำเนินการ…';
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const username = $('authUsername').value.trim();
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็น a–z, 0–9 หรือ _ ยาว 3–20 ตัว');
        if (!$('authTerms').checked) throw new Error('กรุณายอมรับข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว');
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) { $('authMsg').textContent = 'สมัครแล้ว! เปิดอีเมลเพื่อยืนยัน แล้วกลับมาเข้าสู่ระบบ'; return; }
      }
    } catch (e) { $('authMsg').textContent = errText(e); }
    finally { $('authSubmit').disabled = false; }
  };
  $('signOut').onclick = () => sb.auth.signOut();

  /* ---------- install as app (PWA) ---------- */
  const ua = navigator.userAgent;
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inAppBrowser = /Line\/|FBAN|FBAV|Instagram|TikTok/i.test(ua);
  let deferredPrompt = null;
  function showInstall(hint, canPrompt) {
    if (standalone) return;
    $('installCard').classList.remove('hidden'); $('installHint').textContent = hint;
    $('installBtn').classList.toggle('hidden', !canPrompt); $('installTop').classList.toggle('hidden', !canPrompt);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; showInstall('กดติดตั้ง แล้วเปิดได้จากหน้าจอโฮมเหมือนแอปทั่วไป', true); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; $('installCard').classList.add('hidden'); $('installTop').classList.add('hidden'); toast('ติดตั้งแล้ว — เปิดได้จากไอคอน RLQ บนหน้าจอโฮม'); });
  async function doInstall() { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  $('installBtn').onclick = doInstall; $('installTop').onclick = doInstall;
  if (inAppBrowser) showInstall('เปิดลิงก์นี้ใน Safari หรือ Chrome ก่อน แล้วจะติดตั้งได้ (กดเมนู ⋯ › เปิดในเบราว์เซอร์)', false);
  else if (isIOS) showInstall('กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรขึ้น) แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"', false);

  /* ---------- boot ---------- */
  function boot() {
    sb.auth.onAuthStateChange((_evt, session) => {
      const u = session ? session.user : null;
      if (u && (!S.user || S.user.id !== u.id)) {
        S.user = u; $('authView').classList.add('hidden'); $('appView').classList.remove('hidden');
        setTimeout(async () => { await refresh(); subscribe(); route(); }, 0);
      } else if (!u) {
        S.user = null; S.profile = null; S.wallet = null;
        if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
        $('appView').classList.add('hidden'); $('authView').classList.remove('hidden'); setMode('login');
      }
    });
    setInterval(() => { if (S.user && S.tab === 'board') render(); }, 60000);
  }

  window.App = {
    sb, S, CATS, RANKS, RANK_LABEL, TX, $, esc, num, ago, when, hours, rating, toast, errText, rpc, refresh, render,
    loaders, renderers, setTab, setQsub, openSheet, closeSheet, route, distanceKm, geolocate, parseMapsLink, mapsUrl, navUrl,
    upload, signedUrl, promptpayPayload, qrSvg, boot, enablePush, tier, tierTag
  };
})();
