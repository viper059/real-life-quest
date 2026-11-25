/* Real-life Quest — food: earn Gold from habits, buy Thai dishes, eat them for short EXP / Gold boosts. Gold never leaves the app. */
(() => {
  const { sb, S, $, esc, num, toast, rpc, refresh } = App;
  const CAT = [['all', 'ทั้งหมด'], ['meal', '🍛 จานหลัก'], ['snack', '🍢 ของว่าง'], ['drink', '🧋 เครื่องดื่ม'], ['dessert', '🍨 ของหวาน'], ['fruit', '🍉 ผลไม้']];
  const KIND = { exp: 'EXP', gold: 'Gold จากกิจวัตร' };

  App.loaders.food = async function () {
    const uid = S.user.id;
    if (S.qsub !== 'plan' || S.psub !== 'food') return;
    const [f, mine, today] = await Promise.all([
      sb.from('food_items').select('*').order('sort'),
      sb.from('user_food').select('food_id,qty').eq('user_id', uid).gt('qty', 0),
      sb.rpc('my_food_today')
    ]);
    S.foodToday = today.data || { eaten: 0, max: 4 };
    S.foods = f.data || [];
    S.pantry = Object.fromEntries((mine.data || []).map((r) => [r.food_id, r.qty]));
  };

  const leftText = (until) => {
    const m = Math.max(0, Math.round((new Date(until) - Date.now()) / 60000));
    return m >= 60 ? `อีก ${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `อีก ${m} นาที`;
  };

  // small status card shown on the habits tab and the food tab
  App.buffBar = function (H) {
    const buffs = (H && H.buffs) || [];
    const cap = H ? H.gold_cap : 0, today = H ? H.gold_today : 0;
    return `<div class="row" style="gap:8px;flex-wrap:wrap">
      <span class="fchip gold-chip" title="Gold ที่ได้จากกิจวัตรวันนี้">🪙 ${num(today)} / ${num(cap)} G วันนี้</span>
      ${buffs.length ? buffs.map((b) => `<span class="fchip buff-chip">✨ ${KIND[b.kind]} +${b.pct}% · ${esc(leftText(b.until))}</span>`).join('') : '<span class="fchip muted-chip">ยังไม่มีบัฟอาหาร</span>'}
    </div>`;
  };

  App.foodView = function () {
    const H = S.habits || {}, cat = S.foodCat || 'all', gold = Number(S.wallet ? S.wallet.gold : 0);
    const foods = (S.foods || []).filter((f) => cat === 'all' || f.cat === cat);
    const mine = (S.foods || []).filter((f) => S.pantry && S.pantry[f.id] > 0);
    const ft = S.foodToday || { eaten: 0, max: 4 }, full = ft.eaten >= ft.max;
    return `<div class="stack">
      <div class="card wood stack">
        <div class="row between"><b style="font-family:var(--font-display);font-size:18px">🍜 ร้านอาหารในเมือง</b><span class="small" style="color:var(--on-wood-muted)">มี ${num(gold)} G</span></div>
        <span class="small" style="color:var(--on-wood-muted)">ทำกิจวัตรได้ Gold วันละไม่เกิน ${num(H.gold_cap || 40)} G นำมาซื้อของกิน กินแล้วได้พลังเพิ่ม EXP หรือ Gold จากกิจวัตรชั่วคราว · Gold ในแอปถอนเป็นเงินจริงไม่ได้</span>
        ${App.buffBar(H)}
        <span class="fchip ${full ? 'muted-chip' : 'gold-chip'}">🍽 กินวันนี้ ${ft.eaten} / ${ft.max} มื้อ${full ? ' · ครบแล้ว' : ''}</span>
      </div>
      ${mine.length ? `<div class="card stack"><b>🧺 ของกินที่ฉันมี</b>
        <div class="food-grid">${mine.map((f) => `<div class="food-card own">
          <div class="food-emoji" aria-hidden="true">${f.emoji}</div><b>${esc(f.name)}</b><span class="small muted">x${S.pantry[f.id]}</span>
          <button class="btn ${full ? 'sec' : 'action'} sm" data-food-eat="${f.id}" ${full ? 'disabled' : ''}>${full ? 'กินครบแล้ววันนี้' : 'กินเลย'}</button></div>`).join('')}</div></div>` : ''}
      <div class="row scroll-x">${CAT.map(([k, v]) => `<button class="pill" data-food-cat="${k}" aria-pressed="${cat === k}">${v}</button>`).join('')}</div>
      <div class="food-grid">${foods.map((f) => {
        const can = gold >= f.price;
        return `<div class="food-card">
          <div class="food-emoji" aria-hidden="true">${f.emoji}</div>
          <b>${esc(f.name)}</b>
          <span class="small muted">${esc(f.description || '')}</span>
          <span class="fchip buff-chip">+${f.buff_pct}% ${KIND[f.buff_kind]} · ${f.buff_min >= 60 ? Math.round(f.buff_min / 6) / 10 + ' ชม.' : f.buff_min + ' นาที'}</span>
          <button class="btn ${can ? 'primary' : 'sec'} sm" data-food-buy="${f.id}" ${can ? '' : 'disabled'}>${num(f.price)} G · ซื้อ</button>
        </div>`; }).join('') || '<div class="empty">ยังไม่มีเมนูในหมวดนี้</div>'}</div>
      <p class="small muted" style="margin:0">กินซ้ำชนิดเดียวกันต่อเวลาบัฟได้ (ไม่เกิน 12 ชม.) · บัฟแรงสุดเท่านั้นที่มีผล ไม่ซ้อนกันเกินแรงสุด</p>
    </div>`;
  };

  $('qsub-plan').addEventListener('click', async (ev) => {
    const c = ev.target.closest('[data-food-cat]'); if (c) { S.foodCat = c.dataset.foodCat; return App.renderPlan && App.renderPlan(); }
    const b = ev.target.closest('[data-food-buy]');
    if (b) {
      const f = (S.foods || []).find((x) => x.id === b.dataset.foodBuy); if (!f) return;
      b.disabled = true;
      await rpc('buy_food', { p_food: f.id, p_qty: 1 }, `ซื้อ ${f.name} แล้ว · อยู่ใน “ของกินที่ฉันมี”`);
      return;
    }
    const e = ev.target.closest('[data-food-eat]');
    if (e) {
      const f = (S.foods || []).find((x) => x.id === e.dataset.foodEat); if (!f) return;
      e.disabled = true;
      await rpc('eat_food', { p_food: f.id }, (x) => `อร่อย! ${KIND[x.kind]} +${x.pct}% ${leftText(x.until)}`);
    }
  });
})();
