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
// v11.12 CHAT CAPABILITIES — offline verification of the five
// real slash capabilities added to the chat panel:
//   /model <name> · /profile <level> · /undo · /continue · /clear
// plus the mode-strip sizing fix (TASK A). Store tests use the
// SAME esbuild-bundle + mock-bridge pattern as v1112-ui-fixes.
//   node --test --test-force-exit tests/v1112-chat-capabilities.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-chat-cap-'));

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
const CHECKPOINTS = [{ id: 'cp-1', label: 'before the last edit', at: Date.now(), fileCount: 3 }];
const bridge = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        calls.push({ key, args });
        switch (key) {
          case 'cpList':
            return Promise.resolve(CHECKPOINTS);
          case 'cpRestore':
            return Promise.resolve();
          case 'previewStatus':
            return Promise.resolve({ dev: { running: false, state: 'idle', lines: [] }, static: { running: false }, ports: [] });
          default:
            return Promise.resolve(undefined);
        }
      };
    },
  },
);
globalThis.window = { surnia: bridge }; // no confirm() → guarded confirms treat as "OK" in tests
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
    running: false,
    continueHint: null,
    ...extra,
  });
  return ws;
}
const had = (key, predicate = () => true) => calls.some((c) => c.key === key && predicate(c.args));
const resetCalls = () => (calls.length = 0);
const settle = () => useStore.getState().ingestAgentEvent({ type: 'turn_end' });

// ------------------------------------------------------------
// TASK A — mode strip sizing (source-level, deterministic)
// ------------------------------------------------------------
test('TASK A: mode chips have one measured min-width, fixed height and reserved check slot', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
  assert.match(src, /export function modeChipMinWidthPx\(\): number \{/, 'deterministic measurement helper exported');
  assert.match(src, /for \(const lang of \['en', 'ar'\] as const\)/, 'measures BOTH locales');
  assert.match(src, /minWidth: modeChipMinWidth/, 'one shared min-width on every chip');
  assert.match(src, /height: 24/, 'equal chip heights');
  assert.match(src, /whiteSpace: 'nowrap'/, 'labels cannot wrap/clip');
  assert.match(src, /flexWrap: 'wrap'/, 'strip wraps on narrow panels');
  assert.match(src, /composer-mode-check/, 'check slot reserved on inactive chips too');
  // RTL order preserved: no direction override on the tablist, only on the label
  assert.match(src, /<span className="composer-mode-label" dir="auto">/, 'label direction is per-text, row direction untouched');
});

test('TASK A: asserted active-state class names are kept', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
  assert.match(src, /taskMode === m && <Check[^>]*className="tm-check shrink-0"/, 'active mode renders a check');
  assert.match(src, /aria-selected=\{taskMode === m\}/, 'aria-selected kept');
  assert.match(src, /aria-pressed=\{taskMode === m\}/, 'aria-pressed kept');
  assert.match(src, /' is-active'/, 'is-active class kept');
  assert.match(src, /data-active=\{taskMode === m \? 'true' : undefined\}/, 'data-active kept');
});

// ------------------------------------------------------------
// Capability 1 — /model <name>
// ------------------------------------------------------------
test('/model <name> switches the active model for this session with a visible confirmation', async () => {
  seed({
    settings: {
      ...useStore.getState().settings,
      language: 'en',
      model: { provider: 'openai', model: 'gpt-6-astra' },
      providers: { ...(useStore.getState().settings.providers ?? {}), openai: { apiKey: 'k' } },
    },
  });
  resetCalls();
  await useStore.getState().sendMessage('/model gpt-5.5');
  const s = useStore.getState();
  assert.equal(s.settings.model.model, 'gpt-5.5', 'model switched in settings');
  assert.equal(s.session.model, 'openai/gpt-5.5', 'current session model updated');
  assert.ok(s.session.messages.some((m) => /Model switched to openai\/gpt-5.5/.test(m.content)), 'transcript confirmation');
  assert.ok(had('saveSettings'), 'settings persisted to the main process');

  // provider-qualified form, longest provider id wins
  await useStore.getState().sendMessage('/model openai/gpt-6.1-terra');
  assert.equal(useStore.getState().settings.model.model, 'gpt-6.1-terra');
});

