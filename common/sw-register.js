// Service Worker 登録（オフライン動作用）。HTTPS か localhost でのみ有効です。
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
  const swUrl = new URL('../sw.js', document.currentScript.src);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl.href, { scope: new URL('./', swUrl).href })
      .catch((e) => console.warn('SW登録失敗', e));
  });
})();
