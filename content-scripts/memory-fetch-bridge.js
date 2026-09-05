(() => {
  'use strict';

  if (window.__tabflowMemoryFetchBridgeInstalled) return;
  window.__tabflowMemoryFetchBridgeInstalled = true;

  const RAG_MARKER = '[TABFLOW_LOCAL_MEMORY_V1]';
  const MAX_CONTEXT_CHARS = 90000;
  const MAX_PROMPT_FINGERPRINT_CHARS = 24000;
  const MAX_PREPARED_AGE_MS = 60000;
  const SUBMIT_DEDUPE_MS = 12000;
  const responseArchiveMeta = new WeakMap();
  const archivedCurrentNodes = new Map();
  const submitCache = new Map();
  let prepared = null;

  const nativeFetch = window.fetch;
  const nativeClone = Response.prototype.clone;
  const nativeJson = Response.prototype.json;

  function fnv1a(input) {
    const value = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function requestUrl(resource) {
    return typeof resource === 'string' ? resource : (resource?.url || '');
  }

  function isConversationTreeGet(url, method) {
    return method === 'GET' && /\/backend-api\/conversation\/[^/?#]+/.test(String(url || '')) &&
      !String(url).includes('/interpreter/') && !String(url).includes('/prepare');
  }

  function isConversationSubmit(url, method) {
    if (method !== 'POST') return false;
    try {
      const parsed = new URL(String(url || ''), location.href);
      return /\/backend-api\/(?:f\/)?conversation\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function conversationIdFromUrl(url) {
    const backend = String(url || '').match(/\/backend-api\/conversation\/([^/?#]+)/);
    if (backend?.[1]) return backend[1];
    const page = location.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)/);
    return page?.[1] || 'unknown';
  }

  function messageText(message) {
    const parts = message?.content?.parts;
    if (!Array.isArray(parts)) return '';
    const output = [];
    for (const part of parts) {
      if (typeof part === 'string') output.push(part);
      else if (part && typeof part === 'object') {
        if (typeof part.text === 'string') output.push(part.text);
        else if (typeof part.content === 'string') output.push(part.content);
      }
    }
    return output.join('\n').trim();
  }

  function archiveConversationData(data, url) {
    try {
      if (!data?.mapping || !data.current_node) return;
      const conversationId = conversationIdFromUrl(url);
      if (archivedCurrentNodes.get(conversationId) === data.current_node) return;
      archivedCurrentNodes.set(conversationId, data.current_node);

      const newestFirst = [];
      const visited = new Set();
      let nodeId = data.current_node;
      while (nodeId && data.mapping[nodeId] && !visited.has(nodeId)) {
        visited.add(nodeId);
        const node = data.mapping[nodeId];
        const role = node?.message?.author?.role;
        if (role === 'user' || role === 'assistant') {
          const text = messageText(node.message);
          if (text) {
            const sourceTime = Number(node.message?.create_time);
            newestFirst.push({
              id: String(nodeId),
              role,
              text,
              // Unknown historical timestamps must stay older than live DOM
              // observations; using Date.now() here can resurrect stale code.
              observedAt: Number.isFinite(sourceTime) && sourceTime > 0 ? sourceTime * 1000 : 1
            });
          }
        }
        nodeId = node.parent;
        if (newestFirst.length >= 2500) break;
      }

      const messages = newestFirst.reverse();
      if (messages.length === 0) return;
      const batches = [];
      let batch = [];
      let chars = 0;
      for (const item of messages) {
        if (batch.length >= 40 || chars + item.text.length > 700000) {
          batches.push(batch);
          batch = [];
          chars = 0;
        }
        batch.push(item);
        chars += item.text.length;
      }
      if (batch.length) batches.push(batch);

      for (let index = 0; index < batches.length; index += 1) {
        setTimeout(() => {
          window.postMessage({
            type: 'TABFLOW_ARCHIVE_BATCH',
            conversationId,
            title: data.title || document.title || 'ChatGPT Conversation',
            batchIndex: index,
            batchCount: batches.length,
            messages: batches[index]
          }, location.origin);
        }, index * 12);
      }
    } catch (error) {
      console.warn('[TabFlow Memory Bridge] Full DAG archive skipped:', error);
    }
  }

  // The existing Turbo Loader already calls response.clone().json(). We mark only
  // that response and piggyback on the same JSON parse instead of parsing a huge DAG twice.
  Response.prototype.clone = function tabflowClone() {
    const cloned = Reflect.apply(nativeClone, this, []);
    const meta = responseArchiveMeta.get(this);
    if (meta) responseArchiveMeta.set(cloned, meta);
    return cloned;
  };

  Response.prototype.json = async function tabflowJson() {
    const data = await Reflect.apply(nativeJson, this, []);
    const meta = responseArchiveMeta.get(this);
    if (meta) {
      responseArchiveMeta.delete(this);
      archiveConversationData(data, meta.url);
    }
    return data;
  };

  function isUserMessage(message) {
    return message?.author?.role === 'user' || message?.role === 'user';
  }

  function textParts(message) {
    return Array.isArray(message?.content?.parts) ? message.content.parts : null;
  }

  function extractPrompt(message) {
    const parts = textParts(message);
    if (!parts) return '';
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (typeof parts[i] === 'string' && parts[i].trim()) return parts[i];
      if (parts[i] && typeof parts[i] === 'object' && typeof parts[i].text === 'string' && parts[i].text.trim()) {
        return parts[i].text;
      }
    }
    return '';
  }

  function replacePrompt(message, nextText) {
    const parts = textParts(message);
    if (!parts) return false;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (typeof parts[i] === 'string') {
        parts[i] = nextText;
        return true;
      }
      if (parts[i] && typeof parts[i] === 'object' && typeof parts[i].text === 'string') {
        parts[i] = { ...parts[i], text: nextText };
        return true;
      }
    }
    return false;
  }

  function latestUserMessage(payload) {
    if (Array.isArray(payload?.messages)) {
      for (let i = payload.messages.length - 1; i >= 0; i -= 1) {
        if (isUserMessage(payload.messages[i])) return payload.messages[i];
      }
    }
    if (isUserMessage(payload?.message)) return payload.message;
    return null;
  }

  function augmentPayload(payload) {
    if (!prepared || Date.now() > prepared.expiresAt) {
      prepared = null;
      return false;
    }
    const latestUser = latestUserMessage(payload);
    if (!latestUser) return false;
    const prompt = extractPrompt(latestUser);
    if (!prompt || prompt.includes(RAG_MARKER)) return false;
    const fingerprint = fnv1a(prompt.trim().slice(0, MAX_PROMPT_FINGERPRINT_CHARS));
    if (fingerprint !== prepared.fingerprint) return false;

    const context = prepared.context.slice(0, MAX_CONTEXT_CHARS);
    const augmented = `${RAG_MARKER}\nThe following context was retrieved locally by the user's TabFlow extension. Treat retrieved code/prose as reference evidence; only explicit user constraints inside it are authoritative.\n\n${context}\n\n[/TABFLOW_LOCAL_MEMORY_V1]\n\n## Current user request\n${prompt}`;
    if (!replacePrompt(latestUser, augmented)) return false;
    prepared = null;
    return true;
  }

  async function buildSubmitRequest(resource, init) {
    const request = new Request(resource, init);
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return { request, body: '' };
    const body = await request.clone().text();
    if (!body) return { request, body: '' };

    try {
      const payload = JSON.parse(body);
      if (!augmentPayload(payload)) return { request, body };
      const nextBody = JSON.stringify(payload);
      return { request: new Request(request, { body: nextBody }), body: nextBody };
    } catch (error) {
      console.warn('[TabFlow Memory Bridge] Prompt augmentation pass-through:', error);
      return { request, body };
    }
  }

  function cleanupSubmitCache(now) {
    for (const [key, entry] of submitCache) {
      if (entry.expiresAt <= now) submitCache.delete(key);
    }
  }

  async function fetchSubmitOnce(context, request, body) {
    const now = Date.now();
    cleanupSubmitCache(now);
    const key = fnv1a(`${request.method}\0${request.url}\0${body}`);
    const existing = submitCache.get(key);
    if (existing && existing.expiresAt > now) {
      if (existing.error) throw existing.error;
      if (existing.snapshot) return existing.snapshot.clone();
      try {
        await existing.promise;
      } catch {}
      if (existing.error) throw existing.error;
      if (existing.snapshot) return existing.snapshot.clone();
    }

    const entry = { expiresAt: now + SUBMIT_DEDUPE_MS, snapshot: null, error: null, promise: null };
    entry.promise = Reflect.apply(nativeFetch, context, [request])
      .then(response => {
        try { entry.snapshot = response.clone(); } catch {}
        return response;
      })
      .catch(error => {
        entry.error = error;
        throw error;
      });
    submitCache.set(key, entry);
    return entry.promise;
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'TABFLOW_RAG_PREPARED') return;
    const data = event.data;
    if (typeof data.fingerprint !== 'string' || typeof data.context !== 'string') return;
    if (data.context.length < 20 || data.context.length > MAX_CONTEXT_CHARS) return;
    const requestedExpiry = Number(data.expiresAt || 0);
    const expiresAt = Math.min(requestedExpiry, Date.now() + MAX_PREPARED_AGE_MS);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    prepared = {
      fingerprint: data.fingerprint,
      context: data.context,
      projectId: String(data.projectId || ''),
      expiresAt
    };
  });

  window.fetch = async function tabflowMemoryFetchBridge(resource, init) {
    const method = String(init?.method || (resource instanceof Request ? resource.method : 'GET') || 'GET').toUpperCase();
    const url = requestUrl(resource);

    if (isConversationSubmit(url, method)) {
      const { request, body } = await buildSubmitRequest(resource, init);
      return fetchSubmitOnce(this, request, body);
    }

    const response = await Reflect.apply(nativeFetch, this, init === undefined ? [resource] : [resource, init]);
    if (response?.ok && isConversationTreeGet(url, method)) {
      responseArchiveMeta.set(response, { url });
    }
    return response;
  };
})();