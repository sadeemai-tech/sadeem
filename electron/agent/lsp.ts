// ============================================================
// SADEEM v12 — REAL LSP client (zero new npm dependencies)
//
// Language servers speak LSP = JSON-RPC 2.0 frames over stdio with
// `Content-Length: N\r\n\r\n{json}` framing — the SAME framing the bundled
// DAP client (dap.ts) already parses. This module is a minimal, defensive
// client inspired by that proven code + mcp.ts's JSON-RPC pump:
//   • spawn a language server per (workspace, language), reuse via a Map
//   • initialize → initialized → textDocument/didOpen
//   • definition / hover / references / rename / completion / diagnostics
//   • NEVER throws to callers: a missing server is an HONEST refusal.
//
// SECURITY: servers are spawned with arg arrays, shell:false (no interpolation
// of model-supplied text into a shell). On Windows the .cmd shim is wrapped in
// cmd.exe /d /s /c exactly like mcp.ts:resolveSpawnTarget.
// ============================================================
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp, accessSync, constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { ToolContext, ToolOutcome } from './tools';
import {
  specForFile, detectRoot, heuristicSentence, HEURISTIC_FALLBACKS, LSP_SERVERS,
  type LanguageServerSpec,
} from './lspLanguages';
// v11.12 — real heuristic fallbacks. These are regex/AST-lite readers from
// codeintel, NOT simulated LSP responses. Every result using them is labelled.
import {
  HEURISTIC_LABEL, extractSymbols, symbolAtPosition, heuristicOutline,
  heuristicFindReferences,
} from './codeintel';

// v11.16 — the language matrix is the SINGLE source of truth in lspLanguages.ts.
// lsp.ts consumes the exact same specs the lsp_languages tool advertises, so the
// advertised support and the servers actually launched can never drift apart.
type Lang = string;
type ServerSpec = LanguageServerSpec;

// Declarative install recipes now live in ./lspLanguages.ts (single source of
// truth) with the shape `install: { exe: string; args: string[]; timeoutMs: number } | null`.
// `null` means manual/external install — this client never auto-installs those.
function specFor(file: string): ServerSpec | null {
  return specForFile(file);
}

/**
 * v11.23 (AUDIT) — "binary missing" and "server crashed" are DIFFERENT truths
 * and must never be conflated. A missing executable is a setup problem with an
 * exact install command; a real crash means the binary exists but died. The
 * old path reported both as "language server exited"/a failed tool, so a user
 * who simply had not installed pyright saw a crash instead of an install hint.
 */
export type LspFailureKind = 'not-installed' | 'crashed';

/** Classify a spawn/initialize cause honestly (pure, testable). */
export function lspFailureKind(cause: string): LspFailureKind {
  const c = String(cause ?? '');
  // v11.31 — cover the real spellings produced by spawn() on all three
  // platforms (Windows CMD "is not recognized", POSIX "not found", EACCES,
  // etc.). A *missing* binary is a setup problem, never a server crash.
  return /ENOENT|EACCES|EPERM|is not recognized|command not found|binary not found|not on PATH|no such file or directory|not found in PATH|spawn\s+\S+\s+ENOENT/i.test(c)
    ? 'not-installed'
    : 'crashed';
}

/**
 * Is a launchable binary present on PATH (or at an absolute path)? Bare-name
 * commands are resolved with PATHEXT on Windows. Best-effort and side-effect
 * free — this only checks existence/executability, it never starts a server.
 */
