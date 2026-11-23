import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.11 (A7-COGNITION) — SKILLS / DNA / MODES / MCP ARE REALLY USED.
// Complements v1110-subsystems (engine-level) + v1111-modes (mode gates)
// with the pieces those suites do not touch:
//
//   1. SKILLS  — the agent's SELF-WRITING loop at tool level: create_skill
//                writes plaintext SKILL.md on disk → use_skill loads it back
//                → touchSkillUsage bumps `uses:` → appendSkillRefinement
//                appends '## Refinements' + bumps version (same-topic
//                entries REPLACE, not pile up). Plus: the BUILT-IN library
//                is retrievable/searchable via listSkills/skillsIndexLine.
//   2. PROMPT  — buildSystemPrompt injects the SKILLS index (+ SKILLS-FIRST
//                rule), the User DNA section (advisory contract) and the
//                permission-mode notes.
//   3. DNA     — facts are SHORT (TEXT_CAP 240 chars ≈ ≤50 words), persist
//                to userData/dna.json with owner-only 0600, reload fresh,
//                render into the prompt, are INSPECTABLE (dnaStats) and
//                FORGETTABLE (forgetMemory).
//   4. MODES   — the TASK_MODE_SPECS registry contract: plan/review are
//                HARD read-only with denyHints; debug carries the test-loop
//                protocol; review produces .surnia/reviews report language.
//   5. MCP     — REAL round trip against the SHIPPED proof server
//                (scripts/mcp-proof-server.mjs) through the app's bundled
//                client: mcpListTools → mcpCallTool → result.
//
// Run: node --test tests/v1111-cognition.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1111-cognition-'));
const ud = join(tmp, 'userdata'); // electron-stub userData — dna.json + skills land here
mkdirSync(ud, { recursive: true });

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }
});