test('/model with no argument opens the real picker (honest, no fake switch)', async () => {
  seed();
  useStore.setState({ modelPickerOpen: false });
  await useStore.getState().sendMessage('/model');
  assert.equal(useStore.getState().modelPickerOpen, true, 'picker opened');
  assert.equal(useStore.getState().settings.model.model, 'm', 'model unchanged');
});

test('/model with an unknown name reports the miss without changing anything', async () => {
  seed();
  const before = useStore.getState().settings.model.model;
  await useStore.getState().sendMessage('/model definitely-not-a-model-xyz');
  assert.equal(useStore.getState().settings.model.model, before, 'no fake switch');
  assert.ok(/No installed model matches/.test(useStore.getState().notice || ''), 'honest error toast');
});

// ------------------------------------------------------------
// Capability 2 — /profile
// ------------------------------------------------------------
test('/profile switches the tool profile at runtime and persists it', async () => {
  seed();
  resetCalls();
  await useStore.getState().sendMessage('/profile essential');
  assert.equal(useStore.getState().settings.agent?.toolProfile, 'essential');
  assert.ok(
    useStore.getState().session.messages.some((m) => /Tool profile set to essential/.test(m.content)),
    'transcript confirmation',
  );
  assert.ok(had('saveSettings'), 'main-process settings saved — engine reads it on next run');
  await useStore.getState().sendMessage('/profile full');
  assert.equal(useStore.getState().settings.agent?.toolProfile, 'full');
});

test('/profile rejects an invalid level without faking success', async () => {
  seed();
  await useStore.getState().sendMessage('/profile turbo');
  assert.notEqual(useStore.getState().settings.agent?.toolProfile, 'turbo');
  assert.ok(/Unknown tool profile/.test(useStore.getState().notice || ''), 'honest error toast');
});

// ------------------------------------------------------------
// Capability 3 — /undo
// ------------------------------------------------------------
test('/undo restores the newest checkpoint through the existing cp bridge', async () => {
  const ws = seed();
  resetCalls();
  await useStore.getState().sendMessage('/undo');
  assert.ok(had('cpList', (a) => a[0] === ws), 'checkpoints listed');
  assert.ok(had('cpRestore', (a) => a[0] === ws && a[1] === 'cp-1'), 'newest checkpoint restored');
  assert.ok(
    useStore.getState().session.messages.some((m) => /Undo complete/.test(m.content)),
    'transcript confirmation',
  );
});

test('/undo reports honestly when no workspace is open', async () => {
  seed({ wsPath: '' });
  resetCalls();
  await useStore.getState().sendMessage('/undo');
  assert.equal(had('cpList'), false, 'no bridge call without a workspace');
  assert.match(useStore.getState().notice || '', /Open a folder first/);
});

// ------------------------------------------------------------
// Capability 4 — /continue + Continue chip
// ------------------------------------------------------------
test('a truncated task_report raises a continue hint; /continue re-sends the same task', async () => {
  seed({
    session: {
      id: 's1',
      title: 't',
      workspace: join(tmp, 'ws'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'build the feature and verify it', timestamp: Date.now() }],
      messageCount: 1,
      totalTokens: 0,
      totalCostUsd: 0,
    },
  });
  useStore.getState().ingestAgentEvent({
    type: 'task_report',
    outcome: 'aborted',
    summary: 'stopped at the step budget',
    files: [],
    commands: [],
    nextSteps: [],
    partial: true,
    durationMs: 100,
  });
  const hint = useStore.getState().continueHint;
  assert.equal(hint?.reason, 'error');
  assert.equal(hint?.task, 'build the feature and verify it');

  resetCalls();
  await useStore.getState().sendMessage('/continue');
  assert.equal(useStore.getState().continueHint, null, 'hint consumed');
  assert.ok(
    had('agentRun', (a) => {
      const msgs = a[0]?.messages ?? [];
      return msgs.some((m) => /\[CONTINUE\]/.test(m.content) && /build the feature and verify it/.test(m.content));
    }),
    'same task re-sent with a continue directive',
  );
  settle();
});

