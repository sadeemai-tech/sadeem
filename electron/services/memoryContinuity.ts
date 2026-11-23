// ============================================================
// SADEEM v11.35 — HONEST MEMORY CONTINUITY LAYER
// ------------------------------------------------------------
// Founder (ar): "حل ذاكرة الذكاء الاصطناعي واستمراريته ... بطل يتعلم النموذج،
// خلص وقف على عدد معين، بطل يزداد، بطل يتحسن معي"
// ("Fix the AI's memory and continuity ... the model stopped learning, it
// stopped at a certain number, it doesn't grow, it doesn't improve with me.")
//
// WHY A SEPARATE LAYER (see docs/MEMORY-CONTINUITY-V1135.md for the full audit)
// --------------------------------------------------------------------------
// The existing subsystems each survive *part* of a restart:
//   • <ws>/.surnia/memory-snapshot.json  — compaction-derived facts, injected
//     into the next prompt through playbook.renderPlaybookPrompt.
//   • MEMORY.md '## Remembered'          — written by the `remember` tool, but
//     prompts.ts:961 SUPPRESSES opts.memory whenever the playbook carries the
//     CUMULATIVE SESSION MEMORY marker, and memory.ts never reads MEMORY.md.
//     => explicitly remembered project facts are written but NOT injected.
//   • contextStore.ts pins               — in-memory Maps, cleared at session
//     end (contextStore.ts:38-41). Lost on restart.
// This module is the single, honest, capability-neutral repair surface for
// that gap: real disk writes, provenance + timestamps, full-text dedup,
// reinforcement, an honest bounded active window, and a SHORT prompt block
// that explicitly tells the model "these are already known — keep learning".
//
// DESIGN RULES
//   • Node builtins only. No electron import, no network, no model calls.
//     Fully offline and safe to bundle into a test harness.
//   • Every public function is defensive: NOTHING throws on corrupt JSON,
//     hostile paths, or a full disk. Failures are reported, never thrown.
//   • Dedup key = hash of the FULL normalized text (never a prefix/slice).
//   • Exact repeats REINFORCE (count++, lastSeen refresh); distinct facts are
//     always distinct even if they share a long prefix.
//   • The cap is an HONEST active window: when full, the OLDEST + MOST-
//     REINFORCED fact retires so a genuinely new fact is never silently
//     dropped. `evicted` is counted and reported — learning never "stops at a
//     number". The full view stays on disk and is bounded at a known constant.
//   • All rendered text is ADVISORY: hints, never rules, bans or permissions.
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

// ---------- constants (the honest bounds) ----------

/** Storage cap PER SCOPE. When full, one old reinforced fact retires per new fact. */
export const MAX_CONTINUITY_FACTS = 512;
/** Default cap of the rendered prompt view in characters. */
export const RENDER_CAP = 1_600;
/** Maximum stored characters per fact. The dedupe key uses the FULL input text. */
export const TEXT_CAP = 2_000;
const FILE = 'continuity.json';
const DIR = '.surnia';
const MIN_TEXT = 3;
const MARKER = 'WHAT I ALREADY KNOW';

// ---------- types ----------

export type ContinuityScope = 'user' | 'project';
export type ContinuityKind = 'fact' | 'decision' | 'preference' | 'correction' | 'workflow';

export interface ContinuityFact {
  /** sha256(first 24) of the FULL normalized text — the dedupe key. */
  id: string;
  text: string;
  kind: ContinuityKind;
  scope: ContinuityScope;
  /** How many times this exact fact was written. Exact repeats reinforce. */
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Origin of the FIRST write, e.g. 'remember', 'dna_note', 'user', 'engine'. */
  provenance: string;
  /** Origin of the MOST RECENT write (a reinforcement may come from elsewhere). */
  lastProvenance?: string;
  /** Optional source tag, e.g. 'src: electron/agent/tools.ts:3188'. */
  source?: string;
}

export interface ContinuityStore {
  version: number;
  updatedAt: number;
  scope: ContinuityScope;
  /** '' for user scope, the absolute workspace for project scope. */
  workspace: string;
  /** Lifetime count of facts retired by the cap. Honest, never reset silently. */
  evicted: number;
  facts: ContinuityFact[];
}

