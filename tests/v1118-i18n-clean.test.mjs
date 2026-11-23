import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.18 — I18N CLEAN: no mixed Arabic/English dictionary values.
//
// The founder keeps seeing bilingual fragments in the UI (PROOF under
// an Arabic line, "claim audit" inside Arabic prose, "Run dev" in an
// Arabic hint, a "still reasoning" style label leaking into a translation).
// This suite locks the dictionary down:
//   • EN slot of every key has no Arabic LETTERS;
//   • AR slot of every key has no English prose (only technical tokens);
//   • the newly added PROOF / claim-audit keys resolve in BOTH languages;
//   • no key is defined twice in the source.
//
//   node --test --test-force-exit tests/v1118-i18n-clean.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const I18N = join(ROOT, 'src', 'i18n.ts');
const raw = readFileSync(I18N, 'utf8');

/** Load the real dictionary out of i18n.ts. The store import is stripped
 *  (the hooks are never called here) and the module-local `D` is exported
 *  for inspection. esbuild transpiles the TS to CJS without bundling. */
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

// Arabic letters only — digits (Arabic-Indic "١٢٣") and punctuation are not
// "mixed language", and the numerals label intentionally shows ١٢٣.
const isArabicLetter = (ch) =>
  /\p{Script=Arabic}/u.test(ch) && /\p{Alphabetic}/u.test(ch);
const hasArabicLetters = (s) => [...String(s)].some(isArabicLetter);

// Technical tokens / product names / placeholders that are legitimately the
// same in both languages (the task's allowlist: MCP, LSP, PDF, file names…).
const TECHNICAL = new Set(`
  MCP LSP PDF API URL HTML CSS JSON JSONL SSE HTTP HTTPS SQL ZIP CLI OS CPU RAM
  UI AI GPT GLM DNA RTL LTR CI PR QA SLA BYOK GPU IDE SDK
  PROOF PRO FREE TEAM OK ON OFF AUTO START STOP RUN DONE ERROR WARN FAIL PASS
  Ctrl Esc Enter SHIFT START STOP MARKDOWN Markdown REST Node Python npm git
  KDX KODEX20 Stripe Bearer OpenRouter Anthropic OpenAI DeepSeek Ollama Gemini
  Claude SQLite Excel PowerPoint Word grep glob stdio cwd realpath scrypt
  cron daily hourly weekly monthly yearly sudo fork rm
  SKILL.md MEMORY.md AGENTS.md CLAUDE.md plan.md package.json dna.json
  index.html appData audit.jsonl openrouter.ai github.com
`.trim().split(/\s+/));

const latinWords = (s) => s.match(/[A-Za-z][A-Za-z0-9_.-]*/g) || [];
/** Latin words in an AR value that are NOT allowed technical tokens. */
function foreignWords(ar) {
  // {kind}, {n}, {path}… are runtime substitution tokens, not prose.
  const withoutParams = String(ar).replace(/\{[^}]*\}/g, ' ');
  return [...new Set(
    latinWords(withoutParams).filter((w) => !TECHNICAL.has(w) && !TECHNICAL.has(w.toLowerCase())),
  )];
}

// Keys repaired or added by this wave. Every one must be monolingual.
const TOUCHED = [
  // new PROOF toggle / claim-audit labels (A2)
  'chat.proof.toggle', 'chat.proof.title', 'chat.audit.title', 'chat.audit.quiet',
  // ProofRibbon strings promoted from inline `ar ? … : …` fallbacks
  'proof.center.title', 'proof.center.def', 'proof.center.checks', 'proof.noDetail',
  'proof.center.foot', 'proof.center.open', 'proof.close', 'proof.tag',
  'proof.tally.tip', 'proof.chips.label', 'proof.focus.showing', 'proof.focus.clear',
  // mixed AR values repaired in this wave
  'preview.diag.server', 'slash.changelog.desc', 'palette.empty',
];

