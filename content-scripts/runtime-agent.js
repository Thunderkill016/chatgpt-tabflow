(() => {
  'use strict';

  if (window.__tabflowRuntimeAgentInstalled) return;
  window.__tabflowRuntimeAgentInstalled = true;

  const PORT_NAME = 'TABFLOW_RUNTIME_CLIENT';
  const GENERATION_POLL_MS = 900;
  const GENERATION_MAX_MS = 10 * 60 * 1000;
  const TYPING_GRACE_MS = 1100;
  const MAX_TASK_PROMPT_CHARS = 64000;
  const MAX_TASK_OUTPUT_CHARS = 70000;

  let port = null;
  let state = 'idle';
  let executionMode = 'interactive';
  let typingTimer = null;
  let generationTimer = null;
  let generationStartedAt = 0;
  let generationStableMisses = 0;
  let lastStatusFingerprint = '';
  let currentTaskId = '';
  let currentTaskRole = '';
  let taskDeliveryBusy = false;

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
      currentTaskId,
      lastActivityAt: Date.now(),
      ...extra
    };
  }

  function postRaw(message) {
    const current = connect();
    if (!current) return false;
    try {
      current.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function connect() {
    if (port) return port;
    try {
      const current = chrome.runtime.connect({ name: PORT_NAME });
      port = current;
      current.onMessage.addListener(message => {
        if (message?.type === 'RUNTIME_MODE') {
          executionMode = message.mode || 'interactive';
          document.documentElement.dataset.tabflowRuntimeMode = executionMode;
          window.dispatchEvent(new CustomEvent('tabflow:runtime-mode', { detail: message }));
          return;
        }
        if (message?.type === 'RUNTIME_TASK') {
          acceptRuntimeTask(message.task).catch(error => failCurrentTask(error));
        }
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
    const fingerprint = `${data.state}|${data.visible}|${data.focused}|${data.conversationId}|${data.title}|${data.currentTaskId}`;
    if (!force && type === 'STATUS' && fingerprint === lastStatusFingerprint) return;
    lastStatusFingerprint = fingerprint;
    postRaw({ type, payload: data });
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

  function getPromptEditor() {
    return document.getElementById('prompt-textarea') ||
      document.querySelector('form textarea, form [contenteditable="true"]');
  }

  function isSendButton(target) {
    if (!(target instanceof Element)) return false;
    const button = target.closest('button');
    if (!button) return false;
    const testId = button.getAttribute('data-testid') || '';
    const aria = button.getAttribute('aria-label') || '';
    return /send|composer-submit/i.test(testId) || /send|gửi/i.test(aria);
  }

  function getSendButton() {
    return document.querySelector(
      'button[data-testid="send-button"], button[data-testid*="composer-submit"], button[data-testid*="send"], button[aria-label*="Send" i], button[aria-label*="Gửi" i]'
    );
  }

  function hasStopControl() {
    return Boolean(document.querySelector(
      'button[data-testid*="stop"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
    ));
  }

  function waitFor(getter, timeoutMs, intervalMs = 120) {
    const started = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const value = getter();
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  function setTextareaValue(editor, text) {
    const proto = editor instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(editor, text);
    else editor.value = text;
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text
    }));
    return true;
  }

  function setContentEditableValue(editor, text) {
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }

    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    let inserted = false;
    try {
      inserted = Boolean(document.execCommand('insertText', false, text));
    } catch {}

    if (!inserted) {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
    }
    return true;
  }

  function setEditorText(editor, text) {
    if (!editor) return false;
    const clean = String(text || '').slice(0, MAX_TASK_PROMPT_CHARS);
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return setTextareaValue(editor, clean);
    }
    if (editor.getAttribute('contenteditable') === 'true') {
      return setContentEditableValue(editor, clean);
    }
    return false;
  }

  function captureLatestAssistant() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (messages.length > 0) {
      return String(messages[messages.length - 1].textContent || '').trim().slice(0, MAX_TASK_OUTPUT_CHARS);
    }
    const turns = document.querySelectorAll('article');
    if (turns.length > 0) {
      return String(turns[turns.length - 1].textContent || '').trim().slice(0, MAX_TASK_OUTPUT_CHARS);
    }
    return '';
  }

  function completeGeneration() {
    const finishedTaskId = currentTaskId;
    const output = finishedTaskId ? captureLatestAssistant() : '';
    currentTaskId = '';
    currentTaskRole = '';
    state = document.hasFocus() ? 'interactive' : 'idle';
    send('STATUS', {}, true);

    if (finishedTaskId) {
      postRaw({
        type: 'TASK_COMPLETE',
        taskId: finishedTaskId,
        output,
        focused: document.hasFocus(),
        conversationId: getConversationId()
      });
    }
  }

  function generationPoll() {
    if (state !== 'generating') return;
    if (Date.now() - generationStartedAt > GENERATION_MAX_MS) {
      generationTimer = null;
      if (currentTaskId) {
        failCurrentTask(new Error('ChatGPT generation vượt giới hạn 10 phút'));
      } else {
        completeGeneration();
      }
      return;
    }

    if (hasStopControl()) {
      generationStableMisses = 0;
    } else {
      generationStableMisses += 1;
      if (generationStableMisses >= 3) {
        generationTimer = null;
        completeGeneration();
        return;
      }
    }
    generationTimer = setTimeout(generationPoll, GENERATION_POLL_MS);
  }

  function markSubmitIntent(taskId = '') {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    if (taskId) currentTaskId = taskId;
    state = 'generating';
    generationStartedAt = Date.now();
    generationStableMisses = 0;
    send('SUBMIT_INTENT', { protectUntil: Date.now() + 45000, currentTaskId }, true);
    if (generationTimer) clearTimeout(generationTimer);
    generationTimer = setTimeout(generationPoll, 700);
  }

  async function acceptRuntimeTask(task) {
    if (!task?.id || !task?.prompt) return;
    if (taskDeliveryBusy || state === 'generating' || state === 'typing' || currentTaskId) {
      postRaw({ type: 'TASK_FAILED', taskId: task.id, error: 'Target tab đang bận' });
      return;
    }

    taskDeliveryBusy = true;
    currentTaskId = String(task.id);
    currentTaskRole = String(task.toRole || '');
    try {
      const editor = await waitFor(getPromptEditor, 12000, 160);
      if (!editor) throw new Error('Không tìm thấy ChatGPT prompt editor');
      if (!setEditorText(editor, task.prompt)) throw new Error('Không thể nạp task vào prompt editor');

      const sendButton = await waitFor(() => {
        const button = getSendButton();
        return button && !button.disabled ? button : null;
      }, 7000, 140);
      if (!sendButton) throw new Error('Prompt đã nạp nhưng nút Send chưa sẵn sàng');

      postRaw({ type: 'TASK_ACK', taskId: currentTaskId, role: currentTaskRole });
      markSubmitIntent(currentTaskId);
      sendButton.click();
    } catch (error) {
      failCurrentTask(error);
    } finally {
      taskDeliveryBusy = false;
    }
  }

  function failCurrentTask(error) {
    const taskId = currentTaskId;
    currentTaskId = '';
    currentTaskRole = '';
    if (generationTimer) {
      clearTimeout(generationTimer);
      generationTimer = null;
    }
    if (state === 'generating') state = document.hasFocus() ? 'interactive' : 'idle';
    send('STATUS', {}, true);
    if (taskId) {
      postRaw({
        type: 'TASK_FAILED',
        taskId,
        error: error?.message || String(error)
      });
    }
  }

  document.addEventListener('input', event => {
    if (!isPromptEditor(event.target)) return;
    if (state !== 'generating') setState('typing', {}, true);
    if (typingTimeout) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingTimer = null;
      if (state === 'typing') setState(document.hasFocus() ? 'interactive' : 'idle', {}, true);
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

  setInterval(() => {
    if (state === 'generating' || state === 'typing' || currentTaskId) send('STATUS', {}, true);
  }, 15000);
})();
