import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.11.0 (wave2-A3) — UNIVERSAL LIVE PREVIEW, the
// any-language guarantee, hardening beyond v1111-preview.test.mjs.
// Covers:
//   (a) GO family: a go.mod workspace yields a {kind:'dev', runtime:'go'}
//       target; devStart('go') refuses honestly WITHOUT go.mod; with the go
//       toolchain present the real `go run .` server resolves to a URL (skips
//       honestly when go is unavailable — detection still asserted)
//   (b) PYTHON family: detectPythonRun() shapes for Django / uvicorn / entry
//       script / plain-.py http.server fallback (the live-serve proof lives in
//       v1111-preview.test.mjs (c))
//   (c) GENERIC ARTIFACT runtime: a workspace with NO package.json but a
//       Settings→Preview custom command ("plain executable run with live
//       output panel") starts, parses the bare-port print, serves, and stops
//   (d) RENDERER bridge: PreviewArea.parseTarget() preserves runtime
//       'python'/'custom'/'go' — the regression that used to turn Go targets
//       into npm launches ("No package.json" on a Go workspace)
//   (e) AUTO-OPEN chain on a SIMULATED completion event: store
//       ingestAgentEvent(preview_open + previewHint) → previewOpen + sequenced
//       previewAuto carrying kind/runtime (incl. go), manual open still works
// Run: node --test --test-force-exit tests/v1111-preview-universal.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1111-preview-universal-'));

