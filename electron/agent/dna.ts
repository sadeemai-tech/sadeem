// ============================================================
// Surnia DNA — the closed learning loop (v2.2)
// A persistent, self-updating USER model that travels with the
// app: profile (role/expertise/languages), learned patterns
// (commands/workflows/styles/corrections with repetition-based
// confidence), and explicit feedback. THREE update triggers wire
// into the engine (see engine.ts):
//   1. auto-extraction after a completed run (one no-tools call)
//   2. feedback capture (approval denials + kdx:dna:feedback)
//   3. agent self-recording via the dna_note tool
// Plus cross-session recall (recall_memory tool): a lazily-built
// BM25-lite index over userData/sessions/*.json + DNA patterns.
//
// Storage (owner-only 0600):
//   • global   — <userData>/dna.json
//   • workspace extension — <workspace>/.surnia/dna.json
//     (workspace entries layer ON TOP of global by pattern id)
//   • growth log — <userData>/dna-stats.json [{date, patterns}]
//
// This module self-registers its IPC (kdx:dna:*) following the
// mcp.ts v2 pattern — ipc.ts is not touched. All functions are
// defensive: a DNA failure must never break a run or the app.
// ============================================================
import { promises as fsp } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import type {
  DNAData,
  DNAFeedbackEntry,
  DNAPattern,
  DNAProfile,
  DNARecallHit,
  SessionData,
} from '../../shared/types';

// ---------- constants ----------

const DNA_FILE = 'dna.json';
const STATS_FILE = 'dna-stats.json';

/**
 * v11.34 — HONEST, DOCUMENTED BOUNDS.
 * The active model is bounded because it is injected into a system prompt;
 * "bounded" must NEVER mean "stopped learning". At the cap we EVICT the oldest,
 * most-reinforced patterns and KEEP every brand-new fact (capPatternsLossless),
 * exactly like memory/playbook. `stats.factsRecorded` is the cumulative,
 * never-decreasing measure of how much the model has learned; `patterns.length`
 * is only the ACTIVE window (≤ 60). Nothing pretends to be unlimited.
 * Kept as LITERAL numbers (not derived) so the bound is grep-able and honest.
 */
const MAX_PATTERNS = 60;
const MAX_FEEDBACK = 40;
const MAX_PROFILE_ITEMS = 20;
const TEXT_CAP = 240; // per pattern/feedback note

/** v11.34 — exported, documented view of the same bounds (tests/UI honest copy). */
export const DNA_LIMITS = {
  maxPatterns: MAX_PATTERNS,
  maxFeedback: MAX_FEEDBACK,
  maxProfileItems: MAX_PROFILE_ITEMS,
  /** patterns rendered into the DNA prompt body */
  promptPatterns: 8,
  /** of those, slots reserved for the MOST RECENTLY LEARNED facts */
  promptNewPatterns: 4,
  textCap: TEXT_CAP,
} as const;

const RECALL_MAX_SESSIONS = 200;
const RECALL_TIMEOUT_MS = 15_000;
const RECALL_EXCERPT_CHARS = 300;
const STATS_DAYS = 14;
const EMPTY_PROFILE: DNAProfile = { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] };

// ---------- userData (works under the CLI electron stub too) ----------

function userDataDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd(); // non-electron harness — harmless fallback
  }
}

/**
 * v11.31 — Confine EVERY workspace-scoped DNA artifact to <workspace>/.surnia.
 * dna.ts is renderer-reachable (`kdx:dna:clear`, `kdx:dna:get`,
 * `kdx:skills:trust`) and was the ONLY learning module that joined the
 * caller's raw workspace string directly. memory.ts:wsOf() and
 * playbook.ts:workspaceOf() already reject traversal/UNC/device paths; without
 * the same guard here a hostile frame could pass
 * `C:\Workspace\..\..\Users\Public` and delete or write dna.json (or a
 * skills-trust marker) OUTSIDE the workspace. Return '' on any suspicious
 * input — callers treat that as "no workspace layer / no-op".
 */
function workspaceOf(ws: unknown): string {
  if (typeof ws !== 'string' || !ws.trim()) return '';
  const raw = ws.trim();
  if (raw.includes('..') || /^[\\/]{2}/.test(raw)) return '';
  let resolved: string;
  try {
    resolved = path.resolve(raw);
  } catch {
    return '';
  }
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) return '';
  // Allow the Windows drive colon at index 1 (C:\...), reject it elsewhere.
  const body = /^[A-Za-z]:/.test(resolved) ? resolved.slice(2) : resolved;
  if (/[<>:"|?*\x00-\x1f]/.test(body)) return '';
  return resolved;
}

// ---------- schema guard ----------

function emptyDNA(): DNAData {
  return {
    version: 1,
    profile: { ...EMPTY_PROFILE, expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
    patterns: [],
    feedback: [],
    stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
  };
}

function asArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((s) => s.trim());
}

function sanitizeDNA(raw: unknown): DNAData {
  const out = emptyDNA();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<DNAData> & Record<string, unknown>;
  const p = (r.profile ?? {}) as Partial<DNAProfile>;
  const profile: DNAProfile = {
    ...(typeof p.name === 'string' && p.name.trim() ? { name: p.name.trim().slice(0, 80) } : {}),
    ...(typeof p.role === 'string' && p.role.trim() ? { role: p.role.trim().slice(0, 120) } : {}),
    expertise: asArray(p.expertise).slice(0, MAX_PROFILE_ITEMS),
    languages: asArray(p.languages).slice(0, MAX_PROFILE_ITEMS),
    likes: asArray(p.likes).slice(0, MAX_PROFILE_ITEMS),
    dislikes: asArray(p.dislikes).slice(0, MAX_PROFILE_ITEMS),
    styleNotes: asArray(p.styleNotes).slice(0, MAX_PROFILE_ITEMS),
  };
  const patterns: DNAPattern[] = (Array.isArray(r.patterns) ? (r.patterns as unknown[]) : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => {
      const kind: DNAPattern['kind'] = x.kind === 'command' || x.kind === 'workflow' || x.kind === 'style' || x.kind === 'correction' ? x.kind : 'workflow';
      const count = Math.max(1, Math.min(10_000, Math.floor(Number(x.count) || 1)));
      const now = Date.now();
      return {
        id: typeof x.id === 'string' && x.id ? x.id.slice(0, 64) : randomUUID(),
        kind,
        text: typeof x.text === 'string' ? x.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP) : '',
        count,
        firstSeen: typeof x.firstSeen === 'number' ? x.firstSeen : now,
        lastSeen: typeof x.lastSeen === 'number' ? x.lastSeen : now,
        confidence: Math.max(0, Math.min(0.95, Number(x.confidence) || 0.4)),
      };
    })
    .filter((x) => !!x.text);
  const feedback = (Array.isArray(r.feedback) ? (r.feedback as unknown[]) : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x): DNAFeedbackEntry => ({
      ts: typeof x.ts === 'number' ? x.ts : Date.now(),
      kind: x.kind === 'praise' || x.kind === 'correction' || x.kind === 'preference' ? x.kind : 'correction',
      note: typeof x.note === 'string' ? x.note.replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP) : '',
      ...(typeof x.context === 'string' && x.context.trim() ? { context: x.context.slice(0, 300) } : {}),
    }))
    .filter((x) => !!x.note);
  return {
    version: 1,
    profile,
    patterns,
    feedback,
    stats: {
      sessionsObserved: Math.max(0, Math.floor(Number((r.stats as DNAData['stats'])?.sessionsObserved) || 0)),
      factsRecorded: Math.max(0, Math.floor(Number((r.stats as DNAData['stats'])?.factsRecorded) || 0)),
      updatedAt: typeof r.stats?.updatedAt === 'number' ? r.stats.updatedAt : 0,
    },
  };
}

