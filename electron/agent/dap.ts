// ============================================================
// Surnia v7.1 — REAL DEBUGGER FOR THE AGENT (DAP client).
// print-debugging burns model tokens and misses state. A debugger
// stops at a line with every variable live — and per the Kimchi
// self-claim (Aug 2026) no major coding agent ships one. This is a
// genuine Debug Adapter Protocol client:
//
//   • Wire: DAP JSON messages with Content-Length framing over a TCP
//     socket — the transport debugpy (python) and vscode-js-debug's
//     dapDebugServer (node) both speak.
//   • Flow: spawn adapter → connect → initialize → attach/launch →
//     setBreakpoints → configurationDone → (events: stopped) →
//     stackTrace/scopes/variables/evaluate → continue/next/stepIn/
//     stepOut → disconnect + kill.
//   • Adapters:
//       python: `python -m debugpy --listen 127.0.0.1:<port> <script>`
//         (auto-installs debugpy into the interpreter on first use)
//       node:   `node <userData>/dap/js-debug/src/dapDebugServer.js <port>`
//         (one-click install of @deepailab/js-debug-dap release asset on first use)
//   • Every stopped position is recorded into a root-cause evidence
//     trail (frames + watched expressions) that the engine attaches
//     to the proof package as ROOT-CAUSE EVIDENCE.
//
// The client is engine-side state: one debug session per agent run,
// guarded (start stops the previous one). All methods time out; a
// dead adapter is always reaped.
// ============================================================
import { spawn, type ChildProcess } from 'child_process';
import * as net from 'node:net';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runCaptured } from '../services/terminalService';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type DebugAdapterKind = 'node' | 'python';

export interface DebugBreakpoint {
  file: string; // absolute
  line: number; // 1-based
  condition?: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface StackFrameInfo {
  id: number;
  name: string;
  file: string;
  line: number;
  column: number;
}

export interface DebugPosition {
  file: string;
  line: number;
  column: number;
  frameName: string;
}

export interface RootCauseEvidence {
  startedAt: number;
  adapter: DebugAdapterKind;
  program: string;
  stops: Array<{ at: number; position: DebugPosition; variables: DebugVariable[]; evaluated?: Array<{ expr: string; result: string }> }>;
  breakErrors: string[];
  endedAt?: number;
  outcome?: string;
}

const DAP_TIMEOUT_MS = 15_000;
const STOP_WAIT_MS = 20_000;
const EXIT_WAIT_MS = 25_000;
const MAX_EVIDENCE_STOPS = 30;

// ------------------------------------------------------------
// DAP client over TCP (Content-Length framing)
// ------------------------------------------------------------

interface DapMessage {
  seq?: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
}

class DapClient {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private seq = 1;
  private pending = new Map<number, { resolve: (v: DapMessage) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Array<(m: DapMessage) => void>>();
  private closed = false;
  error: Error | null = null;

  connect(port: number, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`DAP connect timeout on 127.0.0.1:${port}`));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.on('data', (chunk) => this.onData(chunk));
      socket.once('close', () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new Error('DAP connection closed'));
        this.pending.clear();
        for (const [, hs] of this.eventHandlers) for (const h of hs) h({ type: 'event', event: '__disconnected' });
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        // no framing — drop garbage up to this point
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      if (this.buffer.length < headerEnd + 4 + len) return;
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
      this.buffer = this.buffer.slice(headerEnd + 4 + len);
      try {
        const msg = JSON.parse(body) as DapMessage;
        this.dispatch(msg);
      } catch {
        /* a malformed frame must not kill the session */
      }
    }
  }

  private dispatch(msg: DapMessage): void {
    if (msg.type === 'response' && typeof msg.request_seq === 'number') {
      const p = this.pending.get(msg.request_seq);
      if (p) {
        this.pending.delete(msg.request_seq);
        if (msg.success === false) p.reject(new Error(`DAP ${msg.command}: ${msg.message ?? 'failed'}`));
        else p.resolve(msg);
      }
      return;
    }
    if (msg.type === 'event' && msg.event) {
      const hs = this.eventHandlers.get(msg.event);
      if (hs) for (const h of hs) h(msg);
      return;
    }
    // v12 — the adapter may send REVERSE requests to the client (runInTerminal,
    // startDebugging). Without a response js-debug blocks its own `launch`
    // response forever. Answer minimally so launch can proceed.
    if (msg.type === 'request' && typeof msg.seq === 'number') {
      const reply = JSON.stringify({
        seq: this.seq++, type: 'response', request_seq: msg.seq,
        command: msg.command, success: true,
        body: msg.command === 'runInTerminal' ? { processId: process.pid } : {},
      });
      try {
        this.socket?.write(`Content-Length: ${Buffer.byteLength(reply)}\r\n\r\n${reply}`);
      } catch { /* socket gone */ }
    }
  }

  on(event: string, handler: (m: DapMessage) => void): void {
    const list = this.eventHandlers.get(event) ?? [];
    list.push(handler);
    this.eventHandlers.set(event, list);
  }

  request(command: string, args?: Record<string, unknown>, timeoutMs = DAP_TIMEOUT_MS): Promise<DapMessage> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.closed) {
        reject(new Error('DAP client not connected'));
        return;
      }
      const seq = this.seq++;
      const msg = { seq, type: 'request' as const, command, arguments: args ?? {} };
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP ${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const payload = JSON.stringify(msg);
      this.socket.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    });
  }

  destroy(): void {
    try {
      this.socket?.destroy();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.closed = true;
  }
}

