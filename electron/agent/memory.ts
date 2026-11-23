// ============================================================
// SADEEM v11.15 — CUMULATIVE SESSION MEMORY / `memory_snapshot`
// ------------------------------------------------------------
// The founder's requirement (ar): "after a long run + compaction the agent
// must remember EVERYTHING it learned — preferences, decisions, files touched,
// pending steps — and must never forget across restarts. Build engineering
// inside yourself."
//
// WHY THIS EXISTS
// ---------------
// The four memory subsystems each own a slice, but NONE of them is a single,
// compact, carry-forward contract for compaction:
//   • DNA            → user identity/preferences   (<userData>/dna.json)
//   • Playbook       → learned recipes per workspace (.surnia/playbook.json)
//   • Journal        → append-only run history     (<userData>/journals/**/*.jsonl)
//   • compaction.ts  → a MODEL-WRITTEN summary that is folded into the NEXT
//                      summary on every compaction — the classic "lost in the
//                      middle" drift: facts from 3 compactions ago vanish.
//
// `memory_snapshot` closes that gap. It persists ONE structured, ADVISORY
// session memory under <workspace>/.surnia/, merges every new fact WITHOUT
// ever dropping old ones, and keeps a version history. It is derived ONLY
// from real data that already exists on disk (or that the engine passes in at
// compaction time) — it never invents a preference, decision or file.
//
// Design rules (mirrors dna.ts / playbook.ts):
//   • Node builtins only, fully defensive — a memory failure must NEVER break
//     a run. No IO throws out of this module.
//   • Reads are merged with NEWEST-wins per dedup key; nothing is deleted.
//   • ALL rendered text is ADVISORY: hints, never rules, bans or permissions.
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------- constants ----------
const DIR = '.surnia';
const SNAPSHOT_FILE = 'memory-snapshot.json';
const HISTORY_FILE = 'memory-history.json';
const MAX_HISTORY = 40;
/**
 * Storage / render safety valve — NOT a "learning budget". The founder's
 * contract is "cumulative, no loss": a fact learned on compaction #N must
 * still be on disk after compaction #N+1, and must render whenever the prompt
 * cap allows. The old code sliced merges, reads AND the renderer to 24,
 * silently dropping every NEW fact once a category filled up (and even
 * dropping old facts when a big cap was supplied). 1024 is high enough to be
 * effectively lossless while bounding pathological growth. The real prompt
 * budget is RENDER_CAP (4_000), applied by prioritized, line-boundary truncation —
 * so a hard per-category number must NOT pre-empt it.
 */
export const MAX_STORED_FACTS = 1024;
const MAX_TASKS = 8;
const FACT_TEXT_CAP = 220;
const TASK_TEXT_CAP = 1_200;
/** Prompt budget for the advisory memory block (raised 2600 → 4000 so more is remembered). */
export const RENDER_CAP = 4_000;

// ---------- types ----------

/** One durable, deduplicated memory line. Repetition hardens it (count++). */
export interface MemoryFact {
  text: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  source?: string;
}

/** The compact, structured session memory that survives restart + compaction. */
export interface MemorySnapshot {
  version: number;
  workspace: string;
  updatedAt: number;
  /** The FIRST real user task of the session (authoritative across compactions). */
  originalTask: string;
  /** Every distinct task seen, newest first — so nothing is lost. */
  recentTasks: string[];
  /** Key decisions made, with the WHY when the source provided it. */
  decisions: MemoryFact[];
  /** Files created/modified, in discovery order. */
  filesTouched: MemoryFact[];
  /** Learned user preferences (from DNA + playbook + explicit input). */
  preferences: MemoryFact[];
  /** Ordered, concrete next steps still pending. */
  pendingSteps: MemoryFact[];
  /** Honest provenance labels, e.g. ['journal', 'playbook', 'dna', 'summary']. */
  sources: string[];
}

export type MemoryFactKey = 'decisions' | 'filesTouched' | 'preferences' | 'pendingSteps';
export const MEMORY_FACT_KEYS: MemoryFactKey[] = ['decisions', 'filesTouched', 'preferences', 'pendingSteps'];

