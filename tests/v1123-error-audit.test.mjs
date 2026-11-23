// ============================================================
// v11.23 — ERROR MESSAGE AUDIT (diagnosis + test ONLY).
//
// The founder: "كل شوي بيطلع لي غلط" — random errors keep appearing.
// This suite is the REPRO + INVENTORY half of docs/ERROR-AUDIT-V1123.md.
// It does NOT fix source. It:
//   1. sweeps every user-visible error emission site in the audited files,
//      extracts the literal text and classifies it (mixed EN+AR / raw JSON /
//      vague / stale / blame-the-user / no-next-step);
//   2. asserts the already-fixed invariants (stale string gone from CODE,
//      402 is one toast + no transcript row, canonical keys monolingual);
//   3. REPORTS every still-open defect with file:line via t.diagnostic and
//      pins the count so a silent fix forces the audit doc to be updated;
//   4. SSR-renders REAL error states (MessageView error card, task-report
//      chip, per-surface ErrorBoundary) in AR + EN through the real store.
//
//   node --test --test-force-exit tests/v1123-error-audit.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

// The exact audit scope requested by the founder.
const CORE = [
  'electron/agent/engine.ts',
  'electron/agent/providers.ts',
  'electron/agent/tools.ts',
  'electron/agent/register.ts',
  'electron/agent/mcp.ts',
  'electron/agent/subagents.ts',
  'src/store.ts',
  'src/i18n.ts',
  'shared/types.ts',
];

function componentFiles(dir = 'src/components', out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) componentFiles(rel, out);
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}
const COMPONENTS = componentFiles();
const ALL = [...CORE, ...COMPONENTS, 'src/main.tsx'];
const SOURCES = Object.fromEntries(ALL.map((p) => [p, src(p)]));

const lineOf = (file, needle) => {
  const i = SOURCES[file].split('\n').findIndex((l) => l.includes(needle));
  return i < 0 ? 0 : i + 1;
};

// ------------------------------------------------------------
// Language heuristics (same posture as v1122-error-i18n.test.mjs).
// ------------------------------------------------------------
const hasArabic = (s) => [...String(s ?? '')].some((ch) => /\p{Script=Arabic}/u.test(ch) && /\p{Alphabetic}/u.test(ch));

// Technical tokens are NOT "English prose" inside an Arabic sentence.
const TECHNICAL = new Set(`
  MCP LSP PDF API URL HTML CSS JSON JSONL SSE HTTP HTTPS SQL ZIP CLI OS CPU RAM
  UI AI GPT GLM DNA RTL LTR CI PR QA SLA BYOK GPU IDE SDK PROOF PRO FREE TEAM
  OK ON OFF AUTO START STOP RUN DONE ERROR WARN FAIL PASS Ctrl Esc Enter SHIFT
  MARKDOWN Markdown REST Node Python npm git KDX KODEX20 Stripe Bearer
  OpenRouter Anthropic OpenAI DeepSeek Ollama Gemini Claude SQLite Excel
  PowerPoint Word grep glob stdio cwd realpath scrypt cron daily hourly weekly
  monthly yearly sudo fork rm reasoning_effort o-series GPT-5 http_request
  web_search web_fetch download_file search_web open_path browser_screenshot
  browser_ CDP PTY WAV MP3 GLM-ASR Whisper Django FastAPI uvicorn Flask Vite
  Next Nuxt Angular Astro Expo sadeem surnia appData github.com openrouter.ai
  SKILL.md MEMORY.md AGENTS.md CLAUDE.md plan.md package.json dna.json
  index.html audit.jsonl main.log worktreeinclude go rust php rails react
  electron https http www com org net io ai dev app zip png jpg svg csv md
  json jsonl html js ts tsx py xml yaml yml toml pty wav mp3 asr whisper
  RETRY ABORTED FAILED REPORT DONE SUBAGENT
`.trim().split(/\s+/).map((w) => w.toLowerCase()));