// ------------------------------------------------------------
// Adapter lifecycle
// ------------------------------------------------------------

export interface DebugSession {
  kind: DebugAdapterKind;
  program: string;
  adapter: ChildProcess | null;
  client: DapClient;
  port: number;
  evidence: RootCauseEvidence;
  threadId: number;
}

let session: DebugSession | null = null;

export function debugActive(): boolean {
  return !!session;
}

export function debugEvidence(): RootCauseEvidence | null {
  return session?.evidence ?? null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
    srv.once('error', reject);
  });
}

async function waitTcp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port });
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`debug adapter did not open port 127.0.0.1:${port} within ${timeoutMs}ms`);
}

/** One-click adapter installation (best-effort, budget-capped). */
export async function ensureAdapter(kind: DebugAdapterKind, userDataDir: string): Promise<{ ok: boolean; detail: string }> {
  if (kind === 'python') {
    const probe = await runCaptured('python -c "import debugpy" && python -m debugpy --version || python3 -c "import debugpy"', '.', 20_000);
    if (probe.exitCode === 0) return { ok: true, detail: 'debugpy present' };
    const inst = await runCaptured('python -m pip install --quiet debugpy || python3 -m pip install --quiet debugpy', '.', 120_000);
    return inst.exitCode === 0
      ? { ok: true, detail: 'debugpy installed (pip)' }
      : { ok: false, detail: `debugpy install failed: ${inst.output.slice(-200)}` };
  }
  // v12 (TOOL FIX) — @vscode/js-debug on npm is a 404. Use the real, MIT-
  // published GitHub release asset from @deepailab/js-debug-dap and extract its
  // tarball. This makes ALL FIVE debug_* tools functional on a clean machine.
  const dapDir = path.join(userDataDir, 'dap');
  const adapterEntry = path.join(dapDir, 'js-debug', 'src', 'dapDebugServer.js');
  const tgz = path.join(dapDir, 'node_modules', '@deepailab', 'js-debug-dap', 'js-debug-dap-v1.140.0.tar.gz');
  try {
    await fs.access(adapterEntry);
    return { ok: true, detail: 'js-debug present' };
  } catch {
    /* install below */
  }
  await fs.mkdir(dapDir, { recursive: true });
  const inst = await runCaptured(`npm install --prefix "${dapDir}" --no-audit --no-fund @deepailab/js-debug-dap@1.140.0`, '.', 180_000);
  if (inst.exitCode !== 0) return { ok: false, detail: `js-debug package install failed: ${inst.output.slice(-200)}` };
  try {
    await fs.access(tgz);
    const ext = await runCaptured(`tar -xzf "${tgz}" -C "${dapDir}"`, '.', 120_000);
    if (ext.exitCode !== 0) return { ok: false, detail: `js-debug extract failed: ${ext.output.slice(-200)}` };
    await fs.access(adapterEntry);
    return { ok: true, detail: 'js-debug installed (@deepailab release asset)' };
  } catch {
    return { ok: false, detail: 'js-debug adapter entry missing after install' };
  }
}