test('a clean completion does NOT raise a continue hint', () => {
  seed({
    session: {
      id: 's1',
      title: 't',
      workspace: join(tmp, 'ws'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'do the thing', timestamp: Date.now() }],
      messageCount: 1,
      totalTokens: 0,
      totalCostUsd: 0,
    },
  });
  useStore.getState().ingestAgentEvent({
    type: 'task_report',
    outcome: 'completed',
    summary: 'done',
    files: [],
    commands: [],
    nextSteps: [],
    durationMs: 10,
  });
  assert.equal(useStore.getState().continueHint, null, 'no false Continue offer');
});

// ------------------------------------------------------------
// Capability 5 — /clear (confirmed)
// ------------------------------------------------------------
test('/clear starts a fresh session after confirmation', async () => {
  seed({
    session: {
      id: 'old-session',
      title: 't',
      workspace: join(tmp, 'ws'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'old', timestamp: Date.now() }],
      messageCount: 1,
      totalTokens: 0,
      totalCostUsd: 0,
    },
  });
  await useStore.getState().sendMessage('/clear');
  assert.notEqual(useStore.getState().session?.id, 'old-session', 'fresh session active');
  assert.equal(useStore.getState().session?.messages.length, 0, 'transcript cleared from the live view');
  assert.match(useStore.getState().notice || '', /New session started/);
});

// ------------------------------------------------------------
// Wiring & i18n (source-level) — every command must be reachable
// ------------------------------------------------------------
test('all five capabilities are wired in the slash menu, the store dispatcher and the i18n dictionary', () => {
  const composer = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
  const store = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');
  const i18n = readFileSync(join(ROOT, 'src', 'i18n.ts'), 'utf8');
  for (const cmd of ['/model', '/profile', '/undo', '/continue', '/clear', '/export', '/rewind']) {
    assert.ok(composer.includes(`cmd: '${cmd}'`), `slash menu registers ${cmd}`);
  }
  for (const [cmd, action] of [
    ['profile', 'switchToolProfile'],
    ['undo', 'undoLastCheckpoint'],
    ['continue', 'continueTask'],
    ['model', 'switchModel'],
  ]) {
    assert.ok(store.includes(`cmd === '${cmd}'`), `store dispatcher handles ${cmd}`);
    assert.ok(store.includes(`get().${action}(`), `store action ${action} exists`);
  }
  assert.match(composer, /onClick=\{\(\) => void continueTask\(\)\}/, 'Continue button is in the composer');
  assert.match(composer, /continueHint && !running/, 'Continue button is conditional on a real hint');

  const keys = [
    'slash.model.hint', 'slash.model.notFound', 'slash.model.switched',
    'slash.profile.current', 'slash.profile.bad', 'slash.profile.same', 'slash.profile.switched',
    'slash.undo.empty', 'slash.undo.confirm', 'slash.undo.restoring', 'slash.undo.done', 'slash.undo.restoreFailed',
    'slash.continue.noTask', 'chat.continue.compacted', 'chat.continue.truncated', 'chat.continue.error',
    'slash.clear.confirm', 'slash.clear.done',
  ];
  for (const key of keys) {
    // each key must have BOTH a non-empty EN and a non-empty AR string
    const re = new RegExp(`'${key.replace('.', '\\.')}':\\s*\\['[^']+',\\s*'[^']+']`);
    assert.match(i18n, re, `${key} has EN + AR strings`);
  }
});
