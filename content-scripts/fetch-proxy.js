/**
 * ChatGPT TabFlow - Turbo Instant Loader (Main World Fetch Proxy)
 * Intercepts GET /backend-api/conversation/<id> and prunes the historical DAG tree
 * to only the active window (last N turns).
 * Eliminates white screens, memory bloat, and browser tab freezes on long coding chats.
 */

(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.__tabflowProxyInstalled) return;
  if (typeof window !== 'undefined') window.__tabflowProxyInstalled = true;

  const DEFAULT_MESSAGE_LIMIT = 20;

  function isTrimEnabled() {
    try {
      if (typeof localStorage === 'undefined') return true;
      return localStorage.getItem('tabflow_trim_enabled') !== 'false';
    } catch {
      return true;
    }
  }

  function isTelemetryBlocked() {
    try {
      if (typeof localStorage === 'undefined') return true;
      return localStorage.getItem('tabflow_block_telemetry') !== 'false';
    } catch {
      return true;
    }
  }

  function getMessageLimit() {
    try {
      if (typeof localStorage === 'undefined') return DEFAULT_MESSAGE_LIMIT;
      const stored = parseInt(localStorage.getItem('tabflow_trim_limit'), 10);
      return (stored && stored > 0) ? stored : DEFAULT_MESSAGE_LIMIT;
    } catch {
      return DEFAULT_MESSAGE_LIMIT;
    }
  }

  /**
   * Bulletproof conversation DAG pruning
   * Guarantees:
   * 1. Preserves root node and system instructions
   * 2. First message in pruned tree is always a USER prompt (never a floating assistant message)
   * 3. Sanitizes all children arrays (ZERO dangling pointers)
   * 4. Fails safe: on any exception, returns original untouched data
   */
  function pruneConversationData(data, limit) {
    try {
      if (!data || !data.mapping || !data.current_node) return data;
      const mapping = data.mapping;
      const currentNodeId = data.current_node;
      if (!mapping[currentNodeId]) return data;

      let rootNodeId = null;
      let systemNodeId = null;
      for (const [id, node] of Object.entries(mapping)) {
        if (!node.parent) {
          rootNodeId = id;
          break;
        }
      }
      if (!rootNodeId || !mapping[rootNodeId]) return data;

      for (const childId of (mapping[rootNodeId].children || [])) {
        const child = mapping[childId];
        if (child?.message?.author?.role === 'system') {
          systemNodeId = childId;
          break;
        }
      }

      const activePath = [];
      let curr = currentNodeId;
      const visited = new Set();
      while (curr && mapping[curr] && !visited.has(curr)) {
        visited.add(curr);
        activePath.push(curr);
        curr = mapping[curr].parent;
      }

      let turnCount = 0;
      let cutoffIndex = activePath.length - 1;

      for (let i = 0; i < activePath.length; i++) {
        const nodeId = activePath[i];
        const node = mapping[nodeId];
        const role = node.message?.author?.role;

        if (role === 'user') {
          turnCount++;
          if (turnCount >= limit) {
            cutoffIndex = i;
            break;
          }
        }
      }

      if (turnCount < limit && cutoffIndex === activePath.length - 1) {
        return data;
      }

      const keptNodeIds = new Set(activePath.slice(0, cutoffIndex + 1));
      const oldestKeptId = activePath[cutoffIndex];

      keptNodeIds.add(rootNodeId);
      if (systemNodeId && mapping[systemNodeId]) keptNodeIds.add(systemNodeId);

      const attachTargetId = (systemNodeId && mapping[systemNodeId]) ? systemNodeId : rootNodeId;

      const prunedMapping = {};
      for (const id of keptNodeIds) {
        const orig = mapping[id];
        prunedMapping[id] = {
          id: orig.id,
          message: orig.message,
          parent: orig.parent,
          children: Array.isArray(orig.children) ? [...orig.children] : []
        };
      }

      prunedMapping[oldestKeptId].parent = attachTargetId;
      prunedMapping[attachTargetId].children = [oldestKeptId];

      for (const node of Object.values(prunedMapping)) {
        node.children = (node.children || []).filter(childId => keptNodeIds.has(childId));
      }

      let totalChars = 0;
      for (const id of keptNodeIds) {
        const parts = prunedMapping[id]?.message?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part === 'string') totalChars += part.length;
            else if (typeof part === 'object' && part?.text) totalChars += part.text.length;
          }
        }
      }

      const estimatedTokens = Math.round(totalChars / 3.2);
      const estimatedBudgetPct = Math.min(100, Number(((estimatedTokens / 32000) * 100).toFixed(1)));

      if (typeof window !== 'undefined' && window.postMessage) {
        window.postMessage({
          type: 'TABFLOW_TRIMMED_STATS',
          totalOriginalNodes: Object.keys(mapping).length,
          totalKeptNodes: Object.keys(prunedMapping).length,
          turnCount,
          limit,
          estimatedTokens,
          estimatedBudgetPct
        }, '*');
      }

      return { ...data, mapping: prunedMapping };
    } catch (err) {
      console.warn('[TabFlow Proxy] Prune pass-through on error:', err);
      return data;
    }
  }

  if (typeof window !== 'undefined') {
    const originalFetch = window.fetch;
    const telemetryDomains = ['datadog', 'statsig', 'sentry', 'segment.io', 'segment.com'];

    window.fetch = async function (...args) {
      const resource = args[0];
      const url = typeof resource === 'string' ? resource : (resource?.url || '');
      const method = (args[1]?.method || (typeof resource === 'object' ? resource?.method : 'GET') || 'GET').toUpperCase();
      // Never replay a request that can mutate ChatGPT state. GET/HEAD are the
      // only methods this proxy may retry automatically. This keeps the loader
      // fail-safe even if ChatGPT changes submit endpoints or retry semantics.
      const retrySafe = method === 'GET' || method === 'HEAD';

      if (isTelemetryBlocked() && typeof url === 'string') {
        const isTelemetry = telemetryDomains.some(domain => url.includes(domain));
        if (isTelemetry) return new Response(null, { status: 204 });
      }

      const isConversationReq = typeof url === 'string' &&
        url.includes('/backend-api/conversation/') &&
        !url.endsWith('/backend-api/conversation') &&
        !url.includes('/interpreter/') &&
        !url.includes('/prepare');

      let attempt = 0;
      const maxRetries = retrySafe ? 3 : 0;
      const delays = [1500, 3000, 6000];

      while (attempt <= maxRetries) {
        try {
          const response = await originalFetch.apply(this, args);

          if (retrySafe && response.status === 429 && attempt < maxRetries) {
            if (window.postMessage) {
              window.postMessage({
                type: 'TABFLOW_RETRY_STATUS',
                attempt: attempt + 1,
                maxRetries,
                delayMs: delays[attempt]
              }, '*');
            }
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            attempt++;
            continue;
          }

          if (isConversationReq && method === 'GET' && isTrimEnabled() && response.ok) {
            try {
              const clone = response.clone();
              const json = await clone.json();

              if (json && json.mapping && json.current_node) {
                const pruned = pruneConversationData(json, getMessageLimit());
                return new Response(JSON.stringify(pruned), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                });
              }
            } catch (err) {
              console.warn('[TabFlow Proxy] JSON parse pass-through:', err);
              return response;
            }
          }

          return response;
        } catch (err) {
          if (!retrySafe || attempt >= maxRetries) throw err;
          attempt++;
          await new Promise(resolve => setTimeout(resolve, delays[attempt - 1] || 1500));
        }
      }
    };

    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.type) return;

      if (e.data.type === 'TABFLOW_SET_TRIM') {
        try {
          localStorage.setItem('tabflow_trim_enabled', e.data.enabled ? 'true' : 'false');
          if (e.data.limit) localStorage.setItem('tabflow_trim_limit', String(e.data.limit));
        } catch {}
      }
      if (e.data.type === 'TABFLOW_SET_TELEMETRY') {
        try {
          localStorage.setItem('tabflow_block_telemetry', e.data.enabled ? 'true' : 'false');
        } catch {}
      }
    });

    console.log('⚡ [TabFlow] Turbo Instant Loader (Main World Proxy) Active');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pruneConversationData };
  }
})();