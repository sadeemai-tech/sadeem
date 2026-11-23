// v11.19 — regression for the founder's REAL error:
//   Provider error 402: {"error":{"message":"Insufficient credits. This account
//   never purchased credits...","code":402}}
// The app used to show this raw JSON with no guidance. Now 402 is classified
// as `no_credits`, skipped immediately (no retry), and explained bilingually.
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-402-'));
const mod = join(tmp, 'providers.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, join(ROOT, 'electron/agent/providers.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + mod,
  '--external:electron', '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const p = require(mod);

const RAW = JSON.stringify({ error: {
  message: 'Insufficient credits. This account never purchased credits. Make sure your key is on the correct account or org, and if so, purchase more at https://openrouter.ai/settings/credits',
  code: 402,
  metadata: { limit_source: 'openrouter_credits', remedy_hint: 'Add credits at https://openrouter.ai/settings/credits' },
} });

test('402 is classified as no_credits (not unknown)', () => {
  assert.equal(p.providerErrorKindOf({ status: 402, message: RAW }), 'no_credits');
  assert.equal(p.providerErrorKindOf(new Error('Provider error 402: ' + RAW)), 'no_credits');
});

test('no_credits is fatal — abandon the provider, no pointless retry', () => {
  assert.ok(p.shouldSkipProvider({ status: 402, message: RAW }), '402 skips provider');
});

test('no_credits is non-retryable and produces honest bilingual text', () => {
  const err = { status: 402, message: RAW };
  assert.equal(p.providerErrorKindOf(err), 'no_credits');
  assert.ok(p.shouldSkipProvider(err), 'failover moves on immediately');
  assert.match(RAW, /never purchased credits/, 'this is the founder\'s exact payload');
});

test('source carries clear PROVIDER-AGNOSTIC, single-language guidance', () => {
  const src = require('node:fs').readFileSync(join(ROOT, 'electron/agent/providers.ts'), 'utf8');
  assert.match(src, /status === 402/, '402 branch exists');
  assert.match(src, /this provider account has no balance/, 'no hardcoded provider name');
  assert.doesNotMatch(src, /Insufficient credits \(402\): this OpenRouter account/, 'no OpenRouter-specific text');
  // The renderer translates the classified error into the selected language;
  // providers.ts itself must NEVER mix EN+AR in one message.
  const store = require('node:fs').readFileSync(join(ROOT, 'src/store.ts'), 'utf8');
  assert.match(store, /رصيد غير كافٍ/, 'Arabic translation lives in the renderer');
  assert.match(store, /Insufficient credits: add balance/, 'English translation lives in the renderer');
});
