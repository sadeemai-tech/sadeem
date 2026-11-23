// ============================================================
// SADEEM v11.35 — TOKEN ECONOMY (pure, capability-neutral helpers)
// ------------------------------------------------------------
// Founder: "أريد أن يكون هيك في طريقة جوا إنه يوفر التوكن... مشكلة توفير
// التوكنز" — a built-in way to save tokens WITHOUT removing any capability
// ("ما في مانع، إحنا نعطيه كل القدرات").
//
// This module is deliberately DEPENDENCY-FREE and side-effect-free. It never
// imports engine.ts / tools.ts / providers.ts and never decides which tool may
// run. Every helper here preserves the COMPLETE information surface:
//
//   • dedupeToolResults() collapses an IDENTICAL tool-result blob that appears
//     more than once in a conversation. The FIRST copy stays verbatim; the
//     later copies become a short reference carrying that first copy's callId.
//     No message is removed, no callId changes, no distinct output is dropped
//     → the model can still read/use the full output, so this is capability-
//     neutral. It only avoids re-billing the SAME bytes again.
//   • estimateTokens() / savingsReport() measure the real byte/token effect of
//     a reduction (chars/4 heuristic, UTF-8 aware).
//   • stableStringify() / stableFingerprint() prove that the cacheable static
//     prefix and the per-profile tool definitions are byte-identical across
//     turns — the precondition for provider prompt-cache READS (10% price)
//     instead of full-price writes on every turn.
//
// The engine owner wires dedupeToolResults() into the messages[] passed to
// streamTurn(); this module only supplies the pure transformation.
// ============================================================

/** Structural shape of a normalized provider message (see providers.ProviderMsg). */
export interface DedupableToolMessage {
  role: string;
  /** Normalized (ProviderMsg) tool-result id. */
  callId?: string;
  /** OpenAI-compat wire id (same value, different field name). */
  tool_call_id?: string;
  /** Tool-result body (ProviderMsg + OpenAI wire both use `content`). */
  content?: string;
  text?: string;
  isError?: boolean;
}

export interface DedupeOptions {
  /** Only dedupe blobs at least this long (default 256) — tiny results are cheap. */
  minChars?: number;
  /** How many leading chars of the original to keep as an identity preview (default 48). */
  previewChars?: number;
  /** Hard cap on the length of the generated reference marker (default 320). */
  maxReferenceChars?: number;
  /** Include the short preview in the marker (default true). */
  includePreview?: boolean;
}

export interface SavingsReport {
  label: string;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  savedPct: number;
}

export interface DedupeResult<T extends DedupableToolMessage> {
  messages: T[];
  report: SavingsReport;
  /** Number of tool-result blobs that were collapsed to references. */
  collapsed: number;
}

/** True for the two tool-result wire shapes used in this codebase. */
function isToolResult(m: DedupableToolMessage): boolean {
  return m.role === 'tool_result' || m.role === 'tool';
}

/** Exact UTF-8 byte length, without pulling in Node's Buffer (stays portable). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i += 1; // counted the surrogate pair once
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Cheap, deterministic token estimate. ~4 UTF-8 bytes per token for code/EN. */
export function estimateTokens(s: string): number {
  return Math.ceil(utf8Bytes(s) / 4);
}

/** FNV-1a (32-bit) — a small, stable content hash for change detection. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic serialization (sorted object keys) for byte-stability proofs. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const atom = JSON.stringify(value);
    return atom === undefined ? 'null' : atom;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** Stable fingerprint of any wire object (system prefix, tool-def list, ...). */
export function stableFingerprint(value: unknown): string {
  return fnv1a(stableStringify(value));
}

