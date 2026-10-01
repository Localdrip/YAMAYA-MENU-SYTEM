/**
 * 通信レイヤー
 *  - GAS_URL が設定されていれば GAS ウェブアプリと通信
 *  - 未設定ならデモモード（localStorage を共有して同一ブラウザのタブ間で疑似通信）
 *  - Outbox: 注文はまず端末内に保存し、送信成功するまで再送（オフライン・Wi-Fi 断対策）
 */
(function (global) {
  'use strict';
  const C = global.YAMAYA_CONFIG || {};
  const DEMO = !C.GAS_URL;

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} },
    del(key) { try { localStorage.removeItem(key); } catch (_) {} },
  };

  const uid = (prefix) =>
    (prefix || '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const yen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');
  const ymd = (d) => {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  const isToday = (iso) => ymd(iso) === ymd(new Date());

  async function fetchJson(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), C.TIMEOUT_MS || 10000);
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow' }, opts));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'API error');
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  const remote = {
    get(action, params) {
      const q = new URLSearchParams(Object.assign({ action, token: C.API_TOKEN }, params || {}));
      return fetchJson(C.GAS_URL + '?' + q.toString());
    },
    // Content-Type を text/plain にすると CORS プリフライトが発生せず GAS に直接 POST できる
    post(action, body) {
      return fetchJson(C.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: C.API_TOKEN }, body || {})),
      });
    },
  };

  // ---------- デモモード ----------
  const DEMO_ORDERS = 'yamaya.demo.orders';
  const DEMO_SOLDOUT = 'yamaya.demo.soldout';
  const demo = {
    async get(action) {
      await sleep(120);
      switch (action) {
        case 'ping': return { demo: true, now: new Date().toISOString() };
        case 'orders': return store.get(DEMO_ORDERS, []).filter((o) => isToday(o.createdAt));
        case 'menuStatus': return { soldOut: store.get(DEMO_SOLDOUT, []) };
        case 'sales': return demoSales();
        case 'inventory': return demoInventory();
      }
      throw new Error('unknown action: ' + action);
    },
    async post(action, body) {
      await sleep(120);
      const now = new Date().toISOString();
      if (action === 'order') {
        const list = store.get(DEMO_ORDERS, []);
        if (!list.some((o) => o.id === body.order.id)) {
          list.push(Object.assign({}, body.order, { status: 'new', updatedAt: now }));
          store.set(DEMO_ORDERS, list.slice(-500));
        }
        return { id: body.order.id };
      }
      if (action === 'updateStatus') {
        const list = store.get(DEMO_ORDERS, []);
        const o = list.find((x) => x.id === body.id);
        if (!o) throw new Error('order not found');
        o.status = body.status; o.updatedAt = now;
        store.set(DEMO_ORDERS, list);
        return { id: o.id, status: o.status };
      }
      if (action === 'setSoldOut') {
        const set = new Set(store.get(DEMO_SOLDOUT, []));
        body.soldOut ? set.add(body.itemId) : set.delete(body.itemId);
        store.set(DEMO_SOLDOUT, [...set]);
        return { soldOut: [...set] };
      }
      throw new Error('unknown action: ' + action);
    },
  };

  function demoSales() {
    const daily = [];
    for (let i = 13; i >= 1; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const base = [0, 6].includes(d.getDay()) ? 180000 : 120000;
      daily.push({ date: ymd(d), total: base + ((i * 7919) % 40000) });
    }
    const today = store.get(DEMO_ORDERS, []).filter((o) => isToday(o.createdAt) && o.type === 'order' && o.status !== 'cancelled');
    const byItem = {};
    today.forEach((o) => o.items.forEach((l) => {
      const k = l.name;
      byItem[k] = byItem[k] || { name: k, qty: 0, amount: 0 };
      byItem[k].qty += l.qty; byItem[k].amount += l.qty * l.unitPrice;
    }));
    const total = today.reduce((s, o) => s + o.total, 0);
    daily.push({ date: ymd(new Date()), total });
    return {
      daily,
      today: { total, count: today.length, byItem: Object.values(byItem).sort((a, b) => b.amount - a.amount) },
    };
  }

  function demoInventory() {
    return {
      items: [
        { name: '鶏もも肉', stock: 4.5, min: 5, unit: 'kg', low: true },
        { name: '卵', stock: 120, min: 60, unit: '個', low: false },
        { name: '生ビール樽', stock: 1, min: 2, unit: '本', low: true },
        { name: '枝豆', stock: 3, min: 2, unit: 'kg', low: false },
        { name: 'レモン', stock: 25, min: 20, unit: '個', low: false },
      ],
      source: 'demo',
    };
  }

  const backend = DEMO ? demo : remote;

  // ---------- Outbox（未送信注文の保管と再送） ----------
  const OUTBOX = 'yamaya.outbox';
  const Outbox = {
    _busy: false,
    list() { return store.get(OUTBOX, []); },
    add(order) { const l = this.list(); l.push(order); store.set(OUTBOX, l); },
    remove(id) { store.set(OUTBOX, this.list().filter((o) => o.id !== id)); },
    async flush() {
      if (this._busy) return 0;
      this._busy = true;
      let sent = 0;
      try {
        for (const order of this.list()) {
          try {
            await backend.post('order', { order });
          } catch (err) {
            break; // 通信不可。次回の再送で続きから
          }
          this.remove(order.id);
          sent++;
          global.dispatchEvent(new CustomEvent('yamaya:sent', { detail: order }));
        }
      } finally {
        this._busy = false;
      }
      return sent;
    },
  };

  global.YAMAYA = {
    config: C, demo: DEMO, store, uid, yen, ymd, isToday,
    get: (action, params) => backend.get(action, params),
    post: (action, body) => backend.post(action, body),
    Outbox,
  };
})(window);
