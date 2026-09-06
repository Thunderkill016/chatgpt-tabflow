/**
 * TabFlow v3 quick launcher.
 * Keeps the popup intentionally small: real counts + entry points only.
 */

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const tabCountEl = $('popup-tab-count');
  const generatingCountEl = $('popup-generating-count');
  const sleepingCountEl = $('popup-sleeping-count');
  const versionEl = $('popup-version');
  const toastEl = $('popup-toast');
  let toastTimer = null;

  function showToast(message, tone = 'info') {
    if (!toastEl) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.dataset.tone = tone;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  async function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ type, ...payload });
  }

  async function loadPopupData() {
    try {
      const [tabsData, runtimeData] = await Promise.all([
        send('GET_TABS_DATA'),
        send('RUNTIME_GET_STATE').catch(() => null)
      ]);
      const tabs = tabsData?.success ? tabsData.tabs || [] : [];
      const snapshot = runtimeData?.success ? runtimeData.snapshot || {} : {};
      tabCountEl.textContent = String(tabs.length);
      sleepingCountEl.textContent = String(tabs.filter(tab => tab.discarded).length);
      generatingCountEl.textContent = String(Number(snapshot.generatingCount || 0));
    } catch (error) {
      console.warn('[TabFlow Popup] summary unavailable:', error?.message || error);
    }
  }

  $('btn-popup-hub').addEventListener('click', async () => {
    await send('OPEN_WORKSPACE');
    window.close();
  });

  $('btn-popup-sidepanel').addEventListener('click', async () => {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close();
    } catch (error) {
      showToast(`Không mở được Control Center: ${error?.message || error}`, 'error');
    }
  });

  $('btn-popup-recorder').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('recorder/index.html') });
    window.close();
  });

  $('btn-popup-freeze').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await send('DISCARD_ALL_BACKGROUND');
      if (!result?.success) throw new Error(result?.error || 'Không thể tối ưu chat nền');
      if (result.discardedCount > 0) {
        showToast(`Đã cho ${result.discardedCount} chat nhàn rỗi ngủ.`, 'success');
      } else if (result.protectedCount > 0) {
        showToast(`${result.protectedCount} chat đang làm việc nên được giữ nguyên.`, 'warning');
      } else {
        showToast('Không có chat nền nào cần ngủ.');
      }
      await loadPopupData();
    } catch (error) {
      showToast(error?.message || String(error), 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('btn-popup-group').addEventListener('click', async () => {
    try {
      await send('GROUP_TABS');
      showToast('Đã gom các chat vào Tab Group.', 'success');
    } catch (error) {
      showToast(`Không gom được tab: ${error?.message || error}`, 'error');
    }
  });

  $('link-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  loadPopupData();
})();
