// ============================================================
// SADEEM v1142 — REAL USER SETTING: MAX CONCURRENT SUBAGENTS
//
// Founder: «السب ايجنت ... الشخص بيقدر من الإعدادات من عند الايجنت يحدد كم
// ايجنت بيقدر يستخدمه» — subagents have no *artificial* limit, but the USER
// must be able to choose how many may run at once from Agent settings.
//
// What this suite PROVES (no green-wash):
//   1. AppSettings owns `maxSubagents` with a sane default + hard ceiling 64;
//   2. the clamp is honest (NaN/0/negative/overflow all repaired);
//   3. a REAL settings value reaches the engine's runtime cap
//      (the old hardcoded `BACKGROUND_SUBAGENT_CAP` is only the ceiling now);
//   4. the ceiling is enforced even when the setting is corrupt/huge;
//   5. updateSettings() clamps at the real settings-write action;
//   6. the Agent UI control is wired to that same action (EN + AR copy);
//   7. the subagent batch host honours the same cap.
//
// Run: node --test --test-force-exit tests/v1142-subagent-limit.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1142-'));
// Bundles MUST live under the project so `external: ['electron']` resolves from
// the project's node_modules (same posture as the other engine suites).
const ENGINE_BUNDLE = join(ROOT, 'tests', '.v1142.engine.bundle.cjs');
const RUNNER_BUNDLE = join(ROOT, 'tests', '.v1142.runner.bundle.cjs');
const STORE_BUNDLE = join(ROOT, 'tests', '.v1142.store.bundle.cjs');
const STUB = join(tmp, 'storeService.cjs');

// Headless browser stubs (the engine touches window/document at module load).
globalThis.window = {
  surnia: new Proxy({}, {
    get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
  }),
  addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }),
};
globalThis.document = {
  documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
  body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, select() {}, remove() {} }),
  addEventListener() {}, removeEventListener() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

// A settings service whose value we can change BETWEEN engine calls — this is
// how we prove the runtime reads the real setting instead of a frozen constant.
writeFileSync(
  STUB,
  `module.exports = { getSettings: () => ({ agent: {}, ...(globalThis.__V1142_SETTINGS__ || {}) }) };`,
);
const storePlugin = {
  name: 'v1142-real-settings-service',
  setup(build) {
    build.onResolve({ filter: /storeService$/ }, (args) => {
      if (/(^|\/)storeService$/.test(args.path)) return { path: STUB };
    });
  },
};

// Bundle the REAL engine with its own internals exported (no behaviour change).
await esbuild.build({
  stdin: {
    contents:
      src('electron/agent/engine.ts') +
      '\nexport { BACKGROUND_SUBAGENT_CAP, activeSubagentRunners, backgroundRunning };\n',
    resolveDir: join(ROOT, 'electron', 'agent'),
    sourcefile: 'engine.ts',
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: ENGINE_BUNDLE,
  external: ['electron'], logLevel: 'silent', plugins: [storePlugin],
});
const engine = require(ENGINE_BUNDLE);

// Bundle the REAL detached runner (batch host) with the same settings service.
await esbuild.build({
  entryPoints: [join(ROOT, 'electron/agent/subagentRunner.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: RUNNER_BUNDLE,
  external: ['electron'], logLevel: 'silent', plugins: [storePlugin],
});
const runner = require(RUNNER_BUNDLE);

// Bundle the REAL renderer store to exercise the actual updateSettings action.
esbuild.buildSync({
  entryPoints: [join(ROOT, 'src/store.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: STORE_BUNDLE,
  external: ['electron', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react'],
  loader: { '.css': 'empty' }, logLevel: 'silent',
});
const { useStore } = require(STORE_BUNDLE);

const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
const where = (file, needle) => `${file}:${lineOf(src(file), needle)}`;

// ------------------------------------------------------------
test('v1142-1 · type + pure clamp: sane default, hard ceiling 64, honest repair', () => {
  const types = src('shared/types.ts');
  assert.match(types, /maxSubagents\?: number/, `${where('shared/types.ts', 'maxSubagents?: number')}: field exists`);
  assert.match(types, /MAX_SUBAGENTS_DEFAULT\s*=\s*64/, 'default is a named constant');
  assert.match(types, /MAX_SUBAGENTS_CEILING\s*=\s*64/, 'hard ceiling is a named constant');
  assert.match(types, /MAX_SUBAGENTS_MIN\s*=\s*1/, 'floor is 1');

  assert.equal(engine.BACKGROUND_SUBAGENT_CAP, 64, 'legacy constant survives as the HARD ceiling');
  assert.equal(engine.backgroundSubagentCap(), 64, 'sane default when settings absent');
  assert.equal(engine.backgroundSubagentCap({}), 64, 'sane default when field absent');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: 3 }), 3, 'user value honoured');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: 64 }), 64, 'ceiling itself allowed');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: 0 }), 1, '0 repaired to floor');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: -9 }), 1, 'negative repaired to floor');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: 9999 }), 64, 'overflow clamped to ceiling');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: NaN }), 64, 'NaN repaired to default');
  assert.equal(engine.backgroundSubagentCap({ maxSubagents: 4.8 }), 4, 'fraction floored');
});

