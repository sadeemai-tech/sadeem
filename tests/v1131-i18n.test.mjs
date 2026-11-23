import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.31 — CAPABILITY AGENT (language / i18n) FULL SWEEP.
//
// Locks the WHOLE dictionary down and proves the whole src/ t() surface
// resolves:
//   • no EN slot carries Arabic letters;
//   • no AR slot carries English prose (3+ consecutive Latin words outside
//     the technical allowlist);
//   • every entry is a well-formed, non-empty [en, ar] pair;
//   • no dictionary key is defined twice in the source (Object.assign shadow);
//   • no dictionary value is its own raw key ("no raw keys shown");
//   • every t('key') referenced anywhere under src/ exists in the dictionary;
//   • makeT() resolves both languages for every key, and fallbacks are sane;
//   • the 9 keys added this wave resolve, and the live-fallback keys keep
//     rendering their call-site (digit-formatted) value.
//
//   node --test --test-force-exit tests/v1131-i18n.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const I18N = join(ROOT, 'src', 'i18n.ts');
const raw = readFileSync(I18N, 'utf8');

/** Load the real dictionary + resolver (strip the store import; export D). */
function loadI18n() {
  const source = raw.replace(/^import[^\n]*;\s*$/gm, '') + '\nexport { D };';
  const js = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  const Module = require('module');
  const mod = new Module(I18N);
  mod.filename = I18N;
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(js, I18N);
  return mod.exports;
}
const { D, makeT } = loadI18n();

// Arabic letters only — Arabic-Indic digits and punctuation are not prose.
const isArabicLetter = (ch) =>
  /\p{Script=Arabic}/u.test(ch) && /\p{Alphabetic}/u.test(ch);
const hasArabic = (s) => [...String(s ?? '')].some(isArabicLetter);

// Technical tokens / product names / file names legitimately identical in
// both languages (same allowlist as the v11.21 final sweep).
const TECHNICAL = new Set(`
  MCP LSP PDF API URL HTML CSS JSON JSONL SSE HTTP HTTPS SQL ZIP CLI OS CPU RAM
  UI AI GPT GLM DNA RTL LTR CI PR QA SLA BYOK GPU IDE SDK
  PROOF PRO FREE TEAM OK ON OFF AUTO START STOP RUN DONE ERROR WARN FAIL PASS
  Ctrl Esc Enter SHIFT MARKDOWN Markdown REST Node Python npm git
  KDX KODEX20 Stripe Bearer OpenRouter Anthropic OpenAI DeepSeek Ollama Gemini
  Claude SQLite Excel PowerPoint Word grep glob stdio cwd realpath scrypt
  cron daily hourly weekly monthly yearly sudo fork rm
  reasoning_effort o-series GPT-5 http_request web_search web_fetch download_file
  search_web open_path browser_screenshot browser_ browser_* CDP PTY WAV MP3
  GLM-ASR Whisper-large-v3 Whisper-1 Z.AI GLM Groq Moonshot Mistral Qwen
  Django FastAPI uvicorn Flask Vite Next Nuxt Angular Astro Expo
  sadeem surnia appData github.com openrouter.ai npm outdated git diff
  SKILL.md MEMORY.md AGENTS.md CLAUDE.md plan.md package.json dna.json
  index.html audit.jsonl main.log worktreeinclude
  go rust php rails python node vite react electron
  https http www com org net io ai dev app zip png jpg svg csv md json jsonl
  html js ts tsx py xml yaml yml toml pty wav mp3 asr whisper
`.trim().split(/\s+/).map((w) => w.toLowerCase()));

const stripPlaceholders = (s) => String(s ?? '')
  .replace(/\$\{[^}]*\}/g, ' ')
  .replace(/\{\{[^}]*\}\}/g, ' ')
  .replace(/\{[^}]*\}/g, ' ');

const isTechnicalToken = (w) => {
  const lw = w.toLowerCase();
  if (TECHNICAL.has(lw)) return true;
  if (/^(https?:|www\.)/.test(lw)) return true;
  if (/^[A-Z0-9_./-]+$/.test(w)) return true;
  if (/^[a-z0-9]+[._/-][a-z0-9._/-]*$/i.test(w) && !/^[A-Z][a-z]+$/.test(w)) return true;
  if (/^\d/.test(w)) return true;
  return false;
};

const PROSE_RE = /[A-Za-z][A-Za-z0-9_.\/-]*(?:\s+[A-Za-z][A-Za-z0-9_.\/-]*){2,}/g;
function englishProseIn(ar) {
  const cleaned = stripPlaceholders(ar);
  const bad = [];
  for (const run of cleaned.match(PROSE_RE) || []) {
    const words = run.split(/\s+/).filter(Boolean);
    let streak = [];
    for (const w of words) {
      if (isTechnicalToken(w)) {
        if (streak.length >= 3) bad.push(streak.join(' '));
        streak = [];
      } else {
        streak.push(w);
      }
    }
    if (streak.length >= 3) bad.push(streak.join(' '));
  }
  return bad;
}

// Cockpit hero identity lines are dual-display copy (both slots identical by
// design) — excluded only from the monolingual value checks, as in v11.21.
const DUAL_DISPLAY = new Set(['ck.tagline.latin', 'ck.tagline.arabic']);

