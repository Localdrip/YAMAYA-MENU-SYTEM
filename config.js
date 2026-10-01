/**
 * YAMAYA タブレットシステム 共通設定
 * ここを書き換えれば、カスタマーOS / 厨房OS の両方に反映されます。
 */
window.YAMAYA_CONFIG = {
  STORE_NAME: 'YAMAYA',

  // GAS ウェブアプリの URL（https://script.google.com/macros/s/xxxx/exec）
  // 空文字のままだと「デモモード」で動作します（同じブラウザ内の localStorage で疑似通信）。
  GAS_URL: '',

  // GAS 側 CONFIG.TOKEN と同じ値にしてください（簡易認証）。
  API_TOKEN: 'yamaya-change-me',

  // カスタマーOS の管理メニューを開く PIN（ロゴ長押し → PIN 入力）
  ADMIN_PIN: '1234',

  POLL_MS: 5000,            // 厨房OS：注文の取得間隔
  STATUS_POLL_MS: 30000,    // カスタマーOS：売り切れ情報の取得間隔
  OUTBOX_RETRY_MS: 5000,    // カスタマーOS：未送信注文の再送間隔
  TIMEOUT_MS: 10000,        // 通信タイムアウト
  IDLE_RESET_SEC: 180,      // カスタマーOS：無操作でトップページへ戻るまでの秒数
  SERVED_KEEP_MIN: 60,      // 厨房OS：提供済みを表示しておく時間（分）
};
