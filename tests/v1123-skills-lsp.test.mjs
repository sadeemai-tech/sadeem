import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.23 (AUDIT) — skills / LSP / coverage reliability.
// Real-shaped, offline contract tests for the four defects reported
// by the founder and fixed in the owned modules:
//   • skills.ts   — a generic action verb ("fix") selected unrelated
//                   skills; Arabic clitics (بالتقرير) under-scored;
//                   concept-only matches could outrank direct ones.
//   • lsp.ts      — a MISSING server binary was rendered as a crashed
//                   tool instead of an honest "install X" refusal;
//                   16-language install matrix stays honest.
//   • coverage.ts — narrowed paths were attached to a narrow one-off
//                   test command instead of the canonical suite link.
// v11.23 — the skills-index timeout was raised 3000ms → 15000ms because a
// full 1337-test parallel run still evicted a valid index at 3s. run_start is
// sent before this read, so the first-token contract is unaffected.
// The 145-tool registry count MUST stay. Selective (task-matched) skill
// injection stays — never inject the whole index.
// Run: node --test tests/v1123-skills-lsp.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub: userData (ledger/gate) + skills root land in the sandbox.
const ud = join(tmp, 'ud');
mkdirSync(ud, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(ud)} } };`);
const emptyBuiltins = join(tmp, 'empty-builtins');
mkdirSync(emptyBuiltins, { recursive: true });
process.env.SURNIA_SKILLS_BUILTIN_DIR = emptyBuiltins;

const skillsPath = join(tmp, 'skills.cjs');
const lspPath = join(tmp, 'lsp.cjs');
const coveragePath = join(tmp, 'coverage.cjs');
const defsPath = join(tmp, 'tool-defs.cjs');
bundle('electron/agent/skills.ts', skillsPath);
bundle('electron/agent/lsp.ts', lspPath);
bundle('electron/agent/coverage.ts', coveragePath);
bundle('electron/agent/tool-defs.ts', defsPath);

const skills = require(skillsPath);
const lsp = require(lspPath);
const coverage = require(coveragePath);

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
function addSkill(slug, name, description) {
  const dir = join(WS, '.surnia', 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nstep one`);
}
// Real built-in descriptions (verbatim shape) plus an Arabic-aware skill.
addSkill('git-workflow', 'Git Workflow', 'Safe, reviewable git operations — clean diffs, atomic commits, and non-destructive history edits.');
addSkill('performance-profiling', 'Performance Profiling', 'Find and fix real performance bottlenecks with measurement, not guesswork.');
addSkill('web-verify', 'Web Verify', 'The mandatory browser-verification loop for any UI the agent builds — open it live, probe it at 3 widths, screenshot it, LOOK at the image, fix, repeat until it is genuinely clean.');
addSkill('report-pdf', 'PDF Report Generator', 'Create real PDF reports and documents with full Arabic (RTL) typesetting.');
writeFileSync(join(WS, 'report.pdf'), '%PDF-1.4 fixture');
// Avoid the workspace .pdf reinforcing unrelated skills in these assertions.
const NO_FILES = ['x.unknownext'];

// ------------------------------------------------------------
// 1) SKILL MATCHING — right skill, honest reason, no false positives
// ------------------------------------------------------------

test('v1123 skills: a generic "fix" no longer injects unrelated performance/web skills', async () => {
  const matches = await skills.matchSkillsForTask(WS, 'Fix the git merge conflict', { fileTypes: NO_FILES });
  assert.ok(matches.some((m) => m.slug === 'git-workflow'), 'the git skill is still injected');
  assert.ok(!matches.some((m) => m.slug === 'performance-profiling'), 'performance skill was a "fix" false positive');
  assert.ok(!matches.some((m) => m.slug === 'web-verify'), 'web-verify skill was a "fix" false positive');
  assert.match(matches[0].reason, /overlap skill/);
});

test('v1123 skills: a domain verb still matches its own skill (no over-filtering)', async () => {
  const matches = await skills.matchSkillsForTask(WS, 'Verify the website', { fileTypes: NO_FILES });
  assert.ok(matches.some((m) => m.slug === 'web-verify'), 'verify is the web-verify domain, not a discarded stopword');
});

