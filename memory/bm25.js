import { termFrequency, tokenize } from './text.js';

export class BM25ProjectIndex {
  constructor(projectId) {
    this.projectId = projectId;
    this.docs = new Map();
    this.postings = new Map();
    this.totalLength = 0;
  }

  get size() {
    return this.docs.size;
  }

  add(chunk) {
    if (!chunk?.id) return;
    this.remove(chunk.id);

    const contentTokens = tokenize(chunk.content ?? '');
    const pathTokens = tokenize(chunk.path ?? '');
    const symbolTokens = tokenize(Array.isArray(chunk.symbols) ? chunk.symbols.join(' ') : '');
    const sourceTokens = tokenize(chunk.sourceTitle ?? '');
    const weighted = new Map();

    const merge = (tokens, weight) => {
      const tf = termFrequency(tokens);
      for (const [term, count] of tf) weighted.set(term, (weighted.get(term) ?? 0) + (count * weight));
    };

    merge(contentTokens, 1.0);
    merge(pathTokens, 3.4);
    merge(symbolTokens, 2.8);
    merge(sourceTokens, 1.3);

    const length = Math.max(1, contentTokens.length);
    const meta = {
      id: chunk.id,
      length,
      kind: chunk.kind ?? 'prose',
      path: chunk.path ?? '',
      updatedAt: Number(chunk.updatedAt ?? 0),
      fileId: chunk.fileId ?? null,
      conversationId: chunk.conversationId ?? null,
      symbols: chunk.symbols ?? []
    };

    this.docs.set(chunk.id, meta);
    this.totalLength += length;
    for (const [term, tf] of weighted) {
      let posting = this.postings.get(term);
      if (!posting) {
        posting = new Map();
        this.postings.set(term, posting);
      }
      posting.set(chunk.id, tf);
    }
  }

  remove(chunkId) {
    const existing = this.docs.get(chunkId);
    if (!existing) return;
    this.totalLength -= existing.length;
    this.docs.delete(chunkId);
    for (const [term, posting] of this.postings) {
      posting.delete(chunkId);
      if (posting.size === 0) this.postings.delete(term);
    }
  }

  search(query, options = {}) {
    const rawQuery = String(query ?? '');
    const queryLower = rawQuery.toLowerCase();
    const terms = [...new Set(tokenize(rawQuery))];
    if (terms.length === 0 || this.docs.size === 0) return [];

    const k1 = options.k1 ?? 1.35;
    const b = options.b ?? 0.72;
    const limit = options.limit ?? 30;
    const now = options.now ?? Date.now();
    const avgdl = Math.max(1, this.totalLength / this.docs.size);
    const scores = new Map();

    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const df = posting.size;
      const idf = Math.log(1 + ((this.docs.size - df + 0.5) / (df + 0.5)));
      for (const [docId, tf] of posting) {
        const meta = this.docs.get(docId);
        if (!meta) continue;
        const denom = tf + k1 * (1 - b + b * (meta.length / avgdl));
        const base = idf * ((tf * (k1 + 1)) / Math.max(0.0001, denom));
        scores.set(docId, (scores.get(docId) ?? 0) + base);
      }
    }

    return [...scores.entries()]
      .map(([id, score]) => {
        const meta = this.docs.get(id);
        const ageDays = Math.max(0, (now - meta.updatedAt) / 86400000);
        const recency = Math.max(0, 0.18 - Math.log1p(ageDays) * 0.025);
        const codeBoost = meta.kind === 'code' ? 0.12 : 0;
        const symbolExact = Array.isArray(meta.symbols) && meta.symbols.some(symbol => symbol && queryLower.includes(String(symbol).toLowerCase())) ? 0.9 : 0;
        const pathBase = meta.path ? meta.path.split('/').pop()?.toLowerCase() : '';
        const pathExact = pathBase && queryLower.includes(pathBase) ? 0.55 : 0;
        return { id, score: score + recency + codeBoost + symbolExact + pathExact, ...meta };
      })
      .sort((a, b2) => b2.score - a.score)
      .slice(0, limit);
  }
}
