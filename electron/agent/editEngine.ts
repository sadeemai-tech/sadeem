// ============================================================
// Surnia v7 — tolerant edit engine
// Fixes the #1 agent failure mode on cheaper models (GLM /
// DeepSeek): edit_file literal-only matching. This engine:
//   1. ENFORCES read-before-edit (harness-level, not prompt-level):
//      an edit to a file that was never read this run, or that
//      changed after the read (staleness), is rejected with a
//      structured hint.
//   2. Matches tolerantly: exact → whitespace-normalized line
//      window → line-fingerprint fuzzy (typo rescue), with
//      indentation reconstruction and CRLF preservation.
//   3. Probes syntax before saving: real parsers where available
//      (node --check, python ast, JSON.parse), bracket-balance
//      analysis otherwise; a balanced→unbalanced regression is
//      reported loudly and JSON/parse errors hard-fail the save.
// Every function is pure or session-local — no globals escape.
// ============================================================
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'child_process';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------
// Read-before-edit guard (per session)
// ------------------------------------------------------------

export interface FileReadRecord {
  hash: string;
  size: number;
  at: number;
}

export class FileEditGuard {
  private reads = new Map<string, FileReadRecord>();
  /** Files this guard is allowed to edit without a prior read (e.g. files the agent itself created this run). */
  private authored = new Set<string>();

  static hashOf(content: string): string {
    return createHash('sha1').update(content).digest('hex');
  }

  recordRead(absPath: string, fullContent: string): void {
    this.reads.set(path.resolve(absPath), {
      hash: FileEditGuard.hashOf(fullContent),
      size: fullContent.length,
      at: Date.now(),
    });
  }

  recordWrite(absPath: string, content: string): void {
    const p = path.resolve(absPath);
    this.reads.set(p, {
      hash: FileEditGuard.hashOf(content),
      size: content.length,
      at: Date.now(),
    });
    this.authored.add(p);
  }

  hasRead(absPath: string): boolean {
    return this.reads.has(path.resolve(absPath)) || this.authored.has(path.resolve(absPath));
  }

  /**
   * Throws a structured Error when the file must be (re-)read before editing.
   * The message is model-facing: it states the exact tool call to run next.
   */
  assertEditable(absPath: string, currentContent: string): void {
    const p = path.resolve(absPath);
    if (this.authored.has(p)) return; // agent created it this run — always current
    const rec = this.reads.get(p);
    if (!rec) {
      throw new Error(
        `READ_BEFORE_EDIT: refusing to edit ${p} — it was never read in this session. ` +
          `Call read_file on "${p}" first (harness-enforced), then retry the edit with text taken from that read.`,
      );
    }
    const now = FileEditGuard.hashOf(currentContent);
    if (now !== rec.hash) {
      throw new Error(
        `STALE_READ: ${p} changed on disk (or was edited by another process) since your last read. ` +
          `Call read_file on "${p}" again to refresh, then retry the edit against the CURRENT content.`,
      );
    }
  }

  forgetAll(): void {
    this.reads.clear();
    this.authored.clear();
  }
}

/** Session registry — one guard per agent run (main + subagents keyed per session id). */
const guards = new Map<string, FileEditGuard>();

export function getGuard(sessionId: string): FileEditGuard {
  let g = guards.get(sessionId);
  if (!g) {
    // LRU-ish: never keep more than 64 sessions around.
    if (guards.size >= 64) {
      const oldest = guards.keys().next().value;
      if (oldest) guards.delete(oldest);
    }
    g = new FileEditGuard();
    guards.set(sessionId, g);
  }
  return g;
}

export function clearGuard(sessionId: string): void {
  guards.get(sessionId)?.forgetAll();
  guards.delete(sessionId);
}

// ------------------------------------------------------------
// Tolerant replace
// ------------------------------------------------------------

export type ReplaceMethod = 'exact' | 'normalized' | 'fingerprint';

export interface ReplaceResult {
  ok: boolean;
  updated?: string;
  method?: ReplaceMethod;
  occurrences?: number;
  startLine?: number;
  endLine?: number;
  error?: string;
}

