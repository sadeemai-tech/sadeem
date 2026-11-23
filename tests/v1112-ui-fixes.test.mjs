import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.12 UI fixes — headless regression checks for the six concrete bugs:
//  1. Live Preview: toggling reveals a real status + surfaces errors
//  2. Terminal: toggle opens the strip immediately (PTY create is async)
//  3. Focus mode: html[data-focus] + chat fills the single flex slot
//  4. Task-mode strip: active chip has accent fill + check + aria
//  5. Settings icon: Settings2 (not the malformed hand-drawn gear)
//  6. Slash: /goal sets the banner, /plan switches TASK mode, /compact runs
//     a real compaction turn — all with visible feedback.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1112-ui-'));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
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
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

// ---- mock window.surnia bridge (installed BEFORE the store bundle loads) ----
const calls = [];
let termCreateResolve = null;
const bridge = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        calls.push({ key, args });
        switch (key) {
          case 'previewStatus':
            return Promise.resolve({ dev: { running: false, state: 'idle', lines: [] }, static: { running: false }, ports: [] });
          case 'previewStaticStart':
            return Promise.resolve({ ok: false, error: 'boom-static' });
          case 'termCreate':
            return new Promise((resolve) => {
              termCreateResolve = resolve;
            });
          default:
            return Promise.resolve(undefined);
        }
      };
    },
  },
);
globalThis.window = { surnia: bridge };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const storePath = join(tmp, 'store.cjs');
bundle('src/store.ts', storePath);
const useStore = require(storePath).useStore;

function seed(extra = {}) {
  const ws = join(tmp, 'ws');
  const prev = useStore.getState();
  useStore.setState({
    wsPath: ws,
    session: {
      id: 's1',
      title: 't',
      workspace: ws,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    },
    settings: {
      ...prev.settings,
      language: 'en',
      model: { provider: 'custom', model: 'm' },
      providers: { ...(prev.settings.providers ?? {}), custom: { apiKey: 'k', baseUrl: 'http://127.0.0.1:1' } },
    },
    taskMode: 'build',
    previewOpen: false,
    previewError: null,
    previewStatus: null,
    previewUrl: '',
    activeGoal: null,
    running: false,
    terminalOpen: false,
    terminalId: null,
    ...extra,
  });
}

const had = (key, predicate = () => true) => calls.some((c) => c.key === key && predicate(c.args));
const resetCalls = () => (calls.length = 0);

// ------------------------------------------------------------
// BUG 1 — preview toggle + status + errors
// ------------------------------------------------------------
test('BUG1: togglePreview opens the surface and polls a real status (not a silent no-op)', () => {
  seed({ previewOpen: false });
  resetCalls();
  useStore.getState().togglePreview();
  assert.equal(useStore.getState().previewOpen, true, 'preview surface revealed');
  assert.ok(had('previewStatus'), 'refreshPreviewStatus() polled the backend on open');
  useStore.getState().togglePreview();
  assert.equal(useStore.getState().previewOpen, false, 'second toggle closes it');
});

test('BUG1: opening without a workspace surfaces the noWorkspace error card', () => {
  seed({ wsPath: '', previewOpen: false, previewError: null });
  useStore.getState().togglePreview();
  assert.deepEqual(useStore.getState().previewError, { reason: 'noWorkspace' });
});

test('BUG1: a failed static start surfaces its concrete reason + detail', async () => {
  seed();
  resetCalls();
  await useStore.getState().startStaticPreview();
  const err = useStore.getState().previewError;
  assert.equal(err?.reason, 'startFailed');
  // v11.23 — raw server output ('boom-static') must NOT be forwarded to the UI.
  // B5 localizes it: with no machine token the detail is intentionally empty
  // and the card body carries the localized WHY + next step (single surface).
  assert.notEqual(err?.detail, 'boom-static', 'raw server error is not leaked');
  assert.ok(typeof err?.detail === 'string', 'detail is a string (possibly empty by design)');
});

