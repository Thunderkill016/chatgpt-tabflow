(() => {
  'use strict';

  if (window.__tabflowMemoryClientInstalled) return;
  window.__tabflowMemoryClientInstalled = true;

  const PORT_NAME = 'TABFLOW_MEMORY_CLIENT';
  const QUERY_DEBOUNCE_MS = 320;
  const INGEST_DEBOUNCE_MS = 1100;
  const PREPARED_MAX_AGE_MS = 45000;
  const MAX_PROMPT_CHARS = 24000;
  const MAX_MESSAGE_CHARS = 180000;

  let binding = null;
  let prepared = null;
  let queryTimer = null;
  let ingestTimer = null;
  let lastPromptFingerprint = '';
  let syntheticMessageSequence = 0;
  let rpcPort = null;
  let rpcSeq = 0;
  const pendingRpc = new Map();
  const syntheticMessageIds = new WeakMap();
  const lastIngestedFingerprint = new Map();

  function fnv1a(input) {
    const value = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function rejectPending(error) {
    for (const entry of pendingRpc.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pendingRpc.clear();
  }

  function connectRpc() {
    if (rpcPort) return rpcPort;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    rpcPort = port;
    port.onMessage.addListener(message => {
      const { requestId, ok, result, error } = message || {};
      const entry = pendingRpc.get(requestId);
      if (!entry) return;
      pendingRpc.delete(requestId);
      clearTimeout(entry.timer);
      if (ok) entry.resolve(result);
      else {
        const err = new Error(error?.message || 'TabFlow memory RPC failed');
        err.name = error?.name || 'MemoryRpcError';
        if (error?.code) err.code = error.code;
        entry.reject(err);
      }
    });
    port.onDisconnect.addListener(() => {
      if (rpcPort === port) rpcPort = null;
      rejectPending(new Error('TabFlow memory background disconnected'));
    });
    return port;
  }

  function rpc(type, payload = {}, timeoutMs = 60000) {
    const port = connectRpc();
    rpcSeq = (rpcSeq + 1) % Number.MAX_SAFE_INTEGER;
    const requestId = `client-${Date.now()}-${rpcSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpc.delete(requestId);
        reject(new Error(`TabFlow memory RPC timeout: ${type}`));
      }, timeoutMs);
      pendingRpc.set(requestId, { resolve, reject, timer });
      try {
        port.postMessage({ requestId, type, payload });
      } catch (error) {
        clearTimeout(timer);
        pendingRpc.delete(requestId);
        reject(error);
      }
    });
  }

  function getConversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)/);
    return match?.[1] || `new:${location.pathname}`;
  }

  function getConversation() {
    return {
      id: getConversationId(),
      title: (document.title || 'ChatGPT Conversation').replace(/\s+-\s+ChatGPT$/i, '').slice(0, 500),
      url: location.href,
      observedAt: Date.now()
    };
  }

  function isPromptEditor(node) {
    if (!(node instanceof Element)) return false;
    return node.id === 'prompt-textarea' ||
      node.matches('textarea') ||
      (node.getAttribute('contenteditable') === 'true' && Boolean(node.closest('form')));
  }

  function getPromptEditor() {
    const direct = document.getElementById('prompt-textarea');
    if (direct) return direct;
    return document.querySelector('form textarea, form [contenteditable="true"]');
  }

  function readEditorText(editor = getPromptEditor()) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value || '';
    return editor.textContent || '';
  }

  function isSendButton(target) {
    if (!(target instanceof Element)) return false;
    const button = target.closest('button');
    if (!button) return false;
    const testId = button.getAttribute('data-testid') || '';
    const aria = button.getAttribute('aria-label') || '';
    return /send/i.test(testId) || /send|gửi/i.test(aria);
  }

  function createStatusUi() {
    if (document.getElementById('tabflow-memory-status-host')) return;
    const host = document.createElement('div');
    host.id = 'tabflow-memory-status-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:74px;z-index:2147483646;pointer-events:none';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .pill{display:flex;align-items:center;gap:7px;max-width:380px;padding:6px 10px;border:1px solid rgba(148,163,184,.35);border-radius:999px;background:rgba(15,23,42,.92);box-shadow:0 4px 18px rgba(0,0,0,.28);color:#cbd5e1;font:600 11px/1.2 system-ui,-apple-system,sans-serif;opacity:.94}
        .dot{width:7px;height:7px;border-radius:50%;background:#64748b;flex:0 0 auto}.pill.ready .dot{background:#22c55e}.pill.busy .dot{background:#eab308}.pill.off .dot{background:#ef4444}.text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      </style>
      <div class="pill off" id="pill"><span class="dot"></span><span class="text" id="text">Memory: chưa gắn project</span></div>
    `;
    document.documentElement.appendChild(host);
  }

  function setStatus(text, state = 'off') {
    createStatusUi();
    const host = document.getElementById('tabflow-memory-status-host');
    const pill = host?.shadowRoot?.getElementById('pill');
    const label = host?.shadowRoot?.getElementById('text');
    if (!pill || !label) return;
    label.textContent = text;
    pill.className = `pill ${state}`;
  }

  async function refreshBinding() {
    try {
      binding = await rpc('GET_BINDING', { conversation: getConversation() });
      if (binding?.projectId) {
        const name = binding.project?.name || binding.projectId;
        setStatus(`🧠 ${name}`, 'ready');
        scheduleIngest();
        scheduleQuery();
      } else {
        prepared = null;
        setStatus('Memory: chưa gắn project', 'off');
      }
    } catch (error) {
      binding = null;
      prepared = null;
      setStatus('Memory: service unavailable', 'off');
      console.warn('[TabFlow Memory] Binding check failed:', error);
    }
  }

  async function prepareRag(prompt) {
    if (!binding?.projectId) return;
    const clean = String(prompt || '').trim().slice(0, MAX_PROMPT_CHARS);
    if (clean.length < 8) {
      prepared = null;
      setStatus(`🧠 ${binding.project?.name || binding.projectId}`, 'ready');
      return;
    }

    const fingerprint = fnv1a(clean);
    lastPromptFingerprint = fingerprint;
    setStatus('Memory: đang tìm context…', 'busy');
    try {
      const result = await rpc('QUERY_RAG', {
        query: clean,
        maxTokens: 4200,
        conversation: getConversation()
      });
      if (lastPromptFingerprint !== fingerprint) return;
      if (!result?.context) {
        prepared = null;
        setStatus('Memory: chưa có context phù hợp', 'ready');
        return;
      }
      prepared = {
        fingerprint,
        prompt: clean,
        context: result.context,
        estimatedTokens: result.estimatedTokens || 0,
        citations: result.citations || [],
        preparedAt: Date.now()
      };
      // Publish as soon as retrieval completes. Fingerprint matching in MAIN world
      // prevents stale context injection, while avoiding a race with ChatGPT's send handler.
      window.postMessage({
        type: 'TABFLOW_RAG_PREPARED',
        fingerprint: prepared.fingerprint,
        context: prepared.context,
        estimatedTokens: prepared.estimatedTokens,
        projectId: binding.projectId,
        expiresAt: Date.now() + PREPARED_MAX_AGE_MS
      }, location.origin);
      setStatus(`🧠 RAG ready +~${prepared.estimatedTokens} tokens · ${prepared.citations.length} refs`, 'ready');
    } catch (error) {
      prepared = null;
      setStatus('Memory: query lỗi', 'off');
      console.warn('[TabFlow Memory] RAG query failed:', error);
    }
  }

  function scheduleQuery() {
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => prepareRag(readEditorText()), QUERY_DEBOUNCE_MS);
  }

  function publishPreparedContextForTrustedSend() {
    if (!prepared || !binding?.projectId) return;
    if (Date.now() - prepared.preparedAt > PREPARED_MAX_AGE_MS) return;
    const prompt = readEditorText().trim().slice(0, MAX_PROMPT_CHARS);
    const fingerprint = fnv1a(prompt);
    if (!prompt || fingerprint !== prepared.fingerprint) return;

    window.postMessage({
      type: 'TABFLOW_RAG_PREPARED',
      fingerprint,
      context: prepared.context,
      estimatedTokens: prepared.estimatedTokens,
      projectId: binding.projectId,
      expiresAt: Date.now() + 5000
    }, location.origin);
  }

  function stableMessageId(messageEl, role) {
    const direct = messageEl.getAttribute('data-message-id');
    if (direct) return direct;
    const turn = messageEl.closest('[data-testid^="conversation-turn-"]') || messageEl.querySelector('[data-testid^="conversation-turn-"]');
    const testId = turn?.getAttribute('data-testid');
    if (testId) return `${getConversationId()}:${testId}:${role}`;
    if (!syntheticMessageIds.has(messageEl)) {
      syntheticMessageSequence += 1;
      syntheticMessageIds.set(messageEl, `${getConversationId()}:dom:${role}:${syntheticMessageSequence}`);
    }
    return syntheticMessageIds.get(messageEl);
  }

  function codeLanguage(codeEl) {
    for (const cls of codeEl.classList) {
      if (cls.startsWith('language-')) return cls.slice('language-'.length).toLowerCase();
    }
    return 'code';
  }

  function codeLabel(pre, language) {
    const container = pre?.parentElement;
    const candidate = container?.querySelector(':scope > div:first-child span, :scope > div:first-child')?.textContent?.trim();
    if (candidate && candidate.length <= 240) return candidate;
    return language;
  }

  function inferPath(code, label) {
    const candidates = [label, ...String(code || '').split(/\r?\n/).slice(0, 4)];
    for (const raw of candidates) {
      const cleaned = String(raw || '')
        .replace(/^\s*(?:\/\/|#|--|\/\*+|\*|<!--)\s*/, '')
        .replace(/(?:\*\/|-->)\s*$/, '')
        .replace(/^file\s*:\s*/i, '')
        .trim();
      const match = cleaned.match(/(?:^|\s|[`'"(])((?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_.@+-]+\.[A-Za-z0-9]{1,10})(?:$|\s|[`'"),:])/);
      if (match?.[1]) return match[1].replaceAll('\\', '/').replace(/^\/+/, '');
    }
    return '';
  }

  function extractMessagePayload(messageEl) {
    const role = messageEl.getAttribute('data-message-author-role');
    if (role !== 'user' && role !== 'assistant') return null;
    const fullText = messageEl.textContent || '';
    if (fullText.trim().length < 2) return null;

    const codeBlocks = [];
    const codeEls = messageEl.querySelectorAll('pre code');
    let prose = fullText;
    for (let i = 0; i < codeEls.length && codeBlocks.length < 60; i += 1) {
      const codeEl = codeEls[i];
      const pre = codeEl.closest('pre');
      const code = codeEl.textContent || '';
      if (code.trim().length < 4) continue;
      const language = codeLanguage(codeEl);
      const label = codeLabel(pre, language);
      const clipped = code.slice(0, 500000);
      codeBlocks.push({ language, label, path: inferPath(clipped, label), code: clipped });
      if (clipped.length < prose.length) prose = prose.replace(clipped, ' ');
    }

    const messageId = stableMessageId(messageEl, role);
    const fingerprint = fnv1a(`${role}\0${fullText}`);
    return {
      role,
      messageId,
      text: prose.slice(0, MAX_MESSAGE_CHARS),
      codeBlocks,
      fingerprint,
      observedAt: Date.now()
    };
  }

  async function ingestRenderedMessages() {
    if (!binding?.projectId) return;
    const messages = document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]');
    const start = Math.max(0, messages.length - 50);
    for (let i = start; i < messages.length; i += 1) {
      const payload = extractMessagePayload(messages[i]);
      if (!payload) continue;
      if (lastIngestedFingerprint.get(payload.messageId) === payload.fingerprint) continue;
      lastIngestedFingerprint.set(payload.messageId, payload.fingerprint);
      try {
        await rpc('INGEST_MESSAGE', {
          conversation: getConversation(),
          role: payload.role,
          messageId: payload.messageId,
          text: payload.text,
          codeBlocks: payload.codeBlocks,
          observedAt: payload.observedAt
        });
      } catch (error) {
        console.warn('[TabFlow Memory] Ingest failed:', error);
      }
    }
  }

  function scheduleIngest(immediate = false) {
    if (!binding?.projectId) return;
    if (ingestTimer) clearTimeout(ingestTimer);
    ingestTimer = setTimeout(() => {
      const runner = window.requestIdleCallback || ((callback) => setTimeout(callback, 0));
      runner(() => ingestRenderedMessages(), { timeout: 1800 });
    }, immediate ? 0 : INGEST_DEBOUNCE_MS);
  }

  async function ingestArchiveBatch(data) {
    if (!binding?.projectId || !Array.isArray(data.messages) || data.messages.length === 0) return;
    try {
      await rpc('INGEST_ARCHIVE', {
        conversation: {
          id: data.conversationId || getConversationId(),
          title: data.title || getConversation().title,
          url: location.href,
          observedAt: Date.now()
        },
        messages: data.messages.slice(0, 120),
        observedAt: Date.now()
      });
    } catch (error) {
      console.warn('[TabFlow Memory] Archive ingest failed:', error);
    }
  }

  document.addEventListener('input', event => {
    if (isPromptEditor(event.target)) scheduleQuery();
  }, true);

  document.addEventListener('keydown', event => {
    if (!event.isTrusted || event.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    if (!isPromptEditor(event.target)) return;
    publishPreparedContextForTrustedSend();
  }, true);

  document.addEventListener('click', event => {
    if (!event.isTrusted || !isSendButton(event.target)) return;
    publishPreparedContextForTrustedSend();
  }, true);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || !event.data?.type) return;
    if (event.data.type === 'TABFLOW_ARCHIVE_BATCH') ingestArchiveBatch(event.data);
  });

  const observer = new MutationObserver(() => scheduleIngest());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TABFLOW_MEMORY_FORCE_SYNC') {
      scheduleIngest(true);
      scheduleQuery();
      sendResponse({ success: true });
      return undefined;
    }
    if (message?.type === 'TABFLOW_MEMORY_CLIENT_STATUS') {
      sendResponse({
        success: true,
        binding: binding ? { projectId: binding.projectId, project: binding.project || null } : null,
        conversation: getConversation(),
        prepared: prepared ? {
          estimatedTokens: prepared.estimatedTokens,
          citationCount: prepared.citations.length,
          citations: prepared.citations.slice(0, 12),
          ageMs: Date.now() - prepared.preparedAt
        } : null
      });
      return undefined;
    }
    return undefined;
  });

  createStatusUi();
  refreshBinding();
})();
