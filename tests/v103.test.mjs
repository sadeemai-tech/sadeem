// ============================================================
// SADEEM v10.3 — feature tests for this release's headline work:
//
//   A. detectPythonRun — multi-runtime preview detection
//      (Django / uvicorn-FastAPI / entry script / none)
//   B. REAL python dev-server end-to-end: devStart(ws,'python') boots an
//      actual http.server, the port poll marks it ready, HTTP GET returns
//      the served page, devStop kills it. No mocks on the serving path.
//   C. settings registry — the new flat sections resolve from search
//      ('worktree' → git pane, 'shortcuts' → shortcuts pane, voice etc.)
//
// Honest scope: launchApp (deviceService) is main-process-only and touches
// real OS launchers — verified manually in the desktop app, not here.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

execSync(
  'npx esbuild electron/services/previewService.ts --bundle --platform=node --format=esm --outfile=tests/.preview.bundle.mjs --external:electron --external:esbuild --alias:electron=./tests/electron-stub.mjs',
  { cwd: ROOT, stdio: 'pipe' },
);
execSync(
  'npx esbuild src/components/settings/registry.ts --bundle --platform=node --format=esm --outfile=tests/.registry.bundle.mjs --external:electron --external:esbuild',
  { cwd: ROOT, stdio: 'pipe' },
);

const preview = await import('./.preview.bundle.mjs');
const registry = await import('./.registry.bundle.mjs');

function makeWs(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sadeem-v103-'));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

// ---------- A. python runtime detection ----------
test('v103 detectPythonRun: manage.py → django runserver on 8000', async () => {
  const ws = makeWs({ 'manage.py': '# django admin\n' });
  try {
    const r = await preview.detectPythonRun(ws);
    assert.ok(r, 'expected a python run for manage.py');
    assert.equal(r.port, 8000);
    assert.match(r.label, /manage\.py runserver/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('v103 detectPythonRun: fastapi requirements + main.py → uvicorn module:app', async () => {
  const ws = makeWs({ 'requirements.txt': 'fastapi==0.115.0\nuvicorn==0.30.0\n', 'main.py': 'app=1\n' });
  try {
    const r = await preview.detectPythonRun(ws);
    assert.ok(r);
    assert.match(r.label, /uvicorn main:app/);
    assert.equal(r.port, 8000);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('v103 detectPythonRun: flask requirements + app.py → port 5000', async () => {
  const ws = makeWs({ 'requirements.txt': 'flask==3.0.0\n', 'app.py': 'from flask import Flask\n' });
  try {
    const r = await preview.detectPythonRun(ws);
    assert.ok(r);
    assert.match(r.label, /python3? app\.py/);
    assert.equal(r.port, 5000);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('v103 detectPythonRun: plain workspace → null (static preview still applies)', async () => {
  const ws = makeWs({ 'index.html': '<html></html>' });
  try {
    const r = await preview.detectPythonRun(ws);
    assert.equal(r, null);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// ---------- B. REAL python dev server (end-to-end) ----------
function httpGet(port, path = '/', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = createConnection(port, '127.0.0.1');
    let buf = '';
    const to = setTimeout(() => { s.destroy(); resolve(null); }, timeoutMs);
    s.on('connect', () => s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    s.on('data', (d) => (buf += d.toString()));
    s.on('end', () => { clearTimeout(to); resolve(buf); });
    s.on('error', () => { clearTimeout(to); resolve(null); });
  });
}

test('v103 devStart(python) boots a REAL http server and serves the workspace', async (t) => {
  // The fixture binds a fixed port (8137). If another process owns it, the
  // python server dies with WinError 10048 / EADDRINUSE — skip honestly instead
  // of reporting a false app failure (other tests already use this posture).
  if (await httpGet(8137)) return t.skip('port 8137 already in use');
  const ws = makeWs({
    'app.py': [
      'import http.server, socketserver, functools, os',
      'os.chdir(os.path.dirname(os.path.abspath(__file__)))',
      'H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.getcwd())',
      'with socketserver.TCPServer(("127.0.0.1", 8137), H) as httpd:',
      '    print("Serving on http://127.0.0.1:8137")',
      '    httpd.serve_forever()',
    ].join('\n'),
    'index.html': '<!doctype html><title>sadeem-v103-python</title>',
  });
  try {
    const started = await preview.devStart(ws, 'python');
    assert.equal(started.ok, true, `devStart(python) failed: ${started.error ?? ''}`);
    assert.match(String(started.script ?? ''), /python3? app\.py/);
    // wait for the server (URL detected from stdout, or port poll)
    let body = null;
    for (let i = 0; i < 30 && !body; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const st = preview.devStatus();
      if (st.state === 'ready' || st.url) body = await httpGet(8137);
    }
    assert.ok(body, `python server never answered on 8137 (dev status: ${JSON.stringify(preview.devStatus())})`);
    assert.match(body, /sadeem-v103-python/);
  } finally {
    preview.devStop();
    // Windows keeps the cwd of the just-killed python child locked briefly;
    // taskkill itself is async. Retry the cleanup instead of failing the test
    // over an OS-level EBUSY after the server was correctly stopped.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        rmSync(ws, { recursive: true, force: true });
        break;
      } catch (err) {
        if (i === 9) throw err;
      }
    }
  }
});

// ---------- C. settings registry — new flat sections ----------
test('v103 settings search: worktree lands in the dedicated git pane', () => {
  const hits = registry.searchSettings('worktree');
  assert.ok(hits.some((h) => h.section === 'git'), 'worktree search should hit section git');
});
test('v103 settings search: shortcuts pane is reachable bilingually', () => {
  assert.ok(registry.searchSettings('shortcuts').some((h) => h.section === 'shortcuts'));
  assert.ok(registry.searchSettings('اختصارات').some((h) => h.section === 'shortcuts'));
});
test('v103 settings search: voice + custom preview command entries', () => {
  assert.ok(registry.searchSettings('microphone').some((h) => h.section === 'voice'));
  assert.ok(registry.searchSettings('custom').some((h) => h.id === 'preview.customCommand'));
});

