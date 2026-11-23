import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.15 — CURSOR-INSPIRED IDEAS (offline unit tests)
//   node --test --test-force-exit tests/v1115-cursor-ideas.test.mjs
// Bundles electron/agent/cursorIdeas.ts with the repo's esbuild shim.
// No electron, no model calls, no network, no real repo writes.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(path.join(tmpdir(), 'sadeem-v1115-cursor-'));
const bundleOut = path.join(tmp, 'cursorIdeas.cjs');

execFileSync(ESBUILD_NODE, [
  ESBUILD_BIN,
  path.join(ROOT, 'electron/agent/cursorIdeas.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundleOut}`,
  '--external:electron',
], { cwd: ROOT, stdio: 'pipe' });
const ideas = require(bundleOut);

const ws = path.join(tmp, 'ws');

// ------------------------------------------------------------
// 1. @-mention resolver
// ------------------------------------------------------------

test('v11.15: @mentions resolve files/folders, symbols, ambiguity and misses deterministically', () => {
  const files = [
    path.join(ws, 'src/auth.ts'),
    path.join(ws, 'tests/auth.ts'),
    path.join(ws, 'src/components/Button.tsx'),
    path.join(ws, 'electron/agent/codeintel.ts'),
  ];
  // Shape matches CodeIndex.findDefinitions(): { symbol, relPath, score }.
  const index = {
    findDefinitions(q) {
      if (q === 'extractSymbols') return [
        { relPath: 'electron/agent/codeintel.ts', score: 3,
          symbol: { name: 'extractSymbols', kind: 'function', line: 1000, endLine: 1023, signature: 'export function extractSymbols(absPath: string, content: string): Symbol[]' } },
      ];
      if (q === 'leak') return [
        { relPath: '../secret.ts', score: 3, symbol: { name: 'leak', kind: 'const', line: 1 } },
      ];
      return [];
    },
  };
  const prompt = 'Fix @auth.ts (see @auth.ts twice), use @src/components/Button.tsx, @src/components/ and @extractSymbols; ignore @leak and @missing.xyz';
  const opts = { workspace: ws, files, index };
  const res = ideas.resolveContextMentions(prompt, opts);

  assert.deepEqual(res, ideas.resolveContextMentions(prompt, opts), 'deterministic');
  assert.equal(res.resolved, 3, 'file + folder + symbol');
  assert.equal(res.unresolved, 3, 'ambiguous + escaping symbol + missing');
  assert.equal(res.mentions.length, 6, 'duplicate @auth.ts mentioned once');
  assert.equal(res.truncated, false);

  const auth = res.mentions.find((m) => m.name === 'auth.ts');
  assert.equal(auth.kind, 'ambiguous');
  assert.deepEqual(auth.candidates, ['src/auth.ts', 'tests/auth.ts']);

  const file = res.mentions.find((m) => m.name === 'src/components/Button.tsx');
  assert.equal(file.kind, 'file');
  assert.equal(file.absPath, path.join(ws, 'src/components/Button.tsx'));
  assert.equal(file.relPath, 'src/components/Button.tsx');

  const folder = res.mentions.find((m) => m.name === 'src/components/');
  assert.equal(folder.kind, 'folder');
  assert.match(folder.reason, /1 file\(s\)/);

  const sym = res.mentions.find((m) => m.name === 'extractSymbols');
  assert.equal(sym.kind, 'symbol');
  assert.equal(sym.absPath, path.join(ws, 'electron/agent/codeintel.ts'));
  assert.equal(sym.line, 1000);
  assert.equal(sym.endLine, 1023);
  assert.match(sym.signature, /extractSymbols/);

  const leak = res.mentions.find((m) => m.name === 'leak');
  assert.equal(leak.kind, 'unresolved', 'index cannot escape the workspace root');
  assert.equal(res.mentions.find((m) => m.name === 'missing.xyz').kind, 'unresolved');

  const block = ideas.renderMentionContext(res);
  assert.match(block, /\[Context mentions\]/);
  assert.match(block, /- symbol: extractSymbols → electron\/agent\/codeintel\.ts:1000-1023/);
  assert.match(block, /! ambiguous: @auth\.ts/);
  assert.match(block, /! unresolved: @missing\.xyz/);
  assert.equal(block, ideas.renderMentionContext(res), 'render is deterministic');
});

test('v11.15: @mentions honour caps and fail closed on bad options', () => {
  assert.deepEqual(
    ideas.resolveContextMentions('@x', {}),
    { mentions: [], resolved: 0, unresolved: 0, truncated: false },
  );
  const res = ideas.resolveContextMentions('@a.ts @b.ts @c.ts', {
    workspace: ws,
    files: [path.join(ws, 'a.ts'), path.join(ws, 'b.ts'), path.join(ws, 'c.ts')],
    maxMentions: 2,
  });
  assert.equal(res.truncated, true);
  assert.equal(res.mentions.length, 2);
  assert.equal(ideas.renderMentionContext(res).includes('mention cap reached'), true);
  assert.equal(ideas.renderMentionContext({ mentions: [] }), '');
  const hostile = ideas.resolveContextMentions('@outside', {
    workspace: ws,
    files: ['D:\\somewhere\\outside.ts', path.join(ws, 'inside.ts')],
    index: { findDefinitions: () => [{ relPath: 'C:\\Windows\\system.ini', symbol: { name: 'outside' } }] },
  });
  assert.equal(hostile.mentions[0].kind, 'unresolved', 'absolute paths outside the root are dropped');
});

// ------------------------------------------------------------
// 2. Multi-file change digest
// ------------------------------------------------------------

test('v11.15: change digest groups diff hunks per file, strips ANSI, caps cleanly', () => {
  const red = (s) => `\x1b[31m${s}\x1b[0m`;
  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const events = [
    {
      tool: 'edit_file', ok: true, file: path.join(ws, 'src/a.ts'),
      output: `${green('Successfully edited file: ' + path.join(ws, 'src/a.ts'))}\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n-old line\n+new line\n+another`,
    },
    {
      tool: 'write_file', ok: true,
      output: 'file: src/b.ts\n@@ -0,0 +1,2 @@\n+alpha\n+beta',
    },
    {
      tool: 'write_file', ok: false, file: path.join(ws, 'src/c.ts'),
      output: red('Failed to write c.ts: permission denied'),
    },
  ];
  const digest = ideas.digestFileChanges(events, { workspace: ws });
  assert.deepEqual(digest, ideas.digestFileChanges(events, { workspace: ws }), 'deterministic');
  assert.deepEqual(digest.totals, { files: 3, additions: 4, deletions: 1, hunks: 2, failed: 1 });
  assert.deepEqual(digest.files.map((f) => f.file), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  assert.equal(digest.files[0].additions, 2);
  assert.equal(digest.files[0].deletions, 1);
  assert.deepEqual(digest.files[0].sample, ['- old line', '+ new line', '+ another'], 'diff source order');
  assert.match(digest.files[0].ops.join(','), /edit_file/);
  assert.equal(digest.files[2].ok, false);
  assert.deepEqual(digest.files[2].ops, ['write_file']);
  assert.match(digest.files[2].reason, /permission denied/);
  assert.equal(digest.clean, false);

  const md = digest.markdown;
  assert.equal(/\x1b/.test(md), false, 'ANSI-free digest');
  assert.match(md, /## Changes \(3 files, \+4 -1\)/);
  assert.match(md, /`src\/a\.ts` — edit_file: \+2 -1 \(1 hunk\)/);
  assert.match(md, /^\s+\+ new line$/m);
  assert.match(md, /^\s+- old line$/m);
  assert.match(md, /\[FAILED\]/);
});

test('v11.15: change digest fails honestly on empty/non-file input', () => {
  const empty = ideas.digestFileChanges(null);
  assert.equal(empty.markdown, '');
  assert.equal(empty.clean, true);
  assert.deepEqual(empty.totals, { files: 0, additions: 0, deletions: 0, hunks: 0, failed: 0 });

  const failed = ideas.digestFileChanges([{ tool: 'write_file', ok: false, output: '\x1b[31mboom\x1b[0m' }]);
  assert.deepEqual(failed.errors, ['write_file: boom']);
  assert.equal(failed.totals.failed, 1);
  assert.equal(failed.clean, false);
  assert.equal(/\x1b/.test(failed.markdown), false);

  const tiny = ideas.digestFileChanges([{
    tool: 'edit_file', ok: true, file: path.join(ws, 'big.ts'),
    output: Array.from({ length: 20 }, (_, i) => `+ line ${i}`).join('\n'),
  }], { maxSample: 2 });
  assert.deepEqual(tiny.files[0].sample, ['+  line 0', '+  line 1'], 'content indentation is preserved');
  assert.equal(tiny.files[0].truncated, true);
  assert.equal(tiny.totals.additions, 20, 'counts stay complete even when the sample is capped');
});

// ------------------------------------------------------------
// 3. Agent handoff card
// ------------------------------------------------------------

test('v11.15: handoff card round-trips structured context and drops ANSI', () => {
  const input = {
    role: 'verifier', status: 'done', id: 'agent-17', label: 'Independent verifier',
    summary: '\x1b[32mChecked\x1b[0m the diff\nfindings: 2',
    files: ['src/auth.ts', 'tests/auth.test.ts', 'src/auth.ts'],
    verified: ['tsc --noEmit', 'node --test 12/12'],
    unverified: ['LSP symbol mentions'],
    tests: 'node --test tests/v1115-cursor-ideas.test.mjs PASS',
    prompt: 'Verify the auth refactor',
  };
  const card = ideas.formatAgentHandoff(input);
  assert.equal(card, ideas.formatAgentHandoff(input), 'deterministic');
  assert.equal(/\x1b/.test(card), false, 'ANSI-free');
  assert.match(card, /^=== HANDOFF v1 ===/);
  assert.match(card, /=== END HANDOFF ===$/);

  const parsed = ideas.parseAgentHandoff(card);
  assert.ok(parsed);
  assert.equal(parsed.role, 'verifier');
  assert.equal(parsed.status, 'done');
  assert.equal(parsed.summary, 'Checked the diff findings: 2');
  assert.deepEqual(parsed.files, ['src/auth.ts', 'tests/auth.test.ts']);
  assert.deepEqual(parsed.verified, ['tsc --noEmit', 'node --test 12/12']);
  assert.deepEqual(parsed.unverified, ['LSP symbol mentions']);
  assert.equal(parsed.tests, input.tests);
  assert.equal(parsed.prompt, 'Verify the auth refactor');
});

test('v11.15: malformed handoff cards are rejected, not guessed', () => {
  assert.equal(ideas.parseAgentHandoff('just prose with no markers'), null);
  assert.equal(ideas.parseAgentHandoff('=== HANDOFF v1 ===\nsummary: missing required fields'), null);
  assert.equal(ideas.parseAgentHandoff('=== HANDOFF v1 ===\nrole: x\nstatus: y'), null, 'no end marker');
  assert.equal(ideas.parseAgentHandoff(null), null);
  assert.equal(ideas.formatAgentHandoff(null), '');
  const minimal = ideas.parseAgentHandoff(ideas.formatAgentHandoff({ role: 'scout', status: 'running' }));
  assert.ok(minimal);
  assert.equal(minimal.summary, '');
  assert.deepEqual(minimal.files, []);
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
