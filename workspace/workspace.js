import { computeGrid, densityWarning } from './layout.js';

const WORKSPACE_STATE_KEY = 'workspaceUnifiedStateV1';
const CHATGPT_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
const DEFAULT_CHAT_URL = 'https://chatgpt.com/';
const SHELL_RESERVED_HEIGHT = 70;

const chatGrid = document.getElementById('chat-grid');
const paneTemplate = document.getElementById('pane-template');
const emptyState = document.getElementById('empty-state');
const btnSyncTabs = document.getElementById('btn-sync-tabs');
const btnNewChat = document.getElementById('btn-new-chat');
const btnEmptyNewChat = document.getElementById('btn-empty-new-chat');
const btnTakeover = document.getElementById('btn-takeover');
const btnFocusPrimary = document.getElementById('btn-focus-primary');
const densitySelect = document.getElementById('density-select');
const workspaceSummary = document.getElementById('workspace-summary');
const statPanes = document.getElementById('stat-panes');
const statSources = document.getElementById('stat-sources');
const statSleeping = document.getElementById('stat-sleeping');
const statReady = document.getElementById('stat-ready');
const statusPrimary = document.getElementById('status-primary');
const densityWarningEl = document.getElementById('density-warning');
const toastEl = document.getElementById('workspace-toast');

let panes = [];
let sourceTabs = new Map();
let primaryPaneId = null;
let focusedPaneId = null;
let density = 'auto';
let paneSequence = 0;
let saveTimer = null;
let toastTimer = null;
let syncTimer = null;
let resizeTimer = null;
const paneElementById = new Map();
const frameByPaneId = new Map();
const paneIdByWindow = new Map();
const readyPanes = new Set();

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return CHATGPT_ORIGINS.has(parsed.origin) ? parsed.href : DEFAULT_CHAT_URL;
  } catch {
    return DEFAULT_CHAT_URL;
  }
}

function makePaneId(prefix = 'pane') {
  paneSequence += 1;
  return `${prefix}-${Date.now()}-${paneSequence}`;
}

function cleanTitle(title, fallback = 'ChatGPT') {
  const value = String(title || '').replace(/\s+-\s+ChatGPT$/i, '').trim();
  return (value || fallback).slice(0, 240);
}

function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function ensurePrimaryPane() {
  if (panes.length === 0) {
    primaryPaneId = null;
    focusedPaneId = null;
    return;
  }
  if (!panes.some(pane => pane.id === primaryPaneId)) primaryPaneId = panes[0].id;
  if (focusedPaneId && !panes.some(pane => pane.id === focusedPaneId)) focusedPaneId = null;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({
      [WORKSPACE_STATE_KEY]: {
        density,
        primaryPaneId,
        panes: panes.map(({ id, sourceTabId, title, url, createdAt }) => ({
          id,
          sourceTabId: Number.isInteger(sourceTabId) ? sourceTabId : null,
          title,
          url,
          createdAt
        }))
      }
    });
  }, 220);
}

async function loadSavedState() {
  const stored = await chrome.storage.local.get(WORKSPACE_STATE_KEY);
  const state = stored[WORKSPACE_STATE_KEY];
  if (!state || typeof state !== 'object') return;

  if (typeof state.density === 'string') density = state.density;
  if (typeof state.primaryPaneId === 'string') primaryPaneId = state.primaryPaneId;

  if (Array.isArray(state.panes)) {
    panes = state.panes
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        id: String(item.id || makePaneId('restored')).slice(0, 200),
        sourceTabId: Number.isInteger(item.sourceTabId) ? item.sourceTabId : null,
        title: cleanTitle(item.title),
        url: safeUrl(item.url),
        createdAt: Number(item.createdAt || Date.now())
      }));
  }

  ensurePrimaryPane();
  if ([...densitySelect.options].some(option => option.value === density)) densitySelect.value = density;
}