/** Kill any active session (idempotent). */
export async function debugStop(outcome = 'stopped by request'): Promise<{ stopped: boolean; evidence: RootCauseEvidence | null }> {
  const s = session;
  if (!s) return { stopped: false, evidence: null };
  session = null;
  s.evidence.endedAt = Date.now();
  s.evidence.outcome = outcome;
  try {
    await s.client.request('disconnect', { terminateDebuggee: true }, 3_000);
  } catch {
    /* adapter may already be gone */
  }
  s.client.destroy();
  try {
    s.adapter?.kill();
  } catch {
    /* already exited */
  }
  return { stopped: true, evidence: s.evidence };
}

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

export interface DebugStartOptions {
  kind: DebugAdapterKind;
  program: string; // absolute path to the script
  args?: string[];
  breakpoints?: DebugBreakpoint[];
  cwd?: string;
  userDataDir: string; // for the node adapter install
}

/**
 * A8 security fix — the DAP adapter spawn spec as a pure function (exported
 * for the security regression tests). Returns a (file, args) pair executed
 * with shell:false so no program path or model-supplied debug argument can
 * ever reach a shell (no interpolation, no $()/backtick expansion).
 */
export function buildAdapterSpawnSpec(
  kind: DebugAdapterKind,
  program: string,
  port: number,
  args: string[],
  userDataDir: string,
): { file: string; args: string[] } {
  if (kind === 'python') {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    return {
      file: py,
      args: ['-m', 'debugpy', '--listen', `127.0.0.1:${port}`, program, ...args.map(String)],
    };
  }
  const entry = path.join(userDataDir, 'dap', 'js-debug', 'src', 'dapDebugServer.js');
  // v12 — js-debug defaults to host "localhost" which resolves to IPv6 ::1 on
  // modern Windows; the DAP client + waitTcp connect to 127.0.0.1. Pin IPv4.
  return { file: process.execPath, args: [entry, String(port), '127.0.0.1'] };
}

/**
 * Launch a debug session and leave it PAUSED at the first breakpoint
 * (or entry). Returns the first stopped position. Never throws for
 * expected failures — returns { ok:false, error }.
 */