// Keys added by this wave — derived from the two blocks this agent owns, so
// the coverage grows automatically as sibling agents add t() calls.
function addedKeys() {
  const keys = new Set();
  for (const block of ['D_V1131_I18N_SWEEP', 'D_V1131_WAVE_COORD']) {
    const start = raw.indexOf(`const ${block}`);
    assert.notEqual(start, -1, `${block} block missing from i18n.ts`);
    const body = raw.slice(start, raw.indexOf('Object.assign(D,', start));
    const re = /['"]([^'"]+)['"]\s*:\s*\[/g;
    let m;
    while ((m = re.exec(body))) keys.add(m[1]);
  }
  assert.ok(keys.size > 0, 'no wave keys found');
  return [...keys];
}
const ADDED_KEYS = addedKeys();

// Keys rendered live at the call site (digit formatting / two short units /
// running-error-idle state).
const LIVE_FALLBACK_KEYS = [
  'mv.compaction', 'mv.findings.count', 'mv.unit.lines', 'sb.led.state',
  'set.updates.feed.hint.v1131',
];

// ------------------------------------------------------------
// 1. No duplicate dictionary keys in the source.
// ------------------------------------------------------------
test('i18n.ts defines every dictionary key exactly once', () => {
  const seen = new Map();
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const re = /['"]([^'"]+)['"]\s*:\s*\[/g;
  let m;
  while ((m = re.exec(code))) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(duplicates, [], `duplicate dictionary keys: ${duplicates.join(', ')}`);
});

// ------------------------------------------------------------
// 2. Whole-dictionary language sweep.
// ------------------------------------------------------------
test('every EN value is free of Arabic letters', () => {
  for (const [key, pair] of Object.entries(D)) {
    if (DUAL_DISPLAY.has(key)) continue;
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: expected [en, ar]`);
    assert.ok(!hasArabic(pair[0]), `${key}: EN value contains Arabic: ${pair[0]}`);
  }
});

test('every AR value is free of English prose (3+ Latin words)', () => {
  for (const [key, pair] of Object.entries(D)) {
    if (DUAL_DISPLAY.has(key)) continue;
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: expected [en, ar]`);
    assert.deepEqual(englishProseIn(pair[1]), [],
      `${key}: English prose in AR value: "${pair[1]}"`);
  }
});

test('every entry is a well-formed, non-empty [en, ar] pair', () => {
  for (const [key, pair] of Object.entries(D)) {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: expected [en, ar]`);
    assert.equal(typeof pair[0], 'string', `${key}: EN must be a string`);
    assert.equal(typeof pair[1], 'string', `${key}: AR must be a string`);
    assert.ok(pair[0].length > 0 && pair[1].length > 0, `${key}: slots must not be empty`);
  }
});

test('no dictionary value is its own raw key (no raw keys shown)', () => {
  const offenders = Object.entries(D)
    .filter(([key, pair]) => pair[0] === key || pair[1] === key)
    .map(([key]) => key);
  assert.deepEqual(offenders, [], `raw keys would be shown: ${offenders.join(', ')}`);
});

// ------------------------------------------------------------
// 3. Every t() key used under src/ exists.
// ------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}
function srcTKeys() {
  const keys = new Set();
  const patterns = [/\bt\(\s*'([^']+)'/g, /\bt\(\s*"([^"]+)"/g];
  for (const file of walk(join(ROOT, 'src'))) {
    const txt = readFileSync(file, 'utf8');
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt))) keys.add(m[1]);
    }
  }
  return keys;
}

test("every t() key used anywhere under src/ exists in the dictionary", () => {
  const used = srcTKeys();
  const missing = [...used].filter((k) => !(k in D)).sort();
  assert.deepEqual(missing, [], `src t() keys missing from dictionary: ${missing.join(', ')}`);
});

// ------------------------------------------------------------
// 4. Resolver: sane fallbacks, both languages, new keys, live fallbacks.
// ------------------------------------------------------------
test('makeT resolves every key in both languages without showing the raw key', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  for (const key of Object.keys(D)) {
    assert.equal(en(key), D[key][0], `makeT('en')(${key})`);
    assert.equal(ar(key), D[key][1], `makeT('ar')(${key})`);
    assert.notEqual(en(key), key, `${key}: EN resolver returned raw key`);
    assert.notEqual(ar(key), key, `${key}: AR resolver returned raw key`);
  }
});

test('makeT fallbacks are sane: use fallback for unknown keys, key only as last resort', () => {
  const en = makeT('en');
  assert.equal(en('no.such.key', 'A sane fallback'), 'A sane fallback');
  assert.equal(en('no.such.key'), 'no.such.key'); // last resort only
  assert.equal(en('chat.copyFailed', 'unused'), 'Could not copy'); // known key ignores fallback
});

test('all keys added this wave resolve in BOTH languages', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  for (const key of ADDED_KEYS) {
    assert.ok(key in D, `${key}: missing from dictionary`);
    assert.equal(en(key), D[key][0], `makeT('en')(${key})`);
    assert.equal(ar(key), D[key][1], `makeT('ar')(${key})`);
    assert.notEqual(en(key), key, `${key}: EN resolver fell back to raw key`);
    assert.notEqual(ar(key), key, `${key}: AR resolver fell back to raw key`);
  }
});

test('live-fallback keys keep their call-site value, canonical value intact', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  for (const key of LIVE_FALLBACK_KEYS) {
    assert.ok(key in D, `${key}: missing from dictionary`);
    // With a live (digit-formatted) fallback, the call-site value wins.
    assert.equal(en(key, 'CTX 90% → 40%'), 'CTX 90% → 40%', `${key} EN live fallback`);
    assert.equal(ar(key, 'ضغط السياق ٩٠٪ ← ٤٠٪'), 'ضغط السياق ٩٠٪ ← ٤٠٪', `${key} AR live fallback`);
    // Without a fallback, the canonical dictionary value is returned.
    assert.equal(en(key), D[key][0], `${key} EN canonical`);
    assert.equal(ar(key), D[key][1], `${key} AR canonical`);
  }
});
