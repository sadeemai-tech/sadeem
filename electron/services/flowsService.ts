// ============================================================
// Surnia Flows (v2.5) — named, reusable prompts.
// A "flow" is a saved prompt the user can re-run with one click.
// The renderer re-sends the prompt as a normal chat message and
// separately calls flowsMarkRun(id) so runCount / lastRun stay
// accurate. A repetition counter (kdx:flows:hit) notices prompts
// the user keeps typing and suggests saving them as a flow.
//
// Storage (owner-only 0600, atomic tmp+rename writes):
//   • global    — <userData>/flows.json { flows, hits }
//   • workspace — <ws>/.surnia/flows.json { flows }
//
// Caps: 50 global flows, 20 workspace flows, hits pruned to the
// 200 most recent. This module self-registers its IPC
// (kdx:flows:*) following the dna.ts v2 pattern — ipc.ts is not
// touched. All functions are defensive: a flows failure must
// never break a run or the app.
// ============================================================
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { app, ipcMain } from 'electron';
import type { Flow, FlowsInfo } from '../../shared/types';

// ---------- constants ----------

const FLOWS_FILE = 'flows.json';
const MAX_GLOBAL_FLOWS = 50;
const MAX_WORKSPACE_FLOWS = 20;
const MAX_HITS = 200;
const HIT_TEXT_CAP = 80; // normalized comparison length (spec)
// v11.38 — keep the FIRST raw prompt alongside its normalized hit key. The
// suggestion chip used to save the 80-char normalized text, silently corrupting
// the user's prompt. This preserves the exact text (capped for store size) so
// "save this repeated prompt as a flow" never rewrites what the user typed.
const HIT_ORIGINAL_CAP = 2000;
const NAME_CAP = 120;
const PROMPT_CAP = 20_000;
const SUGGEST_THRESHOLD = 3; // count >= 3 → suggest once, then every 5th repeat
// v11.31 — flow ids are persisted keys. Accept only a strict, filesystem-safe
// alphabet so a hostile/accidental id cannot collide across scopes or smuggle
// path-like data into the store.
const FLOW_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One repetition-counter entry in the global store's `hits` map. */
interface FlowHit {
  count: number;
  text: string;
  /** v11.38 — exact first-seen prompt, for honest "save as flow" suggestions. */
  original?: string;
  suggested?: boolean;
  updatedAt: number;
}

interface GlobalFlowsStore {
  flows: Flow[];
  hits: Record<string, FlowHit>;
}

interface WorkspaceFlowsStore {
  flows: Flow[];
}

export interface FlowsHitResult {
  count: number;
  suggest: boolean;
  text: string;
}

// ---------- userData (works under the CLI electron stub too) ----------

function userDataDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd(); // non-electron harness — harmless fallback
  }
}

function globalFlowsPath(): string {
  return path.join(userDataDir(), FLOWS_FILE);
}

function workspaceFlowsPath(ws: string): string {
  return path.join(ws, '.surnia', FLOWS_FILE);
}

// ---------- read / write (atomic 0600, serialized mutations) ----------

let writeChain: Promise<unknown> = Promise.resolve();

/** Serialized read-modify-write — every flows mutation funnels through here. */
function mutate<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomic owner-only JSON write: unique tmp file (0600) + rename. */
function writeJsonAtomic(file: string, data: unknown): void {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  // v11.31 — a unique tmp name prevents two writers from clobbering the same
  // `.tmp` file; the old fixed name could corrupt a store on overlapping runs.
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fsSync.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fsSync.renameSync(tmp, file);
  } catch (err) {
    try {
      fsSync.rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw err; // surface the write failure — never leave a half-written store
  }
}

/** v11.31 — strict id validation (rejects path-like / cross-scope ids). */
function validFlowId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return FLOW_ID_RE.test(id) ? id : null;
}

