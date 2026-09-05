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

      // 1. Identify root node (parent: null)
      let rootNodeId = null;
      let systemNodeId = null;
      for (const [id, node] of Object.entries(mapping)) {
        if (!node.parent) {
          rootNodeId = id;
          break;
        }
      }
      if (!rootNodeId || !mapping[rootNodeId]) return data;

      // Check if root has a system message child
      for (const childId of (mapping[rootNodeId].children || [])) {
        const child = mapping[childId];
        if (child?.message?.author?.role === 'system') {
          systemNodeId = childId;
          break;
        }
      }

      // 2. Traverse backwards from current_node along the active path
      const activePath = [];
      let curr = currentNodeId;
      const visited = new Set();
      while (curr && mapping[curr] && !visited.has(curr)) {
        visited.add(curr);
        activePath.push(curr);
        curr = mapping[curr].parent;
      }

      // 3. Count user turns from newest to oldest
      let turnCount = 0;
      let cutoffIndex = activePath.length - 1;

      for (let i = 0; i < activePath.length; i++) {
        const nodeId = activePath[i];
        const node = mapping[nodeId];
        const role = node.message?.author?.role;

        if (role === 'user') {
          turnCount++;
          if (turnCount >= limit) {
            cutoffIndex = i; // keep up to and including this user prompt
            break;
          }
        }
      }

      // If conversation is already short enough, return unchanged
      if (turnCount < limit && cutoffIndex === activePath.length - 1) {
        return data;
      }

      // 4. Assemble retained node IDs
      const keptNodeIds = new Set(activePath.slice(0, cutoffIndex + 1));
      const oldestKeptId = activePath[cutoffIndex];

      // Always keep root and system nodes
      keptNodeIds.add(rootNodeId);
      if (systemNodeId && mapping[systemNodeId]) {
        keptNodeIds.add(systemNodeId);
      }

      // Attach point: link oldest retained node to system node (or root if no system node)
      const attachTargetId = (systemNodeId && mapping[systemNodeId]) ? systemNodeId : rootNodeId;

      // 5. Clone and sanitize mapping
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

      // Re-link tree
      prunedMapping[oldestKeptId].parent = attachTargetId;
      prunedMapping[attachTargetId].children = [oldestKeptId];

      // 6. SANITIZE ALL CHILDREN POINTERS: remove any pruned node references
      for (const [id, node] of Object.entries(prunedMapping)) {
        node.children = (node.children || []).filter(childId => keptNodeIds.has(childId));
      }

      // 7. Calculate token stats for booster HUD
      let totalChars = 0;
      for (const id of keptNodeIds) {
        const parts = prunedMapping[id]?.message?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part === 'string') {
              totalChars += part.length;
            } else if (typeof part === 'object' && part?.text) {
              totalChars += part.text.length;
            }
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

      return {
        ...data,
        mapping: prunedMapping
      };
    } catch (err) {
      console.warn('[TabFlow Proxy] Prune pass-through on error:', err);
      return data;
    }
  }

  // Intercept window.fetch in Main World
  if (typeof window !== 'undefined') {
    const originalFetch = window.fetch;
    const telemetryDomains = ['datadog', 'statsig', 'sentry', 'segment.io', 'segment.com'];

    window.fetch = async function (...args) {
      const resource = args[0];
      const url = typeof resource === 'string' ? resource : (resource?.url || '');

      // 1. Silent Telemetry Blocker
      if (isTelemetryBlocked() && typeof url === 'string') {
        const isTelemetry = telemetryDomains.some(domain => url.includes(domain));
        if (isTelemetry) {
          return new Response(null, { status: 204 });
        }
      }

      // 2. Filter for conversation tree GET request
      const isConversationReq = typeof url === 'string' &&
        url.includes('/backend-api/conversation/') &&
        !url.endsWith('/backend-api/conversation') &&
        !url.includes('/interpreter/') &&
        !url.includes('/prepare');

      const method = (args[1]?.method || (typeof resource === 'object' ? resource?.method : 'GET') || 'GET').toUpperCase();

      let attempt = 0;
      const maxRetries = 3;
      const delays = [1500, 3000, 6000];

      while (attempt <= maxRetries) {
        try {
          const response = await originalFetch.apply(this, args);

          // HTTP 429 Too Many Requests Auto-Retry with Backoff
          if (response.status === 429 && attempt < maxRetries) {
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

          // Only prune GET conversation tree loads
          if (isConversationReq && method === 'GET' && isTrimEnabled() && response.ok) {
            try {
              const clone = response.clone();
              const json = await clone.json();

              if (json && json.mapping && json.current_node) {
                const limit = getMessageLimit();
                const pruned = pruneConversationData(json, limit);

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
          if (attempt >= maxRetries) throw err;
          attempt++;
          await new Promise(resolve => setTimeout(resolve, delays[attempt - 1] || 1500));
        }
      }
    };

    // Listen to control events from settings/HUD
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.type) return;

      if (e.data.type === 'TABFLOW_SET_TRIM') {
        try {
          localStorage.setItem('tabflow_trim_enabled', e.data.enabled ? 'true' : 'false');
          if (e.data.limit) {
            localStorage.setItem('tabflow_trim_limit', String(e.data.limit));
          }
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