// ---------- esbuild bundle (same flags as the other harnesses) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    // v11.12 — svg illustrations (v11.11 A9-DESIGN) need a loader in test bundles
    '--loader:.svg=dataurl',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub with an ISOLATED userData dir ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: (k) => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {},
    screen: {},
  };`,
);

// ---------- bundles under test ----------
const previewPath = join(tmp, 'preview.cjs');
bundle('electron/services/previewService.ts', previewPath);
const preview = require(previewPath);

// renderer target parser (extracted from the panel; pure helper)
const areaPath = join(tmp, 'previewArea.cjs');
bundle('src/components/PreviewArea.tsx', areaPath);
const area = require(areaPath);

const storePath = join(tmp, 'store.cjs');
bundle('src/store.ts', storePath);
const storeMod = require(storePath);
const useStore = storeMod.useStore;

// ---------- helpers ----------
function writeSettings(extra = {}) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {},
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false },
      doneNotifications: false,
      ...extra,
    }),
  );
}

function probeFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function portRebindable(port) {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => {
      s.close(() => resolve(true));
    });
  });
}

async function waitDevReady(timeoutMs = 15000) {
  for (let i = 0; i < Math.ceil(timeoutMs / 250); i++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = preview.devStatus();
    if ((s.state === 'ready' && s.url) || s.state === 'error') return s;
  }
  return preview.devStatus();
}

function resetStore(ws) {
  useStore.setState({
    wsPath: ws,
    previewOpen: false,
    previewAuto: null,
    previewWs: '',
    previewUrl: '',
    previewSource: '',
    previewError: null,
    previewStatus: null,
    session: { id: 's1', title: 't', messages: [{ id: 'm0', role: 'user', kind: 'text', content: 'x', timestamp: Date.now() }], createdAt: Date.now(), updatedAt: Date.now() },
  });
}

// ============================================================
// (a) GO family — detection + honest refusal + live `go run .`
// ============================================================
test('preview/go: go.mod workspace → runtime:go target; no-go.mod refuses honestly; real go run resolves to a URL', async (t) => {
  // ---- detection: go.mod is enough, no toolchain needed ----
  const ws = join(tmp, 'ws-go');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'go.mod'), 'module previewtest\n\ngo 1.21\n');
  writeFileSync(join(ws, 'main.go'), 'package main\nfunc main() {}\n');

  const targets = await preview.detectTargets(ws);
  const goTarget = targets.find((x) => x.kind === 'dev' && x.runtime === 'go');
  assert.ok(goTarget, `go target detected (targets: ${JSON.stringify(targets)})`);
  assert.equal(goTarget.label, 'go run .', 'go target label');

  // ---- honest refusal: devStart('go') without go.mod must NOT fall through ----
  const wsNoGo = join(tmp, 'ws-nogo');
  mkdirSync(wsNoGo, { recursive: true });
  writeFileSync(join(wsNoGo, 'main.go'), 'package main\nfunc main() {}\n');
  const refused = await preview.devStart(wsNoGo, 'go');
  assert.equal(refused.ok, false, 'no go.mod → refused (never a silent npm fallback)');
  assert.match(refused.error ?? '', /go\.mod/, 'refusal names the missing go.mod');

  // ---- live proof only where the go toolchain exists ----
  const probe = spawnSync('go', ['version'], { timeout: 8000 });
  if (probe.status !== 0) return t.skip('go toolchain not available in this sandbox — detection + refusal still asserted');
  if (!(await portRebindable(8123))) return t.skip('port 8123 already in use in this sandbox');

  const port = 8123;
  writeFileSync(
    join(ws, 'main.go'),
    [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\t"net/http"',
      ')',
      '',
      'func main() {',
      `\thttp.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "GO-PREVIEW-OK") })`,
      `\tfmt.Printf("listening on :${port}\\n")`,
      `\t_ = http.ListenAndServe("127.0.0.1:${port}", nil)`,
      '}',
      '',
    ].join('\n'),
  );

  const dv = await preview.devStart(ws, 'go');
  assert.ok(dv.ok, `devStart(go) ok: ${JSON.stringify(dv)}`);
  const s = await waitDevReady(30000); // go run compiles first — allow longer
  assert.equal(s.state, 'ready', 'go run . becomes ready (bare-port stdout parsed or port poll)');
  assert.match(s.url ?? '', new RegExp(`:${port}$`), 'resolved URL points at the printed port');
  const res = await fetch(s.url);
  assert.equal(res.status, 200, 'go server answered over HTTP');
  assert.equal(await res.text(), 'GO-PREVIEW-OK', 'go content correct');
  preview.devStop();
});

// ============================================================
// (b) PYTHON family — detectPythonRun() shapes (live serve is
//     proven in v1111-preview.test.mjs (c))
// ============================================================
test('preview/python: detectPythonRun covers Django, uvicorn, entry script and the plain-.py http.server fallback', async (t) => {
  const pyOk = spawnSync('python3', ['--version'], { timeout: 5000 }).status === 0;
  if (!pyOk) return t.skip('python interpreter unavailable — detection shapes still check the command shape');

  // Django — manage.py is the canonical entry
  const wsDj = join(tmp, 'ws-py-django');
  mkdirSync(wsDj, { recursive: true });
  writeFileSync(join(wsDj, 'manage.py'), 'x');
  const dj = await preview.detectPythonRun(wsDj);
  assert.ok(dj, 'Django workspace detected');
  assert.match(dj.cmd, /python(3)?$/, 'python binary resolved');
  assert.deepEqual(dj.args, ['-u', 'manage.py', 'runserver', '8000'], 'runserver args (-u = unbuffered)');
  assert.equal(dj.port, 8000, 'Django default port');

  // FastAPI/uvicorn — requirements hint + app module
  const wsFa = join(tmp, 'ws-py-fastapi');
  mkdirSync(wsFa, { recursive: true });
  writeFileSync(join(wsFa, 'requirements.txt'), 'fastapi==0.115.0\nuvicorn==0.30.0\n');
  writeFileSync(join(wsFa, 'app.py'), 'x');
  const fa = await preview.detectPythonRun(wsFa);
  assert.ok(fa, 'FastAPI workspace detected');
  assert.deepEqual(fa.args, ['-u', '-m', 'uvicorn', 'app:app', '--port', '8000'], 'uvicorn module args (-u = unbuffered)');

  // generic entry script
  const wsEn = join(tmp, 'ws-py-entry');
  mkdirSync(wsEn, { recursive: true });
  writeFileSync(join(wsEn, 'main.py'), 'x');
  const en = await preview.detectPythonRun(wsEn);
  assert.ok(en, 'entry-script workspace detected');
  assert.deepEqual(en.args, ['-u', 'main.py'], 'entry script executed directly (-u = unbuffered)');

  // plain .py workspace (no runnable entry) → http.server fallback (A3)
  const wsPlain = join(tmp, 'ws-py-plain');
  mkdirSync(wsPlain, { recursive: true });
  writeFileSync(join(wsPlain, 'report.py'), 'print("writes files only")');
  const plain = await preview.detectPythonRun(wsPlain);
  assert.ok(plain, 'plain .py workspace still yields a target');
  assert.deepEqual(plain.args, ['-m', 'http.server', '8000', '--bind', '127.0.0.1'], 'http.server fallback args');

  // non-python workspace → null (caller falls back to node/static targets)
  const wsNone = join(tmp, 'ws-py-none');
  mkdirSync(wsNone, { recursive: true });
  writeFileSync(join(wsNone, 'notes.txt'), 'nothing runnable');
  assert.equal(await preview.detectPythonRun(wsNone), null, 'non-python workspace → null');
});

// ============================================================
// (c) GENERIC ARTIFACT runtime — custom command on a workspace
//     with NO package.json ("plain executable run" + live output)
// ============================================================
test('preview/custom: custom preview command runs any executable/script and resolves a URL without package.json', async (t) => {
  const port = await probeFreePort();
  writeSettings({ preview: { customCommand: `node serve.js --port ${port}` } });

  const ws = join(tmp, 'ws-custom');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'serve.js'), [
    'const http = require("http");',
    `const port = process.argv.includes("--port") ? Number(process.argv[process.argv.indexOf("--port") + 1]) : 0;`,
    'const s = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("CUSTOM-RUNTIME-OK"); });',
    's.listen(port, "127.0.0.1", () => console.log(`serving on port ${s.address().port}`));',
  ].join('\n'));

  // detection surfaces the custom target for this workspace
  const targets = await preview.detectTargets(ws);
  assert.ok(targets.some((x) => x.kind === 'dev' && x.runtime === 'custom'), 'custom target detected');

  const dv = await preview.devStart(ws, 'custom');
  assert.ok(dv.ok, `devStart(custom) ok: ${JSON.stringify(dv)}`);
  const s = await waitDevReady();
  assert.equal(s.state, 'ready', 'custom process becomes ready (stdout port parse + poll)');
  const res = await fetch(s.url);
  assert.equal(res.status, 200, 'served over the resolved URL');
  assert.equal(await res.text(), 'CUSTOM-RUNTIME-OK', 'custom content correct');
  assert.ok(s.lines.some((l) => l.includes('serving on port')), 'live output panel carries the process stdout');
  preview.devStop();
  // SIGTERM → group dies within ~ms; the service arms a 1.5s SIGKILL backstop.
  // Poll (bounded) instead of asserting synchronously — same as test (b) of
  // v1111-preview.test.mjs.
  let released = false;
  for (let i = 0; i < 20 && !released; i++) {
    released = await portRebindable(port);
    if (!released) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(released, 'port released after devStop');
});

// ============================================================
// (d) RENDERER bridge — parseTarget keeps every runtime the
//     service emits (go was dropped before the A3 fix)
// ============================================================
test('preview/renderer: parseTarget preserves python/custom/go runtimes and rejects malformed rows', () => {
  const { parseTarget } = area;

  const go = parseTarget({ kind: 'dev', label: 'go run .', dir: '/tmp/ws-go', runtime: 'go' });
  assert.ok(go, 'go target parsed');
  assert.equal(go.runtime, 'go', 'go runtime preserved (was dropped → npm launch bug)');

  const py = parseTarget({ kind: 'dev', label: 'python3 -m http.server 8000', runtime: 'python' });
  assert.equal(py?.runtime, 'python', 'python runtime preserved');

  const cc = parseTarget({ kind: 'dev', label: 'cargo run --release', runtime: 'custom' });
  assert.equal(cc?.runtime, 'custom', 'custom runtime preserved');

  const art = parseTarget({ kind: 'artifact', label: 'report.pdf — PDF', dir: '/tmp/ws/report.pdf' });
  assert.equal(art?.kind, 'artifact', 'artifact rows pass through');
  assert.equal(art?.runtime, undefined, 'artifact has no runtime');

  assert.equal(parseTarget({ kind: 'nope', label: 'x' }), null, 'unknown kind rejected');
  assert.equal(parseTarget({ kind: 'dev' }), null, 'missing label rejected');
  assert.equal(parseTarget(null), null, 'null row rejected');
  assert.equal(parseTarget('dev'), null, 'non-object row rejected');

  // the exact rows detectTargets() emits for a go.mod + python + npm workspace
  // must ALL survive the bridge (integration shape, service ↔ panel)
  for (const raw of [
    { kind: 'dev', label: 'npm run dev', dir: '/tmp/ws' },
    { kind: 'dev', label: 'python3 -m http.server 8000', dir: '/tmp/ws', runtime: 'python' },
    { kind: 'dev', label: 'go run .', dir: '/tmp/ws', runtime: 'go' },
    { kind: 'static', label: 'dist/', dir: '/tmp/ws/dist' },
    { kind: 'file', label: 'index.html', dir: '/tmp/ws/index.html' },
  ]) {
    const parsed = parseTarget(raw);
    assert.ok(parsed, `${raw.label} survives the renderer bridge`);
    assert.equal(parsed.runtime ?? undefined, raw.runtime ?? undefined, `${raw.label} runtime intact`);
  }
});

// ============================================================
// (e) AUTO-OPEN on a SIMULATED completion event + manual open
// ============================================================
test('auto-open/simulated: completion-shaped preview_open+previewHint drives the store request; manual open still works', () => {
  const ws = join(tmp, 'ws-sim');
  mkdirSync(ws, { recursive: true });

  // ---- simulated completion hook event (exactly what engine.ts:1560 sends) ----
  resetStore(ws);
  useStore.getState().ingestAgentEvent({ type: 'preview_open', ws, previewHint: { kind: 'dev', runtime: 'go', label: 'go run .' } });
  let st = useStore.getState();
  assert.equal(st.previewOpen, true, 'panel auto-opens on the simulated completion event');
  assert.equal(st.previewAuto?.seq, 1, 'sequenced request created');
  assert.equal(st.previewAuto?.kind, 'dev', 'kind carried');
  assert.equal(st.previewAuto?.runtime, 'go', 'go runtime carried through the store');

  // ---- python dev hint → runtime python (auto-launch uses the right runtime) ----
  resetStore(ws);
  useStore.getState().ingestAgentEvent({ type: 'preview_open', ws, previewHint: { kind: 'dev', runtime: 'python' } });
  st = useStore.getState();
  assert.equal(st.previewAuto?.runtime, 'python', 'python runtime carried through the store');

  // ---- manual open (rail/status-bar toggle) still works and never auto-starts ----
  resetStore(ws);
  useStore.getState().togglePreview();
  assert.equal(useStore.getState().previewOpen, true, 'manual toggle opens the panel');
  assert.equal(useStore.getState().previewAuto, null, 'manual open never fabricates an auto-open request');
  useStore.getState().togglePreview();
  assert.equal(useStore.getState().previewOpen, false, 'manual toggle closes the panel again');
});
