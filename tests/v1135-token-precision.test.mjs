import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.35 (TOKEN-PRECISION) — the founder's complaint:
// «لكل نموذج ذكاء اصطناعي انا لاحظت الكونتكست لينس غير دقيقة، لا في احتساب
// التوكن ولا باحتساب السعر… دقة حرفية دقيقة جدا، جايبها من المصدر»
//
// This suite bundles the REAL src/lib/ctx.ts and the REAL ContextLens.tsx
// (no re-implementation) and proves:
//   1. there is NO real BPE tokenizer installed — every non-provider figure is
//      an ESTIMATE carrying "≈", sourced from the provider usage when present;
//   2. raw provider field names map exactly, cache folded INSIDE the prompt;
//   3. the fallback estimator is script-aware (Arabic / CJK cost more than
//      Latin) and the renderer feeds it the right script profile;
//   4. the copied breakdown marks EVERY estimated figure, and its labels are
//      strictly one language per render (Arabic OR English).
// Run: node --test --test-force-exit tests/v1135-token-precision.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const CTX_SRC = read('src/lib/ctx.ts');
const LENS_SRC = read('src/components/ContextLens.tsx');
const CTX_BUNDLE = join(ROOT, 'tests', '.v1135-ctx.bundle.cjs');
const LENS_BUNDLE = join(ROOT, 'tests', '.v1135-lens.bundle.cjs');

let ctx;
let mod;
let React;
let renderToStaticMarkup;

before(() => {
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'src', 'lib', 'ctx.ts')],
    outfile: CTX_BUNDLE, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  ctx = require(CTX_BUNDLE);

  // Browser stubs BEFORE the store (imported by ContextLens) is evaluated.
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout() {},
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { ContextLens, lensText } from './src/components/ContextLens';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    outfile: LENS_BUNDLE, bundle: true, platform: 'node', format: 'cjs',
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
    logLevel: 'silent',
  });
  mod = require(LENS_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  for (const p of [CTX_BUNDLE, LENS_BUNDLE]) {
    try { if (existsSync(p)) unlinkSync(p); } catch { /* gone */ }
  }
});

const ARABIC = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;
const lineWith = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix)) ?? '';