test('v1123 skills: Arabic clitics (بـ + ال) match the Arabic skill at high confidence', async () => {
  // Real-shaped Arabic request: "Create a PDF report in Arabic".
  const matches = await skills.matchSkillsForTask(WS, 'أنشئ تقرير PDF بالعربية', { fileTypes: NO_FILES });
  const hit = matches.find((m) => m.slug === 'report-pdf');
  assert.ok(hit, 'the Arabic/PDF skill matched despite the attached clitic');
  assert.equal(hit.confidence, 'high', 'full evidence (PDF + Arabic) was recovered, not just a partial match');
  assert.ok(hit.signals.conceptMatches.length >= 2, 'both document and Arabic concepts linked');
});

test('v1123 skills: selective injection stays — unrelated tasks inject nothing, section is advisory', async () => {
  const none = await skills.matchSkillsForTask(WS, 'What is the weather in Cairo tomorrow?', { fileTypes: NO_FILES });
  assert.deepEqual(none, []);
  assert.equal(skills.renderSkillInjection(none), '');
  const { matches, skills: promptSkills, section } = await skills.matchSkillsForPrompt(WS, 'Create a PDF report in Arabic', { fileTypes: NO_FILES });
  assert.ok(matches.length > 0 && matches.length <= 3, 'only task-matched skills (never the whole index)');
  assert.ok(promptSkills.every((s) => s.description.includes('why injected:')));
  assert.match(section, /ADVISORY ONLY/);
});

test('v1123 skills: the skillUsage ledger is still re-exported and records task + outcome', () => {
  assert.equal(typeof skills.recordSkillUsage, 'function');
  const e = skills.recordSkillUsage(ud, { slug: 'report-pdf', task: 'Create a PDF report in Arabic', outcome: 'ok', sessionId: 'v1123' });
  assert.ok(e && e.slug === 'report-pdf' && e.outcome === 'ok');
  assert.ok(skills.loadSkillUsage(ud, { slug: 'report-pdf' }).some((x) => x.sessionId === 'v1123'));
});