// ---------- read / write (serialized to avoid read-modify-write races) ----------

let writeChain: Promise<unknown> = Promise.resolve();

function readJsonSafe(file: string): unknown {
  try {
    const raw = fsSync.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Serialized read-modify-write — every DNA mutation funnels through here. */
function mutate<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

function globalDNAPath(): string {
  return path.join(userDataDir(), DNA_FILE);
}

/** '' when the workspace is not a safe absolute path — never a relative CWD path. */
function workspaceDNAPath(workspace: string): string {
  const ws = workspaceOf(workspace);
  return ws ? path.join(ws, '.surnia', DNA_FILE) : '';
}

function readDNAFile(file: string): DNAData | null {
  const raw = readJsonSafe(file);
  return raw ? sanitizeDNA(raw) : null;
}

/** Global-only read for MUTATORS (never fold the workspace layer back into global). */
function readGlobalDNA(): DNAData {
  return readDNAFile(globalDNAPath()) ?? emptyDNA();
}

function writeDNAFile(file: string, dna: DNAData): void {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, JSON.stringify(dna, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/** Merge the workspace layer ON TOP of the global model (patterns keyed by id). */
function mergeDNA(global: DNAData | null, workspace: DNAData | null): DNAData {
  const g = global ?? emptyDNA();
  const w = workspace;
  if (!w) return g;
  const byId = new Map(g.patterns.map((p) => [p.id, p]));
  for (const p of w.patterns) {
    const existing = byId.get(p.id);
    if (!existing || p.lastSeen > existing.lastSeen) byId.set(p.id, p);
  }
  const fb = new Map(g.feedback.map((f) => [f.ts + '|' + f.note, f]));
  for (const f of w.feedback) fb.set(f.ts + '|' + f.note, f);
  const mergedProfile: DNAProfile = {
    ...(g.profile.name || w.profile.name ? { name: w.profile.name || g.profile.name } : {}),
    ...(g.profile.role || w.profile.role ? { role: w.profile.role || g.profile.role } : {}),
    expertise: dedupeStrings([...w.profile.expertise, ...g.profile.expertise]),
    languages: dedupeStrings([...w.profile.languages, ...g.profile.languages]),
    likes: dedupeStrings([...w.profile.likes, ...g.profile.likes]),
    dislikes: dedupeStrings([...w.profile.dislikes, ...g.profile.dislikes]),
    styleNotes: dedupeStrings([...w.profile.styleNotes, ...g.profile.styleNotes]),
  };
  return {
    version: 1,
    profile: mergedProfile,
    patterns: [...byId.values()],
    feedback: [...fb.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_FEEDBACK * 2),
    stats: {
      sessionsObserved: g.stats.sessionsObserved + w.stats.sessionsObserved,
      factsRecorded: g.stats.factsRecorded + w.stats.factsRecorded,
      updatedAt: Math.max(g.stats.updatedAt, w.stats.updatedAt),
    },
  };
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, 120));
  }
  return out.slice(0, MAX_PROFILE_ITEMS);
}

/** Merged view (global + workspace layer). Never throws. */
export function loadDNA(workspace?: string): DNAData {
  try {
    const g = readDNAFile(globalDNAPath());
    let w: DNAData | null = null;
    if (workspace) {
      const wp = workspaceDNAPath(workspace);
      if (wp) w = readDNAFile(wp); // hostile workspace → global-only view, never a CWD-relative read
    }
    return mergeDNA(g, w);
  } catch {
    return emptyDNA();
  }
}

/** Persist to the global file (workspace layer is read-only here). */
export function saveDNA(dna: DNAData): void {
  const clean = sanitizeDNA(dna);
  clean.stats.updatedAt = Date.now();
  writeDNAFile(globalDNAPath(), clean);
  logStats(clean.patterns.length, clean.stats.factsRecorded);
  // v11.31 — a programmatic global write MUST not leave the renderer stale.
  // The store only reloads DNA on kdx:dna:event (src/store.ts:onDnaEvent), so
  // profile-import / setter writes that used to be silent now refresh it.
  emitDNAEvent('updated', { reason: 'save' });
}

/**
 * v6 — FORGET: remove learned patterns + feedback entries whose text contains
 * the query (case/space-insensitive substring — mirrors the remember verbs).
 * Scans BOTH layers (workspace DNA when a workspace is open, and the global
 * model). Returns the number of entries removed (0 when nothing matched).
 * Never throws.
 */
export function forgetMemory(workspace: string | undefined, query: string): number {
  const q = String(query ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return 0;
  let removed = 0;
  const targets: string[] = [];
  if (workspace) {
    const wp = workspaceDNAPath(workspace);
    if (wp) targets.push(wp); // v11.31 — never write via a traversal workspace
  }
  targets.push(globalDNAPath());
  for (const file of targets) {
    try {
      const dna = readDNAFile(file);
      if (!dna) continue;
      const before = dna.patterns.length + dna.feedback.length;
      dna.patterns = dna.patterns.filter((p) => !p.text.toLowerCase().includes(q));
      dna.feedback = dna.feedback.filter((f) => !f.note.toLowerCase().includes(q));
      const delta = before - (dna.patterns.length + dna.feedback.length);
      if (delta > 0) {
        writeDNAFile(file, dna);
        removed += delta;
      }
    } catch {
      /* per-layer best-effort */
    }
  }
  // v11.31 — the `memory_forget` tool (electron/agent/tools.ts:2929) calls this
  // directly. It used to rewrite dna.json with NO event, so the DNA panel and
  // /dna stayed stale until restart. Notify the store like every other writer.
  if (removed > 0) emitDNAEvent('updated', { reason: 'forget' });
  return removed;
}

// ---------- growth log (14-day series for kdx:dna:stats) ----------

interface StatRow {
  date: string;
  /** ACTIVE patterns in the bounded window (≤ DNA_LIMITS.maxPatterns). */
  patterns: number;
  /**
   * v11.34 — cumulative facts learned (never decreases). The growth chart must
   * plot THIS, not `patterns`: once the active window hits 60, plotting the
   * capped count flattens at 60 and looks exactly like "DNA stopped learning".
   */
  facts?: number;
}

function logStats(patternCount: number, factsCount = patternCount): void {
  try {
    const file = path.join(userDataDir(), STATS_FILE);
    const date = new Date().toISOString().slice(0, 10);
    const rows: StatRow[] = Array.isArray(readJsonSafe(file)) ? (readJsonSafe(file) as StatRow[]) : [];
    const last = rows[rows.length - 1];
    if (last && last.date === date) {
      last.patterns = patternCount;
      last.facts = factsCount;
    } else rows.push({ date, patterns: patternCount, facts: factsCount });
    fsSync.mkdirSync(userDataDir(), { recursive: true });
    fsSync.writeFileSync(file, JSON.stringify(rows.slice(-90), null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* stats are best-effort */
  }
}

// ---------- extraction merge (dedupe + confidence + prune) ----------

/**
 * v11.34 — dedupe on the FULL normalized fact, not a 48-char prefix.
 * The old prefix key silently MERGED genuinely different facts that happened
 * to start alike ("Always run typecheck before X" vs "…before Y"): the second
 * fact became a count++ instead of a new pattern, so learning silently stalled
 * even below the cap. Exact repeats still dedupe (no re-learning the same
 * fact); distinct facts now survive. TEXT_CAP keeps the key bounded.
 */
function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP);
}

export interface ExtractionInput {
  profile_additions?: {
    name?: string;
    role?: string;
    expertise?: string[];
    languages?: string[];
    likes?: string[];
    dislikes?: string[];
    styleNotes?: string[];
  };
  patterns_additions?: { kind?: string; text?: string }[];
}

/**
 * v11.27 — ONE bounded-cap eviction policy, identical to memory's
 * `capFactsLossless` and the playbook's `capSection`: when a category overflows,
 * drop the OLDEST, MOST-REINFORCED entries (patterns we already know well) and
 * KEEP the newly learned ones. The old policy here sorted by
 * `confidence × recency` and sliced to MAX_PATTERNS, which ALWAYS evicted a
 * brand-new low-confidence pattern (0.4) first whenever the model was full of
 * reinforced patterns (0.95) — the exact silent-drop bug that silently made
 * DNA "stop learning" after ~60 patterns. New facts must never be dropped.
 */
function capPatternsLossless(patterns: DNAPattern[]): DNAPattern[] {
  if (patterns.length <= MAX_PATTERNS) return patterns;
  // Higher `forget` = safer to forget (more reinforced, then older).
  const forget = (p: DNAPattern): number => (p.count ?? 1) * 1000 - (p.lastSeen ?? 0) / 1e9;
  return [...patterns]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => forget(b.p) - forget(a.p) || a.i - b.i)
    .slice(patterns.length - MAX_PATTERNS)
    .map((x) => x.p);
}

/**
 * Merge one extraction batch into the existing model.
 * - patterns dedupe by FULL normalized text (v11.34 — a 48-char prefix used to
 *   absorb genuinely new facts that shared a beginning) → count++ →
 *   confidence = min(0.95, 0.4 + 0.15×count)
 * - prune to DNA_LIMITS.maxPatterns evicting the OLDEST, MOST-REINFORCED
 *   patterns and keeping every brand-new fact (capPatternsLossless) — learning
 *   continues across arbitrarily long sessions, bounded not frozen.
 * - profile arrays dedupe (workspace additions win)
 * Returns whether anything actually changed.
 */
export function mergeExtraction(existing: DNAData, extracted: ExtractionInput): { dna: DNAData; changed: boolean } {
  const dna = sanitizeDNA(existing);
  let changed = false;

  // ---------- profile additions ----------
  const pa = extracted?.profile_additions;
  if (pa && typeof pa === 'object') {
    const setField = (field: 'expertise' | 'languages' | 'likes' | 'dislikes' | 'styleNotes', values?: string[]): void => {
      const fresh = asArray(values);
      if (!fresh.length) return;
      const before = (dna.profile[field] as string[]).length;
      dna.profile[field] = dedupeStrings([...(dna.profile[field] as string[]), ...fresh]);
      if (dna.profile[field].length !== before) changed = true;
    };
    setField('expertise', pa.expertise);
    setField('languages', pa.languages);
    setField('likes', pa.likes);
    setField('dislikes', pa.dislikes);
    setField('styleNotes', pa.styleNotes);
    if (typeof pa.name === 'string' && pa.name.trim() && !dna.profile.name) {
      dna.profile.name = pa.name.trim().slice(0, 80);
      changed = true;
    }
    if (typeof pa.role === 'string' && pa.role.trim() && !dna.profile.role) {
      dna.profile.role = pa.role.trim().slice(0, 120);
      changed = true;
    }
  }

  // ---------- pattern additions ----------
  const byText = new Map(dna.patterns.map((p) => [dedupeKey(p.text), p]));
  for (const add of Array.isArray(extracted?.patterns_additions) ? extracted.patterns_additions : []) {
    const text = typeof add?.text === 'string' ? add.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length < 4) continue;
    const kind: DNAPattern['kind'] =
      add?.kind === 'command' || add?.kind === 'workflow' || add?.kind === 'style' || add?.kind === 'correction'
        ? add.kind
        : 'workflow';
    const key = dedupeKey(text);
    const hit = byText.get(key);
    const now = Date.now();
    if (hit) {
      hit.count += 1;
      hit.lastSeen = now;
      hit.confidence = Math.min(0.95, 0.4 + 0.15 * hit.count);
      if (kind !== hit.kind && kind === 'correction') hit.kind = 'correction'; // a correction hardens the label
      changed = true;
    } else {
      const p: DNAPattern = {
        id: randomUUID(),
        kind,
        text: text.slice(0, TEXT_CAP),
        count: 1,
        firstSeen: now,
        lastSeen: now,
        confidence: 0.4,
      };
      dna.patterns.push(p);
      byText.set(key, p);
      dna.stats.factsRecorded += 1;
      changed = true;
    }
  }

  if (changed) {
    // v11.27 — lossless cap: evict the oldest MOST-REINFORCED patterns, keep
    // every newly learned one (see capPatternsLossless). The old confidence×
    // recency sort silently dropped new low-confidence patterns at the cap.
    dna.patterns = capPatternsLossless(dna.patterns);
    dna.feedback = dna.feedback.slice(0, MAX_FEEDBACK);
    dna.stats.updatedAt = Date.now();
  }
  return { dna, changed };
}