/** One entry of the version timeline (so evolution is inspectable/revertible). */
export interface MemoryRevision {
  version: number;
  ts: number;
  reason: string;
  snapshot: MemorySnapshot;
}

/** Real data the engine can hand to `memory_snapshot` at compaction time. */
export interface MemorySnapshotInput {
  workspace?: string;
  /** userData dir — where global DNA + journals live (Electron: app.getPath). */
  userDataDir?: string;
  /** sessionId — when set, only that run's journal is used for task facts. */
  sessionId?: string;
  /** The real first user message (from compaction.originalTaskText). */
  originalTask?: string;
  /** The model-produced compaction summary (compactSoFar + the new merge). */
  summary?: string;
  /** Explicit structured facts (prefer these over free-text scraping). */
  decisions?: string[];
  filesTouched?: string[];
  preferences?: string[];
  pendingSteps?: string[];
  /** Additional distinct tasks seen this session (kept newest-first). */
  tasks?: string[];
  /** Why this revision was written (shown in the history timeline). */
  reason?: string;
}

// ---------- paths / guards ----------

function wsOf(ws: unknown): string {
  if (typeof ws !== 'string' || !ws.trim()) return '';
  const raw = ws.trim();
  // SECURITY (v11.23): every memory artifact is written under <ws>/.surnia.
  // Refuse traversal and UNC/device paths so a hostile workspace string cannot
  // place memory files outside the workspace. This mirrors playbook.ts's
  // workspaceOf() guard — the two write paths must be equally confined.
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

export function memorySnapshotPath(workspace: string): string {
  return path.join(wsOf(workspace), DIR, SNAPSHOT_FILE);
}

export function memoryHistoryPath(workspace: string): string {
  return path.join(wsOf(workspace), DIR, HISTORY_FILE);
}

function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function asStrings(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, cap));
}

function asLines(v: unknown): string[] {
  return asStrings(v, FACT_TEXT_CAP);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------- schema guards ----------

function emptySnapshot(workspace: string): MemorySnapshot {
  return {
    version: 0,
    workspace: wsOf(workspace),
    updatedAt: 0,
    originalTask: '',
    recentTasks: [],
    decisions: [],
    filesTouched: [],
    preferences: [],
    pendingSteps: [],
    sources: [],
  };
}

function sanitizeFact(raw: unknown, now: number): MemoryFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, FACT_TEXT_CAP) : '';
  if (!text) return null;
  return {
    text,
    count: Math.max(1, Math.min(10_000, Math.floor(Number(r.count) || 1))),
    firstSeen: typeof r.firstSeen === 'number' ? r.firstSeen : now,
    lastSeen: typeof r.lastSeen === 'number' ? r.lastSeen : now,
    ...(typeof r.source === 'string' && r.source.trim() ? { source: r.source.slice(0, 60) } : {}),
  };
}

/**
 * v11.23 — ONE eviction policy for the 1024-fact storage cap, used on BOTH the
 * write (mergeFacts) and the read (sanitizeSnapshot) path. When a category
 * overflows, drop the OLDEST, MOST-REINFORCED facts (a repetition we already
 * know) and KEEP the newly learned ones. The old read path used
 * `.slice(0, MAX_STORED_FACTS)`, which keeps the OLDEST 1024 and silently
 * discards a new fact appended at the tail of an over-full file — the exact
 * v11.21 bug, one layer down.
 */
function capFactsLossless(facts: MemoryFact[]): MemoryFact[] {
  if (facts.length <= MAX_STORED_FACTS) return facts;
  // Higher `forget` = safer to forget (more reinforced, then older).
  const forget = (f: MemoryFact): number => (f.count ?? 1) * 1000 - (f.lastSeen ?? 0) / 1e9;
  return [...facts]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => forget(b.f) - forget(a.f) || a.i - b.i)
    .slice(facts.length - MAX_STORED_FACTS)
    .map((x) => x.f);
}

