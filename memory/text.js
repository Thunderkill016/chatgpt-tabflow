export const TOKEN_ESTIMATE = Object.freeze({ codeCharsPerToken: 2.8, proseCharsPerToken: 4.0 });

const STOP_WORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','is','are','be','as','at','by','from','it','this','that',
  'và','là','của','cho','trong','trên','với','một','các','những','để','từ','này','đó','thì','khi','được'
]);

export function fnv1a(input) {
  const value = String(input ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function normalizePath(path) {
  if (!path) return '';
  const parts = String(path)
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .filter(part => part !== '.');

  const safe = [];
  for (const part of parts) {
    if (part === '..') {
      safe.pop();
    } else {
      safe.push(part.replace(/[\u0000-\u001f]/g, '').slice(0, 180));
    }
  }
  return safe.join('/').slice(0, 800);
}

function splitIdentifier(token) {
  const raw = token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._/\\:@#-]+/g, ' ')
    .replace(/[^\p{L}\p{N}_$]+/gu, ' ')
    .trim();
  if (!raw) return [];
  return raw.split(/\s+/u).filter(Boolean);
}

export function tokenize(text) {
  const source = String(text ?? '')
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();

  const base = source.match(/[\p{L}\p{N}_$./:@#-]{2,}/gu) ?? [];
  const out = [];
  for (const token of base) {
    const parts = splitIdentifier(token.toLowerCase());
    if (parts.length === 0) continue;
    for (const part of parts) {
      if (part.length < 2 || STOP_WORDS.has(part)) continue;
      out.push(part);
    }
    if (token.length >= 3 && token.length <= 120 && !STOP_WORDS.has(token)) {
      out.push(token);
    }
  }
  return out;
}

export function termFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

export function estimateTokens(text, kind = 'prose') {
  const charsPerToken = kind === 'code'
    ? TOKEN_ESTIMATE.codeCharsPerToken
    : TOKEN_ESTIMATE.proseCharsPerToken;
  return Math.max(1, Math.ceil(String(text ?? '').length / charsPerToken));
}

export function extractSymbols(code, language = '') {
  const value = String(code ?? '');
  const symbols = new Set();
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/g,
    /\binterface\s+([A-Za-z_$][\w$]*)\b/g,
    /\btype\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\benum\s+([A-Za-z_$][\w$]*)\b/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /^\s*def\s+([A-Za-z_][\w]*)\s*\(/gm,
    /^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(|:)/gm,
    /\b(?:func|fn)\s+([A-Za-z_][\w]*)\b/g,
    /\b(?:public|private|protected|internal|static|final|abstract|virtual|override|async|synchronized|native|sealed|partial|extern|unsafe|readonly|const|mut|pub|export\s+)?\s*(?:[A-Za-z_$][\w$<>\[\],.?]*\s+)+([A-Za-z_$][\w$]*)\s*\(/g
  ];

  for (const regex of patterns) {
    for (const match of value.matchAll(regex)) {
      if (match[1] && match[1].length <= 120) symbols.add(match[1]);
      if (symbols.size >= 120) break;
    }
    if (symbols.size >= 120) break;
  }

  if (/^(json|yaml|yml)$/i.test(language)) return [];
  return [...symbols];
}

function nearestBoundary(text, target, min) {
  const windowStart = Math.max(min, target - 220);
  const slice = text.slice(windowStart, target + 1);
  const candidates = [slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('. ')];
  const best = Math.max(...candidates);
  return best >= 0 ? windowStart + best + (slice.slice(best, best + 2) === '\n\n' ? 2 : 1) : target;
}

export function chunkProse(text, options = {}) {
  const maxChars = options.maxChars ?? 1500;
  const overlapChars = options.overlapChars ?? 180;
  const value = String(text ?? '').trim();
  if (!value) return [];
  if (value.length <= maxChars) return [{ content: value, ordinal: 0, kind: 'prose' }];

  const chunks = [];
  let start = 0;
  let ordinal = 0;
  while (start < value.length) {
    const hardEnd = Math.min(value.length, start + maxChars);
    const end = hardEnd === value.length ? hardEnd : nearestBoundary(value, hardEnd, start + Math.floor(maxChars * 0.55));
    const content = value.slice(start, Math.max(end, start + 1)).trim();
    if (content) chunks.push({ content, ordinal, kind: 'prose' });
    if (end >= value.length) break;
    start = Math.max(start + 1, end - overlapChars);
    ordinal += 1;
  }
  return chunks;
}

export function chunkCode(code, language = '', options = {}) {
  const maxLines = options.maxLines ?? 90;
  const overlapLines = options.overlapLines ?? 12;
  const value = String(code ?? '').replace(/\r\n/g, '\n');
  const lines = value.split('\n');
  if (!value.trim()) return [];

  const chunks = [];
  let start = 0;
  let ordinal = 0;
  while (start < lines.length) {
    const end = Math.min(lines.length, start + maxLines);
    const content = lines.slice(start, end).join('\n').trimEnd();
    if (content.trim()) {
      chunks.push({
        content,
        ordinal,
        kind: 'code',
        lineStart: start + 1,
        lineEnd: end,
        symbols: extractSymbols(content, language)
      });
    }
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - overlapLines);
    ordinal += 1;
  }
  return chunks;
}

export function stripFencedCode(markdown) {
  return String(markdown ?? '').replace(/```[\w.+#-]*\n[\s\S]*?```/g, ' ');
}

export function extractFencedCode(markdown) {
  const value = String(markdown ?? '');
  const blocks = [];
  const regex = /```([\w.+#-]*)\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    const language = (match[1] || 'code').toLowerCase();
    const code = match[2].replace(/\n$/, '');
    blocks.push({ language, code });
    if (blocks.length >= 100) break;
  }
  return blocks;
}

export function inferPathFromCode(code, label = '', language = '') {
  const candidates = [String(label ?? '').trim()];
  const firstLines = String(code ?? '').split(/\r?\n/).slice(0, 4);
  for (const line of firstLines) {
    const cleaned = line
      .replace(/^\s*(?:\/\/|#|--|\/\*+|\*|<!--)\s*/, '')
      .replace(/(?:\*\/|-->)\s*$/, '')
      .replace(/^file\s*:\s*/i, '')
      .trim();
    candidates.push(cleaned);
  }

  const extensionByLanguage = {
    javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
    python: 'py', py: 'py', css: 'css', html: 'html', json: 'json', sql: 'sql',
    bash: 'sh', shell: 'sh', sh: 'sh', go: 'go', rust: 'rs', java: 'java', kotlin: 'kt',
    c: 'c', cpp: 'cpp', csharp: 'cs', cs: 'cs', ruby: 'rb', php: 'php', swift: 'swift',
    yaml: 'yaml', yml: 'yml', markdown: 'md', md: 'md'
  };
  const expectedExt = extensionByLanguage[String(language).toLowerCase()] ?? '';

  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|\s|[`'"(])((?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_.@+-]+\.[A-Za-z0-9]{1,10})(?:$|\s|[`'"),:])/);
    if (!match) continue;
    const path = normalizePath(match[1]);
    if (!path) continue;
    if (!expectedExt || path.toLowerCase().endsWith(`.${expectedExt}`) || path.includes('/')) return path;
  }
  return '';
}

export function extensionForLanguage(language = '') {
  const map = {
    javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', python: 'py', py: 'py',
    html: 'html', css: 'css', json: 'json', sql: 'sql', go: 'go', rust: 'rs', java: 'java', kotlin: 'kt',
    bash: 'sh', shell: 'sh', sh: 'sh', yaml: 'yaml', yml: 'yml', markdown: 'md', md: 'md', cpp: 'cpp', c: 'c'
  };
  return map[String(language).toLowerCase()] ?? 'txt';
}

export function extractUserConstraints(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return [];
  const sentences = value.split(/(?<=[.!?])\s+|\n+/u);
  const hardMarker = /\b(?:must|must not|never|always|required|requirement|constraint|do not|don't|avoid|only|strict|non-negotiable|không được|không dùng|không bao giờ|luôn luôn|bắt buộc|phải|tuyệt đối|chỉ được|ưu tiên|nguyên tắc)\b/iu;
  const out = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 12 || trimmed.length > 500 || !hardMarker.test(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= 8) break;
  }
  return out;
}
