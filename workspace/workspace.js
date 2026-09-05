import { computeGrid, densityWarning } from './layout.js';

const WORKSPACE_STATE_KEY = 'workspaceUnifiedStateV2';
const REMOTE_PORT_NAME = 'TABFLOW_WORKSPACE_REMOTE';
const DEFAULT_CHAT_URL = 'https://chatgpt.com/';
const COMMAND_TIMEOUT_MS = 12000;
const CONNECT_RETRY_MS = 650;
const CONNECT_TIMEOUT_MS = 12000;

const chatGrid = document.getElementById('chat-grid');
const paneTemplate = document.getElementById('pane-template');
const emptyState = document.getElementById('empty-state');
const btnSyncTabs = document.getElementById('btn-sync-tabs');
const btnNewChat = document.getElementById('btn-new-chat');
const btnEmptyNewChat = document.getElementById('btn-empty-new-chat');
const btnSleepIdle = document.getElementById('btn-sleep-idle');
const densitySelect = document.getElementById('density-select');
const workspaceSummary = document.getElementById('workspace-summary');
const statPanes = document.getElementById('stat-panes');
const statConnected = document.getElementById('stat-connected');
const statGenerating = document.getElementById('stat-generating');
const statSleeping = document.getElementById('stat-sleeping');
const densityWarningEl = document.getElementById('density-warning');
const toastEl = document.getElementById('workspace-toast');

let panes = [];
let sourceTabs = new Map();
let focusedPaneId = null;
let density = 'auto';
let paneSequence = 0;
let requestSequence = 0;
let saveTimer = null;
let toastTimer = null;
let resizeTimer = null;

const paneElementById = new Map();
const remoteByTabId = new Map();
const snapshotByTabId = new Map();

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
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({
      [WORKSPACE_STATE_KEY]: {
        density,
        panes: panes.map(({ id, sourceTabId, title, url, createdAt }) => ({
          id,
          sourceTabId,
          title,
          url,
          createdAt
        }))
      }
    }).catch(() => {});
  }, 220);
}

async function loadSavedState() {
  const stored = await chrome.storage.local.get(WORKSPACE_STATE_KEY);
  const state = stored[WORKSPACE_STATE_KEY];
  if (!state || typeof state !== 'object') return;
  if (typeof state.density === 'string') density = state.density;
  if (Array.isArray(state.panes)) {
    panes = state.panes
      .filter(item => item && Number.isInteger(item.sourceTabId))
      .map(item => ({
        id: String(item.id || makePaneId('restored')).slice(0, 200),
        sourceTabId: item.sourceTabId,
        title: cleanTitle(item.title),
        url: String(item.url || DEFAULT_CHAT_URL).slice(0, 4000),
        createdAt: Number(item.createdAt || Date.now())
      }));
  }
  if ([...densitySelect.options].some(option => option.value === density)) densitySelect.value = density;
}

async function getOpenChatTabs() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' });
  if (!result?.success) throw new Error(result?.error || 'Không đọc được danh sách ChatGPT tab');
  return Array.isArray(result.tabs) ? result.tabs : [];
}

function mergeOpenTabs(tabs) {
  sourceTabs = new Map(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => [tab.id, tab]));
  const existingIds = new Set(panes.map(pane => pane.sourceTabId));
  let added = 0;

  for (const tab of tabs) {
    if (!Number.isInteger(tab.id) || existingIds.has(tab.id)) continue;
    panes.push({
      id: makePaneId('tab'),
      sourceTabId: tab.id,
      title: cleanTitle(tab.title, `Chat ${panes.length + 1}`),
      url: String(tab.url || DEFAULT_CHAT_URL).slice(0, 4000),
      createdAt: Date.now()
    });
    existingIds.add(tab.id);
    added += 1;
  }

  for (const pane of panes) {
    const tab = sourceTabs.get(pane.sourceTabId);
    if (!tab) continue;
    if (tab.title) pane.title = cleanTitle(tab.title, pane.title);
    if (tab.url) pane.url = String(tab.url).slice(0, 4000);
  }

  return added;
}

