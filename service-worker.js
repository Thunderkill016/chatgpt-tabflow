import { canDiscardRuntimeTab } from './runtime/protection.js';

/**
 * TabFlow background lifecycle controller (Manifest V3).
 * Manages ChatGPT tabs, sessions, grouping and safe hibernation.
 */

const DEFAULT_SETTINGS = {
  autoDiscardEnabled: true,
  discardIdleMinutes: 5,
  groupTabsEnabled: true,
  groupName: '🤖 ChatGPT Workspace',
  groupColor: 'purple',
  domBoosterEnabled: true,
  typingShieldEnabled: true,
  killAnimations: true
};

const DEFAULT_STATS = {
  totalDiscardCount: 0,
  lastDiscardTimestamp: 0
};

export function isChatGptUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' || host.endsWith('.chat.openai.com');
  } catch {
    return false;
  }
}

async function getStoredSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

function sanitizeStats(value = {}) {
  return {
    totalDiscardCount: Number(value.totalDiscardCount) || 0,
    lastDiscardTimestamp: Number(value.lastDiscardTimestamp) || 0
  };
}

async function getStoredStats() {
  const result = await chrome.storage.local.get('stats');
  return sanitizeStats(result.stats || DEFAULT_STATS);
}

async function recordDiscardStats(count) {
  if (count <= 0) return;
  const currentStats = await getStoredStats();
  await chrome.storage.local.set({
    stats: {
      totalDiscardCount: currentStats.totalDiscardCount + count,
      lastDiscardTimestamp: Date.now()
    }
  });
}

export async function queryChatGptTabs(options = {}) {
  const { excludeActive = false } = options;
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => {
    if (!isChatGptUrl(tab.url)) return false;
    if (excludeActive && tab.active) return false;
    return true;
  });
}

export async function discardSingleTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.discarded) return false;
    if (!(await canDiscardRuntimeTab(tabId))) {
      console.info(`[TabFlow] Skip discard for protected productive tab ${tabId}`);
      return false;
    }
    await chrome.tabs.discard(tabId);
    await recordDiscardStats(1);
    await updateBadge();
    return true;
  } catch (err) {
    console.warn(`[TabFlow] Could not discard tab ${tabId}:`, err?.message || err);
    return false;
  }
}

export async function discardAllBackgroundTabs() {
  const tabs = await queryChatGptTabs({ excludeActive: true });
  let discardedCount = 0;
  let protectedCount = 0;

  for (const tab of tabs) {
    if (tab.discarded || !tab.id) continue;
    try {
      if (!(await canDiscardRuntimeTab(tab.id))) {
        protectedCount++;
        continue;
      }
      await chrome.tabs.discard(tab.id);
      discardedCount++;
    } catch (err) {
      console.warn(`[TabFlow] Discard failed for tab ${tab.id}:`, err?.message || err);
    }
  }

  if (discardedCount > 0) {
    await recordDiscardStats(discardedCount);
    await updateBadge();
  }

  return { discardedCount, protectedCount };
}

export async function groupChatGptTabs() {
  const settings = await getStoredSettings();
  if (!settings.groupTabsEnabled) return;

  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    const chatGptTabIds = (win.tabs || [])
      .filter(tab => isChatGptUrl(tab.url))
      .map(tab => tab.id)
      .filter(Boolean);

    if (chatGptTabIds.length === 0) continue;
    try {
      const groupId = await chrome.tabs.group({
        tabIds: chatGptTabIds,
        createProperties: { windowId: win.id }
      });
      await chrome.tabGroups.update(groupId, {
        title: settings.groupName || '🤖 ChatGPT Workspace',
        color: settings.groupColor || 'purple'
      });
    } catch (err) {
      console.warn('[TabFlow] Tab grouping skipped or failed:', err?.message || err);
    }
  }
}