/**
 * Engine-side entry: merge one extraction batch into the GLOBAL model,
 * bump sessionsObserved (one observed session per completed run) and
 * persist. Serialized with the other DNA writes. Returns whether the
 * model actually changed.
 */
export async function mergeExtractionInto(_workspace: string, extracted: ExtractionInput): Promise<boolean> {
  return mutate(() => {
    const existing = readGlobalDNA();
    const { dna: merged, changed } = mergeExtraction(existing, extracted);
    merged.stats.sessionsObserved = Math.max(0, merged.stats.sessionsObserved) + 1;
    merged.stats.updatedAt = Date.now();
    writeDNAFile(globalDNAPath(), merged);
    logStats(merged.patterns.length, merged.stats.factsRecorded);
    emitDNAEvent('updated', { reason: changed ? 'extraction' : 'session' });
    return changed;
  });
}

// ---------- feedback ----------

export async function recordFeedback(kind: 'praise' | 'correction' | 'preference', note: string, context?: string): Promise<boolean> {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return mutate(() => {
    const dna = readGlobalDNA();
    const entry: DNAFeedbackEntry = {
      ts: Date.now(),
      kind: kind === 'praise' || kind === 'preference' ? kind : 'correction',
      note: text.slice(0, TEXT_CAP),
      ...(context ? { context: context.slice(0, 300) } : {}),
    };
    // exact dedupe on the same note within the last hour
    if (dna.feedback.some((f) => f.note === entry.note && entry.ts - f.ts < 3_600_000)) return false;
    dna.feedback = [entry, ...dna.feedback].slice(0, MAX_FEEDBACK);
    dna.stats.updatedAt = Date.now();
    writeDNAFile(globalDNAPath(), dna);
    logStats(dna.patterns.length, dna.stats.factsRecorded);
    return true;
  });
}

