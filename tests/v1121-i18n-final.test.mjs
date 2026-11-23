import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.21 — I18N FINAL: the founder keeps seeing mixed Arabic+English
// in the UI when one language is selected. This suite locks the WHOLE
// dictionary down (not just a few touched keys) and proves every t()
// key referenced by a component actually resolves:
//   • no EN value carries Arabic letters;
//   • no AR value carries English prose (3+ consecutive Latin words
//     outside a technical allowlist: MCP, LSP, PDF, npm, git, file
//     names, URLs, {placeholders});
//   • no key is defined twice in the source (Object.assign overrides);
//   • every t('key') used under src/components exists in the dictionary;
//   • the new component keys resolve through the real makeT() resolver.
//
//   node --test --test-force-exit tests/v1121-i18n-final.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const I18N = join(ROOT, 'src', 'i18n.ts');
const raw = readFileSync(I18N, 'utf8');

/** Load the real dictionary (strip the store import; export local D). */
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

// Technical tokens / product names / file names that are legitimately the
// same in both languages. Single command names, file names and URLs are also
// excluded below by pattern; {placeholders} are stripped before scanning.
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
  .replace(/\$\{[^}]*\}/g, ' ')   // ${runtime} template values
  .replace(/\{\{[^}]*\}\}/g, ' ')  // {{braces}}
  .replace(/\{[^}]*\}/g, ' ');     // {name}, {n}, {path}…

const isTechnicalToken = (w) => {
  const lw = w.toLowerCase();
  if (TECHNICAL.has(lw)) return true;
  if (/^(https?:|www\.)/.test(lw)) return true;
  if (/^[A-Z0-9_./-]+$/.test(w)) return true;                       // ALL-CAPS stamps / paths
  if (/^[a-z0-9]+[._/-][a-z0-9._/-]*$/i.test(w) && !/^[A-Z][a-z]+$/.test(w)) return true; // identifiers
  if (/^\d/.test(w)) return true;
  return false;
};

/** Runs of 3+ consecutive Latin word-sequences in a string. */
const PROSE_RE = /[A-Za-z][A-Za-z0-9_.\/-]*(?:\s+[A-Za-z][A-Za-z0-9_.\/-]*){2,}/g;
/** Non-allowlisted consecutive Latin words inside an AR value. */
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

// The two cockpit hero identity lines are deliberately printed in BOTH
// scripts in every UI language. Their two slots intentionally carry the
// same string — they are dual-display copy, not translation slots.
// (The onboarding capability lines were monolingualised in this wave —
// each slot now holds one language — so they are NOT excluded here.)
const DUAL_DISPLAY = new Set([
  'ck.tagline.latin', 'ck.tagline.arabic',
]);

// Keys added by this wave (new circle / voice / context / component surfaces).
const ADDED_KEYS = [
  // circle / orbital plate (SubagentsPanel)
  'sa.plate.a11y', 'sa.plate.hint',
  // voice input (chat + settings)
  'chat.voice.listening', 'chat.voice.processing', 'chat.voice.noDevice',
  'chat.voice.result', 'chat.voice.sent', 'chat.voice.steady', 'chat.voice.unsupported',
  'settings.voice.asrProvider', 'settings.voice.asrProvider.hint',
  'settings.voice.asrModel', 'settings.voice.asrModel.hint',
  'settings.voice.device', 'settings.voice.device.hint',
  'settings.voice.language', 'settings.voice.language.hint',
  'settings.voice.autoSend', 'settings.voice.autoSend.hint',
  'settings.voice.record', 'settings.voice.stop', 'settings.voice.test',
  'settings.voice.testHint', 'settings.voice.copy', 'settings.voice.note',
  // context lens / ring (ContextLens + StatusBar)
  'sb.ring.copy', 'sb.ring.copied', 'sb.ring.copyHint',
  'sb.ring.ctxUnknownShort', 'sb.ring.freshInput', 'sb.ring.generated',
  'sb.ring.remaining', 'chat.lens.title', 'chat.lens.hint',
  // browser dock (live screenshot circle)
  'bdock.title', 'bdock.idle', 'bdock.shotAlt', 'bdock.noShot.title',
  // proof tally words
  'proof.tally.pass', 'proof.tally.fail',
];

