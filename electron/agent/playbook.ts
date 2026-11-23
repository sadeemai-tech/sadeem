// ============================================================
// SADEEM v11.12 — LIVING MEMORY / ADAPTIVE PLAYBOOK  (signature feature)
// ------------------------------------------------------------
// A per-workspace, self-updating PLAYBOOK.md. After every completed run the
// agent distills "what worked / what failed / user preferences / verified
// recipes" into a structured patch; this module MERGES that patch into the
// playbook, writes a REAL markdown file to disk (<ws>/.surnia/PLAYBOOK.md),
// bumps a version and appends a revision to a version-history JSON file
// (<ws>/.surnia/playbook-history.json). The current playbook is injected into
// the NEXT run's system prompt (ADVISORY, never a rule — see prompts.ts).
//
// The UI (DnaPanel "Living Playbook" section) shows the current version, the
// one-line "what the agent learned after this run" notice and an evolution
// timeline with per-revision diffs. A toast ("SADEEM learned: …") fires on
// every learning event so evolution is VISIBLE, not silent.
//
// Design rules (mirrors dna.ts / skillGate.ts):
//   • Node builtins only, every function defensive — a playbook failure must
//     NEVER break a run or the app. No IO throws out of this module.
//   • Writes are serialized (read-modify-write) to avoid lost increments.
//   • IPC self-registers (kdx:playbook:*) — ipc.ts/preload touched minimally.
// ============================================================
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import { memorySnapshot, renderMemoryBlock } from './memory';
// v11.35 — explicit `remember` facts were written but never injected (the
// "AI doesn't learn from me" root cause). The continuity layer makes them
// durable + reachable; render it into the SAME dynamic tail as the playbook.
import { renderContinuityBlock } from '../services/memoryContinuity';

// ---------- constants ----------
const DIR = '.surnia';
const MD_FILE = 'PLAYBOOK.md';
const HISTORY_FILE = 'playbook-history.json';
const MAX_ITEMS = 24;
const MAX_HISTORY = 40;
const TEXT_CAP = 220;
const LEARNED_CAP = 240;
const SIM_PREFIX = 56;

export type PlaybookSectionKey = 'worked' | 'failed' | 'preferences' | 'recipes';

export const PLAYBOOK_SECTIONS: PlaybookSectionKey[] = ['worked', 'failed', 'preferences', 'recipes'];

/** One learned line. Repeats harden it (count++), so confidence is visible. */
export interface PlaybookItem {
  id: string;
  text: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  source?: string;
}

/** The current, injected playbook. */
export interface PlaybookData {
  version: number;
  workspace: string;
  updatedAt: number;
  worked: PlaybookItem[];
  failed: PlaybookItem[];
  preferences: PlaybookItem[];
  recipes: PlaybookItem[];
  /** One-line notice shown as a toast after the run that produced it. */
  lastLearned: string;
  sessionsObserved: number;
}

/** A single line of the evolution diff. */
export interface PlaybookChange {
  section: PlaybookSectionKey;
  action: 'added' | 'reinforced' | 'removed';
  text: string;
}

/** One entry in the version timeline. */
export interface PlaybookRevision {
  version: number;
  ts: number;
  sessionId?: string;
  /** "SADEEM learned: …" one-liner. */
  summary: string;
  changes: PlaybookChange[];
  /** Markdown snapshot of the whole playbook at this version (for diff view). */
  snapshot: string;
}

/** The structured patch a run produces (parsed from a no-tools model call). */
export interface PlaybookUpdate {
  worked?: string[];
  failed?: string[];
  preferences?: string[];
  recipes?: string[];
  learned?: string;
  sessionId?: string;
}

export interface PlaybookResult {
  data: PlaybookData;
  revision: PlaybookRevision;
  changed: boolean;
}

// ---------- paths / guards ----------