/**
 * v11.36 — legacy-id migration must be STABLE. The v11.31 strict-id guard
 * replaced every invalid stored id with a fresh randomUUID() on every READ,
 * so a flow saved before the guard could never be marked-run or deleted (the
 * id changed each time the store was loaded). Derive a deterministic key from
 * the raw value instead: the same legacy row always resolves to the same id.
 */
function stableFlowId(raw: unknown): string {
  const valid = validFlowId(raw);
  if (valid) return valid;
  const text = String(raw ?? '').trim();
  if (!text) return randomUUID();
  return `lg-${createHash('sha1').update(text).digest('hex').slice(0, 16)}`;
}

function sanitizeFlow(raw: unknown, scope: 'global' | 'workspace'): Flow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = stableFlowId(r.id);
  const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, NAME_CAP) : '';
  const prompt = typeof r.prompt === 'string' ? r.prompt.slice(0, PROMPT_CAP) : '';
  if (!name || !prompt.trim()) return null;
  const now = Date.now();
  return {
    id,
    name,
    prompt,
    scope,
    createdAt: typeof r.createdAt === 'number' && r.createdAt > 0 ? r.createdAt : now,
    ...(typeof r.lastRun === 'number' && r.lastRun > 0 ? { lastRun: r.lastRun } : {}),
    runCount: Math.max(0, Math.floor(Number(r.runCount) || 0)),
  };
}

function readGlobalStore(): GlobalFlowsStore {
  const out: GlobalFlowsStore = { flows: [], hits: {} };
  const raw = readJsonSafe(globalFlowsPath());
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.flows)) {
    for (const f of r.flows) {
      const s = sanitizeFlow(f, 'global');
      if (s) out.flows.push(s);
    }
  }
  if (r.hits && typeof r.hits === 'object') {
    for (const [k, v] of Object.entries(r.hits as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const h = v as Record<string, unknown>;
      const count = Math.max(0, Math.floor(Number(h.count) || 0));
      const text = typeof h.text === 'string' ? h.text.slice(0, HIT_TEXT_CAP) : '';
      if (!text || count <= 0) continue;
      out.hits[k] = {
        count,
        text,
        ...(typeof h.original === 'string' && h.original.trim()
          ? { original: h.original.slice(0, HIT_ORIGINAL_CAP) }
          : {}),
        ...(h.suggested === true ? { suggested: true } : {}),
        updatedAt: typeof h.updatedAt === 'number' ? h.updatedAt : 0,
      };
    }
  }
  return out;
}

function writeGlobalStore(store: GlobalFlowsStore): void {
  writeJsonAtomic(globalFlowsPath(), store);
}

function readWorkspaceStore(ws: string): WorkspaceFlowsStore {
  const out: WorkspaceFlowsStore = { flows: [] };
  const raw = readJsonSafe(workspaceFlowsPath(ws));
  if (!raw || typeof raw !== 'object') return out;
  const flows = (raw as Record<string, unknown>).flows;
  if (Array.isArray(flows)) {
    for (const f of flows) {
      const s = sanitizeFlow(f, 'workspace');
      if (s) out.flows.push(s);
    }
  }
  return out;
}

function writeWorkspaceStore(ws: string, store: WorkspaceFlowsStore): void {
  writeJsonAtomic(workspaceFlowsPath(ws), store);
}

/** Validated workspace dir (throws for empty / missing / non-directory paths). */
function requireWorkspace(wsPath: string | undefined): string {
  const ws = String(wsPath ?? '').trim();
  if (!ws) throw new Error('A workspace path is required for workspace-scoped flows.');
  try {
    if (!fsSync.statSync(ws).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`Workspace folder not found: ${ws}`);
  }
  return ws;
}

/** Global flows, optionally merged with a workspace layer (workspace wins order-last). */
function mergedFlows(ws?: string): Flow[] {
  const g = readGlobalStore().flows;
  if (!ws) return g;
  return [...g, ...readWorkspaceStore(ws).flows];
}

