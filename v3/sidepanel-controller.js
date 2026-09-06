const DEFAULT_PROJECTS = [
  {
    id: 'proj_openpronounce',
    name: 'OpenPronounce (AtoEnglish)',
    stack: 'React, Vite, Web Audio API, TypeScript',
    rules: 'Real audio playback, 0ms latency, Vitest unit tests, clean modular architecture.'
  },
  {
    id: 'proj_moneyflow',
    name: 'Atoryn MoneyFlow',
    stack: 'Next.js 15, TypeScript, Tailwind CSS, SQLite Marts',
    rules: 'Financial precision, no float rounding errors, strict OpenAPI contracts.'
  }
];

const $ = id => document.getElementById(id);

const views = {
  active: $('active-tabs-view'),
  stashed: $('stashed-sessions-view'),
  projects: $('projects-vault-view'),
  memory: $('memory-view'),
  runtime: $('runtime-view')
};

const nav = {
  active: $('tab-nav-active'),
  stashed: $('tab-nav-stashed'),
  projects: $('tab-nav-projects'),
  memory: $('tab-nav-memory'),
  runtime: $('tab-nav-runtime')
};

let openTabs = [];
let stashedSessions = [];
let projects = [];
let searchQuery = '';
let refreshTimer = null;
let toastTimer = null;

function isChatGptUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' || host.endsWith('.chat.openai.com');
  } catch {
    return false;
  }
}

function cleanTitle(title = '') {
  return String(title)
    .replace(/\s+-\s+ChatGPT$/i, '')
    .replace(/^ChatGPT\s+-\s+/i, '')
    .trim() || 'ChatGPT';
}

function showToast(message, tone = 'info') {
  const toast = $('toast');
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function getActiveChatTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id && isChatGptUrl(tab.url) ? tab : null;
}

function setBaseView(name) {
  for (const [key, node] of Object.entries(views)) {
    if (node) node.style.display = key === name ? 'flex' : 'none';
  }
  for (const [key, button] of Object.entries(nav)) {
    button?.classList.toggle('active', key === name);
  }
  const search = $('search-section');
  if (search) search.style.display = name === 'active' ? 'block' : 'none';
}

function runtimeEntryFor(snapshot, tabId) {
  return snapshot?.tabs?.[String(tabId)] || null;
}

function tabState(tab, snapshot) {
  if (tab.discarded) return { label: 'Ngủ', className: 'sleeping' };
  const entry = runtimeEntryFor(snapshot, tab.id);
  if (entry?.state === 'generating') return { label: 'Đang trả lời', className: 'generating' };
  if (entry?.state === 'typing') return { label: 'Đang gõ', className: 'typing' };
  if (tab.active) return { label: 'Đang dùng', className: 'active' };
  return { label: 'Sẵn sàng', className: 'idle' };
}

