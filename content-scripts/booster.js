/**
 * ChatGPT TabFlow Suite - In-Page Developer Engine
 * Runtime-aware: background/strained actors suspend non-essential maintenance.
 */

(() => {
  'use strict';

  let typingTimeout = null;
  let codeVaultOpen = false;
  let capturedCodeBlocks = [];
  let lastProxyStats = null;
  let lastAutoContinueTime = 0;
  let foldHintShown = false;
  let runtimeMode = document.documentElement.dataset.tabflowRuntimeMode || 'interactive';
  let maintenanceTimer = null;

  window.addEventListener('tabflow:runtime-mode', event => {
    runtimeMode = event.detail?.mode || 'interactive';
    document.documentElement.dataset.tabflowRuntimeMode = runtimeMode;
  });

  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'TABFLOW_TRIMMED_STATS') {
      lastProxyStats = e.data;
      if (runtimeMode === 'interactive') updateHudMeter();
    } else if (e.data.type === 'TABFLOW_RETRY_STATUS') {
      const attempt = e.data.attempt || 1;
      const maxRetries = e.data.maxRetries || 3;
      showStatusPill(`🔄 Đang thử lại kết nối... (lần ${attempt}/${maxRetries})`);
    }
  });

  async function checkPendingRollover() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      const res = await chrome.storage.local.get('pendingRolloverPrompt');
      if (res && res.pendingRolloverPrompt) {
        const prompt = res.pendingRolloverPrompt;
        await chrome.storage.local.remove('pendingRolloverPrompt');
        const maxWait = 25;
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          const textarea = document.getElementById('prompt-textarea') || document.querySelector('textarea');
          if (textarea) {
            clearInterval(interval);
            textarea.value = prompt;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.focus();
            showStatusPill('⚡ Đã nạp đầy đủ trí nhớ từ cuộc trò chuyện trước!');
          } else if (attempts >= maxWait) {
            clearInterval(interval);
          }
        }, 300);
      }
    } catch (e) {
      console.warn('[TabFlow] Pending rollover check failed:', e);
    }
  }

  function getTurnElements() {
    const byRole = document.querySelectorAll('[data-message-author-role="user"]');
    if (byRole && byRole.length > 0) return byRole;
    const byArticle = document.querySelectorAll('article');
    if (byArticle && byArticle.length > 0) return byArticle;
    return document.querySelectorAll('div[data-testid^="conversation-turn-"]');
  }

  function getConversationStats() {
    const turns = getTurnElements().length;
    if (lastProxyStats && typeof lastProxyStats.estimatedTokens === 'number') {
      return {
        turns: lastProxyStats.turnCount || turns || 1,
        tokens: lastProxyStats.estimatedTokens,
        pct: lastProxyStats.estimatedBudgetPct || Math.min(100, Math.round((lastProxyStats.estimatedTokens / 32000) * 100))
      };
    }

    const messages = document.querySelectorAll('[data-message-author-role]');
    let totalCodeChars = 0;
    let totalTextChars = 0;
    const codeEls = document.querySelectorAll('pre code');
    for (let i = 0; i < codeEls.length; i++) totalCodeChars += (codeEls[i].textContent || '').length;

    if (messages.length > 0) {
      for (let i = 0; i < messages.length; i++) totalTextChars += (messages[i].textContent || '').length;
    } else {
      const articles = document.querySelectorAll('article');
      for (let i = 0; i < articles.length; i++) totalTextChars += (articles[i].textContent || '').length;
    }

    const pureTextChars = Math.max(0, totalTextChars - totalCodeChars);
    const estimatedTokens = Math.round((totalCodeChars / 2.8) + (pureTextChars / 4.0));
    const pct = Math.min(100, Math.max(turns > 0 ? 5 : 0, Math.round((estimatedTokens / 32000) * 100)));
    return { turns, tokens: estimatedTokens, pct };
  }

  function extractContextSnapshot() {
    const titleEl = document.querySelector('title');
    const pageTitle = (titleEl ? titleEl.textContent : '').replace(/ - ChatGPT$/, '') || 'Dự án Lập trình';
    const codeSnippets = extractCodeBlocks();
    const codeList = codeSnippets.map((c, i) => {
      const firstLine = (c.code.split('\n')[0] || '').trim();
      return `- **File/Hàm ${i + 1} (${c.lang}):** ${firstLine ? `\`${firstLine}\`` : 'Code snippet'}`;
    }).slice(-8);

    let lastUserTurn = '';
    let lastAssistantTurn = '';
    const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (assistantMessages.length > 0) lastAssistantTurn = (assistantMessages[assistantMessages.length - 1].textContent || '').slice(0, 400);
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    if (userMessages.length > 0) lastUserTurn = (userMessages[userMessages.length - 1].textContent || '').slice(0, 300);

    return `### 🤖 BỐI CẢNH DỰ ÁN & TIẾP NỐI TỪ CUỘC TRÒ CHUYỆN TRƯỚC
**Dự án:** ${pageTitle}

**Tổng quan các mã nguồn đã code:**
${codeList.length > 0 ? codeList.join('\n') : '- Đã trao đổi các giải pháp kỹ thuật và mã nguồn liên quan.'}

**Nhiệm vụ dở dang gần nhất:**
- Người dùng yêu cầu: "${lastUserTurn.trim().slice(0, 180)}..."
- Giải pháp trước đó: "${lastAssistantTurn.trim().slice(0, 200)}..."

**Yêu cầu tiếp tục:**
Tôi vừa chuyển sang tab mới vì cuộc trò chuyện cũ đã chạm ngưỡng bộ nhớ. Hãy tiếp tục dự án với đầy đủ ngữ cảnh trên.`;
  }

  async function triggerSmartRollover() {
    const primer = extractContextSnapshot();
    if (typeof chrome !== 'undefined' && chrome.storage) await chrome.storage.local.set({ pendingRolloverPrompt: primer });
    window.open('https://chatgpt.com/', '_blank');
    showStatusPill('🚀 Đang mở Chat mới với đầy đủ trí nhớ...');
  }

  function extractCodeBlocks() {
    const codeElements = document.querySelectorAll('pre code');
    const results = [];
    for (let i = 0; i < codeElements.length; i++) {
      const codeEl = codeElements[i];
      const pre = codeEl.closest('pre');
      const codeText = codeEl.textContent || '';
      if (codeText.trim().length < 10) continue;
      let lang = 'code';
      for (const cls of codeEl.classList) {
        if (cls.startsWith('language-')) {
          lang = cls.replace('language-', '');
          break;
        }
      }
      const headerSpan = pre?.parentElement?.querySelector('span');
      const label = headerSpan ? headerSpan.textContent.trim() : lang;
      results.push({ id: i + 1, lang, label: label || lang, code: codeText });
    }
    capturedCodeBlocks = results;
    return results;
  }

  function renderVaultDrawer() {
    let drawer = document.getElementById('tabflow-vault-drawer');
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'tabflow-vault-drawer';
      document.body.appendChild(drawer);
    }
    const blocks = extractCodeBlocks();
    drawer.innerHTML = `
      <div class="vault-header"><div class="vault-title"><span>📦</span> Code Vault (${blocks.length} files)</div><button id="vault-btn-close" class="vault-close-btn" title="Đóng ngăn kéo">✕</button></div>
      <div class="vault-list">${blocks.length === 0 ? '<div class="vault-empty"><p>Chưa có đoạn code nào được sinh trong đoạn chat này.</p></div>' : blocks.map(b => `
        <div class="vault-card" data-code-id="${b.id}"><div class="vault-card-header"><span class="vault-card-lang">${escapeHtml(b.label.toUpperCase())}</span><div class="vault-card-actions"><button class="vault-mini-btn btn-vault-copy">📋 Copy</button><button class="vault-mini-btn btn-vault-download">💾 Tải về</button></div></div><div class="vault-card-preview">${escapeHtml(b.code.slice(0, 220))}${b.code.length > 220 ? '...' : ''}</div></div>`).join('')}</div>`;
    document.getElementById('vault-btn-close').addEventListener('click', toggleCodeVault);
    drawer.querySelectorAll('.btn-vault-copy').forEach((btn, idx) => btn.addEventListener('click', async () => {
      const item = blocks[idx];
      if (item) {
        await navigator.clipboard.writeText(item.code);
        showStatusPill(`📋 Đã sao chép code ${item.label}!`);
      }
    }));
    drawer.querySelectorAll('.btn-vault-download').forEach((btn, idx) => btn.addEventListener('click', () => {
      const item = blocks[idx];
      if (item) downloadCodeFile(item);
    }));
  }

  function toggleCodeVault() {
    codeVaultOpen = !codeVaultOpen;
    const drawer = document.getElementById('tabflow-vault-drawer');
    if (!drawer) {
      renderVaultDrawer();
      setTimeout(toggleCodeVault, 50);
      return;
    }
    if (codeVaultOpen) {
      renderVaultDrawer();
      drawer.classList.add('open');
    } else drawer.classList.remove('open');
  }

  function downloadCodeFile(item) {
    const extMap = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css', sql: 'sql', json: 'json', go: 'go', rust: 'rs', cpp: 'cpp', c: 'c', bash: 'sh', shell: 'sh' };
    const filename = `code-${item.id}.${extMap[item.lang.toLowerCase()] || 'txt'}`;
    const blob = new Blob([item.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showStatusPill(`💾 Đã tải file ${filename}`);
  }

  function renderHud() {
    if (document.getElementById('tabflow-hud')) return;
    const hud = document.createElement('div');
    hud.id = 'tabflow-hud';
    hud.innerHTML = `
      <div id="hud-meter-badge" class="hud-item hud-meter green"><span>⚡</span> <span id="hud-meter-text">0% Context</span></div>
      <button id="hud-btn-rollover" class="hud-btn primary"><span>🔄</span> Tiếp nối Chat mới</button>
      <button id="hud-btn-vault" class="hud-btn"><span>📦</span> Code Vault</button>`;
    document.body.appendChild(hud);
    document.getElementById('hud-btn-rollover').addEventListener('click', triggerSmartRollover);
    document.getElementById('hud-btn-vault').addEventListener('click', toggleCodeVault);
    updateHudMeter();
  }

  function updateHudMeter() {
    const meterEl = document.getElementById('hud-meter-badge');
    const meterText = document.getElementById('hud-meter-text');
    if (!meterEl || !meterText) return;
    const stats = getConversationStats();
    const tokenStr = stats.tokens >= 1000 ? `${(stats.tokens / 1000).toFixed(1)}k` : stats.tokens;
    meterText.textContent = `${tokenStr} / 32k tokens (${stats.turns} tin - ${stats.pct}%)`;
    meterEl.classList.remove('green', 'yellow', 'red');
    if (stats.pct < 50) meterEl.classList.add('green');
    else if (stats.pct < 80) meterEl.classList.add('yellow');
    else {
      meterEl.classList.add('red');
      meterText.textContent = `⚠️ ${tokenStr} / 32k (${stats.pct}%) - Hãy chuyển chat!`;
    }
  }

  function showStatusPill(msg) {
    let pill = document.getElementById('tabflow-status-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'tabflow-status-pill';
      pill.innerHTML = '<span class="dot"></span><span id="tabflow-status-text"></span>';
      document.body.appendChild(pill);
    }
    document.getElementById('tabflow-status-text').textContent = msg;
    pill.classList.add('visible');
    setTimeout(() => pill.classList.remove('visible'), 3200);
  }

  function initTypingShield() {
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (target && (target.id === 'prompt-textarea' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (!document.body.classList.contains('tabflow-typing-active')) document.body.classList.add('tabflow-typing-active');
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => document.body.classList.remove('tabflow-typing-active'), 400);
      }
    }, { passive: true });
  }

  function applyCodeFolding() {
    if (runtimeMode !== 'interactive') return;
    const turnEls = getTurnElements();
    if (turnEls.length <= 2) return;
    const pres = document.querySelectorAll('pre');
    let newlyFolded = 0;
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      if (pre.classList.contains('tabflow-fold-checked')) continue;
      pre.classList.add('tabflow-fold-checked');
      const lines = (pre.textContent || '').split('\n').length;
      if (lines <= 16) continue;

      // Never insert controls next to React-owned <pre> nodes. Structural child
      // mutations can confuse React reconciliation. A native Alt+click listener
      // plus an extension class keeps folding outside React's child tree.
      pre.classList.add('tabflow-folded');
      pre.dataset.tabflowFoldLines = String(lines);
      pre.addEventListener('click', event => {
        if (!event.altKey) return;
        event.preventDefault();
        const folded = pre.classList.toggle('tabflow-folded');
        showStatusPill(folded
          ? `👇 Đã thu gọn code (${lines} dòng)`
          : `👆 Đã mở code (${lines} dòng)`);
      });
      newlyFolded += 1;
    }

    if (newlyFolded > 0 && !foldHintShown) {
      foldHintShown = true;
      showStatusPill('💡 Alt+click block code dài để mở/thu gọn');
    }
  }

  function checkAutoContinue() {
    if (runtimeMode === 'eco' || runtimeMode === 'strained') return;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('tabflow_auto_continue') === 'false') return;
    } catch {}
    const now = Date.now();
    if (now - lastAutoContinueTime < 8000) return;
    const continueBtn = document.querySelector('button[data-testid*="continue"], button[data-testid*="fruitjuice"]');
    if (continueBtn) {
      lastAutoContinueTime = now;
      setTimeout(() => {
        if (continueBtn.isConnected) {
          continueBtn.click();
          showStatusPill('⚡ Tự động tiếp tục tạo...');
        }
      }, 1200);
      return;
    }
    const allButtons = document.getElementsByTagName('button');
    for (let i = 0; i < allButtons.length; i++) {
      const b = allButtons[i];
      const text = b.textContent || '';
      if (text.includes('Continue generating') || text.includes('Tiếp tục tạo')) {
        lastAutoContinueTime = now;
        setTimeout(() => {
          if (b.isConnected) {
            b.click();
            showStatusPill('⚡ Tự động tiếp tục tạo...');
          }
        }, 1200);
        break;
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function maintenanceDelay() {
    if (runtimeMode === 'interactive') return 5000;
    if (runtimeMode === 'producer') return 9000;
    if (runtimeMode === 'strained') return 18000;
    return 30000;
  }

  function scheduleMaintenance() {
    if (maintenanceTimer) clearTimeout(maintenanceTimer);
    maintenanceTimer = setTimeout(() => {
      const runner = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
      runner(() => {
        if (runtimeMode === 'interactive') {
          updateHudMeter();
          applyCodeFolding();
          checkAutoContinue();
        } else if (runtimeMode === 'producer') {
          checkAutoContinue();
        }
        scheduleMaintenance();
      }, { timeout: 1500 });
    }, maintenanceDelay());
  }

  function init() {
    renderHud();
    initTypingShield();
    checkPendingRollover();
    scheduleMaintenance();
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init, { once: true });
})();
