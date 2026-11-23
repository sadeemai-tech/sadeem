// ============================================================
// v11.26 — PROOF IS A BUTTON, NOT A SECTION.
// The founder: "خليه زر PROOF فقط... أي شيء ثاني بروف شيله تماماً."
// No ledger, no tally chips, no gate rows, no popover panel.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'src/components/ProofRibbon.tsx'), 'utf8');
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const code = strip(src);

test('the only rendered control is the small PROOF button', () => {
  assert.match(code, /data-testid="proof-toggle"/, 'the button exists');
  assert.match(code, /pr-proof-toggle/, 'small control class');
  assert.equal((code.match(/<button\b/g) || []).length, 1, 'exactly ONE button in the component');
  for (const gone of ['pr-pop', 'pr-check', 'pr-tally', 'pr-kind', 'pr-pop-foot', 'role="dialog"']) {
    assert.ok(!code.includes(gone), `the proof ${gone} section was REMOVED`);
  }
  assert.ok(code.includes('if (!proofVisible) return null;'), 'plain chat renders no proof at all');
});

test('no popover / ledger / evidence rows are mounted anywhere', () => {
  assert.ok(!code.includes('{open &&'), 'no conditional panel');
  assert.ok(!code.includes('toggleOpen('), 'no open/close handler');
  assert.ok(!code.includes('copyEvidence('), 'no copy control');
  assert.ok(!code.includes('openKind('), 'no family chips');
});

test('the button is honest and single-language', () => {
  assert.match(code, /PROOF|proof\.title/, 'label is the PROOF title');
  assert.ok(!/[\u0600-\u06FF]/.test(code.match(/<span className="pr-tag"[^>]*>([^<]*)</)?.[1] ?? ''),
    'the visible button label is monolingual');
});
