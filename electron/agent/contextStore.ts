// ============================================================
// Surnia v7 — context store: tool-result pruning + recall
// Old, huge tool results are replaced in the live transcript by a
// one-line stub + handle; the agent can fetch the FULL original text
// back with the recall_result tool when it actually needs it.
// Nothing is silently deleted: pruning = moving text out of the
// prompt, not out of reach.
// ============================================================
import type { ProviderMsg } from './providers';

export interface PrunedResult {
  tool: string;
  callId: string;
  content: string;
  at: number;
}

interface SessionVault {
  byId: Map<string, PrunedResult>;
  order: string[]; // insertion order for LRU eviction
}

const vaults = new Map<string, SessionVault>();

const VAULT_CAP_ENTRIES = 200;
const VAULT_CAP_CHARS = 2_000_000;

function vaultFor(sessionId: string): SessionVault {
  let v = vaults.get(sessionId);
  if (!v) {
    if (vaults.size >= 32) vaults.delete(vaults.keys().next().value as string);
    v = { byId: new Map(), order: [] };
    vaults.set(sessionId, v);
  }
  return v;
}

export function clearVault(sessionId: string): void {
  vaults.delete(sessionId);
  clearPins(sessionId); // v12 — pinned context is session-scoped too
}

// ============================================================
// v12 — PINNED CONTEXT: notes/snippets the agent explicitly pins so they
// survive tool-result pruning AND conversation compaction (re-injected every
// turn). Bounded per session; never throws.
// ============================================================
export interface ContextPin { id: string; label?: string; text: string; at: number }
const pins = new Map<string, ContextPin[]>();
const PIN_CAP = 24;
const PIN_CHARS = 4000;
const PIN_TOTAL = 20_000;

function pinVault(sid: string): ContextPin[] {
  let a = pins.get(sid);
  if (!a) {
    if (pins.size >= 32) pins.delete(pins.keys().next().value as string);
    a = [];
    pins.set(sid, a);
  }
  return a;
}

/** Pin a note; returns its handle id. */
export function addPin(sessionId: string, text: string, label?: string): string {
  const a = pinVault(sessionId);
  const id = `pin_${a.length + 1}_${Date.now().toString(36).slice(-6)}`;
  a.push({ id, label, text: String(text ?? '').slice(0, PIN_CHARS), at: Date.now() });
  while (a.length > PIN_CAP) a.shift();
  return id;
}

export function listPins(sessionId: string): ContextPin[] {
  return [...(pins.get(sessionId) ?? [])];
}

export function removePin(sessionId: string, id: string): boolean {
  const a = pins.get(sessionId);
  if (!a) return false;
  const i = a.findIndex((p) => p.id === id);
  if (i < 0) return false;
  a.splice(i, 1);
  return true;
}

export function clearPins(sessionId: string): void {
  pins.delete(sessionId);
}

/** Render pinned context for injection into the system prompt. */
export function renderPins(sessionId: string): string {
  const a = pins.get(sessionId);
  if (!a?.length) return '';
  const parts: string[] = [];
  let used = 0;
  for (const p of a) {
    const line = `[PINNED CONTEXT${p.label ? ` · ${p.label}` : ''}] ${p.text}`;
    if (used + line.length > PIN_TOTAL) break;
    parts.push(line);
    used += line.length;
  }
  return parts.join('\n\n');
}

/** Store a full tool result and return its recall handle id. */
export function stashResult(sessionId: string, tool: string, callId: string, content: string): string {
  const v = vaultFor(sessionId);
  const id = `res_${v.order.length + 1}_${callId.slice(-8) || Math.random().toString(36).slice(2, 8)}`;
  v.byId.set(id, { tool, callId, content, at: Date.now() });
  v.order.push(id);
  // enforce caps (LRU from the front)
  while (v.order.length > VAULT_CAP_ENTRIES) {
    const drop = v.order.shift();
    if (drop) v.byId.delete(drop);
  }
  return id;
}

/** Fetch a pruned result by handle (moves to MRU). */
export function recallResult(sessionId: string, id: string): PrunedResult | null {
  const v = vaults.get(sessionId);
  if (!v) return null;
  const hit = v.byId.get(id);
  if (hit) {
    const i = v.order.indexOf(id);
    if (i >= 0) {
      v.order.splice(i, 1);
      v.order.push(id);
    }
  }
  return hit ?? null;
}

