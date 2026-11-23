// ============================================================
// v11.31 — UI CAPABILITY EXTENSION AUDIT (MCP / SKILLS / SUBAGENTS)
//
// Source-level + build-level verification of the three capability panels and
// the settings skills section. Every focus area of the audit is pinned:
//   MCP      add/test/remove/catalog/registry/OAuth hints, live health,
//            quarantine, per-tool enable, approvals, activity log — no
//            silent failures, no stale state after deletion, honest badges.
//   SKILLS   install/create/delete/fork/trust/marketplace/rival-import —
//            every failure surfaces a toast or an honest error row.
//   SUBAGENT inspect/retry/clear — real per-row busy state, honest counts.
//   SETTINGS skills trust goes through the notifying store action.
//
// The harness deliberately avoids SSR (v1121-skills-crash + v1128-full-smoke
// already render every surface). It compiles all four files with esbuild so
// a syntax/JSX regression fails here, then pins the wiring with literals.
//
// Run: node --test tests/v1131-ui-ext.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const FILES = {
  mcp: 'src/components/panels/MCPPanel.tsx',
  skills: 'src/components/panels/SkillsPanel.tsx',
  subs: 'src/components/panels/SubagentsPanel.tsx',
  memory: 'src/components/settings/SkillsMemorySection.tsx',
};
const src = {};
for (const [k, f] of Object.entries(FILES)) src[k] = readFileSync(join(ROOT, f), 'utf8');

/** Assert every needle is present (line numbers on failure). */
function has(which, needles) {
  const text = src[which];
  for (const needle of needles) {
    assert.ok(
      text.includes(needle),
      `${FILES[which]}: expected to find ${JSON.stringify(needle)}`,
    );
  }
}
/** Assert every needle is absent (no dead/no-op patterns). */
function hasNot(which, needles) {
  const text = src[which];
  for (const needle of needles) {
    assert.ok(
      !text.includes(needle),
      `${FILES[which]}: forbidden pattern ${JSON.stringify(needle)}`,
    );
  }
}
function lineOf(which, needle) {
  return src[which].slice(0, src[which].indexOf(needle)).split(/\r?\n/).length;
}