// ---------- esbuild bundle (same posture as the v1110/v1111 harnesses) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: (k) => ${JSON.stringify(ud)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {}, screen: {},
  };`,
);

// built-in library ships as plaintext SKILL.md folders (post-build copies
// electron/assets/skills → dist-electron/skills; the env var pins the test to it)
process.env.SURNIA_SKILLS_BUILTIN_DIR = join(ROOT, 'dist-electron', 'skills');

// ---------- bundles ----------
const mods = {};
for (const [name, entry] of Object.entries({
  skills: 'electron/agent/skills.ts',
  prompts: 'electron/agent/prompts.ts',
  dna: 'electron/agent/dna.ts',
  tools: 'electron/agent/tools.ts',
  mcp: 'electron/agent/mcp.ts',
})) {
  const out = join(tmp, `${name}.cjs`);
  bundle(entry, out);
  mods[name] = require(out);
}
const { skills, prompts, dna, tools, mcp } = mods;

const WS = join(tmp, 'ws');

// ============================================================
// 1. SKILLS — the agent's self-writing loop, plaintext on disk
// ============================================================
test('skills: agent writes a skill via create_skill → plaintext SKILL.md on disk → use_skill loads it back', async () => {
  const ctx = { workspace: WS, sessionId: 'cog-skill', mcpServers: [], emit() {}, approve: async () => true };
  const created = await tools.executeTool(
    'create_skill',
    JSON.stringify({
      name: 'Deploy Ritual',
      description: 'how to ship this project without breaking prod',
      body: '# Deploy Ritual\n1. npm run build\n2. npm test\n3. tag the release',
    }),
    ctx,
  );
  assert.equal(created.ok, true, `create_skill OK: ${created.output.slice(0, 120)}`);
  const skillFile = join(WS, '.surnia', 'skills', 'deploy-ritual', 'SKILL.md');
  assert.ok(existsSync(skillFile), 'SKILL.md exists as a PLAINTEXT file on disk');
  const onDisk = readFileSync(skillFile, 'utf8');
  assert.match(onDisk, /^---\nname: Deploy Ritual\ndescription: how to ship this project without breaking prod\n---/, 'frontmatter written Hermes-style');

  const loaded = await tools.executeTool('use_skill', JSON.stringify({ slug: 'deploy-ritual' }), ctx);
  assert.equal(loaded.ok, true, 'use_skill loads the just-created skill');
  assert.ok(loaded.output.includes('npm run build') && loaded.output.includes('[skill loaded: Deploy Ritual'), 'use_skill returns the full body');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(50);
  }
}

test('skills: usage + refinement self-improvement — uses: bumps, ## Refinements appended, same-topic replaces, version bumps', async () => {
  const ctx = { workspace: WS, sessionId: 'cog-skill', mcpServers: [], emit() {}, approve: async () => true };
  const file = join(WS, '.surnia', 'skills', 'deploy-ritual', 'SKILL.md');
  // two more REAL use_skill calls (the tool fires touchSkillUsage internally)
  for (let i = 0; i < 2; i++) {
    const again = await tools.executeTool('use_skill', JSON.stringify({ slug: 'deploy-ritual' }), ctx);
    assert.equal(again.ok, true, 'use_skill repeats cleanly');
  }
  // the tool fires the usage bump fire-and-forget — poll for all three lands
  await waitFor(() => /uses: 3/.test(readFileSync(file, 'utf8')), 8000, 'uses: 3 on disk');
  const withUsage = readFileSync(file, 'utf8');
  assert.match(withUsage, /uses: 3/, 'frontmatter `uses:` counts real tool usage');
  assert.match(withUsage, /lastUsed: \d+/, 'lastUsed stamped');

  const v1 = await skills.skillVersion(WS, 'deploy-ritual');
  const bumped = await skills.appendSkillRefinement(WS, 'deploy-ritual', 'stale lockfile', 'Delete package-lock.json and reinstall before building when the build fails on missing deps.');
  assert.equal(bumped, v1 + 1, 'appendSkillRefinement bumps the version');
  let body = readFileSync(file, 'utf8');
  assert.match(body, /## Refinements/, 'the Refinements section exists');
  assert.match(body, /stale lockfile — Delete package-lock\.json/, 'the refinement bullet is on disk');

  // same topic again → REPLACED in place, version bumps again, no pile-up
  const v2 = await skills.skillVersion(WS, 'deploy-ritual');
  const againRef = await skills.appendSkillRefinement(WS, 'deploy-ritual', 'stale lockfile', 'Newer, better guidance for the same failure.');
  assert.equal(againRef, v2 + 1, 'second refinement on the same topic still bumps the version');
  body = readFileSync(file, 'utf8');
  assert.ok(!body.includes('Delete package-lock.json'), 'old same-topic bullet replaced, not stacked');
  assert.match(body, /Newer, better guidance/, 'new bullet present');
  const bullets = body.split('## Refinements')[1].split('\n').filter((l) => /^\s*-\s/.test(l));
  assert.equal(bullets.length, 1, 'exactly ONE bullet for the one topic');
});

test('skills: built-in library is retrievable and searchable (listSkills + index line + loadSkill)', async () => {
  const list = await skills.listSkills(WS);
  const builtin = list.filter((s) => s.scope === 'builtin');
  assert.ok(builtin.length >= 8, `shipped built-ins discovered (got ${builtin.length})`);
  const index = await skills.skillsIndexLine(WS);
  assert.ok(index.includes('debug-protocol') && index.includes('arabic-first'), 'index line lists built-ins by slug');
  assert.ok(index.includes('[builtin]'), 'built-ins carry their honest badge');
  const hit = await skills.loadSkill(WS, 'debug-protocol');
  assert.equal(hit?.scope, 'builtin', 'loadSkill resolves a built-in');
  assert.ok((hit?.body ?? '').length > 100, 'built-in body is real content');
});

// ============================================================
// 2. PROMPT — skills index + DNA + mode notes are INJECTED
// ============================================================
test('prompts: SKILLS index + SKILLS-FIRST rule + User DNA + plan read-only note all land in the system prompt', () => {
  const built = prompts.buildSystemPrompt({
    workspace: WS,
    mode: 'plan',
    platform: process.platform,
    skills: [{ name: 'Deploy Ritual', description: 'how to ship this project' }],
    dna: 'PROFILE:\n- role: solo founder shipping SADEEM',
  });
  assert.ok(built.includes('# SKILLS') && built.includes('Deploy Ritual'), 'SKILLS section injected');
  assert.ok(built.includes('SKILLS-FIRST RULE') && built.includes('use_skill'), 'the prompt teaches the use_skill-first behavior');
  assert.ok(built.includes('# User DNA') && built.includes('solo founder'), 'DNA section injected');
  assert.ok(built.includes('NEVER rules, NEVER bans') || built.includes('never bans'), 'DNA carries the advisory contract');
  assert.ok(built.includes('PLAN MODE — strictly read-only'), 'plan permission mode is read-only in the prompt');

  const dbg = prompts.buildSystemPrompt({ workspace: WS, mode: 'fullAccess', platform: process.platform, taskMode: 'debug' });
  assert.ok(dbg.includes('# Debug protocol (taskMode: debug)'), 'debug protocol section injected');
  const rev = prompts.buildSystemPrompt({ workspace: WS, mode: 'fullAccess', platform: process.platform, taskMode: 'review' });
  assert.ok(rev.includes('# Review mode (taskMode: review)') && rev.includes('.surnia/reviews'), 'review protocol + report artifact injected');
});

// ============================================================
// 3. MODES — the TASK_MODE_SPECS registry contract
// ============================================================
test('modes: registry — plan/review HARD read-only with denyHints; build/debug are not; debug carries the test loop', () => {
  const specs = prompts.TASK_MODE_SPECS;
  assert.equal(specs.plan.readOnly, true, 'plan is read-only');
  assert.equal(specs.review.readOnly, true, 'review is read-only');
  assert.equal(specs.build.readOnly, false, 'build is not read-only');
  assert.equal(specs.debug.readOnly, false, 'debug is not read-only');
  assert.ok(specs.plan.denyHint && /read-only|approve/i.test(specs.plan.denyHint), 'plan denyHint exists');
  assert.ok(specs.review.denyHint && /read-only/i.test(specs.review.denyHint), 'review denyHint exists');

  const plan = prompts.taskModeProtocolSection('plan') ?? '';
  assert.match(plan, /harness-enforced/i, 'plan posture is harness-enforced, not vibes');
  assert.match(plan, /plan\.md/, 'plan keeps exactly the ONE sanctioned write (plan.md)');
  const debug = prompts.taskModeProtocolSection('debug') ?? '';
  assert.match(debug, /REPRODUCE/, 'debug protocol reproduces first');
  assert.match(debug, /auto-runs the project tests|verdict/i, 'debug promises the harness test loop + verdict');
  const review = prompts.taskModeProtocolSection('review') ?? '';
  assert.match(review, /review-\d|\.surnia\/reviews|structured review/i, 'review ends in a persisted report');
});

// ============================================================
// 4. DNA — short facts, 0600 on disk, injectable, inspectable, forgettable
// ============================================================
test('dna: agent fact is capped to a short declarative sentence (≤240 chars ≈ ≤50 words), persisted 0600, reloaded fresh', async () => {
  dna.clearDNA('all');
  const longFact =
    'The user always bootstraps with pnpm not npm, insists on zod for runtime validation, wants Arabic-first UI copy, ' +
    'reviews diffs before every push, dislikes video backgrounds on landing pages, and deploys on Thursdays only ' +
    'because Fridays are sacred — and a few more words to push this fact well past the fifty-word cap on purpose.';
  assert.ok(longFact.length > 260 && longFact.split(/\s+/).length > 50, 'precondition: input exceeds the cap');
  const changed = await dna.recordAgentNote('preference', longFact);
  assert.equal(changed, true, 'fact accepted');

  const fresh = (() => { delete require.cache[require.resolve(join(tmp, 'dna.cjs'))]; return require(join(tmp, 'dna.cjs')); })();
  const model = fresh.loadDNA(WS);
  const pat = model.patterns.find((p) => p.text.includes('pnpm not npm'));
  assert.ok(pat, 'pattern persisted + reloaded from dna.json');
  assert.ok(pat.text.length <= 240, `stored fact is short on disk (${pat.text.length} chars ≤ 240 ≈ ≤50 words)`);

  const file = join(ud, 'dna.json');
  assert.ok(existsSync(file), 'dna.json exists in userData');
  // POSIX permission bits are not meaningful on Windows (Node reports 0666
  // regardless of the mode passed to writeFileSync) — assert 0600 only on POSIX.
  if (process.platform !== 'win32') {
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `owner-only 0600 (got ${mode.toString(8)})`);
  }
  JSON.parse(readFileSync(file, 'utf8')); // honest JSON on disk
});

test('dna: post-run extraction merges profile + patterns → renders into the prompt → inspectable via dnaStats → forgettable', async () => {
  const changed = await dna.mergeExtractionInto(WS, {
    profile_additions: { role: 'solo founder', expertise: ['Electron', 'TypeScript'], likes: ['concise answers'] },
    patterns_additions: [{ kind: 'command', text: 'runs pnpm instead of npm for every install' }],
  });
  assert.equal(changed, true, 'extraction merged');

  const model = dna.loadDNA(WS);
  assert.equal(model.profile.role, 'solo founder', 'profile role learned');
  assert.ok(model.profile.expertise.includes('Electron'), 'expertise learned');
  assert.ok(model.patterns.some((p) => p.text.includes('pnpm instead of npm')), 'pattern learned');

  const rendered = dna.renderDNAPrompt(model);
  assert.ok(rendered.includes('ADVISORY DEFAULTS'), 'render starts with the advisory contract');
  assert.ok(rendered.includes('solo founder') && rendered.includes('pnpm instead of npm'), 'render carries role + pattern');

  const built = prompts.buildSystemPrompt({ workspace: WS, mode: 'fullAccess', platform: process.platform, dna: rendered });
  assert.ok(built.includes('# User DNA (evolves with this user)'), 'session-start prompt carries the DNA section');

  const stats = dna.dnaStats(WS);
  assert.ok(stats.patterns >= 2 && stats.sessionsObserved >= 1, `dnaStats is inspectable (${stats.patterns} patterns, ${stats.sessionsObserved} sessions)`);
  assert.ok(Array.isArray(stats.growth) && stats.growth.length === 14, '14-day growth series exposed');

  const removed = dna.forgetMemory(WS, 'pnpm instead of npm');
  assert.ok(removed >= 1, `forgetMemory removes matching facts (${removed})`);
  assert.ok(!dna.loadDNA(WS).patterns.some((p) => p.text.includes('pnpm instead of npm')), 'the fact is really gone');
});

// ============================================================
// 5. MCP — REAL round trip against the SHIPPED proof server
// ============================================================
test('mcp: bundled client round-trips the shipped proof server (list → call → result)', async () => {
  const cfg = {
    id: 'proof', name: 'sadeem-proof-mcp',
    command: process.execPath, args: [join(ROOT, 'scripts', 'mcp-proof-server.mjs')],
    transport: 'stdio', timeoutMs: 10000, enabled: true,
  };
  const list = await mcp.mcpListTools(cfg);
  assert.equal(list.ok, true, `mcpListTools OK against scripts/mcp-proof-server.mjs`);
  const names = (list.tools ?? []).map((t) => t.name);
  assert.deepEqual(names.sort(), ['echo', 'now'], 'tools/list discovered the real server tools');

  const echo = await mcp.mcpCallTool(cfg, 'echo', { message: 'cognition-suite proof' });
  assert.equal(echo.ok, true, 'mcpCallTool(echo) OK');
  assert.ok(String(echo.output).includes('echo: cognition-suite proof'), 'echo result text round-tripped');

  const now = await mcp.mcpCallTool(cfg, 'now', {});
  assert.equal(now.ok, true, 'mcpCallTool(now) OK');
  assert.ok(!Number.isNaN(new Date(String(now.output).trim()).getTime()), 'now returned a real ISO timestamp');

  mcp.closeAllMcpClients();
});
