/**
 * TabFlow × CycleWarden read-only companion.
 *
 * Security contract:
 * - requests optional permission only for 127.0.0.1;
 * - reads only /health and /snapshot from the fixed local core port;
 * - never POSTs or mutates Control Center state;
 * - never sends ChatGPT tab/conversation data to CycleWarden.
 */
(() => {
  'use strict';

  const CORE_BASE_URL = 'http://127.0.0.1:4318';
  const CORE_PERMISSION = 'http://127.0.0.1/*';
  const CONTROL_CENTER_URL = 'http://localhost:3000/app/control-center';
  const REFRESH_MS = 5000;
  const REQUEST_TIMEOUT_MS = 1600;

  const root = document.getElementById('control-center-companion');
  if (!root) return;

  const statusEl = document.getElementById('cc-status');
  const messageEl = document.getElementById('cc-message');
  const needsEl = document.getElementById('cc-needs');
  const flightEl = document.getElementById('cc-flight');
  const readyEl = document.getElementById('cc-ready');
  const connectBtn = document.getElementById('cc-connect');
  const openBtn = document.getElementById('cc-open');
  const refreshBtn = document.getElementById('cc-refresh');

  let timer = null;
  let loading = false;

  function setStatus(kind, label) {
    root.dataset.state = kind;
    statusEl.textContent = label;
  }

  function setCounts(snapshot) {
    needsEl.textContent = String(Array.isArray(snapshot?.needsYou) ? snapshot.needsYou.length : 0);
    flightEl.textContent = String(Array.isArray(snapshot?.inFlight) ? snapshot.inFlight.length : 0);
    readyEl.textContent = String(Array.isArray(snapshot?.readyToShip) ? snapshot.readyToShip.length : 0);
  }

  function resetCounts() {
    needsEl.textContent = '–';
    flightEl.textContent = '–';
    readyEl.textContent = '–';
  }

  async function hasCorePermission() {
    return chrome.permissions.contains({ origins: [CORE_PERMISSION] });
  }

  async function requestCorePermission() {
    return chrome.permissions.request({ origins: [CORE_PERMISSION] });
  }

  async function fetchLocalJson(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${CORE_BASE_URL}${path}`, {
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshControlCenter() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;

    try {
      const permitted = await hasCorePermission();
      connectBtn.hidden = permitted;
      if (!permitted) {
        setStatus('locked', 'Chưa kết nối');
        messageEl.textContent = 'Cho phép TabFlow đọc trạng thái Control Core local khi bạn cần.';
        resetCounts();
        return;
      }

      setStatus('checking', 'Đang kiểm tra…');
      const [health, snapshot] = await Promise.all([
        fetchLocalJson('/health'),
        fetchLocalJson('/snapshot')
      ]);

      if (!health?.ok) throw new Error('Control Core health check failed');
      setStatus('online', 'Core online');
      setCounts(snapshot);
      const projectCount = Array.isArray(snapshot?.projects) ? snapshot.projects.length : 0;
      messageEl.textContent = `${projectCount} project · chỉ đọc · 127.0.0.1:4318`;
    } catch (error) {
      setStatus('offline', 'Core offline');
      resetCounts();
      messageEl.textContent = 'Bật `pnpm dev:control-center` để xem trạng thái project local.';
      console.debug('[TabFlow Control Center] unavailable:', error?.message || error);
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshControlCenter();
    }, REFRESH_MS);
  }

  connectBtn.addEventListener('click', async () => {
    try {
      const granted = await requestCorePermission();
      if (!granted) {
        setStatus('locked', 'Chưa cấp quyền');
        messageEl.textContent = 'Không có quyền localhost; TabFlow vẫn hoạt động bình thường.';
        return;
      }
      await refreshControlCenter();
    } catch (error) {
      setStatus('offline', 'Không thể kết nối');
      messageEl.textContent = 'Chrome không cấp được quyền đọc Control Core local.';
      console.warn('[TabFlow Control Center] permission failed:', error);
    }
  });

  openBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: CONTROL_CENTER_URL });
  });

  refreshBtn.addEventListener('click', () => {
    void refreshControlCenter();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshControlCenter();
  });

  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer);
  });

  schedule();
  void refreshControlCenter();
})();