export interface ContinuityTarget {
  /** Required for project scope. Traversal/UNC/device paths are refused. */
  workspace?: string;
  /** Required for user scope (Electron: app.getPath('userData')). */
  userDataDir?: string;
  scope?: ContinuityScope;
}

export interface ContinuityWriteInput extends ContinuityTarget {
  text: string;
  kind?: ContinuityKind;
  provenance?: string;
  source?: string;
  /** Injectable clock for deterministic tests. Defaults to Date.now(). */
  at?: number;
}

export interface ContinuityWriteResult {
  ok: boolean;
  action: 'added' | 'reinforced' | 'rejected' | 'error';
  fact: ContinuityFact | null;
  store: ContinuityStore;
  /** Texts retired by this write (empty unless the cap was hit). */
  evicted: string[];
  /** Honest failure reason (only when ok === false). */
  error?: string;
}

export interface RenderContinuityOptions {
  /** Hard cap on the rendered block in chars. Default RENDER_CAP (1600). */
  cap?: number;
  /** Only render this scope (both available scopes are rendered by default). */
  scope?: ContinuityScope;
  /** Hide the bounded-window / keep-learning instruction (tests only). */
  includeLearningHint?: boolean;
}

// ---------- guards / paths ----------

/**
 * Reject traversal, UNC and device/root paths before any disk write. Mirrors
 * memory.ts:wsOf and playbook.ts:workspaceOf so no continuity artifact can be
 * placed outside its workspace/userData directory.
 */
function safeDir(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const value = raw.trim();
  if (value.includes('..') || /^[\\/]{2}/.test(value)) return '';
  let resolved: string;
  try {
    resolved = path.resolve(value);
  } catch {
    return '';
  }
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) return '';
  const body = /^[A-Za-z]:/.test(resolved) ? resolved.slice(2) : resolved;
  if (/[<>:"|?*\x00-\x1f]/.test(body)) return '';
  return resolved;
}

/** Path of the durable store. '' means "hostile/missing target — do not write". */
export function continuityPath(target: ContinuityTarget): string {
  const scope: ContinuityScope = target?.scope === 'user' ? 'user' : 'project';
  if (scope === 'user') {
    const ud = safeDir(target.userDataDir);
    return ud ? path.join(ud, FILE) : '';
  }
  const ws = safeDir(target.workspace);
  return ws ? path.join(ws, DIR, FILE) : '';
}

export function isContinuityMarker(text: string): boolean {
  return typeof text === 'string' && text.includes(MARKER);
}

// ---------- normalization / dedup ----------

/** Full normalized text — NO prefix, NO slice. This is the dedup identity. */
export function normalizeContinuityText(text: string): string {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function continuityId(text: string): string {
  return createHash('sha256').update(normalizeContinuityText(text)).digest('hex').slice(0, 24);
}

// ---------- defensive IO ----------

function emptyStore(scope: ContinuityScope, workspace: string): ContinuityStore {
  return { version: 0, updatedAt: 0, scope, workspace, evicted: 0, facts: [] };
}

function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function asKind(v: unknown): ContinuityKind {
  return v === 'decision' || v === 'preference' || v === 'correction' || v === 'workflow' ? v : 'fact';
}

function finiteTime(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function shortText(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, cap) : '';
}

function sanitizeFact(raw: unknown, fallbackScope: ContinuityScope, now: number): ContinuityFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Re-derive the id from the text: a hand-edited/corrupt id can never change
  // the dedupe identity, and two facts can never collide on a stale id.
  const text = shortText(r.text, TEXT_CAP);
  if (!text || normalizeContinuityText(text).length < MIN_TEXT) return null;
  const firstSeen = finiteTime(r.firstSeen, now);
  const lastSeen = finiteTime(r.lastSeen, firstSeen);
  const fact: ContinuityFact = {
    id: continuityId(text),
    text,
    kind: asKind(r.kind),
    scope: r.scope === 'user' ? 'user' : r.scope === 'project' ? 'project' : fallbackScope,
    count: Math.max(1, Math.min(100_000, Math.floor(Number(r.count) || 1))),
    firstSeen,
    lastSeen,
    provenance: shortText(r.provenance, 80) || 'unknown',
  };
  const lastProvenance = shortText(r.lastProvenance, 80);
  if (lastProvenance) fact.lastProvenance = lastProvenance;
  const source = shortText(r.source, 160);
  if (source) fact.source = source;
  return fact;
}

/** Never throws. Corrupt/partial files degrade to an empty store. */
export function readContinuity(target: ContinuityTarget): ContinuityStore {
  const scope: ContinuityScope = target?.scope === 'user' ? 'user' : 'project';
  const ws = scope === 'project' ? safeDir(target.workspace) : '';
  const out = emptyStore(scope, ws);
  const file = continuityPath({ ...target, scope });
  if (!file) return out;
  const raw = readJsonSafe(file);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.version = Math.max(0, Math.floor(Number(r.version) || 0));
  out.updatedAt = finiteTime(r.updatedAt, 0);
  out.evicted = Math.max(0, Math.floor(Number(r.evicted) || 0));
  const items = Array.isArray(r.facts) ? r.facts : [];
  const byId = new Map<string, ContinuityFact>();
  for (const item of items) {
    const fact = sanitizeFact(item, scope, Date.now());
    if (!fact) continue;
    const existing = byId.get(fact.id);
    if (existing) {
      // Replayed duplicates from a hand-edited file: reinforce, do not duplicate.
      existing.count = Math.max(existing.count, fact.count);
      existing.lastSeen = Math.max(existing.lastSeen, fact.lastSeen);
    } else {
      byId.set(fact.id, fact);
    }
  }
  // Reading an over-full legacy file is NOT a new eviction event — trim the
  // view without inflating the persisted `evicted` counter.
  out.facts = capFacts([...byId.values()], out, false).facts;
  return out;
}

/** Atomic, owner-only write. Never throws. */
function writeStore(file: string, store: ContinuityStore): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best effort */
      }
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * ONE eviction policy: drop the OLDEST + MOST-REINFORCED fact to make room for
 * a NEW one. Higher score = safer to forget (a repetition we already know).
 * Never drops a just-added fact. The retired texts are returned so callers can
 * report them honestly instead of silently losing memory.
 */