/** Keep only the MAX_HITS most recently updated entries. */
function pruneHits(store: GlobalFlowsStore): void {
  const entries = Object.entries(store.hits).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  store.hits = Object.fromEntries(entries.slice(0, MAX_HITS));
}

// ---------- hit normalization (lowercase, strip digits/punct, 80 chars) ----------

export function normalizeHitText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\p{N}\p{P}\p{S}]/gu, ' ') // digits + punctuation + symbols → space
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HIT_TEXT_CAP);
}

function hitHash(norm: string): string {
  return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

// ---------- CRUD ----------

/** Global flow list; with a workspace → merged list (workspace flows last). */
export function flowsList(ws?: string): Flow[] {
  try {
    if (ws && String(ws).trim()) {
      try {
        return mergedFlows(requireWorkspace(ws));
      } catch {
        /* invalid workspace → fall back to the global list */
      }
    }
    return mergedFlows();
  } catch {
    return []; // never break the UI over a bad store
  }
}

/**
 * Create or update a flow. Duplicate name within the same scope →
 * Error('duplicate'). Caps: 50 global / 20 workspace. Returns the
 * updated merged list (workspace layer included when a ws path arrives).
 */
export function flowsSave(
  input: { id?: string; name?: string; prompt?: string; scope?: string },
  wsPath?: string,
): Promise<Flow[]> {
  return mutate(() => {
    const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_CAP);
    const prompt = String(input?.prompt ?? '').slice(0, PROMPT_CAP);
    if (!name) throw new Error('A flow name is required.');
    if (!prompt.trim()) throw new Error('A flow prompt is required.');
    const scope: 'global' | 'workspace' = input?.scope === 'workspace' ? 'workspace' : 'global';

    // v11.31 — an explicit id is a key, not a free-form string. Reject junk and
    // enforce GLOBAL uniqueness across both scopes: the same id used to be
    // creatable in global AND workspace, which made flowsDelete leave orphans.
    const supplied = input?.id === undefined || input?.id === null ? '' : String(input.id).trim();
    const id = supplied ? validFlowId(supplied) : null;
    if (supplied && !id) throw new Error('INVALID_FLOW_ID');
    const finalId = id ?? randomUUID();

    if (scope === 'workspace') {
      const ws = requireWorkspace(wsPath);
      const store = readWorkspaceStore(ws);
      if (readGlobalStore().flows.some((f) => f.id === finalId)) throw new Error('scope-mismatch');
      if (store.flows.some((f) => f.name.toLowerCase() === name.toLowerCase() && f.id !== finalId)) {
        throw new Error('duplicate');
      }
      const existing = store.flows.find((f) => f.id === finalId);
      if (existing) {
        existing.name = name;
        existing.prompt = prompt;
      } else {
        if (store.flows.length >= MAX_WORKSPACE_FLOWS) {
          throw new Error(`Workspace flow limit reached (${MAX_WORKSPACE_FLOWS}). Delete one first.`);
        }
        store.flows.push({
          id: finalId,
          name,
          prompt,
          scope: 'workspace',
          createdAt: Date.now(),
          runCount: 0,
        });
      }
      writeWorkspaceStore(ws, store);
      return mergedFlows(ws);
    }

    const store = readGlobalStore();
    let workspace: string | null = null;
    try {
      workspace = wsPath && String(wsPath).trim() ? requireWorkspace(wsPath) : null;
    } catch {
      workspace = null; // merged view is best-effort, never fail a global save
    }
    if (workspace && readWorkspaceStore(workspace).flows.some((f) => f.id === finalId)) {
      throw new Error('scope-mismatch');
    }
    if (store.flows.some((f) => f.name.toLowerCase() === name.toLowerCase() && f.id !== finalId)) {
      throw new Error('duplicate');
    }
    const existing = store.flows.find((f) => f.id === finalId);
    if (existing) {
      existing.name = name;
      existing.prompt = prompt;
    } else {
      if (store.flows.length >= MAX_GLOBAL_FLOWS) {
        throw new Error(`Global flow limit reached (${MAX_GLOBAL_FLOWS}). Delete one first.`);
      }
      store.flows.push({
        id: finalId,
        name,
        prompt,
        scope: 'global',
        createdAt: Date.now(),
        runCount: 0,
      });
    }
    writeGlobalStore(store);
    return workspace ? mergedFlows(workspace) : mergedFlows();
  });
}

