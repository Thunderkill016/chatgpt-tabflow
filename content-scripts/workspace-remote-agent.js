(() => {
  'use strict';

  if (window.top !== window || window.__tabflowWorkspaceRemoteAgentInstalled) return;
  window.__tabflowWorkspaceRemoteAgentInstalled = true;

  const PORT_NAME = 'TABFLOW_WORKSPACE_REMOTE';
  const SNAPSHOT_DEBOUNCE_MS = 280;
  const HEARTBEAT_MS = 4000;
  const MAX_TURNS = 14;
  const MAX_TOTAL_CHARS = 60000;
  const MAX_TURN_CHARS = 12000;
  const MAX_PROMPT_CHARS = 32000;

  const ports = new Set();
  let observer = null;
  let emitTimer = null;
  let heartbeatTimer = null;
  let lastSnapshotFingerprint = '';
  let requestSequence = 0;

  function conversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)/);
    return match?.[1] || `new:${location.pathname}`;
  }

  function clipText(value, limit = MAX_TURN_CHARS) {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    const head = Math.floor(limit * 0.58);
    const tail = Math.max(0, limit - head - 21);
    return `${text.slice(0, head)}\n… [TabFlow clipped] …\n${text.slice(-tail)}`;
  }

  function messageKey(node, index, role) {
    const direct = node.getAttribute('data-message-id');
    if (direct) return direct.slice(0, 500);
    const turn = node.closest('[data-testid^="conversation-turn-"]') || node.querySelector('[data-testid^="conversation-turn-"]');
    const testId = turn?.getAttribute('data-testid');
    return `${conversationId()}:${testId || index}:${role}`;
  }

  function collectMessages() {
    const nodes = document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]');
    const start = Math.max(0, nodes.length - MAX_TURNS);
    const out = [];
    let totalChars = 0;

    for (let i = start; i < nodes.length; i += 1) {
      const node = nodes[i];
      const role = node.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') continue;
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining <= 0) break;
      const text = clipText(node.textContent || '', Math.min(MAX_TURN_CHARS, remaining));
      if (!text) continue;
      out.push({
        id: messageKey(node, i, role),
        role,
        text
      });
      totalChars += text.length;
    }

    return out;
  }

  function hasGenerationControl() {
    return Boolean(document.querySelector(
      'button[data-testid*="stop"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
    ));
  }

  function hasConversationLimit() {
    const buttons = document.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i += 1) {
      const text = (buttons[i].textContent || '').trim().toLowerCase();
      if (text.includes('bắt đầu cuộc trò chuyện mới') || text.includes('start a new chat') || text.includes('start new chat')) {
        return true;
      }
    }
    return false;
  }

  function meta() {
    return {
      title: String(document.title || 'ChatGPT').replace(/\s+-\s+ChatGPT$/i, '').slice(0, 500),
      url: location.href,
      conversationId: conversationId(),
      generating: hasGenerationControl(),
      limitReached: hasConversationLimit(),
      runtimeMode: document.documentElement.dataset.tabflowRuntimeMode || '',
      observedAt: Date.now()
    };
  }

  function createSnapshot() {
    return {
      ...meta(),
      messages: collectMessages()
    };
  }

  function snapshotFingerprint(snapshot) {
    const last = snapshot.messages[snapshot.messages.length - 1];
    const penultimate = snapshot.messages[snapshot.messages.length - 2];
    return [
      snapshot.url,
      snapshot.title,
      snapshot.generating ? '1' : '0',
      snapshot.limitReached ? '1' : '0',
      snapshot.messages.length,
      penultimate?.id || '',
      penultimate?.text?.length || 0,
      last?.id || '',
      last?.text || ''
    ].join('|');
  }

  function post(port, message) {
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function emitSnapshot(force = false, targetPort = null) {
    if (ports.size === 0) return;
    const snapshot = createSnapshot();
    const fingerprint = snapshotFingerprint(snapshot);
    if (!force && fingerprint === lastSnapshotFingerprint) return;
    lastSnapshotFingerprint = fingerprint;
    const message = { type: 'TABFLOW_WORKSPACE_REMOTE_SNAPSHOT', snapshot };
    if (targetPort) {
      post(targetPort, message);
      return;
    }
    for (const port of ports) post(port, message);
  }

  function emitHeartbeat() {
    if (ports.size === 0) return;
    const message = { type: 'TABFLOW_WORKSPACE_REMOTE_HEARTBEAT', meta: meta() };
    for (const port of ports) post(port, message);
  }

  function scheduleSnapshot(force = false) {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emitSnapshot(force);
    }, force ? 0 : SNAPSHOT_DEBOUNCE_MS);
  }

  function startObservation() {
    if (observer) return;
    const root = document.querySelector('main') || document.documentElement;
    observer = new MutationObserver(() => scheduleSnapshot(false));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_MS);
  }

  function stopObservation() {
    if (ports.size > 0) return;
    if (observer) observer.disconnect();
    observer = null;
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    lastSnapshotFingerprint = '';
  }

  function getComposer() {
    return document.getElementById('prompt-textarea') ||
      document.querySelector('form textarea, form [contenteditable="true"]');
  }

  function getSendButton() {
    return document.querySelector(
      'button[data-testid="send-button"]:not([disabled]), button[data-testid*="composer-submit"]:not([disabled]), button[aria-label*="Send" i]:not([disabled]), button[aria-label*="Gửi" i]:not([disabled])'
    );
  }

  function writeComposer(editor, text) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor?.set) descriptor.set.call(editor, text);
      else editor.value = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (editor instanceof HTMLElement && editor.isContentEditable) {
      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);

      let inserted = false;
      try {
        inserted = Boolean(document.execCommand?.('insertText', false, text));
      } catch {}

      if (!inserted) {
        editor.replaceChildren(document.createTextNode(text));
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      }
      return;
    }

    throw new Error('Không tìm được composer ChatGPT tương thích');
  }

  function waitFor(getter, timeoutMs = 3000, stepMs = 70) {
    return new Promise(resolve => {
      const started = Date.now();
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
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  async function submitPrompt(rawText) {
    const text = String(rawText || '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!text) throw new Error('Prompt rỗng');
    if (hasConversationLimit()) {
      const error = new Error('Conversation này đã chạm giới hạn; cần rollover sang chat mới trước khi gửi tiếp.');
      error.code = 'CONVERSATION_LIMIT';
      throw error;
    }
    if (hasGenerationControl()) {
      const error = new Error('Chat này đang generate; chờ hoàn tất hoặc dừng trước khi gửi prompt mới.');
      error.code = 'BUSY_GENERATING';
      throw error;
    }

    const editor = await waitFor(getComposer, 5000, 100);
    if (!editor) throw new Error('Không tìm thấy ô nhập ChatGPT');
    editor.focus({ preventScroll: true });
    writeComposer(editor, text);

    const sendButton = await waitFor(getSendButton, 1800, 60);
    if (sendButton instanceof HTMLElement) {
      sendButton.click();
      scheduleSnapshot(true);
      return { sent: true };
    }

    const form = editor.closest('form');
    if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      scheduleSnapshot(true);
      return { sent: true, via: 'requestSubmit' };
    }

    throw new Error('ChatGPT chưa bật nút gửi sau khi TabFlow điền prompt');
  }

  async function stopGeneration() {
    const button = document.querySelector(
      'button[data-testid*="stop"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
    );
    if (!(button instanceof HTMLElement)) return { stopped: false, reason: 'not-generating' };
    button.click();
    scheduleSnapshot(true);
    return { stopped: true };
  }

  function acknowledge(port, requestId, result = null, error = null) {
    post(port, {
      type: 'TABFLOW_WORKSPACE_REMOTE_ACK',
      requestId,
      ok: !error,
      result,
      error: error ? { name: error.name || 'Error', message: error.message || String(error), code: error.code || '' } : null
    });
  }

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== PORT_NAME) return;
    ports.add(port);
    startObservation();
    emitSnapshot(true, port);

    port.onMessage.addListener(message => {
      const type = message?.type;
      const requestId = message?.requestId || `remote-${Date.now()}-${++requestSequence}`;

      if (type === 'GET_STATE') {
        emitSnapshot(true, port);
        acknowledge(port, requestId, { ready: true });
        return;
      }

      if (type === 'COMMAND_SEND') {
        submitPrompt(message.text)
          .then(result => acknowledge(port, requestId, result))
          .catch(error => acknowledge(port, requestId, null, error));
        return;
      }

      if (type === 'COMMAND_STOP') {
        stopGeneration()
          .then(result => acknowledge(port, requestId, result))
          .catch(error => acknowledge(port, requestId, null, error));
        return;
      }

      acknowledge(port, requestId, null, new Error(`Unknown workspace remote command: ${type}`));
    });

    port.onDisconnect.addListener(() => {
      ports.delete(port);
      stopObservation();
    });
  });
})();
