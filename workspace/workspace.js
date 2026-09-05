import { computeGrid, densityWarning } from './layout.js';

const WORKSPACE_STATE_KEY = 'workspaceUnifiedStateV1';
const CHATGPT_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
const DEFAULT_CHAT_URL = 'https://chatgpt.com/';

const chatGrid = document.getElementById('chat-grid');
const paneTemplate = document.getElementById('pane-template');
const emptyState = document.getElementById('empty-state');
const btnSyncTabs = document.getElementById('btn-sync-tabs');
const btnNewChat = document.getElementById('btn-new-chat');
const btnEmptyNewChat = document.getElementById('btn-empty-new-chat');
const btnTakeover = document.getElementById('btn-takeover');
const densitySelect = document.getElementById('density-select');
const workspaceSummary = document.getElementById('workspace-summary');
const statPanes = document.getElementById('stat-panes');
const statSources = document.getElementById('stat-sources');
const statSleeping = document.getElementById('stat-sleeping');
const statReady = document.getElementById('stat-ready');
const densityWarningEl = document.getElementById('density-warning');
const toastEl = document.getElementById('workspace-toast');

let panes = [];
let sourceTabs = new Map();
let focusedPaneId = null;
let density = 'auto';
let paneSequence = 0;
let saveTimer = null;
let toastTimer = null;
let syncTimer = null;
let resizeTimer = null;
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
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({
      [WORKSPACE_STATE_KEY]: {
        density,
        panes: panes.map(({ id, sourceTabId, title, url, createdAt }) => ({
          id,
          sourceTabId: Number.isInteger(sourceTabId) ? sourceTabId : null,
          title,
          url,
          createdAt
        }))
      }
    });
  }, 250);
}

async function loadSavedState() {
  const stored = await chrome.storage.local.get(WORKSPACE_STATE_KEY);
  const state = stored[WORKSPACE_STATE_KEY];
  if (!state || typeof state !== 'object') return;
  if (typeof state.density === 'string') density = state.density;
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
  if ([...densitySelect.options].some(option => option.value === density)) {
    densitySelect.value = density;
  }
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

  return added;
}

async function syncOpenTabs({ notify = false } = {}) {
  try {
    const tabs = await getOpenChatTabs();
    const added = mergeOpenTabs(tabs);
    renderWorkspace();
    scheduleSave();
    if (notify) showToast(added > 0 ? `Đã thêm ${added} tab mới vào workspace.` : 'Workspace đã đồng bộ với các tab đang mở.');
  } catch (error) {
    console.warn('[TabFlow Workspace] Sync failed:', error);
    if (notify) showToast(`Không đồng bộ được tab: ${error.message}`);
  }
}

function addLocalPane() {
  panes.push({
    id: makePaneId('local'),
    sourceTabId: null,
    title: `Chat ${panes.length + 1}`,
    url: DEFAULT_CHAT_URL,
    createdAt: Date.now()
  });
  renderWorkspace();
  scheduleSave();
}

function paneMetaText(pane) {
  if (!Number.isInteger(pane.sourceTabId)) return 'workspace-only';
  const source = sourceTabs.get(pane.sourceTabId);
  if (!source) return 'tab gốc đã đóng · pane vẫn hoạt động';
  if (source.discarded) return 'tab gốc đang ngủ · pane live';
  if (source.active) return 'tab gốc active';
  return 'tab gốc live';
}

function focusPane(paneId) {
  focusedPaneId = focusedPaneId === paneId ? null : paneId;
  renderWorkspace();
  if (focusedPaneId) {
    requestAnimationFrame(() => {
      const frame = frameByPaneId.get(focusedPaneId);
      frame?.contentWindow?.postMessage({ type: 'TABFLOW_WORKSPACE_FOCUS_COMPOSER' }, '*');
    });
  }
}

function removePane(paneId) {
  panes = panes.filter(pane => pane.id !== paneId);
  readyPanes.delete(paneId);
  if (focusedPaneId === paneId) focusedPaneId = null;
  renderWorkspace();
  scheduleSave();
}

function openSource(pane) {
  if (Number.isInteger(pane.sourceTabId) && sourceTabs.has(pane.sourceTabId)) {
    chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: pane.sourceTabId }).catch(() => {});
    return;
  }
  chrome.tabs.create({ url: pane.url });
}

