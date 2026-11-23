// ============================================================
// SADEEM v12 — semantic index (offline-first, OPTIONAL provider embeddings)
//
// Two engines, NEVER mixed in one index:
//   • local  — deterministic 256-d hashed bag-of-words (works offline, no deps)
//   • provider — OpenAI-compatible POST /embeddings (when configured in
//     Settings → Embeddings). Vectors are L2-normalized so cosine works.
// The index stores an `engineId` fingerprint; changing engine (or provider,
// model, dims) rebuilds from scratch. A failed provider call falls back to
// local for that build and records the error honestly + a 5-min retry timer.
//
// Contract: never throws to callers — a broken index yields an honest empty
// result + stats (mirrors the CodeIndex contract in codeintel.ts).
// ============================================================
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

export interface SemanticChunk { rel: string; startLine: number; endLine: number; text: string; vec: number[]; mtimeMs: number; size: number }
export interface SemanticHit { rel: string; startLine: number; endLine: number; text: string; score: number }
export interface IndexStats { files: number; chunks: number; engine: 'local' | 'provider'; partial: boolean; error?: string }

const DIM = 256;
const CHUNK_LINES = 40;
const OVERLAP = 6;
const MAX_FILES = 8000;
const MAX_FILE_BYTES = 512 * 1024;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', '__pycache__',
  '.venv', 'venv', 'coverage', '.surnia', '.next', '.nuxt', 'vendor',
]);
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala',
  'sh', 'ps1', 'sql', 'md', 'json', 'yaml', 'yml', 'toml',
]);
const LOCAL_ID = 'local:fnv1a-256:v1';

interface IndexFile {
  engine: 'local' | 'provider';
  engineId?: string;
  retryProviderAt?: number;
  chunks: SemanticChunk[];
  files: Array<{ rel: string; mtimeMs: number; size: number }>;
  updatedAt: number;
}

type EmbedCfg =
  | { engine: 'local'; id: string }
  | {
      engine: 'provider'; id: string; url: string; key?: string;
      model: string; dims?: number; batchSize: number; timeoutMs: number;
    };

/** Resolve the active embedding engine from settings (no key material stored here). */
function resolveCfg(): EmbedCfg {
  try {
    const settings = (require('../services/storeService') as { getSettings(): any }).getSettings();
    const e = settings.embeddings ?? {};
    if (e.enabled === true) {
      const router = require('./router') as {
        configuredProviders(s: any): Array<{ id: string }>;
        refCreds(s: any, ref: { provider: string; model: string }): { apiKey?: string; baseUrl?: string };
      };
      const provId: string | undefined =
        e.provider || router.configuredProviders(settings)[0]?.id;
      if (provId) {
        const creds = router.refCreds(settings, { provider: provId, model: e.model ?? '' });
        const ps = require('../services/providerService') as {
          providerBaseUrl(id: string, override?: string): string;
        };
        const base = ps.providerBaseUrl(provId, creds.baseUrl).replace(/\/+$/, '');
        const keyless = provId === 'ollama' || provId === 'custom';
        if (base && (keyless || creds.apiKey)) {
          const model = e.model ?? 'text-embedding-3-small';
          const dims = e.dims;
          return {
            engine: 'provider',
            id: `provider:${provId}:${model}:${dims ?? 'native'}`,
            url: `${base}/embeddings`, key: creds.apiKey, model, dims,
            batchSize: Math.max(1, Math.min(128, Number(e.batchSize) || 64)),
            timeoutMs: Number(e.timeoutMs) || 15_000,
          };
        }
      }
    }
  } catch {
    /* settings unavailable — offline local engine */
  }
  return { engine: 'local', id: LOCAL_ID };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const l2 = (v: number[]): number[] => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
};

function localEmbed(texts: string[]): number[][] {
  return texts.map((t) => {
    const v = new Array<number>(DIM).fill(0);
    const toks = String(t).toLowerCase().match(/[a-z0-9_\u0600-\u06ff]+/g) ?? [];
    for (const tok of toks) {
      const h = fnv1a(tok);
      const sign = (fnv1a(tok + '#') & 1) ? 1 : -1;
      v[h % DIM] += sign;
    }
    return l2(v);
  });
}

