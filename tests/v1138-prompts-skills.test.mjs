import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.38 — PROMPTS AND SKILLS ARE ACTUALLY USED
// Founder: "البرومتس يجب أن يتم استخدامه. سكيلز يجب أن يتم استخدامه"
//
// Honest proof, four layers:
//   1. PROMPTS-FIRST / SKILLS-FIRST directives REACH the real rendered prompt
//      (and the byte-stable prefix + every byte cap stay exactly green);
//   2. the Prompt Library service offers the founder's real saved entry to the
//      model (promptsForModel / findPrompt) and wraps it as an explicit order;
//   3. a REAL engine run: seeded skill → SKILLS index in system prompt →
//      use_skill called → real body returned → body in a LATER provider request;
//   4. SSR + click: the USE / Use with AI controls really insert the exact
//      use_skill call and the wrapped saved prompt into the composer.
//
// Run: node --test --test-force-exit tests/v1138-prompts-skills.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { buildSync as esbuildBuildSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ------------------------------------------------------------
// 1 · prompt directives + byte caps (real buildSystemPrompt)
// ------------------------------------------------------------
const PROMPTS_BUNDLE = join(TMP, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), PROMPTS_BUNDLE);
const prompts = require(PROMPTS_BUNDLE);
const BASE = { workspace: 'D:/surnia-v1138-ws', mode: 'default', platform: 'win32', language: 'en' };
const SPLIT = prompts.SYSTEM_CACHE_SPLIT;
const stableOf = (s) => s.split(SPLIT)[0];

test('v1138 prompt: SKILLS-FIRST directive names use_skill and mandatory order', () => {
  const src = read('electron/agent/prompts.ts');
  assert.match(src, /SKILLS-FIRST — MANDATORY ORDER/, 'strong ordered directive exists in source');
  assert.match(src, /Skill tool roster: use_skill/, 'skill tools named by exact name');
  const sys = prompts.buildSystemPrompt({
    ...BASE,
    skills: [{ name: 'V1138 Ritual', description: 'real seeded skill' }],
  });
  assert.ok(sys.includes('# SKILLS'), 'SKILLS section rendered');
  assert.ok(sys.includes('SKILLS-FIRST RULE'), 'founder-facing rule reached the prompt');
  assert.ok(sys.includes('SKILLS-FIRST — MANDATORY ORDER'), 'strengthened directive reached the prompt');
  assert.ok(sys.includes('use_skill("<exact-slug>")'), 'exact tool call taught to the model');
  assert.ok(sys.includes('Skill tool roster: use_skill'), 'tool roster names use_skill');
});

test('v1138 prompt: PROMPTS-FIRST directive renders for saved prompts, never changes the cached prefix', () => {
  const withPrompts = prompts.buildSystemPrompt({
    ...BASE,
    savedPrompts: [{ name: 'V1138 Review', text: 'Read every file before editing, then run the tests.' }],
  });
  assert.ok(withPrompts.includes('# SAVED PROMPTS'), 'saved-prompt section rendered');
  assert.ok(withPrompts.includes('PROMPTS-FIRST RULE'), 'directive reached the real prompt');
  assert.ok(withPrompts.includes('V1138 Review'), 'the founder’s saved entry is offered');
  assert.ok(withPrompts.includes('Read every file before editing, then run the tests.'), 'exact text is offered');
  assert.ok(withPrompts.includes('use_prompt'), 'prompt tool named by exact name (conditional on advertisement)');
  const without = prompts.buildSystemPrompt({ ...BASE });
  assert.ok(!without.includes('# SAVED PROMPTS'), 'no section when library is empty');
  assert.equal(stableOf(withPrompts), stableOf(without), 'byte-stable cached prefix is IDENTICAL');
});