export function lspBinaryAvailable(command: string): boolean {
  const cmd = String(command ?? '').trim();
  if (!cmd) return false;
  if (path.isAbsolute(cmd)) {
    try { accessSync(cmd, fsConstants.F_OK | fsConstants.X_OK); return true; } catch { return false; }
  }
  const pathVar = process.env.PATH || process.env.Path || '';
  const exts: string[] = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  // v11.31 — a command that ALREADY carries an executable extension (e.g. a
  // registry entry "pyright-langserver.cmd") must be checked verbatim. The old
  // code only ever probed `cmd + ext`, so it looked for
  // `pyright-langserver.cmd.CMD` and reported a false "not installed".
  const candidates = path.extname(cmd) ? [cmd] : exts.map((e) => cmd + e);
  for (const dir of String(pathVar).split(path.delimiter)) {
    if (!dir) continue;
    for (const candidate of candidates) {
      try {
        accessSync(path.join(dir, candidate), fsConstants.F_OK | fsConstants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

/** Honest, reusable refusal text for a missing/unavailable server. */
export function lspUnavailableMessage(spec: ServerSpec, cause: string, kind: LspFailureKind = lspFailureKind(cause)): string {
  const extNote = spec.externalBinary ? ` It also needs an external binary that may be missing: ${spec.externalBinary}` : '';
  const note = spec.note ? ` Note: ${spec.note}` : '';
  const how = spec.install
    ? `Install it: ${spec.installHint}.`
    : `Manual/external install required — ${spec.installHint}. This build will NOT auto-install it.`;
  const headline = kind === 'not-installed'
    ? `server not installed: ${spec.command} (${cause}).`
    : `language server ${spec.command} exited before it could answer (${cause}) — the binary is present on PATH, so this is a server failure, not a missing tool.`;
  return `${headline} ${how}${extNote}${note} Alternatively ${heuristicSentence()}`;
}


/**
 * Distinguishes "no usable server" from every other failure (bad path, out of
 * workspace, …). Only this error is allowed to trigger a heuristic fallback —
 * a bad argument must still be an honest refusal, never a fake success.
 */
class LspUnavailableError extends Error {
  readonly spec: ServerSpec | null;
  readonly ext: string;
  constructor(message: string, spec: ServerSpec | null, ext: string) {
    super(message);
    this.name = 'LspUnavailableError';
    this.spec = spec;
    this.ext = ext;
  }
}

/** Windows: extensionless / .cmd launchers need a cmd.exe wrapper (mcp.ts parity). */
function winShim(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };
  const ext = path.extname(command).toLowerCase();
  const alreadyShell = /^(cmd|cmd\.exe)$/i.test(path.basename(command));
  if (!alreadyShell && (ext === '' || ext === '.cmd' || ext === '.bat')) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
  }
  return { command, args };
}

interface LspMsg {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message?: string };
}

class LspClient {
  private proc: ChildProcess;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  /** textDocument/publishDiagnostics notifications, keyed by file URI. */
  readonly diagnostics = new Map<string, any[]>();
  private exited = false;

  constructor(spec: ServerSpec, cwd: string) {
    const { command, args } = winShim(spec.command, spec.args);
    this.proc = spawn(command, args, {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, env: { ...process.env },
    });
    this.proc.stdout?.on('data', (c: Buffer) => this.onData(c));
    this.proc.once('error', (e) => this.rejectAll(e));
    this.proc.once('exit', () => { this.exited = true; this.rejectAll(new Error('language server exited')); });
  }

  get alive(): boolean { return !this.exited; }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const hEnd = this.buf.indexOf('\r\n\r\n');
      if (hEnd < 0) return;
      const header = this.buf.slice(0, hEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { this.buf = this.buf.slice(hEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      if (this.buf.length < hEnd + 4 + len) return; // partial frame — wait for more
      const body = this.buf.slice(hEnd + 4, hEnd + 4 + len).toString('utf8');
      this.buf = this.buf.slice(hEnd + 4 + len);
      let msg: LspMsg;
      try { msg = JSON.parse(body); } catch { continue; }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: LspMsg): void {
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.diagnostics.set(msg.params?.uri ?? '', msg.params?.diagnostics ?? []);
      return;
    }
    if (msg.method?.startsWith('window/') || msg.method === 'telemetry/event') return; // noise
    if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`LSP: ${msg.error.message ?? 'request error'}`));
      else p.resolve(msg.result);
      return;
    }
    if (typeof msg.id === 'number' && msg.method) {
      // Server→client request (workspace/configuration, registerCapability…):
      // minimal client declines extras with a null result rather than hanging.
      this.write({ id: msg.id, result: null });
    }
  }

  private write(msg: LspMsg): void {
    const payload = JSON.stringify({ jsonrpc: '2.0', ...msg });
    try {
      this.proc.stdin?.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
    } catch {
      /* process may be gone */
    }
  }

  notify(method: string, params?: unknown): void { this.write({ method, params }); }

  request<T = any>(method: string, params: unknown, timeoutMs = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.exited || !this.proc.stdin?.writable) return reject(new Error('language server not running'));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  kill(): void {
    try { this.proc.kill(); } catch { /* already gone */ }
    setTimeout(() => {
      try {
        if (!this.exited && this.proc.pid) {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(this.proc.pid), '/t', '/f'], { windowsHide: true });
          else this.proc.kill('SIGKILL');
        }
      } catch { /* gone */ }
    }, 1500).unref();
  }

  private rejectAll(e: Error): void {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear();
  }
}

