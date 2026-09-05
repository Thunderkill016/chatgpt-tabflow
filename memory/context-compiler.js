const DEFAULT_WEIGHTS = Object.freeze({
  authority: 0.22,
  continuity: 0.16,
  profile: 0.10,
  structural: 0.18,
  retrieval: 0.34
});

export const CONTEXT_TIERS = Object.freeze(Object.keys(DEFAULT_WEIGHTS));

function finitePositive(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeWeights(weights = {}) {
  const merged = {};
  let total = 0;
  for (const tier of CONTEXT_TIERS) {
    const value = finitePositive(weights[tier], DEFAULT_WEIGHTS[tier]);
    merged[tier] = value;
    total += value;
  }
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  for (const tier of CONTEXT_TIERS) merged[tier] /= total;
  return merged;
}

function candidateCost(candidate, estimateTokens) {
  if (Number.isFinite(candidate?.tokens) && candidate.tokens > 0) return Math.ceil(candidate.tokens);
  return Math.max(1, Math.ceil(estimateTokens(String(candidate?.text || ''), candidate?.tokenKind || 'prose')));
}

function candidateScore(candidate) {
  const score = Number(candidate?.score);
  return Number.isFinite(score) ? score : 0;
}

function stableOrder(candidates) {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const priorityDiff = Number(b.candidate?.priority || 0) - Number(a.candidate?.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      const scoreDiff = candidateScore(b.candidate) - candidateScore(a.candidate);
      if (scoreDiff !== 0) return scoreDiff;
      return a.index - b.index;
    })
    .map(item => item.candidate);
}

function canonicalTierOrder(selected) {
  const ordered = [];
  for (const tier of CONTEXT_TIERS) {
    ordered.push(...stableOrder(selected.filter(candidate => candidate.tier === tier)));
  }
  return ordered;
}

/**
 * Deterministically compile project context into a strict token budget.
 *
 * Pass 1 gives every non-empty tier its reserved share. Pass 2 lets unused
 * budget spill to remaining candidates in semantic tier order. This prevents
 * a large BM25 result set from starving user constraints or continuity state,
 * while still using the whole budget when some tiers are empty.
 */
export function compileContext({
  maxTokens,
  candidates = [],
  estimateTokens,
  weights = DEFAULT_WEIGHTS,
  reserveTokens = 0
}) {
  if (typeof estimateTokens !== 'function') throw new TypeError('estimateTokens function is required');
  const ceiling = Math.max(0, Math.floor(finitePositive(maxTokens, 0) - Math.max(0, Number(reserveTokens) || 0)));
  const normalizedWeights = normalizeWeights(weights);
  const groups = new Map(CONTEXT_TIERS.map(tier => [tier, []]));

  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) continue;
    const tier = CONTEXT_TIERS.includes(raw.tier) ? raw.tier : 'retrieval';
    groups.get(tier).push({ ...raw, tier, tokens: candidateCost(raw, estimateTokens) });
  }
  for (const tier of CONTEXT_TIERS) groups.set(tier, stableOrder(groups.get(tier)));

  const selected = [];
  const selectedIds = new Set();
  const usedByTier = Object.fromEntries(CONTEXT_TIERS.map(tier => [tier, 0]));
  let usedTokens = 0;

  function take(candidate, tier, cap = ceiling) {
    if (!candidate || selectedIds.has(candidate.id)) return false;
    const cost = candidate.tokens;
    if (usedTokens + cost > ceiling || usedByTier[tier] + cost > cap) return false;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    usedTokens += cost;
    usedByTier[tier] += cost;
    return true;
  }

  // Reserved pass. A single candidate may exceed its tier quota; it is deferred
  // to spillover rather than blocking smaller candidates behind it.
  for (const tier of CONTEXT_TIERS) {
    const cap = Math.floor(ceiling * normalizedWeights[tier]);
    for (const candidate of groups.get(tier)) take(candidate, tier, cap);
  }

  // Spill unused capacity. Authority/continuity remain first-class, followed by
  // compact project structure and then full retrieval evidence.
  for (const tier of CONTEXT_TIERS) {
    for (const candidate of groups.get(tier)) take(candidate, tier, ceiling);
  }

  // Selection happens in two passes, so append order is not itself semantic
  // order: retrieval selected in pass 1 could otherwise appear before authority
  // added during spillover. Canonicalize only presentation order; the selected
  // set and every budget accounting value stay unchanged.
  const orderedSelected = canonicalTierOrder(selected);

  return {
    selected: orderedSelected,
    usedTokens,
    remainingTokens: Math.max(0, ceiling - usedTokens),
    usedByTier,
    budget: ceiling,
    weights: normalizedWeights
  };
}

export function buildStructuralCandidates(chunks = [], { limit = 10 } = {}) {
  const byPath = new Map();
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    if (chunk?.kind !== 'code' || !chunk.path) continue;
    const entry = byPath.get(chunk.path) || {
      path: chunk.path,
      language: chunk.language || '',
      symbols: new Set(),
      score: 0,
      conversationId: chunk.conversationId || null
    };
    for (const symbol of Array.isArray(chunk.symbols) ? chunk.symbols : []) {
      if (entry.symbols.size >= 18) break;
      if (symbol) entry.symbols.add(String(symbol));
    }
    entry.score = Math.max(entry.score, Number(chunk.score || 0));
    byPath.set(chunk.path, entry);
  }

  return [...byPath.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((entry, index) => {
      const symbols = [...entry.symbols];
      const suffix = symbols.length ? ` — symbols: ${symbols.join(', ')}` : '';
      return {
        id: `structure:${entry.path}`,
        tier: 'structural',
        priority: 100 - index,
        score: entry.score,
        tokenKind: 'prose',
        text: `- ${entry.path}${entry.language ? ` (${entry.language})` : ''}${suffix}`,
        citation: {
          type: 'structure',
          path: entry.path,
          conversationId: entry.conversationId,
          symbols
        }
      };
    });
}