function capFacts(
  facts: ContinuityFact[],
  store: ContinuityStore,
  countEviction = true,
): { facts: ContinuityFact[]; retired: string[] } {
  if (facts.length <= MAX_CONTINUITY_FACTS) return { facts, retired: [] };
  const forget = (f: ContinuityFact): number => f.count * 1_000 - f.lastSeen / 1e9;
  const ordered = facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => forget(b.f) - forget(a.f) || a.i - b.i);
  const keep = new Set(ordered.slice(facts.length - MAX_CONTINUITY_FACTS).map((x) => x.f.id));
  const retiredFacts = ordered.filter((x) => !keep.has(x.f.id));
  if (countEviction) store.evicted = Math.max(0, store.evicted) + retiredFacts.length;
  return { facts: facts.filter((f) => keep.has(f.id)), retired: retiredFacts.map((x) => x.f.text) };
}

// ---------- write / recall / forget ----------

/** Write one durable fact. Exact repeats reinforce; distinct facts coexist. */
export function writeContinuityFact(input: ContinuityWriteInput): ContinuityWriteResult {
  const scope: ContinuityScope = input?.scope === 'user' ? 'user' : 'project';
  const file = continuityPath({ ...input, scope });
  const fail = (
    action: ContinuityWriteResult['action'],
    error: string,
    st?: ContinuityStore,
  ): ContinuityWriteResult => ({
    ok: false,
    action,
    fact: null,
    store: st ?? readContinuity({ ...input, scope }),
    evicted: [],
    error,
  });
  if (!file) return fail('error', 'invalid target: no safe workspace/userDataDir');
  const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
  if (normalizeContinuityText(text).length < MIN_TEXT) return fail('rejected', 'text too short');
  if (text.length > TEXT_CAP) return fail('rejected', `text exceeds TEXT_CAP (${TEXT_CAP})`);

  const at = finiteTime(input.at, Date.now());
  const store = readContinuity({ ...input, scope });
  const id = continuityId(text);
  const idx = store.facts.findIndex((f) => f.id === id);
  let action: ContinuityWriteResult['action'];
  let fact: ContinuityFact;
  if (idx >= 0) {
    const prev = store.facts[idx];
    fact = { ...prev, count: Math.min(100_000, prev.count + 1), lastSeen: Math.max(prev.lastSeen, at) };
    const lp = shortText(input.provenance, 80);
    if (lp) fact.lastProvenance = lp;
    const src = shortText(input.source, 160);
    if (src) fact.source = src;
    store.facts[idx] = fact;
    action = 'reinforced';
  } else {
    fact = {
      id,
      text,
      kind: asKind(input.kind),
      scope,
      count: 1,
      firstSeen: at,
      lastSeen: at,
      provenance: shortText(input.provenance, 80) || 'unknown',
      ...(shortText(input.source, 160) ? { source: shortText(input.source, 160) } : {}),
    };
    store.facts.push(fact);
    action = 'added';
  }

  const capped = capFacts(store.facts, store);
  store.facts = capped.facts;
  store.version += 1;
  store.updatedAt = Math.max(store.updatedAt, at);
  if (!writeStore(file, store)) return fail('error', 'disk write failed', store);
  // `retired` holds the REAL texts removed by the cap — no invented labels.
  return { ok: true, action, fact, store, evicted: capped.retired };
}