function workspaceOf(ws: unknown): string {
  if (typeof ws !== 'string' || !ws.trim()) return '';
  const raw = ws.trim();
  // SECURITY (v11.16): playbook IPC is renderer-reachable. Refuse traversal
  // and UNC/device paths so a hostile frame cannot write .surnia files into
  // arbitrary folders (e.g. C:\Users\Public) outside the workspace.
  if (raw.includes('..') || /^[\\/]{2}/.test(raw)) return '';
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) return '';
  // Refuse invalid filename chars in the path BODY, but allow the Windows
  // drive colon at index 1 (C:\...) — rejecting `:` there rejected EVERY
  // absolute Windows path and silently broke playbook/memory writes.
  const body = /^[A-Za-z]:/.test(resolved) ? resolved.slice(2) : resolved;
  if (/[<>:"|?*\x00-\x1f]/.test(body)) return '';
  return resolved;
}

export function playbookMdPath(workspace: string): string {
  return path.join(workspaceOf(workspace), DIR, MD_FILE);
}

export function playbookHistoryPath(workspace: string): string {
  return path.join(workspaceOf(workspace), DIR, HISTORY_FILE);
}

function emptyPlaybook(workspace: string): PlaybookData {
  return {
    version: 0,
    workspace: workspaceOf(workspace),
    updatedAt: 0,
    worked: [],
    failed: [],
    preferences: [],
    recipes: [],
    lastLearned: '',
    sessionsObserved: 0,
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP));
}

function similarityPrefix(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, SIM_PREFIX);
}

function sanitizeItem(raw: unknown, now: number): PlaybookItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP) : '';
  if (text.length < 3) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 64) : randomUUID(),
    text,
    count: Math.max(1, Math.min(10_000, Math.floor(Number(r.count) || 1))),
    firstSeen: typeof r.firstSeen === 'number' ? r.firstSeen : now,
    lastSeen: typeof r.lastSeen === 'number' ? r.lastSeen : now,
    ...(typeof r.source === 'string' && r.source.trim() ? { source: r.source.slice(0, 80) } : {}),
  };
}

function sanitizePlaybook(raw: unknown, workspace: string): PlaybookData {
  const out = emptyPlaybook(workspace);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<PlaybookData> & Record<string, unknown>;
  const now = Date.now();
  for (const section of PLAYBOOK_SECTIONS) {
    const items = Array.isArray(r[section]) ? (r[section] as unknown[]) : [];
    out[section] = items
      .map((x) => sanitizeItem(x, now))
      .filter((x): x is PlaybookItem => !!x)
      .slice(0, MAX_ITEMS);
  }
  out.version = Math.max(0, Math.floor(Number(r.version) || 0));
  out.updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : 0;
  out.lastLearned = typeof r.lastLearned === 'string' ? r.lastLearned.slice(0, LEARNED_CAP) : '';
  out.sessionsObserved = Math.max(0, Math.floor(Number(r.sessionsObserved) || 0));
  return out;
}

function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeText(file: string, text: string): void {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
}

/** Serialized read-modify-write chain (same pattern as dna.ts). */
let writeChain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

// ---------- public read ----------

/** Never throws. */
export function loadPlaybook(workspace: string): PlaybookData {
  // Keep the caller's workspace string even if it is not a safe absolute path:
  // the memory renderer needs `data.workspace` to locate .surnia snapshots.
  // (Returning emptyPlaybook('') here made renderMemoryBlock render NOTHING.)
  const ws = workspaceOf(workspace);
  if (!ws) return emptyPlaybook(typeof workspace === 'string' ? workspace : '');
  const data = readState(ws);
  if (!data.workspace) data.workspace = ws;
  return data;
}

/**
 * The markdown file is the source of truth for humans; a small sidecar JSON
 * holds the structured model. We read the JSON when present; the legacy
 * fallback parses the markdown sections back into items (so an edited
 * PLAYBOOK.md is never silently discarded).
 */
function readPlaybookLegacy(ws: string): unknown {
  try {
    const raw = fsSync.readFileSync(playbookMdPath(ws), 'utf8');
    const parsed = parsePlaybookMarkdown(raw);
    return parsed ?? null;
  } catch {
    return null;
  }
}

/** Structured sidecar path (kept beside the human-readable markdown). */
function statePath(ws: string): string {
  return path.join(ws, DIR, 'playbook.json');
}

/** Robust read that also considers the structured sidecar first. */
function readState(ws: string): PlaybookData {
  const json = readJsonSafe(statePath(ws));
  if (json && typeof json === 'object') return sanitizePlaybook(json, ws);
  return sanitizePlaybook(readPlaybookLegacy(ws), ws);
}