test('v1138 byte caps: directives add ZERO bytes to the cached prefix; all v11.x bands hold', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const withBoth = prompts.buildSystemPrompt({
    ...BASE,
    skills: [{ name: 'S', description: 'D' }],
    savedPrompts: [{ name: 'P', text: 'T' }],
  });
  const size = bytes(en);
  // The WEBRAFT design-system path is embedded in the static prefix and is
  // resolved from __dirname, so the ABSOLUTE byte total shifts with os.tmpdir()
  // (24425 B in the original harness, 24422 B with a 3-char-shorter TMPDIR).
  // The invariant that matters — and that this suite enforces — is that the
  // new directives are dynamic-tail only: the cacheable prefix is IDENTICAL
  // with and without them, and every byte band still holds.
  console.log(`V1138_AUDIT: EN base=${size}B (environment-tied to WEBRAFT path length)`);
  assert.equal(stableOf(withBoth), stableOf(en), 'byte-stable cached prefix unchanged by directives');
  assert.ok(!en.includes('PROMPTS-FIRST') && !en.includes('SKILLS-FIRST'), 'base prompt has no directive bytes');
  assert.ok(size < 24 * 1024, 'EN < 24 KB');
  assert.ok(size - 23754 <= 700, 'v11.21 band ≤ 700');
  assert.ok(size - 24381 >= 0 && size - 24381 < 400, 'v11.23 band < 400');
  for (const marker of ['# CAPABILITY ROSTER', 'tool_help for args', 'markdown_outline', 'image_generate']) {
    assert.ok(en.includes(marker), `capability marker preserved: ${marker}`);
  }
});

// ------------------------------------------------------------
// 2 · prompt-library service actually offers + wraps saved entries
// ------------------------------------------------------------
const UD = join(TMP, 'userdata');
mkdirSync(UD, { recursive: true });
const SVC_BUNDLE = join(TMP, 'svc.cjs');
{
  const ed = join(TMP, 'node_modules', 'electron');
  mkdirSync(ed, { recursive: true });
  writeFileSync(join(ed, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
  writeFileSync(join(ed, 'index.js'),
    `module.exports={app:{getPath:(k)=>(k==='userData'?${JSON.stringify(UD)}:${JSON.stringify(TMP)})}};module.exports.default=module.exports;`);
  bundle(join(ROOT, 'electron/services/promptLibraryService.ts'), SVC_BUNDLE);
}
const svc = require(SVC_BUNDLE);

test('v1138 library: a real saved prompt is offered, resolvable and wrapped as a direct order', () => {
  const TEXT = 'STEP_ONE read the repository. STEP_TWO write the failing test first.';
  const saved = svc.savePrompt('V1138 Ritual', TEXT);
  assert.ok(saved.ok && saved.item, 'a real prompt was saved on disk');
  assert.ok(existsSync(join(UD, 'prompts.json')), 'prompts.json physically exists');

  const offered = svc.promptsForModel();
  assert.ok(offered.some((p) => p.name === 'V1138 Ritual' && p.text === TEXT),
    'the founder’s exact saved entry is offered to the model');
  assert.equal(svc.findPrompt(saved.item.id)?.text, TEXT, 'resolved by id');
  assert.equal(svc.findPrompt('v1138 ritual')?.text, TEXT, 'resolved by case-insensitive name');
  assert.equal(svc.findPrompt('missing'), undefined, 'unknown reference refused');

  const wrapped = svc.promptInsertText(TEXT);
  assert.ok(wrapped.startsWith(svc.PROMPT_AI_OPEN), 'explicit-instruction opening marker');
  assert.ok(wrapped.includes(TEXT), 'exact saved text preserved');
  assert.ok(wrapped.endsWith(svc.PROMPT_AI_CLOSE + '\n'), 'explicit-instruction closing marker');

  // The renderer and the service must not drift apart on those markers.
  const panel = read('src/components/panels/PromptsPanel.tsx');
  assert.ok(panel.includes(`export const AI_PROMPT_OPEN = '${svc.PROMPT_AI_OPEN}'`), 'renderer marker matches service');
  assert.ok(panel.includes(`export const AI_PROMPT_CLOSE = '${svc.PROMPT_AI_CLOSE}'`), 'renderer marker matches service');
});

// ------------------------------------------------------------
// 3 · REAL engine run: seeded skill → use_skill → body in later request
// ------------------------------------------------------------
const ENG_BUNDLE = join(TMP, 'engine.cjs');
bundle(join(ROOT, 'electron/agent/engine.ts'), ENG_BUNDLE);
const engine = require(ENG_BUNDLE);

const emptyBuiltins = join(TMP, 'empty-builtins');
mkdirSync(emptyBuiltins, { recursive: true });
process.env.SURNIA_SKILLS_BUILTIN_DIR = emptyBuiltins;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const toolDeltas = (name, args, id) => [
  { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
  { tool_calls: [{ index: 0, function: { arguments: args } }] },
];
const routes = new Map();
const requests = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* {} */ }
    requests.push({
      model: body.model,
      system: (body.messages ?? []).filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n'),
      messages: body.messages ?? [],
    });
    const q = routes.get(body.model);
    const h = q && q.length ? q.shift() : null;
    if (!h) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED ${body.model}` } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    try { await h({ res }); } catch { try { res.destroy(); } catch { /* gone */ } }
  });
});
// NOTE: no top-level await here — node --test registers test() calls during
// synchronous module evaluation, so the mock server is started in before().
let PORT = 0;
function script(model, { text = null, tool = null } = {}) {
  const q = routes.get(model) ?? [];
  q.push(async ({ res }) => {
    if (text !== null) res.write(sseChunk({ content: text }));
    if (tool) for (const d of toolDeltas(tool.name, JSON.stringify(tool.args), tool.id ?? 'call_1')) res.write(sseChunk(d));
    res.write(sseChunk({}, tool ? 'tool_calls' : 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  routes.set(model, q);
}
before(async () => {
  PORT = await new Promise((resolve) => mock.listen(0, '127.0.0.1', () => resolve(mock.address().port)));
  writeFileSync(join(UD, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    providers: { custom: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${PORT}` } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false },
    doneNotifications: false,
  }));
});