async function getOpenChatTabs() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' });
  if (!result?.success) throw new Error(result?.error || 'Không đọc được danh sách ChatGPT tab');
  return Array.isArray(result.tabs) ? result.tabs : [];
}

function mergeOpenTabs(tabs) {
  sourceTabs = new Map(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => [tab.id, tab]));
  const existingSourceIds = new Set(panes.map(pane => pane.sourceTabId).filter(Number.isInteger));
  let added = 0;

  for (const tab of tabs) {
    if (!Number.isInteger(tab.id) || existingSourceIds.has(tab.id)) continue;
    panes.push({
      id: makePaneId('tab'),
      sourceTabId: tab.id,
      title: cleanTitle(tab.title, `Chat ${panes.length + 1}`),
      url: safeUrl(tab.url),
      createdAt: Date.now()
    });
    existingSourceIds.add(tab.id);
    added += 1;
  }

  for (const pane of panes) {
    if (!Number.isInteger(pane.sourceTabId)) continue;
    const tab = sourceTabs.get(pane.sourceTabId);
    if (!tab) continue;
    if (tab.title) pane.title = cleanTitle(tab.title, pane.title);
    if (tab.url && !readyPanes.has(pane.id)) pane.url = safeUrl(tab.url);
  }

  ensurePrimaryPane();
  return added;
}

async function syncOpenTabs({ notify = false } = {}) {
  try {
    const tabs = await getOpenChatTabs();
    const added = mergeOpenTabs(tabs);
    reconcileWorkspace();
    scheduleSave();
    if (notify) {
      showToast(added > 0 ? `Đã thêm ${added} tab mới vào workspace.` : 'Workspace đã đồng bộ với các tab đang mở.');
    }
  } catch (error) {
    console.warn('[TabFlow Workspace] Sync failed:', error);
    if (notify) showToast(`Không đồng bộ được tab: ${error.message}`);
  }
}

function addLocalPane() {
  const pane = {
    id: makePaneId('local'),
    sourceTabId: null,
    title: `Chat ${panes.length + 1}`,
    url: DEFAULT_CHAT_URL,
    createdAt: Date.now()
  };
  panes.push(pane);
  primaryPaneId = pane.id;
  reconcileWorkspace();
  scheduleSave();
}

function paneMetaText(pane) {
  if (!Number.isInteger(pane.sourceTabId)) return 'workspace-only';
  const source = sourceTabs.get(pane.sourceTabId);
  if (!source) return 'tab gốc đã đóng';
  if (source.discarded) return 'tab gốc đang ngủ';
  if (source.active) return 'tab gốc active';
  return 'tab gốc live';
}

function paneVisualState(pane) {
  const source = Number.isInteger(pane.sourceTabId) ? sourceTabs.get(pane.sourceTabId) : null;
  if (!readyPanes.has(pane.id)) return 'loading';
  if (source?.discarded) return 'sleeping';
  if (source?.active) return 'active';
  if (!source && Number.isInteger(pane.sourceTabId)) return 'orphan';
  return 'live';
}

function setPrimaryPane(paneId, { focus = false } = {}) {
  if (!panes.some(pane => pane.id === paneId)) return;
  primaryPaneId = paneId;
  if (focus) focusedPaneId = paneId;
  reconcileWorkspace();
  scheduleSave();
}

function focusPane(paneId) {
  if (!panes.some(pane => pane.id === paneId)) return;
  primaryPaneId = paneId;
  focusedPaneId = focusedPaneId === paneId ? null : paneId;
  reconcileWorkspace();
  scheduleSave();

  if (focusedPaneId) {
    requestAnimationFrame(() => {
      const frame = frameByPaneId.get(focusedPaneId);
      frame?.contentWindow?.postMessage({ type: 'TABFLOW_WORKSPACE_FOCUS_COMPOSER' }, '*');
    });
  }
}

function focusPrimaryPane() {
  ensurePrimaryPane();
  if (!primaryPaneId) return;
  focusPane(primaryPaneId);
}

