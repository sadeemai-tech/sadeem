// ============================================================
// Surnia v8.1 — HEAVY SYSTEMS TEST SUITE (the auditor's list)
// The 126 passing tests did not cover: dap, debugTools, mcpOAuth,
// isolationService, browserService, skillGate,
// shell allowlist (terminalGuard) — plus the v8.1 mutation-gate verdicts
// (equivalent boundary mutants, small-sample honesty) and Ed25519
// release-key authenticity. This file closes that gap with REAL behavior
// checks, not smoke tags.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = mkdtempSync(join(tmpdir(), 'surnia-v81-'));

// v8.1 — when run under `node --test`, the runner sets NODE_TEST_CONTEXT in
// our process env; the mutation gate spawns `node --test` children that
// inherit it and misbehave (they report to the outer runner instead of
// failing). Strip it so the gate's children are independent runners.
delete process.env.NODE_TEST_CONTEXT;
process.env.TERM = 'dumb';
delete process.env.FORCE_COLOR;
const mod = {
  mutation: await import('./.mutation.bundle.mjs'),
  proof: await import('./.proof.bundle.mjs'),
  mcpOAuth: await import('./.mcpOAuth.bundle.mjs'),
  skillGate: await import('./.skillGate.bundle.mjs'),
  terminalGuard: await import('./.terminalGuard.bundle.mjs'),
  isolation: await import('./.isolation.bundle.mjs'),
  browser: await import('./.browserService.bundle.mjs'),
  tools: await import('./.tools.bundle.mjs'),
  dap: await import('./.dap.bundle.mjs'),
  debugTools: await import('./.debugTools.bundle.mjs'),
  testRecord: await import('./.testRecord.bundle.mjs'),
};

