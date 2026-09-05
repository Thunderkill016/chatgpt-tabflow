/**
 * ChatGPT TabFlow - Options Settings Controller
 */

(() => {
  'use strict';

  const optAutoDiscard = document.getElementById('opt-auto-discard');
  const optIdleMinutes = document.getElementById('opt-idle-minutes');
  const optDomBooster = document.getElementById('opt-dom-booster');
  const optTypingShield = document.getElementById('opt-typing-shield');
  const optKillAnimations = document.getElementById('opt-kill-animations');
  const optGroupTabs = document.getElementById('opt-group-tabs');
  const optGroupName = document.getElementById('opt-group-name');
  const optGroupColor = document.getElementById('opt-group-color');
  const btnSave = document.getElementById('btn-save-settings');
  const toast = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2500);
  }

  async function loadSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (res && res.success && res.settings) {
        const s = res.settings;
        optAutoDiscard.checked = Boolean(s.autoDiscardEnabled);
        optIdleMinutes.value = String(s.discardIdleMinutes || 5);
        optDomBooster.checked = Boolean(s.domBoosterEnabled);
        optTypingShield.checked = Boolean(s.typingShieldEnabled);
        optKillAnimations.checked = Boolean(s.killAnimations);
        optGroupTabs.checked = Boolean(s.groupTabsEnabled);
        optGroupName.value = s.groupName || '🤖 ChatGPT Workspace';
        optGroupColor.value = s.groupColor || 'purple';
      }
    } catch (err) {
      console.error('[TabFlow Options] Load settings failed:', err);
    }
  }

  async function saveSettings() {
    const updated = {
      autoDiscardEnabled: optAutoDiscard.checked,
      discardIdleMinutes: parseInt(optIdleMinutes.value, 10) || 5,
      domBoosterEnabled: optDomBooster.checked,
      typingShieldEnabled: optTypingShield.checked,
      killAnimations: optKillAnimations.checked,
      groupTabsEnabled: optGroupTabs.checked,
      groupName: optGroupName.value.trim() || '🤖 ChatGPT Workspace',
      groupColor: optGroupColor.value
    };

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        settings: updated
      });
      if (res && res.success) {
        showToast('✅ Đã lưu cài đặt thành công!');
      }
    } catch (err) {
      console.error('[TabFlow Options] Save settings failed:', err);
      showToast('❌ Lỗi lưu cài đặt');
    }
  }

  btnSave.addEventListener('click', saveSettings);
  loadSettings();
})();