function normLine(l: string): string {
  return l.replace(/\s+/g, ' ').trim();
}

/** Visual width of leading whitespace (tab = 4). */
function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

function leadingWs(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

/**
 * Re-indent `block` so that its base indent becomes `targetBase`,
 * preserving the relative indentation between its lines.
 */
function reindent(block: string, targetBaseWidth: number, oldBaseWidth: number, useTabs: boolean): string {
  const lines = block.split('\n');
  // base = indent of the first non-empty line
  let base = -1;
  for (const l of lines) {
    if (normLine(l)) {
      base = indentWidth(leadingWs(l));
      break;
    }
  }
  if (base < 0) return block; // all empty
  const delta = targetBaseWidth - oldBaseWidth;
  const pad = useTabs
    ? '\t'.repeat(Math.max(0, Math.round(delta / 4)))
    : ' '.repeat(Math.max(0, delta));
  return lines
    .map((l) => {
      if (!normLine(l)) return l; // keep empty lines empty
      return delta >= 0 ? pad + l : l.slice(Math.min(-delta, leadingWs(l).length));
    })
    .join('\n');
}

function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n');
  if (i > 0 && text[i - 1] === '\r') return '\r\n';
  return '\n';
}

interface Window {
  start: number; // 0-based index into file lines
  end: number; // exclusive
  score: number;
}

/**
 * v7.1 window finder with two-pointer alignment: tolerates up to 2 extra
 * BLANK lines inside the region (models sprinkle them constantly) and
 * returns windows scored by matched-target-lines ratio.
 */
function findWindows(
  fileLines: string[],
  targetLines: string[],
  lineScore: (a: string, b: string) => number,
  acceptLine: number,
  maxWindows = 16,
): Window[] {
  const t = targetLines.length;
  const windows: Window[] = [];
  if (!t || t > fileLines.length) return windows;
  const tryWindow = (start: number, len: number): Window | null => {
    if (start + len > fileLines.length) return null;
    let matched = 0;
    let i = start; // file cursor
    for (let j = 0; j < t; j++) {
      // skip up to 2 blank file lines between targets
      let skipped = 0;
      while (i < start + len && !normLine(fileLines[i]) && normLine(targetLines[j])) {
        i++;
        skipped++;
        if (skipped > 2) return null;
      }
      if (i >= start + len) return null;
      if (lineScore(fileLines[i], targetLines[j]) >= acceptLine) {
        matched++;
        i++;
      } else {
        return null; // strict in-order alignment — a mismatched line kills the window
      }
    }
    // leftover window lines beyond the last target must ALL be blank
    for (; i < start + len; i++) {
      if (normLine(fileLines[i])) return null;
    }
    return { start, end: start + len, score: matched / t };
  };
  for (let s = 0; s + t <= fileLines.length; s++) {
    for (const extra of [0, 1, 2]) {
      const w = tryWindow(s, t + extra);
      if (w && w.score >= 0.99) windows.push(w);
    }
    if (windows.length >= maxWindows * 4) break; // bounded scan
  }
  windows.sort((a, b) => b.score - a.score || a.start - b.start);
  // dedupe by start (extra=0/1/2 variants of the same region)
  const byStart = new Map<number, Window>();
  for (const w of windows) {
    const cur = byStart.get(w.start);
    if (!cur || w.score > cur.score) byStart.set(w.start, w);
  }
  return [...byStart.values()].sort((a, b) => b.score - a.score || a.start - b.start).slice(0, maxWindows);
}

const FINGERPRINT_MAX_FILE_LINES = 6000;
const FINGERPRINT_MAX_TARGET_LINES = 160;

function charBagSim(a: string, b: string): number {
  // Cheap bag-of-characters similarity in [0,1]; rescues single-char typos.
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bag = new Map<string, number>();
  for (const ch of a) bag.set(ch, (bag.get(ch) ?? 0) + 1);
  let common = 0;
  for (const ch of b) {
    const n = bag.get(ch) ?? 0;
    if (n > 0) {
      bag.set(ch, n - 1);
      common++;
    }
  }
  return (2 * common) / (a.length + b.length);
}

