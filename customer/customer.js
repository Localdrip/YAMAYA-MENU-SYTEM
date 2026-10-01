/* カスタマーOS（客席タブレット） */
(function () {
  'use strict';
  const Y = window.YAMAYA;
  const C = Y.config;
  const $ = (s) => document.querySelector(s);

  const K = { CART: 'yamaya.cart', TABLE: 'yamaya.table', HISTORY: 'yamaya.history', MENU: 'yamaya.menuCache' };

  const state = {
    menu: null,
    page: 0,
    cart: Y.store.get(K.CART, []),
    table: Y.store.get(K.TABLE, ''),
    history: Y.store.get(K.HISTORY, []),
    soldOut: new Set(),
    current: null, // 商品モーダルの編集中データ
  };

  // ---------- 共通UI ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  const open = (el) => el.classList.remove('hidden');
  const close = (el) => el.classList.add('hidden');
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => close(b.closest('.backdrop'))));
  document.querySelectorAll('.backdrop').forEach((bd) =>
    bd.addEventListener('click', (e) => { if (e.target === bd) close(bd); }));

  function confirmDialog(title, body) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = title;
      $('#confirmBody').textContent = body || '';
      const m = $('#confirmModal');
      open(m);
      const done = (v) => { close(m); ok.removeEventListener('click', yes); m.removeEventListener('click', no, true); resolve(v); };
      const ok = $('#confirmOk');
      const yes = () => done(true);
      const no = (e) => { if (e.target === m || e.target.hasAttribute('data-close')) done(false); };
      ok.addEventListener('click', yes);
      m.addEventListener('click', no, true);
    });
  }

  // ---------- メニュー読み込み ----------
  async function loadMenu() {
    try {
      const res = await fetch('../data/menu.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      state.menu = await res.json();
      Y.store.set(K.MENU, state.menu);
    } catch (err) {
      state.menu = Y.store.get(K.MENU, null); // 完全オフライン時は前回のメニュー
      if (!state.menu) { toast('メニューを読み込めませんでした'); return; }
    }
    $('#priceNote').textContent = state.menu.priceNote || '';
    renderTabs();
    showPage(Math.min(state.page, state.menu.pages.length - 1));
  }

  function renderTabs() {
    const nav = $('#pageTabs');
    nav.innerHTML = '';
    state.menu.pages.forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.title;
      b.addEventListener('click', () => showPage(i));
      nav.appendChild(b);
    });
  }

  function showPage(i) {
    const pages = state.menu.pages;
    state.page = (i + pages.length) % pages.length;
    const p = pages[state.page];
    [...$('#pageTabs').children].forEach((b, idx) => b.classList.toggle('active', idx === state.page));
    const img = $('#pageImg');
    img.onload = layout;
    img.src = '../' + p.image;
    renderHotspots();
  }

  // 画像の縦横比を保ったまま、ステージに収まる最大サイズに合わせる
  function layout() {
    const img = $('#pageImg');
    if (!img.naturalWidth) return;
    const stage = $('#stage');
    const cs = getComputedStyle(stage);
    const sw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const sh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const scale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
    const page = $('#page');
    page.style.width = Math.floor(img.naturalWidth * scale) + 'px';
    page.style.height = Math.floor(img.naturalHeight * scale) + 'px';
  }
  window.addEventListener('resize', layout);

  function renderHotspots() {
    const layer = $('#hotspots');
    layer.innerHTML = '';
    const p = state.menu.pages[state.page];
    p.hotspots.forEach((h) => {
      const item = state.menu.items[h.itemId];
      if (!item) return;
      const b = document.createElement('button');
      b.className = 'hotspot' + (state.soldOut.has(h.itemId) ? ' soldout' : '');
      b.style.left = h.x + '%'; b.style.top = h.y + '%';
      b.style.width = h.w + '%'; b.style.height = h.h + '%';
      b.setAttribute('aria-label', item.name);
      b.addEventListener('click', () => {
        b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 200);
        if (state.soldOut.has(h.itemId)) return toast(item.name + ' は売り切れです');
        openItem(h.itemId);
      });
      layer.appendChild(b);
    });
  }

  // スワイプでページ送り
  (function swipe() {
    let x0 = null, y0 = null;
    const stage = $('#stage');
    stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) showPage(state.page + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  })();
  $('#prevPage').addEventListener('click', () => showPage(state.page - 1));
  $('#nextPage').addEventListener('click', () => showPage(state.page + 1));

  // ---------- 商品モーダル ----------
  function openItem(itemId) {
    const item = state.menu.items[itemId];
    state.current = {
      itemId, item, qty: 1,
      picks: (item.options || []).map(() => 0), // 各オプショングループの選択index
    };
    $('#itemName').textContent = item.name;
    $('#itemDesc').textContent = item.description || '';
    const wrap = $('#itemOptions');
    wrap.innerHTML = '';
    (item.options || []).forEach((g, gi) => {
      const box = document.createElement('div');
      box.className = 'optgroup';
      box.innerHTML = '<div class="label"></div><div class="choices"></div>';
      box.querySelector('.label').textContent = g.name;
      const ch = box.querySelector('.choices');
      g.choices.forEach((c, ci) => {
        const b = document.createElement('button');
        b.textContent = c.label + (c.price ? `（+${Y.yen(c.price)}）` : '');
        b.addEventListener('click', () => { state.current.picks[gi] = ci; updateItem(); });
        ch.appendChild(b);
      });
      wrap.appendChild(box);
    });
    updateItem();
    open($('#itemModal'));
  }

  function currentUnitPrice() {
    const { item, picks } = state.current;
    return item.price + (item.options || []).reduce((s, g, gi) => s + (g.choices[picks[gi]].price || 0), 0);
  }

  function updateItem() {
    const cur = state.current;
    $('#qty').textContent = cur.qty;
    $('#itemPrice').textContent = Y.yen(currentUnitPrice() * cur.qty);
    [...$('#itemOptions').children].forEach((box, gi) =>
      [...box.querySelectorAll('.choices button')].forEach((b, ci) => b.classList.toggle('active', cur.picks[gi] === ci)));
  }
  $('#qtyMinus').addEventListener('click', () => { state.current.qty = Math.max(1, state.current.qty - 1); updateItem(); });
  $('#qtyPlus').addEventListener('click', () => { state.current.qty = Math.min(20, state.current.qty + 1); updateItem(); });

  $('#addToCart').addEventListener('click', () => {
    const { itemId, item, qty, picks } = state.current;
    const options = (item.options || []).map((g, gi) => ({ group: g.name, label: g.choices[picks[gi]].label, price: g.choices[picks[gi]].price || 0 }));
    const key = itemId + '|' + options.map((o) => o.label).join('/');
    const line = state.cart.find((l) => l.key === key);
    if (line) line.qty += qty;
    else state.cart.push({ key, itemId, name: item.name, unitPrice: currentUnitPrice(), qty, options });
    saveCart();
    close($('#itemModal'));
    toast(item.name + ' をカートに入れました');
  });

  // ---------- カート ----------
  function saveCart() { Y.store.set(K.CART, state.cart); renderCart(); }
  const cartTotal = () => state.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const optText = (opts) => (opts || []).map((o) => o.label).join(' / ');

  function renderCart() {
    $('#cartCount').textContent = state.cart.reduce((s, l) => s + l.qty, 0);
    $('#cartTotal').textContent = Y.yen(cartTotal());
    $('#placeOrder').disabled = state.cart.length === 0;
    const ul = $('#cartLines');
    ul.innerHTML = state.cart.length ? '' : '<li class="empty">カートは空です</li>';
    state.cart.forEach((l, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="line-top"><span class="n"></span><span>${Y.yen(l.unitPrice * l.qty)}</span></div>
        <div class="line-opt"></div>
        <div class="line-ctl"><button data-d="-1">−</button><b>${l.qty}</b><button data-d="1">＋</button>
          <button class="rm">削除</button></div>`;
      li.querySelector('.n').textContent = l.name;
      li.querySelector('.line-opt').textContent = optText(l.options);
      li.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
        l.qty += Number(b.dataset.d);
        if (l.qty <= 0) state.cart.splice(i, 1);
        saveCart();
      }));
      li.querySelector('.rm').addEventListener('click', () => { state.cart.splice(i, 1); saveCart(); });
      ul.appendChild(li);
    });
  }
  const openCart = () => $('#cart').classList.add('open');
  const closeCart = () => $('#cart').classList.remove('open');
  $('#btnCart').addEventListener('click', openCart);
  $('#closeCart').addEventListener('click', closeCart);

  // ---------- 注文送信 ----------
  function buildOrder(type, items, note) {
    return {
      id: Y.uid('T' + (state.table || 'X') + '-'),
      type, table: String(state.table), items,
      total: items.reduce((s, l) => s + l.unitPrice * l.qty, 0),
      note: note || '', createdAt: new Date().toISOString(),
    };
  }
  function requireTable() {
    if (state.table) return true;
    toast('テーブル番号が未設定です。スタッフにお声がけください');
    return false;
  }

  $('#placeOrder').addEventListener('click', async () => {
    if (!state.cart.length || !requireTable()) return;
    const ok = await confirmDialog('この内容で注文しますか？', `合計 ${Y.yen(cartTotal())}`);
    if (!ok) return;
    const items = state.cart.map(({ itemId, name, unitPrice, qty, options }) => ({ itemId, name, unitPrice, qty, options }));
    const order = buildOrder('order', items);
    Y.Outbox.add(order);             // 先に端末内へ保存 → 通信断でも注文が消えない
    state.history.push(Object.assign({}, order, { sent: false }));
    Y.store.set(K.HISTORY, state.history);
    state.cart = []; saveCart(); closeCart();
    showThanks();
    flush();
  });

  async function staffCall(note) {
    if (!requireTable()) return;
    const ok = await confirmDialog(note === 'お会計' ? 'お会計をお願いしますか？' : '店員を呼びますか？');
    if (!ok) return;
    Y.Outbox.add(buildOrder('call', [], note));
    toast('スタッフをお呼びしました。少々お待ちください');
    flush();
  }
  $('#btnCall').addEventListener('click', () => staffCall('呼び出し'));
  $('#btnCheckout').addEventListener('click', () => { close($('#historyModal')); staffCall('お会計'); });

  function showThanks() {
    const t = $('#thanks');
    $('#thanksSub').textContent = '少々お待ちください。';
    open(t);
    setTimeout(() => close(t), 2500);
  }

  async function flush() {
    await Y.Outbox.flush();
    updateNet();
  }
  window.addEventListener('yamaya:sent', (e) => {
    const h = state.history.find((o) => o.id === e.detail.id);
    if (h) { h.sent = true; Y.store.set(K.HISTORY, state.history); }
  });

  // ---------- 注文履歴 ----------
  $('#btnHistory').addEventListener('click', () => {
    const ul = $('#historyList');
    ul.innerHTML = state.history.length ? '' : '<li class="empty">まだご注文はありません</li>';
    state.history.slice().reverse().forEach((o) => {
      const li = document.createElement('li');
      const t = new Date(o.createdAt);
      li.innerHTML = `<div class="line-top"><span>${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}
        <span class="status ${o.sent ? '' : 'pending'}">${o.sent ? '送信済み' : '送信待ち'}</span></span>
        <span>${Y.yen(o.total)}</span></div><div class="line-opt"></div>`;
      li.querySelector('.line-opt').textContent = o.items.map((l) => `${l.name}${l.options.length ? '（' + optText(l.options) + '）' : ''} ×${l.qty}`).join('、');
      ul.appendChild(li);
    });
    $('#historyTotal').textContent = Y.yen(state.history.reduce((s, o) => s + o.total, 0));
    open($('#historyModal'));
  });

  // ---------- 売り切れ情報 ----------
  async function pollStatus() {
    try {
      const st = await Y.get('menuStatus');
      state.soldOut = new Set(st.soldOut || []);
      if (state.menu) renderHotspots();
      // 売り切れになった商品はカートからも外す
      const before = state.cart.length;
      state.cart = state.cart.filter((l) => !state.soldOut.has(l.itemId));
      if (state.cart.length !== before) { saveCart(); toast('売り切れになった商品をカートから外しました'); }
    } catch (_) { /* オフライン時は前回の状態を維持 */ }
    updateNet();
  }

  function updateNet() {
    const el = $('#net');
    const pending = Y.Outbox.list().length;
    if (Y.demo) { el.className = 'net demo'; el.textContent = 'デモモード' + (pending ? `・未送信${pending}` : ''); return; }
    if (!navigator.onLine || pending) { el.className = 'net ng'; el.textContent = pending ? `未送信 ${pending}件` : 'オフライン'; return; }
    el.className = 'net ok'; el.textContent = '接続中';
  }
  window.addEventListener('online', flush);
  window.addEventListener('offline', updateNet);

  // ---------- 管理メニュー（ロゴ長押し 2秒） ----------
  (function admin() {
    let timer;
    const brand = $('#brand');
    brand.addEventListener('pointerdown', () => { timer = setTimeout(openAdmin, 2000); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => brand.addEventListener(ev, () => clearTimeout(timer)));

    function openAdmin() {
      $('#adminPin').value = '';
      open($('#adminLock')); close($('#adminPanel'));
      open($('#adminModal'));
      setTimeout(() => $('#adminPin').focus(), 50);
    }
    $('#adminUnlock').addEventListener('click', () => {
      if ($('#adminPin').value !== String(C.ADMIN_PIN)) return toast('PIN が違います');
      close($('#adminLock')); open($('#adminPanel'));
      $('#adminTable').value = state.table;
      $('#adminInfo').textContent = `メニュー版: ${state.menu ? state.menu.version : '-'} ／ 通信: ${Y.demo ? 'デモモード' : 'GAS'} ／ 未送信: ${Y.Outbox.list().length}件`;
    });
    $('#adminSave').addEventListener('click', () => {
      state.table = $('#adminTable').value.trim();
      Y.store.set(K.TABLE, state.table);
      $('#tableNo').textContent = state.table || '未設定';
      close($('#adminModal'));
    });
    $('#adminClear').addEventListener('click', () => {
      state.history = []; Y.store.set(K.HISTORY, []);
      state.cart = []; saveCart();
      toast('履歴とカートを消去しました');
    });
    $('#adminReload').addEventListener('click', () => { close($('#adminModal')); loadMenu(); });
  })();

  // ---------- 無操作リセット ----------
  (function idle() {
    let t;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        document.querySelectorAll('.backdrop').forEach(close);
        closeCart();
        if (state.menu) showPage(0);
      }, (C.IDLE_RESET_SEC || 180) * 1000);
    };
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
    reset();
  })();

  // 長押しメニュー・ピンチズームなどキオスクで邪魔な挙動を抑止
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  if (new URLSearchParams(location.search).has('debug')) document.body.classList.add('show-hotspots');

  // ---------- 起動 ----------
  $('#tableNo').textContent = state.table || '未設定';
  renderCart();
  updateNet();
  loadMenu().then(pollStatus);
  setInterval(pollStatus, C.STATUS_POLL_MS || 30000);
  setInterval(flush, C.OUTBOX_RETRY_MS || 5000);
})();