// ------------------------------------------------------------
test('v1142-2 · REAL settings value flows to the engine cap at runtime', async () => {
  const session = 'v1142-flow-' + Date.now();
  // A never-resolving child keeps the in-flight counter exactly where we set it.
  engine.activeSubagentRunners.set(session, () => new Promise(() => {}));
  const events = [];
  const io = { send: (e) => events.push(e) };
  try {
    globalThis.__V1142_SETTINGS__ = { maxSubagents: 3 };
    engine.backgroundRunning.set(session, 2);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'explore', 'third', 'go');
    assert.equal(events.length, 0, '3rd agent launches under a setting of 3 (no refusal emitted)');

    engine.backgroundRunning.set(session, 3);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'explore', 'fourth', 'go');
    assert.match(
      events.at(-1).summary,
      /BACKGROUND_LIMIT: 3 background agents are already running/,
      `${where('electron/agent/engine.ts', 'const cap = backgroundSubagentCap')}: cap is the SETTING, not 64`,
    );
    assert.match(events.at(-1).summary, /Settings → Agent → Max parallel subagents/, 'honest next step names the real control');
  } finally {
    engine.activeSubagentRunners.delete(session);
    engine.backgroundRunning.delete(session);
  }
});

// ------------------------------------------------------------
test('v1142-3 · hard ceiling survives a corrupt / huge setting', async () => {
  const session = 'v1142-cap-' + Date.now();
  engine.activeSubagentRunners.set(session, () => new Promise(() => {}));
  const events = [];
  const io = { send: (e) => events.push(e) };
  try {
    // Huge setting must NOT allow more than BACKGROUND_SUBAGENT_CAP (64).
    globalThis.__V1142_SETTINGS__ = { maxSubagents: 1_000_000 };
    engine.backgroundRunning.set(session, 63);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'general', 'edge-64', 'go');
    assert.equal(events.length, 0, '64th agent allowed at the ceiling (no refusal emitted)');

    engine.backgroundRunning.set(session, 64);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'general', 'over-64', 'go');
    assert.match(events.at(-1).summary, /BACKGROUND_LIMIT: 64 background agents are already running/, 'ceiling enforced');

    // Zero setting must clamp to 1 — never 0/Infinity.
    globalThis.__V1142_SETTINGS__ = { maxSubagents: 0 };
    engine.backgroundRunning.set(session, 1);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'general', 'over-1', 'go');
    assert.match(events.at(-1).summary, /BACKGROUND_LIMIT: 1 background agents are already running/, 'floor enforced');
  } finally {
    engine.activeSubagentRunners.delete(session);
    engine.backgroundRunning.delete(session);
    globalThis.__V1142_SETTINGS__ = undefined;
  }
});

// ------------------------------------------------------------
test('v1142-4 · updateSettings() clamps at the REAL settings-write action', () => {
  const st = () => useStore.getState();
  st().updateSettings({ maxSubagents: 999 });
  assert.equal(st().settings.maxSubagents, 64, `${where('src/store.ts', 'maxSubagents: clampMaxSubagents')}: ceiling on write`);
  st().updateSettings({ maxSubagents: 0 });
  assert.equal(st().settings.maxSubagents, 1, 'floor on write');
  st().updateSettings({ maxSubagents: NaN });
  assert.equal(st().settings.maxSubagents, 64, 'NaN repaired on write');
  st().updateSettings({ maxSubagents: 7 });
  assert.equal(st().settings.maxSubagents, 7, 'valid value persists unchanged');
});

// ------------------------------------------------------------
test('v1142-5 · Agent settings UI: bilingual, precise, wired to updateSettings', () => {
  const ui = src('src/components/settings/AgentSection.tsx');
  assert.match(ui, /settings\.agent\.subagents\.maxConcurrent\.v1142/, `${where('src/components/settings/AgentSection.tsx', 'maxConcurrent.v1142')}: labelled row`);
  assert.match(ui, /Max parallel subagents/, 'EN label');
  assert.match(ui, /الحد الأقصى للوكلاء الفرعيين بالتوازي/, 'AR label');
  assert.match(ui, /This is a REAL ceiling, not "unlimited"/, 'EN honest explanation');
  assert.match(ui, /هذا سقف حقيقي وليس "غير محدود"/, 'AR honest explanation');
  assert.match(ui, /<Slider[\s\S]*?min=\{MAX_SUBAGENTS_MIN\}[\s\S]*?max=\{MAX_SUBAGENTS_CEILING\}/, 'slider range 1-64');
  assert.match(ui, /<NumberInput[\s\S]*?min=\{MAX_SUBAGENTS_MIN\}[\s\S]*?max=\{MAX_SUBAGENTS_CEILING\}/, 'precise number input 1-64');
  assert.match(ui, /updateSettings\(\{ maxSubagents: clampMaxSubagents\(v\) \}\)/, 'writes through the real settings action');
  assert.match(ui, /clampMaxSubagents\(settings\.maxSubagents\)/, 'defensive read');
});

// ------------------------------------------------------------
test('v1142-6 · subagent batch host honours the same cap (no task dropped)', async () => {
  globalThis.__V1142_SETTINGS__ = { maxSubagents: 2 };
  assert.equal(runner.subagentBatchCap(), 2, 'batch reads the real setting');
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    id: `v1142-b${i}`, label: `B${i}`, role: 'general', description: 'd', prompt: 'p',
  }));
  const results = await runner.runSubagentBatch(tasks, {
    ledger: false,
    runner: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 4));
      active--;
      return 'ok';
    },
  });
  assert.equal(peak, 2, `${where('electron/agent/subagentRunner.ts', 'const cap = clampMaxSubagents')}: at most 2 concurrent`);
  assert.equal(results.length, 5, 'every task still gets a result');
  assert.ok(results.every((r) => r.ok), 'no task dropped by the cap');
  globalThis.__V1142_SETTINGS__ = undefined;
});

after(() => {
  for (const p of [ENGINE_BUNDLE, RUNNER_BUNDLE, STORE_BUNDLE, STUB]) {
    try { rmSync(p, { force: true }); } catch { /* best effort */ }
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