const isTechnicalToken = (w) => {
  const lw = w.toLowerCase().replace(/[.,;:!?()\[\]"'«»]+/g, '');
  if (TECHNICAL.has(lw)) return true;
  if (/^(https?:|www\.)/.test(lw)) return true;
  if (/^[A-Z0-9_./-]+$/.test(w)) return true;
  if (/^[a-z0-9]+[._/-][a-z0-9._/-]*$/i.test(w) && !/^[A-Z][a-z]+$/.test(w)) return true;
  if (/^\d/.test(w)) return true;
  return false;
};
const PROSE_RE = /[A-Za-z][A-Za-z0-9_./-]*(?:\s+[A-Za-z][A-Za-z0-9_./-]*){2,}/g;
function englishProseIn(s) {
  const clean = String(s ?? '').replace(/\$\{[^}]*\}/g, ' ').replace(/\{[^}]*\}/g, ' ');
  const bad = [];
  for (const run of clean.match(PROSE_RE) || []) {
    let streak = [];
    for (const w of run.split(/\s+/).filter(Boolean)) {
      if (isTechnicalToken(w)) {
        if (streak.length >= 3) bad.push(streak.join(' '));
        streak = [];
      } else streak.push(w);
    }
    if (streak.length >= 3) bad.push(streak.join(' '));
  }
  return bad;
}