function sanitizeSnapshot(raw: unknown, workspace: string): MemorySnapshot {
  const out = emptySnapshot(workspace);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<MemorySnapshot> & Record<string, unknown>;
  const now = Date.now();
  out.version = Math.max(0, Math.floor(Number(r.version) || 0));
  out.updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : 0;
  out.originalTask =
    typeof r.originalTask === 'string' ? r.originalTask.replace(/\s+/g, ' ').trim().slice(0, TASK_TEXT_CAP) : '';
  out.recentTasks = asStrings(r.recentTasks, TASK_TEXT_CAP).slice(0, MAX_TASKS);
  for (const key of MEMORY_FACT_KEYS) {
    const items = Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
    out[key] = capFactsLossless(
      items.map((x) => sanitizeFact(x, now)).filter((x): x is MemoryFact => !!x),
    );
  }
  out.sources = asLines(r.sources).slice(0, 12);
  return out;
}

// ---------- public reads ----------

/** Never throws. */
export function readMemorySnapshot(workspace: string): MemorySnapshot {
  return sanitizeSnapshot(readJsonSafe(memorySnapshotPath(workspace)), wsOf(workspace));
}

/** Never throws; newest revision first. */
export function readMemoryHistory(workspace: string): MemoryRevision[] {
  const ws = wsOf(workspace);
  if (!ws) return [];
  const raw = readJsonSafe(memoryHistoryPath(ws));
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((r) => ({
      version: Math.max(0, Math.floor(Number(r.version) || 0)),
      ts: typeof r.ts === 'number' ? r.ts : now,
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 120) : '',
      snapshot: sanitizeSnapshot(r.snapshot, ws),
    }))
    .sort((a, b) => b.version - a.version)
    .slice(0, MAX_HISTORY);
}

// ---------- cumulative merge (nothing is ever dropped) ----------

function mergeFacts(
  existing: MemoryFact[],
  additions: readonly string[],
  source: string | undefined,
  now: number,
  reinforce = true,
): { facts: MemoryFact[]; added: number; reinforced: number } {
  const out = existing.map((f) => ({ ...f }));
  const byKey = new Map(out.map((f) => [normalize(f.text), f]));
  let added = 0;
  let reinforced = 0;
  for (const raw of additions) {
    const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, FACT_TEXT_CAP) : '';
    if (text.length < 3) continue;
    const key = normalize(text);
    const hit = byKey.get(key);
    if (hit) {
      // A fact re-read from a stable disk sidecar is NOT new evidence — only
      // refresh its timestamp. Inflating its count every compaction would
      // flood the "reinforced" tier and bury genuinely new decisions.
      if (reinforce) hit.count += 1;
      hit.lastSeen = now;
      if (reinforce) reinforced++;
    } else {
      const fact: MemoryFact = {
        text,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        ...(source ? { source } : {}),
      };
      out.push(fact);
      byKey.set(key, fact);
      added++;
    }
  }
  // NO LOSS (v11.21 fix, unified in v11.23): when a category exceeds the cap,
  // drop the OLDEST, MOST-REINFORCED fact (a repetition we already know) —
  // NEVER a newly merged one. The old `slice(0, MAX_STORED_FACTS)` silently
  // erased genuinely new facts once a category was full (found by T8's
  // 1024-fact test). The same helper is now used on the read path too.
  return { facts: capFactsLossless(out), added, reinforced };
}

/** Plain strings for a fact category (used by tests + prompt renderer). */
export function stringsOf(snapshot: MemorySnapshot, key: MemoryFactKey): string[] {
  return (snapshot[key] ?? []).map((f) => f.text);
}

// ---------- structured summary parsing (from the real compaction output) ----------

/**
 * Pull bullet points out of a `## Heading` section. The compaction contract
 * (COMPACT_SYSTEM in engine.ts) writes exactly these headings, so the lines we
 * scrape here are the MODEL'S REAL OUTPUT, not invented facts.
 */
