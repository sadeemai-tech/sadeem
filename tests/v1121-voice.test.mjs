import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.21 — VOICE INPUT polish: real-amplitude mic ring + calm orb.
//
// Locks the contract the founder asked for:
//   • the mic is a precise glyph inside a circular waveform ring;
//   • the ring/orb are driven by a REAL Web Audio AnalyserNode — there is
//     no Math.random / timer-driven fake "voice" activity anywhere;
//   • when no amplitude API exists the fallback is a steady pulse with an
//     explicit, honest label (never a pretended reaction to speech);
//   • states idle → listening → processing → result all SSR-render without
//     throwing, are keyboard reachable (button + aria), stay monolingual in
//     EN and AR, and respect prefers-reduced-motion.
//
//   node --test --test-force-exit tests/v1121-voice.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const compSrc = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
const cssPath = join(ROOT, 'src', 'components', 'voice-input.css');
const cssSrc = readFileSync(cssPath, 'utf8');
const BUNDLE = join(ROOT, 'tests', '.v1121-voice.bundle.cjs');
let mod;
let React;
let renderToString;

before(() => {
  // Minimal browser stubs installed BEFORE the store bundle loads (mirrors
  // v1114-chat-runtime.test.mjs) — SSR never touches real Web Audio.
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
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
        "export { VoiceInput, Composer } from './src/components/Composer';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  // getServerSnapshot must read the live (seeded) store state.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToString = require('react-dom/server').renderToString;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------
const EN = {
  idle: 'Voice input',
  listening: 'Listening…',
  processing: 'Transcribing…',
  result: 'Transcript ready',
  stop: 'Stop recording',
  steady: 'Level unavailable — steady pulse',
};
const AR = {
  idle: 'إدخال صوتي',
  listening: 'جارٍ الاستماع…',
  processing: 'جارٍ التفريغ النصي…',
  result: 'النص جاهز',
  stop: 'أوقف التسجيل',
  steady: 'قياس الصوت غير متاح — نبض ثابت',
};
const ArabicLetter = (s) => /\p{Script=Arabic}/u.test(String(s));
const latinWords = (s) => String(s).match(/[A-Za-z][A-Za-z0-9_.-]*/g) || [];

/** User-visible strings only: aria-label/title values + text nodes, with
 *  aria-hidden subtrees (glyphs, spinner, orb rings) removed. */
function visibleStrings(html) {
  let clean = html
    .replace(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>/g, '')
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '');
  const out = [];
  for (const m of clean.matchAll(/(?:aria-label|title)="([^"]*)"/g)) out.push(m[1]);
  const text = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text) out.push(text);
  return out;
}
function renderVoice(props) {
  return renderToString(React.createElement(mod.VoiceInput, props));
}
function baseProps(state, labels, extra = {}) {
  return {
    state, labels, level: 0.42, hasAmplitude: true, seconds: 7,
    transcript: state === 'result' ? 'hello from dictation' : '',
    onStart() {}, onStop() {},
    ...extra,
  };
}
function seed(lang) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: 'D:\\ws',
    session: {
      id: 's1', title: 't', workspace: 'D:\\ws', messages: [],
      createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0,
      totalTokens: 0, totalCostUsd: 0,
    },
    settings: { ...prev.settings, language: lang, model: { provider: 'custom', model: 'm' } },
    running: false,
  });
}