/** Delete by id (workspace store first, then global). Returns the updated list. */
export function flowsDelete(id: string, wsPath?: string): Promise<Flow[]> {
  return mutate(() => {
    const fid = String(id ?? '').trim();
    if (!fid) throw new Error('A flow id is required.');
    let ws: string | undefined;
    try {
      ws = wsPath ? requireWorkspace(wsPath) : undefined;
    } catch {
      ws = undefined; // bad workspace path — still allow deleting the global flow
    }
    let deleted = false;
    if (ws) {
      const store = readWorkspaceStore(ws);
      const before = store.flows.length;
      store.flows = store.flows.filter((f) => f.id !== fid);
      if (store.flows.length !== before) {
        writeWorkspaceStore(ws, store);
        deleted = true;
      }
    }
    if (!deleted) {
      const store = readGlobalStore();
      const before = store.flows.length;
      store.flows = store.flows.filter((f) => f.id !== fid);
      if (store.flows.length !== before) writeGlobalStore(store);
    }
    return ws ? mergedFlows(ws) : mergedFlows();
  });
}

/**
 * Bump runCount / lastRun after the renderer re-sends a flow's prompt as
 * a chat message. Workspace flows resolve against wsPath, then global.
 */
export function flowsMarkRun(id: string, wsPath?: string): Promise<boolean> {
  return mutate(() => {
    // v11.31 — report whether the run was actually recorded. The UI can still
    // ignore this (it's best-effort), but a stale id is no longer a silent
    // success that hides a broken run/record link.
    const fid = validFlowId(id);
    if (!fid) return false;
    let ws: string | undefined;
    try {
      ws = wsPath ? requireWorkspace(wsPath) : undefined;
    } catch {
      ws = undefined;
    }
    if (ws) {
      const store = readWorkspaceStore(ws);
      const flow = store.flows.find((f) => f.id === fid);
      if (flow) {
        flow.runCount += 1;
        flow.lastRun = Date.now();
        writeWorkspaceStore(ws, store);
        return true;
      }
    }
    const g = readGlobalStore();
    const flow = g.flows.find((f) => f.id === fid);
    if (flow) {
      flow.runCount += 1;
      flow.lastRun = Date.now();
      writeGlobalStore(g);
      return true;
    }
    return false;
  });
}

/**
 * Count one more repetition of a typed prompt. When it reaches
 * SUGGEST_THRESHOLD repetitions and NO existing flow normalizes to the
 * same text, suggest saving it as a flow — ONCE (latched via
 * `suggested`), afterwards only on every 5th repetition (count % 5 == 0).
 * The dedupe check covers the GLOBAL flow list (flowsHit carries no
 * workspace context by contract).
 */