function parsePlaybookMarkdown(raw: string): unknown {
  const out = emptyPlaybook('');
  const text = String(raw ?? '').replace(/\r\n/g, '\n');
  const header = /^version\s*:\s*(\d+)/m.exec(text);
  if (header) out.version = Number(header[1]);
  let section: PlaybookSectionKey | null = null;
  for (const line of text.split('\n')) {
    const h = /^##\s+(worked|failed|preferences|recipes|what worked|what failed|user preferences|verified recipes)\b/i.exec(line.trim());
    if (h) {
      const key = h[1].toLowerCase();
      section = key.includes('worked') ? 'worked' : key.includes('failed') ? 'failed' : key.includes('prefer') ? 'preferences' : 'recipes';
      continue;
    }
    if (line.trim() === '---' || /^#\s/.test(line.trim())) {
      section = null;
      continue;
    }
    if (section && /^\s*[-*]\s+/.test(line)) {
      const t = line.replace(/^\s*[-*]\s+/, '').trim();
      if (t.length >= 3) out[section].push({ id: randomUUID(), text: t.slice(0, TEXT_CAP), count: 1, firstSeen: Date.now(), lastSeen: Date.now() });
    }
  }
  return out;
}

/** Never throws. */
export function loadPlaybookHistory(workspace: string): PlaybookRevision[] {
  const ws = workspaceOf(workspace);
  if (!ws) return [];
  const raw = readJsonSafe(playbookHistoryPath(ws));
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((r) => ({
      version: Math.max(0, Math.floor(Number(r.version) || 0)),
      ts: typeof r.ts === 'number' ? r.ts : now,
      ...(typeof r.sessionId === 'string' && r.sessionId.trim() ? { sessionId: r.sessionId.slice(0, 80) } : {}),
      summary: typeof r.summary === 'string' ? r.summary.slice(0, LEARNED_CAP) : '',
      changes: (Array.isArray(r.changes) ? r.changes : [])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          section: (PLAYBOOK_SECTIONS.includes(c.section as PlaybookSectionKey) ? c.section : 'worked') as PlaybookSectionKey,
          action: (c.action === 'reinforced' || c.action === 'removed' ? c.action : 'added') as PlaybookChange['action'],
          text: typeof c.text === 'string' ? c.text.slice(0, TEXT_CAP) : '',
        })),
      snapshot: typeof r.snapshot === 'string' ? r.snapshot : '',
    }))
    .sort((a, b) => b.version - a.version)
    .slice(0, MAX_HISTORY);
}

// ---------- rendering ----------

const SECTION_TITLE: Record<PlaybookSectionKey, string> = {
  worked: 'What worked',
  failed: 'What failed',
  preferences: 'User preferences',
  recipes: 'Verified recipes',
};

