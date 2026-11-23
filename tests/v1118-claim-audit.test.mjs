import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.18 — CLAIM-AUDIT NOISE GATE (founder: "every claim is backed by
// evidence — ليش بتطلع تحت كل رسالة؟ خلص").
//
// The engine emits `claim_audit` after EVERY model turn, so the
// "Every claim is backed by evidence" chip used to appear under plain
// answers. MessageView must now render the claim-audit row ONLY for real
// work (≥2 claims, or ≥1 unevidenced claim); zero-claim answers and a
// single trivially-supported claim render NOTHING. The raw meta JSON must
// never leak into the transcript.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1118-claim-audit.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

// SSR harness identical in posture to v1116-chat-precision.test.mjs.
before(() => {
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents: "export { MessageView } from './src/components/MessageView';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  // SSR reads getServerSnapshot; observe the live seeded state (as in v1116).
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = (...args) => React.createElement(...args);
const T = 1700000000000;
const auditMsg = (content, id = 'audit') => ({
  id,
  role: 'assistant',
  kind: 'text',
  model: 'claim-audit',
  content: JSON.stringify(content),
  timestamp: T,
});
const render = (msg) => renderToStaticMarkup(h(mod.MessageView, { msg, turnStart: true }));

// ------------------------------------------------------------
// (a) plain answer + a claim_audit with NO claims -> render NOTHING
// ------------------------------------------------------------
test('(a) zero-claim audit under a plain answer renders no chip and leaks no JSON', () => {
  const plain = render({
    id: 'plain', role: 'assistant', kind: 'text',
    content: 'Here is your short answer.', timestamp: T,
  });
  const noClaims = render(auditMsg({
    summary: '0 claims, 0 unevidenced',
    unsupported: 0,
    claims: [],
  }));
  const transcript = plain + noClaims;

  assert.ok(plain.includes('Here is your short answer.'), 'plain answer still renders');
  assert.equal(noClaims, '', 'claim-audit row contributes zero markup with no claims');
  for (const forbidden of [
    'CLAIM-AUDIT',
    'Every claim is backed by evidence',
    'claims without evidence',
  ]) {
    assert.ok(!transcript.includes(forbidden), `transcript must NOT contain "${forbidden}"`);
  }
  // raw meta JSON never reaches the transcript
  for (const key of ['"summary"', '"claims"', '"unsupported"', '0 claims, 0 unevidenced']) {
    assert.ok(!transcript.includes(key), `raw claim_audit JSON leaked: ${key}`);
  }
});

test('(a2) a single trivially-supported claim is also suppressed', () => {
  const html = render(auditMsg({
    summary: '1 claim, 0 unevidenced',
    unsupported: 0,
    claims: [{ claim: 'The sky is blue', kind: 'observation', supported: true }],
  }, 'audit-single'));
  assert.equal(html, '', 'one supported claim renders nothing');
  assert.ok(!html.includes('CLAIM-AUDIT'));
  assert.ok(!html.includes('Every claim is backed by evidence'));
});

// ------------------------------------------------------------
// (b) a real audit (3 claims, 1 unsupported) still renders, honest counts
// ------------------------------------------------------------
test('(b) v11.26 — the claim-audit row is REMOVED with the whole proof section', () => {
  const html = render(auditMsg({
    summary: '3 claims, 1 unevidenced',
    unsupported: 1,
    claims: [
      { claim: 'The build passed', kind: 'verification', supported: true },
      { claim: 'Coverage rose to 92%', kind: 'metric', supported: true },
      { claim: 'All tests are green everywhere', kind: 'assertion', supported: false },
    ],
  }, 'audit-real'));

  // The founder: "اي شيء ثاني بروف شيله تماماً" — only the small button stays.
  assert.ok(!html.includes('CLAIM-AUDIT'), 'no claim-audit row is rendered');
  assert.ok(!html.includes('claims without evidence'), 'no claim count row');
  assert.ok(!html.includes('"unsupported":1'), 'raw JSON did not leak');
});

// ------------------------------------------------------------
// source lock — the gate is present, the dispatch still routes to the card
// ------------------------------------------------------------
test('source lock: proof-only rows are suppressed, meta safety net preserved', () => {
  const mv = src('src/components/MessageView.tsx');
  assert.ok(mv.includes('PROOF_ONLY_ROWS'), 'proof-only row suppression present');
  assert.ok(mv.includes("'claim-audit'"), 'claim-audit is listed as a removed proof row');
  assert.ok(mv.includes('const META_KEYS_RE ='), 'meta safety net preserved');
});
