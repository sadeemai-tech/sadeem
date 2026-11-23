// ============================================================
// SADEEM — compaction contract helpers (watchdog/compaction subagent)
// ------------------------------------------------------------
// The engine's auto-compact block currently implements these two rules
// INLINE (engine.ts ~4194-4202 and ~4270). This module is the canonical,
// independently testable implementation of that contract:
//
//   1. A compaction call declares `tools: []`. Therefore NO tool_use /
//      tool_result block may be sent — every message is flattened to plain
//      text first (Anthropic AND OpenAI-compatible endpoints 400 otherwise;
//      that was the historic "disconnects right after compaction" bug).
//   2. The ORIGINAL TASK statement must survive compaction. `params.task` is
//      only the task KIND ('chat' | 'compact' | 'init') — using it as the
//      original task (engine.ts:4270) emits the literal word "chat" and the
//      model forgets WHAT it was building. Recover the first real user
//      message instead.
//
// Wiring (owned by the engine.ts owner, 2 lines):
//   import { flattenToolBlocksForCompaction, originalTaskText } from './compaction';
//   const flatHead = flattenToolBlocksForCompaction(head);
//   const originalTask = originalTaskText(head, params.messages);
// No behavior changes elsewhere; safe to adopt incrementally.
// ============================================================

import type { ProviderMsg } from './providers';
import {
  memorySnapshot,
  readMemorySnapshot,
  readMemoryHistory,
  renderMemorySnapshot,
  MAX_STORED_FACTS,
  RENDER_CAP,
  type MemorySnapshot,
  type MemoryRevision,
  type MemorySnapshotInput,
} from './memory';

export {
  memorySnapshot,
  readMemorySnapshot,
  readMemoryHistory,
  renderMemorySnapshot,
  MAX_STORED_FACTS,
  RENDER_CAP,
  type MemorySnapshot,
  type MemoryRevision,
  type MemorySnapshotInput,
};

/** Minimal shape shared by ProviderMsg and the renderer's ChatMessage. */
interface TaskSource {
  role?: string;
  text?: string;
  content?: string;
}

const DEFAULT_ASSISTANT_CHARS = 4_000;
const DEFAULT_TOOL_RESULT_CHARS = 800;
const DEFAULT_TASK_CHARS = 1_200;