test('BUG1: preview error events + dev status feed a visible error card', () => {
  const storeSrc = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');
  const previewSrc = readFileSync(join(ROOT, 'src', 'components', 'PreviewArea.tsx'), 'utf8');
  // v11.23 — the event→card path now includes localization in between, so the
  // old tight 200-char window between the two anchors no longer applies.
  assert.match(storeSrc, /api\.onPreviewEvent\(\(e\) => \{[\s\S]{0,400}e\.state === 'error'[\s\S]{0,600}previewError/, 'bridge error events set previewError');
  assert.match(previewSrc, /shownError =[\s\S]{0,220}dev\?\.state === 'error'/, 'dev server error state surfaced in the card');
  assert.match(previewSrc, /role="status"[\s\S]{0,200}stateText/, 'a live loading/ready/error status pill is rendered');
});

// ------------------------------------------------------------
// BUG 2 — terminal opens immediately, PTY create de-duplicated
// ------------------------------------------------------------
test('BUG2: toggleTerminal opens the strip synchronously even while termCreate is pending', async () => {
  seed();
  resetCalls();
  const p = useStore.getState().toggleTerminal(); // NOT awaited — UI must react now
  assert.equal(useStore.getState().terminalOpen, true, 'strip opens on the same tick as the click');
  assert.ok(had('termCreate'), 'PTY creation requested');
  assert.ok(termCreateResolve, 'deferred PTY promise is pending');
  termCreateResolve('term-1');
  await p;
  assert.equal(useStore.getState().terminalId, 'term-1', 'session id lands asynchronously');

  // second toggle closes; re-open does not create a second PTY (id already set)
  await useStore.getState().toggleTerminal();
  assert.equal(useStore.getState().terminalOpen, false);
  resetCalls();
  await useStore.getState().toggleTerminal();
  assert.equal(useStore.getState().terminalOpen, true);
  assert.equal(had('termCreate'), false, 'existing terminalId reused — no duplicate PTY');
});

// ------------------------------------------------------------
// BUG 3 — focus mode layout contract (source-level, DOM-free)
// ------------------------------------------------------------
test('BUG3: focus flag is mirrored to <html> and the chat fills the single slot', () => {
  const app = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8');
  const shell = readFileSync(join(ROOT, 'src', 'components', 'shell.css'), 'utf8');
  assert.match(app, /document\.documentElement\.dataset\.focus = focusMode \? 'on' : ''/, 'html[data-focus] is written');
  assert.match(app, /data-focus=\{focusMode \? 'on' : undefined\}/, 'Esc-exit still drives the same flag');
  assert.match(shell, /html\[data-focus='on'\] \.app-main-row-v12 > \.chat-slot-v12 \{[^}]*flex: 1 1 auto !important/s, 'chat slot becomes the only flex item');
  assert.match(shell, /html\[data-focus='on'\] \.app-main-row-v12 > \.work-slot-v12 \{ display: none !important; \}/, 'no leftover work strip');
});

// ------------------------------------------------------------
// BUG 4 — task-mode active state
// ------------------------------------------------------------
test('BUG4: setTaskMode updates store.taskMode + posts a visible mode notice', () => {
  seed();
  useStore.getState().setTaskMode('plan');
  assert.equal(useStore.getState().taskMode, 'plan', 'strip reads this slice');
  assert.ok(
    useStore.getState().session.messages.some((m) => m.noticeKind === 'mode' && /PLAN mode/.test(m.content)),
    'visible bilingual notice row',
  );
  assert.ok(had('agentTaskMode', (a) => a[1] === 'plan'), 'engine notified of the task-mode switch');
});

test('BUG4: active chip carries check glyph + accent-fill CSS + aria (source check)', () => {
  const composer = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
  const css = readFileSync(join(ROOT, 'src', 'components', 'console.css'), 'utf8');
  assert.match(composer, /taskMode === m && <Check[^>]*className="tm-check shrink-0"/, 'active mode renders a check');
  assert.match(composer, /aria-selected=\{taskMode === m\}/, 'aria-selected reflects active mode');
  assert.match(composer, /aria-pressed=\{taskMode === m\}/, 'aria-pressed reflects active mode');
  assert.match(css, /composer-modes-v13 button\.is-active \{[^}]*color-mix\(in srgb, var\(--acc\) 20%/s, 'accent fill on active chip');
});

// ------------------------------------------------------------
// BUG 5 — settings icon shape
// ------------------------------------------------------------
test('BUG5: rail/titlebar/palette settings buttons use Settings2, not the old gear', () => {
  const rail = readFileSync(join(ROOT, 'src', 'components', 'Rail.tsx'), 'utf8');
  const title = readFileSync(join(ROOT, 'src', 'components', 'TitleBar.tsx'), 'utf8');
  const palette = readFileSync(join(ROOT, 'src', 'components', 'CommandPalette.tsx'), 'utf8');
  assert.match(rail, /Settings2/, 'rail imports Settings2');
  assert.doesNotMatch(rail, /<IcSettings/, 'rail no longer renders the malformed gear');
  assert.match(title, /<Settings2 size=\{15\}/, 'titlebar uses Settings2');
  assert.match(palette, /icon: Settings2,[\s\S]{0,80}Open settings/, 'palette open-settings uses Settings2');
});

// ------------------------------------------------------------
// BUG 6 — /goal, /plan, /compact
// ------------------------------------------------------------
test('BUG6: /goal sets the tracked goal + banner + visible confirmation', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/goal ship the feature');
  assert.equal(useStore.getState().activeGoal?.goal, 'ship the feature', 'goal banner slice populated');
  assert.ok(had('goalSet', (a) => a[1] === 'ship the feature'), 'IPC persisted the goal');
  assert.ok(
    useStore.getState().session.messages.some((m) => /Goal set/.test(m.content)),
    'visible transcript confirmation',
  );
  // bare /goal reports the active goal instead of clearing it
  const before = useStore.getState().session.messages.length;
  await useStore.getState().sendMessage('/goal');
  assert.equal(useStore.getState().activeGoal?.goal, 'ship the feature');
  assert.ok(useStore.getState().session.messages.length > before, 'report row appended');
});

test('BUG6: /plan switches TASK mode (strip + engine) with a visible notice', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/plan');
  assert.equal(useStore.getState().taskMode, 'plan', 'task mode — not just the permission radiogroup');
  assert.equal(useStore.getState().settings.permissionMode, 'plan', 'permission posture kept in sync');
  assert.ok(
    useStore.getState().session.messages.some((m) => m.noticeKind === 'mode' && /PLAN mode/.test(m.content)),
    'visible notice',
  );
});

test('BUG6: /compact runs a real compaction turn with immediate feedback', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/compact');
  assert.ok(had('agentRun', (a) => a[0]?.task === 'compact'), 'engine invoked with task=compact');
  assert.ok(
    useStore.getState().session.messages.some((m) => /Compacting context/.test(m.content)),
    'visible feedback row',
  );
  // stop the watchdog started by runAgent and settle state for the next test
  useStore.getState().ingestAgentEvent({ type: 'task_report', outcome: 'completed', summary: 'ok' });
});