function sectionBullets(summary: string, headingTokens: readonly string[]): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of String(summary ?? '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line.trim());
    if (h) {
      const title = h[1].toLowerCase();
      inSection = headingTokens.some((t) => title.includes(t));
      continue;
    }
    if (!inSection) continue;
    const t = line.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(t) ?? /^\d+[.)]\s+(.*)$/.exec(t);
    if (bullet && bullet[1].trim()) out.push(bullet[1].trim());
  }
  return out;
}

/** Extract explicit file paths mentioned anywhere in a real text blob. */
export function extractFilePaths(text: string): string[] {
  const re = /(?:[A-Za-z]:[\\/])?[\w.\-+/\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mjs|py|go|rs|java|css|scss|html|ya?ml|toml|sql|sh|txt)(?::\d+)?/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    let p = m[0].replace(/\\/g, '/');
    // Drop leading noise like "./" but keep relative paths meaningful.
    p = p.replace(/^\.\//, '');
    if (p.length >= 4 && p.length <= 200) found.add(p);
  }
  return [...found].slice(0, MAX_STORED_FACTS);
}

/** Turn a "path — why" bullet into the path part only. */
function pathFromBullet(line: string): string {
  const cut = line.split(/\s+[—–-]\s+/)[0].trim();
  return cut.replace(/^`|`$/g, '').trim();
}

// ---------- real-data readers (defensive, no electron dependency) ----------

interface DiskFacts {
  task?: string;
  preferences: string[];
  recipes: string[];
  files: string[];
  decisions: string[];
  pending: string[];
  labels: string[];
}

/** Read DNA (global + workspace layer) straight from its JSON sidecars. */
function readDnaFacts(workspace: string, userDataDir: string): DiskFacts {
  const out: DiskFacts = { preferences: [], recipes: [], files: [], decisions: [], pending: [], labels: [] };
  const files: string[] = [];
  if (userDataDir) files.push(path.join(userDataDir, 'dna.json'));
  if (wsOf(workspace)) files.push(path.join(wsOf(workspace), DIR, 'dna.json'));
  for (const file of files) {
    const raw = readJsonSafe(file);
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const profile = (r.profile ?? {}) as Record<string, unknown>;
    const likes = asLines(profile.likes);
    const dislikes = asLines(profile.dislikes).map((x) => `avoid (default only): ${x}`);
    const style = asLines(profile.styleNotes);
    out.preferences.push(...likes, ...dislikes, ...style);
    const fb = Array.isArray(r.feedback) ? r.feedback : [];
    for (const f of fb) {
      if (!f || typeof f !== 'object') continue;
      const note = (f as Record<string, unknown>).note;
      if (typeof note === 'string' && note.trim()) out.preferences.push(note.replace(/\s+/g, ' ').trim().slice(0, FACT_TEXT_CAP));
    }
    const patterns = Array.isArray(r.patterns) ? r.patterns : [];
    for (const p of patterns.slice(0, 12)) {
      if (!p || typeof p !== 'object') continue;
      const text = (p as Record<string, unknown>).text;
      if (typeof text === 'string' && text.trim()) out.recipes.push(text.replace(/\s+/g, ' ').trim().slice(0, FACT_TEXT_CAP));
    }
    if (out.preferences.length || out.recipes.length) out.labels.push('dna');
  }
  return out;
}

/** Read the workspace playbook sidecar (real learned lessons). */
function readPlaybookFacts(workspace: string): DiskFacts {
  const out: DiskFacts = { preferences: [], recipes: [], files: [], decisions: [], pending: [], labels: [] };
  const raw = readJsonSafe(path.join(wsOf(workspace), DIR, 'playbook.json'));
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const take = (key: string): string[] => {
    const arr = Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
    return arr
      .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>).text : x))
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, FACT_TEXT_CAP));
  };
  out.preferences.push(...take('preferences'));
  out.recipes.push(...take('recipes'), ...take('worked'));
  const failed = take('failed');
  out.decisions.push(...failed.map((f) => `avoid: ${f}`));
  if (out.preferences.length || out.recipes.length || out.decisions.length) out.labels.push('playbook');
  return out;
}