function stateForPane(pane) {
  const tab = sourceTabs.get(pane.sourceTabId);
  const remote = remoteByTabId.get(pane.sourceTabId);
  const snapshot = snapshotByTabId.get(pane.sourceTabId);

  if (snapshot?.limitReached) return { key: 'limit', label: 'LIMIT' };
  if (snapshot?.generating) return { key: 'generating', label: 'GENERATING' };
  if (tab?.discarded) return { key: 'sleeping', label: 'SLEEPING' };
  if (remote?.connected) return { key: 'live', label: 'LIVE' };
  if (!tab) return { key: 'error', label: 'CLOSED' };
  return { key: 'error', label: 'UNTRACKED' };
}

function paneMetaText(pane) {
  const tab = sourceTabs.get(pane.sourceTabId);
  const snapshot = snapshotByTabId.get(pane.sourceTabId);
  if (!tab) return 'tab gốc đã đóng · mirror giữ snapshot cuối';
  if (tab.discarded) return 'tab gốc đang ngủ · bấm Đánh thức để làm tiếp';
  if (snapshot?.runtimeMode) return `tab gốc live · ${snapshot.runtimeMode}`;
  return remoteByTabId.get(pane.sourceTabId)?.connected ? 'tab gốc live · remote connected' : 'tab gốc live · chưa có remote agent';
}

function setConnectionError(tabId, message) {
  const remote = remoteByTabId.get(tabId);
  if (remote) remote.lastError = message;
  const pane = panes.find(item => item.sourceTabId === tabId);
  if (pane) updatePaneElement(pane, panes.indexOf(pane));
  updateStats();
}

function cleanupRemote(tabId) {
  const remote = remoteByTabId.get(tabId);
  if (!remote) return;
  for (const pending of remote.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Remote ChatGPT connection disconnected'));
  }
  remote.pending.clear();
  remote.connected = false;
  try { remote.port?.disconnect(); } catch {}
  remote.port = null;
}

function handleRemoteMessage(tabId, message) {
  const remote = remoteByTabId.get(tabId);
  if (!remote) return;

  if (message?.type === 'TABFLOW_WORKSPACE_REMOTE_SNAPSHOT') {
    snapshotByTabId.set(tabId, message.snapshot || null);
    const pane = panes.find(item => item.sourceTabId === tabId);
    if (pane && message.snapshot) {
      if (message.snapshot.title) pane.title = cleanTitle(message.snapshot.title, pane.title);
      if (message.snapshot.url) pane.url = String(message.snapshot.url).slice(0, 4000);
      updatePaneElement(pane, panes.indexOf(pane));
      scheduleSave();
    }
    updateStats();
    return;
  }

  if (message?.type === 'TABFLOW_WORKSPACE_REMOTE_HEARTBEAT') {
    const current = snapshotByTabId.get(tabId) || { messages: [] };
    snapshotByTabId.set(tabId, { ...current, ...(message.meta || {}) });
    const pane = panes.find(item => item.sourceTabId === tabId);
    if (pane) updatePaneElement(pane, panes.indexOf(pane));
    updateStats();
    return;
  }

  if (message?.type === 'TABFLOW_WORKSPACE_REMOTE_ACK') {
    const pending = remote.pending.get(message.requestId);
    if (!pending) return;
    remote.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result || {});
    else {
      const error = new Error(message.error?.message || 'Remote command failed');
      error.name = message.error?.name || 'RemoteCommandError';
      error.code = message.error?.code || '';
      pending.reject(error);
    }
  }
}

function connectRemote(tabId) {
  const tab = sourceTabs.get(tabId);
  if (!tab || tab.discarded) return null;
  const existing = remoteByTabId.get(tabId);
  if (existing?.connected && existing.port) return existing;

  if (existing) cleanupRemote(tabId);
  const remote = {
    port: null,
    connected: false,
    lastError: '',
    pending: new Map()
  };
  remoteByTabId.set(tabId, remote);

  try {
    const port = chrome.tabs.connect(tabId, { name: REMOTE_PORT_NAME });
    remote.port = port;
    remote.connected = true;
    port.onMessage.addListener(message => handleRemoteMessage(tabId, message));
    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message || '';
      if (remoteByTabId.get(tabId) !== remote) return;
      cleanupRemote(tabId);
      remote.lastError = lastError || 'Tab disconnected';
      const pane = panes.find(item => item.sourceTabId === tabId);
      if (pane) updatePaneElement(pane, panes.indexOf(pane));
      updateStats();
    });
    sendRemoteCommand(tabId, 'GET_STATE', {}, 5000).catch(error => {
      remote.lastError = error.message;
    });
    return remote;
  } catch (error) {
    remote.connected = false;
    remote.lastError = error?.message || String(error);
    return remote;
  }
}