/**
 * Replace old_string with new_string inside `original`, tolerating
 * whitespace / indentation / minor-typo drift. Unique-match enforced unless
 * replaceAll. Reconstructs indentation and EOL style of the file.
 */
export function tolerantReplace(
  original: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ReplaceResult {
  if (!oldString) return { ok: false, error: 'old_string is empty.' };

  // ---------- stage 1: exact ----------
  const exactCount = original.split(oldString).length - 1;
  if (exactCount > 0) {
    if (exactCount > 1 && !replaceAll) {
      return { ok: false, error: `old_string matches ${exactCount} places — add surrounding context or set replace_all=true.` };
    }
    const updated = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);
    const idx = original.indexOf(oldString);
    const startLine = original.slice(0, idx).split('\n').length;
    return {
      ok: true,
      updated,
      method: 'exact',
      occurrences: exactCount,
      startLine,
      endLine: startLine + oldString.split('\n').length - 1,
    };
  }

  const eol = detectEol(original);
  const fileLines = original.split('\n');
  const useTabs = (original.match(/^\t/gm)?.length ?? 0) > (original.match(/^ {4}/gm)?.length ?? 0);
  const oldRawLines = oldString.replace(/\r\n/g, '\n').split('\n');
  const newRawLines = newString.replace(/\r\n/g, '\n').split('\n');
  // Trim leading/trailing empty lines from the target — models add them constantly.
  while (oldRawLines.length && !normLine(oldRawLines[0])) oldRawLines.shift();
  while (oldRawLines.length && !normLine(oldRawLines[oldRawLines.length - 1])) oldRawLines.pop();
  // Drop interior blank lines too — they are matching noise, never intent.
  const oldLines = oldRawLines.filter((l) => normLine(l));
  if (!oldLines.length) return { ok: false, error: 'old_string is empty after normalization.' };

  // ---------- stage 2: whitespace-normalized line window ----------
  const normScore = (a: string, b: string): number => (normLine(a) === normLine(b) ? 1 : 0);
  let wins = findWindows(fileLines, oldLines, normScore, 1);

  // ---------- stage 3: fingerprint fuzzy (typo rescue) ----------
  let method: ReplaceMethod = 'normalized';
  if (!wins.length && fileLines.length <= FINGERPRINT_MAX_FILE_LINES && oldLines.length <= FINGERPRINT_MAX_TARGET_LINES) {
    method = 'fingerprint';
    wins = findWindows(fileLines, oldLines, (a, b) => charBagSim(normLine(a), normLine(b)), 0.72);
  }

  if (!wins.length) {
    return {
      ok: false,
      error:
        `old_string not found (even with whitespace/fuzzy tolerance). ` +
        `Re-read the file and copy old_string EXACTLY from the current content — do not paraphrase code.`,
    };
  }

  const best = wins[0];
  // Uniqueness: any other window within 0.05 of the best score is ambiguous.
  if (!replaceAll && wins.length > 1 && wins[1].score >= best.score - 0.05) {
    const locs = wins
      .slice(0, 4)
      .map((w) => `line ${w.start + 1}`)
      .join(', ');
    return {
      ok: false,
      error: `old_string is ambiguous (${locs} candidate matches at ${Math.round(best.score * 100)}% similarity) — include more unique surrounding lines.`,
    };
  }
  if (replaceAll && wins.length > 1) {
    // Replace every high-scoring window (bottom-up so indices stay valid).
    const apply = wins.filter((w) => w.score >= Math.max(0.6, best.score - 0.05));
    let out = fileLines;
    let last = apply.length;
    for (let i = apply.length - 1; i >= 0; i--) {
      const w = apply[i];
      const region = out.slice(w.start, w.end);
      const baseWs = leadingWs(region.find((l) => normLine(l)) ?? '');
      const oldBase = leadingWs(oldRawLines.find((l) => normLine(l)) ?? '');
      const replacement = reindent(newRawLines.join('\n'), indentWidth(baseWs), indentWidth(oldBase), useTabs).split('\n');
      out = [...out.slice(0, w.start), ...replacement, ...out.slice(w.end)];
      last = w.start;
    }
    return {
      ok: true,
      updated: out.join(eol === '\r\n' ? '\r\n' : '\n'),
      method,
      occurrences: apply.length,
      startLine: last + 1,
    };
  }

  // Single-window replacement with indentation reconstruction.
  const region = fileLines.slice(best.start, best.end);
  const baseWs = leadingWs(region.find((l) => normLine(l)) ?? '');
  const oldBase = leadingWs(oldRawLines.find((l) => normLine(l)) ?? '');
  const replacement = reindent(newRawLines.join('\n'), indentWidth(baseWs), indentWidth(oldBase), useTabs).split('\n');
  const out = [...fileLines.slice(0, best.start), ...replacement, ...fileLines.slice(best.end)];
  return {
    ok: true,
    updated: out.join(eol === '\r\n' ? '\r\n' : '\n'),
    method,
    occurrences: 1,
    startLine: best.start + 1,
    endLine: best.start + replacement.length,
  };
}

