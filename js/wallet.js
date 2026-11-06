/* Real-life Quest — wallet: Gold (real money, withdrawable), Crystal (bought, giftable, not withdrawable), PromptPay top-up, shop. */
(() => {
  const { sb, S, TX, tier, tierTag, $, esc, num, ago, when, toast, rpc, refresh, loaders, renderers, openSheet, closeSheet, upload, promptpayPayload, qrSvg } = App;
  const WSTATUS = { pending: 'รออนุมัติ', second_approval: 'รอผู้อนุมัติคนที่ 2', paid: 'โอนแล้ว', rejected: 'ไม่ผ่าน · คืน Gold แล้ว' };
  const OSTATUS = { pending: 'รอโอนเงิน', notified: 'แจ้งโอนแล้ว · รอตรวจสลิป', paid: 'สำเร็จ', rejected: 'ไม่ผ่าน', cancelled: 'ยกเลิก' };
  const KIND = { frame: 'กรอบโปรไฟล์', title: 'ฉายา', costume: 'ชุดแต่งตัว', boost: 'เพิ่มความสามารถ' };
  const baht = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  loaders.money = async function () {
    const uid = S.user.id;
    const [t, w, o] = await Promise.all([
      sb.from('transactions').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(30),
      sb.from('withdrawals').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(10),
      sb.from('topup_orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(10)
    ]);
    S.tx = t.data || []; S.wd = w.data || []; S.orders = o.data || [];
  };
  loaders.shop = async function () {
    const [s, mine] = await Promise.all([
      sb.from('shop_items').select('*').order('sort'),
      sb.from('user_items').select('item_id,equipped').eq('user_id', S.user.id)
    ]);
    S.shop = s.data || []; S.myItems = Object.fromEntries((mine.data || []).map((r) => [r.item_id, r]));
  };

  const rate = (cur) => parseFloat(S.settings[cur + '_thb_rate']);
  const topupOpen = (cur) => rate(cur) > 0 && !!S.settings.promptpay_id;

  function txRow(t) {
    const g = Number(t.gold_delta), l = Number(t.locked_delta), c = Number(t.crystal_delta);
    const amt = c ? (c > 0 ? '+' : '−') + num(Math.abs(c)) + ' C' : g ? (g > 0 ? '+' : '−') + num(Math.abs(g)) + ' G' : (l > 0 ? '+' : '−') + num(Math.abs(l)) + ' G ล็อก';
    const color = c ? (c > 0 ? 'var(--crystal-ink)' : 'var(--danger-ink)') : g > 0 ? 'var(--teal-ink)' : g < 0 ? 'var(--danger-ink)' : 'var(--ink-muted)';
    return `<div class="tx"><div style="flex:1;min-width:0"><div>${esc(TX[t.kind] || t.kind)}</div><div class="small muted">${ago(t.created_at)}${t.note ? ' · ' + esc(t.note) : ''}</div></div><span class="amt" style="color:${color}">${amt}</span></div>`;
  }

  function renderWallet() {
    const w = S.wallet, gr = rate('gold'), cr = rate('crystal'), p = S.profile;
    const openOrders = S.orders.filter((o) => ['pending', 'notified'].includes(o.status));
    $('view-wallet').innerHTML = `
      <div class="section"><div class="grid" style="align-items:stretch">
        <div class="balance">
          <span class="small" style="color:var(--on-wood-muted)">Gold · เงินจริง ถอนได้</span>
          <span class="big">${num(w.gold)} G</span>
          <span class="small" style="color:var(--on-wood-muted)">${gr > 0 ? '≈ ' + baht(w.gold * gr) + ' บาท · 1 G = ' + gr + ' บาท' : 'ยังไม่ประกาศอัตรา Gold ต่อบาท'}</span>
          <span class="small" style="color:var(--on-wood-muted)">ล็อกในงาน/รอถอน ${num(w.gold_locked)} G</span>
          <div class="row" style="margin-top:8px"><button class="btn primary" data-w="topup-gold" ${topupOpen('gold') ? '' : 'disabled'}>เติม Gold</button><button class="btn sec" data-w="withdraw">ถอนเป็นเงิน</button></div>
        </div>
        <div class="balance" style="border-color:var(--crystal)">
          <span class="small" style="color:var(--on-wood-muted)">Crystal · ซื้อจากเรา ให้คนอื่นได้ ถอนไม่ได้</span>
          <span class="big" style="color:var(--crystal)">${num(w.crystal)} C</span>
          <span class="small" style="color:var(--on-wood-muted)">${cr > 0 ? '1 C = ' + cr + ' บาท' : 'ยังไม่เปิดขาย Crystal'} · ใช้ซื้อของพิเศษในร้าน</span>
          <div class="row" style="margin-top:8px"><button class="btn primary" data-w="topup-crystal" ${topupOpen('crystal') ? '' : 'disabled'} style="background:var(--crystal)">เติม Crystal</button><button class="btn sec" data-w="send">ส่งให้คนอื่น</button></div>
        </div>
      </div>
      ${!topupOpen('gold') && !topupOpen('crystal') ? '<p class="small muted" style="margin:0">ยังไม่เปิดเติมเงิน — ทีมงานกำลังตั้งค่าพร้อมเพย์</p>' : ''}
      </div>
      ${openOrders.length ? `<div class="section"><h2 style="font-size:17px">คำสั่งเติมเงินที่ค้างอยู่</h2><div class="card" style="padding:4px 14px">${openOrders.map((o) => `<div class="tx" style="flex-wrap:wrap">
        <div style="flex:1 1 180px;min-width:0"><b>${num(o.units)} ${o.currency === 'gold' ? 'G' : 'C'}</b> · ${baht(o.amount_thb)} บาท<div class="small muted">รหัส ${esc(o.ref_code)} · ${OSTATUS[o.status]} · ${ago(o.created_at)}</div></div>
        ${o.status === 'pending' ? `<button class="btn action sm" data-order="${o.id}">ชำระ/แนบสลิป</button><button class="btn sec sm" data-ocancel="${o.id}">ยกเลิก</button>` : ''}</div>`).join('')}</div></div>` : ''}
      <div class="section"><div class="row between"><h2 style="font-size:17px">ร้านค้า Crystal</h2><span class="small muted">ของแต่งตัว ฉายา กรอบ และช่องเควสต์ส่วนตัว</span></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${S.shop.filter((i) => i.active || S.myItems[i.id] || ['divine', 'heaven'].includes(i.tier)).sort((a, b) => tier(a.tier).ord - tier(b.tier).ord || a.sort - b.sort).map((i) => {
          const own = S.myItems[i.id];
          const t = tier(i.tier);
          return `<article class="card stack${t.glow ? ' tier-glow' : ''} tier-${esc(t.id)}" style="gap:6px;border-color:${own && own.equipped ? 'var(--teal-600)' : t.color};border-width:2px">
            <div class="row between"><span class="row" style="gap:4px">${tierTag(i.tier)}<span class="tag" style="background:var(--parchment-200);color:var(--ink-soft)">${KIND[i.kind]}${i.slot ? ' · ' + i.slot : ''}</span></span>${i.kind === 'frame' && i.data && i.data.color ? `<span aria-hidden="true" style="width:18px;height:18px;border-radius:50%;border:3px solid ${esc(i.data.color)}"></span>` : ''}</div>
            <b>${esc(i.name)}</b><span class="small muted">${esc(i.description || '')}</span>
            <div class="row between dash" style="margin-top:auto"><span class="gold" style="color:var(--crystal-ink)">${i.price_crystal ? num(i.price_crystal) + ' C' : i.tier === 'divine' ? 'ได้จากขั้น A' : i.tier === 'heaven' ? 'ได้จากขั้น S' : 'รางวัล'}</span>
              ${!own ? (i.active && i.price_crystal ? `<button class="btn primary sm" data-buy="${i.id}">ซื้อ</button>` : '') : i.kind === 'boost' ? '<span class="small" style="color:var(--teal-ink)">ใช้งานอยู่</span>'
                : `<button class="btn ${own.equipped ? 'sec' : 'action'} sm" data-equip="${i.id}" data-on="${own.equipped ? 0 : 1}">${own.equipped ? 'ถอด' : 'ใส่'}</button>`}</div></article>`;
        }).join('') || '<div class="empty">ร้านยังไม่เปิด</div>'}</div></div>
      ${S.wd.length ? `<div class="section"><h2 style="font-size:17px">คำขอถอนของฉัน</h2><div class="card" style="padding:4px 14px">${S.wd.map((d) => `<div class="tx"><div style="flex:1;min-width:0"><div>${esc(d.bank_label)}</div><div class="small muted">${ago(d.created_at)} · ${WSTATUS[d.status]}</div></div><span class="amt" style="color:${d.status === 'rejected' ? 'var(--ink-muted)' : 'var(--gold-ink)'}">${num(d.amount_gold)} G</span></div>`).join('')}</div></div>` : ''}
      <div class="section"><h2 style="font-size:17px">ความเคลื่อนไหว</h2><div class="card" style="padding:4px 14px">${S.tx.length ? S.tx.map(txRow).join('') : '<div class="empty">ยังไม่มีรายการ</div>'}</div></div>
      <div class="section"><details class="card"><summary style="cursor:pointer;font-weight:600">ระบบเงินทำงานอย่างไร</summary>
        <ul class="small" style="margin:10px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
          <li><b>Gold = เงินจริง</b> ได้จากการทำงาน หรือเติมด้วยพร้อมเพย์ ใช้จ้างงาน และถอนเป็นเงินบาทได้ (ต้องยืนยันตัวตน)</li>
          <li>เมื่อโพสต์งาน Gold จะถูก <b>ล็อก</b> ไว้ทันที ผู้รับงานได้เมื่อผู้โพสต์ยืนยัน หรือระบบจ่ายอัตโนมัติ ${S.settings.auto_release_hours || 72} ชม. หลังส่งงาน · ยกเลิกก่อนเริ่มงานได้คืนเต็ม</li>
          <li>มีปัญหา เปิดข้อพิพาทได้ Gold จะพักไว้จนทีมงานตัดสินแบ่งเป็นเปอร์เซ็นต์</li>
          <li><b>Crystal</b> ซื้อจากเราเท่านั้น ส่งให้ลูกหลานหรือใครก็ได้ (วันละไม่เกิน ${num(S.settings.crystal_daily_transfer_max || 5000)} C) <b>ถอนเป็นเงินไม่ได้</b> ใช้ซื้อของพิเศษในร้าน</li>
          <li>เติมเงิน: สร้างคำสั่ง → สแกน QR พร้อมเพย์ตามยอด → แนบสลิป → ทีมการเงินตรวจแล้วเติมให้</li>
          ${Number(S.settings.platform_fee_pct || 0) ? `<li>ค่าธรรมเนียมแพลตฟอร์ม ${S.settings.platform_fee_pct}% หักจากรางวัลตอนจ่ายผู้รับงาน</li>` : '<li>ตอนนี้ยังไม่เก็บค่าธรรมเนียมแพลตฟอร์ม</li>'}
        </ul></details></div>`;
  }
  renderers.push(renderWallet);

  /* ---------- top-up ---------- */
  function openTopup(cur) {
    const r = rate(cur), unit = cur === 'gold' ? 'G' : 'C', min = Number(S.settings.topup_min_thb || 20);
    const presets = cur === 'gold' ? [100, 500, 1000, 5000] : [50, 100, 300, 1000];
    openSheet(cur === 'gold' ? 'เติม Gold' : 'เติม Crystal', `<form id="topupForm" class="stack">
      <div class="row">${presets.map((n) => `<button type="button" class="pill" data-units="${n}">${num(n)} ${unit}</button>`).join('')}</div>
      <label class="f">จำนวน (${unit})<input name="units" type="number" min="1" step="1" required inputmode="numeric"></label>
      <p class="small muted" id="topupNote" style="margin:0">1 ${unit} = ${r} บาท · ขั้นต่ำ ${min} บาท</p>
      ${cur === 'crystal' ? '<p class="small" style="margin:0;color:var(--danger-ink)">Crystal ถอนเป็นเงินไม่ได้ ใช้ในร้านค้าหรือส่งให้คนอื่นเท่านั้น</p>' : ''}
      <button class="btn primary" type="submit">สร้าง QR พร้อมเพย์</button></form>`);
    const f = $('topupForm');
    const upd = () => { const u = Number(f.elements.units.value || 0); $('topupNote').textContent = u ? `ต้องโอน ${baht(Math.round(u * r * 100) / 100)} บาท` : `1 ${unit} = ${r} บาท · ขั้นต่ำ ${min} บาท`; };
    f.elements.units.oninput = upd;
    f.addEventListener('click', (e) => { const b = e.target.closest('[data-units]'); if (b) { f.elements.units.value = b.dataset.units; upd(); } });
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const { data, error } = await sb.rpc('create_topup', { p_currency: cur, p_units: Number(f.elements.units.value) });
      if (error) return toast(App.errText(error), true);
      refresh(['money']); showPay(data);
    };
  }
  function showPay(o) {
    const pp = o.promptpay_id || S.settings.promptpay_id, name = o.promptpay_name || S.settings.promptpay_name || '';
    const unit = o.currency === 'gold' ? 'G' : 'C';
    openSheet('ชำระด้วยพร้อมเพย์', `<div class="stack" style="align-items:center;text-align:center">
      <div class="qr">${qrSvg(promptpayPayload(pp, o.amount_thb))}</div>
      <span class="gold" style="font-size:28px">${baht(o.amount_thb)} บาท</span>
      <span>รับ ${num(o.units)} ${unit} · รหัสอ้างอิง <b style="font-family:var(--font-rpg);letter-spacing:.08em">${esc(o.ref_code)}</b></span>
      <span class="small muted">พร้อมเพย์ ${esc(pp)}${name ? ' · ' + esc(name) : ''} — ตรวจชื่อบัญชีให้ตรงก่อนโอน · โอนตามยอดนี้พอดี ใส่รหัสอ้างอิงในบันทึกช่วยให้ตรวจเร็วขึ้น</span>
    </div>
    <form id="slipForm" class="stack" style="margin-top:14px">
      <label class="f">แนบสลิปการโอน<input name="slip" type="file" accept="image/*" required></label>
      <button class="btn primary" type="submit" id="slipBtn">แจ้งโอนแล้ว</button>
      <span class="small muted">ทีมการเงินตรวจแล้วเติมให้ จะมีแจ้งเตือนเมื่อสำเร็จ · คำสั่งที่ไม่ชำระใน 2 วันจะยกเลิกอัตโนมัติ</span></form>`);
    $('slipForm').onsubmit = async (ev) => {
      ev.preventDefault(); $('slipBtn').disabled = true;
      try {
        const path = await upload('private-docs', S.user.id, ev.target.slip.files[0], 'slip-' + o.ref_code);
        const ok = await rpc('notify_topup_paid', { p_order: o.id, p_slip_path: path }, 'แจ้งโอนแล้ว รอทีมการเงินตรวจ');
        if (ok) closeSheet();
      } catch (e) { toast(App.errText(e), true); }
      if ($('slipBtn')) $('slipBtn').disabled = false;
    };
  }

  /* ---------- send Crystal ---------- */
  function openSendCrystal(to) {
    openSheet('ส่ง Crystal', `<form id="sendForm" class="stack">
      <label class="f">ชื่อผู้ใช้ผู้รับ<input name="to" required pattern="[A-Za-z0-9_]{3,20}" autocomplete="off" value="${esc(to || '')}"></label>
      <label class="f">จำนวน (C) — มีอยู่ ${num(S.wallet.crystal)} C<input name="amt" type="number" min="1" step="1" required inputmode="numeric"></label>
      <label class="f">ข้อความถึงผู้รับ (ไม่บังคับ)<input name="note" maxlength="120" placeholder="เช่น ค่าขนมจากปู่"></label>
      <span class="small muted">ส่งแล้วเรียกคืนไม่ได้ · วันละไม่เกิน ${num(S.settings.crystal_daily_transfer_max || 5000)} C</span>
      <button class="btn primary" type="submit">ส่ง Crystal</button></form>`);
    $('sendForm').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      if (!confirm(`ส่ง ${num(f.elements.amt.value)} C ให้ @${f.elements.to.value.trim()}?`)) return;
      const ok = await rpc('transfer_crystal', { p_to_username: f.elements.to.value.trim(), p_amount: Number(f.elements.amt.value), p_note: f.elements.note.value.trim() || null }, 'ส่ง Crystal แล้ว');
      if (ok) closeSheet();
    };
  }

  /* ---------- withdraw ---------- */
  function openWithdraw() {
    if (S.profile.kyc_status !== 'verified') { toast('ต้องยืนยันตัวตนก่อนถอนเงิน', true); return App.openKyc(); }
    const gr = rate('gold');
    openSheet('ถอน Gold เป็นเงิน', `<form id="wForm" class="stack">
      <label class="f">จำนวน (G) — ถอนได้ ${num(S.wallet.gold)} G<input name="amt" type="number" min="1" step="1" required inputmode="numeric"></label>
      <label class="f">บัญชีรับเงิน (ธนาคาร + เลข 4 หลักท้าย)<input name="bank" required minlength="3" maxlength="60" placeholder="เช่น กสิกร ••1234"></label>
      <span class="small muted">${gr > 0 ? '1 G = ' + gr + ' บาท · ' : ''}ขั้นต่ำ ${num(S.settings.withdraw_min_gold || 100)} G · ตั้งแต่ ${num(S.settings.withdraw_dual_threshold || 5000)} G ต้องผ่านผู้อนุมัติ 2 คน · โอนเข้าบัญชีชื่อเดียวกับที่ยืนยันตัวตนเท่านั้น</span>
      <button class="btn primary" type="submit">ส่งคำขอถอน</button></form>`);
    $('wForm').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target, bank = f.elements.bank.value.trim();
      if (/\d{6,}/.test(bank.replace(/[\s-]/g, ''))) return toast('ใส่แค่เลข 4 หลักท้ายของบัญชี เพื่อความปลอดภัย', true);
      const ok = await rpc('request_withdrawal', { p_amount: Number(f.elements.amt.value), p_bank_label: bank }, 'ส่งคำขอถอนแล้ว');
      if (ok) closeSheet();
    };
  }

  $('view-wallet').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const w = b.dataset.w;
    if (w === 'topup-gold') openTopup('gold');
    if (w === 'topup-crystal') openTopup('crystal');
    if (w === 'send') openSendCrystal();
    if (w === 'withdraw') openWithdraw();
    if (b.dataset.order) { const o = S.orders.find((x) => x.id === b.dataset.order); if (o) showPay(o); }
    if (b.dataset.ocancel && confirm('ยกเลิกคำสั่งเติมเงินนี้?')) await rpc('cancel_topup', { p_order: b.dataset.ocancel }, 'ยกเลิกแล้ว');
    if (b.dataset.buy) { const i = S.shop.find((x) => x.id === b.dataset.buy); if (i && confirm(`ซื้อ ${i.name} ราคา ${num(i.price_crystal)} C?`)) { b.disabled = true; await rpc('buy_item', { p_item: i.id }, 'ซื้อแล้ว'); } }
    if (b.dataset.equip) { b.disabled = true; await rpc('equip_item', { p_item: b.dataset.equip, p_on: b.dataset.on === '1' }, b.dataset.on === '1' ? 'ใส่แล้ว' : 'ถอดแล้ว'); }
  });

  Object.assign(App, { openSendCrystal, openTopup });
})();