export interface PruneStats {
  pruned: number;
  charsSaved: number;
}

/**
 * Prune LARGE old tool results in-place. Keeps the most recent
 * `keepRecent` tool results verbatim regardless of size; older ones above
 * `minChars` become a stub + handle. Never touches: the pinned first user
 * message, error results, or results carrying images (vision context).
 */
export function pruneToolResults(
  sessionId: string,
  messages: ProviderMsg[],
  opts: { minChars?: number; keepRecent?: number } = {},
): PruneStats {
  const minChars = opts.minChars ?? 2_400;
  const keepRecent = opts.keepRecent ?? 6;
  const stats: PruneStats = { pruned: 0, charsSaved: 0 };

  // collect indices of tool_result messages (excluding the most recent N)
  const idx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'tool_result' && !m.isError && !(m.images && m.images.length)) idx.push(i);
  }
  const targets = idx.slice(0, Math.max(0, idx.length - keepRecent));
  for (const i of targets) {
    const m = messages[i];
    if (m.role !== 'tool_result') continue;
    if (m.content.length <= minChars || m.content.startsWith('[pruned')) continue;
    const tool = inferToolName(messages, i);
    const id = stashResult(sessionId, tool, m.callId, m.content);
    stats.charsSaved += m.content.length - 0;
    stats.pruned++;
    messages[i] = {
      role: 'tool_result',
      callId: m.callId,
      isError: false,
      content:
        `[pruned to save context — full ${m.content.length}-char result from ${tool} is retrievable] ` +
        `Call recall_result with id="${id}" if you need the original text.`,
    };
  }
  return stats;
}

/** Best-effort tool-name inference from the preceding assistant toolCalls entry. */
function inferToolName(messages: ProviderMsg[], resultIdx: number): string {
  for (let i = resultIdx - 1; i >= 0 && i >= resultIdx - 3; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const callId = (messages[resultIdx] as { callId?: string }).callId;
      const match = callId ? m.toolCalls.find((c) => c.id === callId) : undefined;
      return match?.name ?? m.toolCalls[m.toolCalls.length - 1].name;
    }
  }
  return 'unknown_tool';
}

// ------------------------------------------------------------
// v7 — tool-result SHAPING: long build/test logs become structured
// evidence (errors grouped, head+tail kept) instead of a raw firehose.
// ------------------------------------------------------------

const SHAPE_OVER_CHARS = 4_000;

/**
 * Shape a long command output: keep head (context) + tail (result), extract
 * error/warning lines deduped, and stash the FULL text in the recall vault so
 * nothing is lost. Returns the replacement text (or the original when short).
 */
export function shapeLogOutput(
  sessionId: string,
  tool: string,
  output: string,
  exitCode: number,
): string {
  if (output.length <= SHAPE_OVER_CHARS) return output;
  const id = stashResult(sessionId, tool, `shaped_${Date.now().toString(36)}`, output);
  const lines = output.split('\n');
  const errRe = /(error|Error|ERROR|FAIL(?:ED|ure)?|failed|fatal|FATAL|exception|Exception|✗|×|cannot find|Cannot find|not found|No such)/;
  const warnRe = /(warning|Warning|WARN|deprecated|Deprecated)/;
  const errs: string[] = [];
  const warns: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const t = l.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (errRe.test(t) && errs.length < 24) errs.push(t.slice(0, 200));
    else if (warnRe.test(t) && warns.length < 10) warns.push(t.slice(0, 160));
  }
  const head = lines.slice(0, 12).join('\n');
  const tail = lines.slice(-22).join('\n');
  const parts = [
    `[shaped log — ${output.length} chars → summary; FULL original retrievable via recall_result id="${id}"]`,
    exitCode !== 0 ? `EXIT CODE: ${exitCode} (FAILED)` : 'exit code: 0',
  ];
  if (errs.length) parts.push(`ERRORS (${errs.length}):\n  ${errs.join('\n  ')}`);
  if (warns.length) parts.push(`warnings (${warns.length}):\n  ${warns.join('\n  ')}`);
  parts.push(`--- head ---\n${head}`);
  parts.push(`--- tail ---\n${tail}`);
  return parts.join('\n');
}
