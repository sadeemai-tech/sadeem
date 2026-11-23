// ============================================================
// SADEEM v11.38 — AUTO-PREVIEW (the founder's #1 demand), proven for real.
// ------------------------------------------------------------
// This test does NOT mock the preview. It uses the app's OWN tool executor
// and preview service (one esbuild bundle so they share the SAME module),
// writes a REAL index.html to a REAL temp workspace, and proves:
//   1. preview_open with NO args (the "just show me what you built" call)
//      starts a REAL loopback server on a REAL port;
//   2. it returns a REAL URL that a REAL fetch answers with HTTP 200;
//   3. a preview_open AGENT EVENT is emitted CARRYING that real URL + hint;
//   4. the service emits its honest {kind:'static', state:'ready'} event
//      ONLY after that real HTTP answer (no fabricated "ready");
//   5. a workspace with NO web entry FAILS honestly — no URL, no ready.
//
// Run: node --test --test-force-exit tests/v1138-preview.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1138-preview-'));
const fwd = (p) => p.replace(/\\/g, '/');

// ---- electron stub (the services are CLI-safe but import electron's app) ----
const ud = join(tmp, 'userdata');
mkdirSync(ud, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const UD = ${JSON.stringify(ud)};
   class WC { on() {} async executeJavaScript() { return []; } }
   class BW { constructor() { this.webContents = new WC(); } destroy() {} setBounds() {} getBounds() { return { x: 0, y: 0 }; } }
   module.exports = {
     app: { getPath: () => UD, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
     ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
     Notification: { isSupported: () => false },
     shell: { openExternal: async () => {}, openPath: async () => '' },
     clipboard: { readText: () => '', writeText() {} },
     BrowserWindow: BW,
   };`,
);

// ---- ONE bundle: tools + previewService share the same module instance ----
const entry = join(tmp, 'entry.ts');
writeFileSync(
  entry,
  [
    `export { executeTool } from ${JSON.stringify(fwd(join(ROOT, 'electron/agent/tools.ts')))};`,
    `export { setPreviewEventEmitter, staticStop, devStop, findPreviewEntry, verifyPreviewUrl } from ${JSON.stringify(fwd(join(ROOT, 'electron/services/previewService.ts')))};`,
  ].join('\n'),
);
const out = join(tmp, 'v1138.cjs');
before(() => {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
      '--external:electron',
      '--external:@xterm/xterm', '--external:@xterm/addon-fit',
      '--external:monaco-editor', '--external:@monaco-editor/react',
      '--log-level=silent',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
});
after(() => {
  try { app.devStop(); app.staticStop(); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

let app;
before(() => { app = require(out); });

function ctxFor(ws) {
  return {
    workspace: ws,
    sessionId: 'v1138',
    mcpServers: [],
    emit: () => {},
    approve: async () => true,
    fullAccess: false,
  };
}

test('V1138-1: write index.html → preview_open (no args) → REAL port, REAL URL, HTTP 200, preview_open event with URL', async () => {
  const ws = join(tmp, 'ws-site');
  mkdirSync(ws, { recursive: true });
  const marker = 'V1138-AUTO-PREVIEW-LIVE';
  writeFileSync(join(ws, 'index.html'), `<!doctype html><html><body><h1>${marker}</h1></body></html>`);

  // entry discovery is honest: it finds the just-written index.html
  const entryInfo = await app.findPreviewEntry(ws);
  assert.equal(entryInfo?.kind, 'static', `entry detected: ${JSON.stringify(entryInfo)}`);
  assert.equal(entryInfo.startPath, ws, 'the served root is the workspace that holds index.html');
  assert.equal(entryInfo.label, 'index.html', 'entry label is the just-written index.html');

  const agentEvents = [];
  const serviceEvents = [];
  app.setPreviewEventEmitter((e) => serviceEvents.push(e));
  const ctx = ctxFor(ws);
  ctx.emit = (e) => agentEvents.push(e);

  const res = await app.executeTool('preview_open', '{}', ctx);
  assert.equal(res.ok, true, `preview_open ok: ${res.output}`);

  const opened = agentEvents.find((e) => e.type === 'preview_open' && e.url);
  assert.ok(opened, `a preview_open event WITH a real URL was emitted: ${JSON.stringify(agentEvents)}`);
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d{2,5}/, `real loopback URL: ${opened.url}`);
  assert.equal(opened.ws, ws, 'event is scoped to the built workspace');
  assert.ok(opened.previewHint, 'event carries a hint for the renderer');
  assert.equal(opened.previewHint.kind, 'static');

  // The REAL server answers 200 with the file that was just written.
  const real = await fetch(opened.url);
  assert.equal(real.status, 200, 'a real HTTP GET against the returned URL answered 200');
  assert.match(await real.text(), new RegExp(marker));

  // Honest readiness: the service emitted ready WITH that same URL.
  const ready = serviceEvents.find((e) => e.kind === 'static' && e.state === 'ready' && e.url);
  assert.ok(ready, `service emitted a real ready event: ${JSON.stringify(serviceEvents)}`);
  assert.equal(ready.url, opened.url, 'the ready URL is the URL the agent event carried');
  assert.match(res.output, /HTTP 200/, 'the model is told the verified status, not a guess');

  app.staticStop();
});

test('V1138-2: no web entry → honest failure, NO fabricated URL, NO ready event', async () => {
  const ws = join(tmp, 'ws-empty');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'notes.txt'), 'a pure Q&A workspace, not a site');

  const agentEvents = [];
  const serviceEvents = [];
  app.setPreviewEventEmitter((e) => serviceEvents.push(e));
  const ctx = ctxFor(ws);
  ctx.emit = (e) => agentEvents.push(e);

  const res = await app.executeTool('preview_open', '{}', ctx);
  assert.equal(res.ok, false, `no-entry preview must fail honestly: ${res.output}`);
  assert.match(res.output, /No web entry|no preview was claimed ready/i);
  assert.equal(
    agentEvents.some((e) => e.type === 'preview_open' && e.url),
    false,
    'NO preview_open with a URL was fabricated',
  );
  assert.equal(
    serviceEvents.some((e) => (e.kind === 'static' || e.kind === 'dev') && e.state === 'ready'),
    false,
    'NO ready event was emitted for a workspace with nothing to serve',
  );
});

test('V1138-3: verifyPreviewUrl reports the REAL status and refuses a dead URL', async () => {
  const bad = await app.verifyPreviewUrl('http://127.0.0.1:1/', 400, true);
  assert.equal(bad.ok, false, 'a dead loopback URL is not "ready"');
  assert.equal(bad.status, null);

  const ws = join(tmp, 'ws-verify');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'index.html'), '<!doctype html><title>verify</title><h1>verify</h1>');
  const ctx = ctxFor(ws);
  const opened = [];
  ctx.emit = (e) => opened.push(e);
  const res = await app.executeTool('preview', JSON.stringify({ action: 'static' }), ctx);
  assert.equal(res.ok, true, res.output);
  const event = opened.find((e) => e.type === 'preview_open' && e.url);
  assert.ok(event, 'preview static also emits a real preview_open');
  const v = await app.verifyPreviewUrl(event.url, 1500, true);
  assert.equal(v.ok, true);
  assert.equal(v.status, 200);
  app.staticStop();
});