/**
 * v2.2 — the dna_note TOOL entry point. A durable agent-recorded fact becomes
 * BOTH a pattern (so repetition raises confidence and mature workflows can be
 * suggested as skills) AND a feedback entry (feeds the recent-feedback list
 * in the prompt). kind mapping: preference → 'style', correction →
 * 'correction', workflow → 'workflow'. Returns false only on duplicates.
 */
export async function recordAgentNote(
  kind: 'preference' | 'correction' | 'workflow',
  note: string,
): Promise<boolean> {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const patternKind: DNAPattern['kind'] = kind === 'workflow' ? 'workflow' : kind === 'correction' ? 'correction' : 'style';
  return mutate(() => {
    const dna = readGlobalDNA();
    const { dna: merged, changed } = mergeExtraction(dna, {
      patterns_additions: [{ kind: patternKind, text }],
    });
    if (!changed) return false; // duplicate pattern — nothing new
    merged.feedback = [
      {
        ts: Date.now(),
        kind: kind === 'preference' ? 'preference' : kind === 'correction' ? 'correction' : 'preference',
        note: text.slice(0, TEXT_CAP),
        context: 'dna_note tool',
      } as DNAData['feedback'][number],
      ...merged.feedback,
    ].slice(0, MAX_FEEDBACK);
    writeDNAFile(globalDNAPath(), merged);
    logStats(merged.patterns.length, merged.stats.factsRecorded);
    // v11.27 — a tool write MUST notify the renderer. Without this the DNA
    // panel and /dna stayed stale until restart (the founder's "DNA لا يعمل").
    emitDNAEvent('updated', { reason: 'note' });
    return true;
  });
}