export async function flowsHit(text: string): Promise<FlowsHitResult> {
  const norm = normalizeHitText(text);
  if (!norm) return { count: 0, suggest: false, text: norm };
  try {
    return await mutate(() => {
      const store = readGlobalStore();
      const key = hitHash(norm);
      const prev = store.hits[key];
      // v11.38 — capture the exact raw prompt on the FIRST hit so a suggestion
      // can restore it verbatim. Later repeats keep the original (they may be
      // whitespace-padded). Never overwrite with a shorter/normalized form.
      const entry: FlowHit = prev ?? {
        count: 0,
        text: norm,
        original: String(text ?? '').trim().slice(0, HIT_ORIGINAL_CAP),
        updatedAt: Date.now(),
      };
      if (!entry.original && String(text ?? '').trim()) {
        entry.original = String(text ?? '').trim().slice(0, HIT_ORIGINAL_CAP);
      }
      entry.count += 1;
      entry.updatedAt = Date.now();
      let suggest = false;
      const alreadyAFlow = store.flows.some((f) => normalizeHitText(f.prompt) === norm);
      if (entry.count >= SUGGEST_THRESHOLD && !alreadyAFlow) {
        if (!entry.suggested) {
          suggest = true;
          entry.suggested = true;
        } else if (entry.count % 5 === 0) {
          suggest = true; // gentle re-ping on every 5th repetition
        }
      }
      store.hits[key] = entry;
      pruneHits(store);
      writeGlobalStore(store);
      return { count: entry.count, suggest, text: norm };
    });
  } catch {
    return { count: 0, suggest: false, text: norm }; // best-effort — never break typing
  }
}

/** One honest "you keep typing this" suggestion, derived from the real hit store. */
export interface FlowSuggestionItem {
  /** Normalized key (stable, safe to use as a React key). */
  text: string;
  /** The EXACT first-seen prompt — what "save as flow" must persist verbatim. */
  raw: string;
  count: number;
  /** True once the chat chip already offered this suggestion. */
  suggested: boolean;
}

/**
 * v11.38 — prompts the user typed ≥SUGGEST_THRESHOLD times that are NOT already
 * saved as a flow. Read-only, never throws, never fabricates a suggestion.
 * This is the single source of truth for both the chat chip and the Flows page.
 */
export function flowsSuggestions(ws?: string): FlowSuggestionItem[] {
  try {
    const g = readGlobalStore();
    const saved = new Set(g.flows.map((f) => normalizeHitText(f.prompt)));
    if (ws && String(ws).trim()) {
      try {
        for (const f of readWorkspaceStore(requireWorkspace(ws)).flows) saved.add(normalizeHitText(f.prompt));
      } catch {
        /* no/invalid workspace — global dedupe still applies */
      }
    }
    return Object.values(g.hits)
      .filter((h) => h.count >= SUGGEST_THRESHOLD && !saved.has(h.text))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
      .map((h) => ({
        text: h.text,
        raw: h.original ?? h.text,
        count: h.count,
        suggested: h.suggested === true,
      }));
  } catch {
    return [];
  }
}

/**
 * v11.38 — extended info. `FlowsInfo` lives in shared/types.ts (read-only for
 * this owner) so the extra fields are added through a local supertype; older
 * consumers keep working unchanged. The renderer can surface REAL, deduped
 * repetition suggestions through the already-existing `flowsInfo` bridge.
 */
export interface FlowsInfoPro extends FlowsInfo {
  repeatedPrompts: number;
  suggestionTexts: string[];
}

/** Store summary for the UI (kdx:flows:info). Never throws. */
export function flowsInfo(ws?: string): FlowsInfoPro {
  try {
    const g = readGlobalStore();
    let workspaceCount = 0;
    if (ws && String(ws).trim()) {
      try {
        workspaceCount = readWorkspaceStore(requireWorkspace(ws)).flows.length;
      } catch {
        /* no/invalid workspace */
      }
    }
    const suggestions = flowsSuggestions(ws);
    return {
      globalCount: g.flows.length,
      workspaceCount,
      hitsTracked: Object.keys(g.hits).length,
      repeatedPrompts: suggestions.length,
      suggestionTexts: suggestions.map((s) => s.raw),
    };
  } catch {
    return { globalCount: 0, workspaceCount: 0, hitsTracked: 0, repeatedPrompts: 0, suggestionTexts: [] };
  }
}

// ---------- IPC self-registration (dna.ts v2 pattern) ----------

let flowsIpcRegistered = false;