// ------------------------------------------------------------
// Syntax probing (before save)
// ------------------------------------------------------------

export interface SyntaxProbe {
  /** null = OK (or nothing to check); string = model-facing problem. */
  error: string | null;
  warn: string | null;
  checked: 'parser' | 'balance' | 'none';
}

/** Bracket balance ignoring strings, template literals and comments. */
function bracketBalance(text: string, brackets: Record<string, string>): { net: number; firstUnbalanced?: string } {
  // Returns net depth per pair family; positive = unclosed openers.
  const pairs: Record<string, string> = {};
  for (const [open, close] of Object.entries(brackets)) pairs[close] = open;
  const stack: string[] = [];
  let i = 0;
  const n = text.length;
  let inLine = false;
  let inBlock = false; // C-style
  let inHash = false; // python/shell
  let inStr: string | null = null;
  let inTpl = false;
  let tplDepth = 0;
  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';
    if (inLine) {
      if (ch === '\n') inLine = false;
    } else if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
    } else if (inHash) {
      if (ch === '\n') inHash = false;
    } else if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
    } else if (inTpl) {
      if (ch === '\\') i++;
      else if (ch === '`') inTpl = false;
      else if (ch === '$' && next === '{') tplDepth++;
      else if (ch === '}' && tplDepth > 0) tplDepth--;
    } else {
      if ((ch === '/' && next === '/') || ch === '#') inLine = true;
      else if (ch === '/' && next === '*') {
        inBlock = true;
        i++;
      } else if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === '`') inTpl = true;
      else if (brackets[ch]) stack.push(ch);
      else if (pairs[ch]) {
        const open = stack.pop();
        if (open !== pairs[ch]) return { net: stack.length + 1, firstUnbalanced: ch };
      }
    }
    i++;
  }
  return { net: stack.length };
}

const C_LIKE_BRACKETS = { '{': '}', '(': ')', '[': ']' };

/**
 * Best-effort syntax probe BEFORE saving. Real parsers win where they exist;
 * everything else gets a balance analysis. Never throws.
 */