function renderTabs(snapshot = {}) {
  const host = views.active;
  if (!host) return;
  const query = searchQuery.trim().toLowerCase();
  const filtered = openTabs
    .filter(tab => !query || cleanTitle(tab.title).toLowerCase().includes(query) || String(tab.url || '').toLowerCase().includes(query))
    .sort((a, b) => {
      const rank = tab => {
        const state = runtimeEntryFor(snapshot, tab.id)?.state;
        if (tab.active) return 5;
        if (state === 'generating') return 4;
        if (state === 'typing') return 3;
        if (!tab.discarded) return 2;
        return 1;
      };
      return rank(b) - rank(a) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
    });

  host.replaceChildren();
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'control-empty';
    empty.textContent = query ? 'Không tìm thấy cuộc chat phù hợp.' : 'Chưa có tab ChatGPT nào trong cửa sổ này.';
    host.appendChild(empty);
    return;
  }

  for (const tab of filtered) {
    const state = tabState(tab, snapshot);
    const card = document.createElement('article');
    card.className = `control-chat-card ${tab.active ? 'is-current' : ''}`;

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'control-chat-main';
    body.addEventListener('click', async () => {
      await send('ACTIVATE_TAB', { tabId: tab.id });
      await refreshAll();
    });

    const title = document.createElement('strong');
    title.className = 'control-chat-title';
    title.textContent = cleanTitle(tab.title);
    title.title = cleanTitle(tab.title);

    const meta = document.createElement('span');
    meta.className = 'control-chat-meta';
    const entry = runtimeEntryFor(snapshot, tab.id);
    const pieces = [state.label];
    if (entry?.projectName) pieces.push(entry.projectName);
    if (entry?.protectedFromDiscard) pieces.push('được bảo vệ');
    meta.textContent = pieces.join(' · ');

    const statePill = document.createElement('span');
    statePill.className = `control-state ${state.className}`;
    statePill.textContent = state.label;

    body.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'control-chat-actions';
    actions.appendChild(statePill);

    if (!tab.active && !tab.discarded) {
      const sleep = document.createElement('button');
      sleep.type = 'button';
      sleep.className = 'control-icon-action';
      sleep.title = 'Cho chat này ngủ nếu runtime xác nhận đang nhàn rỗi';
      sleep.textContent = '☾';
      sleep.addEventListener('click', async () => {
        const result = await send('DISCARD_TAB', { tabId: tab.id });
        showToast(result?.success ? 'Đã cho chat nhàn rỗi ngủ.' : 'Chat đang bận hoặc được bảo vệ.', result?.success ? 'success' : 'warning');
        await refreshAll();
      });
      actions.appendChild(sleep);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'control-icon-action danger';
    close.title = 'Đóng tab';
    close.textContent = '×';
    close.addEventListener('click', async () => {
      await send('CLOSE_TAB', { tabId: tab.id });
      await refreshAll();
    });
    actions.appendChild(close);

    card.append(body, actions);
    host.appendChild(card);
  }
}

function renderSessions() {
  const host = views.stashed;
  if (!host) return;
  host.replaceChildren();
  if (stashedSessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'control-empty';
    empty.textContent = 'Chưa có phiên đã lưu.';
    host.appendChild(empty);
    return;
  }

  for (const session of stashedSessions) {
    const card = document.createElement('article');
    card.className = 'control-session-card';

    const copy = document.createElement('div');
    copy.className = 'control-session-copy';
    const title = document.createElement('strong');
    title.textContent = session.name || 'Phiên ChatGPT';
    const meta = document.createElement('span');
    meta.textContent = `${session.tabCount || session.tabs?.length || 0} chat · ${new Date(session.timestamp || Date.now()).toLocaleString('vi-VN')}`;
    copy.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'control-session-actions';
    const restore = document.createElement('button');
    restore.className = 'control-small-btn primary';
    restore.textContent = 'Khôi phục';
    restore.addEventListener('click', async () => {
      const result = await send('RESTORE_SESSION', { sessionId: session.id });
      showToast(result?.success ? `Đã mở lại ${result.count || 0} chat.` : 'Không khôi phục được phiên.', result?.success ? 'success' : 'warning');
      await refreshAll();
    });
    const remove = document.createElement('button');
    remove.className = 'control-small-btn danger';
    remove.textContent = 'Xóa';
    remove.addEventListener('click', async () => {
      await send('DELETE_STASHED_SESSION', { sessionId: session.id });
      await refreshAll();
    });
    actions.append(restore, remove);
    card.append(copy, actions);
    host.appendChild(card);
  }
}

async function loadProjects() {
  const stored = await chrome.storage.local.get('projectVault');
  if (!Array.isArray(stored.projectVault) || stored.projectVault.length === 0) {
    projects = DEFAULT_PROJECTS.map(project => ({ ...project }));
    await chrome.storage.local.set({ projectVault: projects });
  } else {
    projects = stored.projectVault;
  }
  renderProjects();
}