function registerFlowsIpc(): void {
  if (flowsIpcRegistered) return;
  // The CLI engine runs under plain Node with an electron stub — ipcMain is
  // undefined there. Guard so the agent engine keeps working headless.
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  flowsIpcRegistered = true;
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (_event: unknown, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    });
  };

  // global list; ws → merged with that workspace's flows (scope:'workspace')
  handle('kdx:flows:list', (ws?: string) => flowsList(typeof ws === 'string' ? ws : undefined));
  // create/update; duplicate name in the same scope → Error('duplicate')
  handle(
    'kdx:flows:save',
    (input?: { id?: string; name?: string; prompt?: string; scope?: string }, ws?: string) =>
      flowsSave(input ?? {}, typeof ws === 'string' ? ws : undefined),
  );
  handle('kdx:flows:delete', (id?: string, ws?: string) =>
    flowsDelete(String(id ?? ''), typeof ws === 'string' ? ws : undefined),
  );
  handle('kdx:flows:markRun', (id?: string, ws?: string) =>
    flowsMarkRun(String(id ?? ''), typeof ws === 'string' ? ws : undefined),
  );
  handle('kdx:flows:hit', (text?: string) => flowsHit(String(text ?? '')));
  handle('kdx:flows:info', (ws?: string) => flowsInfo(typeof ws === 'string' ? ws : undefined));
  // v11.38 — honest, read-only repetition suggestions. The renderer can reach
  // this once preload exposes `flowsSuggestions` (see handoff in the v1138 doc);
  // the same data is already in `kdx:flows:info` via the existing bridge.
  handle('kdx:flows:suggestions', (ws?: string) => flowsSuggestions(typeof ws === 'string' ? ws : undefined));
}

/** Called once at boot from agent/register.ts (main.ts → registerAgentIpc). */
export function initFlows(): void {
  registerFlowsIpc();
}

// ============================================================
// v7.1 — CORRECTIONS → RULES: learn from what the user REJECTS.
// v7.0's flows only noticed repeated PROMPTS. The sharper signal is
// repeated CORRECTIONS: denied commands, refused writes. This module
// records them (called from the engine's denial path), groups them,
// and — after ≥3 similar hits — suggests saving the corrected shape
// as a flow, then VALIDATES the flow by replaying its stored command
// in a captured (no side effects beyond the command itself) run.
// ============================================================

export interface FlowCorrection {
  id: string;
  category: 'denied-command' | 'denied-write' | 'user-edit';
  text: string; // normalized shape (command head / path)
  raw: string; // first-seen raw text (truncated)
  count: number;
  firstAt: number;
  lastAt: number;
  suggested?: boolean;
}

const CORRECTIONS_THRESHOLD = 3;
let correctionsCache: FlowCorrection[] | null = null;

function correctionsFile(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
    return path.join(app?.getPath?.('userData') ?? process.cwd(), 'flows-corrections.json');
  } catch {
    return path.join(process.cwd(), 'flows-corrections.json');
  }
}

function readCorrections(): FlowCorrection[] {
  if (correctionsCache) return correctionsCache;
  try {
    const raw = JSON.parse(fsSync.readFileSync(correctionsFile(), 'utf8')) as FlowCorrection[];
    // v11.31 — never trust on-disk shape: a corrupt/tampered entry must not
    // throw later when the suggestion engine reads .raw/.count.
    correctionsCache = Array.isArray(raw)
      ? raw
          .filter((c): c is FlowCorrection =>
            !!c && typeof c === 'object' && typeof c.text === 'string' && typeof c.count === 'number',
          )
          .slice(-400)
      : [];
  } catch {
    correctionsCache = [];
  }
  return correctionsCache!;
}

function writeCorrections(list: FlowCorrection[]): void {
  // v11.31 — same atomic 0600 path as the flow store (no torn JSON, no world-
  // readable correction shapes). Cap is enforced here so EVERY caller gets it.
  const capped = list.slice(-400);
  correctionsCache = capped;
  try {
    writeJsonAtomic(correctionsFile(), capped);
  } catch {
    /* persistence is best-effort */
  }
}