// ---------- prompt rendering (≤2000 chars, high-signal) ----------

/** Confidence × recency ranking used by both rendering and suggestions. */
function patternScore(p: DNAPattern): number {
  return p.confidence * Math.exp(-(Date.now() - p.lastSeen) / (21 * 86_400_000));
}

/**
 * v11.35 — the render budget, spent top-down by priority. The old builder joined
 * every line and then did `out.slice(0, 1970)`. That is a SILENT mid-line cut:
 * with a realistic profile + 8 real-length patterns the cumulative LEARNING
 * STATUS, the dna_note directive and ALL feedback were thrown away (measured:
 * rendered 1984 chars, `CONTINUOUS LEARNING`/`dna_note`/feedback all absent).
 * The founding complaint "it stopped learning / stuck at 60" is exactly what
 * this looks like from inside the prompt: the model never receives the signal
 * that DNA keeps growing. CRITICAL lines + the newest facts are now guaranteed
 * to survive; lower-priority lines are dropped whole with an honest marker.
 */
const DNA_RENDER_MAX_CHARS = 2000;
const DNA_RENDER_TRUNCATED = '\n… [truncated — newest facts kept; older reinforced facts retired]';

/** Render the "# User DNA" system-prompt section body (empty string → omit section). */
export function renderDNAPrompt(dna: DNAData): string {
  // v2.3 — the ENTIRE section is advisory. v2.2 let weaker models read raw
  // "dislikes:" / "[correction]" lines as bans ("you disliked it so I can't").
  // The header below is the contract: DNA steers defaults, never permissions.

  // v11.34 — GUARANTEE newly learned facts reach the NEXT system prompt.
  // The old code ranked ONLY by confidence×recency and took the top 8. Once the
  // model held 8 reinforced (0.95) recent patterns, a brand-new fact (0.4)
  // could never enter the window → the model literally stopped seeing new
  // learning → founder: "بطل يتعلم النموذج, خلص وقف على عدد معين". Reserve
  // promptNewPatterns slots for the most recently FIRST-SEEN facts, then fill
  // the rest by score. Index is the final tie-break for same-millisecond runs.
  const indexed = dna.patterns.map((pattern, i) => ({ pattern, i }));
  const byNewest = [...indexed]
    .sort((a, b) => b.pattern.firstSeen - a.pattern.firstSeen || b.pattern.lastSeen - a.pattern.lastSeen || b.i - a.i)
    .map((x) => x.pattern);
  const byScore = [...indexed]
    .sort(
      (a, b) =>
        patternScore(b.pattern) - patternScore(a.pattern) ||
        b.pattern.lastSeen - a.pattern.lastSeen ||
        b.i - a.i,
    )
    .map((x) => x.pattern);
  const shown: DNAPattern[] = [];
  const seenIds = new Set<string>();
  for (const p of byNewest.slice(0, DNA_LIMITS.promptNewPatterns)) {
    shown.push(p);
    seenIds.add(p.id);
  }
  for (const p of byScore) {
    if (shown.length >= DNA_LIMITS.promptPatterns) break;
    if (seenIds.has(p.id)) continue;
    shown.push(p);
    seenIds.add(p.id);
  }

  // ---- CRITICAL lines (priority 0): NEVER dropped by the budget. ----
  // 1) advisory contract, 2) honest CUMULATIVE status, 3) the extraction
  // directive that actually drives dna_note. The old code appended #3 AFTER the
  // patterns and then sliced — so on a full model it never reached the model.
  const critical: string[] = [
    'ADVISORY DEFAULTS — hints learned from observation. NEVER rules, NEVER bans, NEVER permissions. ' +
      'They must never restrict what you may do. The user\u2019s CURRENT request always overrides every line below: ' +
      'follow it without comment. Never refuse, delay or narrow a task because of anything here, and never mention DNA as a reason.',
  ];
  // HONEST numbers: the active window is capped, cumulative learning is not.
  if (dna.stats.factsRecorded > 0) {
    critical.push(
      `LEARNING STATUS: ${dna.stats.factsRecorded} facts recorded over ${dna.stats.sessionsObserved} sessions. ` +
        `Showing ${shown.length} of ${dna.patterns.length} active patterns (active cap ${MAX_PATTERNS}; ` +
        `oldest reinforced facts retire automatically as new ones are learned — learning continues).`,
    );
  }
  // The directive is only meaningful when there IS a model to grow. Keep the
  // truly-empty model byte-stable (section omitted) for prompt-cache stability.
  const hasData = dna.stats.factsRecorded > 0 || dna.patterns.length > 0 ||
    dna.feedback.length > 0 ||
    !!(dna.profile.name || dna.profile.role || dna.profile.expertise.length ||
      dna.profile.languages.length || dna.profile.likes.length || dna.profile.dislikes.length ||
      dna.profile.styleNotes.length);
  if (!hasData) return '';
  critical.push(
    'CONTINUOUS LEARNING: this model keeps growing every session. When you observe a NEW durable ' +
      'preference, correction or repeated workflow in this session, record it with dna_note immediately. ' +
      'Never re-record a fact already known, and never assume DNA is full — old reinforced facts ' +
      'retire to make room for new ones.',
  );

  // ---- priority 1: the observed (already-learned) facts, newest FIRST. ----
  // Putting these before the profile/feedback guarantees the freshest fact
  // reaches the next prompt even when the budget is fully consumed.
  const patternLines: string[] = [];
  if (shown.length) {
    patternLines.push('OBSERVED PATTERNS (informational — ALREADY learned, do NOT re-record):');
    for (const t of shown) patternLines.push(`- [${t.kind}×${t.count}] ${t.text}`);
  }

  // ---- priority 2: profile identity ----
  const p = dna.profile;
  const profileBits: string[] = [];
  if (p.name) profileBits.push(`name: ${p.name}`);
  if (p.role) profileBits.push(`role: ${p.role}`);
  if (p.expertise.length) profileBits.push(`expertise: ${p.expertise.slice(0, 6).join(', ')}`);
  if (p.languages.length) profileBits.push(`languages: ${p.languages.slice(0, 6).join(', ')}`);
  if (p.likes.length) profileBits.push(`prefers: ${p.likes.slice(0, 4).join(', ')}`);
  if (p.dislikes.length) profileBits.push(`sometimes prefers to avoid (DEFAULT ONLY — always yield to the current request): ${p.dislikes.slice(0, 4).join(', ')}`);
  for (const s of p.styleNotes.slice(0, 4)) profileBits.push(`style: ${s}`);
  const profileLines: string[] = [];
  if (profileBits.length) {
    profileLines.push('PROFILE:');
    profileLines.push(...profileBits.map((b) => `- ${b}`));
  }

  // ---- priority 3: recent single-event feedback ----
  const feedbackLines: string[] = [];
  if (dna.feedback.length) {
    feedbackLines.push('RECENT FEEDBACK (single events — not standing instructions, not bans):');
    for (const f of dna.feedback.slice(0, 5)) {
      const advisory = f.context === 'one-time denial' ? ' [once — may be routine review]' : '';
      feedbackLines.push(`- [${f.kind}] ${f.note}${advisory}`);
    }
  }

  // Spend the budget TOP-DOWN, line by line — never mid-line. A line that does
  // not fit is skipped whole (and the next, shorter one still gets a chance),
  // so no section is ever left as a half-word fragment like the old slice().
  let out = critical.join('\n');
  let budget = DNA_RENDER_MAX_CHARS - DNA_RENDER_TRUNCATED.length - out.length;
  let truncated = false;
  for (const section of [patternLines, profileLines, feedbackLines]) {
    for (const line of section) {
      const cost = line.length + 1; // + '\n'
      if (cost > budget) {
        truncated = true;
        continue;
      }
      out += '\n' + line;
      budget -= cost;
    }
  }
  if (truncated) out += DNA_RENDER_TRUNCATED;
  return out;
}