export async function syntaxProbe(absPath: string, content: string): Promise<SyntaxProbe> {
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (ext === '.json') {
      try {
        JSON.parse(content);
        return { error: null, warn: null, checked: 'parser' };
      } catch (err) {
        return { error: `JSON parse failed after this edit: ${err instanceof Error ? err.message : String(err)}. The file was NOT saved.`, warn: null, checked: 'parser' };
      }
    }
    if (ext === '.py') {
      const py = await pickPython();
      if (py) {
        try {
          await runCapture(py, ['-c', 'import ast,sys; ast.parse(sys.stdin.buffer.read().decode("utf-8"))'], content, 10_000);
          return { error: null, warn: null, checked: 'parser' };
        } catch (err) {
          return {
            error: `Python syntax check failed after this edit (file NOT saved): ${(err instanceof Error ? err.message : String(err)).slice(0, 600)}. Fix the syntax in new_string and retry.`,
            warn: null,
            checked: 'parser',
          };
        }
      }
    }
    // v7.2 — TS/TSX now get a REAL parse (esbuild transform), not just bracket
    // balance. esbuild catches genuine syntax errors in TS/TSX/JSX without the
    // cost of a type-check (audit item: "TS/TSX فمجرد توازن أقواس").
    if (['.ts', '.tsx'].includes(ext)) {
      // v7.2 — TS/TSX get a REAL parse via esbuild, run OUT-OF-PROCESS through
      // node (same pattern as the Python ast probe): immune to bundling and
      // test-runner isolation quirks. esbuild is a devDependency — when absent
      // (packaged app) the probe degrades to bracket balance, never crashes.
      const nodeBin = process.execPath.endsWith('node') || process.platform !== 'win32' ? 'node' : process.execPath;
      const loader = ext === '.tsx' ? 'tsx' : 'ts';
      const script = `const es=require('esbuild');const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{es.transformSync(Buffer.concat(c).toString('utf8'),{loader:'${loader}'});process.exit(0)}catch(e){process.stderr.write(String(e.message||e));process.exit(1)}});`;
      try {
        await runCapture(nodeBin, ['-e', script], content, 12_000);
        return { error: null, warn: null, checked: 'parser' };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (/Cannot find module|ERR_MODULE_NOT_FOUND|require is not defined/i.test(detail)) {
          // esbuild not installed here (packaged app) — bracket balance fallback
          const bal = bracketBalance(content, { '{': '}', '[': ']', '(': ')' });
          if (bal.net !== 0) {
            return { error: null, warn: `TS parse unavailable here — bracket balance found ${bal.net > 0 ? bal.net + ' unclosed' : 'extra closing'} brace(s); verify the file compiles.`, checked: 'balance' };
          }
          return { error: null, warn: null, checked: 'balance' };
        }
        return {
          error: `TypeScript syntax check failed after this edit (file NOT saved): ${detail.slice(0, 600)}. Fix the syntax and retry.`,
          warn: null,
          checked: 'parser',
        };
      }
    }
    if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) {
      const node = process.execPath.endsWith('node') || process.platform !== 'win32' ? 'node' : process.execPath;
      const asModule = ext === '.mjs' || ext === '.jsx' || /\b(import|export)\b/.test(content.slice(0, 4000));
      const tmp = path.join(os.tmpdir(), `surnia-check-${Date.now()}-${Math.random().toString(36).slice(2)}${asModule ? '.mjs' : '.cjs'}`);
      try {
        await fs.writeFile(tmp, content, 'utf8');
        await runCapture(node, ['--check', tmp], '', 10_000);
        return { error: null, warn: null, checked: 'parser' };
      } catch (err) {
        return {
          error: `JavaScript syntax check failed after this edit (file NOT saved): ${(err instanceof Error ? err.message : String(err)).slice(0, 600)}. Fix the syntax and retry.`,
          warn: null,
          checked: 'parser',
        };
      } finally {
        void fs.unlink(tmp).catch(() => undefined);
      }
    }
    // Balance analysis for brace-based languages (warn-level).
    const balanceLangs = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.less', '.java', '.kt', '.swift', '.cs', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.php', '.dart', '.vue', '.svelte']);
    if (balanceLangs.has(ext)) {
      const { net } = bracketBalance(content, C_LIKE_BRACKETS);
      if (net > 0) {
        return { error: null, warn: `[syntax] ${net} unclosed bracket(s) after this edit — if intentional (block spans calls) ignore, otherwise fix now.`, checked: 'balance' };
      }
      if (net < 0) {
        return { error: null, warn: `[syntax] ${-net} extra closing bracket(s) after this edit — check your new_string.`, checked: 'balance' };
      }
      return { error: null, warn: null, checked: 'balance' };
    }
    return { error: null, warn: null, checked: 'none' };
  } catch {
    return { error: null, warn: null, checked: 'none' }; // probe must never block a save on its own failure
  }
}

