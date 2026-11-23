// ============================================================
// linediff — v10.2 line-level diff engine for the chat stream.
// Codex/Claude-Code-class before/after blocks: real line numbers,
// hunk grouping with context, capped rendering, and optional
// word-level highlighting inside replaced line pairs.
//
// Pure functions, zero dependencies, defensive by contract: any
// pathological input degrades to a single-hunk whole-text diff —
// it never throws and never returns NaN/garbage rows.
// ============================================================

export type DiffRowKind = 'ctx' | 'add' | 'del';

export interface DiffRow {
  kind: DiffRowKind;
  /** 1-based line number in the OLD text (null for pure adds). */
  oldNo: number | null;
  /** 1-based line number in the NEW text (null for pure dels). */
  newNo: number | null;
  text: string;
  /** Word-level segments for modified line pairs (undefined on plain rows). */
  segs?: WordSeg[];
}

export interface DiffHunk {
  header: string;
  rows: DiffRow[];
}

export interface LineDiffResult {
  hunks: DiffHunk[];
  add: number;
  del: number;
  /** Rendered rows were capped — a "show all" affordance should appear. */
  truncated: boolean;
}

// ---------- word-level segments (for modified line pairs) ----------

export interface WordSeg {
  k: 'ctx' | 'del' | 'add';
  s: string;
}

function splitWords(s: string): string[] {
  return s.split(/(\s+)/).filter((w) => w.length > 0);
}

/** Word-level diff of ONE changed line pair (LCS on word tokens). */
export function wordLineDiff(a: string, b: string): { del: WordSeg[]; add: WordSeg[] } {
  const A = splitWords(a);
  const B = splitWords(b);
  if (A.length * B.length > 20_000) return { del: [{ k: 'del', s: a }], add: [{ k: 'add', s: b }] };
  const dp: Uint32Array[] = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const push = (arr: WordSeg[], k: WordSeg['k'], s: string) => {
    const last = arr[arr.length - 1];
    if (last && last.k === k) last.s += s;
    else arr.push({ k, s });
  };
  const del: WordSeg[] = [];
  const add: WordSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      push(del, 'ctx', A[i]);
      push(add, 'ctx', A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(del, 'del', A[i]);
      i++;
    } else {
      push(add, 'add', B[j]);
      j++;
    }
  }
  while (i < A.length) {
    push(del, 'del', A[i]);
    i++;
  }
  while (j < B.length) {
    push(add, 'add', B[j]);
    j++;
  }
  return { del, add };
}

// ---------- core LCS row walk ----------