// ------------------------------------------------------------
// 1 — source contract: real amplitude, honest fallback, stable CSS
// ------------------------------------------------------------
test('voice-input.css is a stable, unversioned stylesheet with a reduced-motion guard', () => {
  assert.ok(existsSync(cssPath), 'src/components/voice-input.css exists');
  assert.equal(basename(cssPath), 'voice-input.css', 'no version suffix in the CSS filename');
  assert.ok(cssSrc.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion guard present');
  assert.ok(cssSrc.includes('animation: none !important'), 'all voice animations stop under reduced motion');
  assert.ok(cssSrc.includes('--vi-level'), 'orb/ring read the real level custom property');
  assert.ok(cssSrc.includes('data-has-amplitude'), 'steady-pulse fallback is keyed off amplitude availability');
  assert.ok(compSrc.includes("import './voice-input.css';"), 'Composer imports the stable stylesheet');
});

test('the waveform ring uses a real Web Audio analyser — never random animation', () => {
  assert.ok(compSrc.includes('createAnalyser()'), 'an AnalyserNode is created');
  assert.ok(compSrc.includes('getByteTimeDomainData('), 'level is sampled from real PCM data');
  assert.ok(compSrc.includes('Math.sqrt(sum / buf.length)'), 'RMS amplitude is computed from the signal');
  assert.ok(compSrc.includes('setVoiceLevelAvailable(true)'), 'real amplitude is advertised to the UI');
  assert.ok(compSrc.includes('voiceLevelRafRef'), 'sampling loop is torn down on release');
  assert.ok(!compSrc.includes('Math.random('), 'no pseudo-random call anywhere in the composer');
});

test('no-amplitude fallback is explicitly labelled; transcript is API-final only', () => {
  assert.ok(compSrc.includes('Level unavailable — steady pulse'), 'honest EN fallback label');
  assert.ok(compSrc.includes('قياس الصوت غير متاح — نبض ثابت'), 'honest AR fallback label');
  assert.ok(compSrc.includes('data-has-amplitude={hasAmplitude ?'), 'fallback is selected by real availability');
  assert.ok(compSrc.includes('preview = text'), 'result preview is the exact text returned by the API');
});

test('every new bilingual voice label resolves monolingually in EN and AR', () => {
  for (const key of ['chat.voice.listening', 'chat.voice.processing', 'chat.voice.result', 'chat.voice.steady']) {
    const re = new RegExp(`t\\(\\s*'${key}',\\s*lang === 'ar' \\? '([^']*)' : '([^']*)'\\s*,?\\s*\\)`);
    const m = re.exec(compSrc);
    assert.ok(m, `${key} provides inline bilingual fallbacks (i18n.ts is owned by another agent)`);
    const [, ar, en] = m;
    assert.ok(!ArabicLetter(en), `${key}: EN fallback contains Arabic → "${en}"`);
    assert.deepEqual(latinWords(ar), [], `${key}: AR fallback contains English prose → "${ar}"`);
  }
});

test('the mic is keyboard reachable and announced in every state', () => {
  assert.ok(compSrc.includes('type="button"'), 'native button (Enter/Space activate)');
  assert.ok(compSrc.includes('aria-pressed={live}'), 'pressed state reflects listening');
  assert.ok(compSrc.includes('aria-label={live ? labels.stop : labels.idle}'), 'state-aware aria label');
  assert.ok(compSrc.includes('role="status" aria-live="polite"'), 'status + transcript are announced');
  assert.ok(cssSrc.includes('.vi-mic:focus-visible'), 'visible keyboard focus ring');
});

// ------------------------------------------------------------
// 2 — SSR runtime: idle / listening / processing / result
// ------------------------------------------------------------
test('SSR: all four voice states render without throwing and expose their state + aria label', () => {
  const expectedAria = {
    idle: EN.idle,
    listening: EN.stop,
    processing: EN.idle,
    result: EN.idle,
  };
  for (const state of ['idle', 'listening', 'processing', 'result']) {
    const html = renderVoice(baseProps(state, EN));
    assert.ok(html.includes(`data-state="${state}"`), `${state}: state is on the root`);
    assert.ok(html.includes('class="vi-mic"'), `${state}: mic button mounted`);
    assert.ok(html.includes(`aria-label="${expectedAria[state]}"`), `${state}: correct aria label`);
    assert.ok(html.includes('vi-wave-bars'), `${state}: circular waveform ring mounted`);
    if (state === 'idle') {
      assert.ok(!html.includes('vi-pop'), 'idle: no status popover');
    } else {
      assert.ok(html.includes('vi-orb'), `${state}: calm orb mounted`);
      assert.ok(html.includes('aria-live="polite"'), `${state}: live status mounted`);
    }
  }
});

test('SSR: real-amplitude vs no-amplitude renders differ honestly', () => {
  const real = renderVoice(baseProps('listening', EN, { hasAmplitude: true, level: 0.8 }));
  const steady = renderVoice(baseProps('listening', EN, { hasAmplitude: false, level: 0.8 }));
  assert.ok(real.includes('data-has-amplitude="true"'), 'real analyser is advertised');
  assert.ok(steady.includes('data-has-amplitude="false"'), 'fallback is advertised');
  assert.ok(!real.includes('vi-honest'), 'real level does not claim to be a steady pulse');
  assert.ok(steady.includes(EN.steady), 'no analyser → honest steady-pulse label is shown');
  // A real level actually changes the ring geometry (not just a class toggle).
  assert.notEqual(
    renderVoice(baseProps('listening', EN, { hasAmplitude: true, level: 0.1 })),
    real,
    'ring markup tracks the measured level',
  );
});

test('SSR: EN and AR voice surfaces are monolingual (no mixed-language strings)', () => {
  for (const state of ['listening', 'processing', 'result']) {
    const enHtml = renderVoice(baseProps(state, EN, { transcript: state === 'result' ? 'ready' : '' }));
    const arHtml = renderVoice(baseProps(state, AR, { transcript: state === 'result' ? 'جاهز' : '' }));
    for (const s of visibleStrings(enHtml)) {
      assert.ok(!ArabicLetter(s), `EN ${state}: Arabic leaked into "${s}"`);
    }
    for (const s of visibleStrings(arHtml)) {
      assert.deepEqual(latinWords(s), [], `AR ${state}: English prose leaked into "${s}"`);
    }
  }
});

test('SSR: the full Composer still renders the idle mic in both languages', () => {
  for (const lang of ['en', 'ar']) {
    seed(lang);
    const html = renderToString(React.createElement(mod.Composer));
    assert.ok(html.includes('class="vi-root"'), `${lang}: voice input mounted in the composer`);
    assert.ok(html.includes('data-state="idle"'), `${lang}: starts idle`);
    assert.ok(html.includes(`aria-label="${lang === 'ar' ? AR.idle : EN.idle}"`), `${lang}: idle aria label`);
  }
});