// ------------------------------------------------------------
// 1. No duplicate dictionary keys in the source.
// ------------------------------------------------------------
test('i18n.ts defines every dictionary key exactly once', () => {
  const seen = new Map();
  // Strip comments so illustrative `'key': [...]` in prose is not counted.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Match both single- and double-quoted keys (the final block uses JSON-string keys).
  const re = /['"]([^'"]+)['"]\s*:\s*\[/g;
  let m;
  while ((m = re.exec(code))) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(duplicates, [], `duplicate dictionary keys: ${duplicates.join(', ')}`);
});

// ------------------------------------------------------------
// 2. Whole-dictionary sweep — no value mixes languages.
// ------------------------------------------------------------
test('every EN value in the dictionary is free of Arabic letters', () => {
  for (const [key, pair] of Object.entries(D)) {
    if (DUAL_DISPLAY.has(key)) continue;
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: expected [en, ar]`);
    assert.ok(!hasArabic(pair[0]), `${key}: EN value contains Arabic: ${pair[0]}`);
  }
});

test('every AR value in the dictionary is free of English prose', () => {
  for (const [key, pair] of Object.entries(D)) {
    if (DUAL_DISPLAY.has(key)) continue;
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: expected [en, ar]`);
    const bad = englishProseIn(pair[1]);
    assert.deepEqual(bad, [], `${key}: English prose in AR value: "${pair[1]}" -> ${JSON.stringify(bad)}`);
  }
});

test('every dictionary entry is a well-formed, non-empty [en, ar] pair', () => {
  for (const [key, pair] of Object.entries(D)) {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: expected [en, ar]`);
    assert.equal(typeof pair[0], 'string', `${key}: EN must be a string`);
    assert.equal(typeof pair[1], 'string', `${key}: AR must be a string`);
    assert.ok(pair[0].length > 0 && pair[1].length > 0, `${key}: slots must not be empty`);
  }
});

// ------------------------------------------------------------
// 3. Every t() key referenced by a component exists.
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
function componentTKeys() {
  const keys = new Set();
  const patterns = [/\bt\(\s*'([^']+)'/g, /\bt\(\s*"([^"]+)"/g];
  for (const file of walk(join(ROOT, 'src', 'components'))) {
    const txt = readFileSync(file, 'utf8');
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt))) keys.add(m[1]);
    }
  }
  return keys;
}

test("every t() key used under src/components exists in the dictionary", () => {
  const used = componentTKeys();
  const missing = [...used].filter((k) => !(k in D)).sort();
  assert.deepEqual(missing, [], `component t() keys missing from dictionary: ${missing.join(', ')}`);
});

// ------------------------------------------------------------
// 4. The new keys resolve through the real makeT() resolver.
// ------------------------------------------------------------
test('new circle/voice/context keys resolve in BOTH languages', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  for (const key of ADDED_KEYS) {
    assert.ok(key in D, `${key}: missing from dictionary`);
    assert.equal(en(key), D[key][0], `makeT('en')(${key})`);
    assert.equal(ar(key), D[key][1], `makeT('ar')(${key})`);
    assert.notEqual(en(key), key, `${key}: EN resolver fell back to the raw key`);
    assert.notEqual(ar(key), key, `${key}: AR resolver fell back to the raw key`);
  }
});

test('repaired mixed-language fallbacks are now monolingual', () => {
  assert.ok(!hasArabic(D['rail.more.title'][0]), 'rail.more.title EN must be pure English');
  assert.ok(!hasArabic(D['skills.market.title'][0]), 'skills.market.title EN must be pure English');
  assert.deepEqual(englishProseIn(D['rail.more.title'][1]), [], 'rail.more.title AR must be pure Arabic');
  assert.deepEqual(englishProseIn(D['skills.market.title'][1]), [], 'skills.market.title AR must be pure Arabic');
});