/** The human-readable PLAYBOOK.md artifact. */
export function renderPlaybookMarkdown(data: PlaybookData): string {
  const lines: string[] = [
    '# SADEEM Living Playbook',
    '',
    `> Self-updating field guide for this workspace. Version ${data.version || 0} · ` +
      `${new Date(data.updatedAt || Date.now()).toISOString().slice(0, 10)}`,
    '> Written by SADEEM after real runs. Advisory defaults — the current request always wins.',
    '',
  ];
  for (const section of PLAYBOOK_SECTIONS) {
    lines.push(`## ${SECTION_TITLE[section]}`);
    const items = (data[section] ?? []).slice(0, MAX_ITEMS);
    if (!items.length) lines.push('- _(nothing learned yet)_');
    else for (const it of items) lines.push(`- ${it.text}${it.count > 1 ? `  _(reinforced ×${it.count})_` : ''}`);
    lines.push('');
  }
  if (data.lastLearned) {
    lines.push('## Latest learning');
    lines.push(`- ${data.lastLearned}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Compact system-prompt section body (≤2000 chars). ADVISORY ONLY — like
 * DNA, it steers defaults and never restricts permissions/actions.
 */
export function renderPlaybookPrompt(data: PlaybookData, opts: { includeMemory?: boolean; userDataDir?: string } = {}): string {
  if (!data) return '';
  const lines: string[] = [];
  lines.push(
    'PLAYBOOK RULES — ADVISORY DEFAULTS learned from real runs in THIS workspace. These are hints, never rules, bans or permissions. ' +
      'They must NOT restrict what you may do. The user\u2019s CURRENT request always overrides every line below — ' +
      'follow it without comment. Never mention the playbook as a reason for anything.',
  );
  let used = lines[0].length;
  // Facts actually rendered above. memory_snapshot replays the playbook from
  // disk, so these SAME preferences/lessons would otherwise be injected TWICE
  // (once in the playbook section, once in the memory block) → prompt bloat.
  // v1116 — pass them as the renderer's dedup exclusion set.
  const injectedTexts: string[] = [];
  const part: [PlaybookSectionKey, string][] = [
    ['worked', 'WHAT WORKED here'],
    ['failed', 'WHAT FAILED here'],
    ['preferences', 'USER PREFERENCES'],
    ['recipes', 'VERIFIED RECIPES'],
  ];
  for (const [key, title] of part) {
    const items = [...(data[key] ?? [])]
      .sort((a, b) => b.count * b.lastSeen - a.count * a.lastSeen)
      .slice(0, 4);
    if (!items.length) continue;
    const block = [`${title}:`, ...items.map((i) => `- ${i.text}`)].join('\n');
    if (used + block.length > 1900) break;
    lines.push(block);
    used += block.length;
    for (const it of items) injectedTexts.push(it.text);
  }
  // v11.15 — CUMULATIVE SESSION MEMORY rides along with the playbook so it
  // reaches EVERY run's system prompt (engine.ts:2100 passes the rendered body
  // to buildSystemPrompt) — including after compaction and after a restart.
  // It is read from <workspace>/.surnia/memory-snapshot.json, written by
  // memory.memorySnapshot() at compaction time AND by learnPlaybook() after
  // every real run. Advisory only, never a rule.
  //
  // PROMPT-CACHE INVARIANT (A5 / prompts.ts): the block text begins with the
  // literal `CUMULATIVE SESSION MEMORY` marker. prompts.playbookCarriesMemory()
  // keys its duplicate-injection guard on that marker, and the whole playbook
  // body is injected into the DYNAMIC system-prompt tail (opts.playbook), NOT
  // the byte-stable cached static prefix — so the prompt-cache split can never
  // drop it. Keep the marker verbatim in memory.renderMemorySnapshot().
  let mem = '';
  if (opts.includeMemory !== false) {
    try {
      mem = renderMemoryBlock(data.workspace, opts.userDataDir, { exclude: injectedTexts });
    } catch {
      mem = ''; // memory must never break the playbook prompt
    }
  }
  // v11.35 — durable explicit memories + pins were written but never injected
  // (the "AI doesn't learn from me" root cause). Render into the SAME dynamic
  // tail as the playbook. Best-effort: memory must never break the prompt.
  let continuity = '';
  try {
    continuity = renderContinuityBlock({ workspace: data.workspace, userDataDir: opts.userDataDir });
  } catch {
    continuity = '';
  }
  if (lines.length === 1 && !mem && !continuity) return ''; // advisory header with no data → omit section
  let out = lines.join('\n');
  if (out.length > 2000) out = out.slice(0, 1970) + '\n… [truncated]';
  if (mem) out = `${out}\n\n${mem}`;
  if (continuity) out = `${out}\n\n${continuity}`;
  return out;
}

// ---------- merge / apply ----------

function mergeSection(
  target: PlaybookItem[],
  additions: string[],
  section: PlaybookSectionKey,
  source?: string,
): { changes: PlaybookChange[] } {
  const changes: PlaybookChange[] = [];
  const byPrefix = new Map(target.map((it) => [similarityPrefix(it.text), it]));
  const now = Date.now();
  for (const raw of additions) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP);
    if (text.length < 4) continue;
    const key = similarityPrefix(text);
    const hit = byPrefix.get(key);
    if (hit) {
      hit.count += 1;
      hit.lastSeen = now;
      changes.push({ section, action: 'reinforced', text: hit.text });
    } else {
      const item: PlaybookItem = {
        id: randomUUID(),
        text,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        ...(source ? { source } : {}),
      };
      target.push(item);
      byPrefix.set(key, item);
      changes.push({ section, action: 'added', text });
    }
  }
  return { changes };
}

/**
 * v11.23 — bounded section cap with the SAME policy as memory's v11.21 fix:
 * when a section is full, evict the OLDEST, MOST-REINFORCED item (a lesson we
 * already know well) — NEVER a brand-new one. The previous
 * `.sort(b.count * b.lastSeen - a.count * a.lastSeen).slice(0, MAX_ITEMS)`
 * kept reinforced items and silently dropped the newest learned preference
 * whenever a section filled up (the exact v11.21 bug, one layer down). Since
 * memory_snapshot() derives its durable facts from this file, losing a lesson
 * here also lost it from memory.
 */
function capSection(items: PlaybookItem[]): PlaybookItem[] {
  if (items.length <= MAX_ITEMS) return items;
  // Higher `forget` = safer to forget (more reinforced, then older).
  const forget = (it: PlaybookItem): number => (it.count ?? 1) * 1000 - (it.lastSeen ?? 0) / 1e9;
  return [...items]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => forget(b.it) - forget(a.it) || a.i - b.i)
    .slice(items.length - MAX_ITEMS)
    .map((x) => x.it);
}

/**
 * Apply a structured run patch to the playbook. Writes PLAYBOOK.md +
 * playbook.json + a new revision to playbook-history.json. Fully serialized.
 * Returns {changed:false} with a no-op revision when the patch carried nothing
 * new (so callers can skip the toast). Never throws.
 */
export function applyPlaybookUpdate(workspace: string, update: PlaybookUpdate): PlaybookResult {
  const ws = workspaceOf(workspace);
  const empty = emptyPlaybook(ws);
  if (!ws) return { data: empty, revision: { version: 0, ts: Date.now(), summary: '', changes: [], snapshot: '' }, changed: false };
  // Kept synchronous internally; callers that need chaining can await the
  // promise variant below. This wrapper preserves the simple test/API shape.
  return applySync(ws, update);
}

function applySync(ws: string, update: PlaybookUpdate): PlaybookResult {
  const now = Date.now();
  let data: PlaybookData;
  try {
    data = readState(ws);
  } catch {
    data = emptyPlaybook(ws);
  }
  const source = typeof update.sessionId === 'string' && update.sessionId.trim() ? `run:${update.sessionId.slice(0, 40)}` : undefined;
  const changes: PlaybookChange[] = [];
  for (const section of PLAYBOOK_SECTIONS) {
    const additions = asStringArray(update[section]);
    if (!additions.length) continue;
    const r = mergeSection(data[section], additions, section, source);
    changes.push(...r.changes);
  }
  const learned = typeof update.learned === 'string' ? update.learned.replace(/\s+/g, ' ').trim().slice(0, LEARNED_CAP) : '';
  const changed = changes.length > 0 || !!learned;
  data.sessionsObserved = Math.max(0, data.sessionsObserved) + 1;
  data.lastLearned = learned || data.lastLearned;
  data.updatedAt = now;

  if (changed) {
    data.version = Math.max(0, data.version) + 1;
    // Cap each section with the v11.21 policy: keep NEW lessons, evict the
    // oldest reinforced ones (see capSection). No silent drop of new facts.
    for (const section of PLAYBOOK_SECTIONS) {
      data[section] = capSection(data[section]);
    }
    try {
      writeText(statePath(ws), JSON.stringify(data, null, 2));
      writeText(playbookMdPath(ws), renderPlaybookMarkdown(data));
    } catch {
      /* disk failure never breaks the run */
    }
    const revision: PlaybookRevision = {
      version: data.version,
      ts: now,
      ...(update.sessionId ? { sessionId: update.sessionId.slice(0, 80) } : {}),
      summary: learned || summarizeChanges(changes),
      changes: changes.slice(0, 20),
      snapshot: renderPlaybookMarkdown(data),
    };
    try {
      const hist = loadPlaybookHistory(ws);
      writeText(playbookHistoryPath(ws), JSON.stringify([revision, ...hist].slice(0, MAX_HISTORY), null, 2));
    } catch {
      /* history is best-effort */
    }
    emitPlaybookEvent('learned', { version: data.version, summary: revision.summary, changes: revision.changes.length });
    return { data, revision, changed: true };
  }

  // Nothing learned — still persist the session observation (cheap, no version bump).
  try {
    writeText(statePath(ws), JSON.stringify(data, null, 2));
  } catch {
    /* best-effort */
  }
  return {
    data,
    revision: { version: data.version, ts: now, summary: '', changes: [], snapshot: '' },
    changed: false,
  };
}

function summarizeChanges(changes: PlaybookChange[]): string {
  if (!changes.length) return '';
  const added = changes.filter((c) => c.action === 'added').length;
  const reinforced = changes.filter((c) => c.action === 'reinforced').length;
  const bits: string[] = [];
  if (added) bits.push(`${added} new ${added === 1 ? 'lesson' : 'lessons'}`);
  if (reinforced) bits.push(`${reinforced} reinforced`);
  const first = changes.find((c) => c.action === 'added') ?? changes[0];
  return bits.join(' + ') + (first?.text ? ` — ${first.text.slice(0, 90)}` : '');
}

/** Async, serialized variant for the engine's fire-and-forget hook. */
export async function learnPlaybook(workspace: string, update: PlaybookUpdate): Promise<PlaybookResult> {
  const result = await mutate(() => applySync(workspaceOf(workspace), update));
  // v11.15 — the post-run learning hook is the AUTOMATIC writer for the
  // cumulative memory_snapshot. Right after a real run teaches the playbook,
  // refresh durable memory from the REAL data now on disk (playbook + journal
  // + DNA). This makes memory survive restart/compaction in production without
  // needing any engine.ts edit; the richer compaction-time facts (model
  // decisions/files/pending) are added by compaction.buildCompactionMemory.
  try {
    memorySnapshot({
      workspace: workspaceOf(workspace),
      userDataDir: playbookUserData(),
      sessionId: update.sessionId,
      reason: 'post-run-playbook',
    });
  } catch {
    /* memory refresh is best-effort — never fail the run */
  }
  return result;
}

/** Never throws. */
export function clearPlaybook(workspace: string): { cleared: boolean } {
  const ws = workspaceOf(workspace);
  if (!ws) return { cleared: false };
  try {
    for (const f of [statePath(ws), playbookMdPath(ws), playbookHistoryPath(ws)]) {
      try {
        fsSync.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
    emitPlaybookEvent('cleared', {});
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

// ---------- events + IPC ----------

export function emitPlaybookEvent(type: 'learned' | 'cleared', payload?: Record<string, unknown>): void {
  try {
    for (const w of BrowserWindow?.getAllWindows?.() ?? []) {
      if (!w.isDestroyed()) w.webContents.send('kdx:playbook:event', { type, ...(payload ? { payload } : {}) });
    }
  } catch {
    /* app tearing down / non-electron harness */
  }
}

let ipcRegistered = false;
export function initPlaybookIpc(): void {
  if (ipcRegistered) return;
  if (!ipcMain || typeof ipcMain.handle !== 'function') return; // CLI / test harness
  ipcRegistered = true;
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (e: unknown, ...args: unknown[]) => {
      // SECURITY (v11.16): only the app's own renderer may drive playbook
      // writes — the same trust rule as kdx:cmd:run / fs / terminal / git.
      const url = String((e as { senderFrame?: { url?: string } } | null)?.senderFrame?.url ?? '');
      const trusted = /^surnia:\/\/bundle\//i.test(url) || /^file:/i.test(url) ||
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(url);
      if (!trusted) throw new Error('UNTRUSTED_SENDER');
      return await (fn as (...a: unknown[]) => unknown)(...args);
    });
  };
  handle('kdx:playbook:get', (workspace?: string) => loadPlaybook(String(workspace ?? '')));
  handle('kdx:playbook:history', (workspace?: string) => loadPlaybookHistory(String(workspace ?? '')));
  handle('kdx:playbook:markdown', (workspace?: string) => renderPlaybookMarkdown(loadPlaybook(String(workspace ?? ''))));
  handle('kdx:playbook:clear', (workspace?: string) => clearPlaybook(String(workspace ?? '')));
  handle('kdx:playbook:update', (input?: { workspace?: string; update?: PlaybookUpdate }) => {
    const result = applyPlaybookUpdate(String(input?.workspace ?? ''), input?.update ?? {});
    return { changed: result.changed, version: result.data.version, revision: result.revision };
  });
}

/** userData dir, defensively (unused today, kept for parity/future global index). */
export function playbookUserData(): string {
  try {
    return app?.getPath?.('userData') ?? process.cwd();
  } catch {
    return process.cwd();
  }
}