interface LspSession {
  client: LspClient;
  spec: ServerSpec;
  opened: Map<string, number>;
  lastUsed: number;
}
const sessions = new Map<string, LspSession>();
const IDLE_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 4;

function reapIdle(): void {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.lastUsed > IDLE_TTL_MS || !s.client.alive) { s.client.kill(); sessions.delete(k); }
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!oldest) break;
    oldest[1].client.kill();
    sessions.delete(oldest[0]);
  }
}

// ---------- v12 — one-time, approval-gated, cached auto-install ----------
const installCache = new Map<Lang, 'ok' | 'failed'>();

function lspUserDataDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
    if (app?.getPath) return app.getPath('userData');
  } catch { /* CLI / test context */ }
  return path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.surnia');
}

function installMarkerPath(): string { return path.join(lspUserDataDir(), 'lsp-autoinstall-v1.json'); }

function loadInstallMarkers(): Record<string, 'ok' | 'failed'> {
  try { return JSON.parse(require('node:fs').readFileSync(installMarkerPath(), 'utf8')) as Record<string, 'ok' | 'failed'>; }
  catch { return {}; }
}
function writeInstallMarker(lang: Lang, status: 'ok' | 'failed'): void {
  installCache.set(lang, status);
  try {
    const fsSync = require('node:fs') as typeof import('node:fs');
    const p = installMarkerPath();
    fsSync.mkdirSync(path.dirname(p), { recursive: true });
    const all = loadInstallMarkers();
    all[lang] = status;
    fsSync.writeFileSync(p, JSON.stringify(all), 'utf8');
  } catch { /* persistence is best-effort */ }
}