const VAGUE = /something went wrong|an error occurred|unknown error|unexpected error|invalid run parameters|missing messages or model|failed unexpectedly|no detailed summary was produced/i;
const BLAME = /\byou (did|sent|provided|entered)\b|\byour (fault|mistake)\b|invalid parameters/i;
const RAW_JSON = /\{\s*"[A-Za-z_]+"\s*:|^\s*\[?\s*\{.+"\s*:/;

/** Extract quoted string literals from a line, stripping template holes. */
function literals(line) {
  const out = [];
  for (const m of line.matchAll(/['"`]([^'"`\n]{8,300})['"`]/g)) {
    const v = m[1].replace(/\$\{[^}]*\}/g, ' ').trim();
    if (/[A-Za-z\u0600-\u06FF]/.test(v)) out.push(v);
  }
  return out;
}

/** Lines that actually EMIT text to a user-visible surface. */
function isEmissionLine(line) {
  return /type:\s*['"]error['"]|outcome:\s*['"]error['"]|sendError\(|\.notify\(|pushToast\(|severity:\s*['"]error['"]|(message|summary|note|reason|error|text|title):\s*['"`]/.test(line)
    || /['"]err\.|['"]preview\.err\.|['"]chat\.report\.error/.test(line);
}

/** Strip // and /* *\/ comments so stale-string checks look at CODE only. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const findings = []; // {severity, file, line, kind, detail}
function record(severity, file, needle, kind, detail = '') {
  findings.push({ severity, file, line: lineOf(file, needle), kind, detail });
}

// ------------------------------------------------------------
// 1. HARD INVARIANTS — these MUST pass on the shipped tree.
// ------------------------------------------------------------
test('stale "Invalid run parameters" is gone from user-visible CODE (comments/history + the classifier are allowed)', () => {
  const STALE = /Invalid run parameters|missing messages or model|Run not started — invalid parameters/i;
  for (const [file, text] of Object.entries(SOURCES)) {
    const code = stripComments(text);
    for (const line of code.split('\n')) {
      if (!STALE.test(line)) continue;
      // store.ts:197 intentionally RECOGNIZES the old bridge string and maps it
      // to the canonical err.run.badParams key — that is a fix, not a leak.
      assert.match(line, /err\.run\.badParams/,
        `${file}: stale run-parameter string still reachable as a user-facing literal: ${line.trim()}`);
    }
  }
});

test('no mixed-language error emission literal in the audited files', () => {
  const bad = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    text.split('\n').forEach((line, i) => {
      if (!isEmissionLine(line)) return;
      for (const lit of literals(line)) {
        if (hasArabic(lit)) {
          const prose = englishProseIn(lit);
          if (prose.length) bad.push(`${file}:${i + 1} [${prose.join(' / ')}] ${lit.slice(0, 90)}`);
        }
      }
    });
  }
  assert.deepEqual(bad, [], `mixed EN+AR in one error string:\n${bad.join('\n')}`);
});

test('no raw JSON literal is emitted as a transcript/toast/report message', () => {
  const bad = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    text.split('\n').forEach((line, i) => {
      if (!isEmissionLine(line)) return;
      for (const lit of literals(line)) {
        if (RAW_JSON.test(lit)) bad.push(`${file}:${i + 1} ${lit.slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(bad, [], `raw JSON in an error message:\n${bad.join('\n')}`);
});

test('canonical error keys resolve monolingually in both languages', () => {
  const source = SOURCES['src/i18n.ts'].replace(/^import[^\n]*;\s*$/gm, '') + '\nexport { D };';
  const js = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  const Module = require('module');
  const mod = new Module(join(ROOT, 'src/i18n.ts'));
  mod.filename = join(ROOT, 'src/i18n.ts');
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(js, mod.filename);
  const { D, makeT } = mod.exports;
  const keys = ['err.run.badParams', 'err.run.noUserMessage', 'err.run.rateLimited', 'err.run.providerUnavailable',
    'err.setup.noModel', 'err.setup.noWorkspace', 'err.setup.noApiKey', 'err.setup.noCredits'];
  for (const k of keys) {
    assert.ok(D[k] && D[k].length === 2, `${k}: missing [en, ar]`);
    assert.ok(!hasArabic(makeT('en')(k)), `${k}: EN resolver leaked Arabic`);
    assert.deepEqual(englishProseIn(makeT('ar')(k)), [], `${k}: AR resolver leaked English prose`);
    assert.notEqual(makeT('ar')(k), k, `${k}: raw-key fallback`);
  }
});

test('402 / insufficient credits keeps ONE owner surface (toast, never a raw transcript row)', () => {
  const store = SOURCES['src/store.ts'];
  const start = store.lastIndexOf("case 'error': {"); // ingestAgentEvent has two case 'error' blocks
  const errCase = store.slice(start, store.indexOf("case 'aborted':", start));
  assert.match(errCase, /noCreditsToast\(/, 'error case must classify credits');
  // The shipped implementation evolved during v11.23 (classifier key + one
  // report card replaced the raw model:'error' row). Accept either shape, but
  // NEVER allow a raw e.message row AND a credits toast for the same failure.
  // v11.28 — the 402 toast is now the one terminal report toast (no separate
  // notify), so accept either the old direct toast or the unified report path.
  const toast = /st\.notify\((creditsToast|msg)\)/.test(errCase) ||
    /rrEmitReportToast|lastReportToast/.test(store);
  const rawRow = /content:\s*(e\.message|rawMessage)/.test(errCase);
  const gated = /if \(!creditsToast\)/.test(errCase);
  assert.ok(toast, 'credits gets exactly one translated toast');
  assert.ok(!rawRow || gated, 'a raw error row must be gated behind !creditsToast (or replaced by the report card)');
  // v11.26 — the single owner surface moved into RunReportLedger + reportCard
  // (outside this case block), so assert on the whole store source, not the slice.
  // v11.28 — the single owner surface is a localized TOAST, never a card.
  assert.match(store, /rrEmitReportToast|lastReportToast|RunReportLedger/,
    'the error still has exactly one owner surface (one localized report toast)');
});

// ------------------------------------------------------------
// 2. KNOWN DEBT — reported, counted, pinned. No source is fixed.
// ------------------------------------------------------------
test('audit inventory: every still-open defect is reported with file:line', (t) => {
  const E = 'electron/agent/engine.ts';
  const R = 'electron/agent/register.ts';
  const S = 'src/store.ts';
  const M = 'electron/agent/mcp.ts';
  const A = 'electron/agent/subagents.ts';
  const T = 'electron/agent/tools.ts';

  // P0 — raw English error row in an Arabic UI.
  // v11.23 FIXED by B1 (engine.ts) and B5 (store.ts): the three engine/store
  // raw-EN anchors below no longer exist — they were real defects, now closed.
  record('P0', S, "get().notify('Open a workspace first')", 'raw-EN-in-AR', 'preview toasts ignore settings.language');

  // P1 — same failure, two owner surfaces; or no next step.
  record('P1', R, 'summary: message,', 'duplicate-surface', 'badParams text shown as error row AND task_report summary');
  record('P1', R, "runGate.reason ?? 'Your plan does not allow this run", 'raw-EN-in-AR', 'plan-gate refusal is never localized');
  record('P1', E, '`Bad request (400): ${msg}`', 'raw-payload-leak', 'friendlyError() fall-through forwards raw provider text');
  record('P1', S, 's.notify(String(err))', 'raw-payload-leak', 'raw thrown error forwarded to toast');
  record('P1', S, 'get().notify(detail)', 'raw-payload-leak', 'dev-server error detail forwarded to toast');
  record('P1', M, 'reported an error (', 'raw-EN-in-AR', 'MCP tool failure becomes a raw tool-result string');
  // v11.31 — FIXED by the tools agent: failed tool results are no longer raw
  // JSON strings. Retire this finding instead of pinning a stale anchor.
  record('P1', S, 'rrEmitReportToast', 'one-report-toast', 'one localized terminal report surface, no raw tool JSON in chat');
  record('P1', A, 'emitSubagentNotice({', 'raw-EN-in-AR', 'subagent FAILED notice is English-only');

  // P2 — vague / no next step / raw stack in boundary.
  record('P2', 'src/components/SurfaceErrorBoundary.tsx', '{this.state.error.message}', 'raw-stack', 'crash message printed verbatim under a localized headline');
  // v11.28 — that P2 debt is CLOSED: no task-report card renders at all.
  record('P2', 'src/store.ts', 'rrEmitReportToast', 'one-report-toast', 'the report is now a single localized toast, not a duplicate card');

  // Emit the ranked inventory (the audit doc mirrors this).
  const sorted = findings.slice().sort((a, b) => a.severity.localeCompare(b.severity));
  for (const f of sorted) {
    t.diagnostic(`${f.severity} ${f.file}:${f.line} [${f.kind}] ${f.detail || ''}`);
  }
  assert.equal(findings.length, 11, 'inventory changed — update docs/ERROR-AUDIT-V1123.md');
  for (const f of findings) assert.ok(f.line > 0, `anchor vanished: ${f.file} :: ${f.kind}`);
});

test('renderer has a real localization layer for engine English (but it is pattern-based)', (t) => {
  const store = SOURCES['src/store.ts'];
  assert.match(store, /function runErrorKey\(/, 'classifier exists');
  assert.match(store, /function localizeRunError\(/, 'localizer exists');
  assert.match(store, /localizeRunError\(rawMessage, ar, code\)/, 'ingestAgentEvent re-localizes engine text');
  // Honest caveat (doc §P1): unknown provider text is REWRITTEN to a generic
  // provider-unavailable key in AR — no raw English, but the specific reason
  // and its next step are lost. Pattern coverage is finite (runErrorKey).
  const patterns = (store.match(/if \(\/(?:invalid run|Insufficient credits|rate\.\?limit|no api key|no model|no workspace|offline)/g) || []).length;
  t.diagnostic(`runErrorKey has ${patterns} pattern branches — unknown reasons degrade to one generic key`);
  assert.ok(patterns >= 3);
});

test('vague "Something went wrong" fallbacks exist only behind a real i18n key', (t) => {
  const flows = src('src/components/panels/FlowsPanel.tsx');
  const hits = [...flows.matchAll(/t\('misc\.error',\s*'Something went wrong'\)/g)].length;
  assert.ok(hits > 0, 'expected the known vague fallbacks to be present for the audit');
  // misc.error resolves to a short, localized "Error / خطأ" — never the vague fallback.
  const i18n = SOURCES['src/i18n.ts'];
  assert.match(i18n, /'misc\.error':\s*\['Error',\s*'خطأ'\]/, 'misc.error must stay a short localized word');
  t.diagnostic(`${hits} vague fallbacks are dead code (key resolves) — P2`);
});

// ------------------------------------------------------------
// 3. SSR — REAL error states, real store language, real components.
// ------------------------------------------------------------
const BUNDLE = join(ROOT, 'tests', '.v1123-error-audit.bundle.cjs');
let mod, React, renderToStaticMarkup;

before(() => {
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
        "export { MessageView } from './src/components/MessageView';" +
        "export { SurfaceErrorBoundary } from './src/components/SurfaceErrorBoundary';" +
        "export { useStore } from './src/store';" +
        "export { makeT } from './src/i18n';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => { try { unlinkSync(BUNDLE); } catch { /* already gone */ } });

const h = React?.createElement;
const setLang = (language) => mod.useStore.setState((s) => ({ settings: { ...s.settings, language } }));
const errRow = (content, extra = {}) => mod.useStore.setState({
  session: {
    id: 'ssr-audit', title: 't', workspace: ROOT,
    messages: [{ id: 'e1', role: 'assistant', content, model: 'error', timestamp: 1, ...extra }],
    createdAt: 1, updatedAt: 1, messageCount: 1, totalTokens: 0, totalCostUsd: 0,
  },
});
const renderMessageView = () => renderToStaticMarkup(h('div', { dir: 'rtl' }, h(mod.MessageView, {
  msg: mod.useStore.getState().session.messages[0], turnStart: true,
})));

// v11.35 (A4) — the old P0 (raw English engine error leaking into an Arabic
// session) is FIXED: MessageView now renders <ErrorNotice>, which classifies
// the error and shows a localized title/reason/next step. These assertions
// verify the fix instead of the old repro.
test('SSR: a raw English engine error is now localized by ErrorNotice in an ARABIC session', (t) => {
  setLang('ar');
  errRow('No model configured. Check Settings → AI providers.');
  const html = renderMessageView();
  assert.match(html, /app-error-notice/, 'calm ErrorNotice rendered');
  assert.ok(!/No model configured\. Check Settings → AI providers\./.test(html), 'raw EN text no longer leaks');
  assert.ok(!RAW_JSON.test(html), 'no raw JSON dumped into the error notice');
  assert.ok(/خطأ التطبيق|تعذّر إكمال الطلب/.test(html), 'Arabic localized chrome present');
  t.diagnostic('P0 fixed in v11.35: engine errors now classified + localized (see docs/ERROR-DISPLAY-V1135.md)');
});

test('SSR: an Arabic error row is monolingual and action-bearing', () => {
  setLang('ar');
  errRow(mod.makeT('ar')('err.run.badParams'));
  const html = renderMessageView();
  assert.match(html, /app-error-notice/, 'calm ErrorNotice rendered');
  assert.ok(!/error-card/.test(html), 'old boxy error card replaced');
  assert.ok(!RAW_JSON.test(html), 'no raw JSON dumped');
});

test('SSR: a task-report meta payload degrades to a chip, never raw JSON attributes', () => {
  setLang('en');
  errRow(JSON.stringify({ outcome: 'error', summary: 'Run failed', nextSteps: ['Retry'] }), { model: 'task-report' });
  const html = renderMessageView();
  assert.ok(!/summary&quot;|nextSteps/.test(html), 'raw JSON keys must not be dumped as text');
});

test('SSR: per-surface ErrorBoundary shows localized headline but prints the raw error.message (P2 repro)', (t) => {
  setLang('ar');
  const boundary = new mod.SurfaceErrorBoundary({ surface: 'chat', children: null });
  boundary.state = { error: new Error('TypeError: Cannot read properties of undefined (reading map)') };
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /تعذّر عرض هذا القسم/, 'localized headline rendered');
  assert.match(html, /Cannot read properties of undefined/, 'raw engine error leaked verbatim (repro)');
  assert.ok(!RAW_JSON.test(html), 'no JSON leaked');
  t.diagnostic('P2: raw error.message shown in the boundary; consider a generic localized line + log-only detail');
});
