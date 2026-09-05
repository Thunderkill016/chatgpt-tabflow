/**
 * ChatGPT TabFlow - Quick Popup Controller
 */

(() => {
  'use strict';

  const tabCountEl = document.getElementById('popup-tab-count');
  const ramSavedEl = document.getElementById('popup-ram-saved');
  const btnHub = document.getElementById('btn-popup-hub');
  const btnFreeze = document.getElementById('btn-popup-freeze');
  const btnSidepanel = document.getElementById('btn-popup-sidepanel');
  const btnGroup = document.getElementById('btn-popup-group');
  const linkOptions = document.getElementById('link-options');
  const toastEl = document.getElementById('popup-toast');

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    setTimeout(() => {
      toastEl.style.display = 'none';
    }, 2000);
  }

  function formatMb(mb) {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  }

  async function loadPopupData() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' });
      if (res && res.success) {
        tabCountEl.textContent = res.tabs.length;
        const savedMb = res.stats?.estimatedMbSaved || 0;
        ramSavedEl.textContent = formatMb(savedMb);
      }
    } catch (err) {
      console.warn('[TabFlow Popup] Load error:', err);
    }
  }

  btnFreeze.addEventListener('click', async () => {
    btnFreeze.disabled = true;
    btnFreeze.textContent = 'Đang dọn RAM...';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DISCARD_ALL_BACKGROUND' });
      if (res && res.success) {
        showToast(`⚡ Đã dọn ${res.discardedCount} tab, tiết kiệm ${formatMb(res.freedMb)} RAM!`);
      }
    } finally {
      btnFreeze.disabled = false;
      btnFreeze.innerHTML = '<span>⚡</span> Turbo Freeze — Dọn RAM Ngay';
      await loadPopupData();
    }
  });

  btnSidepanel.addEventListener('click', async () => {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close();
    } catch (err) {
      console.error('[TabFlow Popup] Open SidePanel failed:', err);
    }
  });

  btnHub.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'OPEN_WORKSPACE' });
    window.close();
  });

  btnGroup.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'GROUP_TABS' });
    showToast('Đã gom các tab ChatGPT vào Tab Group!');
  });

  linkOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  loadPopupData();
})();