// ---------- clear / stats ----------

export function clearDNA(scope: 'all' | 'workspace', workspace?: string): { cleared: boolean } {
  try {
    if (scope === 'workspace' && workspace) {
      const wp = workspaceDNAPath(workspace);
      if (!wp) return { cleared: false }; // v11.31 — refuse traversal/UNC workspaces
      try {
        fsSync.unlinkSync(wp);
      } catch {
        /* no workspace layer */
      }
      return { cleared: true };
    }
    try {
      fsSync.unlinkSync(globalDNAPath());
    } catch {
      /* already gone */
    }
    try {
      fsSync.unlinkSync(path.join(userDataDir(), STATS_FILE));
    } catch {
      /* already gone */
    }
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

export function dnaStats(workspace?: string): {
  sessionsObserved: number;
  /** ACTIVE window size (bounded by DNA_LIMITS.maxPatterns). */
  patterns: number;
  /** v11.34 — cumulative facts learned; keeps rising after the cap. */
  factsRecorded: number;
  /** v11.35 — the honest bound, surfaced so the UI can label `patterns` as ACTIVE. */
  patternCap: number;
  /** v11.35 — true once the active window is full; learning still continues. */
  atCap: boolean;
  feedback: number;
  growth: { date: string; count: number }[];
} {
  const dna = loadDNA(workspace);
  let rows: StatRow[] = [];
  try {
    const raw = readJsonSafe(path.join(userDataDir(), STATS_FILE));
    if (Array.isArray(raw)) rows = raw as StatRow[];
  } catch {
    /* empty series */
  }
  // Prefer cumulative facts (never plateaus at the active cap); old rows
  // without `facts` fall back to their historical pattern count.
  const byDate = new Map(rows.map((r) => [r.date, r.facts ?? r.patterns]));
  const growth: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = STATS_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    growth.push({ date: d, count: byDate.get(d) ?? 0 });
  }
  return {
    sessionsObserved: dna.stats.sessionsObserved,
    patterns: dna.patterns.length,
    factsRecorded: dna.stats.factsRecorded,
    // v11.35 — make the distinction explicit at the data boundary. The
    // founder's "stuck at 60" is the ACTIVE window, not the learning counter;
    // surfaces that only show `patterns` must label it active and show
    // `factsRecorded` as the headline growth number.
    patternCap: MAX_PATTERNS,
    atCap: dna.patterns.length >= MAX_PATTERNS,
    feedback: dna.feedback.length,
    growth,
  };
}

// ---------- cross-session recall (recall_memory tool) ----------

interface IndexedDoc {
  text: string;
  role: 'user' | 'assistant' | 'tool';
}

interface SessionIndexEntry {
  mtimeMs: number;
  title: string;
  timestamp: number;
  docs: IndexedDoc[];
}

const sessionIndex = new Map<string, SessionIndexEntry>(); // sessionId → entry (mtime-checked)
let indexStamp = 0; // rebuild guard — the dir listing is re-scanned at most every 10s

function sessionsDir(): string {
  return path.join(userDataDir(), 'sessions');
}

/** Lazy index over the newest 200 sessions; mtime-checked per session, 10s dir-list throttle. */
async function buildSessionIndex(): Promise<void> {
  const now = Date.now();
  if (now - indexStamp < 10_000 && sessionIndex.size) return;
  indexStamp = now;
  const dir = sessionsDir();
  type StatEntry = { file: string; mtimeMs: number };
  let entries: StatEntry[] = [];
  try {
    const names = await fsp.readdir(dir);
    await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .slice(0, 1000)
        .map(async (n) => {
          try {
            const st = await fsp.stat(path.join(dir, n));
            entries.push({ file: n, mtimeMs: st.mtimeMs });
          } catch {
            /* raced delete */
          }
        }),
    );
  } catch {
    return; // no sessions yet
  }
  entries = entries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECALL_MAX_SESSIONS);
  const keep = new Set(entries.map((e) => e.file));
  for (const key of [...sessionIndex.keys()]) if (!keep.has(key)) sessionIndex.delete(key);
  await Promise.all(
    entries.map(async ({ file, mtimeMs }) => {
      const cached = sessionIndex.get(file);
      if (cached && cached.mtimeMs === mtimeMs) return; // mtime hit — reuse
      try {
        const raw = await fsp.readFile(path.join(dir, file), 'utf8');
        if (raw.length > 8 * 1024 * 1024) return; // sanity cap
        const parsed = JSON.parse(raw) as Partial<SessionData>;
        const docs: IndexedDoc[] = [];
        for (const m of (parsed.messages ?? []).slice(-300)) {
          if (!m || typeof m.content !== 'string' || !m.content.trim()) continue;
          const role: IndexedDoc['role'] =
            m.kind === 'tool_call' || m.kind === 'tool_result' || m.role === 'tool'
              ? 'tool'
              : m.role === 'assistant'
                ? 'assistant'
                : 'user';
          const cap = role === 'tool' ? 400 : 2000;
          docs.push({ text: m.content.slice(0, cap), role });
        }
        sessionIndex.set(file, {
          mtimeMs,
          title: parsed.title || 'Untitled',
          timestamp: parsed.updatedAt ?? parsed.createdAt ?? mtimeMs,
          docs,
        });
      } catch {
        /* corrupt session — skip */
      }
    }),
  );
}

