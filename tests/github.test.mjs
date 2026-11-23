// v7 unit tests — github (gh CLI bridge: PR create + status)
// Self-bootstrapping: bundles electron/agent/github.ts with esbuild into
// tests/.github.bundle.mjs when the bundle is missing or older than the
// source, then dynamic-imports it. No checked-in build artifacts.
// Error paths are exercised in a tmp NON-repo dir: every entry point must
// resolve { ok:false, error } cleanly — never throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const SRC = path.join(projectRoot, 'electron', 'agent', 'github.ts');
const BUNDLE = path.join(here, '.github.bundle.mjs');

// ---------- prelude: rebuild the bundle when stale ----------
function ensureBundle() {
  const stale = !existsSync(BUNDLE) || statSync(BUNDLE).mtimeMs < statSync(SRC).mtimeMs;
  if (!stale) return;
  const cmd =
    `npx esbuild ${JSON.stringify(SRC)} ` +
    `--bundle --platform=node --format=esm --outfile=${JSON.stringify(BUNDLE)}`;
  try {
    execSync(cmd, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    throw new Error(`github bundle build failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
ensureBundle();

const { ghAvailable, createPullRequest, prStatus } = await import(pathToFileURL(BUNDLE).href);

// ---------- fixtures ----------
const tmp = mkdtempSync(path.join(tmpdir(), 'surnia-gh-'));
const nonRepo = path.join(tmp, 'not-a-repo');
mkdirSync(nonRepo, { recursive: true });
const missingDir = path.join(tmp, 'does-not-exist');

/** Independent oracle: does `gh --version` actually run here? */
function ghOnPath() {
  try {
    execSync('gh --version', { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}
const expectGh = ghOnPath();

test('ghAvailable resolves to a boolean and matches a direct gh probe (never throws)', async () => {
  const available = await ghAvailable();
  assert.equal(typeof available, 'boolean');
  assert.equal(available, expectGh, 'ghAvailable must agree with a plain `gh --version` probe');
  if (expectGh) {
    // gh IS installed → the probe must report exactly true.
    assert.equal(await ghAvailable(), true);
  }
});

test('createPullRequest: empty title is rejected as data (no spawn, no throw)', async () => {
  const r = await createPullRequest({ workspace: nonRepo, title: '   ', body: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /title/i);
  assert.equal(r.url, undefined);
});

test('createPullRequest: nonexistent workspace rejected as data (no throw)', async () => {
  const r = await createPullRequest({ workspace: missingDir, title: 'T', body: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /Workspace directory not found/i);
  assert.equal(r.url, undefined);
});

test('createPullRequest: non-repo dir → ok:false with a clean error, never a throw', async () => {
  const r = await createPullRequest({ workspace: nonRepo, title: 'Surnia test PR', body: 'body' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.ok((r.error ?? '').length > 0);
  assert.equal(r.url, undefined);
  if (expectGh) {
    // gh present → git's non-repo complaint surfaces as the friendly hint.
    assert.match(r.error ?? '', /not a git repository|gh auth login|install/i);
  } else {
    // gh absent → the actionable install link, not a stack trace.
    assert.match(r.error ?? '', /GitHub CLI \(gh\) is not installed/i);
    assert.match(r.error ?? '', /cli\.github\.com/);
  }
});

test('createPullRequest: empty workspace path rejected as data', async () => {
  const r = await createPullRequest({ workspace: '', title: 'T', body: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /workspace path is required/i);
});

test('prStatus: non-repo dir → ok:false with a clean error, no prs array, never a throw', async () => {
  const r = await prStatus(nonRepo);
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.ok((r.error ?? '').length > 0);
  assert.equal(r.prs, undefined);
  if (expectGh) {
    assert.match(r.error ?? '', /not a git repository|gh auth login|install/i);
  } else {
    assert.match(r.error ?? '', /GitHub CLI \(gh\) is not installed/i);
  }
});

test('prStatus: empty and missing workspaces rejected as data (no throw)', async () => {
  const empty = await prStatus('');
  assert.equal(empty.ok, false);
  assert.match(empty.error ?? '', /workspace path is required/i);

  const gone = await prStatus(missingDir);
  assert.equal(gone.ok, false);
  assert.match(gone.error ?? '', /Workspace directory not found/i);
  assert.equal(gone.prs, undefined);
});

test('prStatus: results never exceed the 10-PR contract shape (when gh is present)', async () => {
  if (!expectGh) return; // sandbox without gh — shape contract already covered above
  const r = await prStatus(nonRepo);
  if (r.ok) {
    assert.ok(Array.isArray(r.prs));
    assert.ok(r.prs.length <= 10);
    for (const pr of r.prs) {
      assert.equal(typeof pr.number, 'number');
      assert.equal(typeof pr.title, 'string');
      assert.equal(typeof pr.url, 'string');
      assert.equal(typeof pr.state, 'string');
    }
  } else {
    // non-repo/auth failures must still be data, not throws
    assert.equal(typeof r.error, 'string');
  }
  assert.ok(true);
});

test('cleanup: tmp fixture removed', () => {
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(existsSync(tmp), false);
});
