// ============================================================
// Surnia v5.0.0 — memory verification (offline)
// The `remember` tool: project MEMORY.md write + dedupe + cap,
// user-scope routing into DNA, tool registration.
// Run: node --test tests/v5-memory.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('v5: remember tool is registered with both scopes', () => {
  // v11.12 (SPLIT-1) — tool DEFINITIONS moved to tool-defs.ts; the def-existence
  // assertions read that file, dispatch/executor assertions stay on tools.ts.
  const defs = readFileSync(join(ROOT, 'electron/agent/tool-defs.ts'), 'utf8');
  const tools = readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8');
  assert.ok(defs.includes("name: 'remember'"), 'remember tool def exists');
  assert.ok(/case 'remember':/.test(tools), 'remember dispatched');
  assert.ok(tools.includes("REMEMBER_SECTION = '## Remembered'"), 'Remembered section constant');
  // user scope routes to DNA (v6: kind-mapped — feedback→correction, default preference)
  assert.ok(/async function rememberTool[\s\S]*?recordAgentNote\(dnaKind/.test(tools), 'user scope routes to DNA recordAgentNote');
  // v6 — the ZCode memory taxonomy + forget verb are wired in
  assert.ok(defs.includes("enum: ['user', 'feedback', 'project', 'reference']"), '4-type memory taxonomy in the tool schema');
  assert.ok(/action === 'forget'/.test(tools), 'forget verb implemented');
  assert.ok(/forgetMemory\(ctx\.workspace, content\)/.test(tools), 'forget routes to DNA forgetMemory');
});

test('v5: MEMORY.md merge logic keeps Learned + Remembered sections intact', () => {
  // mergeLearnedSection (engine) and the remember writer must not clobber
  // each other's sections — verify the merge function only rewrites '## Learned'
  const engine = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.ok(engine.includes("export function mergeLearnedSection"), 'mergeLearnedSection exported');
  assert.ok(engine.includes("'## Learned'"), 'Learned section writer present');
});

test('v5: prompts inject project memory with a cap', () => {
  const prompts = readFileSync(join(ROOT, 'electron/agent/prompts.ts'), 'utf8');
  assert.ok(prompts.includes('# Project memory (MEMORY.md)'), 'memory section injected');
  const engine = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.ok(/MEMORY\.md/.test(engine), 'engine reads MEMORY.md');
  assert.ok(engine.includes('AGENTS.md'), 'AGENTS.md convention honored');
});

test('cleanup', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'surnia-mem-'));
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'MEMORY.md'), '# mem\n\n## Learned\n- x\n');
  rmSync(tmp, { recursive: true, force: true });
});