/** Shape a correction into a groupable key: leading tokens, paths kept. */
function correctionShape(category: FlowCorrection['category'], raw: string): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (category === 'denied-command') {
    const parts = t.split(' ').slice(0, 2).join(' ');
    return `cmd:${parts.toLowerCase()}`;
  }
  return `${category}:${t.slice(0, 80).toLowerCase()}`;
}

/** Record a correction (fire-and-forget safe — never throws). */
export function flowsRecordCorrection(category: FlowCorrection['category'], raw: string): void {
  try {
    // v11.31 — reject unknown categories instead of persisting garbage shapes.
    if (category !== 'denied-command' && category !== 'denied-write' && category !== 'user-edit') return;
    const shape = correctionShape(category, raw);
    if (!shape) return;
    const list = readCorrections();
    const existing = list.find((c) => c.text === shape);
    if (existing) {
      existing.count++;
      existing.lastAt = Date.now();
    } else {
      list.push({
        id: randomUUID().slice(0, 8),
        category,
        text: shape,
        raw: String(raw ?? '').slice(0, 200),
        count: 1,
        firstAt: Date.now(),
        lastAt: Date.now(),
      });
    }
    writeCorrections(list);
  } catch {
    /* never throw from feedback capture */
  }
}

/** Corrections that crossed the threshold and have not been suggested yet. */
export function flowsCorrectionSuggestions(): Array<{ id: string; category: string; raw: string; count: number; suggestedName: string }> {
  try {
    return readCorrections()
      .filter((c) => c.count >= CORRECTIONS_THRESHOLD)
      .map((c) => ({
        id: c.id,
        category: c.category,
        raw: c.raw,
        count: c.count,
        suggestedName: `Avoid: ${c.raw.split(' ').slice(0, 4).join(' ')}`.slice(0, NAME_CAP),
      }));
  } catch {
    return [];
  }
}

/** Mark a suggestion as handled (latched). */
export function flowsMarkSuggested(correctionId: string): void {
  try {
    const list = readCorrections();
    const c = list.find((x) => x.id === correctionId);
    if (c) {
      c.suggested = true;
      writeCorrections(list);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Validate a flow by REPLAY: runs the flow's prompt-shaped command (the
 * stored text) as a captured run and reports the exit code. A flow that
 * fails replay is flagged in the result — the suggestion engine never
 * activates a flow it could not reproduce.
 */
export async function flowsValidateByReplay(flowId: string, wsPath?: string): Promise<{ ok: boolean; exitCode: number; detail: string }> {
  if (!validFlowId(flowId)) return { ok: false, exitCode: -1, detail: 'INVALID_FLOW_ID' };
  // v11.31 — a replay is a REAL shell command; never let an unvalidated path
  // choose where it runs. Fail closed with an honest detail instead.
  let cwd = process.cwd();
  if (wsPath && String(wsPath).trim()) {
    try {
      cwd = requireWorkspace(wsPath);
    } catch (err) {
      return { ok: false, exitCode: -1, detail: `invalid replay workspace: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  try {
    const flows = flowsList(cwd);
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return { ok: false, exitCode: -1, detail: `flow ${flowId} not found` };
    const { runCaptured } = await import('./terminalService');
    const r = await runCaptured(String(flow.prompt).slice(0, 400), cwd, 60_000);
    return {
      ok: r.exitCode === 0,
      exitCode: r.exitCode,
      detail: r.exitCode === 0 ? 'replay succeeded (exit 0)' : `replay failed (exit ${r.exitCode}): ${r.output.slice(-160).replace(/\s+/g, ' ')}`,
    };
  } catch (err) {
    return { ok: false, exitCode: -1, detail: err instanceof Error ? err.message : String(err) };
  }
}