function renderProjects() {
  const host = $('projects-list');
  if (!host) return;
  host.replaceChildren();
  $('count-projects').textContent = String(projects.length);

  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'control-project-card';

    const copy = document.createElement('div');
    copy.className = 'control-project-copy';
    const title = document.createElement('strong');
    title.textContent = project.name;
    const stack = document.createElement('span');
    stack.textContent = project.stack || 'Chưa khai báo stack';
    const rules = document.createElement('p');
    rules.textContent = project.rules || 'Chưa có quy tắc project.';
    copy.append(title, stack, rules);

    const actions = document.createElement('div');
    actions.className = 'control-project-actions';
    const bind = document.createElement('button');
    bind.type = 'button';
    bind.className = 'control-small-btn primary btn-inject-proj';
    bind.textContent = 'Gắn vào chat hiện tại';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'control-small-btn danger';
    remove.textContent = 'Xóa';
    remove.addEventListener('click', async () => {
      if (!confirm(`Xóa project ${project.name}? Local Memory đã index không bị xóa tự động.`)) return;
      projects = projects.filter(item => item.id !== project.id);
      await chrome.storage.local.set({ projectVault: projects });
      renderProjects();
      showToast('Đã xóa project khỏi Project Vault.');
    });
    actions.append(bind, remove);
    card.append(copy, actions);
    host.appendChild(card);
  }
}

async function addProject() {
  const name = prompt('Tên project:')?.trim();
  if (!name) return;
  const stack = prompt('Tech stack chính:', '')?.trim() || '';
  const rules = prompt('Các quy tắc/constraint cần AI luôn tuân thủ:', '')?.trim() || '';
  const project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    stack,
    rules
  };
  projects = [...projects, project];
  await chrome.storage.local.set({ projectVault: projects });
  renderProjects();
  showToast(`Đã tạo ${name}.`, 'success');
}

async function refreshCurrentContext() {
  const active = await getActiveChatTab();
  const title = $('control-current-chat');
  const project = $('control-current-project');
  const memory = $('control-memory-state');

  if (!active) {
    title.textContent = 'Không có ChatGPT đang active';
    project.textContent = 'Mở một tab ChatGPT để dùng TabFlow';
    memory.textContent = 'Memory —';
    memory.dataset.state = 'off';
    return;
  }

  title.textContent = cleanTitle(active.title);
  project.textContent = 'Chưa gắn Project Memory';
  memory.textContent = 'Memory chưa gắn';
  memory.dataset.state = 'off';

  try {
    const status = await chrome.tabs.sendMessage(active.id, { type: 'TABFLOW_MEMORY_CLIENT_STATUS' });
    if (status?.binding?.projectId) {
      const projectName = status.binding.project?.name || status.binding.projectId;
      project.textContent = projectName;
      if (status.prepared) {
        memory.textContent = `RAG sẵn sàng · ${status.prepared.citationCount || 0} refs`;
        memory.dataset.state = 'ready';
      } else {
        memory.textContent = 'Memory đã kết nối';
        memory.dataset.state = 'ready';
      }
    }
  } catch {
    memory.textContent = 'Memory cần reload tab';
    memory.dataset.state = 'warning';
  }
}

async function refreshSummary(snapshot = {}) {
  const total = openTabs.length;
  const sleeping = openTabs.filter(tab => tab.discarded).length;
  const generating = Number(snapshot.generatingCount || 0);
  const protectedCount = Number(snapshot.protectedCount || 0);
  const pressure = String(snapshot.memory?.level || 'unknown').toLowerCase();

  $('control-chat-count').textContent = String(total);
  $('count-open').textContent = String(total);
  $('control-workspace-summary').textContent = `${total} chat · ${generating} đang trả lời · ${sleeping} ngủ`;
  $('control-runtime-summary').textContent = `${protectedCount} được bảo vệ · RAM hệ thống ${pressure === 'unknown' ? '—' : pressure}`;
}