export async function debugStart(opts: DebugStartOptions): Promise<{ ok: boolean; position?: DebugPosition; variables?: DebugVariable[]; error?: string; note?: string }> {
  await debugStop('replaced by a new session');
  const program = path.resolve(String(opts.program ?? ''));
  try {
    await fs.access(program);
  } catch {
    return { ok: false, error: `debug_start: program not found: ${program}` };
  }

  const inst = await ensureAdapter(opts.kind, opts.userDataDir);
  if (!inst.ok) return { ok: false, error: `debug adapter unavailable: ${inst.detail}` };

  const port = await freePort();
  let adapter: ChildProcess | null = null;
  let client: DapClient | null = null;

  try {
    // A8 security fix — ARG-ARRAY spawn (shell:false). The old string form
    // (`${py} -m debugpy … ${JSON.stringify(program)} ${args}`) ran under
    // shell:true, where JSON.stringify quoting does NOT neutralize POSIX
    // expansions ($(...), backticks survive inside double quotes) — a crafted
    // program path or debug arg executed arbitrary shell commands.
    const spec = buildAdapterSpawnSpec(opts.kind, program, port, opts.args ?? [], opts.userDataDir);
    adapter = spawn(spec.file, spec.args, {
      cwd: opts.cwd ?? path.dirname(program),
      // v12 (TOOL FIX) — js-debug's DAP server will NOT initialise when all
      // stdio is 'ignore' (verified: it never opens its TCP port). Give it
      // pipes so it starts; DAP itself still speaks over the TCP socket.
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
      shell: false,
    });
    adapter.once('error', () => {
      /* surfaced via waitTcp failing */
    });
    // v12 — keep a bounded stderr tail from the adapter so a launch failure
    // reports the REAL cause instead of an opaque "connection closed".
    let adapterErrTail = '';
    adapter.stderr?.on('data', (d: Buffer) => {
      adapterErrTail = (adapterErrTail + d.toString('utf8')).slice(-1500);
    });
    (globalThis as any).__sadeemDapErr = () => adapterErrTail;
    await waitTcp(port, 20_000);
    client = new DapClient();
    await client.connect(port);

    const stoppedPromise = firstStopped(client);
    let launchP: Promise<unknown> | null = null;

    // v12 — js-debug expects a VS-Code-like capability set; without these it
    // silently ignores the `launch` request (never responds, no stopped event).
    await client.request('initialize', {
      adapterID: opts.kind,
      clientID: 'vscode',
      clientName: 'Visual Studio Code',
      locale: 'en',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
      supportsMemoryReferences: true,
      supportsProgressReporting: true,
      supportsInvalidatedEvent: true,
    });
    // v12 — DAP handshake: the adapter emits `initialized` after initialize;
    // set breakpoints BEFORE launch so js-debug has them when the program
    // starts (setting them after launch misses the first stop).
    const dapClient = client; // narrowed non-null after connect()
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      dapClient.on('initialized', finish);
      setTimeout(finish, 2000); // don't hang if the adapter skips the event
    });

    // breakpoints
    const breakErrors: string[] = [];
    const byFile = new Map<string, DebugBreakpoint[]>();
    for (const bp of opts.breakpoints ?? []) {
      const list = byFile.get(bp.file) ?? [];
      list.push(bp);
      byFile.set(bp.file, list);
    }
    for (const [file, list] of byFile) {
      try {
        const r = await client.request('setBreakpoints', {
          source: { path: file.replace(/\\/g, '/'), name: path.basename(file) },
          breakpoints: list.map((b) => ({ line: b.line, condition: b.condition })),
        });
        const bps = (r.body as { breakpoints?: Array<{ verified?: boolean }> } | undefined)?.breakpoints ?? [];
        const verified = bps.map((b) => b.verified);
        if (verified.length && verified.every((v) => v === false)) {
          breakErrors.push(`${path.basename(file)}: breakpoint rejected (line out of range?)`);
        }
      } catch (err) {
        breakErrors.push(`${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (opts.kind === 'python') {
      await client.request('attach', { connect: { host: '127.0.0.1', port }, justMyCode: false });
    } else {
      launchP = client.request('launch', {
        type: 'pwa-node',
        request: 'launch',
        name: 'Surnia debug',
        program: program.replace(/\\/g, '/'),
        args: opts.args ?? [],
        cwd: (opts.cwd ?? path.dirname(program)).replace(/\\/g, '/'),
        stopOnEntry: true,
        console: 'internalConsole',
        internalConsoleOptions: 'neverOpen',
        skipFiles: [],
      });
    }
    await client.request('configurationDone', {}, 10_000);
    if (launchP) await launchP;

    // first stop (entry or breakpoint); python without breakpoints runs to exit
    const stop = await stoppedPromise;
    const evidence: RootCauseEvidence = {
      startedAt: Date.now(),
      adapter: opts.kind,
      program,
      stops: [],
      breakErrors,
    };
    const threadId = stop?.body?.threadId != null ? Number(stop.body.threadId) : 1;
    session = { kind: opts.kind, program, adapter, client, port, evidence, threadId };

    if (!stop) {
      // no stop event — python may have run to completion
      const pos = await currentStack(session).catch(() => null);
      if (!pos) {
        await debugStop('program ran to completion without stopping');
        return { ok: false, error: 'the program finished without hitting a breakpoint (or the breakpoints were invalid). Check the line numbers.', note: inst.detail };
      }
      return { ok: true, position: pos.position, variables: pos.variables, note: inst.detail };
    }

    const cur = await currentStack(session).catch(() => null);
    if (!cur) return { ok: false, error: 'debugger stopped but no stack could be read', note: inst.detail };
    return { ok: true, position: cur.position, variables: cur.variables, note: inst.detail };
  } catch (err) {
    try {
      client?.destroy();
    } catch {
      /* ignore */
    }
    try {
      adapter?.kill();
    } catch {
      /* ignore */
    }
    session = null;
    let adapterNote = '';
    try { adapterNote = String((globalThis as any).__sadeemDapErr?.() ?? ''); } catch { /* ignore */ }
    return {
      ok: false,
      error: `debug_start failed: ${err instanceof Error ? err.message : String(err)}`,
      note: adapterNote ? `adapter: ${adapterNote}` : undefined,
    };
  }
}

function firstStopped(client: DapClient): Promise<DapMessage | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, STOP_WAIT_MS);
    client.on('stopped', (m) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(m);
      }
    });
    client.on('terminated', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(null);
      }
    });
  });
}

// ------------------------------------------------------------
// Introspection + control
// ------------------------------------------------------------

async function currentStack(s: DebugSession): Promise<{ position: DebugPosition; variables: DebugVariable[] } | null> {
  const st = await s.client.request('stackTrace', { threadId: s.threadId, levels: 5 });
  const frames = (st.body?.stackFrames ?? []) as Array<{ id: number; name: string; line: number; column: number; source?: { path?: string; name?: string } }>;
  if (!frames.length) return null;
  const top = frames[0];
  const position: DebugPosition = {
    file: top.source?.path ?? top.source?.name ?? '(unknown)',
    line: top.line,
    column: top.column,
    frameName: top.name,
  };
  const variables = await readScopes(s, top.id);
  return { position, variables };
}

async function readScopes(s: DebugSession, frameId: number, maxVars = 24): Promise<DebugVariable[]> {
  const out: DebugVariable[] = [];
  try {
    const scopesRes = await s.client.request('scopes', { frameId });
    const scopes = (scopesRes.body?.scopes ?? []) as Array<{ name: string; variablesReference: number }>;
    for (const scope of scopes.slice(0, 4)) {
      if (scope.variablesReference === 0) continue;
      const vars = await s.client.request('variables', { variablesReference: scope.variablesReference });
      for (const v of (vars.body?.variables ?? []) as Array<{ name: string; value: string; type?: string; variablesReference: number }>) {
        if (out.length >= maxVars) return out;
        out.push({ name: v.name, value: (v.value ?? '').slice(0, 200), type: v.type, variablesReference: v.variablesReference });
      }
    }
  } catch {
    /* scopes are best-effort */
  }
  return out;
}

function assertSession(): DebugSession {
  if (!session) throw new Error('no active debug session — call debug_start first');
  return session;
}

/** Continue / step — waits for the next stopped event and reports it. */
export async function debugStep(action: 'continue' | 'next' | 'stepIn' | 'stepOut', evaluate?: string[]): Promise<{ ok: boolean; position?: DebugPosition; variables?: DebugVariable[]; evaluations?: Array<{ expr: string; result: string }>; ended?: boolean; error?: string }> {
  try {
    const s = assertSession();
    const stopped = firstStopped(s.client);
    await s.client.request(action, { threadId: s.threadId });
    const ev = await stopped;
    if (!ev) {
      // ran to completion
      const ended = await debugStop('program finished during stepping');
      return { ok: true, ended: true, ...(ended.evidence ? { } : {}) };
    }
    s.threadId = ev.body?.threadId != null ? Number(ev.body.threadId) : s.threadId;
    const cur = await currentStack(s);
    if (!cur) return { ok: false, error: 'stepped but no stack readable' };

    // evidence trail
    if (s.evidence.stops.length < MAX_EVIDENCE_STOPS) {
      const evaluations: Array<{ expr: string; result: string }> = [];
      if (evaluate?.length) {
        for (const expr of evaluate.slice(0, 8)) {
          const r = await debugEval(expr).catch((e: Error) => ({ ok: false as const, result: e.message }));
          evaluations.push({ expr, result: r.result });
        }
      }
      s.evidence.stops.push({ at: Date.now(), position: cur.position, variables: cur.variables, ...(evaluations.length ? { evaluated: evaluations } : {}) });
    }
    return { ok: true, position: cur.position, variables: cur.variables };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Evaluate an expression in the top frame. */
export async function debugEval(expr: string): Promise<{ ok: boolean; result: string; error?: string }> {
  try {
    const s = assertSession();
    // need the current top frame id
    const st = await s.client.request('stackTrace', { threadId: s.threadId, levels: 1 });
    const frames = (st.body?.stackFrames ?? []) as Array<{ id: number }>;
    if (!frames.length) return { ok: false, result: '', error: 'no stack frame to evaluate in' };
    const res = await s.client.request('evaluate', { expression: String(expr).slice(0, 500), frameId: frames[0].id, context: 'repl' });
    const result = String(res.body?.result ?? '');
    return { ok: true, result: result.slice(0, 500) };
  } catch (err) {
    return { ok: false, result: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Read current position + variables (no stepping). */
export async function debugState(): Promise<{ ok: boolean; position?: DebugPosition; variables?: DebugVariable[]; error?: string }> {
  try {
    const s = assertSession();
    const cur = await currentStack(s);
    if (!cur) return { ok: false, error: 'the program is not paused — it is running or finished. Use debug_step with an action to control it.' };
    return { ok: true, position: cur.position, variables: cur.variables };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Add/replace breakpoints mid-session (best-effort). */
export async function debugSetBreakpoints(bps: DebugBreakpoint[]): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    const s = assertSession();
    const byFile = new Map<string, DebugBreakpoint[]>();
    for (const bp of bps) {
      const list = byFile.get(bp.file) ?? [];
      list.push(bp);
      byFile.set(bp.file, list);
    }
    for (const [file, list] of byFile) {
      try {
        await s.client.request('setBreakpoints', {
          source: { path: file.replace(/\\/g, '/'), name: path.basename(file) },
          breakpoints: list.map((b) => ({ line: b.line, condition: b.condition })),
        });
      } catch (err) {
        errors.push(`${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { ok: errors.length === 0, errors };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

/** End the session and return the root-cause evidence trail. */
export async function debugFinish(outcome = 'finished'): Promise<{ stopped: boolean; evidence: RootCauseEvidence | null }> {
  return debugStop(outcome);
}

/** Summarize evidence for the proof package (bounded). */
export function rootCauseSummary(): string | null {
  const ev = debugEvidence();
  if (!ev || !ev.stops.length) return null;
  const first = ev.stops[0];
  const lines = [
    `ROOT-CAUSE EVIDENCE (debugger, ${ev.adapter}): program ${path.basename(ev.program)}, ${ev.stops.length} stopped state(s) recorded.`,
    `First stop: ${first.position.file}:${first.position.line} in ${first.position.frameName}`,
    ...ev.stops.slice(0, 5).map((s2) => `  • ${path.basename(s2.position.file)}:${s2.position.line} ${s2.variables.slice(0, 4).map((v) => `${v.name}=${v.value}`).join(' ')}`),
  ];
  if (ev.breakErrors.length) lines.push(`Breakpoint issues: ${ev.breakErrors.join('; ')}`);
  return lines.join('\n').slice(0, 1500);
}
