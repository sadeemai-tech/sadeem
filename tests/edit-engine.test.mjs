// v7 unit tests — editEngine (tolerant replace + guard + syntax probe)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tolerantReplace, FileEditGuard, syntaxProbe } from './.editEngine.bundle.mjs';

const code = [
  'function calc(a, b) {',
  '    const sum = a + b;',
  '    return sum;',
  '}',
  '',
  'function main() {',
  '    console.log(calc(1, 2));',
  '}',
].join('\n');

test('exact match still works', () => {
  const r = tolerantReplace(code, 'const sum = a + b;', 'const sum = a + b; // summed');
  assert.equal(r.ok, true);
  assert.equal(r.method, 'exact');
  assert.ok(r.updated.includes('// summed'));
  assert.equal(r.startLine, 2);
});

test('indentation drift is tolerated and re-indented', () => {
  const r = tolerantReplace(code, 'const sum = a + b;\n  return sum;', 'const total = a + b;\n  return total;');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.method, 'normalized');
  assert.ok(r.updated.includes('    const total = a + b;'), r.updated);
  assert.ok(r.updated.includes('    return total;'), r.updated);
  assert.ok(!r.updated.includes('sum'));
});

test('extra blank lines in old_string are tolerated', () => {
  const r = tolerantReplace(code, 'function calc(a, b) {\n\n    const sum = a + b;', 'function calc(a, b) {\n    const s = a + b;');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.updated.includes('const s = a + b;'));
});

test('single-char typo rescued by fingerprint stage', () => {
  const r = tolerantReplace(code, 'console.log(calq(1, 2));', 'console.log(calc(3, 4));');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.method, 'fingerprint');
  assert.ok(r.updated.includes('calc(3, 4)'));
});

test('ambiguity without replace_all is rejected with locations', () => {
  const src = 'x = 1;\nx = 1;\n';
  const r = tolerantReplace(src, 'x = 1;', 'x = 2;');
  assert.equal(r.ok, false);
  assert.match(r.error, /ambiguous|matches/);
  const r2 = tolerantReplace(src, 'x = 1;', 'x = 2;', true);
  assert.equal(r2.ok, true);
  assert.equal(r2.updated.match(/x = 2;/g).length, 2);
});

test('CRLF file preserves CRLF', () => {
  const crlf = 'a\r\nb\r\nc\r\n';
  const r = tolerantReplace(crlf, 'b', 'B');
  assert.equal(r.ok, true);
  assert.ok(r.updated.includes('\r\n'));
  assert.ok(r.updated.includes('B'));
  assert.ok(!r.updated.includes('b'));
});

test('not-found even fuzzily gives actionable error', () => {
  const r = tolerantReplace(code, 'this line does not exist anywhere', 'x');
  assert.equal(r.ok, false);
  assert.match(r.error, /Re-read the file/);
});

test('guard: read-before-edit + staleness', () => {
  const g = new FileEditGuard();
  assert.throws(() => g.assertEditable('/tmp/f.ts', code), /READ_BEFORE_EDIT/);
  g.recordRead('/tmp/f.ts', code);
  g.assertEditable('/tmp/f.ts', code); // ok
  assert.throws(() => g.assertEditable('/tmp/f.ts', code + '\n// changed'), /STALE_READ/);
  g.recordWrite('/tmp/f.ts', '// mine');
  g.assertEditable('/tmp/f.ts', '// mine'); // authored — always ok
});

test('syntax probe: JSON hard-fails, JS parser catches error, ok passes', async () => {
  const badJson = await syntaxProbe('x.json', '{oops}');
  assert.ok(badJson.error && /JSON parse failed/.test(badJson.error));
  const okJson = await syntaxProbe('x.json', '{"a":1}');
  assert.equal(okJson.error, null);
  const badJs = await syntaxProbe('x.cjs', 'function () { broken((( }');
  assert.ok(badJs.error, 'node --check should flag broken js');
  const okJs = await syntaxProbe('x.cjs', 'const a = 1; console.log(a);');
  assert.equal(okJs.error, null);
  // v7.2 — TS/TSX now get a REAL parse (esbuild), so broken TS hard-fails
  // like broken JS instead of a soft balance warning (audit upgrade).
  const badTs = await syntaxProbe('x.ts', 'function f() {\n  return 1;\n');
  assert.ok(badTs.error && /TypeScript syntax/.test(badTs.error), 'broken TS must hard-fail');
  const okTs = await syntaxProbe('x.ts', 'function f(): number {\n  return 1;\n}');
  assert.equal(okTs.error, null);
  assert.equal(okTs.checked, 'parser');
  const okTsx = await syntaxProbe('x.tsx', 'export const A = (): JSX.Element => <div onClick={() => 1} />;');
  assert.equal(okTsx.error, null);
});