// -------------------------------------------------------------
// v7 — malformed tool-call repair (model-robustness layer)
// Cheap models emit trailing commas, single quotes, smart quotes,
// unescaped newlines and TRUNCATED JSON. Repair before counting the
// step as failed — schema-shaped, conservative, never invents data.
// -------------------------------------------------------------
export function repairToolArgsJson(raw: string): { text: string; repaired: boolean } {
  if (!raw || !raw.trim()) return { text: raw, repaired: false };
  let s = raw.trim();
  let repaired = false;
  const attempt = (): boolean => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  };
  if (attempt()) return { text: s, repaired: false };

  // 1) smart quotes → straight quotes
  if (/[“”„‘’]/.test(s)) {
    s = s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'");
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }

  // 1b) markdown fences around the JSON (```json … ``` / ```surnia-tool … ```)
  // — weak models wrap tool args in fences constantly.
  const fenced = s.match(/```(?:json|surnia-tool|tool)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    s = fenced[1].trim();
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }

  // 1c) ASCII single-quoted keys/strings → double quotes (the weak-model
  // dialect: {'path':'x'}). Conservative: applied ONLY when the payload has
  // no double quotes at all and the single quotes are balanced, so real
  // apostrophes in escaped prose are never corrupted.
  if (!s.includes('"') && s.includes("'") && ((s.match(/'/g) ?? []).length % 2 === 0)) {
    s = s.replace(/'([^']*?)'/g, '"$1"');
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }

  // 2) trailing commas before } or ]
  const noTrailing = s.replace(/,\s*([}\]])/g, '$1');
  if (noTrailing !== s) {
    s = noTrailing;
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }

  // 3) truncate-to-last-complete + close open brackets (handles cut-off streams)
  const closeBroken = (): string => {
    // scan for the last complete top-level-ish value boundary
    let depth = 0;
    let inStr: string | null = null;
    let esc = false;
    let lastSafe = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === inStr) {
          inStr = null;
          lastSafe = i;
        }
        continue;
      }
      if (ch === '"') inStr = '"';
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        lastSafe = i;
      } else if (ch === ',' && depth >= 1) {
        lastSafe = i - 1;
      }
    }
    if (lastSafe < 0) return s;
    let head = s.slice(0, lastSafe + 1);
    // strip a dangling trailing comma fragment
    head = head.replace(/,\s*$/, '');
    // re-close strings and brackets
    if (inStr) head += '"';
    // recount unclosed brackets in head
    const stack: string[] = [];
    let inStr2: string | null = null;
    let esc2 = false;
    for (const ch of head) {
      if (inStr2) {
        if (esc2) esc2 = false;
        else if (ch === '\\') esc2 = true;
        else if (ch === inStr2) inStr2 = null;
        continue;
      }
      if (ch === '"') inStr2 = '"';
      else if (ch === '{') stack.push('{');
      else if (ch === '[') stack.push('[');
      else if (ch === '}') stack.pop();
      else if (ch === ']') stack.pop();
    }
    while (stack.length) head += stack.pop() === '[' ? ']' : '}';
    return head;
  };
  const closed = closeBroken();
  if (closed !== s) {
    s = closed;
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }
  return { text: s, repaired };
}

function runCapture(cmd: string, args: string[], stdin: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

let pythonCache: string | null | undefined;
async function pickPython(): Promise<string | null> {
  if (pythonCache !== undefined) return pythonCache;
  for (const cand of ['python3', 'python']) {
    try {
      await runCapture(cand, ['--version'], '', 5_000);
      pythonCache = cand;
      return cand;
    } catch {
      /* try next */
    }
  }
  pythonCache = null;
  return null;
}

// silence unused import warning for environments without fileURLToPath usage
void fileURLToPath;
