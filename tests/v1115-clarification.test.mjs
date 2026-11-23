import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.15 — CLARIFICATION CARD SSR / SEMANTICS TESTS
//
// Verifies the new general <ClarificationCard> renders an EN and an AR
// clarification question with 2–4 options, selection state, keyboard hints,
// and the free-text "other" row — without crashing on the server — and that
// the pure helpers behind its keyboard/selection logic behave correctly.
//
// The card is a controlled component: onAnswer is wired by the parent to the
// EXISTING store action `decideApproval('answer', value)` → api.agentApproval
// → kdx:agent:approval. These tests assert the presentation/semantics only.
//
// Run:
//   node --test --test-force-exit tests/v1115-clarification.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

// Emit the bundle INSIDE the repo so `require('react')` from the bundle
// resolves to the SAME project React instance that react-dom/server uses —
// a second React copy would break hooks ("Invalid hook call") during SSR.
const buildDir = mkdtempSync(join(ROOT, 'tests', '.clarif-build-'));
const bundleOut = join(buildDir, 'clarification.cjs');
execFileSync(
  ESBUILD_NODE,
  [
    ESBUILD_BIN,
    join(ROOT, 'src', 'components', 'ClarificationCard.tsx'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${bundleOut}`,
    '--loader:.css=empty',
    '--external:react',
    '--external:react/jsx-runtime',
  ],
  { cwd: ROOT, stdio: 'pipe' },
);

const mod = require(bundleOut);
const {
  ClarificationCard,
  localize,
  itemCount,
  clampSelection,
  navIndex,
  digitToIndex,
  resolveAnswer,
} = mod;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const h = React.createElement;
const render = (props) => renderToStaticMarkup(h(ClarificationCard, props));

// ---------- fixtures ----------
const EN_OPTIONS = [
  { value: 'react', label: 'React + Vite', description: 'Fast SPA with a lean toolchain.' },
  { value: 'next', label: 'Next.js', description: 'App router, SSR built in.' },
  { value: 'vanilla', label: 'Vanilla HTML', description: 'Zero build step, plain files.' },
];
const AR_OPTIONS = [
  { value: 'react', label: 'React + فايت', description: 'تطبيق سريع بأدوات خفيفة.' },
  { value: 'next', label: 'Next.js', description: 'توجيه وتصيير من الخادم.' },
  { value: 'vanilla', label: 'إتش تي إم إل بسيط', description: 'بدون خطوة بناء.' },
];
const BASE = {
  question: 'Which stack should I use for the dashboard?',
  onAnswer: () => {},
};

// ---------- SSR renders ----------

test('v11.15: ClarificationCard SSR-renders EN without crashing and with correct semantics', () => {
  const html = render({
    ...BASE,
    requestId: 'r-en',
    lang: 'en',
    eyebrow: 'Decision needed',
    options: EN_OPTIONS,
  });
  assert.ok(html.length > 0, 'produced markup');
  assert.match(html, /class="clarif"/);
  assert.match(html, /dir="ltr"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-labelledby="clarif-r-en-q"/);
  assert.match(html, /id="clarif-r-en-q"/);
  // question + eyebrow
  assert.match(html, /Which stack should I use for the dashboard\?/);
  assert.match(html, /Decision needed/);
  // options + descriptions
  for (const o of EN_OPTIONS) {
    assert.ok(html.includes(o.label), `label present: ${o.label}`);
    assert.ok(html.includes(o.description), `description present: ${o.description}`);
  }
  // radiogroup + 3 radios, first selected by default
  assert.match(html, /role="radiogroup"/);
  assert.equal((html.match(/role="radio"/g) || []).length, 3, 'one radio per option');
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 1, 'exactly one checked');
  assert.equal((html.match(/aria-checked="false"/g) || []).length, 2);
  assert.match(html, /data-selected="0"/, 'root reflects default selection');
  // free-text other + confirm + keyboard hints
  assert.match(html, /clarif-other-input/);
  assert.match(html, /Confirm/);
  assert.match(html, /↑↓/);
  assert.match(html, /↵/);
});

test('v11.15: ClarificationCard SSR-renders AR (RTL) without crashing', () => {
  const html = render({
    question: { en: 'Which stack?', ar: 'أي تقنية تريد استخدامها؟' },
    lang: 'ar',
    eyebrow: { en: 'Decision needed', ar: 'مطلوب قرار' },
    options: AR_OPTIONS,
    confirmLabel: { en: 'Confirm', ar: 'تأكيد' },
    otherPlaceholder: { en: 'Type…', ar: 'اكتب إجابة…' },
    onAnswer: () => {},
  });
  assert.ok(html.length > 0, 'produced markup');
  assert.match(html, /dir="rtl"/);
  assert.match(html, /أي تقنية تريد استخدامها\؟/);
  assert.match(html, /مطلوب قرار/);
  assert.match(html, /تأكيد/);
  assert.match(html, /اكتب إجابة…/);
  for (const o of AR_OPTIONS) assert.ok(html.includes(o.label), `ar label present: ${o.label}`);
  assert.match(html, /تنقّل/); // RTL "move" hint
  // no onDismiss in this fixture → no skip action / esc hint
  assert.doesNotMatch(html, /clarif-btn-ghost/);
  assert.doesNotMatch(html, />esc</);
});

test('v11.15: selection prop marks the correct option and hides it when asked', () => {
  const html = render({
    ...BASE,
    requestId: 'r-sel',
    lang: 'en',
    options: EN_OPTIONS,
    defaultSelected: 2,
  });
  assert.match(html, /data-selected="2"/, 'root reflects index 2');
  // third radio is the checked one
  const checked = [...html.matchAll(/role="radio"[^>]*aria-checked="true"[^>]*>/g)];
  assert.equal(checked.length, 1);
  assert.match(checked[0][0], /Vanilla HTML/);
});

test('v11.15: allowOther=false removes the free-text row; true keeps it', () => {
  const noOther = render({ ...BASE, lang: 'en', options: EN_OPTIONS, allowOther: false });
  assert.doesNotMatch(noOther, /clarif-other-input/);
  assert.equal((noOther.match(/role="radio"/g) || []).length, 3);

  const withOther = render({ ...BASE, lang: 'en', options: EN_OPTIONS, allowOther: true });
  assert.match(withOther, /clarif-other-input/);
  assert.match(withOther, /Type a different answer/);
});

test('v11.15: selecting the "Other" index via defaultSelected focuses semantics', () => {
  const html = render({
    ...BASE,
    lang: 'en',
    options: EN_OPTIONS,
    allowOther: true,
    defaultSelected: EN_OPTIONS.length, // 3 → the Other row
  });
  assert.match(html, /data-selected="3"/);
  assert.match(html, /class="clarif-other" data-selected="true"/);
  assert.match(html, /clarif-other-input[^>]*tabindex="0"/);
});

test('v11.15: onDismiss adds a Skip action + esc hint; disabled is reflected', () => {
  const withDismiss = render({
    ...BASE,
    lang: 'en',
    options: EN_OPTIONS,
    onDismiss: () => {},
  });
  assert.match(withDismiss, /clarif-btn-ghost/);
  assert.match(withDismiss, /Skip/);
  assert.match(withDismiss, /esc/);

  const disabled = render({ ...BASE, lang: 'en', options: EN_OPTIONS, disabled: true });
  assert.match(disabled, /aria-disabled="true"/);
});

// ---------- pure helpers (keyboard + selection logic) ----------

test('v11.15: localize resolves en/ar with fallbacks', () => {
  const t = { en: 'Hello', ar: 'مرحبا' };
  assert.equal(localize(t, 'en'), 'Hello');
  assert.equal(localize(t, 'ar'), 'مرحبا');
  assert.equal(localize('plain', 'ar'), 'plain');
  assert.equal(localize({ en: '', ar: 'مرحبا' }, 'en'), 'مرحبا');
  assert.equal(localize(undefined, 'en'), '');
});

test('v11.15: itemCount / clampSelection bound the navigable range', () => {
  assert.equal(itemCount(EN_OPTIONS, true), 4); // 3 options + Other
  assert.equal(itemCount(EN_OPTIONS, false), 3);
  assert.equal(clampSelection(2, 4), 2);
  assert.equal(clampSelection(99, 4), 3);
  assert.equal(clampSelection(-5, 4), -1);
  assert.equal(clampSelection(0, 0), -1);
});

test('v11.15: navIndex wraps in both directions for arrow keys', () => {
  assert.equal(navIndex(0, 1, 4), 1); // next
  assert.equal(navIndex(3, 1, 4), 0); // wrap forward
  assert.equal(navIndex(0, -1, 4), 3); // wrap backward
  assert.equal(navIndex(2, -1, 4), 1);
  assert.equal(navIndex(0, 2, 4), 2);
  assert.equal(navIndex(0, 1, 0), -1, 'empty list is safe');
});

test('v11.15: digitToIndex maps 1-4 only, within option count', () => {
  assert.equal(digitToIndex('1', 4), 0);
  assert.equal(digitToIndex('4', 4), 3);
  assert.equal(digitToIndex('4', 3), -1, 'digit past options is ignored');
  assert.equal(digitToIndex('0', 4), -1);
  assert.equal(digitToIndex('a', 4), -1);
});

test('v11.15: resolveAnswer returns the option value or Other text, never empty', () => {
  assert.equal(resolveAnswer(EN_OPTIONS, 1, '', true), 'next');
  assert.equal(resolveAnswer(EN_OPTIONS, EN_OPTIONS.length, '  my custom  ', true), 'my custom');
  assert.equal(resolveAnswer(EN_OPTIONS, EN_OPTIONS.length, '   ', true), null, 'empty Other is not confirmable');
  assert.equal(resolveAnswer(EN_OPTIONS, -1, '', true), null, 'nothing selected');
  assert.equal(resolveAnswer(EN_OPTIONS, 0, 'ignored', false), 'react');
});

test.after(() => {
  try {
    rmSync(buildDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