/** Read this session's journal (real run header + task_report + finish). */
function readJournalFacts(userDataDir: string, sessionId: string): DiskFacts {
  const out: DiskFacts = { preferences: [], recipes: [], files: [], decisions: [], pending: [], labels: [] };
  if (!userDataDir) return out;
  const root = path.join(userDataDir, 'journals');
  let days: string[] = [];
  try {
    days = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  } catch {
    return out;
  }
  let files: string[] = [];
  for (const day of days.slice(0, 7)) {
    try {
      for (const n of fs.readdirSync(path.join(root, day))) {
        if (!n.endsWith('.jsonl')) continue;
        if (sessionId && !n.startsWith(sessionId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120))) continue;
        files.push(path.join(root, day, n));
      }
    } catch {
      /* day vanished */
    }
  }
  files = files.slice(0, 3); // newest 1-3 runs only — bounded
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8').slice(-512 * 1024); // bounded tail window
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // torn line — skip (honest)
      }
      if (!ev || typeof ev !== 'object') continue;
      if (ev.type === 'run') {
        // engine.ts journals `params.task`, which is the task KIND ('chat'),
        // not the real request — never promote that kind token to a task.
        const headerTask = typeof ev.task === 'string' ? ev.task.trim() : '';
        if (headerTask && !/^(chat|compact|init)$/i.test(headerTask) && !out.task) {
          out.task = headerTask.slice(0, TASK_TEXT_CAP);
        }
      } else if (ev.type === 'task_report' || ev.type === 'finish') {
        if (typeof ev.summary === 'string' && ev.summary.trim()) {
          out.decisions.push(`outcome: ${ev.outcome ?? 'unknown'} — ${ev.summary.slice(0, 200)}`);
        }
        if (typeof ev.howToRun === 'string' && ev.howToRun.trim()) out.recipes.push(`verify with: ${ev.howToRun.slice(0, 160)}`);
      } else if (ev.type === 'memory_snapshot') {
        // Forward-compatible: engine/agent may journal structured facts directly.
        out.decisions.push(...asLines(ev.decisions));
        out.files.push(...asLines(ev.files).concat(asLines(ev.filesTouched)));
        out.preferences.push(...asLines(ev.preferences));
        out.pending.push(...asLines(ev.pending).concat(asLines(ev.nextSteps)));
      }
      // Generic real-data fields, whatever the producer called the event.
      out.files.push(...asLines(ev.filesTouched));
      out.decisions.push(...asLines(ev.decisions));
      out.pending.push(...asLines(ev.pendingSteps), ...asLines(ev.nextSteps));
      out.preferences.push(...asLines(ev.preferences));
      const p = ev.path ?? ev.file;
      if (typeof p === 'string' && p.trim()) out.files.push(p.slice(0, 200));
    }
    if (files.length) out.labels.push('journal');
  }
  return out;
}

// ---------- THE CAPABILITY: memory_snapshot ----------

/**
 * Persist a compact, structured, CUMULATIVE session memory and append a
 * version to its history. Everything merged here comes from real data:
 *   - `input.originalTask` (compaction.originalTaskText — the real user message)
 *   - `input.summary`      (the model's real compaction summary sections)
 *   - explicit arrays      (facts the engine/agent extracted this turn)
 *   - disk sidecars        (journal + playbook + DNA — see readers above)
 * Old facts are NEVER removed. Never throws.
 */