function sendRemoteCommand(tabId, type, payload = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
  const remote = remoteByTabId.get(tabId);
  if (!remote?.connected || !remote.port) return Promise.reject(new Error('Remote agent chưa kết nối'));
  requestSequence += 1;
  const requestId = `workspace-${Date.now()}-${requestSequence}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      remote.pending.delete(requestId);
      reject(new Error(`Remote command timeout: ${type}`));
    }, timeoutMs);
    remote.pending.set(requestId, { resolve, reject, timer });
    try {
      remote.port.postMessage({ type, requestId, ...payload });
    } catch (error) {
      clearTimeout(timer);
      remote.pending.delete(requestId);
      reject(error);
    }
  });
}

async function ensureConnected(tabId, { wake = false } = {}) {
  const tab = sourceTabs.get(tabId);
  if (!tab) throw new Error('Tab gốc không còn tồn tại');
  if (remoteByTabId.get(tabId)?.connected) return;

  if (tab.discarded && wake) {
    await chrome.tabs.reload(tabId);
  } else if (tab.discarded) {
    throw new Error('Tab đang ngủ');
  }

  const started = Date.now();
  while (Date.now() - started < CONNECT_TIMEOUT_MS) {
    const current = remoteByTabId.get(tabId);
    if (current?.connected) return;
    connectRemote(tabId);
    await new Promise(resolve => setTimeout(resolve, CONNECT_RETRY_MS));
  }
  throw new Error('Không kết nối được remote agent; hãy reload tab ChatGPT gốc một lần sau khi reload extension.');
}

function renderTranscript(pane, paneEl) {
  const transcript = paneEl.querySelector('.pane-transcript');
  const placeholder = paneEl.querySelector('.pane-placeholder');
  const snapshot = snapshotByTabId.get(pane.sourceTabId);
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const fingerprint = messages.map(item => `${item.id}:${item.text.length}:${item.text.slice(-80)}`).join('|');
  if (transcript.dataset.fingerprint === fingerprint) return;
  transcript.dataset.fingerprint = fingerprint;
  transcript.replaceChildren();

  for (const message of messages) {
    const article = document.createElement('article');
    article.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
    const role = document.createElement('span');
    role.className = 'message-role';
    role.textContent = message.role === 'user' ? 'You' : 'ChatGPT';
    const text = document.createElement('pre');
    text.className = 'message-text';
    text.textContent = message.text || '';
    article.append(role, text);
    transcript.appendChild(article);
  }

  placeholder.hidden = messages.length > 0;
  if (messages.length > 0) transcript.scrollTo({ top: 1e9, behavior: 'instant' });
}

function updatePaneElement(pane, index) {
  const paneEl = paneElementById.get(pane.id);
  if (!paneEl) return;
  const tab = sourceTabs.get(pane.sourceTabId);
  const snapshot = snapshotByTabId.get(pane.sourceTabId);
  const state = stateForPane(pane);

  paneEl.querySelector('.pane-index').textContent = String(index + 1);
  paneEl.querySelector('.pane-title').textContent = pane.title;
  paneEl.querySelector('.pane-meta').textContent = paneMetaText(pane);
  const stateEl = paneEl.querySelector('.pane-state');
  stateEl.textContent = state.label;
  stateEl.className = `pane-state ${state.key}`;

  paneEl.classList.toggle('focus-hidden', Boolean(focusedPaneId && focusedPaneId !== pane.id));
  paneEl.classList.toggle('focused-pane', focusedPaneId === pane.id);
  paneEl.classList.toggle('is-generating', Boolean(snapshot?.generating));
  paneEl.classList.toggle('is-limited', Boolean(snapshot?.limitReached));
  const focusButton = paneEl.querySelector('.btn-focus');
  focusButton.textContent = focusedPaneId === pane.id ? '⤢' : '⛶';
  focusButton.title = focusedPaneId === pane.id ? 'Trở lại toàn bộ workspace' : 'Phóng to pane';

  const alert = paneEl.querySelector('.pane-alert');
  if (snapshot?.limitReached) {
    alert.hidden = false;
    alert.textContent = 'Conversation đã chạm giới hạn ChatGPT. TabFlow đã nhận diện trạng thái này; bước rollover sẽ tiếp tục trên chat kế nhiệm mà không làm mất Project Memory.';
  } else {
    alert.hidden = true;
    alert.textContent = '';
  }

  const input = paneEl.querySelector('.pane-input');
  const send = paneEl.querySelector('.btn-send');
  const stop = paneEl.querySelector('.btn-stop');
  const wake = paneEl.querySelector('.btn-wake');
  const connected = Boolean(remoteByTabId.get(pane.sourceTabId)?.connected);
  wake.hidden = Boolean(connected && !tab?.discarded);
  stop.hidden = !snapshot?.generating;
  send.disabled = Boolean(snapshot?.generating || snapshot?.limitReached || !tab);
  input.disabled = Boolean(snapshot?.limitReached || !tab);

  const placeholder = paneEl.querySelector('.pane-placeholder');
  if (!connected && !snapshot?.messages?.length) {
    placeholder.hidden = false;
    placeholder.textContent = tab?.discarded
      ? 'Tab gốc đang ngủ. Bấm “Đánh thức” để tiếp tục.'
      : 'Chưa kết nối remote agent. Nếu vừa reload extension, reload tab ChatGPT gốc một lần.';
  }

  renderTranscript(pane, paneEl);
}

function createPaneElement(pane) {
  const paneEl = paneTemplate.content.firstElementChild.cloneNode(true);
  paneEl.dataset.paneId = pane.id;
  const input = paneEl.querySelector('.pane-input');

  paneEl.querySelector('.btn-focus').addEventListener('click', () => {
    focusedPaneId = focusedPaneId === pane.id ? null : pane.id;
    reconcileWorkspace();
    if (focusedPaneId) input.focus();
  });

  paneEl.querySelector('.btn-source').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: pane.sourceTabId }).catch(() => {});
  });

  paneEl.querySelector('.btn-remove').addEventListener('click', () => {
    panes = panes.filter(item => item.id !== pane.id);
    if (focusedPaneId === pane.id) focusedPaneId = null;
    const remote = remoteByTabId.get(pane.sourceTabId);
    if (remote) cleanupRemote(pane.sourceTabId);
    reconcileWorkspace();
    scheduleSave();
  });

  paneEl.querySelector('.btn-wake').addEventListener('click', async () => {
    const button = paneEl.querySelector('.btn-wake');
    button.disabled = true;
    try {
      await ensureConnected(pane.sourceTabId, { wake: true });
      await syncOpenTabs();
      showToast(`Đã đánh thức ${pane.title}.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  paneEl.querySelector('.btn-stop').addEventListener('click', async () => {
    try {
      await ensureConnected(pane.sourceTabId);
      await sendRemoteCommand(pane.sourceTabId, 'COMMAND_STOP');
    } catch (error) {
      showToast(error.message);
    }
  });

  async function submit() {
    const text = input.value.trim();
    if (!text) return;
    const button = paneEl.querySelector('.btn-send');
    button.disabled = true;
    try {
      await ensureConnected(pane.sourceTabId, { wake: true });
      await sendRemoteCommand(pane.sourceTabId, 'COMMAND_SEND', { text });
      input.value = '';
      showToast(`Đã gửi prompt tới ${pane.title}.`);
    } catch (error) {
      if (error.code === 'CONVERSATION_LIMIT') {
        showToast('Chat này đã chạm giới hạn. Không gửi tiếp để tránh mất continuity.');
      } else {
        showToast(`Không gửi được: ${error.message}`);
      }
    } finally {
      button.disabled = false;
    }
  }

  paneEl.querySelector('.btn-send').addEventListener('click', submit);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  paneElementById.set(pane.id, paneEl);
  return paneEl;
}