function removePane(paneId) {
  panes = panes.filter(pane => pane.id !== paneId);
  readyPanes.delete(paneId);
  if (focusedPaneId === paneId) focusedPaneId = null;
  if (primaryPaneId === paneId) primaryPaneId = null;
  ensurePrimaryPane();
  reconcileWorkspace();
  scheduleSave();
}

function openSource(pane) {
  if (Number.isInteger(pane.sourceTabId) && sourceTabs.has(pane.sourceTabId)) {
    chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: pane.sourceTabId }).catch(() => {});
    return;
  }
  chrome.tabs.create({ url: pane.url });
}

function createPaneElement(pane) {
  const paneEl = paneTemplate.content.firstElementChild.cloneNode(true);
  const paneHeader = paneEl.querySelector('.pane-header');
  const loader = paneEl.querySelector('.pane-loading');
  const frame = paneEl.querySelector('iframe');
  const primaryButton = paneEl.querySelector('.btn-primary-pane');
  const focusButton = paneEl.querySelector('.btn-focus');
  const composerButton = paneEl.querySelector('.btn-composer');
  const reloadButton = paneEl.querySelector('.btn-reload');
  const sourceButton = paneEl.querySelector('.btn-source');
  const removeButton = paneEl.querySelector('.btn-remove');

  paneEl.dataset.paneId = pane.id;
  frame.src = pane.url;
  frame.dataset.currentUrl = pane.url;
  frame.loading = panes.length > 8 ? 'lazy' : 'eager';

  frame.addEventListener('load', () => {
    loader.classList.add('hidden');
    readyPanes.add(pane.id);
    if (frame.contentWindow) paneIdByWindow.set(frame.contentWindow, pane.id);
    updateStats();
    updatePaneElement(pane, panes.findIndex(item => item.id === pane.id));
  });

  paneHeader.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    setPrimaryPane(pane.id);
  });

  paneEl.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    focusPane(pane.id);
  });

  primaryButton.addEventListener('click', () => setPrimaryPane(pane.id));
  focusButton.addEventListener('click', () => focusPane(pane.id));

  composerButton.addEventListener('click', () => {
    frame.contentWindow?.postMessage({ type: 'TABFLOW_WORKSPACE_FOCUS_COMPOSER' }, '*');
  });

  reloadButton.addEventListener('click', () => {
    readyPanes.delete(pane.id);
    loader.classList.remove('hidden');
    frame.src = pane.url;
    frame.dataset.currentUrl = pane.url;
    updateStats();
    updatePaneElement(pane, panes.findIndex(item => item.id === pane.id));
  });

  sourceButton.addEventListener('click', () => openSource(pane));
  removeButton.addEventListener('click', () => removePane(pane.id));

  paneElementById.set(pane.id, paneEl);
  frameByPaneId.set(pane.id, frame);
  if (frame.contentWindow) paneIdByWindow.set(frame.contentWindow, pane.id);
  return paneEl;
}

function updatePaneElement(pane, index) {
  const paneEl = paneElementById.get(pane.id);
  if (!paneEl) return;
  const frame = frameByPaneId.get(pane.id);
  const indexEl = paneEl.querySelector('.pane-index');
  const titleEl = paneEl.querySelector('.pane-title');
  const metaEl = paneEl.querySelector('.pane-meta');
  const mainBadge = paneEl.querySelector('.pane-main-badge');
  const primaryButton = paneEl.querySelector('.btn-primary-pane');
  const focusButton = paneEl.querySelector('.btn-focus');

  const isPrimary = primaryPaneId === pane.id;
  const isFocused = focusedPaneId === pane.id;
  const state = paneVisualState(pane);

  indexEl.textContent = String(index + 1);
  titleEl.textContent = pane.title;
  metaEl.textContent = paneMetaText(pane);
  metaEl.title = paneMetaText(pane);
  mainBadge.hidden = !isPrimary;
  primaryButton.textContent = isPrimary ? '★' : '☆';
  primaryButton.title = isPrimary ? 'Pane chính hiện tại' : 'Đặt làm pane chính';

  paneEl.dataset.state = state;
  paneEl.classList.toggle('focus-hidden', Boolean(focusedPaneId && !isFocused));
  paneEl.classList.toggle('focused-pane', isFocused);
  paneEl.classList.toggle('pane-primary', isPrimary);

  focusButton.textContent = isFocused ? '⤢' : '⛶';
  focusButton.title = isFocused ? 'Trở lại toàn bộ workspace' : 'Phóng to pane';

  if (frame && !readyPanes.has(pane.id) && frame.dataset.currentUrl !== pane.url) {
    frame.src = pane.url;
    frame.dataset.currentUrl = pane.url;
  }
}