const embedCache = new Map<string, number[]>();
function cachePut(id: string, text: string, vec: number[]): void {
  if (embedCache.size > 4000) embedCache.clear();
  embedCache.set(`${id}\0${text}`, vec);
}

async function providerEmbed(texts: string[], cfg: Extract<EmbedCfg, { engine: 'provider' }>): Promise<number[][]> {
  const out = new Array<number[]>(texts.length);
  const todo: number[] = [];
  texts.forEach((t, i) => {
    const hit = embedCache.get(`${cfg.id}\0${t}`);
    if (hit) out[i] = hit;
    else todo.push(i);
  });
  for (let p = 0; p < todo.length; p += cfg.batchSize) {
    const batch = todo.slice(p, p + cfg.batchSize);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(cfg.url, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
        body: JSON.stringify({
          model: cfg.model, input: batch.map((i) => texts[i]),
          ...(cfg.dims ? { dimensions: cfg.dims } : {}),
        }),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const json = await res.json() as { data?: Array<{ index: number; embedding: number[] }> };
      const rows = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
      if (rows.length !== batch.length) throw new Error('embeddings: row count mismatch');
      batch.forEach((idx, j) => {
        const v = l2(rows[j].embedding);
        out[idx] = v;
        cachePut(cfg.id, texts[idx], v);
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

async function embedTexts(texts: string[], cfg: EmbedCfg): Promise<{ vecs: number[][]; engine: 'local' | 'provider'; error?: string }> {
  if (cfg.engine === 'local') return { vecs: localEmbed(texts), engine: 'local' };
  try {
    const vecs = await providerEmbed(texts, cfg);
    return { vecs, engine: 'provider' };
  } catch (err) {
    // Never mix vector spaces: fall back to the local engine for the WHOLE build.
    return {
      vecs: localEmbed(texts), engine: 'local',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function cosine(a: number[], b: number[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

function chunkText(text: string): Array<{ startLine: number; endLine: number; text: string }> {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: Array<{ startLine: number; endLine: number; text: string }> = [];
  const step = Math.max(1, CHUNK_LINES - OVERLAP);
  for (let i = 0; i < lines.length; i += step) {
    const end = Math.min(lines.length, i + CHUNK_LINES);
    const slice = lines.slice(i, end);
    if (slice.some((l) => l.trim())) out.push({ startLine: i + 1, endLine: end, text: slice.join('\n') });
    if (end === lines.length) break;
  }
  return out;
}

export class SemanticIndex {
  private readonly root: string;
  private readonly file: string;
  private data: IndexFile;
  private statsCache: IndexStats;
  private cfg: EmbedCfg;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, '.surnia', 'semantic-index.json');
    this.data = { engine: 'local', engineId: LOCAL_ID, chunks: [], files: [], updatedAt: 0 };
    this.statsCache = { files: 0, chunks: 0, engine: 'local', partial: false };
    this.cfg = resolveCfg();
  }

  async update(): Promise<IndexStats> {
    try {
      await this.load();
      this.cfg = resolveCfg();
      const now = Date.now();
      const engineChanged = !this.data.engineId || this.data.engineId !== this.cfg.id ||
        (this.cfg.engine === 'provider' && !!this.data.retryProviderAt && now >= this.data.retryProviderAt);
      if (engineChanged) {
        // A different (or retried) engine means the existing vectors are in a
        // different space — discard them completely. Never mix.
        this.data.chunks = [];
        this.data.files = [];
        this.data.engineId = this.cfg.id;
        this.data.engine = this.cfg.engine;
        this.data.retryProviderAt = undefined;
      }

      const files = await this.walk();
      const byPath = new Map(this.data.files.map((f) => [f.rel, f]));
      const keep = new Set<string>();
      for (const f of files) {
        if (f.limit) continue;
        const prev = byPath.get(f.rel);
        if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) continue;
        this.data.chunks = this.data.chunks.filter((c) => c.rel !== f.rel);
        keep.add(f.rel);
      }
      const currentRels = new Set(files.filter((f) => !f.limit).map((f) => f.rel));
      this.data.chunks = this.data.chunks.filter((c) => currentRels.has(c.rel));
      this.data.files = this.data.files.filter((f) => currentRels.has(f.rel));

      const toEmbed: Array<{ rel: string; chunk: { startLine: number; endLine: number; text: string }; mtimeMs: number; size: number }> = [];
      for (const f of files) {
        if (f.limit || !keep.has(f.rel)) continue;
        const abs = path.join(this.root, f.rel);
        let text: string;
        try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
        if (text.includes('\0')) continue;
        for (const chunk of chunkText(text)) toEmbed.push({ rel: f.rel, chunk, mtimeMs: f.mtimeMs, size: f.size });
      }

      let embedError: string | undefined;
      if (toEmbed.length) {
        const { vecs, engine, error } = await embedTexts(toEmbed.map((x) => x.chunk.text), this.cfg);
        embedError = error;
        this.data.engine = engine;
        this.data.engineId = engine === 'provider' ? this.cfg.id : LOCAL_ID;
        this.data.retryProviderAt = error && this.cfg.engine === 'provider'
          ? Date.now() + 5 * 60_000 : undefined;
        toEmbed.forEach((x, i) => this.data.chunks.push({ ...x.chunk, vec: vecs[i], rel: x.rel, mtimeMs: x.mtimeMs, size: x.size }));
      }

      this.data.files = files.filter((f) => !f.limit).map((f) => ({ rel: f.rel, mtimeMs: f.mtimeMs, size: f.size }));
      this.data.updatedAt = Date.now();
      await this.persist();
      this.statsCache = {
        files: this.data.files.length, chunks: this.data.chunks.length,
        engine: this.data.engine, partial: !!embedError, error: embedError,
      };
    } catch (err) {
      this.statsCache = {
        files: this.data.files.length, chunks: this.data.chunks.length,
        engine: this.data.engine, partial: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return this.statsCache;
  }

  async search(query: string, limit = 8): Promise<SemanticHit[]> {
    if (!query.trim() || !this.data.chunks.length) return [];
    let qv: number[];
    if (this.data.engine === 'provider' && this.cfg.engine === 'provider') {
      try { qv = (await providerEmbed([query], this.cfg))[0]; }
      catch { return []; }
    } else {
      qv = localEmbed([query])[0];
    }
    const scored = this.data.chunks.map((c) => ({ c, score: cosine(qv, c.vec) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, Math.min(20, limit)))
      .filter((x) => x.score > 0.02)
      .map((x) => ({ rel: x.c.rel, startLine: x.c.startLine, endLine: x.c.endLine, text: x.c.text, score: x.score }));
  }

  stats(): IndexStats { return { ...this.statsCache }; }

  private async load(): Promise<void> {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as IndexFile;
      if (parsed && Array.isArray(parsed.chunks) && Array.isArray(parsed.files)) this.data = parsed;
    } catch { /* no index yet — build fresh */ }
  }

  private async persist(): Promise<void> {
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(this.file, JSON.stringify(this.data), 'utf8');
    } catch { /* persistence is best-effort; search still works in-memory */ }
  }

  private async walk(): Promise<Array<{ rel: string; mtimeMs: number; size: number; limit?: boolean }>> {
    const out: Array<{ rel: string; mtimeMs: number; size: number; limit?: boolean }> = [];
    const queue = [''];
    while (queue.length && out.length < MAX_FILES) {
      const relDir = queue.shift() ?? '';
      const absDir = relDir ? path.join(this.root, relDir) : this.root;
      let entries: import('node:fs').Dirent[];
      try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (out.length >= MAX_FILES) { out.push({ rel: '', mtimeMs: 0, size: 0, limit: true }); break; }
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        if (e.isDirectory()) { queue.push(rel); continue; }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (!CODE_EXT.has(ext)) continue;
        try {
          const st = await fsp.stat(path.join(absDir, e.name));
          if (st.size > MAX_FILE_BYTES) continue;
          out.push({ rel, mtimeMs: st.mtimeMs, size: st.size });
        } catch { /* skip */ }
      }
    }
    return out;
  }
}

export function shutdownEmbeddings(): void {
  // No long-lived handles; retained for symmetry with lsp shutdown.
}
