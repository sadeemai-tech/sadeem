// ============================================================
// SADEEM v11.38 — SIGNATURE FEATURES (three original instruments)
// ------------------------------------------------------------
// This module is PURE: it never writes, never calls an LLM, and never
// invents a datum. Every field in every result comes from one of three
// REAL stores that SADEEM already keeps locally:
//
//   1. the run LEDGERS — session messages (tool_call/tool_result pairs
//      with real JSON args + real output), the crash-resilient JSONL
//      journal (engine.ts:6619 / 2585) and the JSONL trace
//      (traces.ts:166-194). → buildTrajectory()
//   2. dna.json — stored patterns/feedback/profile, read through
//      loadDNA() by the caller. → autopsyDNA()
//   3. tool-defs.ts CORE_DEFS — the real 145-tool inventory, including
//      the "Do NOT use X — use Y" routing sentences the model already
//      receives. → compass() / toolRoutingGraph()
//
// Design contract (same honesty posture as journal.ts / dna.ts):
//   - Never fabricate. A missing input/output stays undefined; an empty
//     store returns an explicit `emptyReason` code, never placeholder rows.
//   - Bounded. Text previews, step counts and evidence lists are capped;
//     every cap is reported (`truncated` / `stepsTotal`) instead of silently
//     cutting a line mid-word.
//   - Cross-platform, no static `electron` / `node:` imports: the renderer
//     imports the same functions (SignaturePanel.tsx) and the tests drive
//     them with files written by the REAL journal/trace/dna writers.
//   - No new IPC surface. The UI reuses api.journalList/journalRead,
//     api.dnaGet and the store's real sessions; this module only computes.
// ============================================================
import { CORE_DEFS, type ToolCategory } from './tool-defs';
import type { TraceStep } from './traces';

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

const DEFAULT_MAX_STEPS = 160;
const DEFAULT_MAX_CHARS = 1200;
const EVIDENCE_PER_FINDING = 3;
const DAY_MS = 86_400_000;

/** Bounded, honest preview: the `clipped` flag is part of the result. */
function clip(value: unknown, max: number): { text: string; clipped: boolean } {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return { text: '', clipped: false };
  return raw.length <= max
    ? { text: raw, clipped: false }
    : { text: raw.slice(0, Math.max(1, max)).trimEnd() + '…', clipped: true };
}

