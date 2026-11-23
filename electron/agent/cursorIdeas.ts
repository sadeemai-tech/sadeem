// ============================================================
// SADEEM v11.15 — CURSOR-INSPIRED IDEAS (pure, local-first helpers)
// ------------------------------------------------------------
// Reverse-engineered from Cursor's PUBLIC docs (see docs/CURSOR-RE.md).
// Three ideas are adapted here, as plain deterministic helpers:
//   1. @-mention context resolution ("@auth.ts", "@src/components/",
//      "@extractSymbols") against a caller-supplied file list + an
//      optional CodeIndex-compatible symbol index. Read-only by design:
//      no fs reads, no Electron, no model calls.
//   2. Multi-file change digest for the final answer: groups tool
//      outcomes by file, counts unified-diff hunks/+/- lines, strips
//      ANSI escapes, and renders one clean, capped Markdown digest.
//   3. Agent handoff card for subagents: a small structured format
//      (Cursor's orchestrator pattern says each handoff must carry
//      clear context) with format + parse + honest failure.
//
// Every exported function is defensive: bad input yields empty/null
// results, never an exception. No Date/random -> deterministic output.
// Node builtins only (`node:path`); safe to bundle into CLI and tests.
// ============================================================
import * as path from 'node:path';

// ------------------------------------------------------------
// Shared sanitizers
// ------------------------------------------------------------

const ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-z\\-_])|\u009b[0-?]*[ -/]*[@-~]/g;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Strip ANSI/control noise (and normalise newlines) from untrusted tool/model text. */
export function stripAnsi(input: unknown): string {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(ANSI_RE, '')
    .replace(CONTROL_RE, '');
}

function oneLine(input: unknown, cap: number): string {
  return stripAnsi(input).replace(/\s+/g, ' ').trim().slice(0, cap);
}

function capLines(lines: string[], max: number): { lines: string[]; truncated: boolean } {
  if (lines.length <= max) return { lines, truncated: false };
  return { lines: lines.slice(0, max), truncated: true };
}

// ============================================================
// 1. @-mention context resolver (Cursor: @ files / folders; older
//    Cursor also had @symbols via LSP — marked unverified in the RE doc)
// ============================================================

/** Structural mirror of codeintel.Symbol (kept local: no import, no coupling). */
export interface MentionSymbolShape {
  name?: string;
  kind?: string;
  line?: number;
  endLine?: number;
  signature?: string;
}

/**
 * Structural mirror of codeintel.SymbolHit. `symbol` is nested in the real
 * CodeIndex; the flat aliases let callers pass already-normalised hits too.
 */
export interface MentionHitShape {
  relPath?: string;
  path?: string;
  score?: number;
  symbol?: MentionSymbolShape;
  name?: string;
  kind?: string;
  line?: number;
  endLine?: number;
  signature?: string;
}

/** Minimal interface a CodeIndex instance already satisfies. */
export interface MentionIndex {
  findDefinitions(q: string, opts?: { kind?: string; limit?: number }): MentionHitShape[];
}

export interface MentionResolveOptions {
  /** Workspace root; all returned absolute paths are confined beneath it. */
  workspace: string;
  /** Absolute file paths already known to the agent (e.g. from CodeIndex/files tool). */
  files?: readonly string[];
  /** Optional CodeIndex-compatible symbol source for `@symbol` mentions. */
  index?: MentionIndex | null;
  /** Safety caps. Defaults: 32 mentions, 400 files, 5 candidates. */
  maxMentions?: number;
  maxFiles?: number;
  maxCandidates?: number;
}

export type MentionKind = 'file' | 'folder' | 'symbol' | 'ambiguous' | 'unresolved';

export interface ResolvedMention {
  /** Exact token as typed, e.g. "@auth.ts". */
  raw: string;
  /** Token without the leading '@'. */
  name: string;
  kind: MentionKind;
  absPath?: string;
  relPath?: string;
  line?: number;
  endLine?: number;
  signature?: string;
  /** Absolute paths / path:line strings, only when kind === 'ambiguous'. */
  candidates?: string[];
  /** Short reason, mostly for 'unresolved'/'ambiguous'. */
  reason?: string;
}