/** Byte/token effect of replacing `before` with `after`. Never throws. */
export function savingsReport(before: string, after: string, label = ''): SavingsReport {
  const beforeBytes = utf8Bytes(before);
  const afterBytes = utf8Bytes(after);
  const beforeTokens = estimateTokens(before);
  const afterTokens = estimateTokens(after);
  const savedBytes = Math.max(0, beforeBytes - afterBytes);
  return {
    label,
    beforeBytes,
    afterBytes,
    savedBytes,
    beforeTokens,
    afterTokens,
    savedTokens: Math.max(0, beforeTokens - afterTokens),
    savedPct: beforeBytes > 0 ? Math.round((savedBytes / beforeBytes) * 1000) / 10 : 0,
  };
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build the compact marker that REPLACES a repeated identical tool result.
 * It keeps: the exact byte/token saving, the first copy's callId, and a short
 * escaped preview so the model can still recognise which output is meant.
 * The full output is never deleted — it remains verbatim in the first copy.
 */
function referenceMarker(firstCallId: string, original: string, o: Required<DedupeOptions>): string {
  const chars = original.length;
  const tokens = estimateTokens(original);
  let marker =
    `[token-economy: identical tool output omitted (${chars} chars, ~${tokens} tokens saved). ` +
    `Full UNCHANGED output is in the earlier tool result ${firstCallId}`;
  if (o.includePreview) {
    const preview = collapseWhitespace(original.slice(0, o.previewChars));
    const suffix = preview.length < chars ? '…' : '';
    marker += `; preview: ${JSON.stringify(preview + suffix)}`;
  }
  marker += '.]';
  return marker.length <= o.maxReferenceChars ? marker : marker.slice(0, o.maxReferenceChars - 1) + ']';
}

/**
 * Collapse REPEATED IDENTICAL tool-result bodies into short references.
 *
 * Capability-neutral by construction:
 *   • the message count, order, roles and callIds are untouched;
 *   • the FIRST occurrence of every distinct body stays byte-for-byte intact;
 *   • a later identical body is the ONLY thing shortened, and its marker points
 *     to the surviving full copy, so no information becomes unavailable;
 *   • user / assistant / system messages are never touched.
 *
 * The input array and its messages are never mutated (a new array is returned;
 * unchanged messages keep their original object identity).
 */
export function dedupeToolResults<T extends DedupableToolMessage>(
  msgs: readonly T[],
  opts: DedupeOptions = {},
): T[] {
  const o: Required<DedupeOptions> = {
    minChars: opts.minChars ?? 256,
    previewChars: opts.previewChars ?? 48,
    maxReferenceChars: opts.maxReferenceChars ?? 320,
    includePreview: opts.includePreview !== false,
  };
  // Hash → candidate first occurrences. A full string comparison on hash hit
  // keeps this collision-safe; only genuine byte-identical blobs are folded.
  const seen = new Map<string, { content: string; callId: string }[]>();
  const out: T[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const content = isToolResult(m) && typeof m.content === 'string' ? m.content : undefined;
    if (content === undefined || content.length < o.minChars) {
      out.push(m);
      continue;
    }
    const key = `${content.length}:${fnv1a(content)}`;
    const bucket = seen.get(key);
    const first = bucket?.find((c) => c.content === content);
    if (first) {
      out.push({ ...m, content: referenceMarker(first.callId, content, o) } as T);
      continue;
    }
    const callId = m.callId ?? m.tool_call_id ?? `msg#${i}`;
    if (bucket) bucket.push({ content, callId });
    else seen.set(key, [{ content, callId }]);
    out.push(m);
  }
  return out;
}

/** Convenience: dedupe + measure in one pure call (for engine/telemetry use). */
export function dedupeWithReport<T extends DedupableToolMessage>(
  msgs: readonly T[],
  opts: DedupeOptions = {},
): DedupeResult<T> {
  const before = JSON.stringify(msgs);
  const messages = dedupeToolResults(msgs, opts);
  const after = JSON.stringify(messages);
  return {
    messages,
    report: savingsReport(before, after, 'tool-result dedupe'),
    collapsed: messages.filter((m, i) => isToolResult(m) && m.content !== (msgs[i] as DedupableToolMessage)?.content).length,
  };
}
