import { ensureWorkspaceFramePolicyForCurrentTab } from './frame-policy-chrome.js';

(async () => {
  try {
    await ensureWorkspaceFramePolicyForCurrentTab();
    await import('./workspace.js');
    await import('./spotlight-resize.js');
  } catch (error) {
    console.error('[TabFlow Workspace] Secure frame bootstrap failed:', error);
    const summary = document.getElementById('workspace-summary');
    const emptyState = document.getElementById('empty-state');
    const grid = document.getElementById('chat-grid');
    if (summary) summary.textContent = 'Không khởi tạo được secure workspace frame policy';
    if (grid) grid.hidden = true;
    if (emptyState) {
      emptyState.hidden = false;
      const title = emptyState.querySelector('h1');
      const text = emptyState.querySelector('p');
      if (title) title.textContent = 'Workspace frame policy lỗi';
      if (text) text.textContent = 'TabFlow không mở iframe ChatGPT khi chính sách frame chưa được giới hạn an toàn cho tab Workspace này.';
    }
  }
})();
