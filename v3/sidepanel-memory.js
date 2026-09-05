const PORT_NAME = 'TABFLOW_MEMORY_CLIENT';
const DEFAULT_PROJECTS = [
  { id: 'proj_openpronounce', name: 'OpenPronounce (AtoEnglish)', stack: 'React, Vite, Web Audio API, TypeScript', rules: 'Real audio playback, 0ms latency, Vitest unit tests, clean modular architecture.' },
  { id: 'proj_moneyflow', name: 'Atoryn MoneyFlow', stack: 'Next.js 15, TypeScript, Tailwind CSS, SQLite Marts', rules: 'Financial precision, no float rounding errors, strict OpenAPI contracts.' }
];

let port = null;
let seq = 0;
let projects = [];
let currentTab = null;
let currentBinding = null;
const pending = new Map();

const $ = id => document.getElementById(id);
const memoryNav = $('tab-nav-memory');
const memoryView = $('memory-view');
const health = $('memory-health');
const projectName = $('memory-project-name');
const bindingSub = $('memory-binding-sub');
const projectSelect = $('memory-project-select');
const bindBtn = $('memory-bind-btn');
const syncBtn = $('memory-sync-btn');
const refreshBtn = $('memory-refresh-btn');
const clearBtn = $('memory-clear-btn');
const queryInput = $('memory-query');
const queryBtn = $('memory-query-btn');

function setHealth(text, state = 'off') {
  health.textContent = text;
  health.className = `memory-health ${state}`;
}

function connect() {
  if (port) return port;
  const next = chrome.runtime.connect({ name: PORT_NAME });
  port = next;
  next.onMessage.addListener(message => {
    const entry = pending.get(message?.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else {
      const error = new Error(message?.error?.message || 'Memory RPC failed');
      if (message?.error?.code) error.code = message.error.code;
      entry.reject(error);
    }
  });
  next.onDisconnect.addListener(() => {
    if (port === next) port = null;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Memory background disconnected'));
    }
    pending.clear();
    setHealth('OFF', 'off');
  });
  return next;
}

function rpc(type, payload = {}, timeoutMs = 60000) {
  const activePort = connect();
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  const requestId = `panel-${Date.now()}-${seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Memory RPC timeout: ${type}`));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    activePort.postMessage({ requestId, type, payload });
  });
}

function isChatGptUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com' || host.endsWith('.chat.openai.com');
  } catch {
    return false;
  }
}

async function getActiveChatTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id && isChatGptUrl(tab.url) ? tab : null;
}

async function loadProjects() {
  const stored = await chrome.storage.local.get('projectVault');
  projects = Array.isArray(stored.projectVault) && stored.projectVault.length > 0 ? stored.projectVault : DEFAULT_PROJECTS;
  projectSelect.textContent = '';
  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  }
}

function selectedProject() {
  return projects.find(project => project.id === projectSelect.value) || projects[0] || null;
}

function clearChildren(node) {
  while (node.firstChild) node.firstChild.remove();
}

function renderChips(citations = []) {
  const host = $('memory-rag-citations');
  clearChildren(host);
  for (const citation of citations.slice(0, 10)) {
    const chip = document.createElement('span');
    chip.className = 'citation-chip';
    chip.textContent = citation.path || citation.statement || citation.kind || citation.type || 'memory';
    chip.title = chip.textContent;
    host.appendChild(chip);
  }
}

function renderFiles(files = []) {
  const host = $('memory-files-list');
  clearChildren(host);
  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'memory-muted';
    empty.textContent = 'Chưa index được file nào. Mở chat có code rồi bấm Sync.';
    host.appendChild(empty);
    return;
  }
  for (const file of files.slice(0, 120)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'memory-list-item';
    item.dataset.fileId = file.id;
    const title = document.createElement('div');
    title.className = 'memory-list-title';
    title.textContent = file.path;
    const meta = document.createElement('div');
    meta.className = 'memory-list-meta';
    meta.textContent = `${file.language || 'code'} · ${file.virtual ? 'virtual chat file' : 'named file'} · ${new Date(file.updatedAt || 0).toLocaleString('vi-VN')}`;
    item.append(title, meta);
    item.addEventListener('click', () => previewFile(file.id));
    host.appendChild(item);
  }
}

