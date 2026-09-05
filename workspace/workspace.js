/**
 * ChatGPT TabFlow - Multi-Chat Coding Hub Controller
 * Manages split grid layout, embedded ChatGPT sessions, and multi-file Code Scratchpad.
 */

(() => {
  'use strict';

  // State
  let panes = [
    { id: 1, title: 'Frontend / UI', url: 'https://chatgpt.com/' },
    { id: 2, title: 'Backend / API', url: 'https://chatgpt.com/' }
  ];

  let currentLayout = '2-col'; // '2-col' | '3-col' | '4-grid'
  let isScratchpadOpen = true;

  const DEFAULT_FILES = [
    {
      name: 'app.js',
      content: '// ChatGPT TabFlow - Code Scratchpad\n// Viết code hoặc dán code từ các chat vào đây để chỉnh sửa tập trung.\n\nfunction calculateMetrics(items) {\n  return items.reduce((acc, item) => acc + item.value, 0);\n}\n\nconsole.log("Ready to code!");'
    },
    {
      name: 'server.py',
      content: '# Backend API Controller\nfrom fastapi import FastAPI\n\napp = FastAPI(title="ChatGPT TabFlow API")\n\n@app.get("/health")\ndef health_check():\n    return {"status": "healthy", "engine": "TabFlow"}'
    },
    {
      name: 'schema.sql',
      content: '-- Database Schema\nCREATE TABLE IF NOT EXISTS users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL,\n  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP\n);'
    }
  ];

  let files = [...DEFAULT_FILES];
  let activeFileIndex = 0;
  let saveTimer = null;

  // DOM Elements
  const chatGrid = document.getElementById('chat-grid');
  const btnLayout2 = document.getElementById('btn-layout-2');
  const btnLayout3 = document.getElementById('btn-layout-3');
  const btnLayout4 = document.getElementById('btn-layout-4');
  const btnAddPane = document.getElementById('btn-add-pane');
  const btnTileWindows = document.getElementById('btn-tile-windows');
  const btnToggleScratchpad = document.getElementById('btn-toggle-scratchpad');

  const scratchpadPanel = document.getElementById('scratchpad-panel');
  const fileTabsBar = document.getElementById('file-tabs-bar');
  const btnNewFile = document.getElementById('btn-new-file');
  const codeTextarea = document.getElementById('code-textarea');
  const lineNumbers = document.getElementById('line-numbers');

  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnDownloadCode = document.getElementById('btn-download-code');
  const btnClearCode = document.getElementById('btn-clear-code');
  const btnSendToPane1 = document.getElementById('btn-send-to-pane-1');
  const btnSendToPane2 = document.getElementById('btn-send-to-pane-2');

  const toastEl = document.getElementById('workspace-toast');
  let toastTimer = null;

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2800);
  }

  // ================= 1. CHAT GRID & PANE MANAGEMENT =================

  function renderPanes() {
    chatGrid.innerHTML = '';

    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const paneEl = document.createElement('section');
      paneEl.className = 'chat-pane';
      paneEl.dataset.paneId = pane.id;

      paneEl.innerHTML = `
        <div class="pane-header">
          <div class="pane-info">
            <span class="pane-badge">Chat ${i + 1}</span>
            <input type="text" class="pane-title-input" value="${escapeHtml(pane.title)}" title="Nhấp để đổi tên tab chat">
          </div>
          <div class="pane-tools">
            <button class="pane-btn btn-open-external" title="Mở tab này ra cửa sổ Chrome riêng">↗️</button>
            <button class="pane-btn btn-reload-pane" title="Tải lại khung chat này">🔄</button>
            ${panes.length > 1 ? `<button class="pane-btn danger btn-close-pane" title="Đóng khung chat này">✕</button>` : ''}
          </div>
        </div>
        <div class="pane-body">
          <div class="pane-loading">
            <div class="spinner"></div>
            <span>Đang tải ChatGPT...</span>
          </div>
          <iframe src="${pane.url}" allow="clipboard-read; clipboard-write" title="ChatGPT Session ${i + 1}"></iframe>
        </div>
      `;

      const iframe = paneEl.querySelector('iframe');
      const loader = paneEl.querySelector('.pane-loading');
      const titleInput = paneEl.querySelector('.pane-title-input');
      const reloadBtn = paneEl.querySelector('.btn-reload-pane');
      const externalBtn = paneEl.querySelector('.btn-open-external');
      const closeBtn = paneEl.querySelector('.btn-close-pane');

      // Hide loading spinner on load
      iframe.addEventListener('load', () => {
        loader.classList.add('hidden');
      });

      // Update pane title
      titleInput.addEventListener('change', (e) => {
        pane.title = e.target.value.trim() || `Chat ${i + 1}`;
        saveWorkspaceState();
      });

      // Reload iframe
      reloadBtn.addEventListener('click', () => {
        loader.classList.remove('hidden');
        iframe.src = pane.url;
      });

      // Open in standard tab
      externalBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: pane.url });
      });

      // Close pane
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          removePane(pane.id);
        });
      }

      chatGrid.appendChild(paneEl);
    }
  }

  function addPane() {
    if (panes.length >= 4) {
      showToast('Tối đa 4 khung chat song song để đảm bảo tốc độ mượt mà!');
      return;
    }

    const nextId = Date.now();
    const titles = ['Database / SQL', 'Debug & Test', 'Tài liệu / Docs', 'Khung bổ trợ'];
    const title = titles[panes.length - 2] || `Chat ${panes.length + 1}`;

    panes.push({
      id: nextId,
      title,
      url: 'https://chatgpt.com/'
    });

    if (panes.length === 3) setLayout('3-col');
    else if (panes.length === 4) setLayout('4-grid');
    else renderPanes();

    saveWorkspaceState();
    showToast(`Đã thêm khung Chat ${panes.length}`);
  }

  function removePane(paneId) {
    if (panes.length <= 1) return;
    panes = panes.filter(p => p.id !== paneId);

    if (panes.length === 2 && currentLayout === '3-col') {
      setLayout('2-col');
    } else {
      renderPanes();
    }

    saveWorkspaceState();
  }

  function setLayout(layout) {
    currentLayout = layout;
    chatGrid.className = 'chat-grid';

    btnLayout2.classList.remove('active');
    btnLayout3.classList.remove('active');
    btnLayout4.classList.remove('active');

    if (layout === '2-col') {
      chatGrid.classList.add('layout-2-col');
      btnLayout2.classList.add('active');
      if (panes.length > 2) panes = panes.slice(0, 2);
    } else if (layout === '3-col') {
      chatGrid.classList.add('layout-3-col');
      btnLayout3.classList.add('active');
      while (panes.length < 3) {
        panes.push({ id: Date.now() + panes.length, title: `Chat ${panes.length + 1}`, url: 'https://chatgpt.com/' });
      }
    } else if (layout === '4-grid') {
      chatGrid.classList.add('layout-4-grid');
      btnLayout4.classList.add('active');
      while (panes.length < 4) {
        panes.push({ id: Date.now() + panes.length, title: `Chat ${panes.length + 1}`, url: 'https://chatgpt.com/' });
      }
    }

    renderPanes();
    saveWorkspaceState();
  }

  // ================= 2. INTEGRATED CODE SCRATCHPAD =================

  function renderFileTabs() {
    fileTabsBar.innerHTML = '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tab = document.createElement('div');
      tab.className = `file-tab ${i === activeFileIndex ? 'active' : ''}`;
      tab.dataset.fileIndex = i;

      tab.innerHTML = `
        <span class="file-name">${escapeHtml(file.name)}</span>
        ${files.length > 1 ? `<span class="btn-close-file" title="Đóng file">✕</span>` : ''}
      `;

      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-close-file')) return;
        switchFile(i);
      });

      const closeBtn = tab.querySelector('.btn-close-file');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFile(i);
        });
      }

      // Double click to rename
      tab.addEventListener('dblclick', () => {
        const newName = prompt('Đổi tên file:', file.name);
        if (newName && newName.trim()) {
          file.name = newName.trim();
          renderFileTabs();
          saveFilesToStorage();
        }
      });

      fileTabsBar.appendChild(tab);
    }

    updateEditorContent();
  }

  function switchFile(index) {
    if (index >= 0 && index < files.length) {
      // Save current content before switching
      files[activeFileIndex].content = codeTextarea.value;
      activeFileIndex = index;
      renderFileTabs();
    }
  }

  function updateEditorContent() {
    const activeFile = files[activeFileIndex] || files[0];
    if (activeFile) {
      codeTextarea.value = activeFile.content || '';
      updateLineNumbers();
    }
  }

  function updateLineNumbers() {
    const lines = codeTextarea.value.split('\n').length;
    let numbersStr = '';
    for (let i = 1; i <= lines; i++) {
      numbersStr += `${i}\n`;
    }
    lineNumbers.textContent = numbersStr;
  }

  function addNewFile() {
    const name = prompt('Nhập tên file mới (ví dụ: client.ts, query.sql):', `snippet-${files.length + 1}.js`);
    if (!name || !name.trim()) return;

    files.push({
      name: name.trim(),
      content: `// File: ${name.trim()}\n\n`
    });

    activeFileIndex = files.length - 1;
    renderFileTabs();
    saveFilesToStorage();
    showToast(`Đã tạo file ${name.trim()}`);
  }

  function deleteFile(index) {
    if (files.length <= 1) return;
    const deletedName = files[index].name;
    files.splice(index, 1);
    if (activeFileIndex >= files.length) {
      activeFileIndex = files.length - 1;
    }
    renderFileTabs();
    saveFilesToStorage();
    showToast(`Đã đóng file ${deletedName}`);
  }

  function saveFilesToStorage() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        if (files[activeFileIndex]) {
          files[activeFileIndex].content = codeTextarea.value;
        }
        await chrome.storage.local.set({ scratchpadFiles: files });
      } catch (e) {
        console.warn('[Workspace] Save files failed:', e);
      }
    }, 400);
  }

  async function loadFilesFromStorage() {
    try {
      const res = await chrome.storage.local.get('scratchpadFiles');
      if (Array.isArray(res.scratchpadFiles) && res.scratchpadFiles.length > 0) {
        files = res.scratchpadFiles;
      }
    } catch (e) {
      console.warn('[Workspace] Load files failed:', e);
    }
    renderFileTabs();
  }

  // Handle Tab key indentation in textarea
  codeTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeTextarea.selectionStart;
      const end = codeTextarea.selectionEnd;
      const val = codeTextarea.value;

      // Insert 2 spaces
      codeTextarea.value = val.substring(0, start) + '  ' + val.substring(end);
      codeTextarea.selectionStart = codeTextarea.selectionEnd = start + 2;
      updateLineNumbers();
      saveFilesToStorage();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFilesToStorage();
      showToast('✅ Đã lưu code vào máy');
    }
  });

  codeTextarea.addEventListener('input', () => {
    updateLineNumbers();
    saveFilesToStorage();
  });

  // Sync scrolling of line numbers with textarea
  codeTextarea.addEventListener('scroll', () => {
    lineNumbers.scrollTop = codeTextarea.scrollTop;
  });

  // Scratchpad Actions
  btnCopyCode.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeTextarea.value);
      showToast('📋 Đã sao chép toàn bộ code vào Clipboard!');
    } catch (e) {
      showToast('❌ Không thể sao chép code');
    }
  });

  btnDownloadCode.addEventListener('click', () => {
    const activeFile = files[activeFileIndex] || { name: 'code.txt' };
    const blob = new Blob([codeTextarea.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`💾 Đã tải file ${activeFile.name}`);
  });

  btnClearCode.addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn xóa trắng nội dung file này?')) {
      codeTextarea.value = '';
      updateLineNumbers();
      saveFilesToStorage();
    }
  });

  // Cross-Chat Code Exchanger: Send to Chat 1 or Chat 2
  async function sendCodeToChatPrompt(paneIndex) {
    const code = codeTextarea.value.trim();
    if (!code) {
      showToast('Khung soạn thảo đang rỗng!');
      return;
    }

    const activeFile = files[activeFileIndex] || { name: 'code' };
    const promptPayload = `Dưới đây là code từ file \`${activeFile.name}\`:\n\n\`\`\`\n${code}\n\`\`\`\nHãy kiểm tra, tối ưu hoặc thực hiện theo yêu cầu.`;

    try {
      await navigator.clipboard.writeText(promptPayload);
      showToast(`📤 Đã sao chép code kèm prompt! Hãy nhấn Ctrl + V vào ô chat của Chat ${paneIndex + 1}.`);
    } catch (e) {
      showToast('Không thể sao chép prompt');
    }
  }

  btnSendToPane1.addEventListener('click', () => sendCodeToChatPrompt(0));
  btnSendToPane2.addEventListener('click', () => sendCodeToChatPrompt(1));

  // ================= 3. CONTROLS & PERSISTENCE =================

  btnToggleScratchpad.addEventListener('click', () => {
    isScratchpadOpen = !isScratchpadOpen;
    if (isScratchpadOpen) {
      scratchpadPanel.classList.remove('collapsed');
      btnToggleScratchpad.classList.add('primary');
    } else {
      scratchpadPanel.classList.add('collapsed');
      btnToggleScratchpad.classList.remove('primary');
    }
  });

  btnLayout2.addEventListener('click', () => setLayout('2-col'));
  btnLayout3.addEventListener('click', () => setLayout('3-col'));
  btnLayout4.addEventListener('click', () => setLayout('4-grid'));
  btnAddPane.addEventListener('click', () => addPane());

  // Tile Windows Helper (Dual Chrome Windows Side-by-Side)
  btnTileWindows.addEventListener('click', async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'TILE_WINDOWS' });
      if (res && res.success) {
        showToast('🪟 Đã chia đôi 2 cửa sổ Chrome 50/50 trên màn hình!');
      }
    } catch (e) {
      console.warn('[Workspace] Tile windows failed:', e);
      showToast('Đang mở 2 cửa sổ...');
    }
  });

  async function saveWorkspaceState() {
    try {
      await chrome.storage.local.set({
        workspaceState: {
          layout: currentLayout,
          panes: panes.map(p => ({ id: p.id, title: p.title, url: p.url }))
        }
      });
    } catch (e) {
      console.warn('[Workspace] State save failed:', e);
    }
  }

  async function loadWorkspaceState() {
    try {
      const res = await chrome.storage.local.get('workspaceState');
      if (res && res.workspaceState) {
        if (Array.isArray(res.workspaceState.panes) && res.workspaceState.panes.length > 0) {
          panes = res.workspaceState.panes;
        }
        if (res.workspaceState.layout) {
          currentLayout = res.workspaceState.layout;
        }
      }
    } catch (e) {
      console.warn('[Workspace] State load failed:', e);
    }

    setLayout(currentLayout);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
  }

  // Initialize
  loadFilesFromStorage();
  loadWorkspaceState();
})();