function applyPaneSlots(layoutMode) {
  ensurePrimaryPane();
  const ordered = panes.filter(pane => pane.id !== primaryPaneId);
  const secondarySlotById = new Map(ordered.map((pane, index) => [pane.id, index + 1]));

  for (const pane of panes) {
    const paneEl = paneElementById.get(pane.id);
    if (!paneEl) continue;
    paneEl.classList.remove('pane-secondary-1', 'pane-secondary-2');
    if (layoutMode === 'spotlight-3' && pane.id !== primaryPaneId) {
      const slot = secondarySlotById.get(pane.id);
      if (slot === 1 || slot === 2) paneEl.classList.add(`pane-secondary-${slot}`);
    }
  }
}

function applyGrid() {
  if (focusedPaneId) {
    chatGrid.dataset.layout = 'focus';
    chatGrid.style.setProperty('--workspace-columns', '1');
    chatGrid.style.setProperty('--workspace-rows', '1');
    applyPaneSlots('focus');
    densityWarningEl.textContent = 'Focus mode';
    btnFocusPrimary.classList.add('active');
    return;
  }

  const width = Math.max(320, window.innerWidth);
  const height = Math.max(240, window.innerHeight - SHELL_RESERVED_HEIGHT);
  const grid = computeGrid(panes.length, width, height, density);

  chatGrid.dataset.layout = grid.mode;
  chatGrid.style.setProperty('--workspace-columns', String(grid.columns));
  chatGrid.style.setProperty('--workspace-rows', String(grid.rows));
  applyPaneSlots(grid.mode);
  densityWarningEl.textContent = densityWarning(grid);
  btnFocusPrimary.classList.remove('active');
}

function updateStats() {
  ensurePrimaryPane();
  const sourceCount = panes.filter(pane => Number.isInteger(pane.sourceTabId)).length;
  let sleeping = 0;

  for (const pane of panes) {
    const source = Number.isInteger(pane.sourceTabId) ? sourceTabs.get(pane.sourceTabId) : null;
    if (source?.discarded) sleeping += 1;
  }

  const readyCount = [...readyPanes].filter(id => panes.some(pane => pane.id === id)).length;
  const primary = panes.find(pane => pane.id === primaryPaneId);

  statPanes.textContent = String(panes.length);
  statSources.textContent = String(sourceCount);
  statSleeping.textContent = String(sleeping);
  statReady.textContent = String(readyCount);
  statusPrimary.textContent = primary ? `Main: ${primary.title}` : 'Main: —';
  statusPrimary.title = primary?.title || '';

  workspaceSummary.textContent = panes.length === 0
    ? 'Chưa có cuộc chat nào'
    : `${panes.length} chat · ${readyCount} ready${sleeping ? ` · ${sleeping} sleeping` : ''}`;
}

function reconcileWorkspace() {
  ensurePrimaryPane();
  const validIds = new Set(panes.map(pane => pane.id));

  for (const [paneId, paneEl] of paneElementById.entries()) {
    if (validIds.has(paneId)) continue;
    const frame = frameByPaneId.get(paneId);
    if (frame?.contentWindow) paneIdByWindow.delete(frame.contentWindow);
    paneElementById.delete(paneId);
    frameByPaneId.delete(paneId);
    paneEl.remove();
  }

  panes.forEach((pane, index) => {
    let paneEl = paneElementById.get(pane.id);
    if (!paneEl) {
      paneEl = createPaneElement(pane);
      chatGrid.appendChild(paneEl);
    }
    updatePaneElement(pane, index);
  });

  emptyState.hidden = panes.length > 0;
  chatGrid.hidden = panes.length === 0;
  applyGrid();
  updateStats();
}