function renderDecisions(decisions = []) {
  const host = $('memory-decisions-list');
  clearChildren(host);
  if (decisions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'memory-muted';
    empty.textContent = 'Chưa phát hiện constraint/decision nào từ user.';
    host.appendChild(empty);
    return;
  }
  for (const decision of decisions.slice(0, 80)) {
    const item = document.createElement('div');
    item.className = 'memory-list-item memory-decision';
    const title = document.createElement('div');
    title.className = 'memory-list-title';
    title.textContent = decision.statement;
    const meta = document.createElement('div');
    meta.className = 'memory-list-meta';
    meta.textContent = `${decision.status} · authority: ${decision.authority}`;
    item.append(title, meta);
    host.appendChild(item);
  }
}

async function previewFile(fileId) {
  if (!currentBinding?.projectId) return;
  try {
    const file = await rpc('GET_FILE', { projectId: currentBinding.projectId, fileId });
    const preview = $('memory-file-preview');
    if (!file) {
      preview.hidden = true;
      return;
    }
    preview.textContent = `${file.path}\n\n${String(file.content || '').slice(0, 14000)}`;
    preview.hidden = false;
  } catch (error) {
    console.warn('[TabFlow Memory UI] File preview failed:', error);
  }
}

async function refreshClientStatus() {
  const state = $('memory-rag-state');
  renderChips([]);
  if (!currentTab?.id) {
    state.textContent = 'Không có tab ChatGPT active.';
    return;
  }
  try {
    const status = await chrome.tabs.sendMessage(currentTab.id, { type: 'TABFLOW_MEMORY_CLIENT_STATUS' });
    if (!status?.success || !status.prepared) {
      state.textContent = 'Chưa có RAG capsule. Gõ prompt trong ChatGPT để retrieval chạy tự động.';
      return;
    }
    state.textContent = `Ready: +~${status.prepared.estimatedTokens || 0} tokens · ${status.prepared.citationCount || 0} references · age ${Math.round((status.prepared.ageMs || 0) / 1000)}s`;
    renderChips(status.prepared.citations || []);
  } catch {
    state.textContent = 'Content script chưa sẵn sàng. Reload tab ChatGPT sau khi reload extension.';
  }
}

async function refreshMemory() {
  setHealth('BUSY', 'busy');
  currentTab = await getActiveChatTab();
  if (!currentTab) {
    currentBinding = null;
    projectName.textContent = 'Không có tab ChatGPT active';
    bindingSub.textContent = 'Mở một tab ChatGPT trong cửa sổ này để dùng Project Memory.';
    setHealth('OFF', 'off');
    return;
  }

  try {
    currentBinding = await rpc('GET_BINDING', { tabId: currentTab.id, tabUrl: currentTab.url });
  } catch {
    currentBinding = null;
  }

  if (!currentBinding?.projectId) {
    projectName.textContent = 'Chưa gắn project';
    bindingSub.textContent = `Tab: ${(currentTab.title || 'ChatGPT').replace(/ - ChatGPT$/, '')}`;
    setHealth('READY', 'off');
    $('memory-files').textContent = '0';
    $('memory-chunks').textContent = '0';
    $('memory-decisions').textContent = '0';
    $('memory-conversations').textContent = '0';
    renderFiles([]);
    renderDecisions([]);
    await refreshClientStatus();
    return;
  }

  projectName.textContent = currentBinding.project?.name || currentBinding.projectId;
  bindingSub.textContent = `Bound to active ChatGPT tab · ${currentBinding.source || 'memory'}`;
  projectSelect.value = currentBinding.projectId;

  try {
    const [stats, files, decisions] = await Promise.all([
      rpc('PROJECT_STATS', { projectId: currentBinding.projectId }),
      rpc('LIST_FILES', { projectId: currentBinding.projectId }),
      rpc('LIST_DECISIONS', { projectId: currentBinding.projectId })
    ]);
    $('memory-files').textContent = String(stats?.files || 0);
    $('memory-chunks').textContent = String(stats?.chunks || 0);
    $('memory-decisions').textContent = String(stats?.decisions || 0);
    $('memory-conversations').textContent = String(stats?.conversations || 0);
    renderFiles(files || []);
    renderDecisions(decisions || []);
    await refreshClientStatus();
    setHealth('ONLINE', 'on');
  } catch (error) {
    setHealth('ERROR', 'off');
    bindingSub.textContent = `Memory engine error: ${error.message}`;
  }
}