interface RawRow {
  kind: DiffRowKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

/**
 * LCS-based row diff. Guard: O(n·m) memory blows up past ~2M cells, so
 * huge pairs degrade to a single delete-all/insert-all hunk (still honest
 * numbers, still correct text — just no common-context detection).
 */
function rawRows(oldText: string, newText: string): RawRow[] {
  const A = oldText.split('\n');
  // trailing "\n" produces a phantom empty last line — drop it (length re-derived)
  if (A.length > 1 && A[A.length - 1] === '' && oldText.endsWith('\n')) A.pop();
  const B = newText.split('\n');
  if (B.length > 1 && B[B.length - 1] === '' && newText.endsWith('\n')) B.pop();
  const n = A.length;
  const m = B.length;

  const rows: RawRow[] = [];
  if (n * m > 4_000_000) {
    // degraded path — whole-file replace
    for (let i = 0; i < n; i++) rows.push({ kind: 'del', oldNo: i + 1, newNo: null, text: A[i] });
    for (let j = 0; j < m; j++) rows.push({ kind: 'add', oldNo: null, newNo: j + 1, text: B[j] });
    return rows;
  }

  // LCS length table (rows of Uint32Array; index [i][j] = LCS of A[i:], B[j:])
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ kind: 'ctx', oldNo: i + 1, newNo: j + 1, text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', oldNo: i + 1, newNo: null, text: A[i] });
      i++;
    } else {
      rows.push({ kind: 'add', oldNo: null, newNo: j + 1, text: B[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', oldNo: i + 1, newNo: null, text: A[i] });
    i++;
  }
  while (j < m) {
    rows.push({ kind: 'add', oldNo: null, newNo: j + 1, text: B[j] });
    j++;
  }
  return rows;
}

// ---------- hunk assembly ----------

export interface LineDiffOptions {
  /** Context lines kept around each change block (default 3, Codex-style). */
  context?: number;
  /** Max rendered rows before truncation (default 400). */
  maxRows?: number;
  /** Word-highlight replaced line pairs (1 del + 1 add adjacent). Default true. */
  wordHighlight?: boolean;
}

/**
 * Full line diff → grouped hunks + totals. The result is presentation-ready:
 * hunks carry `@@ -a,n +b,m @@` headers, rows carry 1-based numbers, replaced
 * 1:1 pairs carry word-level segments, and everything past maxRows collapses
 * into `truncated: true` (the UI decides whether to render a "show all").
 */
export function lineDiff(oldText: string, newText: string, opts: LineDiffOptions = {}): LineDiffResult {
  const context = Math.max(0, Math.min(opts.context ?? 3, 12));
  const maxRows = Math.max(20, opts.maxRows ?? 400);
  const wordHighlight = opts.wordHighlight !== false;

  const out: LineDiffResult = { hunks: [], add: 0, del: 0, truncated: false };
  if (oldText === newText) return out;

  const rows = rawRows(oldText, newText);
  for (const r of rows) {
    if (r.kind === 'add') out.add++;
    else if (r.kind === 'del') out.del++;
  }

  // indexes of changed rows
  const changed: number[] = [];
  for (let k = 0; k < rows.length; k++) if (rows[k].kind !== 'ctx') changed.push(k);
  if (changed.length === 0) return out;

  // build change blocks (runs of changed rows closer than 2*context merge)
  const blocks: [number, number][] = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(rows.length - 1, changed[0] + context);
  for (let c = 1; c < changed.length; c++) {
    const k = changed[c];
    if (k - context <= end + 1) {
      end = Math.min(rows.length - 1, k + context);
    } else {
      blocks.push([start, end]);
      start = Math.max(0, k - context);
      end = Math.min(rows.length - 1, k + context);
    }
  }
  blocks.push([start, end]);

  let rendered = 0;
  for (const [s, e] of blocks) {
    if (rendered >= maxRows) {
      out.truncated = true;
      break;
    }
    const slice = rows.slice(s, e + 1);
    const oLines = slice.filter((r) => r.oldNo !== null).length;
    const nLines = slice.filter((r) => r.newNo !== null).length;
    const oStart = slice.find((r) => r.oldNo !== null)?.oldNo ?? 0;
    const nStart = slice.find((r) => r.newNo !== null)?.newNo ?? 0;
    const hunk: DiffHunk = {
      header: `@@ -${oStart},${oLines} +${nStart},${nLines} @@`,
      rows: slice.map((r) => ({ ...r })),
    };
    // word-highlight on 1:1 replaced pairs
    if (wordHighlight) {
      let k = 0;
      while (k < hunk.rows.length - 1) {
        const a = hunk.rows[k];
        const b = hunk.rows[k + 1];
        if (a.kind === 'del' && b.kind === 'add' && a.text.trim() !== '' && b.text.trim() !== '') {
          const wd = wordLineDiff(a.text, b.text);
          a.segs = wd.del;
          b.segs = wd.add;
          k += 2;
        } else {
          k++;
        }
      }
    }
    rendered += slice.length;
    out.hunks.push(hunk);
  }
  if (blocks.length > out.hunks.length) out.truncated = true;
  return out;
}

// ---------- tool-args → before/after normalization (v10.2) ----------

/**
 * Normalize tool args into a before/after pair for the diff card.
 * Fixes the v10.1 dead path that read `parsed.oldText` keys the tools never
 * send. edit_file → old_string/new_string; write_file → new-file view;
 * multi_edit → sequential fold (best effort). Pure — no React imports.
 */
export function diffInputsFromToolArgs(
  toolName: string,
  parsed: Record<string, unknown>,
): { oldText: string; newText: string } | null {
  try {
    if (toolName === 'edit_file') {
      const o = parsed.old_string;
      const n = parsed.new_string;
      if (typeof o === 'string' && typeof n === 'string' && o !== n) return { oldText: o, newText: n };
      return null;
    }
    if (toolName === 'write_file') {
      const n = parsed.content;
      if (typeof n === 'string' && n.trim()) return { oldText: '', newText: n };
      return null;
    }
    if (toolName === 'multi_edit') {
      const edits = parsed.edits;
      if (!Array.isArray(edits) || edits.length === 0) return null;
      let text = ''; // fold: each replacement applied to the running doc
      for (const e of edits) {
        if (!e || typeof e !== 'object') continue;
        const o = (e as Record<string, unknown>).old_string;
        const w = (e as Record<string, unknown>).new_string;
        if (typeof o !== 'string' || typeof w !== 'string') continue;
        text = text.includes(o) ? text.replace(o, w) : `${text}${w}`;
      }
      if (!text.trim()) return null;
      return { oldText: '', newText: text };
    }
    return null;
  } catch {
    return null;
  }
}