function tokenize(q: string): string[] {
  return (q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
}

/** Best-matching ≤300-char window around the densest term cluster. */
function excerptAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let best = -1;
  let bestScore = -1;
  for (const t of terms) {
    const at = lower.indexOf(t);
    if (at >= 0) {
      // prefer windows containing multiple terms
      let s = 0;
      for (const t2 of terms) if (lower.slice(Math.max(0, at - 150), at + 150).includes(t2)) s++;
      if (s > bestScore) {
        bestScore = s;
        best = at;
      }
    }
  }
  const start = Math.max(0, (best < 0 ? 0 : best) - 80);
  let out = text.slice(start, start + RECALL_EXCERPT_CHARS).replace(/\s+/g, ' ').trim();
  if (start > 0) out = '…' + out;
  if (start + RECALL_EXCERPT_CHARS < text.length) out += '…';
  return out;
}

/**
 * Cross-session recall: BM25-lite term overlap over the newest ≤200 sessions
 * (assistant/user text boosted over tool output) + DNA pattern matches.
 * 15s hard timeout; huge histories degrade gracefully (newest 200 only).
 */
export async function recallMemory(workspace: string | undefined, query: string, limit = 4): Promise<DNARecallHit[]> {
  const cap = Math.max(1, Math.min(8, Math.floor(Number(limit) || 4)));
  const terms = tokenize(query);
  if (!terms.length) return [];
  try {
    const work = (async (): Promise<DNARecallHit[]> => {
      await buildSessionIndex();
      const hits: DNARecallHit[] = [];
      for (const [file, entry] of sessionIndex) {
        let score = 0;
        let bestText = '';
        for (const doc of entry.docs) {
          const lower = doc.text.toLowerCase();
          let docScore = 0;
          for (const t of terms) {
            const n = lower.split(t).length - 1;
            if (n > 0) docScore += Math.log(1 + n); // sublinear tf
          }
          if (!docScore) continue;
          docScore *= doc.role === 'tool' ? 0.6 : doc.role === 'assistant' ? 1.2 : 1.3;
          if (docScore > score) {
            score = docScore;
            bestText = doc.text;
          }
        }
        if (score <= 0) continue;
        hits.push({
          sessionId: file.replace(/\.json$/, ''),
          sessionTitle: entry.title,
          timestamp: entry.timestamp,
          excerpt: excerptAround(bestText, terms),
          score: Math.round(score * 100) / 100,
        });
      }
      // DNA patterns matching the query get a small standing boost.
      const dna = loadDNA(workspace);
      for (const p of dna.patterns) {
        const lower = p.text.toLowerCase();
        let overlap = 0;
        for (const t of terms) if (lower.includes(t)) overlap++;
        if (overlap >= Math.max(1, Math.ceil(terms.length / 3))) {
          hits.push({
            sessionId: 'dna',
            sessionTitle: `DNA pattern (${p.kind}×${p.count})`,
            timestamp: p.lastSeen,
            excerpt: p.text,
            score: 0.5 + overlap / terms.length,
          });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, cap);
    })();
    const timeout = new Promise<DNARecallHit[]>((resolve) => setTimeout(() => resolve([]), RECALL_TIMEOUT_MS));
    return await Promise.race([work, timeout]);
  } catch {
    return [];
  }
}

// ---------- skill suggestion bookkeeping ----------

const dismissedSuggestions = new Set<string>();

export function dismissSuggestion(patternId: string): void {
  const id = String(patternId ?? '').trim();
  if (id) dismissedSuggestions.add(id);
}

export function isSuggestionDismissed(patternId: string): boolean {
  return dismissedSuggestions.has(patternId);
}

// ---------- skills trust gate ----------

export function skillsTrustMarker(workspace: string): string {
  const ws = workspaceOf(workspace);
  return ws ? path.join(ws, '.surnia', 'skills-trusted') : '';
}

/** True when workspace skills may be injected (marker exists). */
export function workspaceSkillsTrusted(workspace: string): boolean {
  const marker = skillsTrustMarker(workspace);
  if (!marker) return false; // v11.31 — refuse traversal/UNC workspaces
  try {
    return fsSync.statSync(marker).isFile();
  } catch {
    return false;
  }
}

/** Create the consent marker (IPC kdx:skills:trust / settings 'always'). */
export function trustWorkspaceSkills(workspace: string): boolean {
  const ws = workspaceOf(workspace);
  if (!ws) return false; // v11.31 — never create a marker outside the workspace
  try {
    fsSync.mkdirSync(path.join(ws, '.surnia'), { recursive: true });
    fsSync.writeFileSync(skillsTrustMarker(ws), new Date().toISOString(), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

// ---------- event broadcast ----------

/** Push a DNA event to every live renderer window (`kdx:dna:event`). */
export function emitDNAEvent(type: 'updated' | 'refined' | 'suggestion' | 'skills-trust', payload?: Record<string, unknown>): void {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('kdx:dna:event', { type, ...(payload ? { payload } : {}) });
    }
  } catch {
    /* app tearing down */
  }
}

// ---------- IPC self-registration (mcp.ts v2 pattern) ----------

let dnaIpcRegistered = false;

function registerDnaIpc(): void {
  if (dnaIpcRegistered) return;
  // The CLI engine runs under plain Node with an electron stub — ipcMain is
  // undefined there. Guard so the agent engine keeps working headless.
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  dnaIpcRegistered = true;
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (_event: unknown, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    });
  };

  // merged DNA (global + workspace layer)
  handle('kdx:dna:get', (workspace?: string) => loadDNA(typeof workspace === 'string' ? workspace : undefined));

  // edit / remove an entry: {section: 'profile'|'patterns'|'feedback', id?, patch}
  handle('kdx:dna:update', (input?: { section?: string; id?: string; patch?: unknown; workspace?: string }) => {
    const section = String(input?.section ?? '');
    const id = String(input?.id ?? '');
    return mutate(async () => {
      const dna = readDNAFile(globalDNAPath()) ?? emptyDNA();
      let ok = false;
      if (section === 'profile' && input?.patch && typeof input.patch === 'object') {
        const patch = input.patch as Partial<DNAProfile>;
        if ('name' in patch) {
          if (typeof patch.name === 'string' && patch.name.trim()) dna.profile.name = patch.name.trim().slice(0, 80);
          else delete dna.profile.name;
        }
        if ('role' in patch) {
          if (typeof patch.role === 'string' && patch.role.trim()) dna.profile.role = patch.role.trim().slice(0, 120);
          else delete dna.profile.role;
        }
        for (const field of ['expertise', 'languages', 'likes', 'dislikes', 'styleNotes'] as const) {
          if (field in patch) dna.profile[field] = asArray(patch[field]).slice(0, MAX_PROFILE_ITEMS);
        }
        ok = true;
      } else if (section === 'patterns' && id) {
        const before = dna.patterns.length;
        if (input?.patch && typeof input.patch === 'object') {
          const patch = input.patch as Partial<DNAPattern>;
          const p = dna.patterns.find((x) => x.id === id);
          if (p) {
            if (typeof patch.text === 'string' && patch.text.trim()) p.text = patch.text.trim().slice(0, TEXT_CAP);
            if (typeof patch.count === 'number') p.count = Math.max(1, Math.floor(patch.count));
            ok = true;
          }
        } else {
          dna.patterns = dna.patterns.filter((x) => x.id !== id); // no patch → remove
        }
        ok = ok || dna.patterns.length !== before;
      } else if (section === 'feedback') {
        if (id) {
          const before = dna.feedback.length;
          dna.feedback = dna.feedback.filter((f) => String(f.ts) !== id && f.note !== id);
          ok = dna.feedback.length !== before;
        } else if (input?.patch && typeof input.patch === 'object') {
          const patch = input.patch as { kind?: string; note?: string };
          const kind = patch.kind === 'praise' || patch.kind === 'preference' ? patch.kind : 'correction';
          ok = await recordFeedback(kind, String(patch.note ?? ''));
          if (ok) emitDNAEvent('updated', { reason: 'feedback' });
        }
      }
      if (ok && section !== 'feedback') {
        dna.stats.updatedAt = Date.now();
        writeDNAFile(globalDNAPath(), dna);
        logStats(dna.patterns.length, dna.stats.factsRecorded);
        emitDNAEvent('updated', { reason: section });
      }
      return { ok };
    });
  });

  // explicit UI feedback (praise / correction / preference)
  handle('kdx:dna:feedback', async (input?: { kind?: string; note?: string; context?: string }) => {
    const kind =
      input?.kind === 'praise' ? 'praise' : input?.kind === 'preference' ? 'preference' : 'correction';
    const ok = await recordFeedback(kind, String(input?.note ?? ''), typeof input?.context === 'string' ? input.context : undefined);
    if (ok) emitDNAEvent('updated', { reason: 'feedback', kind });
    return { ok };
  });

  handle('kdx:dna:clear', (input?: { scope?: string; workspace?: string }) => {
    const scope = input?.scope === 'workspace' ? 'workspace' : 'all';
    const r = clearDNA(scope, typeof input?.workspace === 'string' ? input.workspace : undefined);
    // v11.31 — don't broadcast a refresh for a no-op/refused clear (stale
    // success event); only tell the store when something was actually cleared.
    if (r.cleared) emitDNAEvent('updated', { reason: 'clear', scope });
    return r;
  });

  handle('kdx:dna:stats', (workspace?: string) =>
    dnaStats(typeof workspace === 'string' ? workspace : undefined),
  );

  handle('kdx:dna:dismissSuggestion', (patternId?: string) => {
    dismissSuggestion(String(patternId ?? ''));
    return { ok: true };
  });

  // skills trust gate consent (spec #11)
  handle('kdx:skills:trust', (workspace?: string) => {
    const ws = String(workspace ?? '').trim();
    if (!ws) return { ok: false, error: 'WORKSPACE_REQUIRED' };
    const ok = trustWorkspaceSkills(ws);
    return { ok };
  });
}

/** Called once at boot from main.ts (and lazily by the first engine run). */
export function initDNA(): void {
  registerDnaIpc();
}