export function memorySnapshot(input: MemorySnapshotInput = {}): MemorySnapshot {
  const ws = wsOf(input.workspace);
  const now = Date.now();
  const existing = readMemorySnapshot(ws);
  const next: MemorySnapshot = {
    ...existing,
    version: existing.version + 1,
    workspace: ws,
    updatedAt: now,
    originalTask: existing.originalTask,
    recentTasks: [...existing.recentTasks],
    decisions: existing.decisions.map((f) => ({ ...f })),
    filesTouched: existing.filesTouched.map((f) => ({ ...f })),
    preferences: existing.preferences.map((f) => ({ ...f })),
    pendingSteps: existing.pendingSteps.map((f) => ({ ...f })),
    sources: [...existing.sources],
  };

  const disk: DiskFacts = {
    preferences: [],
    recipes: [],
    files: [],
    decisions: [],
    pending: [],
    labels: [],
  };
  const mergeDisk = (d: DiskFacts): void => {
    disk.preferences.push(...d.preferences);
    disk.recipes.push(...d.recipes);
    disk.files.push(...d.files);
    disk.decisions.push(...d.decisions);
    disk.pending.push(...d.pending);
    for (const l of d.labels) if (!disk.labels.includes(l)) disk.labels.push(l);
  };
  if (ws) mergeDisk(readPlaybookFacts(ws));
  mergeDisk(readDnaFacts(ws, input.userDataDir ?? ''));
  mergeDisk(readJournalFacts(input.userDataDir ?? '', input.sessionId ?? ''));

  const summary = String(input.summary ?? '');
  const summaryDecisions = sectionBullets(summary, ['decision', 'decisions made', 'current state']);
  const summaryFiles = sectionBullets(summary, ['file', 'files touched']).map(pathFromBullet);
  const summaryPending = sectionBullets(summary, ['next step', 'open question', 'blocker', 'pending']);
  const summaryGoal = sectionBullets(summary, ['goal', 'constraint']);

  // Original task: first real user message wins forever; keep every distinct
  // task seen so a long, multi-goal run never loses an earlier objective.
  const tasks = [
    ...asStrings([input.originalTask ?? ''], TASK_TEXT_CAP),
    ...summaryGoal,
    ...asStrings([disk.task ?? ''], TASK_TEXT_CAP),
  ].filter(Boolean);
  if (!next.originalTask && tasks.length) next.originalTask = tasks[0];
  for (const t of [...tasks, ...asStrings(input.tasks, TASK_TEXT_CAP)]) {
    if (t.length < 4) continue;
    if (!next.recentTasks.some((x) => normalize(x) === normalize(t))) {
      next.recentTasks = [t, ...next.recentTasks].slice(0, MAX_TASKS);
    }
  }

  const add = (key: MemoryFactKey, values: string[], source?: string, reinforce = true): void => {
    const r = mergeFacts(next[key], values, source, now, reinforce);
    next[key] = r.facts;
  };
  // Explicit + model-summary facts are real new evidence this compaction →
  // reinforcing them is honest. Disk sidecars are replayed every time → don't.
  add('decisions', [...(input.decisions ?? []), ...summaryDecisions], 'compaction');
  add('decisions', disk.decisions, 'journal/playbook', false);
  add('filesTouched', [...(input.filesTouched ?? []), ...summaryFiles, ...extractPathsSafe(summary)], 'compaction');
  add('filesTouched', disk.files, 'journal', false);
  add('preferences', input.preferences ?? [], 'engine');
  add('preferences', disk.preferences, 'dna/playbook', false);
  add('pendingSteps', [...(input.pendingSteps ?? []), ...summaryPending], 'compaction');
  add('pendingSteps', disk.pending, 'journal', false);

  // DNA/playbook recipes are durable workflows, not preferences — fold them
  // into decisions as "recipe: …" so they survive compaction too.
  const recipes = disk.recipes.map((r) => `recipe: ${r}`);
  add('decisions', recipes, 'dna/playbook', false);

  for (const label of [...disk.labels, 'compaction', 'summary']) {
    if (label && !next.sources.includes(label)) next.sources.push(label);
  }
  next.sources = next.sources.slice(0, 12);

  if (!ws) return next; // no workspace → nothing to persist (still returns result)

  try {
    writeJson(memorySnapshotPath(ws), next);
    const rev: MemoryRevision = {
      version: next.version,
      ts: now,
      reason: String(input.reason ?? 'compaction').slice(0, 120),
      snapshot: next,
    };
    const hist = readMemoryHistory(ws);
    writeJson(memoryHistoryPath(ws), [rev, ...hist].slice(0, MAX_HISTORY));
  } catch {
    /* disk failure never breaks the run */
  }
  return next;
}