function createPaneElement(pane, index) {
  const fragment = paneTemplate.content.cloneNode(true);
  const paneEl = fragment.querySelector('.chat-pane');
  const indexEl = fragment.querySelector('.pane-index');
  const titleEl = fragment.querySelector('.pane-title');
  const metaEl = fragment.querySelector('.pane-meta');
  const loader = fragment.querySelector('.pane-loading');
  const frame = fragment.querySelector('iframe');
  const focusButton = fragment.querySelector('.btn-focus');
  const composerButton = fragment.querySelector('.btn-composer');
  const reloadButton = fragment.querySelector('.btn-reload');
  const sourceButton = fragment.querySelector('.btn-source');
  const removeButton = fragment.querySelector('.btn-remove');

  paneEl.dataset.paneId = pane.id;
  if (focusedPaneId === pane.id) paneEl.classList.add('focused-pane');
  indexEl.textContent = String(index + 1);
  titleEl.textContent = pane.title;
  metaEl.textContent = paneMetaText(pane);
  frame.src = pane.url;
  frame.title = `${pane.title} — TabFlow pane ${index + 1}`;
  frame.loading = panes.length > 8 && focusedPaneId !== pane.id ? 'lazy' : 'eager';

  frame.addEventListener('load', () => {
    loader.classList.add('hidden');
    readyPanes.add(pane.id);
    updateStats();
  });

  focusButton.textContent = focusedPaneId === pane.id ? '⤢' : '⛶';
  focusButton.title = focusedPaneId === pane.id ? 'Trở lại toàn bộ workspace' : 'Phóng to pane';
  focusButton.addEventListener('click', () => focusPane(pane.id));
  paneEl.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    focusPane(pane.id);
  });

  composerButton.addEventListener('click', () => {
    frame.contentWindow?.postMessage({ type: 'TABFLOW_WORKSPACE_FOCUS_COMPOSER' }, '*');
  });

  reloadButton.addEventListener('click', () => {
    readyPanes.delete(pane.id);
    loader.classList.remove('hidden');
    frame.src = pane.url;
    updateStats();
  });

  sourceButton.addEventListener('click', () => openSource(pane));
  removeButton.addEventListener('click', () => removePane(pane.id));

  frameByPaneId.set(pane.id, frame);
  return fragment;
}

function applyGrid() {
  if (focusedPaneId) {
    chatGrid.style.setProperty('--workspace-columns', '1');
    chatGrid.style.setProperty('--workspace-rows', '1');
    densityWarningEl.textContent = 'Focus mode · nhấn ⤢ hoặc Esc để xem lại toàn bộ pane.';
    return;
  }

  const rect = chatGrid.getBoundingClientRect();
  const grid = computeGrid(panes.length, rect.width, rect.height, density);
  chatGrid.style.setProperty('--workspace-columns', String(grid.columns));
  chatGrid.style.setProperty('--workspace-rows', String(grid.rows));
  densityWarningEl.textContent = densityWarning(grid);
}

function updateStats() {
  const sourceCount = panes.filter(pane => Number.isInteger(pane.sourceTabId)).length;
  let sleeping = 0;
  for (const pane of panes) {
    const source = Number.isInteger(pane.sourceTabId) ? sourceTabs.get(pane.sourceTabId) : null;
    if (source?.discarded) sleeping += 1;
  }

  statPanes.textContent = String(panes.length);
  statSources.textContent = String(sourceCount);
  statSleeping.textContent = String(sleeping);
  statReady.textContent = String([...readyPanes].filter(id => panes.some(pane => pane.id === id)).length);
  workspaceSummary.textContent = panes.length === 0
    ? 'Chưa có cuộc chat nào trong workspace'
    : `${panes.length} cuộc chat trên một màn hình · ${sleeping} tab gốc đang ngủ`;
}

function renderWorkspace() {
  frameByPaneId.clear();
  paneIdByWindow.clear();
  chatGrid.replaceChildren();

  const visiblePanes = focusedPaneId
    ? panes.filter(pane => pane.id === focusedPaneId)
    : panes;

  visiblePanes.forEach((pane, index) => {
    const fragment = createPaneElement(pane, focusedPaneId ? panes.findIndex(item => item.id === pane.id) : index);
    chatGrid.appendChild(fragment);
  });

  for (const [paneId, frame] of frameByPaneId.entries()) {
    if (frame.contentWindow) paneIdByWindow.set(frame.contentWindow, paneId);
  }

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

  const nextUrl = safeUrl(event.data.href);
  const nextTitle = cleanTitle(event.data.title, pane.title);
  let changed = false;
  if (nextUrl !== pane.url) {
    pane.url = nextUrl;
    changed = true;
  }
  if (nextTitle && nextTitle !== 'ChatGPT' && nextTitle !== pane.title) {
    pane.title = nextTitle;
    changed = true;
  }
  if (changed) scheduleSave();

  const paneEl = chatGrid.querySelector(`[data-pane-id="${CSS.escape(paneId)}"]`);
  paneEl?.querySelector('.pane-title')?.replaceChildren(document.createTextNode(pane.title));
  const meta = paneEl?.querySelector('.pane-meta');
  if (meta) meta.textContent = paneMetaText(pane);
});

btnSyncTabs.addEventListener('click', () => syncOpenTabs({ notify: true }));
btnNewChat.addEventListener('click', addLocalPane);
btnEmptyNewChat.addEventListener('click', addLocalPane);
btnTakeover.addEventListener('click', takeoverWorkspace);
densitySelect.addEventListener('change', () => {
  density = densitySelect.value;
  applyGrid();
  scheduleSave();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focusedPaneId) {
    focusedPaneId = null;
    renderWorkspace();
  }
});

window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyGrid, 120);
}, { passive: true });

chrome.tabs.onCreated.addListener(scheduleTabSync);
chrome.tabs.onRemoved.addListener(scheduleTabSync);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title) scheduleTabSync();
});

(async function init() {
  try {
    await loadSavedState();
    await syncOpenTabs();
    renderWorkspace();
  } catch (error) {
    console.error('[TabFlow Workspace] Init failed:', error);
    renderWorkspace();
    showToast(`Workspace init lỗi: ${error.message}`);
  }
})();