function applyGrid() {
  if (focusedPaneId) {
    chatGrid.style.setProperty('--workspace-columns', '1');
    chatGrid.style.setProperty('--workspace-rows', '1');
    densityWarningEl.textContent = 'Focus mode · nhấn ⤢ hoặc Esc để quay lại tất cả chat.';
    return;
  }
  const grid = computeGrid(panes.length, window.innerWidth, Math.max(280, window.innerHeight - 92), density);
  chatGrid.style.setProperty('--workspace-columns', String(grid.columns));
  chatGrid.style.setProperty('--workspace-rows', String(grid.rows));
  densityWarningEl.textContent = densityWarning(grid);
}

function updateStats() {
  let connected = 0;
  let generating = 0;
  let sleeping = 0;
  for (const pane of panes) {
    if (remoteByTabId.get(pane.sourceTabId)?.connected) connected += 1;
    if (snapshotByTabId.get(pane.sourceTabId)?.generating) generating += 1;
    if (sourceTabs.get(pane.sourceTabId)?.discarded) sleeping += 1;
  }
  statPanes.textContent = String(panes.length);
  statConnected.textContent = String(connected);
  statGenerating.textContent = String(generating);
  statSleeping.textContent = String(sleeping);
  workspaceSummary.textContent = panes.length === 0
    ? 'Chưa có cuộc chat nào trong workspace'
    : `${panes.length} chat trên một màn hình · ${connected} remote live · ${generating} generating · không dùng iframe ChatGPT`;
}