const BUNDLE = join(ROOT, 'tests', '.v1131-ui-ext.bundle.cjs');
after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// ------------------------------------------------------------
// 0 · All four owned surfaces still compile (JSX + TS stripped).
// ------------------------------------------------------------
test('v1131: all four owned UI files compile through esbuild', () => {
  const outfile = BUNDLE;
  esbuild.buildSync({
    stdin: {
      contents: [
        "export { MCPPanel } from './src/components/panels/MCPPanel';",
        "export { SkillsPanel, SkillDetail, NewSkillForm } from './src/components/panels/SkillsPanel';",
        "export { SubagentsPanel } from './src/components/panels/SubagentsPanel';",
        "export { SkillsMemorySection } from './src/components/settings/SkillsMemorySection';",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: ['electron', 'react', 'react-dom', 'zustand', 'lucide-react'],
    logLevel: 'silent',
  });
  // bundling succeeded if we got here; the module is not executed (needs DOM).
  assert.ok(outfile, 'bundle target resolved');
});

// ------------------------------------------------------------
// 1 · MCP — add / test / remove really persist and report.
// ------------------------------------------------------------
test('v1131 MCP: add + catalog + registry paths persist and sync the store', () => {
  has('mcp', [
    "const TRANSPORTS: MCPTransport[] = ['stdio', 'http', 'sse']",
    'catalogEntryToConfig(entry, uid())',
    'api.mcpServerSave(cfg)',
    'catalogEntryHasPlaceholders(entry)',
    'updateSettings({',
    'formFromRegistryHit(hit)',
    'api.openExternal(hit.docsUrl as string)',
  ]);
  // The edit form refuses invalid input instead of silently saving garbage.
  has('mcp', [
    "t('mcp.err.name', 'Name is required.')",
    "t('mcp.err.command', 'A command is required for stdio servers.')",
    "t('mcp.err.url', 'The URL must start with http:// or https://.')",
    "t('mcp.err.headers', 'Headers must be valid JSON",
    "t('mcp.err.timeout', 'Timeout must be a whole number",
  ]);
});

test('v1131 MCP: test + remove report outcomes and drop per-server caches', () => {
  has('mcp', [
    'const res = await api.mcpTest(cfg);',
    'testing: false, ok: !!res.ok, error: res.error',
    'const res = (await api.mcpServerDelete(id)) as { ok: boolean; error?: string };',
    "t('mcp.deleteFailed',",
    'setHealth((prev) => {',
    'setToolsX((prev) => {',
    'setCaps((prev) => {',
    'delete next[id];',
  ]);
  // A server that fails the on-disk delete must not be silently "gone".
  assert.ok(
    src.mcp.includes("res.ok === false") && src.mcp.includes('notify('),
    `${FILES.mcp}: delete failure is surfaced`,
  );
});

test('v1131 MCP: bridge-aware health + no stale dot after deletion', () => {
  has('mcp', [
    "async function safeCall<T>(method: string, ...args: unknown[]): Promise<{ called: boolean; value?: T }>",
    "const call = await safeCall<McpHealthSnapshot[]>('mcpHealthGet');",
    'if (!call.called) return;',
    'setHealth(Object.fromEntries(list.map((h) => [h.id, h])));',
  ]);
  // The old `if (list.length) setHealth(...)` bug kept a deleted server's dot.
  hasNot('mcp', ["if (list.length) setHealth("]);
});

test('v1131 MCP: quarantine / tool switch / approval / auto-Q / log clear report failures', () => {
  has('mcp', [
    "'mcpQuarantineSet',",
    "t('mcp.releaseFailed',",
    "'mcpToolEnable',",
    "t('mcp.toolToggleFailed',",
    "'mcpApprovalSet',",
    "t('mcp.approvalResetFailed',",
    "'mcpV2SettingsSet', null, { autoQuarantine: value }",
    "t('mcp.autoQuarantineFailed',",
    "'mcpCallLogClear',",
    "t('mcp.activity.clearFailed',",
    "t('mcp.healthCheckUnavailable',",
    "t('mcp.copyFailed',",
  ]);
  // Every one of those guards must run before optimistic state is committed.
  const release = src.mcp.indexOf('const releaseQuarantine');
  const guard = src.mcp.indexOf("t('mcp.releaseFailed',", release);
  const commit = src.mcp.indexOf('setV2((prev) => (prev ? { ...prev, quarantined:', release);
  assert.ok(release > 0 && guard > release && commit > guard,
    `${FILES.mcp}:${lineOf('mcp', 'const releaseQuarantine')}: release confirms before optimistic clear`);
});

test('v1131 MCP: honest status badges — chevron and expand agree; down/quarantine visible', () => {
  has('mcp', [
    'const canInspect = s.state === \'connected\' || h?.status === \'up\';',
    'disabled={!canInspect}',
    'title={canInspect ? t(\'mcp.health\') : t(\'mcp.connect\')}',
    "statusOf(id)?.state === 'connected' || healthOf(id)?.status === 'up') {",
    'const healthWarn = h?.status === \'down\' && stateKey === \'connected\';',
    '{(isQ || healthWarn) && (',
    "t('mcp.hstatus.quarantined', 'Quarantined')",
    "t('mcp.hstatus.down', 'Unreachable')",
    'title={lastConnTitle}',
  ]);
  // The connection plate uses only live figures.
  has('mcp', [
    'const plateConnected = plateServers.filter(',
    "s.state === 'connected' || health[s.id]?.status === 'up'",
    'const plateTools = result?.totalTools ?? 0;',
  ]);
});

test('v1131 MCP: registry add failure cannot pretend a server was added', () => {
  has('mcp', [
    'if (!res.config) {',
    "t('mcp.registry.noConfig',",
    "t('mcp.registry.addFailed',",
    "t('mcp.registry.added',",
  ]);
});

// ------------------------------------------------------------
// 2 · SKILLS — every manager flow gives feedback or an honest error.
// ------------------------------------------------------------
test('v1131 SKILLS: create / delete / fork / import all report failures', () => {
  has('skills', [
    'const valid = name.trim().length >= 2 && body.trim().length >= 10;',
    'disabled={!valid || busy}',
    'await api.skillsSave(ws, {',
    "t('skills.saved', 'Skill saved')",
    'onDone(slug)',
    "t('skills.deleteFailed',",
    "t('skills.forkFailed',",
    "t('skills.importFailed',",
    'const dir = await api.openFolderDialog();',
    'if (!dir) return; // cancelled — not a failure',
  ]);
});

test('v1131 SKILLS: marketplace load errors are honest; install/remove report output', () => {
  has('skills', [
    'const [marketError, setMarketError] = useState<string | null>(null);',
    "t('skills.market.loadFailed',",
    ') : marketError ? (',
    "t('skills.market.installed',",
    "t('skills.market.removed',",
    'r.output || t(\'skills.market.failed\'',
    'setMarketError(null);',
  ]);
});

test('v1131 SKILLS: trust action and keyboard access are wired', () => {
  has('skills', ["onClick={() => void trustWorkspaceSkills()}", "e.key === 'Enter' || e.key === ' '"]);
  has('memory', [
    'const trustWorkspaceSkills = useStore((s) => s.trustWorkspaceSkills);',
    'void trustWorkspaceSkills();',
    'disabled={!wsPath}',
  ]);
  // No more silent, direct bridge call from the settings surface.
  hasNot('memory', ['void api.skillsTrust(']);
});

test('v1131 SKILLS: no hook lives after the #300 early returns', () => {
  const guard = src.skills.indexOf('  if (openSlug) {');
  assert.ok(guard > 0, `${FILES.skills}: detail early return located`);
  const after = src.skills.slice(guard);
  assert.ok(
    !/\buse(State|Effect|Memo|Callback|Ref|Context|Reducer|Id|ImperativeHandle|LayoutEffect)\s*\(/.test(after),
    `${FILES.skills}: every hook stays above the conditional returns`,
  );
  // The new marketplace error state must be declared before that guard.
  const st = src.skills.indexOf('const [marketError, setMarketError]');
  assert.ok(st > 0 && st < guard, `${FILES.skills}:${lineOf('skills', 'const [marketError')}: marketError declared before early return`);
});

// ------------------------------------------------------------
// 3 · SUBAGENTS — inspect / retry / clear with real states.
// ------------------------------------------------------------
test('v1131 SUBAGENTS: inspect opens detail from both the plate and the card', () => {
  has('subs', [
    'onOpen: (id: string) => void;',
    'onClick={row ? () => onOpen(row.id) : undefined}',
    'onOpenDetail={() => openSubagentDetail(r.id)}',
  ]);
});

test('v1131 SUBAGENTS: retry has a per-row busy state; clear confirms in a toast', () => {
  has('subs', [
    'const [retrying, setRetrying] = useState<Record<string, boolean>>({});',
    'setRetrying((prev) => ({ ...prev, [id]: true }));',
    'await retrySubagent(id);',
    'setRetrying((prev) => ({ ...prev, [id]: false }));',
    'retrying={!!retrying[r.id]}',
    'disabled={retrying}',
    "t('sa.retrying', 'Retrying…')",
    'await clearSubagents();',
    "t('sa.cleared', 'Subagent history cleared')",
  ]);
});

test('v1131 SUBAGENTS: plate count is honest about truncation', () => {
  has('subs', [
    'total: number;',
    'total={visible.length}',
    '{rows.length} / {total}',
    "t('sa.plate.countTip',",
  ]);
  hasNot('subs', ['{rows.length} / {PLATE_NODES}']);
});

// ------------------------------------------------------------
// 4 · Global hygiene on the owned surfaces.
// ------------------------------------------------------------
test('v1131: no no-op handlers, TODOs or unstable zustand selectors in owned files', () => {
  for (const [k, f] of Object.entries(FILES)) {
    const text = src[k];
    assert.ok(!/onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(text), `${f}: no empty onClick`);
    assert.ok(!/\b(?:TODO|FIXME|unwired|do nothing|not implemented)\b/i.test(text), `${f}: no TODO markers`);
    assert.ok(!/useStore\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\s*\{/.test(text), `${f}: no fresh-object selector`);
    assert.ok(!/useStore\(\s*\(?\s*\w+\s*\)?\s*=>\s*\[/.test(text), `${f}: no fresh-array selector`);
  }
});