const shellJoin = (exe: string, args: string[]): string =>
  process.platform === 'win32'
    ? [exe, ...args].join(' ')
    : [exe, ...args].map((s) => /^[\w@/._:=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`).join(' ');

/** Try to auto-install a missing language server once, with user approval. */
async function maybeInstall(spec: ServerSpec, ctx: ToolContext, cause: string): Promise<boolean> {
  const status = installCache.get(spec.lang) ?? loadInstallMarkers()[spec.lang];
  if (status) return false; // never re-install after a prior attempt (ok or failed)
  if ((ctx as any).denyHint) return false; // read-only mode — keep honest refusal

  // v11.16 — MANUAL / external servers are NEVER auto-installed. Emit the exact
  // install steps instead of pretending npm/pip can provide them.
  if (!spec.install) {
    const extNote = spec.externalBinary ? ` External binary required: ${spec.externalBinary}` : '';
    try { ctx.emit({ type: 'sys_notice', kind: 'lsp', text: `${spec.language} server (${spec.command}) is not auto-installed. Install manually: ${spec.installHint}.${extNote} ${heuristicSentence()}` } as any); } catch { /* best-effort */ }
    return false;
  }

  const command = shellJoin(spec.install.exe, spec.install.args);
  // v11.23 — approval is host-supplied and may throw (CLI / test stubs). An
  // installer exception must degrade to an honest refusal, never escape as a
  // tool crash from ensureSession.
  let allowed = false;
  try {
    allowed = await ctx.approve({
      kind: 'command',
      title: `Install language server: ${spec.lang}`,
      detail: `${command}\nReason: ${cause.slice(0, 300)}\nThis installs a global tool on this machine (one time only).`,
      payload: { command, cwd: ctx.workspace },
      force: true, // a global install must not auto-approve in relaxed modes
    } as any);
  } catch {
    allowed = false;
  }
  if (!allowed) {
    try { ctx.emit({ type: 'sys_notice', kind: 'lsp', text: `Auto-install declined for ${spec.lang}. Install manually: ${spec.installHint}. ${heuristicSentence()}` } as any); } catch { /* best-effort */ }
    return false;
  }
  try {
    // Lazy import keeps this module usable in isolation/tests without electron.
    const { runCaptured } = require('../services/terminalService') as typeof import('../services/terminalService');
    const r = await runCaptured(command, ctx.workspace, spec.install.timeoutMs, { signal: ctx.signal, maxOutput: 20_000 });
    if (r.exitCode === 0) { writeInstallMarker(spec.lang, 'ok'); return true; }
    writeInstallMarker(spec.lang, 'failed');
    try { ctx.emit({ type: 'sys_notice', kind: 'lsp', text: `LSP auto-install failed (exit ${r.exitCode}). Install manually: ${spec.installHint}. ${heuristicSentence()}` } as any); } catch { /* best-effort */ }
    return false;
  } catch (err) {
    writeInstallMarker(spec.lang, 'failed');
    try { ctx.emit({ type: 'sys_notice', kind: 'lsp', text: `LSP auto-install could not start (${err instanceof Error ? err.message : String(err)}). Install manually: ${spec.installHint}. ${heuristicSentence()}` } as any); } catch { /* best-effort */ }
    return false;
  }
}

async function ensureSession(absFile: string, workspace: string, ctx?: ToolContext): Promise<LspSession> {
  const spec = specFor(absFile);
  if (!spec) {
    // v11.16 — unsupported languages must be told EXACTLY which heuristic tools
    // still work, instead of a dead-end "no server configured" message.
    const ext = path.extname(absFile) || 'this file extension';
    throw new LspUnavailableError(`no real language server is configured for ${ext}. ${heuristicSentence()}`, null, ext);
  }
  // v11.23 — resolve the binary BEFORE spawning. A missing executable must be
  // an honest "not installed + install command" refusal, never a spawn error
  // that a caller renders as a crashed tool. No process is started here.
  if (!lspBinaryAvailable(spec.command)) {
    throw new LspUnavailableError(
      lspUnavailableMessage(spec, 'binary not found on PATH', 'not-installed'),
      spec,
      path.extname(absFile),
    );
  }
  reapIdle();
  // Resolve the project root from the file (composer.json / go.mod / Cargo.toml /
  // compile_commands.json / pubspec.yaml / ...), falling back to the workspace.
  const root = detectRoot(absFile, workspace, spec.rootFiles);
  const key = `${path.resolve(workspace)}|${spec.lang}|${root}`;
  const existing = sessions.get(key);
  if (existing && existing.client.alive) { existing.lastUsed = Date.now(); return existing; }

  const rootUri = pathToFileURL(root).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    let client: LspClient | null = null;
    try {
      // v11.31 — spawn() itself can throw synchronously (bad cwd/args). Keep it
      // inside the guarded block so a launch failure is an honest LSP refusal
      // with the install hint, never an uncaught tool crash.
      client = new LspClient(spec, root);
      await client.request('initialize', {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: { publishDiagnostics: { relatedInformation: true } },
          workspace: { workspaceFolders: true },
        },
        workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
      }, 15000);
      client.notify('initialized', {});
      const s: LspSession = { client, spec, opened: new Map(), lastUsed: Date.now() };
      sessions.set(key, s);
      return s;
    } catch (e) {
      try { client?.kill(); } catch { /* already gone */ }
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0 && ctx && await maybeInstall(spec, ctx, msg)) continue; // retry once after install
      throw new LspUnavailableError(lspUnavailableMessage(spec, msg), spec, path.extname(absFile));
    }
  }
  throw new LspUnavailableError(
    lspUnavailableMessage(spec, 'server unavailable after install attempt', 'crashed'),
    spec,
    path.extname(absFile),
  );
}

async function openDoc(s: LspSession, absFile: string): Promise<string> {
  const uri = pathToFileURL(path.resolve(absFile)).toString();
  if (!s.opened.has(uri)) {
    const text = await fsp.readFile(absFile, 'utf8');
    s.client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: s.spec.languageId, version: 1, text },
    });
    s.opened.set(uri, 1);
  }
  return uri;
}

const pos = (line: number, character: number) => ({ line: Math.max(0, line - 1), character: Math.max(0, character - 1) });
const fileOf = (uri: string): string => { try { return fileURLToPath(uri); } catch { return uri; } };

function formatLocations(res: any): string {
  const items = Array.isArray(res) ? res : res ? [res] : [];
  if (!items.length) return 'No definition found.';
  return items.map((l: any) => {
    const u: string = l?.targetUri ?? l?.uri ?? '';
    const r = l?.targetSelectionRange ?? l?.range ?? l?.targetRange;
    const line = (r?.start?.line ?? 0) + 1;
    const ch = (r?.start?.character ?? 0) + 1;
    return `${u ? fileOf(u) : '(unknown)'} : ${line} : ${ch}`;
  }).join('\n');
}

function formatHover(res: any): string {
  if (!res) return 'No hover information.';
  const c = res.contents;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: any) => typeof x === 'string' ? x : x?.value ?? '').join('\n');
  return c?.value ? c.value : JSON.stringify(res).slice(0, 2000);
}

function formatRefs(res: any): string {
  const items = Array.isArray(res) ? res : [];
  if (!items.length) return 'No references found.';
  return items.map((l: any) => `${l?.uri ? fileOf(l.uri) : '?'} : ${(l?.range?.start?.line ?? 0) + 1} : ${(l?.range?.start?.character ?? 0) + 1}`).join('\n');
}

// ---------- shared executor boilerplate ----------

function asString(v: unknown): string { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function asNumber(v: unknown, d = 0): number { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : d; }

/**
 * v11.31 — real path-jail check. `abs.startsWith(workspace)` (the old code)
 * accepts sibling directories whose name merely shares the workspace prefix
 * (`.../proj` vs `.../proj-secret/keys.py`) and is case-sensitive on Windows.
 * `path.relative` is separator- and case-correct on every platform.
 */
function isWithinWorkspace(abs: string, workspace: string): boolean {
  try {
    const root = path.resolve(workspace);
    const rel = path.relative(root, path.resolve(abs));
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

type HeuristicFallback = (abs: string, err: LspUnavailableError, ctx: ToolContext) => Promise<string> | string;

async function withLsp(
  args: Record<string, unknown>,
  ctx: ToolContext,
  tool: string,
  fn: (s: LspSession, uri: string) => Promise<string>,
  needPos = true,
  fallback?: HeuristicFallback,
): Promise<ToolOutcome> {
  // Local imports avoided at module scope to keep this module import-only from tools.
  const raw = asString(args.path).trim();
  if (!raw) return { ok: false, output: `Missing required parameter: path` };
  const line = asNumber(args.line, 0), ch = asNumber(args.character, 0);
  if (needPos && (!line || !ch)) return { ok: false, output: `Missing required parameters: line, character (1-based).` };
  let abs = '';
  try {
    abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(ctx.workspace, raw);
    if (!isWithinWorkspace(abs, ctx.workspace)) {
      return { ok: false, output: `${tool}: path is outside the workspace: ${raw}. Only files inside ${ctx.workspace} can be inspected.` };
    }
    await fsp.access(abs);
    const s = await ensureSession(abs, ctx.workspace, ctx);
    const uri = await openDoc(s, abs);
    // Pass 1-based line/char via a synthetic closure (fn reads args itself is avoided).
    const text = await fn(s, uri);
    return { ok: true, output: text };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    // ONLY a missing/unavailable server may fall back. Bad paths, bad args and
    // real server errors stay honest refusals — no fabricated "success".
    if (fallback && e instanceof LspUnavailableError && abs) {
      try {
        const heur = await fallback(abs, e, ctx);
        if (heur && heur.trim()) {
          return { ok: true, output: `${tool}: ${e.message}\n${HEURISTIC_LABEL} ${heur}` };
        }
      } catch (hErr) {
        return { ok: false, output: `${tool}: ${e.message}\n${HEURISTIC_LABEL} unavailable: ${hErr instanceof Error ? hErr.message : String(hErr)}` };
      }
    }
    return { ok: false, output: `${tool}: ${e.message}` };
  }
}

// ---------- v11.12 — named heuristic fallbacks (explicitly NOT LSP) ----------
//
// A missing server must never be a dead end: these return REAL results from
// codeintel's regex/AST-lite readers, stamped HEURISTIC_LABEL by withLsp and
// accompanied by the exact install command for the absent server.

async function heuristicDefinitionFallback(abs: string, _err: LspUnavailableError, ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const text = await fsp.readFile(abs, 'utf8');
  const line = asNumber(args.line), ch = asNumber(args.character);
  const name = symbolAtPosition(abs, text, line, ch);
  if (!name) {
    return `symbol_outline could not identify a symbol at ${path.basename(abs)}:${line}:${ch}. Try ${HEURISTIC_FALLBACKS.join(' / ')}.`;
  }
  const syms = extractSymbols(abs, text);
  const exact = syms.filter((s) => s.name === name);
  if (!exact.length) {
    const near = syms.filter((s) => s.name.toLowerCase().includes(name.toLowerCase())).slice(0, 5);
    return near.length
      ? `symbol_outline found no exact declaration for "${name}"; near matches (heuristic, no column info):\n${near.map((s) => `  ${path.relative(ctx.workspace, abs) || abs} : ${s.line}  ${s.kind} ${s.name}`).join('\n')}`
      : `symbol_outline found no declaration for "${name}" in ${path.basename(abs)}. Use find_refs / repo_map to explore.`;
  }
  return `definition of "${name}" (heuristic symbol_outline — line is real, column is NOT LSP-precise):\n` +
    exact.slice(0, 5).map((s) => `  ${path.relative(ctx.workspace, abs) || abs} : ${s.line}  ${s.kind}${s.container ? ` in ${s.container}` : ''}`).join('\n');
}

async function heuristicReferencesFallback(abs: string, _err: LspUnavailableError, ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  const text = await fsp.readFile(abs, 'utf8');
  const line = asNumber(args.line), ch = asNumber(args.character);
  let name = symbolAtPosition(abs, text, line, ch);
  if (!name && asString(args.name).trim()) name = asString(args.name).trim();
  if (!name) return `find_refs needs a symbol name or a cursor on one (${line}:${ch}).`;
  const refs = await heuristicFindReferences(ctx.workspace, name, 60);
  if (!refs.length) return `find_refs found no references to "${name}" in the ${ctx.workspace} index.`;
  return `find_refs "${name}": ${refs.length} reference(s)${refs.length >= 60 ? ' (top 60)' : ''}:\n` +
    refs.map((r) => `  ${r.relPath}:${r.line} → ${r.text}`).join('\n');
}

async function heuristicSymbolsFallback(abs: string, _err: LspUnavailableError, ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  void ctx;
  const text = await fsp.readFile(abs, 'utf8');
  const query = asString(args.query).trim();
  const limit = Math.max(1, Math.min(200, asNumber(args.limit, 80)));
  return heuristicOutline(abs, text, query || undefined, limit);
}

const LSP_SYMBOL_KINDS = [
  'file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field',
  'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string',
  'number', 'boolean', 'array', 'object', 'key', 'null', 'enumMember', 'struct',
  'event', 'operator', 'typeParameter',
];

function formatDocumentSymbols(res: any, limit: number, query: string): string {
  const items: any[] = Array.isArray(res) ? res : [];
  if (!items.length) return 'The language server reported no document symbols for this file.';
  const out: string[] = [];
  const walk = (it: any, depth: number): void => {
    if (!it || typeof it !== 'object') return;
    const name: string = asString(it.name) || '?';
    const r = it.range ?? it.location?.range;
    const line = (r?.start?.line ?? 0) + 1;
    const kind = typeof it.kind === 'number' ? (LSP_SYMBOL_KINDS[it.kind - 1] ?? `kind(${it.kind})`) : asString(it.kind) || 'symbol';
    if (!query || name.toLowerCase().includes(query)) out.push(`${'  '.repeat(depth)}${kind} ${name} (line ${line})`);
    for (const child of it.children ?? []) walk(child, depth + 1);
  };
  for (const it of items) walk(it, 0);
  if (!out.length) return `The language server reported symbols, none matching "${query}".`;
  const shown = out.slice(0, limit);
  return `${shown.length} symbol(s)${out.length > shown.length ? ` (showing ${shown.length} of ${out.length})` : ''} via textDocument/documentSymbol:\n${shown.join('\n')}`;
}

/** Position object helper exported for executors that inline the request. */
export const lspPos = pos;

export async function lspDefinitionTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  return withLsp(args, ctx, 'lsp_definition', async (s, uri) => {
    const res = await s.client.request('textDocument/definition', { textDocument: { uri }, position: pos(asNumber(args.line), asNumber(args.character)) });
    return formatLocations(res);
  }, true, (abs, err, c) => heuristicDefinitionFallback(abs, err, c, args));
}

export async function lspHoverTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  return withLsp(args, ctx, 'lsp_hover', async (s, uri) => {
    const res = await s.client.request('textDocument/hover', { textDocument: { uri }, position: pos(asNumber(args.line), asNumber(args.character)) });
    return formatHover(res);
  });
}

export async function lspReferencesTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  return withLsp(args, ctx, 'lsp_references', async (s, uri) => {
    const res = await s.client.request('textDocument/references', {
      textDocument: { uri }, position: pos(asNumber(args.line), asNumber(args.character)),
      context: { includeDeclaration: args.include_declaration !== false },
    });
    return formatRefs(res);
  }, true, (abs, err, c) => heuristicReferencesFallback(abs, err, c, args));
}

export async function lspDiagnosticsTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  return withLsp(args, ctx, 'lsp_diagnostics', async (s, uri) => {
    // didOpen triggers publishDiagnostics; give the server a brief window.
    let d = s.client.diagnostics.get(uri);
    if (!d) {
      await new Promise((r) => setTimeout(r, 800));
      d = s.client.diagnostics.get(uri);
    }
    if (!d) return 'No diagnostics published yet (the server may need the whole workspace loaded).';
    if (!d.length) return 'No diagnostics — the file is clean according to the language server.';
    return d.map((x: any) => {
      const r = x.range?.start;
      const sev = ['ERROR', 'WARN', 'INFO', 'HINT'][x.severity ?? 1] ?? 'INFO';
      return `${sev} ${(r?.line ?? 0) + 1}:${(r?.character ?? 0) + 1}  ${x.message ?? ''}`;
    }).join('\n');
  }, false);
}

export async function lspRenameTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const newName = asString(args.new_name).trim();
  if (!newName) return { ok: false, output: 'Missing required parameter: new_name' };
  // NO heuristic rename: guessing workspace-wide edits without a server would
  // fabricate LSP results and silently corrupt code. Refuse instead.
  const result = await withLsp(args, ctx, 'lsp_rename', async (s, uri) => {
    const res: any = await s.client.request('textDocument/rename', {
      textDocument: { uri }, position: pos(asNumber(args.line), asNumber(args.character)), newName,
    });
    const changes: Array<{ where: string; text: string }> = [];
    const add = (u: string, edits: any[]) => {
      for (const e of edits ?? []) changes.push({ where: `${fileOf(u)} : ${(e.range?.start?.line ?? 0) + 1}:${(e.range?.start?.character ?? 0) + 1}`, text: e.newText ?? '' });
    };
    if (res?.changes) for (const [u, edits] of Object.entries(res.changes)) add(u, edits as any[]);
    for (const dc of res?.documentChanges ?? []) add(dc?.textDocument?.uri ?? '', dc?.edits ?? []);
    if (!changes.length) return 'Rename produced no edits (symbol may not be renamable).';
    return `Proposed ${changes.length} edit(s). Apply with multi_file_edit (approval-gated):\n` +
      changes.map((c) => `  ${c.where}  →  ${JSON.stringify(c.text)}`).join('\n');
  });
  if (!result.ok && /server not installed:|no real language server is configured|exited before it could answer/.test(result.output)) {
    return {
      ok: false,
      output: `${result.output}\nRefusing to guess rename edits: without a language server there is no reliable workspace-wide rename. Inspect with ${HEURISTIC_FALLBACKS.join(' / ')} and apply edits manually.`,
    };
  }
  return result;
}

export async function lspCompletionTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const limit = Math.max(1, Math.min(100, asNumber(args.limit, 30)));
  return withLsp(args, ctx, 'lsp_completion', async (s, uri) => {
    const res: any = await s.client.request('textDocument/completion', { textDocument: { uri }, position: pos(asNumber(args.line), asNumber(args.character)) });
    const items: any[] = Array.isArray(res) ? res : res?.items ?? [];
    if (!items.length) return 'No completion suggestions.';
    return items.slice(0, limit).map((it) => `${it.label}${it.detail ? ` — ${it.detail}` : ''}`).join('\n');
  });
}

/**
 * Document symbols for one file. With a server: real textDocument/documentSymbol.
 * Without one: the named symbol_outline heuristic — never a fabricated LSP reply.
 * Optional `query` filters by symbol name; `limit` caps the output (default 80).
 */
export async function lspSymbolsTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const limit = Math.max(1, Math.min(200, asNumber(args.limit, 80)));
  const query = asString(args.query).trim().toLowerCase();
  return withLsp(args, ctx, 'lsp_symbols', async (s, uri) => {
    const res: any = await s.client.request('textDocument/documentSymbol', { textDocument: { uri } });
    return formatDocumentSymbols(res, limit, query);
  }, false, (abs, err, c) => heuristicSymbolsFallback(abs, err, c, args));
}

/** Backwards-compatible alias for callers that spell the tool "document symbols". */
export const lspDocumentSymbolsTool = lspSymbolsTool;

/** One audit row for the support matrix — used by tests and `lsp_languages` consumers. */
export interface LanguageMatrixRow {
  lang: string;
  language: string;
  extensions: string[];
  command: string;
  installHint: string;
  rootFiles: string[];
  autoInstall: boolean;
  externalBinary: string | null;
  ok: boolean;
  issues: string[];
}

/**
 * Audits the 16 wired language servers. A row is `ok` only when it has a real
 * launch command, at least one extension that resolves back to it, project-root
 * markers, an exact install hint, and — for manual servers — an honest external
 * binary note. This checks the registry lsp.ts actually spawns from, so the
 * advertised matrix and the launch path cannot silently drift apart.
 */
export function verifyLanguageMatrix(): { total: number; ok: boolean; rows: LanguageMatrixRow[] } {
  const rows = LSP_SERVERS.map((s): LanguageMatrixRow => {
    const issues: string[] = [];
    if (!s.command || s.command.length < 2) issues.push('missing launch command');
    if (!s.installHint || s.installHint.length < 6) issues.push('missing install hint');
    if (!s.rootFiles?.length) issues.push('missing root markers');
    if (!s.exts?.length) issues.push('missing extensions');
    if (!s.exts?.some((e) => specForFile(`file.${e}`)?.lang === s.lang)) issues.push('extension does not resolve to this server');
    if (!s.install && !(s.externalBinary && s.externalBinary.length > 5)) issues.push('manual server lacks external-binary note');
    if (s.install && (!s.install.exe || !Array.isArray(s.install.args))) issues.push('malformed install recipe');
    return {
      lang: s.lang, language: s.language, extensions: [...s.exts], command: s.command,
      installHint: s.installHint, rootFiles: [...s.rootFiles], autoInstall: !!s.install,
      externalBinary: s.externalBinary ?? null, ok: issues.length === 0, issues,
    };
  });
  return { total: rows.length, ok: rows.every((r) => r.ok), rows };
}

/** Shut down all servers (called on app quit). */
export function shutdownLsp(): void {
  for (const [, s] of sessions) s.client.kill();
  sessions.clear();
}

// Re-export the shared support matrix so callers/tests can import it from
// either module. The lsp_languages tool should import formatMatrix /
// describeLanguage from ./lspLanguages directly (single source of truth).
export {
  LSP_SERVERS, HEURISTIC_ONLY, HEURISTIC_FALLBACKS,
  specForFile, detectRoot, findLanguage, formatMatrix, describeLanguage, heuristicSentence,
} from './lspLanguages';