function reconcileWorkspace() {
  const validIds = new Set(panes.map(pane => pane.id));
  for (const [paneId, paneEl] of paneElementById.entries()) {
    if (validIds.has(paneId)) continue;
    paneElementById.delete(paneId);
    paneEl.remove();
  }

  panes.forEach((pane, index) => {
    let paneEl = paneElementById.get(pane.id);
    if (!paneEl) {
      paneEl = createPaneElement(pane);
      chatGrid.appendChild(paneEl);
    }
    if (!sourceTabs.get(pane.sourceTabId)?.discarded) connectRemote(pane.sourceTabId);
    updatePaneElement(pane, index);
  });

  emptyState.hidden = panes.length > 0;
  chatGrid.hidden = panes.length === 0;
  applyGrid();
  updateStats();
}

async function syncOpenTabs({ notify = false } = {}) {
  try {
    const tabs = await getOpenChatTabs();
    const added = mergeOpenTabs(tabs);
    reconcileWorkspace();
    scheduleSave();
    if (notify) showToast(added > 0 ? `Đã thêm ${added} chat mới.` : 'Workspace đã đồng bộ.');
  } catch (error) {
    if (notify) showToast(`Không đồng bộ được: ${error.message}`);
  }
}

async function createNewChat() {
  const tab = await chrome.tabs.create({ url: DEFAULT_CHAT_URL, active: false });
  if (Number.isInteger(tab.id)) {
    sourceTabs.set(tab.id, tab);
    panes.push({
      id: makePaneId('tab'),
      sourceTabId: tab.id,
      title: `Chat ${panes.length + 1}`,
      url: DEFAULT_CHAT_URL,
      createdAt: Date.now()
    });
    reconcileWorkspace();
    scheduleSave();
    showToast('Đã tạo ChatGPT tab nền mới; pane sẽ kết nối khi trang tải xong.');
  }
}

async function sleepIdleTabs() {
  btnSleepIdle.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'DISCARD_ALL_BACKGROUND' });
    await syncOpenTabs();
    showToast(`Đã ngủ ${result?.discardedCount || 0} tab idle${result?.protectedCount ? ` · ${result.protectedCount} tab productive được bảo vệ` : ''}.`);
  } finally {
    btnSleepIdle.disabled = false;
  }
}

function scheduleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyGrid, 120);
}

btnSyncTabs.addEventListener('click', () => syncOpenTabs({ notify: true }));
btnNewChat.addEventListener('click', createNewChat);
btnEmptyNewChat.addEventListener('click', createNewChat);
btnSleepIdle.addEventListener('click', sleepIdleTabs);
densitySelect.addEventListener('change', () => {
  density = densitySelect.value;
  applyGrid();
  scheduleSave();
});
window.addEventListener('resize', scheduleResize, { passive: true });
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !focusedPaneId) return;
  focusedPaneId = null;
  reconcileWorkspace();
});

chrome.tabs.onCreated.addListener(() => setTimeout(() => syncOpenTabs().catch(() => {}), 350));
chrome.tabs.onRemoved.addListener(tabId => {
  cleanupRemote(tabId);
  sourceTabs.delete(tabId);
  const pane = panes.find(item => item.sourceTabId === tabId);
  if (pane) updatePaneElement(pane, panes.indexOf(pane));
  updateStats();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    setTimeout(() => syncOpenTabs().then(() => connectRemote(tabId)).catch(() => {}), 250);
  }
});

window.addEventListener('beforeunload', () => {
  for (const tabId of remoteByTabId.keys()) cleanupRemote(tabId);
});

(async function init() {
  await loadSavedState();
  await syncOpenTabs();
  reconcileWorkspace();
})();