/** Safe wrapper so a weird `summary` never throws out of path extraction. */
function extractPathsSafe(summary: string): string[] {
  try {
    return extractFilePaths(summary).map(pathFromBullet);
  } catch {
    return [];
  }
}

/** Alias with an explicit name for the tool/engine call site. */
export const persistMemorySnapshot = memorySnapshot;

// ---------- rendering (ADVISORY ONLY) ----------

/**
 * Compact, high-signal prompt block. NEVER a rule, ban or permission. The
 * user's CURRENT request always overrides anything reconstructed here.
 */
export interface RenderMemoryOptions {
  /** Hard cap on the rendered block length in chars. Default: RENDER_CAP (4000). */
  cap?: number;
  /**
   * Normalized texts already rendered elsewhere in the system prompt (e.g. the
   * Living Playbook section, or MEMORY.md content the engine passes in).
   * Matching memory facts are skipped so the same fact is not injected twice.
   */
  exclude?: readonly string[];
}

type FactRank = 'harden' | 'recent';

export function renderMemorySnapshot(
  snapshot: MemorySnapshot | null | undefined,
  options: RenderMemoryOptions = {},
): string {
  if (!snapshot) return '';

  // Seed the dedup set with facts already shown elsewhere in the prompt.
  const seen = new Set<string>();
  for (const text of options.exclude ?? []) {
    const key = normalize(String(text));
    if (key) seen.add(key);
  }
  // The ORIGINAL TASK is authoritative: an `exclude` entry must NEVER make us
  // drop it. Seed `seen` with it so it is both protected from dedup AND not
  // repeated by any later group.
  if (snapshot.originalTask) {
    const key = normalize(snapshot.originalTask);
    if (key) seen.add(key);
  }
  const fresh = (text: string): boolean => {
    const key = normalize(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  // Within a category: 'harden' = repetition-first (a correction seen 5× beats
  // one seen once); 'recent' = last-seen-first then first-seen then hardening
  // then insertion order (the insertion tie-break matters when two compactions
  // land in the same millisecond — a brand-new fact must not be buried).
  const ranked = (key: MemoryFactKey, mode: FactRank): string[] =>
    [...(snapshot[key] ?? [])]
      .map((f, i) => ({ f, i }))
      .sort((a, b) => {
        if (mode === 'harden') {
          return (
            b.f.count - a.f.count ||
            b.f.lastSeen - a.f.lastSeen ||
            b.f.firstSeen - a.f.firstSeen ||
            b.i - a.i
          );
        }
        return (
          b.f.lastSeen - a.f.lastSeen ||
          b.f.firstSeen - a.f.firstSeen ||
          b.f.count - a.f.count ||
          b.i - a.i
        );
      })
      .map((x) => x.f.text)
      .filter(fresh)
      .slice(0, MAX_STORED_FACTS);

  // PRIORITY ORDER — the founder's explicit contract. When the block is
  // truncated we drop from the TAIL, so the critical facts survive in order:
  //   original task > user preferences > recent decisions > files touched
  //   > pending steps > other tasks.
  // The previous renderer put decisions + files BEFORE preferences, so with a
  // 4000-char cap the preferences (the anti-"repeated mistake" memory) were
  // the first thing cut — which is exactly why the agent kept forgetting them.
  const groups: Array<{ header?: string; lines: string[] }> = [];

  // The original task is FIRST (so tail-truncation never reaches it) and is
  // NOT subject to `exclude` — the one fact the founder forbids us to lose.
  const ORIGINAL_TASK_HEADER = 'ORIGINAL TASK (still authoritative):';
  const ORIGINAL_TASK_LINE = snapshot.originalTask ? `- ${snapshot.originalTask}` : '';
  if (snapshot.originalTask) {
    groups.push({ header: 'ORIGINAL TASK (still authoritative)', lines: [snapshot.originalTask] });
  }
  const prefs = ranked('preferences', 'harden');
  if (prefs.length) groups.push({ header: 'LEARNED USER PREFERENCES', lines: prefs });
  const decisions = ranked('decisions', 'recent');
  if (decisions.length) groups.push({ header: 'KEY DECISIONS', lines: decisions });
  const files = ranked('filesTouched', 'recent');
  if (files.length) groups.push({ header: 'FILES CREATED / MODIFIED', lines: files });
  const pending = ranked('pendingSteps', 'recent');
  if (pending.length) groups.push({ header: 'PENDING NEXT STEPS', lines: pending });
  const others = (snapshot.recentTasks ?? [])
    .filter((t) => t && normalize(t) !== normalize(snapshot.originalTask ?? ''))
    .filter(fresh)
    .slice(0, 3);
  if (others.length) groups.push({ header: 'OTHER TASKS THIS SESSION', lines: others });

  if (!groups.length) return ''; // nothing to say → omit the section (cache-stable)

  const header =
    'CUMULATIVE SESSION MEMORY — reconstructed from REAL on-disk run data (journal + playbook + DNA + compaction summaries). ' +
    'ADVISORY ONLY: hints, never rules, bans or permissions. They must NEVER restrict what you may do. ' +
    "The user's CURRENT request always wins. Do not invent facts that are not listed here.";

  const lines: string[] = [header];
  for (const g of groups) {
    if (g.header) lines.push(`${g.header}:`);
    for (const line of g.lines) lines.push(`- ${line}`);
  }

  const cap = Math.max(400, Math.floor(Number(options.cap) || RENDER_CAP));
  const joined = lines.join('\n');
  if (joined.length <= cap) return joined;

  // Line-boundary truncation: never cut mid-word, and never drop a HIGH-priority
  // line while a LOWER-priority one is still shown. Reserve room for a marker
  // that sits on its own line so the model can tell the view was compressed
  // (the FULL set stays on disk and is replayed next compaction).
  const marker = '… [memory truncated — lower-priority facts omitted]';
  const limit = Math.max(0, cap - marker.length - 1);
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const add = line.length + (kept.length ? 1 : 0);
    if (used + add > limit) break;
    kept.push(line);
    used += add;
  }
  if (!kept.length) kept.push(lines[0]); // always keep the advisory header
  // FINAL GUARANTEE — never drop the original task, not even under a
  // pathological cap. It is prepended (right after the advisory header) if a
  // truncation ever failed to keep it. `marker` stays the final line.
  if (ORIGINAL_TASK_LINE && !kept.includes(ORIGINAL_TASK_LINE)) {
    const base = kept.filter((l) => l !== lines[0] && l !== ORIGINAL_TASK_HEADER && l !== ORIGINAL_TASK_LINE);
    kept.length = 0;
    kept.push(lines[0], ORIGINAL_TASK_HEADER, ORIGINAL_TASK_LINE, ...base);
  }
  return kept.join('\n') + '\n' + marker;
}

/**
 * Engine-friendly: read the snapshot for a workspace and render the advisory
 * block. Used by playbook prompt injection so the memory reaches the system
 * prompt on EVERY run without needing a new engine hook. `userDataDir` is kept
 * for API parity with DNA/journal readers; the snapshot itself is workspace-
 * local. `options.exclude` lets the caller dedupe facts already rendered
 * elsewhere in the prompt.
 */
export function renderMemoryBlock(
  workspace: string,
  userDataDir?: string,
  options: RenderMemoryOptions = {},
): string {
  const ws = wsOf(workspace);
  if (!ws) return '';
  const snap = readMemorySnapshot(ws);
  return renderMemorySnapshot(snap, options);
}

/** Never throws. */
export function clearMemorySnapshot(workspace: string): { cleared: boolean } {
  const ws = wsOf(workspace);
  if (!ws) return { cleared: false };
  try {
    for (const f of [memorySnapshotPath(ws), memoryHistoryPath(ws)]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}
