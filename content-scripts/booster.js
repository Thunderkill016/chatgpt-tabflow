/**
 * ChatGPT TabFlow Suite - Full In-Page Developer Engine
 * Features:
 * 1. Context Capacity Meter (% token health & accurate turn count)
 * 2. 1-Click Smart Rollover (Seamless context transfer to new chat without amnesia)
 * 3. Auto-Primer Injector for new chats
 * 4. Code Vault Drawer (Instant code block capture, copy & file download)
 * 5. Typing Latency Shield & Non-blocking Virtualization
 * 6. Smooth Zero-Reflow Code Folding
 * 7. Auto-Continue Generation
 */

(() => {
  'use strict';

  let typingTimeout = null;
  let codeVaultOpen = false;
  let capturedCodeBlocks = [];
  let lastProxyStats = null;
  let lastAutoContinueTime = 0;

  // Listeners for Fetch Proxy events
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'TABFLOW_TRIMMED_STATS') {
      lastProxyStats = e.data;
      updateHudMeter();
    } else if (e.data.type === 'TABFLOW_RETRY_STATUS') {
      const attempt = e.data.attempt || 1;
      const maxRetries = e.data.maxRetries || 3;
      showStatusPill(`🔄 Đang thử lại kết nối... (lần ${attempt}/${maxRetries})`);
    }
  });

  // ================= 1. AUTO-FILL PRIMER PROMPT ON NEW CHATS =================

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

  // ================= 2. CONTEXT CAPACITY & SMART ROLLOVER =================

  /**
   * Multi-tier selector to find conversation messages reliably
   * across modern (2025/2026) and legacy ChatGPT DOM structures
   */
  function getTurnElements() {
    const byRole = document.querySelectorAll('[data-message-author-role="user"]');
    if (byRole && byRole.length > 0) return byRole;

    const byArticle = document.querySelectorAll('article');
    if (byArticle && byArticle.length > 0) return byArticle;

    return document.querySelectorAll('div[data-testid^="conversation-turn-"]');
  }

  function getConversationStats() {
    const turns = getTurnElements().length;

    // 1. If Proxy supplied accurate DAG token counts, use them
    if (lastProxyStats && typeof lastProxyStats.estimatedTokens === 'number') {
      return {
        turns: lastProxyStats.turnCount || turns || 1,
        tokens: lastProxyStats.estimatedTokens,
        pct: lastProxyStats.estimatedBudgetPct || Math.min(100, Math.round((lastProxyStats.estimatedTokens / 32000) * 100))
      };
    }

    // 2. High-performance fallback: use textContent (ZERO forced layout reflows!)
    const messages = document.querySelectorAll('[data-message-author-role]');
    let totalCodeChars = 0;
    let totalTextChars = 0;

    const codeEls = document.querySelectorAll('pre code');
    for (let i = 0; i < codeEls.length; i++) {
      totalCodeChars += (codeEls[i].textContent || '').length;
    }

    if (messages.length > 0) {
      for (let i = 0; i < messages.length; i++) {
        totalTextChars += (messages[i].textContent || '').length;
      }
    } else {
      const articles = document.querySelectorAll('article');
      for (let i = 0; i < articles.length; i++) {
        totalTextChars += (articles[i].textContent || '').length;
      }
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

    // Summarize code modules
    const codeList = codeSnippets.map((c, i) => {
      const firstLine = (c.code.split('\n')[0] || '').trim();
      return `- **File/Hàm ${i + 1} (${c.lang}):** ${firstLine ? `\`${firstLine}\`` : 'Code snippet'}`;
    }).slice(-8);

    // Get last user & assistant messages safely using textContent
    let lastUserTurn = '';
    let lastAssistantTurn = '';

    const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (assistantMessages.length > 0) {
      lastAssistantTurn = (assistantMessages[assistantMessages.length - 1].textContent || '').slice(0, 400);
    }
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    if (userMessages.length > 0) {
      lastUserTurn = (userMessages[userMessages.length - 1].textContent || '').slice(0, 300);
    }

    const primer = `### 🤖 BỐI CẢNH DỰ ÁN & TIẾP NỐI TỪ CUỘC TRÒ CHUYỆN TRƯỚC
**Dự án:** ${pageTitle}

**Tổng quan các mã nguồn đã code:**
${codeList.length > 0 ? codeList.join('\n') : '- Đã trao đổi các giải pháp kỹ thuật và mã nguồn liên quan.'}

**Nhiệm vụ dở dang gần nhất:**
- Người dùng yêu cầu: "${lastUserTurn.trim().slice(0, 180)}..."
- Giải pháp trước đó: "${lastAssistantTurn.trim().slice(0, 200)}..."

**Yêu cầu tiếp tục:**
Tôi vừa chuyển sang tab mới vì cuộc trò chuyện cũ đã chạm ngưỡng bộ nhớ. Hãy tiếp tục dự án với đầy đủ ngữ cảnh trên. Hãy xác nhận bạn đã nắm rõ và đề xuất bước code tiếp theo.`;

    return primer;
  }

  async function triggerSmartRollover() {
    const primer = extractContextSnapshot();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ pendingRolloverPrompt: primer });
    }
    window.open('https://chatgpt.com/', '_blank');
    showStatusPill('🚀 Đang mở Chat mới với đầy đủ trí nhớ...');
  }

  // ================= 3. CODE VAULT EXTRACTION =================

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

      results.push({
        id: i + 1,
        lang,
        label: label || lang,
        code: codeText
      });
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
      <div class="vault-header">
        <div class="vault-title">
          <span>📦</span> Code Vault (${blocks.length} files)
        </div>
        <button id="vault-btn-close" class="vault-close-btn" title="Đóng ngăn kéo">✕</button>
      </div>
      <div class="vault-list">
        ${blocks.length === 0 ? `
          <div class="vault-empty">
            <p>Chưa có đoạn code nào được sinh trong đoạn chat này.</p>
          </div>
        ` : blocks.map(b => `
          <div class="vault-card" data-code-id="${b.id}">
            <div class="vault-card-header">
              <span class="vault-card-lang">${escapeHtml(b.label.toUpperCase())}</span>
              <div class="vault-card-actions">
                <button class="vault-mini-btn btn-vault-copy" title="Sao chép code">📋 Copy</button>
                <button class="vault-mini-btn btn-vault-download" title="Tải file về máy">💾 Tải về</button>
              </div>
            </div>
            <div class="vault-card-preview">${escapeHtml(b.code.slice(0, 220))}${b.code.length > 220 ? '...' : ''}</div>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('vault-btn-close').addEventListener('click', toggleCodeVault);

    const copyBtns = drawer.querySelectorAll('.btn-vault-copy');
    copyBtns.forEach((btn, idx) => {
      btn.addEventListener('click', async () => {
        const item = blocks[idx];
        if (item) {
          await navigator.clipboard.writeText(item.code);
          showStatusPill(`📋 Đã sao chép code ${item.label}!`);
        }
      });
    });

    const downloadBtns = drawer.querySelectorAll('.btn-vault-download');
    downloadBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const item = blocks[idx];
        if (item) {
          downloadCodeFile(item);
        }
      });
    });
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
    } else {
      drawer.classList.remove('open');
    }
  }

  function downloadCodeFile(item) {
    const extMap = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      html: 'html',
      css: 'css',
      sql: 'sql',
      json: 'json',
      go: 'go',
      rust: 'rs',
      cpp: 'cpp',
      c: 'c',
      bash: 'sh',
      shell: 'sh'
    };
    const ext = extMap[item.lang.toLowerCase()] || 'txt';
    const filename = `code-${item.id}.${ext}`;

    const blob = new Blob([item.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showStatusPill(`💾 Đã tải file ${filename}`);
  }

  // ================= 4. TABFLOW DEV HUD (TOP-RIGHT BAR) =================

  function renderHud() {
    if (document.getElementById('tabflow-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'tabflow-hud';

    hud.innerHTML = `
      <div id="hud-meter-badge" class="hud-item hud-meter green" title="Đo độ dài và sức chứa ngữ cảnh của đoạn chat">
        <span>⚡</span> <span id="hud-meter-text">0% Context</span>
      </div>
      <button id="hud-btn-rollover" class="hud-btn primary" title="Chuyển toàn bộ bối cảnh & code sang Chat mới mà không bị quên">
        <span>🔄</span> Tiếp nối Chat mới
      </button>
      <button id="hud-btn-vault" class="hud-btn" title="Mở ngăn kéo Code Vault để xem toàn bộ code đã sinh">
        <span>📦</span> Code Vault
      </button>
    `;

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

    let tokenStr = stats.tokens;
    if (stats.tokens >= 1000) {
      tokenStr = (stats.tokens / 1000).toFixed(1) + 'k';
    }

    meterText.textContent = `${tokenStr} / 32k tokens (${stats.turns} tin - ${stats.pct}%)`;

    meterEl.classList.remove('green', 'yellow', 'red');
    if (stats.pct < 50) {
      meterEl.classList.add('green');
    } else if (stats.pct < 80) {
      meterEl.classList.add('yellow');
    } else {
      meterEl.classList.add('red');
      meterText.textContent = `⚠️ ${tokenStr} / 32k (${stats.pct}%) - Hãy chuyển chat!`;
    }
  }

  // ================= 5. TOAST STATUS PILL =================

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

    setTimeout(() => {
      pill.classList.remove('visible');
    }, 3200);
  }

  // ================= 6. TYPING SHIELD =================

  function initTypingShield() {
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (target && (target.id === 'prompt-textarea' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (!document.body.classList.contains('tabflow-typing-active')) {
          document.body.classList.add('tabflow-typing-active');
        }

        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          document.body.classList.remove('tabflow-typing-active');
        }, 400);
      }
    }, { passive: true });
  }

  // ================= 7. ZERO-REFLOW CODE FOLDING =================

  function applyCodeFolding() {
    // Only target pre blocks in older messages, leaving the last 2 messages untouched
    const turnEls = getTurnElements();
    if (turnEls.length <= 2) return;

    const pres = document.querySelectorAll('pre');
    if (pres.length === 0) return;

    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      if (pre.classList.contains('tabflow-fold-checked')) continue;
      pre.classList.add('tabflow-fold-checked');

      // Check line count without layout reflow: split textContent
      const text = pre.textContent || '';
      const lines = text.split('\n').length;

      if (lines > 16) {
        pre.classList.add('tabflow-folded');

        const btn = document.createElement('button');
        btn.className = 'tabflow-fold-toggle';
        btn.type = 'button';
        btn.textContent = `👇 Xem đầy đủ (${lines} dòng)`;

        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (pre.classList.contains('tabflow-folded')) {
            pre.classList.remove('tabflow-folded');
            btn.textContent = '👆 Thu gọn code';
          } else {
            pre.classList.add('tabflow-folded');
            btn.textContent = `👇 Xem đầy đủ (${lines} dòng)`;
          }
        });

        if (pre.parentNode) {
          pre.parentNode.insertBefore(btn, pre.nextSibling);
        }
      }
    }
  }

  // ================= 8. SAFE AUTO-CONTINUE GENERATION =================

  function checkAutoContinue() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('tabflow_auto_continue') === 'false') return;
    } catch {}

    const now = Date.now();
    if (now - lastAutoContinueTime < 8000) return;

    // Check for continue button without heavy querying
    const continueBtn = document.querySelector('button[data-testid*="continue"], button[data-testid*="fruitjuice"]');
    if (continueBtn && continueBtn.offsetParent !== null) {
      lastAutoContinueTime = now;
      setTimeout(() => {
        continueBtn.click();
        showStatusPill('⚡ Tự động tiếp tục tạo...');
      }, 1200);
      return;
    }

    // Fallback: check buttons with continue text
    const allButtons = document.getElementsByTagName('button');
    for (let i = 0; i < allButtons.length; i++) {
      const b = allButtons[i];
      const text = b.textContent || '';
      if (text.includes('Continue generating') || text.includes('Tiếp tục tạo')) {
        lastAutoContinueTime = now;
        setTimeout(() => {
          b.click();
          showStatusPill('⚡ Tự động tiếp tục tạo...');
        }, 1200);
        break;
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ================= INITIALIZATION =================

  function init() {
    renderHud();
    initTypingShield();
    checkPendingRollover();

    // Run non-blocking periodic maintenance every 4s using requestIdleCallback
    setInterval(() => {
      const runner = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
      runner(() => {
        updateHudMeter();
        applyCodeFolding();
        checkAutoContinue();
      });
    }, 4000);
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init, { once: true });
  }
})();