/** Harness-injected user rows are summary/progress markers, not the task. */
const SYNTHETIC_TASK_RE =
  /^\[(?:Previous running summary|Conversation auto-compacted|tool result|active goal|Newer messages)/i;

function sourceText(m: TaskSource): string {
  return String((m as { text?: unknown }).text ?? (m as { content?: unknown }).content ?? '');
}

/**
 * Flatten a conversation head into provider messages that are SAFE for a
 * `tools: []` compaction request: no toolCalls, no tool_result role, and no
 * thinking-block metadata ever reaches the summarizer.
 */
export function flattenToolBlocksForCompaction(
  messages: readonly ProviderMsg[],
  opts: { maxAssistantChars?: number; maxToolResultChars?: number } = {},
): ProviderMsg[] {
  const assistantCap = Math.max(200, opts.maxAssistantChars ?? DEFAULT_ASSISTANT_CHARS);
  const toolCap = Math.max(100, opts.maxToolResultChars ?? DEFAULT_TOOL_RESULT_CHARS);
  return messages.map((m: any): ProviderMsg => {
    if (m.role === 'assistant') {
      // Drop toolCalls/thinking/thinkingSignature — text only. The placeholder
      // keeps the turn's position so the summary model sees the step happened.
      return { role: 'assistant', text: String(m.text ?? '').slice(0, assistantCap) || '(tool-use step)' };
    }
    if (m.role === 'tool_result' || m.role === 'tool') {
      return { role: 'user', text: `[tool result] ${String(m.content ?? m.text ?? '').slice(0, toolCap)}` };
    }
    // 'user' (and any future role) passes through as plain text.
    if (m.role === 'user') return { role: 'user', text: String(m.text ?? '') };
    return { role: 'user', text: String(m.text ?? m.content ?? '') };
  });
}

/**
 * Recover the real original task text.
 *
 * Prefer the FIRST genuine user message of the whole session (the renderer's
 * `params.messages`). Fall back to the oldest user message in the head slice
 * being compacted, skipping our own compaction/summary markers. Never return
 * the task KIND ("chat") — that is the bug this helper exists to prevent.
 */
export function originalTaskText(
  head: readonly TaskSource[],
  rawMessages: readonly TaskSource[] = [],
): string {
  const find = (list: readonly TaskSource[]): string => {
    for (const m of list) {
      if (!m || m.role !== 'user') continue;
      const t = sourceText(m).trim();
      if (t && !SYNTHETIC_TASK_RE.test(t)) return t.slice(0, DEFAULT_TASK_CHARS);
    }
    return '';
  };
  return find(rawMessages) || find(head) || '';
}

// ============================================================
// v11.15 — CUMULATIVE COMPACTION MEMORY
// ------------------------------------------------------------
// The original compaction contract above only preserved (1) tool-block safety
// and (2) the original task text. It did NOT preserve LEARNED STATE across
// compactions: decisions, files touched, user preferences and pending steps
// were left to the summarizer model, which drifts ("lost in the middle") on
// the 2nd/3rd compaction and forgets facts from earlier ones.
//
// `buildCompactionMemory` fixes that by persisting a single structured,
// ADVISORY session memory (memory.memorySnapshot) from REAL data and returning
// a ready-to-prepend block. Old facts are never dropped — each compaction
// merges new facts into the durable snapshot and appends a version to its
// history. The block is self-describing and honest: it only lists facts that
// came from the journal, playbook, DNA, the real user message, or the model's
// own compaction summary sections.
//
// ENGINE WIRING (owner of engine.ts — A1; no change to the summarizer call):
//   1) Replace the inline `const originalTask = originalTaskText(head, params.messages)`
//      with `compaction.originalTaskText(head, params.messages)` (same helper).
//   2) AFTER `compactSoFar = merged.trim().slice(0, 40_000)` (~engine.ts:4451) and
//      BEFORE `messages.length = 0` (~engine.ts:4467), persist + build the block:
//        const cm = buildCompactionMemory({
//          head, rawMessages: params.messages, summary: merged, // merged starts as compactSoFar
//          workspace, userDataDir: electronUserDataDirSafe(), sessionId: params.sessionId,
//          decisions, filesTouched, preferences, pendingSteps, // optional explicit facts
//          reason: 'auto-compact',
//        });
//   3) Append the advisory block to the post-compaction user message text built
//      at ~engine.ts:4468-4477 (the one that starts with the pinned/taskNote):
//        if (cm.block) messages[0].text += '\n\n' + cm.block;
//   `cm.block` is ADVISORY (starts with the literal `CUMULATIVE SESSION MEMORY`
//   marker that prompts.ts:playbookCarriesMemory keys on) — never a user rule.
//   `cm.carryForward` is the structured five-category snapshot for journaling.
//   The block renders at RENDER_CAP (4_000) chars; the FULL set always stays on
//   disk and is replayed on the next compaction / after a restart.
// ============================================================

export interface CompactionMemoryInput extends MemorySnapshotInput {
  /** The message slice being compacted (used for the real original task). */
  head: readonly TaskSource[];
  /** Full session messages — preferred source for the original task. */
  rawMessages?: readonly TaskSource[];
}

/**
 * The five durable facts the founder requires every compaction to carry
 * FORWARD, exported as plain arrays so the engine can journal/log them (or
 * build its own note) without depending on the internal MemoryFact shape.
 */
export interface CompactionCarryForward {
  version: number;
  workspace: string;
  updatedAt: number;
  /** The FIRST real user task — authoritative across every compaction. */
  originalTask: string;
  decisions: string[];
  filesTouched: string[];
  preferences: string[];
  pendingSteps: string[];
  sources: string[];
}

/**
 * Project a persisted snapshot into the structured carry-forward contract.
 * Pure / never throws. Works on a null snapshot (returns empty arrays).
 */
export function buildCompactionCarryForward(snapshot: MemorySnapshot | null | undefined): CompactionCarryForward {
  const texts = (key: 'decisions' | 'filesTouched' | 'preferences' | 'pendingSteps'): string[] =>
    snapshot ? (snapshot[key] ?? []).map((f) => f.text) : [];
  return {
    version: snapshot?.version ?? 0,
    workspace: snapshot?.workspace ?? '',
    updatedAt: snapshot?.updatedAt ?? 0,
    originalTask: snapshot?.originalTask ?? '',
    decisions: texts('decisions'),
    filesTouched: texts('filesTouched'),
    preferences: texts('preferences'),
    pendingSteps: texts('pendingSteps'),
    sources: snapshot ? [...snapshot.sources] : [],
  };
}

export interface CompactionMemoryResult {
  /** The recovered first real user task (never the task KIND like "chat"). */
  originalTask: string;
  /** The persisted, cumulative, structured memory. */
  snapshot: MemorySnapshot;
  /** Structured carry-forward (plain arrays) for journaling / programmatic use. */
  carryForward: CompactionCarryForward;
  /** Advisory block ready to append to the post-compaction user message. */
  block: string;
}

/**
 * Persist a cumulative memory snapshot at compaction time and return the
 * advisory block that keeps decisions/files/preferences/pending steps alive
 * across THIS and every FUTURE compaction (and across restarts).
 * Never throws.
 */
export function buildCompactionMemory(input: CompactionMemoryInput): CompactionMemoryResult {
  const originalTask = originalTaskText(input.head, input.rawMessages ?? []);
  let snapshot: MemorySnapshot;
  try {
    snapshot = memorySnapshot({
      ...input,
      originalTask: input.originalTask || originalTask,
      reason: input.reason ?? 'auto-compact',
    });
  } catch {
    snapshot = readMemorySnapshot(input.workspace ?? '');
  }
  return {
    originalTask: originalTask || snapshot.originalTask,
    snapshot,
    carryForward: buildCompactionCarryForward(snapshot),
    block: renderMemorySnapshot(snapshot),
  };
}

/**
 * Render just the carry-forward block from the CURRENT on-disk snapshot.
 * Read-only — useful for the engine to attach memory without writing again.
 */
export function currentCompactionMemoryBlock(workspace: string): string {
  return renderMemorySnapshot(readMemorySnapshot(workspace));
}

/** Structured carry-forward from the CURRENT on-disk snapshot (read-only). */
export function currentCompactionCarryForward(workspace: string): CompactionCarryForward {
  return buildCompactionCarryForward(readMemorySnapshot(workspace));
}
