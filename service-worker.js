/**
 * ChatGPT TabFlow - Background Service Worker (Manifest V3)
 * Manages tab lifecycle, native memory hibernation, tab grouping, and auto-alarms.
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
  estimatedMbSaved: 0,
  lastDiscardTimestamp: 0
};

// Estimated RAM footprint of a live ChatGPT React SPA tab (~450MB) vs discarded (~35MB)
const ESTIMATED_SAVINGS_PER_TAB_MB = 415;

/**
 * Checks if a given URL belongs to ChatGPT
 */
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

/**
 * Retrieve current extension settings from chrome.storage.local
 */
async function getStoredSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

/**
 * Retrieve current statistics from chrome.storage.local
 */
async function getStoredStats() {
  const result = await chrome.storage.local.get('stats');
  return { ...DEFAULT_STATS, ...(result.stats || {}) };
}

/**
 * Update stored statistics
 */
async function recordDiscardStats(count) {
  if (count <= 0) return;
  const currentStats = await getStoredStats();
  const updatedStats = {
    totalDiscardCount: currentStats.totalDiscardCount + count,
    estimatedMbSaved: currentStats.estimatedMbSaved + (count * ESTIMATED_SAVINGS_PER_TAB_MB),
    lastDiscardTimestamp: Date.now()
  };
  await chrome.storage.local.set({ stats: updatedStats });
}

/**
 * Query all open ChatGPT tabs across all windows
 */
export async function queryChatGptTabs(options = {}) {
  const { excludeActive = false } = options;
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => {
    if (!isChatGptUrl(tab.url)) return false;
    if (excludeActive && tab.active) return false;
    return true;
  });
}

/**
 * Discard (hibernate) a specific tab to free its memory
 */
export async function discardSingleTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.discarded) return false;
    await chrome.tabs.discard(tabId);
    await recordDiscardStats(1);
    await updateBadge();
    return true;
  } catch (err) {
    console.warn(`[TabFlow] Could not discard tab ${tabId}:`, err?.message || err);
    return false;
  }
}

/**
 * Discard all background/inactive ChatGPT tabs across all windows
 */
export async function discardAllBackgroundTabs() {
  const tabs = await queryChatGptTabs({ excludeActive: true });
  let discardedCount = 0;

  for (const tab of tabs) {
    if (!tab.discarded && tab.id) {
      try {
        await chrome.tabs.discard(tab.id);
        discardedCount++;
      } catch (err) {
        console.warn(`[TabFlow] Discard failed for tab ${tab.id}:`, err?.message || err);
      }
    }
  }

  if (discardedCount > 0) {
    await recordDiscardStats(discardedCount);
    await updateBadge();
  }

  return {
    discardedCount,
    freedMb: discardedCount * ESTIMATED_SAVINGS_PER_TAB_MB
  };
}

/**
 * Automatically group ChatGPT tabs in Chrome
 */
export async function groupChatGptTabs() {
  const settings = await getStoredSettings();
  if (!settings.groupTabsEnabled) return;

  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    const chatGptTabIds = (win.tabs || [])
      .filter(t => isChatGptUrl(t.url))
      .map(t => t.id)
      .filter(Boolean);

    if (chatGptTabIds.length > 0) {
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
}

/**
 * Stash all open ChatGPT tabs into saved sessions and close them to free 100% RAM
 */
export async function stashCurrentSession(sessionName) {
  const tabs = await queryChatGptTabs();
  if (tabs.length === 0) return { success: false, message: 'Không có tab ChatGPT nào đang mở' };

  const tabList = tabs.map(t => ({
    url: t.url,
    title: t.title || 'ChatGPT Conversation',
    pinned: t.pinned || false
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

  // Close the open tabs
  const tabIds = tabs.map(t => t.id).filter(Boolean);
  await chrome.tabs.remove(tabIds);

  await updateBadge();
  return { success: true, session };
}

/**
 * Restore a stashed session by reopening all stored URLs
 */
export async function restoreSession(sessionId) {
  const stored = await chrome.storage.local.get('stashedSessions');
  const list = Array.isArray(stored.stashedSessions) ? stored.stashedSessions : [];
  const target = list.find(s => s.id === sessionId);
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

  // Auto group the restored tabs
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
    } catch (e) {
      console.warn('[TabFlow] Could not group restored tabs:', e?.message || e);
    }
  }

  await updateBadge();
  return { success: true, count: createdTabIds.length };
}

/**
 * Delete a stashed session
 */
export async function deleteStashedSession(sessionId) {
  const stored = await chrome.storage.local.get('stashedSessions');
  const list = Array.isArray(stored.stashedSessions) ? stored.stashedSessions : [];
  const updated = list.filter(s => s.id !== sessionId);
  await chrome.storage.local.set({ stashedSessions: updated });
  return { success: true };
}

/**
 * Update the extension action badge with current tab statistics
 */
export async function updateBadge() {
  try {
    const tabs = await queryChatGptTabs();
    const count = tabs.length;

    if (count === 0) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }

    const discarded = tabs.filter(t => t.discarded).length;
    // If some are discarded, show active/total or total count
    const badgeText = String(count);
    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({
      color: discarded > 0 ? '#10b981' : '#3b82f6' // Emerald when RAM saved, blue when running
    });
  } catch (err) {
    console.warn('[TabFlow] Could not update badge:', err?.message || err);
  }
}

/**
 * Check idle times and auto-hibernate tabs exceeding the threshold
 */
async function checkIdleAndHibernate() {
  const settings = await getStoredSettings();
  if (!settings.autoDiscardEnabled) return;

  const idleThresholdMs = (settings.discardIdleMinutes || 5) * 60 * 1000;
  const now = Date.now();
  const tabs = await queryChatGptTabs({ excludeActive: true });

  let discardedCount = 0;
  for (const tab of tabs) {
    if (!tab.discarded && tab.id) {
      // tab.lastAccessed is available in Chrome
      const lastAccessed = tab.lastAccessed || (now - idleThresholdMs - 1);
      if (now - lastAccessed >= idleThresholdMs) {
        try {
          await chrome.tabs.discard(tab.id);
          discardedCount++;
        } catch (e) {
          console.warn(`[TabFlow] Auto-discard failed for ${tab.id}:`, e?.message || e);
        }
      }
    }
  }

  if (discardedCount > 0) {
    await recordDiscardStats(discardedCount);
    await updateBadge();
  }
}

// ================= LIFECYCLE & EVENT LISTENERS =================
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Initialize settings and alarms on installation
  chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['settings', 'stats']);
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  if (!stored.stats) {
    await chrome.storage.local.set({ stats: DEFAULT_STATS });
  }

  // Create recurring alarm for auto-discard check (runs every 1 minute)
  await chrome.alarms.create('tabflow-auto-check', {
    periodInMinutes: 1
  });

  await updateBadge();
});

// Alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tabflow-auto-check') {
    await checkIdleAndHibernate();
  }
});

// Tab event listeners to update badge and organize
chrome.tabs.onCreated.addListener(async (tab) => {
  if (isChatGptUrl(tab.url || tab.pendingUrl)) {
    await updateBadge();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    if (isChatGptUrl(tab.url)) {
      await updateBadge();
    }
  }
});

chrome.tabs.onRemoved.addListener(async () => {
  await updateBadge();
});

chrome.tabs.onActivated.addListener(async () => {
  await updateBadge();
});

// Global Keyboard Commands
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'open-side-panel') {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
    } else if (command === 'freeze-background-tabs') {
      await discardAllBackgroundTabs();
    }
  } catch (err) {
    console.error('[TabFlow] Command error:', err);
  }
});

// Messaging API for popup, sidepanel, and content-scripts
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
            tabs: tabs.map(t => ({
              id: t.id,
              title: t.title || 'ChatGPT Conversation',
              url: t.url,
              active: t.active,
              discarded: Boolean(t.discarded),
              lastAccessed: t.lastAccessed || 0,
              favIconUrl: t.favIconUrl
            })),
            stats,
            settings
          });
          break;
        }

        case 'DISCARD_ALL_BACKGROUND': {
          const res = await discardAllBackgroundTabs();
          sendResponse({ success: true, ...res });
          break;
        }

        case 'DISCARD_TAB': {
          const success = await discardSingleTab(message.tabId);
          sendResponse({ success });
          break;
        }

        case 'ACTIVATE_TAB': {
          if (message.tabId) {
            const tab = await chrome.tabs.update(message.tabId, { active: true });
            if (tab.windowId) {
              await chrome.windows.update(tab.windowId, { focused: true });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Missing tabId' });
          }
          break;
        }

        case 'CLOSE_TAB': {
          if (message.tabId) {
            await chrome.tabs.remove(message.tabId);
            await updateBadge();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Missing tabId' });
          }
          break;
        }

        case 'GROUP_TABS': {
          await groupChatGptTabs();
          sendResponse({ success: true });
          break;
        }

        case 'STASH_SESSION': {
          const res = await stashCurrentSession(message.sessionName);
          sendResponse(res);
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
          const res = await restoreSession(message.sessionId);
          sendResponse(res);
          break;
        }

        case 'DELETE_STASHED_SESSION': {
          const res = await deleteStashedSession(message.sessionId);
          sendResponse(res);
          break;
        }

        case 'GET_SETTINGS': {
          const settings = await getStoredSettings();
          sendResponse({ success: true, settings });
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
          const workspaceUrl = chrome.runtime.getURL('workspace/index.html');
          await chrome.tabs.create({ url: workspaceUrl });
          sendResponse({ success: true });
          break;
        }

        case 'TILE_WINDOWS': {
          const allWin = await chrome.windows.getAll();
          const baseWin = allWin[0] || {};
          const screenW = 1920;
          const halfW = Math.floor(screenW / 2);
          const screenH = 1080;

          await chrome.windows.create({
            url: 'https://chatgpt.com/',
            left: 0,
            top: 0,
            width: halfW,
            height: screenH,
            type: 'normal'
          });

          await chrome.windows.create({
            url: 'https://chatgpt.com/',
            left: halfW,
            top: 0,
            width: halfW,
            height: screenH,
            type: 'normal'
          });

          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
          break;
      }
    } catch (err) {
      console.error('[TabFlow] Message handling error:', err);
      sendResponse({ success: false, error: err?.message || String(err) });
    }
  })();

    return true; // Keep message channel open for async response
  });
}