test('v1123 contract: the skills-trust gate and a bounded index timeout are kept', () => {
  const engine = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.match(engine, /\.surnia['"],\s*['"]skills-trusted|skills-trusted/, 'workspace skills-trust gate present');
  // v11.31 — the engine now passes the current task for selective injection.
  assert.match(engine, /skillsIndexLine\(workspace,\s*skillsTaskText\)[\s\S]{0,160}15_000/,
    'task-matched skills index read is bounded at 15000ms');
  const src = readFileSync(join(ROOT, 'electron/agent/skills.ts'), 'utf8');
  assert.match(src, /matchSkillsForTask/, 'selective, task-matched injection is still the path');
});

// ------------------------------------------------------------
// 2) LSP — missing binary is a setup refusal, never a crashed tool
// ------------------------------------------------------------

test('v1123 lsp: the 16-language install matrix is honest (real commands + hints + fallbacks)', () => {
  const inv = lsp.verifyLanguageMatrix();
  assert.equal(inv.total, 16, 'exactly 16 wired language servers');
  assert.equal(inv.ok, true, `all rows valid: ${JSON.stringify(inv.rows.filter((r) => !r.ok))}`);
  for (const row of inv.rows) {
    assert.match(row.installHint, /\S/, `${row.lang} has a copy-pasteable install hint`);
    assert.ok(row.autoInstall || row.externalBinary, `${row.lang} is either auto-installable or declares its external binary`);
  }
  assert.match(lsp.heuristicSentence(), /find_refs/);
});

test('v1123 lsp: failure classification separates "not installed" from "crashed"', () => {
  assert.equal(lsp.lspFailureKind('spawn pyright ENOENT'), 'not-installed');
  assert.equal(lsp.lspFailureKind("'clangd' is not recognized as an internal command"), 'not-installed');
  assert.equal(lsp.lspFailureKind('language server exited with code 2'), 'crashed');
  assert.equal(lsp.lspBinaryAvailable('__sadeem_no_such_binary__'), false);
});

test('v1123 lsp: a missing binary message contains the install command and no crash wording', () => {
  const spec = lsp.LSP_SERVERS.find((s) => s.lang === 'python');
  const notInstalled = lsp.lspUnavailableMessage(spec, 'binary not found on PATH', 'not-installed');
  assert.match(notInstalled, /server not installed/);
  assert.match(notInstalled, /npm i -g pyright/, 'exact install command reaches the user');
  assert.match(notInstalled, /find_refs/, 'honest heuristic fallback is named');
  assert.doesNotMatch(notInstalled, /crash|exited before it could answer/i);
  const crashed = lsp.lspUnavailableMessage(spec, 'language server exited with code 2', 'crashed');
  assert.match(crashed, /exited before it could answer/);
  assert.match(crashed, /not a missing tool/);
});

test('v1123 lsp: a real lsp_hover call with an absent server is an honest refusal, not a tool crash', async () => {
  const file = join(WS, 'missing_server.py');
  writeFileSync(file, 'def hello():\n    return 1\n');
  const ctx = {
    workspace: WS, sessionId: 'v1123-lsp', mcpServers: [], emit: () => {},
    approve: async () => { throw new Error('no approver in this harness'); },
  };
  const savedPath = process.env.PATH;
  process.env.PATH = join(tmp, 'empty-bin'); // no language servers on PATH
  mkdirSync(join(tmp, 'empty-bin'), { recursive: true });
  try {
    const r = await lsp.lspHoverTool({ path: 'missing_server.py', line: 1, character: 1 }, ctx);
    assert.equal(r.ok, false, 'honest refusal');
    assert.match(r.output, /server not installed/);
    assert.match(r.output, /Install it:/);
    assert.doesNotMatch(r.output, /crashed|failed:|language server exited/i, 'not reported as a crashed tool');
  } finally {
    process.env.PATH = savedPath;
  }
});

// ------------------------------------------------------------
// 3) COVERAGE — narrowed paths attach to the canonical suite link
// ------------------------------------------------------------

test('v1123 coverage: a narrow one-off is never chosen as the canonical command', () => {
  const tests = ['tests/auth.test.mjs'];
  const chained = 'npx jest tests/smoke.test.ts && npm test';
  const link = coverage.chooseCanonicalTestLink(chained);
  assert.ok(link && link.suite === true, 'the full-suite npm test link was chosen');
  assert.equal(
    coverage.buildNarrowedCommand(chained, tests),
    'npx jest tests/smoke.test.ts && npm test -- "tests/auth.test.mjs"',
  );
  assert.equal(
    coverage.buildNarrowedCommand('npm test && node --test tests/one-off.test.mjs', tests),
    'npm test -- "tests/auth.test.mjs" && node --test tests/one-off.test.mjs',
  );
});

test('v1123 coverage: v11.21 shapes still hold (build chain + honest null)', () => {
  const tests = ['tests/v1123-skills-lsp.test.mjs'];
  assert.equal(coverage.buildNarrowedCommand('npm run build && npm test && echo done', tests),
    'npm run build && npm test -- "tests/v1123-skills-lsp.test.mjs" && echo done');
  assert.equal(coverage.buildNarrowedCommand('npx jest', ['src/auth.test.ts']), 'npx jest "src/auth.test.ts"');
  assert.equal(coverage.buildNarrowedCommand('cargo test', tests), null);
});

test('v1123 coverage: selectAffectedTests picks the test that imports the changed module', async () => {
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'tests'), { recursive: true });
  writeFileSync(join(repo, 'src', 'budget.ts'), 'export const tau = 1;\n');
  writeFileSync(join(repo, 'tests', 'budget.test.mjs'), "import { tau } from '../src/budget';\nexport const t = tau;\n");
  writeFileSync(join(repo, 'tests', 'unrelated.test.mjs'), 'export const t = 1;\n');
  const sel = await coverage.selectAffectedTests(repo, [join(repo, 'src', 'budget.ts')]);
  assert.ok(sel.tests.some((t) => /budget\.test\.mjs$/.test(t)));
  assert.ok(!sel.tests.some((t) => /unrelated/.test(t)));
});

test('v1123 contract: the 145-tool registry is unchanged', () => {
  const defs = require(defsPath).CORE_DEFS;
  assert.equal(defs.length, 145);
});

test('after: clean temp dir', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
