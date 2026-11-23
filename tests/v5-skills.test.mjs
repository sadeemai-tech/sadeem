import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// Surnia v5.0.0 — skills library verification (offline)
// Scope merge (builtin → global → workspace), fork, import,
// delete-refusal for built-ins, create_skill tool presence.
// Run: node --test tests/v5-skills.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v5-skills-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub: userData → tmp/ud so globalSkillsRoot() lands in the sandbox
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = { app: { getPath: (k) => ${JSON.stringify(join(tmp, 'ud'))} } };`,
);

process.env.SURNIA_SKILLS_BUILTIN_DIR = join(ROOT, 'dist-electron', 'skills');
const mod = join(tmp, 'skills.cjs');
bundle(join(ROOT, 'electron/agent/skills.ts'), mod);
const skills = require(mod);

const WS = join(tmp, 'ws');

test('v5: builtin skills ship and parse', async () => {
  // builtinSkillsRoot resolves dist-electron/skills — exists after a build
  const list = await skills.listSkills(WS);
  const builtin = list.filter((s) => s.scope === 'builtin');
  assert.ok(builtin.length >= 6, `expected ≥6 built-in skills, got ${builtin.length}`);
  const names = builtin.map((s) => s.slug);
  for (const slug of ['arabic-first', 'web-quality', 'code-review', 'release-notes', 'python-data', 'debug-protocol']) {
    assert.ok(names.includes(slug), `missing built-in skill: ${slug}`);
  }
  const loaded = await skills.loadSkill(WS, 'arabic-first');
  assert.ok(loaded, 'arabic-first loads');
  assert.equal(loaded.scope, 'builtin');
  assert.ok(loaded.body.includes('RTL'), 'arabic-first body mentions RTL');
});

test('v5: save → global + workspace scopes and override order', async () => {
  const g = await skills.saveSkill(WS, { name: 'Deploy Checklist', description: 'how to ship', body: '# steps\n1. build' }, 'global');
  assert.equal(g, 'deploy-checklist');
  let hit = await skills.loadSkill(WS, 'deploy-checklist');
  assert.equal(hit.scope, 'global');

  const w = await skills.saveSkill(WS, { name: 'Deploy Checklist', description: 'project-specific', body: 'project override' }, 'workspace');
  assert.equal(w, 'deploy-checklist');
  hit = await skills.loadSkill(WS, 'deploy-checklist');
  assert.equal(hit.scope, 'workspace', 'workspace overrides global');
  assert.ok(hit.body.includes('override'));

  const list = await skills.listSkills(WS);
  const entry = list.find((s) => s.slug === 'deploy-checklist');
  assert.equal(entry.scope, 'workspace', 'merged index reports the winning scope');
});

test('v5: import folder with companion files', async () => {
  const src = join(tmp, 'src-skill');
  mkdirSync(join(src, 'references'), { recursive: true });
  writeFileSync(join(src, 'SKILL.md'), '---\nname: Imported Skill\ndescription: has references\n---\nbody here');
  writeFileSync(join(src, 'references', 'guide.md'), '# guide');
  const slug = await skills.importSkillDir(WS, src, 'global');
  assert.equal(slug, 'imported-skill');
  const loaded = await skills.loadSkill(WS, slug);
  assert.ok(loaded, 'imported skill loads');
  const files = await skills.skillFiles(WS, slug);
  assert.ok(files.includes('references/guide.md'), `companion files listed: ${files.join(',')}`);
});

test('v5: built-ins cannot be deleted or overwritten in place', async () => {
  const ok = await skills.deleteSkill(WS, 'code-review', 'builtin');
  assert.equal(ok, false, 'builtin delete refused');
  assert.ok(existsSync(join(ROOT, 'dist-electron', 'skills', 'code-review', 'SKILL.md')), 'built-in intact');

  // delete workspace-scoped copy works
  const w = await skills.deleteSkill(WS, 'deploy-checklist', 'workspace');
  assert.equal(w, true);
  const hit = await skills.loadSkill(WS, 'deploy-checklist');
  assert.equal(hit.scope, 'global', 'falls back to global after workspace delete');
});

test('v5: fork a built-in into an editable scope', async () => {
  const forked = await skills.forkBuiltinSkill(WS, 'debug-protocol', 'global');
  assert.equal(forked, 'debug-protocol');
  const file = join(tmp, 'ud', 'skills', 'debug-protocol', 'SKILL.md');
  assert.ok(existsSync(file), 'forked into userData/skills');
  assert.ok(readFileSync(file, 'utf8').includes('Debug protocol'), 'content copied');
});

test('v5: create_skill tool is registered and prompt-indexed', () => {
  // v11.12 (SPLIT-1) — tool DEFINITIONS moved to tool-defs.ts.
  const defs = readFileSync(join(ROOT, 'electron/agent/tool-defs.ts'), 'utf8');
  const tools = readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8');
  assert.ok(defs.includes("name: 'create_skill'"), 'create_skill tool def exists');
  assert.ok(/case 'create_skill':/.test(tools), 'create_skill dispatched');
  const skillsIdx = readFileSync(join(ROOT, 'electron/agent/skills.ts'), 'utf8');
  assert.ok(skillsIdx.includes('skillsIndexLine'), 'skills index builder present');
});

test('cleanup', () => {
  rmSync(tmp, { recursive: true, force: true });
});
