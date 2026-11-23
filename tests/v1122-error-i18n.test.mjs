import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.22 — ERROR I18N: the founder is furious about the raw English
// "Invalid run parameters (missing messages or model)" leaking to users.
// This suite locks down the new honest, single-language failure keys:
//   • whole-dictionary monolingual sweep (G14 rule): EN values carry no
//     Arabic letters; AR values carry no 3+ consecutive Latin words
//     outside the technical allowlist;
//   • no duplicate dictionary keys (Object.assign overrides);
//   • every new err.run.* / err.setup.* key resolves in BOTH languages;
//   • source-level wiring report for the fix agents' files
//     (src/store.ts, electron/agent/register.ts) — keys not wired yet are
//     REPORTED, not failed; those files are owned by A6/A7, not this agent.
//
//   node --test --test-force-exit tests/v1122-error-i18n.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const I18N = join(ROOT, 'src', 'i18n.ts');
const raw = readFileSync(I18N, 'utf8');

/** Load the real dictionary (strip the store import; export local D), exactly
 *  as the G14 suites do, so we test the shipped makeT() resolver itself. */
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

// ---- G14 monolingual rules (copied from v1121-i18n-final) ----
const isArabicLetter = (ch) =>
  /\p{Script=Arabic}/u.test(ch) && /\p{Alphabetic}/u.test(ch);
const hasArabic = (s) => [...String(s ?? '')].some(isArabicLetter);

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

// Hero identity lines are deliberate dual-display copy (same string in both
// slots) — excluded from the sweep exactly as in the G14 suite.
const DUAL_DISPLAY = new Set(['ck.tagline.latin', 'ck.tagline.arabic']);

// The 8 keys introduced by this wave. Each is strictly monolingual per slot.
const NEW_KEYS = [
  'err.run.badParams',
  'err.run.noUserMessage',
  'err.run.rateLimited',
  'err.run.providerUnavailable',
  'err.setup.noModel',
  'err.setup.noWorkspace',
  'err.setup.noApiKey',
  'err.setup.noCredits',
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
// 2. Whole-dictionary monolingual sweep (G14 rule).
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

// ------------------------------------------------------------
// 3. Every new key resolves in BOTH languages, no raw-key fallback.
// ------------------------------------------------------------
test('every new err.run.* / err.setup.* key resolves in both languages', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  for (const key of NEW_KEYS) {
    assert.ok(key in D, `${key}: missing from dictionary`);
    assert.ok(Array.isArray(D[key]) && D[key].length === 2, `${key}: expected [en, ar]`);
    assert.ok(D[key][0].length > 0 && D[key][1].length > 0, `${key}: slots must not be empty`);
    assert.equal(en(key), D[key][0], `makeT('en')(${key})`);
    assert.equal(ar(key), D[key][1], `makeT('ar')(${key})`);
    assert.notEqual(en(key), key, `${key}: EN resolver fell back to the raw key`);
    assert.notEqual(ar(key), key, `${key}: AR resolver fell back to the raw key`);
  }
});

// ------------------------------------------------------------
// 4. Wording is precise + actionable, and the credits key reuses the
//    already-shipped v11.19 bilingual wording (no invented text).
// ------------------------------------------------------------
test('new messages name the missing thing and the exact next step', () => {
  // Each new EN message names the exact next step; each AR message is a
  // complete Arabic sentence (no dangling English fragment).
  const NEXT_STEP = {
    'err.run.badParams': 'Settings → AI providers, choose a model',
    'err.run.noUserMessage': 'Type a task in the composer and press Send',
    'err.run.rateLimited': 'Settings → AI providers',
    'err.run.providerUnavailable': 'Settings → AI providers',
    'err.setup.noModel': 'Settings → AI providers and choose a model',
    'err.setup.noWorkspace': 'Open a project folder first',
    'err.setup.noApiKey': 'Settings → AI providers and add a key',
    'err.setup.noCredits': 'Settings → Providers',
  };
  for (const key of NEW_KEYS) {
    const [en, ar] = D[key];
    assert.ok(en.includes(NEXT_STEP[key]), `${key}: EN must give the exact next step "${NEXT_STEP[key]}"`);
    assert.ok(/[.]$/.test(ar.trim()), `${key}: AR must be a complete sentence`);
  }
  // The founder's exact leak is gone: no vague "invalid parameters".
  assert.doesNotMatch(D['err.run.badParams'][0], /invalid parameters/i);
  assert.doesNotMatch(D['err.run.badParams'][0], /missing messages or model/i);
  // 402 credits wording is REUSED verbatim from the existing renderer toast.
  assert.equal(
    D['err.setup.noCredits'][1],
    'رصيد غير كافٍ: حساب المزوّد ليس لديه رصيد. أضف رصيداً أو بدّل المزوّد/المفتاح من الإعدادات ← المزوّدون.',
    'err.setup.noCredits AR must reuse the shipped noCreditsToast text',
  );
  assert.equal(
    D['err.setup.noCredits'][0],
    'Insufficient credits: add balance to the provider account or switch the provider/key in Settings → Providers.',
    'err.setup.noCredits EN must reuse the shipped noCreditsToast text',
  );
});

// ------------------------------------------------------------
// 5. Source-level wiring REPORT for the fix-agent files.
//    store.ts / register.ts are owned by A6/A7 — this agent does NOT
//    edit them. Keys not yet wired are reported (via t.diagnostic),
//    not failed, so this suite stays green before A6/A7 land. Once
//    wired, the report simply shows 8/8 connected.
// ------------------------------------------------------------
const FIX_FILES = [
  join(ROOT, 'src', 'store.ts'),
  join(ROOT, 'electron', 'agent', 'register.ts'),
];
const FIX_SOURCES = FIX_FILES.map((p) => readFileSync(p, 'utf8'));

test('source-level wiring status of new keys in store.ts / register.ts (report only)', (t) => {
  assert.equal(NEW_KEYS.length, 8, 'all 8 failure keys must be tracked in the wiring report');
  const wired = [];
  const pending = [];
  for (const key of NEW_KEYS) {
    const present = FIX_SOURCES.some((src) => src.includes(key));
    (present ? wired : pending).push(key);
    t.diagnostic(`${key}: ${present ? 'WIRED in store.ts/register.ts' : 'PENDING — A6/A7 must call t(\'' + key + '\')'}`);
  }
  t.diagnostic(`wiring: ${wired.length}/${NEW_KEYS.length} wired; pending: ${pending.join(', ') || 'none'}`);
  // Reporting test: it never fails on unwired keys (A6/A7 own those files),
  // but it proves the report covered every new key.
  assert.equal(wired.length + pending.length, NEW_KEYS.length);
});