export interface MentionResolution {
  mentions: ResolvedMention[];
  resolved: number;
  unresolved: number;
  /** True when caps cut the input short (reported, never silently ignored). */
  truncated: boolean;
}

const MENTION_RE = /@([A-Za-z0-9_][A-Za-z0-9_./\\-]{0,120})/g;

function normKey(p: string): string {
  return stripAnsi(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
}

function toPosix(p: string): string {
  return stripAnsi(p).replace(/\\/g, '/');
}

/** True when `abs` is the workspace root or a descendant of it. */
function insideRoot(root: string, abs: string): boolean {
  try {
    const rel = path.relative(path.resolve(root), path.resolve(abs));
    if (rel === '') return true;
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false;
    return true;
  } catch {
    return false;
  }
}

function displayRel(root: string, abs: string): string {
  try {
    const rel = path.relative(path.resolve(root), path.resolve(abs)).replace(/\\/g, '/');
    return rel && rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel) ? rel : toPosix(abs);
  } catch {
    return toPosix(abs);
  }
}

function clampOpt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Turn @-mentions in a prompt into resolvable workspace context.
 * Never reads the filesystem: it only matches the supplied file list and
 * optional symbol index. Ambiguous names are reported, never guessed.
 */
export function resolveContextMentions(prompt: unknown, opts: MentionResolveOptions): MentionResolution {
  const empty: MentionResolution = { mentions: [], resolved: 0, unresolved: 0, truncated: false };
  if (!opts || typeof opts.workspace !== 'string' || !opts.workspace.trim()) return empty;

  const root = path.resolve(opts.workspace);
  const maxMentions = clampOpt(opts.maxMentions, 1, 128, 32);
  const maxFiles = clampOpt(opts.maxFiles, 1, 5000, 400);
  const maxCandidates = clampOpt(opts.maxCandidates, 1, 20, 5);
  const rawFiles = Array.isArray(opts.files) ? opts.files : [];
  const files: string[] = [];
  for (const f of rawFiles) {
    if (files.length >= maxFiles) break;
    const s = stripAnsi(f);
    if (!s.trim()) continue;
    const abs = path.isAbsolute(s) ? path.resolve(s) : path.resolve(root, s);
    if (!insideRoot(root, abs)) continue; // never let an index escape the workspace
    if (!files.includes(abs)) files.push(abs);
  }
  files.sort((a, b) => a.localeCompare(b)); // deterministic across platforms

  const byRel = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, key: string, abs: string): void => {
    const row = m.get(key);
    if (row) row.push(abs);
    else m.set(key, [abs]);
  };
  for (const abs of files) {
    add(byRel, normKey(displayRel(root, abs)), abs);
    add(byBase, normKey(path.basename(abs)), abs);
  }

  const tokens = String(prompt ?? '').match(MENTION_RE) ?? [];
  const truncated = tokens.length > maxMentions;
  const seen = new Set<string>();
  const mentions: ResolvedMention[] = [];

  for (const rawToken of tokens.slice(0, maxMentions)) {
    if (seen.has(rawToken)) continue;
    seen.add(rawToken);
    const name = rawToken.slice(1);
    const key = normKey(name);
    if (!key) continue;
    const base: ResolvedMention = { raw: rawToken, name, kind: 'unresolved', reason: 'no matching file, folder or symbol in the provided context' };

    // Folder mention: trailing '/' explicitly asks for a directory prefix.
    if (name.endsWith('/') || name.endsWith('\\')) {
      const prefix = key.replace(/\/$/, '') + '/';
      const hits = files.filter((f) => normKey(displayRel(root, f)).startsWith(prefix));
      if (hits.length) {
        const abs = path.resolve(root, prefix);
        mentions.push({
          ...base,
          kind: 'folder',
          absPath: insideRoot(root, abs) ? abs : root,
          relPath: prefix,
          reason: `${hits.length} file(s) under this folder`,
        });
      } else {
        mentions.push({ ...base, reason: 'no indexed file under this folder' });
      }
      continue;
    }

    const exactRel = byRel.get(key) ?? [];
    const exactBase = byBase.get(key) ?? [];
    const fileHits = exactRel.length ? exactRel : exactBase;
    if (fileHits.length === 1) {
      const abs = fileHits[0];
      mentions.push({ ...base, kind: 'file', absPath: abs, relPath: displayRel(root, abs) });
      continue;
    }
    if (fileHits.length > 1) {
      const candidates = [...new Set(fileHits)].slice(0, maxCandidates).map((f) => displayRel(root, f));
      mentions.push({ ...base, kind: 'ambiguous', candidates, reason: `${fileHits.length} files share this name` });
      continue;
    }

    // Not a file: try an exact symbol name from a CodeIndex-like source.
    let symbol: ResolvedMention | null = null;
    if (opts.index && typeof opts.index.findDefinitions === 'function') {
      try {
        const hits = opts.index.findDefinitions(name, { limit: 8 }) ?? [];
        const exact = hits
          .filter((h) => {
            const nm = stripAnsi(h?.symbol?.name ?? h?.name ?? '').trim().toLowerCase();
            return nm === key;
          })
          .sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0));
        const hit = exact[0] ?? hits[0];
        const hitRel = stripAnsi(hit?.relPath ?? hit?.path ?? '');
        if (hitRel) {
          const abs = path.isAbsolute(hitRel) ? path.resolve(hitRel) : path.resolve(root, hitRel);
          if (insideRoot(root, abs)) {
            const s = hit?.symbol ?? {};
            const ln = Math.floor(Number(s.line ?? hit?.line));
            const end = Math.floor(Number(s.endLine ?? hit?.endLine));
            symbol = {
              ...base,
              kind: 'symbol',
              absPath: abs,
              relPath: displayRel(root, abs),
              ...(Number.isFinite(ln) && ln > 0 ? { line: ln } : {}),
              ...(Number.isFinite(end) && end >= (ln > 0 ? ln : 0) ? { endLine: end } : {}),
              signature: oneLine(s.signature ?? hit?.signature ?? '', 160),
            };
          }
        }
      } catch {
        /* a hostile index must not break prompt assembly */
      }
    }
    mentions.push(symbol ?? base);
  }

  const resolved = mentions.filter((m) => m.kind === 'file' || m.kind === 'folder' || m.kind === 'symbol').length;
  return { mentions, resolved, unresolved: mentions.length - resolved, truncated };
}

