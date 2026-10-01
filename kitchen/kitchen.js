/* 厨房OS */
(function () {
  'use strict';
  const Y = window.YAMAYA;
  const C = Y.config;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    orders: [],
    known: new Set(),   // 一度表示した注文ID（新着判定用）
    fresh: new Set(),   // 点滅させる注文ID
    pending: new Map(), // 送信中のステータス変更（ポーリングで上書きされないように）
    view: 'orders',
    menu: null,
    soldOut: new Set(),
    online: null,
  };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- 通知音（WebAudio。ユーザー操作後でないと鳴らないため開始画面を挟む） ----------
  let audio;
  function chime(kind) {
    if (!audio) return;
    const notes = kind === 'call' ? [880, 660, 880, 660] : [660, 880, 1100];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      const t = audio.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.17);
    });
  }

  // ---------- タブ切り替え ----------
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    [...$('#tabs').children].forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + state.view));
    if (state.view === 'sales') loadSales();
    if (state.view === 'inventory') loadInventory();
    if (state.view === 'soldout') loadSoldOut();
  });

  // ---------- 注文ボード ----------
  async function poll() {
    try {
      const orders = await Y.get('orders');
      setOnline(true);
      let newOrder = false, newCall = false;
      orders.forEach((o) => {
        if (!state.known.has(o.id)) {
          state.known.add(o.id);
          if (state.booted) { // 起動直後の既存分では鳴らさない
            state.fresh.add(o.id);
            setTimeout(() => state.fresh.delete(o.id), 4000);
            if (o.type === 'call') newCall = true; else newOrder = true;
          }
        }
        if (state.pending.has(o.id)) o.status = state.pending.get(o.id);
      });
      state.booted = true;
      state.orders = orders;
      if (newCall) chime('call'); else if (newOrder) chime('order');
      renderBoard();
    } catch (err) {
      setOnline(false);
    }
  }

  function elapsedMin(o) { return Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000); }
  function hhmm(iso) { const d = new Date(iso); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function renderBoard() {
    const cols = { new: [], cooking: [], served: [] };
    const keepMs = (C.SERVED_KEEP_MIN || 60) * 60000;
    state.orders.forEach((o) => {
      if (o.status === 'cancelled') return;
      if (o.status === 'served') {
        if (Date.now() - new Date(o.updatedAt || o.createdAt).getTime() < keepMs) cols.served.push(o);
      } else if (cols[o.status]) cols[o.status].push(o);
    });
    cols.new.sort((a, b) => (a.type === 'call') === (b.type === 'call') ? a.createdAt.localeCompare(b.createdAt) : a.type === 'call' ? -1 : 1);
    cols.cooking.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    cols.served.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    Object.keys(cols).forEach((k) => {
      $('#col-' + k).innerHTML = cols[k].map(cardHtml).join('');
      $('#cnt-' + k).textContent = cols[k].length ? `(${cols[k].length})` : '';
    });
    const nc = $('#newCount');
    nc.textContent = cols.new.length; nc.classList.toggle('zero', !cols.new.length);
  }

  function cardHtml(o) {
    const min = elapsedMin(o);
    const late = o.status !== 'served' && min >= 15;
    const cls = ['card', o.type === 'call' ? 'call' : '', o.status, late ? 'late' : '', state.fresh.has(o.id) ? 'fresh' : ''].join(' ');
    let body;
    if (o.type === 'call') {
      body = `<div class="note">🔔 ${esc(o.note || '呼び出し')}</div>`;
    } else {
      body = '<ul>' + o.items.map((l) => `<li><span>${esc(l.name)}${l.options && l.options.length ? `<span class="o">${esc(l.options.map((x) => x.label).join(' / '))}</span>` : ''}</span><span class="q">×${l.qty}</span></li>`).join('') + '</ul>'
        + (o.note ? `<div class="note">${esc(o.note)}</div>` : '');
    }
    let btns;
    if (o.type === 'call') btns = o.status === 'served' ? '' : `<button class="primary" data-act="served">対応済み</button>`;
    else if (o.status === 'new') btns = `<button data-act="cancelled">取消</button><button class="primary" data-act="cooking">調理開始</button>`;
    else if (o.status === 'cooking') btns = `<button data-act="new">戻す</button><button class="primary" data-act="served">提供済み</button>`;
    else btns = `<button data-act="cooking">調理中に戻す</button>`;
    return `<article class="${cls}" data-id="${esc(o.id)}">
      <div class="card-head"><span class="tbl-no">${esc(o.table)}番</span><span class="time">${hhmm(o.createdAt)}</span>
      <span class="elapsed">${min}分</span></div>${body}<div class="btns">${btns}</div></article>`;
  }

  $('#view-orders').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('.card').dataset.id;
    const status = b.dataset.act;
    if (status === 'cancelled' && !window.confirm('この注文を取り消しますか？')) return;
    const o = state.orders.find((x) => x.id === id);
    if (!o) return;
    const prev = o.status;
    o.status = status; o.updatedAt = new Date().toISOString();
    state.pending.set(id, status);
    renderBoard();
    try {
      await Y.post('updateStatus', { id, status });
    } catch (err) {
      o.status = prev;
      toast('更新に失敗しました。通信状態を確認してください');
      renderBoard();
    } finally {
      state.pending.delete(id);
    }
  });

  // ---------- 売上 ----------
  async function loadSales() {
    try {
      const s = await Y.get('sales', { days: 14 });
      const daily = s.daily || [];
      const avg = daily.length > 1 ? Math.round(daily.slice(0, -1).reduce((a, d) => a + d.total, 0) / (daily.length - 1)) : 0;
      $('#kpis').innerHTML = [
        ['本日の売上', Y.yen(s.today.total)],
        ['本日の注文数', s.today.count + '件'],
        ['客単価目安（注文単位）', s.today.count ? Y.yen(Math.round(s.today.total / s.today.count)) : '-'],
        ['過去13日の平均', Y.yen(avg)],
      ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
      const max = Math.max(1, ...daily.map((d) => d.total));
      const today = Y.ymd(new Date());
      $('#dailyChart').innerHTML = daily.map((d) => `<div class="bar ${d.date === today ? 'today' : ''}">
        <span>${d.date.slice(5).replace('-', '/')}</span>
        <div class="track"><div class="fill" style="width:${(d.total / max * 100).toFixed(1)}%"></div></div>
        <span class="amt">${Y.yen(d.total)}</span></div>`).join('') || '<p class="hint">データがありません</p>';
      $('#byItem').innerHTML = '<tr><th>商品</th><th class="num">数量</th><th class="num">金額</th></tr>'
        + (s.today.byItem || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td class="num">${Y.yen(r.amount)}</td></tr>`).join('');
    } catch (err) {
      toast('売上データを取得できませんでした');
    }
  }
  $('#reloadSales').addEventListener('click', loadSales);

  // ---------- 在庫 ----------
  async function loadInventory() {
    try {
      const inv = await Y.get('inventory');
      const items = (inv.items || []).slice().sort((a, b) => (b.low - a.low));
      $('#invTable').innerHTML = '<tr><th>品名</th><th class="num">在庫</th><th class="num">発注点</th><th>単位</th></tr>'
        + items.map((r) => `<tr class="${r.low ? 'low' : ''}"><td>${esc(r.name)}</td><td class="num">${esc(r.stock)}</td><td class="num">${esc(r.min)}</td><td>${esc(r.unit)}</td></tr>`).join('');
    } catch (err) {
      toast('在庫データを取得できませんでした');
    }
  }
  $('#reloadInv').addEventListener('click', loadInventory);

  // ---------- 品切れ設定 ----------
  async function loadSoldOut() {
    try {
      if (!state.menu) state.menu = await (await fetch('../data/menu.json', { cache: 'no-cache' })).json();
      const st = await Y.get('menuStatus');
      state.soldOut = new Set(st.soldOut || []);
    } catch (err) {
      toast('品切れ情報を取得できませんでした');
    }
    renderSoldOut();
  }
  function renderSoldOut() {
    if (!state.menu) return;
    $('#soGrid').innerHTML = Object.entries(state.menu.items).map(([id, it]) =>
      `<button data-id="${esc(id)}" class="${state.soldOut.has(id) ? 'out' : ''}">${esc(it.name)}<small>${state.soldOut.has(id) ? '売り切れ中' : '販売中'}</small></button>`).join('');
  }
  $('#soGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const id = b.dataset.id;
    const next = !state.soldOut.has(id);
    try {
      const r = await Y.post('setSoldOut', { itemId: id, soldOut: next });
      state.soldOut = new Set(r.soldOut);
      renderSoldOut();
    } catch (err) {
      toast('更新に失敗しました');
    }
  });

  // ---------- 状態表示・時計 ----------
  function setOnline(ok) {
    state.online = ok;
    const el = $('#net');
    if (Y.demo) { el.className = 'net demo'; el.textContent = 'デモモード'; return; }
    el.className = 'net ' + (ok ? 'ok' : 'ng');
    el.textContent = ok ? '接続中' : '通信エラー';
  }
  function tick() {
    const d = new Date();
    $('#clock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  document.addEventListener('contextmenu', (e) => e.preventDefault());

  $('#startBtn').addEventListener('click', () => {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); chime('order'); } catch (_) {}
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    $('#start').classList.add('hidden');
  });

  tick();
  setInterval(tick, 10000);
  setInterval(() => { if (state.view === 'orders') renderBoard(); }, 30000); // 経過時間の更新
  poll();
  setInterval(poll, C.POLL_MS || 5000);
})();