const WS = join(TMP, 'ws-trusted');
const SLUG = 'sea-tide';
const BODY = 'V1138_REAL_BODY — write the failing test first, then the fix, then prove green.';
{
  const d = join(WS, '.surnia', 'skills', SLUG);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'),
    `---\nname: Sea Tide\ndescription: A proven debugging ritual for flaky maritime tests\n---\n# Sea Tide\n${BODY}\n`);
  writeFileSync(join(WS, '.surnia', 'skills-trusted'), '');
}
const TASK = 'Debug the flaky maritime tests using the Sea Tide ritual.';

test('v1138 engine: skill index → real use_skill call → real body in a later provider request', async () => {
  script('mock-v1138', { tool: { name: 'use_skill', args: { slug: SLUG }, id: 'call_skill' } });
  script('mock-v1138', { text: 'Followed the Sea Tide ritual and proved the suite green.' });

  const events = [];
  await engine.runAgent({
    task: 'chat',
    sessionId: 'v1138-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: TASK, timestamp: Date.now() }],
    model: { provider: 'custom', model: 'mock-v1138', maxTokens: 2048 },
    mode: 'fullAccess', workspace: WS,
    apiKey: 'test-key', baseUrl: `http://127.0.0.1:${PORT}`,
  }, {
    events, send(e) { events.push(e); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false, onFetchSignal() {},
  });

  const system = [...requests].reverse().find((r) => r.model === 'mock-v1138')?.system ?? '';
  assert.ok(system.includes('# SKILLS') && system.includes('Sea Tide'), 'skill index reached the real system prompt');
  assert.ok(system.includes('SKILLS-FIRST — MANDATORY ORDER'), 'strong directive reached the real run');
  assert.ok(system.includes(`use_skill("${SLUG}")`), 'exact loadable slug reached the model');

  const start = events.find((e) => e.type === 'tool_start' && e.name === 'use_skill');
  assert.ok(start, 'the model actually CALLED use_skill through the real engine');
  const result = events.find((e) => e.type === 'tool_result' && e.toolCallId === start.toolCallId);
  assert.ok(result?.ok, 'use_skill executed OK');
  assert.ok(result.output.includes(BODY), 'the REAL full skill body was returned');

  assert.ok(requests.some((r) => r.messages.some((m) => JSON.stringify(m).includes(BODY))),
    'the loaded body reached a LATER real provider request (visible effect)');
});

// ------------------------------------------------------------
// 4 · SSR + click: USE / Use with AI really insert into the composer
// ------------------------------------------------------------
let React, renderToStaticMarkup, mod;
let captured = [];
const PANEL_BUNDLE = join(ROOT, 'tests', '.v1138-panels.bundle.cjs');

before(() => {
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    innerWidth: 1280, innerHeight: 800,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  // Bundle the two panels with a stdin entry so the real handlers are tested.
  esbuildBuildSync({
    stdin: {
      contents: [
        "export { useStore } from './src/store';",
        "export { SkillsPanel } from './src/components/panels/SkillsPanel';",
        "export { PromptsPanel, formatPromptForAI } from './src/components/panels/PromptsPanel';",
      ].join('\n'),
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: PANEL_BUNDLE,
    loader: { '.css': 'empty' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', 'lottie-web', '@xterm/xterm', '@xterm/addon-fit',
      'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(PANEL_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR silence
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
  const jr = require('react/jsx-runtime');
  const origJsx = jr.jsx, origJsxs = jr.jsxs;
  jr.jsx = (...a) => { captured.push({ type: a[0], props: a[1] }); return origJsx(...a); };
  jr.jsxs = (...a) => { captured.push({ type: a[0], props: a[1] }); return origJsxs(...a); };
  mod.__restoreJsx = () => { jr.jsx = origJsx; jr.jsxs = origJsxs; };
});

function seedStore() {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: ROOT,
    settings: { ...(prev.settings ?? {}), language: 'en' },
    skills: [], skillsTrustNeeded: false, dna: { patterns: [] },
    notify: () => {}, composerInsert: null,
  });
}
function renderWithState(Comp, overrides = {}) {
  const original = React.useState;
  let i = 0;
  React.useState = (init) => {
    const idx = i++;
    return Object.prototype.hasOwnProperty.call(overrides, idx) ? [overrides[idx], () => {}] : original(init);
  };
  try {
    captured = [];
    renderToStaticMarkup(React.createElement(Comp, {}));
    return captured;
  } finally {
    React.useState = original;
  }
}
function byTestId(id) {
  return captured.find((e) => e?.props && e.props['data-testid'] === id && typeof e.props.onClick === 'function');
}
function click(el) {
  assert.ok(el, 'control exists');
  el.props.onClick({ preventDefault() {}, stopPropagation() {} });
}

test('v1138 SSR: skill USE button queues the exact use_skill call into the composer', () => {
  seedStore();
  const skill = { slug: SLUG, name: 'Sea Tide', description: 'ritual', scope: 'workspace', path: 'x' };
  renderWithState(mod.SkillsPanel, { 0: [skill] });
  const btn = byTestId(`skill-use-with-ai-${SLUG}`);
  assert.ok(btn, 'the real USE control is rendered for the seeded skill');
  assert.match(btn.props['aria-label'] ?? '', /Use with AI/);
  click(btn);
  const inserted = mod.useStore.getState().composerInsert?.text ?? '';
  assert.ok(inserted.includes(`use_skill("${SLUG}")`), 'exact use_skill call inserted');
  assert.ok(inserted.includes('Sea Tide'), 'skill name carried as context');
});

test('v1138 SSR: prompt "Use with AI" inserts the wrapped saved prompt; plain Insert stays raw', () => {
  seedStore();
  const item = { id: 'p1138', name: 'Review', text: 'Review the code', createdAt: 1, updatedAt: 1 };
  renderWithState(mod.PromptsPanel, { 0: [item] });

  const ai = byTestId('prompt-use-with-ai-p1138');
  assert.ok(ai, 'the real Use with AI control is rendered for the saved prompt');
  assert.match(ai.props['aria-label'] ?? '', /Use with AI/);
  click(ai);
  const inserted = mod.useStore.getState().composerInsert?.text ?? '';
  assert.equal(inserted, mod.formatPromptForAI('Review the code'), 'wrapped instruction inserted verbatim');
  assert.ok(inserted.startsWith(svc.PROMPT_AI_OPEN), 'service + renderer markers agree at runtime');

  const plain = captured.find((e) => e?.props && e.props['aria-label'] === 'Insert' && typeof e.props.onClick === 'function');
  assert.ok(plain, 'plain Insert still exists');
  click(plain);
  assert.equal(mod.useStore.getState().composerInsert?.text, 'Review the code', 'plain Insert keeps exact raw text (no regression)');
});

after(async () => {
  try { mod?.__restoreJsx?.(); } catch { /* none */ }
  try { engine.closeAllMcpClients?.(); } catch { /* none */ }
  try { engine.stopMcpHealthMonitor?.(); } catch { /* none */ }
  try { mock.closeAllConnections?.(); } catch { /* node <18.2 */ }
  await new Promise((r) => mock.close(r));
  try { rmSync(PANEL_BUNDLE, { force: true }); } catch { /* best effort */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});