/** Render a MentionResolution as a compact, copy/pasteable context block. */
export function renderMentionContext(res: MentionResolution, opts?: { maxChars?: number }): string {
  if (!res || !Array.isArray(res.mentions) || !res.mentions.length) return '';
  const maxChars = clampOpt(opts?.maxChars, 200, 20000, 6000);
  const lines: string[] = ['[Context mentions]'];
  for (const m of res.mentions) {
    if (m.kind === 'file') lines.push(`- file: ${m.relPath} → ${toPosix(m.absPath ?? '')}`);
    else if (m.kind === 'folder') lines.push(`- folder: ${m.relPath} → ${toPosix(m.absPath ?? '')} (${m.reason ?? ''})`);
    else if (m.kind === 'symbol') {
      const at = m.line ? `:${m.line}${m.endLine ? `-${m.endLine}` : ''}` : '';
      lines.push(`- symbol: ${m.name} → ${m.relPath ?? ''}${at}${m.signature ? ` — ${m.signature}` : ''}`);
    } else if (m.kind === 'ambiguous') lines.push(`! ambiguous: ${m.raw} — ${m.reason ?? ''}; candidates: ${(m.candidates ?? []).join(', ')}`);
    else lines.push(`! unresolved: ${m.raw} — ${m.reason ?? ''}`);
  }
  if (res.truncated) lines.push('! truncated: mention cap reached');
  const text = lines.join('\n');
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '\n… [truncated]';
}

// ============================================================
// 2. Multi-file change digest (Cursor: multi-file diffs / "what changed"
//    visibility in the final answer — adapted to tool outcomes we already
//    produce, with ANSI stripping and hard caps).
// ============================================================