// ------------------------------------------------------------
// 1 · NO REAL TOKENIZER → honesty is mandatory
// ------------------------------------------------------------
test('v1135: no BPE tokenizer dependency exists, so estimates are labelled ≈', () => {
  const pkg = JSON.parse(read('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(
    !Object.keys(deps).some((k) => /tiktoken|gpt-tokenizer|tokenizer/.test(k)),
    'package.json must not claim a real tokenizer that is not wired',
  );
  assert.doesNotMatch(read('package-lock.json'), /"js-tiktoken"|"gpt-tokenizer"|"tiktoken"/);
  assert.match(CTX_SRC, /ESTIMATE and is labelled "≈"/, 'ctx.ts discloses the absence of a real tokenizer');
  assert.equal(typeof ctx.estimateTokensFromText, 'function', 'script-aware fallback estimator is exported');
});

// ------------------------------------------------------------
// 2 · PROVIDER REPORT IS THE ONLY EXACT SOURCE
// ------------------------------------------------------------
test('v1135: raw provider usage maps exactly; cache is a SEGMENT inside the prompt', () => {
  const u = ctx.fromProviderUsageReport({
    prompt_tokens: 120_000,
    completion_tokens: 5_000,
    cache_read_input_tokens: 90_000,
    cache_creation_input_tokens: 20_000,
  });
  assert.equal(u.inputTokens, 120_000, 'prompt_tokens is used verbatim — cache is NOT added on top');
  assert.equal(u.outputTokens, 5_000, 'completion_tokens used verbatim');
  assert.equal(u.cacheReadTokens, 90_000);
  assert.equal(u.cacheCreationTokens, 20_000);
  assert.equal(u.estimated, false, 'provider-reported figures are exact — no ≈');
  assert.equal(ctx.ctxFillTokens(u), 125_000);
  assert.equal(ctx.ctxPctExact(u, 1_000_000), 12.5);
  assert.equal(ctx.tokenCountSource(u), 'provider');

  // OpenAI-style alias names are accepted too.
  const oai = ctx.fromProviderUsageReport({ prompt_tokens: 800, completion_tokens: 200, cache_read: 300, cache_write: 50 });
  assert.equal(oai.cacheReadTokens, 300);
  assert.equal(oai.cacheCreationTokens, 50);
  assert.equal(ctx.fromProviderUsageReport({}), null, 'no prompt/completion ⇒ no exact source at all');
  assert.equal(ctx.fromProviderUsageReport(null), null);
});

test('v1135: tokenCountSource drives the ≈ decision (provider / estimated / none)', () => {
  assert.equal(ctx.tokenCountSource(null), 'none');
  assert.equal(ctx.tokenCountSource({ inputTokens: 0, outputTokens: 0, costUsd: 0 }), 'none');
  assert.equal(ctx.tokenCountSource({ inputTokens: 10, outputTokens: 0, costUsd: 0, estimated: true }), 'estimated');
  assert.equal(ctx.tokenCountSource({ inputTokens: 10, outputTokens: 0, costUsd: 0 }), 'provider');
  assert.match(LENS_SRC, /tokenCountSource\(usage\)/, 'orb derives the source from the real usage payload');
  assert.match(LENS_SRC, /sourceKey/, 'popover prints where the number came from');
});

// ------------------------------------------------------------
// 3 · SCRIPT-AWARE FALLBACK ESTIMATOR
// ------------------------------------------------------------
test('v1135: Arabic and CJK code points cost more tokens than Latin', () => {
  const arabic = 'مرحبا بالعالم';
  const cjk = '你好世界';
  const latin = 'hello world abc';
  assert.equal(ctx.detectTokenScript(arabic), 'arabic');
  assert.equal(ctx.detectTokenScript(cjk), 'cjk');
  assert.equal(ctx.detectTokenScript(latin), 'latin');
  assert.equal(ctx.detectTokenScript('hello مرحبا'), 'mixed');

  assert.ok(
    ctx.estimateTokensFromText(arabic) > ctx.estimateTokensFromChars(arabic.length),
    'Arabic at chars/4 would understate the token count — the founder uses Arabic',
  );
  assert.equal(ctx.estimateTokensFromChars(4_000), 1_000, 'backward-compatible Latin chars/4 default');
  assert.equal(ctx.estimateTokensFromChars(4_000, 'arabic'), 2_000, 'Arabic: ~2 chars/token');
  assert.equal(ctx.estimateTokensFromChars(3_000, 'cjk'), 2_000, 'CJK: ~1.5 chars/token');
  assert.equal(ctx.estimateTokensFromChars(-5), 0, 'defensive');
  assert.equal(ctx.estimateTokensFromText(''), 0);
});

test('v1135: live estimate accepts a script profile and the lens passes it from the UI language', () => {
  assert.equal(ctx.liveFillEstimate(1_000, 4_000), 2_000);
  assert.equal(ctx.liveFillEstimate(1_000, 4_000, 'arabic'), 3_000);
  const u = { inputTokens: 100_000, outputTokens: 0, costUsd: 0 };
  assert.ok(
    ctx.ctxPctLiveOf(u, 1_000_000, 4_000, 'arabic') > ctx.ctxPctLiveOf(u, 1_000_000, 4_000),
    'an Arabic live stream must not be measured at the Latin rate',
  );
  assert.match(LENS_SRC, /rtl \? 'arabic' : 'latin'/, 'the lens selects the script profile');
  assert.doesNotMatch(LENS_SRC, /Live estimate \(chars\/4\)/, 'no false claim that the estimate is chars/4 only');
});

// ------------------------------------------------------------
// 4 · COPIED BREAKDOWN — EVERY ESTIMATED FIGURE MARKED
// ------------------------------------------------------------
test('v1135: exact breakdown has NO ≈; every estimate figure carries its own marker', () => {
  const exact = ctx.formatContextBreakdown({
    model: 'anthropic/claude', fill: 12_482, window: 200_000,
    cacheRead: 4_000, cacheWrite: 1_000, generated: 482,
    sessionTotal: 50_000, sessionCostUsd: 0.0123,
  });
  assert.doesNotMatch(exact, /≈/, 'provider figures must never be presented as estimates');
  assert.match(exact, /Source: provider reported usage/);

  const est = ctx.formatContextBreakdown({
    model: 'anthropic/claude', fill: 12_482, window: 200_000,
    windowEstimated: true, approximate: true, sessionEstimated: true,
    cacheRead: 4_000, cacheWrite: 1_000, generated: 482,
    sessionTotal: 50_000, sessionCostUsd: 0.0123,
  });
  for (const prefix of ['Context:', 'Remaining:', 'Cache read', 'Session total']) {
    assert.match(lineWith(est, prefix), /≈/, `${prefix} must be marked ≈ when estimated`);
  }
  assert.match(est, /Source: estimate \(no provider usage reported\)/);
  assert.match(est, /figures are estimates/);

  const noWindow = ctx.formatContextBreakdown({ model: 'x', fill: 42, window: 0 });
  assert.match(lineWith(noWindow, 'Context:'), /unknown/, 'no catalog window is stated, not faked as ≈0');
  assert.doesNotMatch(lineWith(noWindow, 'Context:'), /≈0/);
});

test('v1135: Arabic breakdown is one language and no mixed prose', () => {
  const ar = ctx.formatContextBreakdown({
    model: '', fill: 100, window: 200, approximate: true, lang: 'ar',
  });
  assert.match(ar, /السياق:/);
  for (const l of ar.split('\n')) assert.doesNotMatch(l, /[A-Za-z]{2,}/, `mixed prose in: ${l}`);
  const en = ctx.formatContextBreakdown({ model: 'x', fill: 100, window: 200, lang: 'en' });
  assert.doesNotMatch(en, ARABIC, 'English render has no Arabic prose');
});

// ------------------------------------------------------------
// 5 · LENS LABELS ARE MONOLINGUAL + SSR STILL RENDERS
// ------------------------------------------------------------
test('v1135: every local lens label is a single-language pair', () => {
  for (const key of ['source', 'sourceExact', 'sourceEstimate', 'sourceNone', 'streaming', 'windowUnknown']) {
    const en = mod.lensText(key, 'en');
    const ar = mod.lensText(key, 'ar');
    assert.ok(en.length && ar.length, `${key} has both translations`);
    assert.doesNotMatch(en, ARABIC, `${key} EN has no Arabic`);
    assert.doesNotMatch(ar, LATIN, `${key} AR has no English words`);
  }
});

test('v1135: real ContextLens still SSRs the orb with exact provider numbers', () => {
  mod.useStore.setState({
    settings: { language: 'en', numerals: 'western', model: { provider: 'custom', model: 'm' } },
    running: false, liveStreamChars: 0, ctxWindowEstimated: false,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: { inputTokens: 100_000, outputTokens: 0, costUsd: 0 },
    ctxWindow: 1_000_000,
  });
  const html = renderToStaticMarkup(React.createElement(mod.ContextLens, { compact: true }));
  assert.match(html, /class="ctx-orb ctx-orb--compact"/);
  assert.match(html, />10%<\/span>/, 'exact provider usage still drives a precise 10% centre');
  assert.doesNotMatch(html, /≈/, 'no ≈ when the provider reported exact usage');
});