export interface RecallOptions {
  limit?: number;
  scope?: ContinuityScope;
}

/**
 * Offline, deterministic term-overlap recall over durable facts. Never throws.
 * An empty query returns the newest facts (a compact "what I know" view).
 */
export function recallContinuity(
  target: ContinuityTarget,
  query: string,
  options: RecallOptions = {},
): ContinuityFact[] {
  const limit = Math.max(1, Math.min(16, Math.floor(Number(options.limit) || 6)));
  const sources: ContinuityStore[] = [];
  if (options.scope !== 'user' && continuityPath({ ...target, scope: 'project' })) {
    sources.push(readContinuity({ ...target, scope: 'project' }));
  }
  if (options.scope !== 'project' && continuityPath({ ...target, scope: 'user' })) {
    sources.push(readContinuity({ ...target, scope: 'user' }));
  }
  const facts = sources.flatMap((s) => s.facts);
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  const scored = facts
    .map((f) => {
      const lower = normalizeContinuityText(f.text);
      let score = 0;
      if (!terms.length) score = 1;
      else if (lower.includes(normalizeContinuityText(query))) score = 100;
      else for (const t of terms) if (lower.includes(t)) score += 1 + Math.log(1 + (lower.split(t).length - 1));
      if (score <= 0) return null;
      // Tiny reinforcement weight; recency breaks ties (never outranks relevance).
      return { f, score: score + Math.min(0.49, (f.count - 1) / 100) };
    })
    .filter((x): x is { f: ContinuityFact; score: number } => !!x)
    .sort((a, b) => b.score - a.score || b.f.lastSeen - a.f.lastSeen || b.f.firstSeen - a.f.firstSeen)
    .slice(0, limit)
    .map((x) => x.f);
  return scored;
}

/** Exact-normalized (or substring) removal of a durable fact. Never throws. */
export function forgetContinuity(
  target: ContinuityTarget,
  text: string,
): { ok: boolean; removed: number; store: ContinuityStore } {
  const scope: ContinuityScope = target?.scope === 'user' ? 'user' : 'project';
  const file = continuityPath({ ...target, scope });
  if (!file) return { ok: false, removed: 0, store: emptyStore(scope, '') };
  const store = readContinuity({ ...target, scope });
  const needle = normalizeContinuityText(text);
  if (!needle) return { ok: true, removed: 0, store };
  const before = store.facts.length;
  store.facts = store.facts.filter((f) => normalizeContinuityText(f.text) !== needle && !normalizeContinuityText(f.text).includes(needle));
  const removed = before - store.facts.length;
  if (removed) {
    store.version += 1;
    store.updatedAt = Date.now();
    writeStore(file, store);
  }
  return { ok: true, removed, store };
}

// ---------- prompt rendering (SHORT, ADVISORY) ----------

const LEARNING_HINT =
  'These are ALREADY known — do NOT re-record them. Record only genuinely NEW durable facts as you learn them. ' +
  'This active window is BOUNDED: old reinforced facts retire when new ones arrive, so learning never stops at a number. ' +
  "The user's CURRENT request always wins. Advisory hints only — never rules, bans or permissions.";

function dateOf(ts: number): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return 'unknown';
  }
}