async function takeoverWorkspace() {
  const sourceIds = panes.map(pane => pane.sourceTabId).filter(Number.isInteger);
  if (sourceIds.length === 0) {
    showToast('Không có tab gốc nào để ngủ đông.');
    return;
  }

  const notReady = panes.filter(pane => Number.isInteger(pane.sourceTabId) && !readyPanes.has(pane.id));
  if (notReady.length > 0) {
    showToast(`Còn ${notReady.length} pane chưa tải xong; chưa ngủ đông tab gốc.`);
    return;
  }

  btnTakeover.disabled = true;
  let discarded = 0;
  let protectedCount = 0;
  try {
    for (const tabId of sourceIds) {
      const result = await chrome.runtime.sendMessage({ type: 'DISCARD_TAB', tabId });
      if (result?.success) discarded += 1;
      else protectedCount += 1;
    }
    await syncOpenTabs();
    showToast(`Take over: ${discarded} tab gốc đã ngủ${protectedCount ? ` · ${protectedCount} tab đang được bảo vệ` : ''}.`);
  } finally {
    btnTakeover.disabled = false;
  }
}

function scheduleTabSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncOpenTabs().catch(() => {}), 250);
}

window.addEventListener('message', event => {
  if (!CHATGPT_ORIGINS.has(event.origin) || event.data?.type !== 'TABFLOW_WORKSPACE_FRAME_STATE') return;
  const paneId = paneIdByWindow.get(event.source);
  if (!paneId) return;
  const pane = panes.find(item => item.id === paneId);
  if (!pane) return;

  const frame = frameByPaneId.get(paneId);
  const nextUrl = safeUrl(event.data.href);
  const nextTitle = cleanTitle(event.data.title, pane.title);
  let changed = false;

  if (nextUrl !== pane.url) {
    pane.url = nextUrl;
    if (frame) frame.dataset.currentUrl = nextUrl;
    changed = true;
  }
  if (nextTitle && nextTitle !== 'ChatGPT' && nextTitle !== pane.title) {
    pane.title = nextTitle;
    changed = true;
  }

  if (changed) scheduleSave();
  updatePaneElement(pane, panes.findIndex(item => item.id === pane.id));
  updateStats();
});

btnSyncTabs.addEventListener('click', () => syncOpenTabs({ notify: true }));
btnNewChat.addEventListener('click', addLocalPane);
btnEmptyNewChat.addEventListener('click', addLocalPane);
btnTakeover.addEventListener('click', takeoverWorkspace);
btnFocusPrimary.addEventListener('click', focusPrimaryPane);

densitySelect.addEventListener('change', () => {
  density = densitySelect.value;
  applyGrid();
  scheduleSave();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focusedPaneId) {
    focusedPaneId = null;
    reconcileWorkspace();
    return;
  }

  if (event.key.toLowerCase() !== 'f' || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (target instanceof HTMLElement && target.isContentEditable) return;
  event.preventDefault();
  focusPrimaryPane();
});

window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyGrid, 100);
}, { passive: true });

chrome.tabs.onCreated.addListener(scheduleTabSync);
chrome.tabs.onRemoved.addListener(scheduleTabSync);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title) scheduleTabSync();
});

(async function init() {
  try {
    await loadSavedState();
    reconcileWorkspace();
    await syncOpenTabs();
  } catch (error) {
    console.error('[TabFlow Workspace] Init failed:', error);
    reconcileWorkspace();
    showToast(`Workspace init lỗi: ${error.message}`);
  }
})();