async function refreshAll() {
  try {
    const [tabsData, runtimeData, sessionsData] = await Promise.all([
      send('GET_TABS_DATA'),
      send('RUNTIME_GET_STATE').catch(() => null),
      send('GET_STASHED_SESSIONS')
    ]);

    if (tabsData?.success) openTabs = tabsData.tabs || [];
    if (sessionsData?.success) stashedSessions = sessionsData.sessions || [];
    const snapshot = runtimeData?.success ? runtimeData.snapshot || {} : {};

    renderTabs(snapshot);
    renderSessions();
    $('count-stashed').textContent = String(stashedSessions.length);
    await refreshSummary(snapshot);
    await refreshCurrentContext();
  } catch (error) {
    console.warn('[TabFlow Control Center] refresh failed:', error);
  }
}

async function freezeIdleChats() {
  const button = $('btn-turbo-freeze');
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Đang kiểm tra…';
  try {
    const result = await send('DISCARD_ALL_BACKGROUND');
    if (!result?.success) throw new Error(result?.error || 'Không thể hibernate');
    if (result.discardedCount > 0) {
      showToast(`Đã cho ${result.discardedCount} chat nhàn rỗi ngủ.`, 'success');
    } else if (result.protectedCount > 0) {
      showToast(`${result.protectedCount} chat đang làm việc nên được giữ nguyên.`, 'info');
    } else {
      showToast('Không có chat nhàn rỗi cần ngủ.', 'info');
    }
    await refreshAll();
  } catch (error) {
    showToast(error.message, 'warning');
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

async function stashSession() {
  if (openTabs.length === 0) {
    showToast('Không có chat để lưu.', 'warning');
    return;
  }
  const name = prompt('Tên phiên làm việc:', `Phiên ${new Date().toLocaleString('vi-VN')}`)?.trim();
  if (!name) return;
  const result = await send('STASH_SESSION', { sessionName: name });
  showToast(result?.success ? `Đã lưu ${openTabs.length} chat vào phiên.` : (result?.message || 'Không lưu được phiên.'), result?.success ? 'success' : 'warning');
  await refreshAll();
}

function installEvents() {
  nav.active?.addEventListener('click', () => setBaseView('active'));
  nav.stashed?.addEventListener('click', () => setBaseView('stashed'));
  nav.projects?.addEventListener('click', () => setBaseView('projects'));

  $('search-input')?.addEventListener('input', event => {
    searchQuery = event.target.value || '';
    refreshAll();
  });

  $('btn-refresh')?.addEventListener('click', refreshAll);
  $('btn-options')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-open-coding-hub')?.addEventListener('click', () => send('OPEN_WORKSPACE'));
  $('btn-open-recorder')?.addEventListener('click', () => chrome.tabs.create({
    url: chrome.runtime.getURL('recorder/index.html'),
    active: true
  }));
  $('control-open-memory')?.addEventListener('click', () => nav.memory?.click());
  $('btn-turbo-freeze')?.addEventListener('click', freezeIdleChats);
  $('btn-group-tabs')?.addEventListener('click', async () => {
    await send('GROUP_TABS');
    showToast('Đã gom các tab ChatGPT theo cửa sổ.', 'success');
  });
  $('btn-stash-session')?.addEventListener('click', stashSession);
  $('btn-add-project')?.addEventListener('click', addProject);
}

async function init() {
  const version = chrome.runtime.getManifest().version;
  const badge = $('badge-version');
  if (badge) badge.textContent = `v${version}`;
  installEvents();
  setBaseView('active');
  await loadProjects();
  await refreshAll();
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshAll();
  }, 5000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAll();
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.projectVault) loadProjects();
});

window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

init().catch(error => {
  console.error('[TabFlow Control Center] init failed:', error);
  showToast('Không khởi tạo được TabFlow Control Center.', 'warning');
});