export async function stashCurrentSession(sessionName) {
  const tabs = await queryChatGptTabs();
  if (tabs.length === 0) return { success: false, message: 'Không có tab ChatGPT nào đang mở' };

  const tabList = tabs.map(tab => ({
    url: tab.url,
    title: tab.title || 'ChatGPT Conversation',
    pinned: tab.pinned || false
  }));

  const session = {
    id: `session_${Date.now()}`,
    name: sessionName || `ChatGPT Stash ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`,
    timestamp: Date.now(),
    tabCount: tabList.length,
    tabs: tabList
  };

  const stored = await chrome.storage.local.get('stashedSessions');
  const list = Array.isArray(stored.stashedSessions) ? stored.stashedSessions : [];
  list.unshift(session);
  await chrome.storage.local.set({ stashedSessions: list });

  const tabIds = tabs.map(tab => tab.id).filter(Boolean);
  await chrome.tabs.remove(tabIds);
  await updateBadge();
  return { success: true, session };
}

export async function restoreSession(sessionId) {
  const stored = await chrome.storage.local.get('stashedSessions');
  const list = Array.isArray(stored.stashedSessions) ? stored.stashedSessions : [];
  const target = list.find(session => session.id === sessionId);
  if (!target || !target.tabs || target.tabs.length === 0) {
    return { success: false, message: 'Phiên lưu trữ không tồn tại hoặc rỗng' };
  }

  const currentWindow = await chrome.windows.getCurrent();
  const createdTabIds = [];

  for (const item of target.tabs) {
    const newTab = await chrome.tabs.create({
      url: item.url,
      active: false,
      pinned: item.pinned || false,
      windowId: currentWindow.id
    });
    if (newTab.id) createdTabIds.push(newTab.id);
  }

  const settings = await getStoredSettings();
  if (settings.groupTabsEnabled && createdTabIds.length > 0) {
    try {
      const groupId = await chrome.tabs.group({
        tabIds: createdTabIds,
        createProperties: { windowId: currentWindow.id }
      });
      await chrome.tabGroups.update(groupId, {
        title: settings.groupName,
        color: settings.groupColor
      });
    } catch (error) {
      console.warn('[TabFlow] Could not group restored tabs:', error?.message || error);
    }
  }

  await updateBadge();
  return { success: true, count: createdTabIds.length };
}

export async function deleteStashedSession(sessionId) {
  const stored = await chrome.storage.local.get('stashedSessions');
  const list = Array.isArray(stored.stashedSessions) ? stored.stashedSessions : [];
  await chrome.storage.local.set({ stashedSessions: list.filter(session => session.id !== sessionId) });
  return { success: true };
}

export async function updateBadge() {
  try {
    const tabs = await queryChatGptTabs();
    if (tabs.length === 0) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }

    const discarded = tabs.filter(tab => tab.discarded).length;
    await chrome.action.setBadgeText({ text: String(tabs.length) });
    await chrome.action.setBadgeBackgroundColor({
      color: discarded > 0 ? '#10b981' : '#3b82f6'
    });
  } catch (err) {
    console.warn('[TabFlow] Could not update badge:', err?.message || err);
  }
}

