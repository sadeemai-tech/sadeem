import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// Surnia v5.0.0 — Artifacts Hub derivation tests (offline, pure)
// Run: node --test tests/v5-artifacts.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v5-artifacts-'));

// esbuild the pure lib (no electron imports — but keep the same posture)
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}
const mod = join(tmp, 'artifacts.cjs');
bundle(join(ROOT, 'src/lib/artifacts.ts'), mod);
const { deriveArtifacts, buildProofHtml } = require(mod);

const msg = (over) => ({
  id: Math.random().toString(36).slice(2),
  role: 'assistant',
  kind: 'text',
  content: '',
  timestamp: Date.now(),
  ...over,
});

test('v5: deriveArtifacts counts edits, commands, docs, shots, mcp', () => {
  const messages = [
    msg({ role: 'user', kind: 'text', content: 'build the login page' }),
    msg({ kind: 'tool_call', toolName: 'list_dir', toolCallId: 't1', content: '{}' }),
    msg({ kind: 'tool_call', toolName: 'edit_file', toolCallId: 't2', content: '{"path":"src/app.tsx"}' }),
    msg({ kind: 'tool_call', toolName: 'multi_edit', toolCallId: 't3', content: '{"path":"src/main.tsx"}' }),
    msg({ kind: 'tool_call', toolName: 'run_command', toolCallId: 't4', content: '{"command":"npm test"}' }),
    msg({ kind: 'tool_call', toolName: 'make_document', toolCallId: 't5', content: '{"path":"docs/report.pdf"}' }),
    msg({ kind: 'tool_call', toolName: 'mcp__github__list_prs', toolCallId: 't6', content: '{}' }),
    msg({ kind: 'tool_result', toolCallId: 't7', resultOk: true, images: ['data:image/png;base64,AAA'] }),
    msg({
      role: 'assistant',
      kind: 'text',
      content:
        'Done. The login page is implemented with validation, the test suite passes (12/12), and the report is at docs/report.pdf. Screenshot attached above shows the final state.',
    }),
  ];
  // attach the screenshot tool_call for t7
  messages.splice(7, 0, msg({ kind: 'tool_call', toolName: 'preview_screenshot', toolCallId: 't7', content: '{}' }));

  const r = deriveArtifacts(messages, { sessionId: 's1', title: 'Login page', model: 'gpt-x', todos: [
    { id: 'a', content: 'create', status: 'completed' },
    { id: 'b', content: 'implement', status: 'completed' },
    { id: 'c', content: 'verify', status: 'pending' },
  ] });

  assert.equal(r.stats.edits, 2);
  assert.equal(r.stats.commands, 1);
  assert.equal(r.stats.documents, 1);
  assert.equal(r.stats.mcpCalls, 1);
  assert.equal(r.stats.screenshots, 1);
  assert.deepEqual([...r.filesTouched].sort(), ['docs/report.pdf', 'src/app.tsx', 'src/main.tsx']);
  assert.ok(r.walkthrough.includes('12/12'), 'walkthrough is the last substantial assistant text');
  assert.equal(r.todos.filter((t) => t.status === 'completed').length, 2);
});

test('v5: proof page is bilingual, RTL-safe and self-contained', () => {
  const r = deriveArtifacts([], { sessionId: 's', title: 'T' });
  const ar = buildProofHtml(r, 'ar');
  assert.ok(ar.includes('dir="rtl"'), 'Arabic page is RTL');
  assert.ok(ar.includes('دليل التنفيذ'), 'Arabic chrome');
  assert.ok(!/<link\b/.test(ar) && !/<script\b/.test(ar), 'no external deps');
  const en = buildProofHtml(r, 'en');
  assert.ok(en.includes('dir="ltr"'));
  assert.ok(en.includes('Proof of Work'));
});

test('v5: proof page escapes hostile content', () => {
  const r = deriveArtifacts([], { sessionId: 's', title: '<script>alert(1)</script>' });
  const html = buildProofHtml(r, 'en');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'title is escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped entity present');
});

test('cleanup', () => {
  rmSync(tmp, { recursive: true, force: true });
});