/** Unicode-aware tokenizer, identical in spirit to dna.ts:894 (tokenize). */
export function tokens(input: unknown): string[] {
  return (typeof input === 'string' ? input : '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 40);
}

function overlap(a: readonly string[], b: readonly string[]): number {
  const set = new Set(b);
  let n = 0;
  for (const t of a) if (set.has(t)) n++;
  return n;
}

/** Split a REAL description into sentences without rewriting its words. */
function sentences(text: string): string[] {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stable ascending order, independent of the host's sort stability. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

// ============================================================
// 1 · TRAJECTORY REPLAY — three ledgers, one honest step thread
// ============================================================

/** The minimal real message shape persisted in <userData>/sessions/*.json. */
export interface LedgerMessage {
  id?: string;
  role?: string;
  kind?: string;
  toolName?: string;
  toolCallId?: string;
  content?: string;
  resultOk?: boolean;
  timestamp?: number;
  thinking?: string;
}

/** The real lines appended by journal.ts (header + {at,type,...} events). */
export interface LedgerEvent {
  at?: number;
  type?: string;
  name?: string;
  ok?: boolean;
  ms?: number;
  round?: number;
  outcome?: string;
  summary?: string;
  hint?: string;
  howToRun?: string;
  decisions?: string[];
  filesTouched?: string[];
  preferences?: string[];
  pendingSteps?: string[];
  [key: string]: unknown;
}

export type StepKind = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'milestone';
export type StepSource = 'session' | 'journal' | 'trace';

export interface TrajectoryStep {
  index: number;
  at: number | undefined;
  kind: StepKind;
  /** REAL tool name / role / milestone type — never a generated label. */
  label: string;
  /** Real tool arguments, user text or assistant reasoning (clipped). */
  input?: string;
  /** Real tool output or assistant answer (clipped). */
  output?: string;
  inputClipped?: boolean;
  outputClipped?: boolean;
  ok?: boolean;
  toolCallId?: string;
  /** Links a real tool_result to the real call it answers. */
  pairedWith?: number;
  /** Result arrived with no matching call in this ledger — said out loud. */
  unpairedResult?: boolean;
  /** REAL wall-clock duration from the journal's `ms` field. */
  durationMs?: number;
  /** REAL output size from the trace's tool_result `chars` field. */
  traceChars?: number;
  /** Exactly which on-disk ledger(s) supplied THIS step. */
  sources: StepSource[];
}

export interface Trajectory {
  sessionId: string;
  title: string;
  steps: TrajectoryStep[];
  /** Machine code when nothing real could be replayed. */
  emptyReason?: 'NO_LEDGER_DATA';
  truncated: boolean;
  stats: {
    stepsTotal: number;
    stepsShown: number;
    turns: number;
    toolCalls: number;
    failedTools: number;
    unpairedResults: number;
    journalDurationMs: number;
    elapsedMs: number | undefined;
  };
}

export interface TrajectoryInput {
  sessionId?: string;
  title?: string;
  /** Real persisted session messages (tool I/O lives here). */
  messages?: readonly LedgerMessage[];
  /** Real journal lines (timings, task_report, finish, memory_snapshot). */
  journalEvents?: readonly LedgerEvent[];
  /** Real trace steps (argsPreview, ok, chars). */
  traceSteps?: readonly TraceStep[];
  maxSteps?: number;
  maxChars?: number;
}

function msgKind(m: LedgerMessage): StepKind | null {
  if (m.kind === 'tool_call' || m.role === 'tool_call') return 'tool_call';
  if (m.kind === 'tool_result' || m.role === 'tool_result') return 'tool_result';
  if (m.role === 'user') return 'user';
  if (m.role === 'assistant') return 'assistant';
  return null;
}

/**
 * Rebuild a step thread from the REAL session ledger, then attach the REAL
 * timings/milestones from the journal and REAL sizes from the trace.
 *
 * Inputs and outputs are never inferred: if the session only stored a call
 * id, the step says so by leaving `input` undefined. Journal-only events
 * become `milestone` steps carrying their own real type — not fake tool rows.
 */
export function buildTrajectory(input: TrajectoryInput): Trajectory {
  const capSteps = Math.max(1, Math.min(1000, Math.floor(input.maxSteps ?? DEFAULT_MAX_STEPS) || DEFAULT_MAX_STEPS));
  const capChars = Math.max(80, Math.min(8000, Math.floor(input.maxChars ?? DEFAULT_MAX_CHARS) || DEFAULT_MAX_CHARS));
  const steps: TrajectoryStep[] = [];
  const calls: Array<{ index: number; id?: string; name: string }> = [];
  let unpairedResults = 0;

  for (const m of input.messages ?? []) {
    if (!m || typeof m !== 'object') continue;
    const kind = msgKind(m);
    if (!kind) continue;
    const inText = clip(m.content, capChars);
    const reason = clip(m.thinking, Math.min(capChars, 400));
    const label = kind === 'tool_call' || kind === 'tool_result'
      ? String(m.toolName ?? 'tool').slice(0, 120)
      : kind;
    const step: TrajectoryStep = {
      index: steps.length + 1,
      at: typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : undefined,
      kind,
      label,
      sources: ['session'],
    };
    if (kind === 'user') {
      if (inText.text) step.input = inText.text;
      step.inputClipped = inText.clipped;
    } else if (kind === 'assistant') {
      if (reason.text) step.input = reason.text;
      step.inputClipped = reason.clipped;
      if (inText.text) step.output = inText.text;
      step.outputClipped = inText.clipped;
    } else if (kind === 'tool_call') {
      if (inText.text) step.input = inText.text;
      step.inputClipped = inText.clipped;
      if (m.toolCallId) step.toolCallId = String(m.toolCallId).slice(0, 120);
      calls.push({ index: step.index, id: step.toolCallId, name: step.label });
    } else {
      if (inText.text) step.output = inText.text;
      step.outputClipped = inText.clipped;
      if (typeof m.resultOk === 'boolean') step.ok = m.resultOk;
      if (m.toolCallId) step.toolCallId = String(m.toolCallId).slice(0, 120);
      const at = step.toolCallId ? calls.find((c) => c.id === step.toolCallId) : calls.find((c) => c.name === step.label && c.index < step.index);
      if (at) step.pairedWith = at.index;
      else { step.unpairedResult = true; unpairedResults++; }
    }
    steps.push(step);
  }

  // ---- trace-only runs: real trace steps become real steps ----
  // TraceStep.t is a RELATIVE clock (ms since run start), so no absolute
  // timestamp is invented here — `at` stays undefined for these rows.
  if (!steps.length && (input.traceSteps ?? []).length) {
    let pendingCall: TrajectoryStep | undefined;
    for (const t of input.traceSteps ?? []) {
      if (!t || (t.kind !== 'tool_call' && t.kind !== 'tool_result')) continue;
      const step: TrajectoryStep = {
        index: steps.length + 1,
        at: undefined,
        kind: t.kind,
        label: String(t.name ?? 'tool').slice(0, 120),
        sources: ['trace'],
      };
      if (t.kind === 'tool_call') {
        if (typeof t.argsPreview === 'string') {
          const prev = clip(t.argsPreview, capChars);
          step.input = prev.text;
          step.inputClipped = prev.clipped;
        }
        pendingCall = step;
      } else {
        if (typeof t.ok === 'boolean') step.ok = t.ok;
        if (typeof t.chars === 'number' && Number.isFinite(t.chars)) step.traceChars = t.chars;
        if (pendingCall) step.pairedWith = pendingCall.index;
      }
      steps.push(step);
    }
  }

  // ---- journal enrichment: real durations + real milestones ----
  let journalToolCursor = 0;
  let journalDurationMs = 0;
  const milestones: TrajectoryStep[] = [];
  for (const ev of input.journalEvents ?? []) {
    if (!ev || typeof ev !== 'object') continue;
    const type = String(ev.type ?? '');
    if (type === 'tool') {
      const call = steps.filter((s) => s.kind === 'tool_call')[journalToolCursor++];
      if (call && typeof ev.ms === 'number' && Number.isFinite(ev.ms) && ev.ms >= 0) {
        call.durationMs = ev.ms;
        if (!call.sources.includes('journal')) call.sources.push('journal');
        journalDurationMs += ev.ms;
      }
      if (typeof ev.ok === 'boolean') {
        const result = steps.find((s) => s.index === call?.index + 1 && s.kind === 'tool_result')
          ?? steps.find((s) => s.kind === 'tool_result' && s.label === call?.label && s.pairedWith === call?.index);
        if (result && result.ok === undefined) {
          result.ok = ev.ok;
          if (!result.sources.includes('journal')) result.sources.push('journal');
        }
      }
      continue;
    }
    // Only real event types the engine actually appends are surfaced.
    if (type !== 'task_report' && type !== 'finish' && type !== 'continue' &&
        type !== 'memory_snapshot' && type !== 'preview_open') continue;
    const realBits: string[] = [];
    if (typeof ev.outcome === 'string') realBits.push(`outcome=${ev.outcome}`);
    if (typeof ev.stopReason === 'string') realBits.push(`stop=${String(ev.stopReason).slice(0, 80)}`);
    if (typeof ev.round === 'number') realBits.push(`round=${ev.round}`);
    if (typeof ev.hint === 'string') realBits.push(`hint=${ev.hint}`);
    if (typeof ev.summary === 'string') realBits.push(clip(ev.summary, capChars).text);
    if (typeof ev.howToRun === 'string') realBits.push(`howToRun=${clip(ev.howToRun, 200).text}`);
    for (const field of ['decisions', 'filesTouched', 'preferences', 'pendingSteps'] as const) {
      const arr = ev[field];
      if (Array.isArray(arr) && arr.length) {
        const bits = arr.filter((x): x is string => typeof x === 'string').slice(0, 8).map((x) => clip(x, 160).text);
        if (bits.length) realBits.push(`${field}=${bits.join(' | ')}`);
      }
    }
    if (!realBits.length) continue;
    milestones.push({
      index: 0,
      at: typeof ev.at === 'number' && Number.isFinite(ev.at) ? ev.at : undefined,
      kind: 'milestone',
      label: type,
      output: clip(realBits.join(' · '), capChars).text,
      sources: ['journal'],
    });
  }
  steps.push(...milestones);

  // ---- trace enrichment: real output sizes, only when session has no I/O ----
  let traceCallCursor = 0;
  const traceCalls = (input.traceSteps ?? []).filter((s) => s && s.kind === 'tool_call');
  const traceResults = (input.traceSteps ?? []).filter((s) => s && s.kind === 'tool_result');
  for (const step of steps) {
    if (step.kind !== 'tool_call' && step.kind !== 'tool_result') continue;
    const list = step.kind === 'tool_call' ? traceCalls : traceResults;
    const t = list[step.kind === 'tool_call' ? traceCallCursor++ : Math.max(0, traceCallCursor - 1)];
    if (!t) continue;
    if (step.kind === 'tool_call' && !step.input && typeof t.argsPreview === 'string' && t.argsPreview) {
      const prev = clip(t.argsPreview, capChars);
      step.input = prev.text;
      step.inputClipped = prev.clipped;
      if (!step.sources.includes('trace')) step.sources.push('trace');
    }
    if (step.kind === 'tool_result') {
      if (typeof t.chars === 'number' && Number.isFinite(t.chars)) step.traceChars = t.chars;
      if (step.ok === undefined && typeof t.ok === 'boolean') {
        step.ok = t.ok;
        if (!step.sources.includes('trace')) step.sources.push('trace');
      }
    }
  }

  const stamps = steps.map((s) => s.at).filter((n): n is number => typeof n === 'number');
  const elapsedMs = stamps.length >= 2 ? Math.max(0, Math.max(...stamps) - Math.min(...stamps)) : undefined;
  const stepsTotal = steps.length;
  const shown = steps.slice(0, capSteps).map((s, i) => ({ ...s, index: i + 1 }));

  return {
    sessionId: String(input.sessionId ?? '').slice(0, 120),
    title: String(input.title ?? '').slice(0, 200),
    steps: shown,
    ...(shown.length ? {} : { emptyReason: 'NO_LEDGER_DATA' as const }),
    truncated: stepsTotal > shown.length,
    stats: {
      stepsTotal,
      stepsShown: shown.length,
      turns: shown.filter((s) => s.kind === 'user' || s.kind === 'assistant').length,
      toolCalls: shown.filter((s) => s.kind === 'tool_call').length,
      failedTools: shown.filter((s) => s.kind === 'tool_result' && s.ok === false).length,
      unpairedResults: unpairedResults,
      journalDurationMs,
      elapsedMs,
    },
  };
}

// ============================================================
// 2 · DNA AUTOPSY — what was learned, and from which real trace
// ============================================================

// MIRRORED from dna.ts:53-68 (DNA_LIMITS) and dna.ts:623-646 (selection).
// Deliberately literal: importing dna.ts here would pull Electron into the
// renderer bundle. tests/v1138-signature.test.mjs guards against drift by
// reading those lines from the real dna.ts.
export const AUTOPSY_PROMPT_RULE = {
  maxPatterns: 60,
  promptPatterns: 8,
  promptNewPatterns: 4,
  recencyHalfLifeDays: 21,
} as const;

export type EvidenceSource = 'feedback' | 'playbook' | 'journal-memory' | 'profile';
export type WhyCode =
  | 'STORED_REPETITION'
  | 'STORED_CONFIDENCE'
  | 'EXPLICIT_FEEDBACK'
  | 'PLAYBOOK_CHANGE'
  | 'JOURNAL_MEMORY'
  | 'PROFILE_FIELD'
  | 'PROMPT_VISIBLE'
  | 'NOT_PROMPT_VISIBLE'
  | 'LEGACY_CONFIDENCE';

export interface AutopsyEvidence {
  source: EvidenceSource;
  /** REAL text: a feedback note, playbook change, memory fact or profile value. */
  detail: string;
  at?: number;
  context?: string;
}

export interface AutopsyFinding {
  /** The real pattern id (or `profile:<field>` for a declared profile value). */
  id: string;
  kind: string;
  text: string;
  /** The STORED confidence — never recomputed as if it were a fact. */
  confidence: number | null;
  confidenceBasis: string;
  sightings: number;
  firstSeen?: number;
  lastSeen?: number;
  /** True when the real renderDNAPrompt rule would include this pattern. */
  promptVisible: boolean;
  evidence: AutopsyEvidence[];
  why: WhyCode[];
}

export interface Autopsy {
  generatedAt: number;
  findings: AutopsyFinding[];
  emptyReason?: 'NO_DNA_LEARNED';
  summary: {
    factsRecorded: number;
    sessionsObserved: number;
    activePatterns: number;
    promptSlots: number;
    promptVisible: number;
    withEvidence: number;
    withoutEvidence: number;
  };
  /** Machine code; each surface localizes it. DNA is advisory, not a rule. */
  caveat: 'ADVISORY_DERIVED_FROM_STORED_FIELDS';
}

export interface AutopsyInput {
  dna: DNADataLike;
  playbookChanges?: readonly { section?: string; action?: string; text?: string }[];
  memoryFacts?: readonly string[];
  now?: number;
}

/** Local structural view of shared/types.DNAData (kept import-light). */
export interface DNADataLike {
  profile?: {
    name?: string;
    role?: string;
    expertise?: string[];
    languages?: string[];
    likes?: string[];
    dislikes?: string[];
    styleNotes?: string[];
  };
  patterns?: ReadonlyArray<{
    id?: string; kind?: string; text?: string; count?: number;
    firstSeen?: number; lastSeen?: number; confidence?: number;
  }>;
  feedback?: ReadonlyArray<{ ts?: number; kind?: string; note?: string; context?: string }>;
  stats?: { sessionsObserved?: number; factsRecorded?: number; updatedAt?: number };
}

/** Exactly the selection rule in dna.ts:623-646, applied to the REAL patterns. */
export function promptVisibleIds(dna: DNADataLike, now = Date.now()): Set<string> {
  const patterns = (dna.patterns ?? []).map((p, i) => ({ p, i })).filter((x) => !!x.p.text);
  const valid = (x: { p: { firstSeen?: number; lastSeen?: number }; i: number }): number =>
    (Number(x.p.firstSeen) || 0) || (Number(x.p.lastSeen) || 0) || x.i;
  const byNewest = [...patterns].sort((a, b) =>
    valid(b) - valid(a) ||
    (Number(b.p.lastSeen) || 0) - (Number(a.p.lastSeen) || 0) ||
    b.i - a.i,
  );
  const score = (x: { p: { confidence?: number; lastSeen?: number } }): number => {
    const conf = Number(x.p.confidence) || 0;
    const age = Math.max(0, now - (Number(x.p.lastSeen) || 0));
    return conf * Math.exp(-age / (AUTOPSY_PROMPT_RULE.recencyHalfLifeDays * DAY_MS));
  };
  const byScore = [...patterns].sort((a, b) =>
    score(b) - score(a) ||
    (Number(b.p.lastSeen) || 0) - (Number(a.p.lastSeen) || 0) ||
    b.i - a.i,
  );
  const out = new Set<string>();
  for (const x of byNewest.slice(0, AUTOPSY_PROMPT_RULE.promptNewPatterns)) {
    if (x.p.id) out.add(x.p.id);
  }
  for (const x of byScore) {
    if (out.size >= AUTOPSY_PROMPT_RULE.promptPatterns) break;
    if (x.p.id) out.add(x.p.id);
  }
  return out;
}

/** Token overlap strong enough to count as a real provenance link. */
function linked(query: unknown, candidate: unknown): boolean {
  const q = tokens(query);
  const c = tokens(candidate);
  if (!q.length || !c.length) return false;
  if (overlap(q, c) >= 2) return true;
  return q.some((t) => t.length >= 6 && c.includes(t));
}

/**
 * Explain each STORED DNA fact from the real traces that produced it.
 * Confidence is displayed as stored (dna.ts:478 rule shown as `basis`), and
 * an inconsistent stored value is labelled LEGACY_CONFIDENCE — never "fixed".
 */
export function autopsyDNA(input: AutopsyInput): Autopsy {
  const dna = input.dna ?? {};
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
  const patterns = [...(dna.patterns ?? [])].filter((p) => !!p && typeof p.text === 'string' && !!p.text.trim());
  const feedback = [...(dna.feedback ?? [])].filter((f) => !!f && typeof f.note === 'string' && !!f.note.trim());
  const playbook = (input.playbookChanges ?? []).filter((c) => !!c && typeof c.text === 'string' && !!c.text.trim());
  const memory = (input.memoryFacts ?? []).filter((x): x is string => typeof x === 'string' && !!x.trim());
  const visible = promptVisibleIds(dna, now);

  const findings: AutopsyFinding[] = [];
  for (const p of patterns) {
    const text = String(p.text);
    const count = Math.max(1, Math.floor(Number(p.count) || 1));
    const evidence: AutopsyEvidence[] = [];
    const why: WhyCode[] = ['STORED_REPETITION', 'STORED_CONFIDENCE'];

    for (const f of feedback) {
      if (evidence.length >= EVIDENCE_PER_FINDING) break;
      if (!linked(text, f.note) && !linked(text, f.context ?? '')) continue;
      evidence.push({
        source: 'feedback',
        detail: clip(f.note, 300).text,
        ...(typeof f.ts === 'number' ? { at: f.ts } : {}),
        ...(typeof f.context === 'string' && f.context ? { context: clip(f.context, 200).text } : {}),
      });
    }
    for (const c of playbook) {
      if (evidence.length >= EVIDENCE_PER_FINDING) break;
      if (!linked(text, String(c.text))) continue;
      evidence.push({
        source: 'playbook',
        detail: clip(c.text, 300).text,
        context: [c.section, c.action].filter(Boolean).join('/') || undefined,
      });
    }
    for (const fact of memory) {
      if (evidence.length >= EVIDENCE_PER_FINDING) break;
      if (!linked(text, fact)) continue;
      evidence.push({ source: 'journal-memory', detail: clip(fact, 300).text });
    }
    if (feedback.length || playbook.length || memory.length) {
      // Keep the codes honest: only claim a source that actually matched.
      if (evidence.some((e) => e.source === 'feedback')) why.push('EXPLICIT_FEEDBACK');
      if (evidence.some((e) => e.source === 'playbook')) why.push('PLAYBOOK_CHANGE');
      if (evidence.some((e) => e.source === 'journal-memory')) why.push('JOURNAL_MEMORY');
    }

    const stored = Number(p.confidence);
    const expected = Math.min(0.95, 0.4 + 0.15 * count);
    const consistent = Number.isFinite(stored) && Math.abs(stored - expected) < 0.02;
    if (!consistent) why.push('LEGACY_CONFIDENCE');
    const id = String(p.id ?? '');
    const visibleInPrompt = !!id && visible.has(id);
    why.push(visibleInPrompt ? 'PROMPT_VISIBLE' : 'NOT_PROMPT_VISIBLE');

    findings.push({
      id: id || `index:${findings.length}`,
      kind: String(p.kind ?? 'workflow'),
      text: clip(text, 300).text,
      confidence: Number.isFinite(stored) ? Math.max(0, Math.min(1, stored)) : null,
      confidenceBasis: consistent
        ? `min(0.95, 0.4 + 0.15 × ${count}) — dna.ts:478`
        : `stored value ${Number.isFinite(stored) ? stored : 'n/a'} kept as-is (rule expects ${expected.toFixed(2)}) — dna.ts:478`,
      sightings: count,
      ...(typeof p.firstSeen === 'number' ? { firstSeen: p.firstSeen } : {}),
      ...(typeof p.lastSeen === 'number' ? { lastSeen: p.lastSeen } : {}),
      promptVisible: visibleInPrompt,
      evidence,
      why,
    });
  }

  // Declared profile values are facts too — but they carry NO confidence.
  const profile = dna.profile ?? {};
  const fields = ['name', 'role', 'expertise', 'languages', 'likes', 'dislikes', 'styleNotes'] as const;
  for (const field of fields) {
    const value = profile[field];
    const items = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of items) {
      if (typeof item !== 'string' || !item.trim()) continue;
      findings.push({
        id: `profile:${field}:${item}`,
        kind: 'profile',
        text: clip(item, 200).text,
        confidence: null,
        confidenceBasis: 'declared in profile — no confidence score is stored (dna.ts:191)',
        sightings: 0,
        // dna.ts:692-698 renders every one of these profile fields into the
        // next system prompt — a declared value is always prompt-visible.
        promptVisible: true,
        evidence: [{ source: 'profile', detail: clip(item, 300).text, context: field }],
        why: ['PROFILE_FIELD'],
      });
    }
  }

  const withEvidence = findings.filter((f) => f.evidence.length > 0).length;
  return {
    generatedAt: now,
    findings,
    ...(findings.length ? {} : { emptyReason: 'NO_DNA_LEARNED' as const }),
    summary: {
      factsRecorded: Math.max(0, Math.floor(Number(dna.stats?.factsRecorded) || 0)),
      sessionsObserved: Math.max(0, Math.floor(Number(dna.stats?.sessionsObserved) || 0)),
      activePatterns: patterns.length,
      promptSlots: AUTOPSY_PROMPT_RULE.promptPatterns,
      promptVisible: findings.filter((f) => f.promptVisible).length,
      withEvidence,
      withoutEvidence: findings.length - withEvidence,
    },
    caveat: 'ADVISORY_DERIVED_FROM_STORED_FIELDS',
  };
}

// ============================================================
// 3 · CAPABILITY COMPASS — intent → real tool, + real coverage gaps
// ============================================================

/** Mine the REAL "Do NOT use X — use Y" sentences already in CORE_DEFS. */
export interface RouteEdge {
  from: string;
  to: string;
  /** The EXACT sentence from the real tool description. */
  sentence: string;
}

export function toolRoutingGraph(defs: readonly ToolDefLike[] = CORE_DEFS): RouteEdge[] {
  const knownNames = new Map(defs.map((d) => [d.name, d]));
  const edges: RouteEdge[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    for (const sentence of sentences(def.description ?? '')) {
      if (!/\bdo\s*n[o']?t\s+use\b|\bnot\s+(?:for|to)\b|\binstead\b/i.test(sentence)) continue;
      for (const name of knownNames.keys()) {
        if (name === def.name) continue;
        if (!new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escapeRe(name)}(?:$|[^\\p{L}\\p{N}_-])`, 'iu').test(sentence)) continue;
        const key = `${def.name}|${name}|${sentence}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: def.name, to: name, sentence: clip(sentence, 260).text });
      }
    }
  }
  return edges;
}

export interface ToolDefLike {
  name: string;
  description: string;
  kind?: string;
  profile?: ToolCategory;
}

export interface CompassReason {
  type: 'name' | 'description' | 'usage-hint' | 'routed-here' | 'routed-away' | 'used-before' | 'kind';
  /** Real token / real sentence / real call count — no generated prose. */
  detail: string;
}

export interface ToolRecommendation {
  name: string;
  kind: string | undefined;
  profile: ToolCategory | undefined;
  score: number;
  reasons: CompassReason[];
  /** First real "Use when …" sentence from the tool's own description. */
  hint: string;
  callCount: number;
}

export interface CompassResult {
  intent: string;
  top: ToolRecommendation[];
  emptyReason?: 'EMPTY_INTENT';
  undiscovered: Array<{ name: string; profile: ToolCategory | undefined; hint: string }>;
  coverage: {
    inventory: number;
    called: number;
    unknownCalled: number;
    percent: number;
    /** The REAL names from the ledger that are NOT in this inventory. */
    unknownNames: string[];
  };
  caveat: 'RANKED_FROM_REAL_INVENTORY_AND_LEDGER';
}

export interface CompassInput {
  intent: string;
  defs?: readonly ToolDefLike[];
  /** REAL tool names from the trajectory / journal. */
  calledToolNames?: readonly string[];
  limit?: number;
}

const PROFILE_ORDER: ToolCategory[] = ['core', 'workflow', 'advanced', 'desktop', 'web', 'mcp'];

/**
 * Rank the REAL inventory for an intent. The routing graph is derived from
 * the descriptions themselves, so a "do not use list_dir to search files"
 * sentence becomes a real edge list_dir → search_files. Usage counts come
 * from the real ledger; unused tools are surfaced, never invented.
 */
export function compass(input: CompassInput): CompassResult {
  const defs = input.defs ?? CORE_DEFS;
  const limit = Math.max(1, Math.min(12, Math.floor(input.limit ?? 5) || 5));
  const q = tokens(input.intent);
  const counts = new Map<string, number>();
  for (const raw of input.calledToolNames ?? []) {
    if (typeof raw !== 'string' || !raw) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const defByName = new Map(defs.map((d) => [d.name, d]));
  const unknownNames = [...counts.keys()].filter((n) => !defByName.has(n)).sort();
  const graph = toolRoutingGraph(defs);
  const qSet = new Set(q);

  const ranked: ToolRecommendation[] = [];
  if (q.length) {
    for (const def of defs) {
      if (!def || typeof def.name !== 'string') continue;
      const desc = String(def.description ?? '');
      const nameTokens = tokens(def.name.replace(/_/g, ' '));
      const descTokens = tokens(desc);
      let score = 0;
      const reasons: CompassReason[] = [];

      for (const t of q) {
        if (nameTokens.includes(t)) {
          score += 6;
          if (reasons.length < 4) reasons.push({ type: 'name', detail: t });
        } else if (descTokens.includes(t)) {
          score += 1;
          if (reasons.length < 4) reasons.push({ type: 'description', detail: t });
        }
      }
      for (const sentence of sentences(desc)) {
        if (!/\buse when\b|\buse to\b|\buse for\b|\buse it\b/i.test(sentence)) continue;
        if (overlap(q, tokens(sentence)) < 2) continue;
        score += 3;
        if (reasons.length < 4) reasons.push({ type: 'usage-hint', detail: clip(sentence, 220).text });
        break;
      }
      if (q.some((t) => def.kind === t)) {
        score += 1.5;
        reasons.push({ type: 'kind', detail: String(def.kind) });
      }
      // Real routing edges: the inventory tells us where NOT to go.
      for (const edge of graph) {
        if (edge.from !== def.name) continue;
        const toTokens = tokens(edge.to.replace(/_/g, ' '));
        if (q.some((t) => toTokens.includes(t))) {
          score -= 4;
          reasons.push({ type: 'routed-away', detail: edge.sentence });
        }
      }
      for (const edge of graph) {
        if (edge.to !== def.name) continue;
        const fromTokens = tokens(edge.from.replace(/_/g, ' '));
        if (q.some((t) => fromTokens.includes(t))) {
          score += 4;
          reasons.push({ type: 'routed-here', detail: edge.sentence });
        }
      }
      const callCount = counts.get(def.name) ?? 0;
      if (callCount > 0) {
        score += Math.min(2, callCount * 0.25);
        reasons.push({ type: 'used-before', detail: String(callCount) });
      }
      if (score <= 0) continue;
      const hintSentence = sentences(desc).find((s) => /\buse when\b|\buse to\b|\buse for\b/i.test(s))
        ?? sentences(desc)[0] ?? '';
      ranked.push({
        name: def.name,
        kind: def.kind,
        profile: def.profile,
        score: Math.round(score * 100) / 100,
        reasons,
        hint: clip(hintSentence, 220).text,
        callCount,
      });
    }
    ranked.sort((a, b) => b.score - a.score || b.callCount - a.callCount || byName(a, b));
  }

  const called = defs.filter((d) => (counts.get(d.name) ?? 0) > 0).length;
  const undiscovered = defs
    .filter((d) => (counts.get(d.name) ?? 0) === 0)
    .map((d) => ({
      name: d.name,
      profile: d.profile,
      hint: clip(sentences(d.description ?? '').find((s) => /\buse when\b|\buse to\b|\buse for\b/i.test(s))
        ?? sentences(d.description ?? '')[0] ?? '', 180).text,
      _order: PROFILE_ORDER.indexOf(d.profile ?? 'core'),
    }))
    .sort((a, b) => a._order - b._order || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(({ name, profile, hint }) => ({ name, profile, hint }));

  return {
    intent: String(input.intent ?? '').slice(0, 300),
    top: ranked.slice(0, limit),
    ...(q.length ? {} : { emptyReason: 'EMPTY_INTENT' as const }),
    undiscovered,
    coverage: {
      inventory: defs.length,
      called,
      unknownCalled: unknownNames.length,
      percent: defs.length ? Math.round((called / defs.length) * 100) : 0,
      unknownNames,
    },
    caveat: 'RANKED_FROM_REAL_INVENTORY_AND_LEDGER',
  };
}

/** Honest manifest used by docs + tests; no version claim, no marketing copy. */
export const SIGNATURE_FEATURES = [
  { id: 'trajectory', api: 'buildTrajectory', source: 'sessions + journals + traces' },
  { id: 'autopsy', api: 'autopsyDNA', source: 'dna.json (+ optional playbook / journal memory)' },
  { id: 'compass', api: 'compass', source: 'CORE_DEFS (145 tools) + ledger call counts' },
] as const;