// The onboarding hero deliberately prints a fixed Latin line and a fixed
// Arabic line in every UI language; those two keys are dual-display, not
// translation slots (see the D_A10_COCKPIT comment in i18n.ts).
const DUAL_DISPLAY = new Set(['ck.tagline.latin', 'ck.tagline.arabic']);
// A verbatim shell command is a technical token sequence, not prose.
const PROSE_ALLOW = new Set(['npm run typecheck']);

// ------------------------------------------------------------
// 1. Every key touched by this wave is single-language
// ------------------------------------------------------------
test('touched PROOF / audit keys exist and are monolingual (EN no Arabic, AR no English prose)', () => {
  for (const key of TOUCHED) {
    const pair = D[key];
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key}: missing [en, ar] pair`);
    const [en, ar] = pair;
    assert.equal(typeof en, 'string', `${key}: EN must be a string`);
    assert.equal(typeof ar, 'string', `${key}: AR must be a string`);
    assert.ok(en.length > 0 && ar.length > 0, `${key}: slots must not be empty`);
    assert.ok(!hasArabicLetters(en), `${key}: EN value contains Arabic: ${en}`);
    assert.deepEqual(foreignWords(ar), [], `${key}: AR value contains non-technical English: ${ar}`);
  }
});

// ------------------------------------------------------------
// 2. The new keys are reachable through the real makeT() resolver
// ------------------------------------------------------------
test('makeT resolves the new keys in both languages (no fallback to the key itself)', () => {
  const en = makeT('en');
  const ar = makeT('ar');
  for (const key of TOUCHED) {
    assert.equal(en(key), D[key][0], `makeT('en')(${key})`);
    assert.equal(ar(key), D[key][1], `makeT('ar')(${key})`);
    assert.notEqual(en(key), key, `${key}: EN resolver fell back to the raw key`);
    assert.notEqual(ar(key), key, `${key}: AR resolver fell back to the raw key`);
  }
});

// ------------------------------------------------------------
// 3. Repaired values no longer carry the founder's mixed fragments
// ------------------------------------------------------------
test('repaired AR hints no longer leak English phrases ("Run dev", "commits", "terminal")', () => {
  assert.ok(!D['preview.diag.server'][1].includes('Run dev'));
  assert.ok(!D['slash.changelog.desc'][1].includes('commits'));
  assert.ok(!D['palette.empty'][1].includes('terminal'));
});

// ------------------------------------------------------------
// 4. No duplicate keys in the source (Object.assign overrides removed)
// ------------------------------------------------------------
test('i18n.ts defines every dictionary key exactly once', () => {
  const seen = new Map();
  const re = /'([^']+)'\s*:\s*\[/g;
  let match;
  while ((match = re.exec(raw))) {
    seen.set(match[1], (seen.get(match[1]) || 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(duplicates, [], `duplicate dictionary keys: ${duplicates.join(', ')}`);
});

// ------------------------------------------------------------
// 5. Whole-dictionary sweep: no accidental mixing anywhere
// ------------------------------------------------------------
test('every EN value in the dictionary is free of Arabic letters', () => {
  for (const [key, [en]] of Object.entries(D)) {
    if (DUAL_DISPLAY.has(key)) continue;
    assert.ok(!hasArabicLetters(en), `${key}: EN value contains Arabic: ${en}`);
  }
});

test('every AR value in the dictionary is free of English prose', () => {
  // Three or more consecutive Latin words is a sentence/phrase, not a
  // technical token. Single command names, file names and placeholders are
  // explicitly allowed (TECHNICAL above).
  const PROSE_RE = /[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_.-]*){2,}/g;
  for (const [key, [, ar]] of Object.entries(D)) {
    if (DUAL_DISPLAY.has(key)) continue;
    for (const phrase of ar.match(PROSE_RE) || []) {
      assert.ok(PROSE_ALLOW.has(phrase), `${key}: English prose in AR value: "${phrase}"`);
    }
  }
});
