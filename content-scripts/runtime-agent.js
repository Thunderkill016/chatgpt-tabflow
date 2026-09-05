(() => {
  'use strict';

  if (window.__tabflowRuntimeAgentInstalled) return;
  window.__tabflowRuntimeAgentInstalled = true;

  const PORT_NAME = 'TABFLOW_RUNTIME_CLIENT';
  const GENERATION_POLL_MS = 900;
  const GENERATION_MAX_MS = 10 * 60 * 1000;
  const GENERATION_START_GRACE_MS = 6500;
  const GENERATION_FINISH_MISSES = 4;
  const TYPING_GRACE_MS = 1100;
  const HEARTBEAT_MS = 15000;

  let port = null;
  let state = 'idle';
  let executionMode = 'interactive';
  let typingTimer = null;
  let generationTimer = null;
  let generationStartedAt = 0;
  let generationObserved = false;
  let generationStableMisses = 0;
  let lastStatusFingerprint = '';

  function getConversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)/);
    return match?.[1] || `new:${location.pathname}`;
  }

  function heapUsed() {
    try {
      return Number(performance?.memory?.usedJSHeapSize || 0);
    } catch {
      return 0;
    }
  }

  function payload(extra = {}) {
    return {
      title: document.title || 'ChatGPT',
      url: location.href,
      conversationId: getConversationId(),
      state,
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      heapUsed: heapUsed(),
      lastActivityAt: Date.now(),
      ...extra
    };
  }

  function connect() {
    if (port) return port;
    try {
      const current = chrome.runtime.connect({ name: PORT_NAME });
      port = current;
      current.onMessage.addListener(message => {
        if (message?.type !== 'RUNTIME_MODE') return;
        executionMode = message.mode || 'interactive';
        document.documentElement.dataset.tabflowRuntimeMode = executionMode;
        window.dispatchEvent(new CustomEvent('tabflow:runtime-mode', { detail: message }));
      });
      current.onDisconnect.addListener(() => {
        if (port === current) port = null;
      });
      current.postMessage({ type: 'HELLO', payload: payload() });
      return current;
    } catch {
      return null;
    }
  }

  function send(type = 'STATUS', extra = {}, force = false) {
    const data = payload(extra);
    const fingerprint = `${data.state}|${data.visible}|${data.focused}|${data.conversationId}|${data.title}`;
    if (!force && type === 'STATUS' && fingerprint === lastStatusFingerprint) return;
    lastStatusFingerprint = fingerprint;
    const current = connect();
    if (!current) return;
    try {
      current.postMessage({ type, payload: data });
    } catch {}
  }

  function setState(next, extra = {}, force = false) {
    if (state === next && !force) return;
    state = next;
    send('STATUS', extra, true);
  }

  function isPromptEditor(node) {
    if (!(node instanceof Element)) return false;
    return node.id === 'prompt-textarea' ||
      node.matches('textarea') ||
      (node.getAttribute('contenteditable') === 'true' && Boolean(node.closest('form')));
  }

  function isSendButton(target) {
    if (!(target instanceof Element)) return false;
    const button = target.closest('button');
    if (!button) return false;
    const testId = button.getAttribute('data-testid') || '';
    const aria = button.getAttribute('aria-label') || '';
    return /send|composer-submit/i.test(testId) || /send|gửi/i.test(aria);
  }

  function hasGenerationControl() {
    return Boolean(document.querySelector(
      'button[data-testid*="stop"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
    ));
  }

  function finishGeneration() {
    generationTimer = null;
    generationObserved = false;
    generationStableMisses = 0;
    setState(document.hasFocus() ? 'interactive' : 'idle', { protectUntil: 0 }, true);
  }

  function generationPoll() {
    if (state !== 'generating') return;

    const elapsed = Date.now() - generationStartedAt;
    if (elapsed > GENERATION_MAX_MS) {
      finishGeneration();
      return;
    }

    if (hasGenerationControl()) {
      generationObserved = true;
      generationStableMisses = 0;
      generationTimer = setTimeout(generationPoll, GENERATION_POLL_MS);
      return;
    }

    // Sau khi submit, nút Stop của ChatGPT có thể xuất hiện chậm vài giây.
    // Không kết luận generation đã xong trong grace window này.
    if (!generationObserved && elapsed < GENERATION_START_GRACE_MS) {
      generationTimer = setTimeout(generationPoll, GENERATION_POLL_MS);
      return;
    }

    generationStableMisses += 1;
    if (generationStableMisses >= GENERATION_FINISH_MISSES) {
      finishGeneration();
      return;
    }

    generationTimer = setTimeout(generationPoll, GENERATION_POLL_MS);
  }

  function markSubmitIntent() {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }

    state = 'generating';
    generationStartedAt = Date.now();
    generationObserved = false;
    generationStableMisses = 0;
    send('SUBMIT_INTENT', { protectUntil: Date.now() + 45000 }, true);

    if (generationTimer) clearTimeout(generationTimer);
    generationTimer = setTimeout(generationPoll, 700);
  }

  document.addEventListener('input', event => {
    if (!isPromptEditor(event.target)) return;
    if (state !== 'generating') setState('typing', {}, true);
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingTimer = null;
      if (state === 'typing') setState(document.hasFocus() ? 'interactive' : 'idle', { protectUntil: 0 }, true);
    }, TYPING_GRACE_MS);
  }, true);

  document.addEventListener('keydown', event => {
    if (!event.isTrusted || event.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    if (isPromptEditor(event.target)) markSubmitIntent();
  }, true);

  document.addEventListener('click', event => {
    if (event.isTrusted && isSendButton(event.target)) markSubmitIntent();
  }, true);

  document.addEventListener('visibilitychange', () => {
    send('STATUS', {}, true);
  }, true);

  window.addEventListener('focus', () => {
    if (state === 'idle') state = 'interactive';
    send('STATUS', {}, true);
  }, true);

  window.addEventListener('blur', () => {
    if (state === 'interactive') state = 'idle';
    send('STATUS', {}, true);
  }, true);

  window.addEventListener('pageshow', () => send('STATUS', {}, true), true);
  window.addEventListener('pagehide', () => send('STATUS', {}, true), true);

  state = document.hasFocus() ? 'interactive' : 'idle';
  connect();
  send('STATUS', {}, true);

  // Productive tabs heartbeat để service-worker restart không làm mất protection.
  // Idle tabs không heartbeat, tránh N tab tạo traffic nền không cần thiết.
  setInterval(() => {
    if (state === 'generating' || state === 'typing') send('STATUS', {}, true);
  }, HEARTBEAT_MS);
})();