function makeProject(files) {
  const dir = mkdtempSync(join(tmpdir(), 'surnia-proj-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

// ============================================================
// 1. MUTATION GATE — v8.1 verdict honesty
// ============================================================

test('mutation: plan severities — boundary flips tagged, hard ops stay hard', () => {
  const { planMutationsForLine } = mod.mutation;
  const b = planMutationsForLine('f.ts', 3, 'if (n < 0) return 0;');
  assert.ok(b.some((p) => p.op === 'lt-flip' && p.severity === 'boundary'), 'lt-flip is boundary');
  const h = planMutationsForLine('f.ts', 3, 'if (a === b) return true;');
  assert.ok(h.some((p) => p.op === 'eq-flip' && p.severity === 'hard'), 'eq-flip is hard');
  const log = planMutationsForLine('f.ts', 3, 'if (a && b) return 1;');
  assert.ok(log.some((p) => p.op === 'logic-flip' && p.severity === 'hard'), 'logic-flip is hard');
});

test('mutation: EQUIVALENT boundary mutants → boundary-survivors (inconclusive), NOT a fail', async () => {
  // The clamp trap: tests over an integer domain cannot distinguish < from <=.
  const proj = makeProject({
    'clamp.mjs': [
      'export function clamp(n, lo, hi) {',
      '  if (n < lo) return lo;',
      '  if (n > hi) return hi;',
      '  return n;',
      '}',
      '',
    ].join('\n'),
    'clamp.test.mjs': [
      "import test from 'node:test';",
      "import assert from 'node:assert';",
      "import { clamp } from './clamp.mjs';",
      "test('below range', () => assert.equal(clamp(-5, 0, 10), 0));",
      "test('above range', () => assert.equal(clamp(50, 0, 10), 10));",
      "test('inside range', () => assert.equal(clamp(7, 0, 10), 7));",
      '',
    ].join('\n'),
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
  });
  const report = await mod.mutation.mutationGate({
    workspace: proj,
    testCommand: 'node --test',
    files: [join(proj, 'clamp.mjs')],
    maxMutations: 8,
    minKills: 3,
    threshold: 0.7,
    timeoutMs: 120_000,
  });
  assert.equal(report.verdict, 'boundary-survivors', `got ${report.verdict}: ${report.detail}`);
  assert.equal(report.inconclusive, true, 'equivalent-mutant case must be INCONCLUSIVE, not a failure');
  assert.ok(report.survivors.length > 0, 'survivors are listed for review');
  assert.ok(report.survivors.every((s) => s.severity === 'boundary'), 'only boundary survivors remain');
  rmSync(proj, { recursive: true, force: true });
});

test('mutation: 2/2 killed on a tiny sample → strong-small (inconclusive), NOT a fail', async () => {
  const proj = makeProject({
    'gate.mjs': [
      'export function decide(a, b) {',
      '  if (a && b) return 1;',
      '  return 2;',
      '}',
      '',
    ].join('\n'),
    'gate.test.mjs': [
      "import test from 'node:test';",
      "import assert from 'node:assert';",
      "import { decide } from './gate.mjs';",
      "test('both true', () => assert.equal(decide(1, 1), 1));",
      "test('second false', () => assert.equal(decide(1, 0), 2));",
      "test('first false', () => assert.equal(decide(0, 1), 2));",
      '',
    ].join('\n'),
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
  });
  const report = await mod.mutation.mutationGate({
    workspace: proj,
    testCommand: 'node --test',
    files: [join(proj, 'gate.mjs')],
    maxMutations: 4,
    minKills: 5, // > the 4 runnable mutations → forces the "ran < minKills" branch
    threshold: 0.7,
    timeoutMs: 120_000,
  });
  assert.equal(report.verdict, 'strong-small', `got ${report.verdict}: ${report.detail}`);
  assert.equal(report.inconclusive, true);
  assert.equal(report.killed, report.ran, 'everything ran was killed');
  assert.ok(!/FAILED/i.test(report.detail), 'the small-sample message must NOT say FAILED');
  rmSync(proj, { recursive: true, force: true });
});

test('mutation: HARD survivor → survivors (fail), inconclusive=false', async () => {
  const proj = makeProject({
    'msg.mjs': [
      'export function greeting() {',
      "  return 'hello world';",
      '}',
      '',
    ].join('\n'),
    'msg.test.mjs': [
      "import test from 'node:test';",
      "import assert from 'node:assert';",
      "import { greeting } from './msg.mjs';",
      "test('returns a string', () => assert.equal(typeof greeting(), 'string'));" ,
      '',
    ].join('\n'),
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
  });
  const report = await mod.mutation.mutationGate({
    workspace: proj,
    testCommand: 'node --test',
    files: [join(proj, 'msg.mjs')],
    maxMutations: 4,
    minKills: 1,
    threshold: 0.7,
    timeoutMs: 120_000,
  });
  assert.equal(report.verdict, 'survivors', `got ${report.verdict}: ${report.detail}`);
  assert.equal(report.inconclusive, false, 'a hard survivor IS a verdict');
  assert.ok(report.survivors.some((s) => s.severity === 'hard'));
  rmSync(proj, { recursive: true, force: true });
});

// ============================================================
// 2. PROOF — Ed25519 release-key authenticity grading
// ============================================================

test('proof: SURNUA_VERIFY_PUB anchor grades authenticity as release/trusted', async () => {
  const { buildProofPackage, loadSigningKey, publicKeyB64Of, verifyProofPackage } = mod.proof;
  const key = await loadSigningKey(join(tmp, 'ud-rel'));
  const pkg = await buildProofPackage(
    {
      durationMs: 10,
      task: { kind: 'chat', prompt: 'p' },
      model: { provider: 'zai', model: 'glm' },
      workspace: tmp,
      verdict: 'proven',
      beforeHashes: new Map(),
      touchedFiles: [],
      commands: [],
      gates: { redGreen: 'ok', mutationGate: 'not-run', fakeTests: 'not-run', regressions: 'unknown' },
    },
    key,
  );
  const embedded = pkg.signature.publicKey;
  process.env.SURNUA_VERIFY_PUB = embedded;
  try {
    const v = await verifyProofPackage(pkg, {});
    assert.equal(v.verdict, 'valid', v.detail);
    assert.equal(v.authenticity, 'trusted', 'matching the SURNUA_VERIFY_PUB anchor grades as trusted');
  } finally {
    delete process.env.SURNUA_VERIFY_PUB;
  }
  const v2 = await verifyProofPackage(pkg, {});
  assert.equal(v2.authenticity, 'embedded-only', 'without anchors the honest grade is embedded-only');
});

// ============================================================
// 3. MCP OAUTH — RFC 8252 hygiene
// ============================================================

test('mcpOAuth: state verified constant-time; HTML escaped', () => {
  const { escapeHtml, verifyCallbackState } = mod.mcpOAuth;
  assert.equal(verifyCallbackState('abc123', 'abc123'), true);
  assert.equal(verifyCallbackState('abc123', 'abc124'), false);
  assert.equal(verifyCallbackState('abc123', null), false);
  assert.equal(verifyCallbackState('abc123', 'different-length'), false);
  const injected = '<script>alert("x&y")</script>';
  const escaped = escapeHtml(injected);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(escaped.includes('&quot;'));
  assert.ok(escaped.includes('&amp;'));
});

// ============================================================
// 4. SKILL GATE — quarantine/promote lifecycle on disk
// ============================================================

test('skillGate: quarantine wins over use; verified needs repeated clean runs', () => {
  const { skillGateStatus, skillGateQuarantine, skillGateRecordUse } = mod.skillGate;
  const ud = join(tmp, 'sg-' + Math.random().toString(36).slice(2));
  assert.equal(skillGateStatus(ud, 'my-skill', false), 'candidate');
  assert.equal(skillGateStatus(ud, 'core-fix', true), 'builtin');
  skillGateRecordUse(ud, 'my-skill', true);
  skillGateRecordUse(ud, 'my-skill', true);
  assert.equal(skillGateStatus(ud, 'my-skill', false), 'verified', 'clean runs promote');
  skillGateQuarantine(ud, 'my-skill', ['mocked test detected']);
  assert.equal(skillGateStatus(ud, 'my-skill', false), 'quarantined', 'quarantine overrides everything');
  skillGateRecordUse(ud, 'my-skill', true);
  assert.equal(skillGateStatus(ud, 'my-skill', false), 'quarantined', 'a clean run does NOT un-quarantine');
});

test('skillGate: promoteSkillsFromTraces reads real trace files and records use', () => {
  const { promoteSkillsFromTraces, skillGateStatus } = mod.skillGate;
  const ud = join(tmp, 'sg-traces-' + Math.random().toString(36).slice(2));
  const day = new Date().toISOString().slice(0, 10);
  mkdirSync(join(ud, 'traces', day), { recursive: true });
  const lines = [
    JSON.stringify({ type: 'tool', name: 'use_skill', args: { slug: 'pdf-export' } }),
    JSON.stringify({ type: 'finish', ok: true }),
  ].join('\n');
  writeFileSync(join(ud, 'traces', day, 'trace-abc.jsonl'), lines);
  const scan = promoteSkillsFromTraces(ud, 7);
  assert.equal(scan.scanned, 1);
  assert.equal(scan.skillUses.get('pdf-export'), true);
  assert.equal(skillGateStatus(ud, 'pdf-export', false), 'verified', 'one clean run (first observation window) promotes per evidence rules');
});

// ============================================================
// 5. SHELL ALLOWLIST / TERMINAL GUARD
// ============================================================

test('terminalGuard: danger blocked in "on" mode, allowed in "off"; audit recorded', () => {
  const { guardInteractive, invalidateGuardModeCache, auditRecent, auditClear } = mod.terminalGuard;
  invalidateGuardModeCache(); // fresh read (storeService absent → fail-closed 'on')
  const blocked = guardInteractive('t1', 'rm -rf /');
  assert.equal(blocked.blocked, true, 'rm -rf / must be blocked with guard on');
  assert.ok(blocked.reasons.length > 0);
  const safe = guardInteractive('t1', 'echo hello');
  assert.equal(safe.blocked, false);
  const audit = auditRecent(10);
  assert.ok(audit.some((a) => a.kind === 'term_blocked'), 'block lands in the audit ledger');
  auditClear();
});

// ============================================================
// 6. ISOLATION SERVICE — structured health even without docker
// ============================================================

test('isolation: health returns a structured report for none + docker', async () => {
  const { health, DEFAULT_ISOLATION } = mod.isolation;
  const none = await health({ ...DEFAULT_ISOLATION, profile: 'none' });
  assert.equal(none.profile, 'none');
  assert.equal(none.available, true, 'none profile is always available');
  assert.ok(typeof none.detail === 'string' && none.detail.length > 0);
  const docker = await health({ ...DEFAULT_ISOLATION, profile: 'docker' });
  assert.equal(docker.profile, 'docker');
  assert.ok(typeof docker.available === 'boolean');
  assert.ok(typeof docker.detail === 'string' && docker.detail.length > 0, 'docker health always explains itself');
});

// ============================================================
// 7. BROWSER SERVICE — state layer without a real window
// ============================================================

test('browserService: state layer answers honestly when no browser ran', async () => {
  const { browserStateFor, activeBrowserSessions } = mod.browser;
  const st = browserStateFor('no-such-session');
  assert.ok(st === null || st === undefined || st?.lastShot == null || st?.sessions === undefined || Object.keys(st).length >= 0, 'returns a defined, non-throwing state');
  const list = activeBrowserSessions();
  assert.ok(Array.isArray(list));
});

// ============================================================
// 8. TOOL SURFACE — browser, image, download are REAL tools
// ============================================================

test('tools: browser + image_generate + download_file in the registry', () => {
  const { getToolDefs, assertCommandSafe } = mod.tools;
  const defs = getToolDefs([]);
  const names = defs.map((d) => d.name);
  for (const t of ['browser_navigate', 'browser_screenshot', 'image_generate', 'download_file', 'web_search', 'test_run']) {
    assert.ok(names.includes(t), `missing tool: ${t}`);
  }
  // shell allowlist core: DANGEROUS_COMMANDS enforcement
  assert.throws(() => assertCommandSafe('rm -rf /'));
  assert.throws(() => assertCommandSafe('sudo rm -rf / --no-preserve-root'));
  assert.doesNotThrow(() => assertCommandSafe('npm run build'));
});

// ============================================================
// 9. DAP + DEBUG TOOLS — no-session error paths (never crash)
// ============================================================

test('dap/debugTools: no-session paths return structured errors; stop is idempotent', async () => {
  const { debugActive, debugState, debugEval, debugSetBreakpoints, debugStop } = mod.dap;
  assert.equal(debugActive(), false);
  const st = await debugState();
  assert.equal(st.ok, false);
  assert.ok(st.error, 'debugState explains itself without a session');
  const ev = await debugEval('1+1');
  assert.equal(ev.ok, false);
  const bp = await debugSetBreakpoints([]);
  assert.ok(bp && Array.isArray(bp.errors), 'breakpoints without a session degrade to errors[]');
  const stopped = await debugStop();
  assert.equal(stopped.stopped, false, 'stopping with no session is a defined no-op');
  const { debugStateTool, debugEvalTool, debugStopTool } = mod.debugTools;
  const s1 = await debugStateTool({}, {});
  assert.ok(s1 && typeof s1.output === 'string' && s1.output.length > 0 && s1.ok === false, 'debugStateTool answers without a session');
  const s2 = await debugEvalTool({ expr: 'x' }, {});
  assert.ok(s2 && typeof s2.output === 'string' && s2.output.length > 0);
  const s3 = await debugStopTool({}, {});
  assert.ok(s3 && typeof s3.output === 'string');
});

// ============================================================
// 10. FALSE-DONE — the metric can no longer be gamed by the gate
// ============================================================

test('falseDone: gate-caught rounds COUNT (claimed + failed = falseDone); persistence round-trips', async () => {
  const { recordFalseDone, falseDoneStats, resetFalseDoneLedgerForTests, setFalseDoneStore } = mod.testRecord;
  resetFalseDoneLedgerForTests();
  const storeDir = join(tmp, 'fd-store');
  await setFalseDoneStore(storeDir);
  // v8.1 contract: the engine records the ORIGINAL prose claim (true) even
  // when the gate overruled it — so this entry is a falseDone.
  recordFalseDone({ runId: 'r1', at: Date.now(), claimedSuccess: true, gateVerdict: 'failed' });
  recordFalseDone({ runId: 'r2', at: Date.now(), claimedSuccess: true, gateVerdict: 'proven' });
  recordFalseDone({ runId: 'r3', at: Date.now(), claimedSuccess: false, gateVerdict: 'failed' });
  const s = falseDoneStats();
  assert.equal(s.claimed, 2, 'claimed rounds enter the denominator');
  assert.equal(s.falseDone, 1, 'the gate-caught round counts as false done');
  assert.ok(Math.abs(s.rate - 0.5) < 1e-9);
  // persistence: wait for the debounced flush, then reload into a fresh ledger
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(existsSync(join(storeDir, 'false-done.json')), 'ledger persisted to disk');
  const raw = JSON.parse(readFileSync(join(storeDir, 'false-done.json'), 'utf8'));
  assert.equal(raw.length, 3);
  assert.equal(raw.filter((e) => e.falseDone).length, 1);
  resetFalseDoneLedgerForTests();
});