async function bindActiveProject(project = selectedProject()) {
  if (!project) return false;
  const tab = await getActiveChatTab();
  if (!tab) {
    bindingSub.textContent = 'Hãy mở tab ChatGPT cần gắn project.';
    setHealth('OFF', 'off');
    return false;
  }
  setHealth('BINDING', 'busy');
  try {
    await rpc('BIND_PROJECT', { tabId: tab.id, tabUrl: tab.url, project });
    currentTab = tab;
    await chrome.tabs.sendMessage(tab.id, { type: 'TABFLOW_MEMORY_FORCE_SYNC' }).catch(() => undefined);
    await refreshMemory();
    return true;
  } catch (error) {
    setHealth('ERROR', 'off');
    bindingSub.textContent = error.message;
    return false;
  }
}

async function runSearch() {
  const query = queryInput.value.trim();
  const preview = $('memory-query-preview');
  const meta = $('memory-query-meta');
  if (!currentBinding?.projectId || query.length < 2) {
    meta.textContent = 'Cần project đã bind và query ít nhất 2 ký tự.';
    preview.hidden = true;
    return;
  }
  queryBtn.disabled = true;
  queryBtn.textContent = '...';
  try {
    const result = await rpc('QUERY_RAG', { projectId: currentBinding.projectId, query, maxTokens: 2400 });
    meta.textContent = `${result?.citations?.length || 0} refs · ~${result?.estimatedTokens || 0} tokens · ${result?.indexedDocuments || 0} indexed chunks`;
    preview.textContent = String(result?.context || 'Không có kết quả.').slice(0, 14000);
    preview.hidden = false;
  } catch (error) {
    meta.textContent = error.message;
    preview.hidden = true;
  } finally {
    queryBtn.disabled = false;
    queryBtn.textContent = 'Search';
  }
}

async function forceSync() {
  if (!currentTab?.id) currentTab = await getActiveChatTab();
  if (!currentTab?.id) return;
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing…';
  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: 'TABFLOW_MEMORY_FORCE_SYNC' });
    await new Promise(resolve => setTimeout(resolve, 1400));
    await refreshMemory();
  } catch {
    bindingSub.textContent = 'Không gọi được content script. Reload tab ChatGPT rồi thử lại.';
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '↻ Sync';
  }
}

async function clearCurrentProject() {
  if (!currentBinding?.projectId) return;
  const name = currentBinding.project?.name || currentBinding.projectId;
  if (!confirm(`Xóa toàn bộ Local Memory đã index của ${name}? Project binding vẫn được giữ.`)) return;
  setHealth('CLEARING', 'busy');
  try {
    await rpc('CLEAR_PROJECT', { projectId: currentBinding.projectId });
    $('memory-file-preview').hidden = true;
    $('memory-query-preview').hidden = true;
    await refreshMemory();
  } catch (error) {
    bindingSub.textContent = error.message;
    setHealth('ERROR', 'off');
  }
}

function showMemoryView() {
  for (const id of ['tab-nav-active', 'tab-nav-stashed', 'tab-nav-projects']) $(id)?.classList.remove('active');
  memoryNav.classList.add('active');
  $('active-tabs-view').style.display = 'none';
  $('stashed-sessions-view').style.display = 'none';
  $('projects-vault-view').style.display = 'none';
  $('search-section').style.display = 'none';
  memoryView.style.display = 'flex';
  loadProjects().then(refreshMemory);
}

function hideMemoryView() {
  memoryNav.classList.remove('active');
  memoryView.style.display = 'none';
}

memoryNav.addEventListener('click', showMemoryView);
for (const id of ['tab-nav-active', 'tab-nav-stashed', 'tab-nav-projects']) {
  $(id)?.addEventListener('click', hideMemoryView);
}

bindBtn.addEventListener('click', () => bindActiveProject());
syncBtn.addEventListener('click', forceSync);
refreshBtn.addEventListener('click', refreshMemory);
queryBtn.addEventListener('click', runSearch);
queryInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') runSearch();
});
clearBtn.addEventListener('click', clearCurrentProject);

// Preserve the old Project Vault workflow while silently upgrading its "inject"
// button into a real project-memory binding action too.
$('projects-list')?.addEventListener('click', async event => {
  const button = event.target.closest('.btn-inject-proj');
  if (!button) return;
  await loadProjects();
  const cards = [...$('projects-list').children];
  const card = button.closest('.stash-card');
  const index = cards.indexOf(card);
  if (index >= 0 && projects[index]) bindActiveProject(projects[index]);
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.projectVault) loadProjects();
});

loadProjects();
