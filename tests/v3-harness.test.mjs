import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// Surnia v3.0.0 — capability harness verification (offline, no LLM)
// Covers the v3 powers:
//   - new tool defs: run_background / process_output / stop_process /
//     preview_screenshot (+ task background param)
//   - background process lifecycle (start → read → URL harvest → stop)
//   - projects are built from scratch (no template catalog in the tool registry)
//   - Stack-Matching system prompt (the HTML-only default is GONE)
//   - theme token sync (styles.css ↔ THEME_META — drift guard)
// Run: node --test tests/v3-harness.test.mjs   (requires `npm i` first)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v3-'));

// ---------- esbuild bundle (same posture as v2-verify.mjs) ----------
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
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub for plain-Node execution
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(join(tmp, 'ud'))}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
   function Notification() { this.show = () => {}; this.on = () => {}; }
   Notification.isSupported = () => false;
   class StubWebContents {
     on() {}
     setWindowOpenHandler() {}
     async loadURL() {}
     async executeJavaScript() { return []; }
     async capturePage() { return { toPNG: () => Buffer.alloc(10), getSize: () => ({ width: 1, height: 1 }) }; }
   }
   class StubBrowserWindow {
     constructor() { this.webContents = new StubWebContents(); }
     destroy() {}
     setBounds() {}
     getBounds() { return { x: 0, y: 0 }; }
   }
   module.exports = {
     app: { getPath: (k) => paths[k] ?? paths.userData, setName() {}, setPath() {}, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
     ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
     Notification,
     shell: { openExternal: async () => {}, openPath: async () => '' },
     clipboard: { readText: () => '', writeText() {}, readImage: () => null },
     WebContents: class {},
     BrowserWindow: StubBrowserWindow,
   };`,
);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

const procPath = join(tmp, 'process.cjs');
bundle('electron/services/processService.ts', procPath);
const bgProc = require(procPath);

const promptsPath = join(tmp, 'prompts.cjs');
bundle('electron/agent/prompts.ts', promptsPath);
const { buildSystemPrompt } = require(promptsPath);

// ---------- stub ToolContext ----------
function stubCtx(ws, opts = {}) {
  return {
    workspace: ws,
    sessionId: 'test-session',
    mcpServers: [],
    emit: () => {},
    approve: async () => true,
    denyHint: opts.denyHint,
    fullAccess: !!opts.fullAccess,
  };
}

test('v3 tool defs are registered with the right required params', () => {
  const defs = tools.getToolDefs([]);
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
  for (const name of ['run_background', 'process_output', 'stop_process', 'preview_screenshot']) {
    assert.ok(byName[name], `${name} def missing`);
  }
  assert.deepEqual(byName.run_background.parameters.required, ['command']);
  assert.deepEqual(byName.process_output.parameters.required, ['id']);
  assert.deepEqual(byName.stop_process.parameters.required, ['id']);
  assert.deepEqual(byName.preview_screenshot.parameters.required, []);
  // task tool gained background:true
  const taskProps = byName.task.parameters.properties;
  assert.equal(taskProps.background.type, 'boolean');
  // search_web documents the alias
  assert.match(byName.search_web.description, /Alias of web_search/);
});

test('background process lifecycle: start → read → URL harvest → stop', async () => {
  bgProc.setProcessLogsDir(join(tmp, 'proc-logs'));
  const ws = join(tmp, 'ws-proc');
  mkdirSync(ws, { recursive: true });
  const res = bgProc.start(
    `node -e "console.log('BG-HELLO'); console.log('Local: http://localhost:5199/ ready'); setInterval(()=>{},200)"`,
    ws,
  );
  assert.equal(res.ok, true, 'start should succeed');
  assert.ok(res.id, 'got a process id');

  // poll until the marker line arrives
  let seen = '';
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const st = bgProc.read(res.id, 4000);
    seen = st ? st.output : '';
    if (seen.includes('BG-HELLO')) break;
  }
  assert.ok(seen.includes('BG-HELLO'), 'process output was captured');

  const st = bgProc.tail(res.id, 4000);
  assert.ok(st.urls.some((u) => u.startsWith('http://localhost:5199')), 'localhost URL harvested');

  const stopped = bgProc.stop(res.id);
  assert.equal(stopped.ok, true);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const after = bgProc.tail(res.id, 500);
    if (after && !after.running) break;
  }
  const after = bgProc.tail(res.id, 500);
  assert.equal(after.running, false, 'process stopped');

  assert.equal(bgProc.read('bg-nonexistent'), null, 'unknown id → null');
  bgProc.disposeAll();
});

test('Stack-Matching protocol: the one-file-HTML default is gone', () => {
  const ws = join(tmp, 'ws-prompt');
  mkdirSync(ws, { recursive: true });
  const prompt = buildSystemPrompt({ workspace: ws, mode: 'default', platform: 'linux' });
  assert.ok(prompt.includes('# Stack selection & build protocol'), 'new protocol section present');
  assert.ok(prompt.includes('from scratch'), 'prompt requires creating projects from scratch');
  assert.ok(prompt.includes('run_background'), 'prompt mentions run_background');
  assert.ok(prompt.includes('preview_screenshot'), 'prompt mentions preview_screenshot');
  assert.ok(prompt.includes('LITERALLY ANYTHING'), 'capability contract upgraded');
  assert.ok(!prompt.includes('DEFAULT SHAPE'), 'HTML-only default removed');
  assert.ok(!prompt.includes('react-vite'), 'no pre-built template catalog in the prompt');
});

test('theme token sync: styles.css ↔ THEME_META (drift guard)', () => {
  const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
  const metaSrc = readFileSync(join(ROOT, 'src', 'components', 'themeMeta.ts'), 'utf8');
  for (const theme of ['obsidian', 'midnight', 'light']) {
    const raw = css.split(`html[data-theme='${theme}']`)[1] ?? '';
    const block = raw.split('html[data-')[0]; // stop at the next selector block
    const bg = /--bg0:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
    const acc = /\n  --acc:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
    assert.ok(bg && acc, `${theme}: tokens found in styles.css`);
    const metaBlock = (new RegExp(`${theme}: \\{[\\s\\S]*?\\n  \\}`).exec(metaSrc) ?? [''])[0];
    assert.ok(metaBlock, `${theme}: block found in THEME_META`);
    assert.ok(metaBlock.includes(`'${bg}'`), `${theme}: bg0 ${bg} mirrored in THEME_META`);
    assert.ok(metaBlock.includes(`'${acc}'`), `${theme}: acc ${acc} mirrored in THEME_META`);
  }
  // --bg2 must have exactly ONE definition per theme block (the alias)
  for (const theme of ['obsidian', 'midnight', 'light']) {
    const raw = css.split(`html[data-theme='${theme}']`)[1] ?? '';
    const block = raw.split('html[data-')[0];
    const count = (block.match(/--bg2:/g) ?? []).length;
    assert.equal(count, 1, `${theme}: --bg2 defined exactly once (was a duplicated dead literal)`);
  }
});

test('cleanup', () => {
  bgProc.disposeAll();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