async function checkIdleAndHibernate() {
  const settings = await getStoredSettings();
  if (!settings.autoDiscardEnabled) return;

  const idleThresholdMs = (settings.discardIdleMinutes || 5) * 60 * 1000;
  const now = Date.now();
  const tabs = await queryChatGptTabs({ excludeActive: true });
  let discardedCount = 0;

  for (const tab of tabs) {
    if (tab.discarded || !tab.id) continue;
    const lastAccessed = tab.lastAccessed || (now - idleThresholdMs - 1);
    if (now - lastAccessed < idleThresholdMs) continue;
    try {
      if (!(await canDiscardRuntimeTab(tab.id))) continue;
      await chrome.tabs.discard(tab.id);
      discardedCount++;
    } catch (error) {
      console.warn(`[TabFlow] Auto-discard failed for ${tab.id}:`, error?.message || error);
    }
  }

  if (discardedCount > 0) {
    await recordDiscardStats(discardedCount);
    await updateBadge();
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(async () => {
    const stored = await chrome.storage.local.get(['settings', 'stats']);
    if (!stored.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });

    const cleanStats = sanitizeStats(stored.stats || DEFAULT_STATS);
    if (!stored.stats || 'estimatedMbSaved' in stored.stats) {
      await chrome.storage.local.set({ stats: cleanStats });
    }

    await chrome.alarms.create('tabflow-auto-check', { periodInMinutes: 1 });
    await updateBadge();
  });

  chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name === 'tabflow-auto-check') await checkIdleAndHibernate();
  });

  chrome.tabs.onCreated.addListener(async tab => {
    if (isChatGptUrl(tab.url || tab.pendingUrl)) await updateBadge();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if ((changeInfo.status === 'complete' || changeInfo.url) && isChatGptUrl(tab.url)) {
      await updateBadge();
    }
  });

  chrome.tabs.onRemoved.addListener(async () => updateBadge());
  chrome.tabs.onActivated.addListener(async () => updateBadge());

  chrome.commands.onCommand.addListener(async command => {
    try {
      if (command === 'open-side-panel') {
        const currentWindow = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: currentWindow.id });
      } else if (command === 'freeze-background-tabs') {
        await discardAllBackgroundTabs();
      }
    } catch (error) {
      console.error('[TabFlow] Command error:', error);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'GET_TABS_DATA': {
            const tabs = await queryChatGptTabs();
            const stats = await getStoredStats();
            const settings = await getStoredSettings();
            sendResponse({
              success: true,
              tabs: tabs.map(tab => ({
                id: tab.id,
                title: tab.title || 'ChatGPT Conversation',
                url: tab.url,
                active: tab.active,
                discarded: Boolean(tab.discarded),
                lastAccessed: tab.lastAccessed || 0,
                favIconUrl: tab.favIconUrl
              })),
              stats,
              settings
            });
            break;
          }

          case 'DISCARD_ALL_BACKGROUND': {
            const result = await discardAllBackgroundTabs();
            sendResponse({ success: true, ...result });
            break;
          }

          case 'DISCARD_TAB': {
            const success = await discardSingleTab(message.tabId);
            sendResponse({ success });
            break;
          }

          case 'ACTIVATE_TAB': {
            if (!message.tabId) {
              sendResponse({ success: false, error: 'Missing tabId' });
              break;
            }
            const tab = await chrome.tabs.update(message.tabId, { active: true });
            if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
            sendResponse({ success: true });
            break;
          }

          case 'CLOSE_TAB': {
            if (!message.tabId) {
              sendResponse({ success: false, error: 'Missing tabId' });
              break;
            }
            await chrome.tabs.remove(message.tabId);
            await updateBadge();
            sendResponse({ success: true });
            break;
          }

          case 'GROUP_TABS': {
            await groupChatGptTabs();
            sendResponse({ success: true });
            break;
          }

          case 'STASH_SESSION': {
            sendResponse(await stashCurrentSession(message.sessionName));
            break;
          }

          case 'GET_STASHED_SESSIONS': {
            const stored = await chrome.storage.local.get('stashedSessions');
            sendResponse({
              success: true,
              sessions: Array.isArray(stored.stashedSessions) ? stored.stashedSessions : []
            });
            break;
          }

          case 'RESTORE_SESSION': {
            sendResponse(await restoreSession(message.sessionId));
            break;
          }

          case 'DELETE_STASHED_SESSION': {
            sendResponse(await deleteStashedSession(message.sessionId));
            break;
          }

          case 'GET_SETTINGS': {
            sendResponse({ success: true, settings: await getStoredSettings() });
            break;
          }

          case 'SAVE_SETTINGS': {
            const current = await getStoredSettings();
            const updated = { ...current, ...message.settings };
            await chrome.storage.local.set({ settings: updated });
            sendResponse({ success: true, settings: updated });
            break;
          }

          case 'OPEN_SIDE_PANEL': {
            const currentWindow = await chrome.windows.getCurrent();
            await chrome.sidePanel.open({ windowId: currentWindow.id });
            sendResponse({ success: true });
            break;
          }

          case 'OPEN_WORKSPACE': {
            await chrome.tabs.create({ url: chrome.runtime.getURL('workspace/index.html') });
            sendResponse({ success: true });
            break;
          }

          default:
            sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (error) {
        console.error('[TabFlow] Message handling error:', error);
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    })();

    return true;
  });
}