export interface ChangeEvent {
  tool?: string;
  ok?: boolean;
  output?: unknown;
  file?: string;
  path?: string;
}

export interface FileChange {
  file: string;
  ops: string[];
  ok: boolean;
  additions: number;
  deletions: number;
  hunks: number;
  /** Small ANSI-free sample of +/- lines for the final answer. */
  sample: string[];
  reason?: string;
  truncated: boolean;
}

export interface ChangeDigest {
  files: FileChange[];
  errors: string[];
  totals: { files: number; additions: number; deletions: number; hunks: number; failed: number };
  /** Clean, ANSI-free Markdown digest for the final answer. */
  markdown: string;
  truncated: boolean;
  clean: boolean;
}

const DIFF_GIT_RE = /^diff\s+--git\s+\S+\s+(\S+)/;
const PLUS_FILE_RE = /^\+\+\+\s+(\S+)/;
const MINUS_FILE_RE = /^---\s+(\S+)/;
const PATH_KEY_RE = /\b(?:file|path)\s*[:=]\s*([^\s,;"']{2,200})/i;
const VERB_PATH_RE = /\b(?:wrote|written|edited|updated|created|patched|modified|applied)\s+(?:to\s+)?(?:file\s*)?[:=]?\s*([^\s,;"']{2,200})/i;

function cleanDiffPath(p: string): string {
  let s = stripAnsi(p).trim();
  if (s === '/dev/null') return '';
  s = s.replace(/^[ab]\//, ''); // git a/ b/ prefixes
  s = s.replace(/^"?\.\//, '').replace(/"$/, '');
  return s.slice(0, 240);
}

function showPath(p: string, workspace?: string): string {
  if (workspace) {
    const root = path.resolve(workspace);
    const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
    if (insideRoot(root, abs)) return displayRel(root, abs);
  }
  return toPosix(p).replace(/^[A-Za-z]:\//, '').replace(/^\//, '');
}

/**
 * Group tool outcomes / explicit file paths into a clean per-file digest.
 * Unified diff markers (`diff --git`, `+++`, `---`, `@@`, `+`, `-`) and
 * "file: path" style tool messages are understood. Nothing is invented:
 * events without a file are counted as errors, not fabricated paths.
 */
export function digestFileChanges(events: readonly ChangeEvent[], opts?: { workspace?: string; maxFiles?: number; maxSample?: number }): ChangeDigest {
  const emptyTotals = { files: 0, additions: 0, deletions: 0, hunks: 0, failed: 0 };
  const empty: ChangeDigest = { files: [], errors: [], totals: emptyTotals, markdown: '', truncated: false, clean: true };
  if (!Array.isArray(events) || !events.length) return empty;

  const maxFiles = clampOpt(opts?.maxFiles, 1, 200, 40);
  const maxSample = clampOpt(opts?.maxSample, 0, 40, 6);
  const byFile = new Map<string, FileChange>();
  const errors: string[] = [];
  let truncated = false;

  const ensure = (file: string): FileChange => {
    let rec = byFile.get(file);
    if (!rec) {
      rec = { file, ops: [], ok: true, additions: 0, deletions: 0, hunks: 0, sample: [], truncated: false };
      byFile.set(file, rec);
    }
    return rec;
  };

  for (const ev of events.slice(0, 200)) {
    if (events.length > 200) truncated = true;
    if (!ev || typeof ev !== 'object') continue;
    const op = oneLine(ev.tool ?? '', 40) || 'change';
    const ok = ev.ok !== false;
    let current = cleanDiffPath(String(ev.file ?? ev.path ?? ''));
    const rawOutput = typeof ev.output === 'string' ? ev.output : '';
    if (rawOutput.length > 20000) truncated = true;
    const output = stripAnsi(rawOutput).slice(0, 20000);
    const lines = output.split('\n');
    let sampleRoom = true;

    for (const line of lines) {
      const t = line.trimEnd();
      const gitM = DIFF_GIT_RE.exec(t);
      if (gitM) {
        const f = cleanDiffPath(gitM[1]);
        if (f) current = f;
        continue;
      }
      const plusM = PLUS_FILE_RE.exec(t);
      if (plusM) {
        const f = cleanDiffPath(plusM[1]);
        if (f) current = f;
        continue;
      }
      const minusM = MINUS_FILE_RE.exec(t);
      if (minusM) {
        const f = cleanDiffPath(minusM[1]);
        if (f && !current) current = f;
        continue;
      }
      if (/^@@/.test(t)) {
        if (current) ensure(showPath(current, opts?.workspace)).hunks++;
        continue;
      }
      if (/^\+/.test(t) && !/^\+\+\+/.test(t)) {
        if (current) {
          const rec = ensure(showPath(current, opts?.workspace));
          rec.additions++;
          if (sampleRoom && rec.sample.length < maxSample) rec.sample.push('+ ' + t.slice(1, 160).trimEnd());
          else if (maxSample > 0 && rec.sample.length >= maxSample) { sampleRoom = false; rec.truncated = true; }
        }
        continue;
      }
      if (/^-/.test(t) && !/^---/.test(t)) {
        if (current) {
          const rec = ensure(showPath(current, opts?.workspace));
          rec.deletions++;
          if (sampleRoom && rec.sample.length < maxSample) rec.sample.push('- ' + t.slice(1, 160).trimEnd());
          else if (maxSample > 0 && rec.sample.length >= maxSample) { sampleRoom = false; rec.truncated = true; }
        }
        continue;
      }
      // Tool prose: "file: src/x.ts", "Successfully edited file: ...", etc.
      const keyM = PATH_KEY_RE.exec(t) ?? VERB_PATH_RE.exec(t);
      if (keyM) {
        const f = cleanDiffPath(keyM[1].replace(/^(?:file|folder)\s+/, ''));
        if (f && !current) current = f;
      }
    }

    if (!ok) {
      const reason = oneLine(output.split('\n').find((l) => l.trim()) ?? '', 160) || 'tool reported failure';
      if (current) {
        const rec = ensure(showPath(current, opts?.workspace));
        if (!rec.ops.includes(op)) rec.ops.push(op);
        rec.ok = false;
        rec.reason = reason;
      } else {
        errors.push(`${op}: ${reason}`);
      }
      continue;
    }

    if (current) {
      const rec = ensure(showPath(current, opts?.workspace));
      if (!rec.ops.includes(op)) rec.ops.push(op);
    } else if (!output.trim() && oneLine(ev.tool, 40)) {
      errors.push(`${op}: no file path in result`);
    }
  }

  const all = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  const files = all.slice(0, maxFiles);
  if (all.length > files.length) truncated = true;
  const totals = {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    hunks: files.reduce((n, f) => n + f.hunks, 0),
    failed: files.filter((f) => !f.ok).length + errors.length,
  };

  const md: string[] = [`## Changes (${files.length} file${files.length === 1 ? '' : 's'}, +${totals.additions} -${totals.deletions})`];
  for (const f of files) {
    md.push(`- \`${f.file}\` — ${f.ops.join(', ') || 'change'}: +${f.additions} -${f.deletions} (${f.hunks} hunk${f.hunks === 1 ? '' : 's'})${f.ok ? '' : ' [FAILED]'}`);
    for (const s of f.sample) md.push(`  ${s}`);
    if (f.truncated) md.push('  … [sample truncated]');
    if (f.reason) md.push(`  ! ${f.reason}`);
  }
  for (const e of errors) md.push(`- ! ${e}`);
  if (truncated) md.push('- … [digest truncated by caps]');
  const markdown = md.join('\n');
  return { files, errors, totals, markdown, truncated, clean: errors.length === 0 && files.every((f) => f.ok) };
}

// ============================================================
// 3. Agent handoff card (Cursor's orchestrator/planner → implementer →
//    verifier pattern: "each handoff includes structured output").
// ============================================================

export interface HandoffInput {
  role: string;
  status: string;
  summary?: string;
  id?: string;
  label?: string;
  files?: readonly string[];
  verified?: readonly string[];
  unverified?: readonly string[];
  tests?: string;
  prompt?: string;
}

export interface HandoffCard {
  role: string;
  status: string;
  summary: string;
  id: string;
  label: string;
  files: string[];
  verified: string[];
  unverified: string[];
  tests: string;
  prompt: string;
}

const HANDOFF_BEGIN = '=== HANDOFF v1 ===';
const HANDOFF_END = '=== END HANDOFF ===';
const HANDOFF_KEYS: (keyof HandoffCard)[] = ['role', 'status', 'summary', 'id', 'label', 'files', 'verified', 'unverified', 'tests', 'prompt'];

function listField(v: readonly unknown[] | undefined, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = oneLine(item, 160);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** Produce a deterministic, parseable handoff card. Never throws. */
export function formatAgentHandoff(input: HandoffInput): string {
  if (!input || typeof input !== 'object') return '';
  const card: HandoffCard = {
    role: oneLine(input.role, 80) || 'unknown',
    status: oneLine(input.status, 40) || 'unknown',
    summary: oneLine(input.summary, 600),
    id: oneLine(input.id, 80),
    label: oneLine(input.label, 120),
    files: listField(input.files, 40),
    verified: listField(input.verified, 20),
    unverified: listField(input.unverified, 20),
    tests: oneLine(input.tests, 300),
    prompt: oneLine(input.prompt, 600),
  };
  const lines = [HANDOFF_BEGIN];
  for (const key of HANDOFF_KEYS) {
    const v = card[key];
    lines.push(`${key}: ${Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : v || '(none)'}`);
  }
  lines.push(HANDOFF_END);
  return lines.join('\n');
}

/**
 * Parse a card. Returns null on missing/invalid markers or a missing
 * role/status — an invalid handoff is reported, never silently accepted.
 */
export function parseAgentHandoff(text: unknown): HandoffCard | null {
  const raw = stripAnsi(text);
  const start = raw.indexOf(HANDOFF_BEGIN);
  if (start < 0) return null;
  const end = raw.indexOf(HANDOFF_END, start + HANDOFF_BEGIN.length);
  if (end < 0) return null;
  const fields = new Map<string, string>();
  for (const line of raw.slice(start + HANDOFF_BEGIN.length, end).split('\n')) {
    const m = /^\s*([a-z]+)\s*:\s*(.*)$/.exec(line);
    if (m && HANDOFF_KEYS.includes(m[1] as keyof HandoffCard)) fields.set(m[1], m[2].trim());
  }
  const role = oneLine(fields.get('role'), 80);
  const status = oneLine(fields.get('status'), 40);
  if (!role || !status || role === '(none)' || status === '(none)') return null;
  const list = (key: string): string[] => {
    const v = fields.get(key) ?? '';
    if (!v || v === '(none)') return [];
    return v.split(',').map((s) => oneLine(s, 160)).filter(Boolean);
  };
  const scalar = (key: string): string => {
    const v = oneLine(fields.get(key), 600);
    return v === '(none)' ? '' : v;
  };
  return {
    role,
    status,
    summary: scalar('summary'),
    id: scalar('id'),
    label: scalar('label'),
    files: list('files'),
    verified: list('verified'),
    unverified: list('unverified'),
    tests: scalar('tests'),
    prompt: scalar('prompt'),
  };
}

// ============================================================
// v11.19 — error → concrete recovery hint (deterministic, local)
// ------------------------------------------------------------
// Inspired by OpenCode's typed retry/compaction/output-limit outcomes and
// SADEEM's own friendlyError() mapping (docs/OPENCODE-RE.md §3). This helper
// does NOT retry, switch providers or ask anyone — it only names the next
// action, so the engine can surface it on the notice channel. Pure, fast,
// single-language (English base; the renderer translates).
//
// WIRING (documentation only — engine.ts is NOT edited here):
//  · engine.ts `friendlyError(err, model)` (line ~5714) and the final-failure
//    block `ioB.send({ type: 'error', message })` (line ~4725), plus tool
//    failure notices such as `notice('verify', ...)` (line ~2669):
//      const hint = errorRecoveryHint(err, toolName);
//      notice('recovery', `\n[recovery] ${hint.nextAction} ${hint.fallback}\n`);
//  · Advisory: retryable is a classification, never an automatic retry.
// ============================================================

export type RecoveryCategory =
  | 'rate-limit'
  | 'context-overflow'
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'content-filter'
  | 'timeout'
  | 'network'
  | 'bad-request'
  | 'unknown';

export interface RecoveryHint {
  category: RecoveryCategory;
  /** True when the SAME call is worth retrying after the suggested fix. */
  retryable: boolean;
  /** Sanitised tool name, or 'unknown'. */
  tool: string;
  /** Concrete next English action. */
  nextAction: string;
  /** Switch to Y / ask the user for Z. */
  fallback: string;
  /** Honest note (e.g. no error information was provided). */
  note: string;
}

interface RecoveryRule {
  re: RegExp;
  category: RecoveryCategory;
  retryable: boolean;
  nextAction: string;
  fallback: string;
}

// Most specific first. The first matching rule wins (deterministic order).
const RECOVERY_RULES: readonly RecoveryRule[] = [
  {
    re: /\b429\b|rate[- ]?limit|too many requests|quota exhausted|throttl/i,
    category: 'rate-limit', retryable: true,
    nextAction: 'Wait a few seconds and retry the same call; back off if it repeats.',
    fallback: 'Switch to another provider/model or ask the user to check the quota.',
  },
  {
    re: /context (?:length|window)|maximum context|token limit|prompt (?:is )?too long|\b413\b|exceeds? \D*tokens/i,
    category: 'context-overflow', retryable: true,
    nextAction: 'Compact the conversation (drop old tool output) and retry with a smaller context.',
    fallback: 'Summarise and retry, or ask the user to narrow the scope.',
  },
  {
    re: /\b401\b|\b403\b|unauthori[sz]ed|invalid api key|api[_ -]?key|authentication failed|token expired/i,
    category: 'auth', retryable: false,
    nextAction: 'Stop retrying — check Settings → AI providers for a valid key/credentials.',
    fallback: 'Ask the user for a valid API key or switch to a different provider.',
  },
  {
    re: /permission denied|eacces|eperm|approval required|read[- ]?only|\bdenied\b|access denied|forbidden by policy/i,
    category: 'permission', retryable: false,
    nextAction: 'Do not bypass the gate — request approval or switch to an allowed approach.',
    fallback: 'Ask the user to approve the action or pick a permitted tool.',
  },
  {
    re: /\b404\b|not found|enoent|model .*not found|does not exist|unknown model/i,
    category: 'not-found', retryable: false,
    nextAction: 'Verify the model name or file path, correct it, then retry once.',
    fallback: 'Ask the user for the correct path/model or list the available options.',
  },
  {
    re: /content[_ -]?filter|safety (?:filter|block)|blocked by (?:the )?(?:safety|policy)/i,
    category: 'content-filter', retryable: false,
    nextAction: 'Rephrase the request to avoid the blocked content, then try again.',
    fallback: 'Ask the user to rephrase it or switch to a different model.',
  },
  {
    re: /etimedout|timeout|timed out|deadline exceeded/i,
    category: 'timeout', retryable: true,
    nextAction: 'Retry once with a smaller scope or a longer timeout.',
    fallback: 'Split the work into smaller steps or switch to a faster model.',
  },
  {
    re: /fetch failed|\bnetwork\b|enotfound|econnrefused|econnreset|socket hang ?up|eai_again|connection reset|offline/i,
    category: 'network', retryable: true,
    nextAction: 'Retry once; check the connection/proxy first.',
    fallback: 'Try a different provider endpoint or ask the user to verify the network/VPN.',
  },
  {
    re: /\b400\b|invalid argument|invalid (?:request|payload)|validation (?:error|failed)|malformed|unsupported parameter/i,
    category: 'bad-request', retryable: false,
    nextAction: 'Fix the malformed argument/payload and retry once.',
    fallback: 'Ask the user for the correct input.',
  },
];

const STATUS_CATEGORY: Readonly<Record<number, RecoveryCategory>> = {
  400: 'bad-request',
  401: 'auth',
  403: 'auth',
  404: 'not-found',
  413: 'context-overflow',
  429: 'rate-limit',
  500: 'network',
  502: 'network',
  503: 'network',
  529: 'network',
};

const CATEGORY_META: Readonly<Record<RecoveryCategory, { retryable: boolean; nextAction: string; fallback: string }>> = {
  'rate-limit': { retryable: true, nextAction: RECOVERY_RULES[0].nextAction, fallback: RECOVERY_RULES[0].fallback },
  'context-overflow': { retryable: true, nextAction: RECOVERY_RULES[1].nextAction, fallback: RECOVERY_RULES[1].fallback },
  auth: { retryable: false, nextAction: RECOVERY_RULES[2].nextAction, fallback: RECOVERY_RULES[2].fallback },
  permission: { retryable: false, nextAction: RECOVERY_RULES[3].nextAction, fallback: RECOVERY_RULES[3].fallback },
  'not-found': { retryable: false, nextAction: RECOVERY_RULES[4].nextAction, fallback: RECOVERY_RULES[4].fallback },
  'content-filter': { retryable: false, nextAction: RECOVERY_RULES[5].nextAction, fallback: RECOVERY_RULES[5].fallback },
  timeout: { retryable: true, nextAction: RECOVERY_RULES[6].nextAction, fallback: RECOVERY_RULES[6].fallback },
  network: { retryable: true, nextAction: RECOVERY_RULES[7].nextAction, fallback: RECOVERY_RULES[7].fallback },
  'bad-request': { retryable: false, nextAction: RECOVERY_RULES[8].nextAction, fallback: RECOVERY_RULES[8].fallback },
  unknown: { retryable: false, nextAction: 'Inspect the raw error; retry once only if it looks transient, otherwise report it honestly.', fallback: 'Ask the user for more detail or try a different tool.' },
};

/** Add one tool-specific sentence where it makes the next action concrete. */
function withToolHint(tool: string, nextAction: string): string {
  const t = tool.toLowerCase();
  if (/(?:edit|write|patch)/.test(t)) return `${nextAction} Re-read the file and retry with an exact match.`;
  if (/(?:shell|terminal|execute)/.test(t)) return `${nextAction} Split the command and check each subcommand/permission.`;
  if (/lsp/.test(t)) return `${nextAction} Fall back to repo_map/find_refs and state LSP is unavailable.`;
  if (/(?:webfetch|websearch)/.test(t)) return `${nextAction} Verify the URL/network or try the other web tool.`;
  return nextAction;
}

/**
 * Turn a tool/provider error into a concrete next action. Pure and defensive:
 * bad input yields category 'unknown' with an honest note, never an exception.
 * ANSI/control noise in untrusted error text is stripped first.
 */
export function errorRecoveryHint(err: unknown, toolName?: unknown): RecoveryHint {
  const tool = oneLine(toolName, 40) || 'unknown';
  const msg = stripAnsi(err instanceof Error ? err.message : err);
  if (!msg.trim()) {
    return {
      category: 'unknown',
      retryable: false,
      tool,
      nextAction: 'Inspect the raw error; retry once only if it looks transient, otherwise report it honestly.',
      fallback: 'Ask the user for more detail or try a different tool.',
      note: 'No usable error information was provided.',
    };
  }

  // A numeric status on the error object is the most reliable signal.
  const status = (err as { status?: unknown } | null)?.status;
  const byStatus = typeof status === 'number' ? STATUS_CATEGORY[status] : undefined;
  const rule = byStatus ? undefined : RECOVERY_RULES.find((r) => r.re.test(msg));
  const category: RecoveryCategory = byStatus ?? rule?.category ?? 'unknown';
  const meta = CATEGORY_META[category];

  return {
    category,
    retryable: meta.retryable,
    tool,
    nextAction: withToolHint(tool, meta.nextAction),
    fallback: meta.fallback,
    note: byStatus ? `Classified from error status ${status}.` : 'Classified from the error text; advisory only, no action was taken.',
  };
}
