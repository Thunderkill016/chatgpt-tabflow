/**
 * ChatGPT TabFlow - Side Panel Controller
 * Handles real-time tab list rendering, search filtering, tab activation, and stashes.
 */

(() => {
  'use strict';

  // State
  let openTabs = [];
  let stashedSessions = [];
  let currentView = 'active'; // 'active' | 'stashed'
  let searchQuery = '';

  // Elements
  const elStatRamSaved = document.getElementById('stat-ram-saved');
  const elStatFreezes = document.getElementById('stat-freezes');
  const elStatTotalTabs = document.getElementById('stat-total-tabs');
  const elStatSleepingTabs = document.getElementById('stat-sleeping-tabs');

  const btnOpenCodingHub = document.getElementById('btn-open-coding-hub');
  const btnTurboFreeze = document.getElementById('btn-turbo-freeze');
  const btnGroupTabs = document.getElementById('btn-group-tabs');
  const btnStashSession = document.getElementById('btn-stash-session');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnOptions = document.getElementById('btn-options');

  const tabNavActive = document.getElementById('tab-nav-active');
  const tabNavStashed = document.getElementById('tab-nav-stashed');
  const tabNavProjects = document.getElementById('tab-nav-projects');
  const countOpen = document.getElementById('count-open');
  const countStashed = document.getElementById('count-stashed');
  const countProjects = document.getElementById('count-projects');

  const searchSection = document.getElementById('search-section');
  const searchInput = document.getElementById('search-input');
  const activeTabsView = document.getElementById('active-tabs-view');
  const stashedSessionsView = document.getElementById('stashed-sessions-view');
  const projectsVaultView = document.getElementById('projects-vault-view');
  const projectsList = document.getElementById('projects-list');
  const btnAddProject = document.getElementById('btn-add-project');
  const toastEl = document.getElementById('toast');

  let projectList = [
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

  let toastTimer = null;
  function showToast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2500);
  }

  function formatMb(mb) {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(mb)} MB`;
  }

  /**
   * Fetch current tab and stats data from Service Worker
   */
  async function loadData() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' });
      if (response && response.success) {
        openTabs = response.tabs || [];
        renderStats(response.stats);
        renderOpenTabs();
      }

      const stashedRes = await chrome.runtime.sendMessage({ type: 'GET_STASHED_SESSIONS' });
      if (stashedRes && stashedRes.success) {
        stashedSessions = stashedRes.sessions || [];
        renderStashedSessions();
      }

      updateNavCounts();
    } catch (err) {
      console.error('[TabFlow SidePanel] Load error:', err);
    }
  }

  function renderStats(stats) {
    const total = openTabs.length;
    const sleeping = openTabs.filter(t => t.discarded).length;

    elStatTotalTabs.textContent = `${total} tabs`;
    elStatSleepingTabs.textContent = `${sleeping} đang ngủ đông 💤`;

    const mbSaved = stats?.estimatedMbSaved || (sleeping * 415);
    elStatRamSaved.textContent = formatMb(mbSaved);
    elStatFreezes.textContent = `${stats?.totalDiscardCount || 0} lần đóng băng`;
  }

  function updateNavCounts() {
    countOpen.textContent = openTabs.length;
    countStashed.textContent = stashedSessions.length;
  }

  /**
   * Render list of open ChatGPT tabs
   */
  function renderOpenTabs() {
    const query = searchQuery.trim().toLowerCase();
    const filtered = openTabs.filter(t => {
      if (!query) return true;
      const titleMatch = t.title && t.title.toLowerCase().includes(query);
      const urlMatch = t.url && t.url.toLowerCase().includes(query);
      return titleMatch || urlMatch;
    });

    if (filtered.length === 0) {
      activeTabsView.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">${query ? '🔍' : '🤖'}</span>
          <p>${query ? 'Không tìm thấy tab phù hợp' : 'Không có tab ChatGPT nào đang mở'}</p>
        </div>
      `;
      return;
    }

    activeTabsView.innerHTML = '';
    for (const tab of filtered) {
      const card = document.createElement('div');
      card.className = `tab-card ${tab.active ? 'active-tab' : ''} ${tab.discarded ? 'discarded-tab' : ''}`;
      card.dataset.tabId = tab.id;

      const title = tab.title.replace(/ - ChatGPT$/, '').replace(/^ChatGPT - /, '') || 'Hội thoại ChatGPT';

      card.innerHTML = `
        <div class="tab-card-header">
          <div class="tab-title" title="${escapeHtml(tab.title)}">
            ${escapeHtml(title)}
          </div>
        </div>
        <div class="tab-meta">
          <span class="status-badge ${tab.discarded ? 'sleeping' : 'active'}">
            ${tab.discarded ? '💤 Đã ngủ (Tiết kiệm RAM)' : (tab.active ? '🟢 Đang dùng' : '⏳ Chờ')}
          </span>
          <div class="tab-actions">
            ${!tab.discarded && !tab.active ? `<button class="mini-btn btn-freeze-one" title="Đóng băng giải phóng RAM">⚡ Ngủ đông</button>` : ''}
            <button class="mini-btn danger btn-close-one" title="Đóng tab này">✕</button>
          </div>
        </div>
      `;

      // Event: Click anywhere on card (except actions) to switch to tab
      card.addEventListener('click', (e) => {
        if (e.target.closest('.mini-btn')) return;
        activateTab(tab.id);
      });

      // Event: Discard this tab
      const freezeBtn = card.querySelector('.btn-freeze-one');
      if (freezeBtn) {
        freezeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await discardTab(tab.id);
        });
      }

      // Event: Close this tab
      const closeBtn = card.querySelector('.btn-close-one');
      if (closeBtn) {
        closeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await closeTab(tab.id);
        });
      }

      activeTabsView.appendChild(card);
    }
  }

  /**
   * Render list of saved/stashed sessions
   */
  function renderStashedSessions() {
    if (stashedSessions.length === 0) {
      stashedSessionsView.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📦</span>
          <p>Chưa có phiên làm việc nào được lưu.</p>
          <small style="color: var(--text-muted);">Bấm "Lưu phiên" để cất toàn bộ tab ChatGPT và giải phóng 100% RAM.</small>
        </div>
      `;
      return;
    }

    stashedSessionsView.innerHTML = '';
    for (const session of stashedSessions) {
      const card = document.createElement('div');
      card.className = 'stash-card';

      const dateStr = new Date(session.timestamp).toLocaleString('vi-VN');
      card.innerHTML = `
        <div class="stash-header">
          <span class="stash-title">${escapeHtml(session.name)}</span>
          <span class="stash-time">${dateStr}</span>
        </div>
        <div class="stash-summary">
          Chứa <strong>${session.tabCount}</strong> cuộc trò chuyện ChatGPT
        </div>
        <div class="stash-actions">
          <button class="btn-secondary btn-restore" style="flex: 2;">🔄 Khôi phục (${session.tabCount} tabs)</button>
          <button class="btn-secondary mini-btn danger btn-delete-stash" style="flex: 1;">🗑️ Xóa</button>
        </div>
      `;

      card.querySelector('.btn-restore').addEventListener('click', async () => {
        const res = await chrome.runtime.sendMessage({
          type: 'RESTORE_SESSION',
          sessionId: session.id
        });
        if (res && res.success) {
          showToast(`Đã khôi phục ${res.count} tab ChatGPT!`);
          await loadData();
          switchView('active');
        }
      });

      card.querySelector('.btn-delete-stash').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'DELETE_STASHED_SESSION',
          sessionId: session.id
        });
        showToast('Đã xóa phiên lưu trữ');
        await loadData();
      });

      stashedSessionsView.appendChild(card);
    }
  }

  async function activateTab(tabId) {
    await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId });
    await loadData();
  }

  async function discardTab(tabId) {
    const res = await chrome.runtime.sendMessage({ type: 'DISCARD_TAB', tabId });
    if (res && res.success) {
      showToast('Đã đóng băng tab và giải phóng ~400MB RAM!');
      await loadData();
    }
  }

  async function closeTab(tabId) {
    await chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId });
    await loadData();
  }

  async function loadProjects() {
    try {
      const res = await chrome.storage.local.get('projectVault');
      if (Array.isArray(res.projectVault) && res.projectVault.length > 0) {
        projectList = res.projectVault;
      }
    } catch (e) {
      console.warn('[TabFlow SidePanel] Load projects failed:', e);
    }
    renderProjects();
  }

  async function saveProjects() {
    try {
      await chrome.storage.local.set({ projectVault: projectList });
    } catch (e) {
      console.warn('[TabFlow SidePanel] Save projects failed:', e);
    }
    renderProjects();
  }

  function renderProjects() {
    countProjects.textContent = projectList.length;
    projectsList.innerHTML = '';

    for (let i = 0; i < projectList.length; i++) {
      const proj = projectList[i];
      const card = document.createElement('div');
      card.className = 'stash-card';

      card.innerHTML = `
        <div class="stash-header">
          <span class="stash-title">📁 ${escapeHtml(proj.name)}</span>
          <button class="mini-btn danger btn-delete-proj" title="Xóa dự án">🗑️</button>
        </div>
        <div class="stash-summary">
          <strong>Stack:</strong> ${escapeHtml(proj.stack)}<br>
          <strong>Quy chuẩn:</strong> ${escapeHtml(proj.rules)}
        </div>
        <div class="stash-actions">
          <button class="btn-primary btn-inject-proj" style="width: 100%; padding: 6px 10px; font-size: 11.5px;">
            💉 Bơm ngữ cảnh vào Chat hiện tại
          </button>
        </div>
      `;

      card.querySelector('.btn-delete-proj').addEventListener('click', () => {
        if (confirm(`Xóa hồ sơ dự án ${proj.name}?`)) {
          projectList.splice(i, 1);
          saveProjects();
          showToast('Đã xóa dự án');
        }
      });

      card.querySelector('.btn-inject-proj').addEventListener('click', async () => {
        const payload = `### 📁 HỒ SƠ DỰ ÁN: ${proj.name}\n- **Tech Stack:** ${proj.stack}\n- **Kiến trúc & Quy chuẩn kỹ thuật:** ${proj.rules}\n\nHãy áp dụng nghiêm ngặt các quy chuẩn kỹ thuật này cho toàn bộ giải pháp và code tiếp theo của chúng ta. Hãy xác nhận bạn đã hiểu.`;
        await navigator.clipboard.writeText(payload);
        showToast(`💉 Đã sao chép hồ sơ dự án ${proj.name}! Hãy nhấn Ctrl + V vào ô chat.`);
      });

      projectsList.appendChild(card);
    }
  }

  function switchView(view) {
    currentView = view;
    tabNavActive.classList.remove('active');
    tabNavStashed.classList.remove('active');
    tabNavProjects.classList.remove('active');

    activeTabsView.style.display = 'none';
    stashedSessionsView.style.display = 'none';
    projectsVaultView.style.display = 'none';
    searchSection.style.display = 'none';

    if (view === 'active') {
      tabNavActive.classList.add('active');
      activeTabsView.style.display = 'flex';
      searchSection.style.display = 'block';
    } else if (view === 'stashed') {
      tabNavStashed.classList.add('active');
      stashedSessionsView.style.display = 'flex';
    } else if (view === 'projects') {
      tabNavProjects.classList.add('active');
      projectsVaultView.style.display = 'flex';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
  }

  // Event Listeners
  if (btnOpenCodingHub) {
    btnOpenCodingHub.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'OPEN_WORKSPACE' });
    });
  }

  btnTurboFreeze.addEventListener('click', async () => {
    btnTurboFreeze.disabled = true;
    btnTurboFreeze.innerHTML = '<span>⏳</span> Đang đóng băng...';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DISCARD_ALL_BACKGROUND' });
      if (res && res.success) {
        if (res.discardedCount > 0) {
          showToast(`⚡ Đã đóng băng ${res.discardedCount} tab, giải phóng ${formatMb(res.freedMb)} RAM!`);
        } else {
          showToast('Tất cả các tab nền đã ở trạng thái ngủ!');
        }
      }
    } finally {
      btnTurboFreeze.disabled = false;
      btnTurboFreeze.innerHTML = '<span>⚡</span> Turbo Freeze — Dọn RAM Ngay';
      await loadData();
    }
  });

  btnGroupTabs.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'GROUP_TABS' });
    showToast('Đã gom các tab ChatGPT vào Tab Group!');
    await loadData();
  });

  btnStashSession.addEventListener('click', async () => {
    if (openTabs.length === 0) {
      showToast('Không có tab ChatGPT nào để lưu!');
      return;
    }
    const sessionName = prompt('Đặt tên cho phiên làm việc (hoặc để trống để dùng ngày giờ):');
    const res = await chrome.runtime.sendMessage({
      type: 'STASH_SESSION',
      sessionName: sessionName?.trim() || undefined
    });
    if (res && res.success) {
      showToast(`Đã lưu ${res.session.tabCount} tab và đóng giải phóng RAM!`);
      await loadData();
      switchView('stashed');
    }
  });

  btnRefresh.addEventListener('click', async () => {
    await loadData();
    showToast('Đã làm mới danh sách tab');
  });

  btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  tabNavActive.addEventListener('click', () => switchView('active'));
  tabNavStashed.addEventListener('click', () => switchView('stashed'));
  tabNavProjects.addEventListener('click', () => switchView('projects'));

  btnAddProject.addEventListener('click', () => {
    const name = prompt('Nhập tên dự án (ví dụ: Mobile App, Backend API):');
    if (!name || !name.trim()) return;
    const stack = prompt('Nhập Tech Stack (ví dụ: React Native, Node.js, PostgreSQL):', '');
    const rules = prompt('Nhập Quy chuẩn kỹ thuật (ví dụ: Clean Code, TypeScript, Vitest):', '');

    projectList.push({
      id: `proj_${Date.now()}`,
      name: name.trim(),
      stack: stack?.trim() || 'Standard Stack',
      rules: rules?.trim() || 'Follow best practices'
    });
    saveProjects();
    showToast(`Đã thêm dự án ${name.trim()}`);
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderOpenTabs();
  });

  // Listen to tab events in browser to keep list synchronized
  chrome.tabs.onUpdated.addListener(() => loadData());
  chrome.tabs.onRemoved.addListener(() => loadData());
  chrome.tabs.onActivated.addListener(() => loadData());

  // Initialize
  loadData();
  loadProjects();
})();