/** Pure renderer over facts. Newest first so the newest fact can never be cut. */
export function renderContinuityFacts(
  facts: readonly ContinuityFact[],
  options: RenderContinuityOptions = {},
): string {
  if (!facts?.length) return '';
  const cap = Math.max(240, Math.floor(Number(options.cap) || RENDER_CAP));
  const byId = new Map<string, ContinuityFact>();
  for (const f of facts) if (f && f.text && !byId.has(f.id ?? continuityId(f.text))) byId.set(f.id ?? continuityId(f.text), f);
  const ordered = [...byId.values()].sort(
    (a, b) => b.lastSeen - a.lastSeen || b.firstSeen - a.firstSeen || b.count - a.count,
  );
  const header = `${MARKER} (durable continuity — real writes, advisory)`;
  const lines: string[] = [header];
  if (options.includeLearningHint !== false) lines.push(LEARNING_HINT);
  for (const f of ordered) {
    const extra = f.count > 1 ? ` ×${f.count}` : '';
    lines.push(`- [${f.scope}/${f.kind}${extra}] ${f.text} (first ${dateOf(f.firstSeen)}, last ${dateOf(f.lastSeen)}, via ${f.provenance}${f.lastProvenance && f.lastProvenance !== f.provenance ? `→${f.lastProvenance}` : ''})`);
  }
  const joined = lines.join('\n');
  if (joined.length <= cap) return joined;

  const marker = '… [continuity view truncated — full set on disk]';
  const limit = Math.max(0, cap - marker.length - 1);
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const add = line.length + (kept.length ? 1 : 0);
    if (used + add > limit) break;
    kept.push(line);
    used += add;
  }
  if (!kept.length) kept.push(header);
  // FINAL GUARANTEE — the newest fact is the whole point of continuity. Even
  // under a pathological cap it is restored right after the header (the hint
  // may be dropped first; it is guidance, not a fact).
  const newest = ordered[0];
  const newestLine = kept.find((l) => l.includes(newest.text));
  if (!newestLine) {
    const rebuilt: string[] = [header];
    if (options.includeLearningHint !== false && used > 0) rebuilt.push(LEARNING_HINT);
    rebuilt.push(lines.find((l) => l.includes(newest.text)) as string);
    for (const l of kept.slice(1)) if (l !== header && l !== LEARNING_HINT && !l.includes(newest.text)) rebuilt.push(l);
    kept.length = 0;
    kept.push(...rebuilt);
  }
  return kept.join('\n') + '\n' + marker;
}

/**
 * Engine-friendly: read durable facts from disk (project + user scopes) and
 * render the SHORT advisory block for the system prompt. Never throws.
 * Append it to playbook.renderPlaybookPrompt's output so it reaches the
 * dynamic prompt tail on EVERY run, including after a restart (see handoff in
 * docs/MEMORY-CONTINUITY-V1135.md).
 */
export function renderContinuityBlock(
  target: ContinuityTarget,
  options: RenderContinuityOptions = {},
): string {
  const facts: ContinuityFact[] = [];
  if (options.scope !== 'user' && continuityPath({ ...target, scope: 'project' })) {
    facts.push(...readContinuity({ ...target, scope: 'project' }).facts);
  }
  if (options.scope !== 'project' && continuityPath({ ...target, scope: 'user' })) {
    facts.push(...readContinuity({ ...target, scope: 'user' }).facts);
  }
  return renderContinuityFacts(facts, options);
}

/** Honest capacity report for diagnostics/tests. Never throws. */
export function continuityStats(target: ContinuityTarget): {
  path: string;
  total: number;
  byKind: Record<string, number>;
  evicted: number;
  version: number;
  cap: number;
  renderCap: number;
} {
  const store = readContinuity(target);
  const byKind: Record<string, number> = {};
  for (const f of store.facts) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  return {
    path: continuityPath(target),
    total: store.facts.length,
    byKind,
    evicted: store.evicted,
    version: store.version,
    cap: MAX_CONTINUITY_FACTS,
    renderCap: RENDER_CAP,
  };
}

/** Never throws. Remove only this layer's artifacts — never other stores. */
export function clearContinuity(target: ContinuityTarget): { cleared: boolean } {
  const file = continuityPath(target);
  if (!file) return { cleared: false };
  try {
    fs.unlinkSync(file);
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}
