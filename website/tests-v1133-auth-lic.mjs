#!/usr/bin/env node
/**
 * V1133 WEBSITE → APP LICENSE HANDOFF GUARD.
 *
 * Run from anywhere:   node website/tests-v1133-auth-lic.mjs
 * Exit 0 = all checks pass; exit 1 = at least one FAIL.
 *
 * Closes M5's `v1133-monetization` GAP-2: a license redeemed on the website
 * must reach the desktop app through `sadeem://auth/callback?...&lic=<key>`.
 *
 * This guard is BEHAVIORAL, not just a regex scan: it extracts the real
 * `callbackUrl` and `loadEntitlement` bodies from lib/auth.ts and executes
 * them, then checks app/auth/page.tsx passes the stored key into the link.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // website/
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const authSrc = read('lib/auth.ts');
const pageSrc = read('app/auth/page.tsx');

const results = [];
const pass = (id, title, detail) => results.push({ id, title, status: 'PASS', detail });
const fail = (id, title, detail) => results.push({ id, title, status: 'FAIL', detail });
function check(id, title, fn) {
  try { pass(id, title, fn()); }
  catch (e) { fail(id, title, (e && e.message) || String(e)); }
}

/** Brace-balanced body of the first `function <name>(...)` in `src`. */
function extractBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name}() not found`);
  const brace = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error(`unbalanced body for ${name}()`);
  return src.slice(brace + 1, end);
}

// Faithful stubs for the two pure helpers callbackUrl closes over.
const normEmail = (v) => String(v ?? '').trim().toLowerCase();
const displayName = (n, e) => String(n ?? '').trim() || normEmail(e).split('@')[0] || 'SADEEM user';

// Execute the REAL callbackUrl body from the source (TS types stripped by
// discarding the signature and supplying a plain JS one).
const callbackUrl = new Function(
  'URLSearchParams', 'SITE', 'normEmail', 'displayName',
  `return function callbackUrl(pair, email, name, plan, lic) {${extractBody(authSrc, 'callbackUrl')}};`,
)(URLSearchParams, { deepLinkCallback: 'sadeem://auth/callback' }, normEmail, displayName);

// Execute the REAL loadEntitlement body with a fake localStorage. Its body
// carries a couple of TS-only annotations (`: unknown`, `as Record<...>`),
// so strip just those before evaluating — logic is otherwise untouched.
const store = new Map();
const fakeLocalStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const loadBody = extractBody(authSrc, 'loadEntitlement')
  .replace(/:\s*unknown\b/g, '')
  .replace(/\s+as\s+Record<string,\s*unknown>/g, '');
const loadEntitlement = new Function(
  'localStorage', 'ENTITLEMENT_KEY', 'JSON',
  `return function loadEntitlement() {${loadBody}};`,
)(fakeLocalStorage, 'sadeem-web-entitlement', JSON);

const KEY = 'KDX-PRO-00001-ABCD-EFG';
const parse = (url) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

// ---------------------------------------------------------------------------
check('L1', 'callbackUrl appends &lic=<key> when a license is stored',
  () => {
    const url = callbackUrl('ABC123', 'USER@Example.com', 'Layla', 'pro', KEY);
    assert.ok(url.includes('&lic='), `missing "&lic=" in ${url}`);
    const q = parse(url);
    assert.equal(q.get('lic'), KEY);
    assert.equal(q.get('plan'), 'pro');
    assert.equal(q.get('pair'), 'ABC123');
    assert.equal(q.get('email'), 'user@example.com');
    assert.equal(q.get('name'), 'Layla');
    return `lic=${q.get('lic')}, plan=${q.get('plan')}, pair=${q.get('pair')}`;
  });

check('L2', 'callbackUrl omits lic and keeps plan=free when no license',
  () => {
    const url = callbackUrl('ABC123', 'USER@Example.com', 'Layla', 'free');
    assert.ok(!url.includes('lic='), `unexpected lic in ${url}`);
    const q = parse(url);
    assert.equal(q.get('lic'), null);
    assert.equal(q.get('plan'), 'free');
    return `no lic param; plan=${q.get('plan')}`;
  });

check('L3', 'empty/missing key never produces a lic param (no self-asserted pro)',
  () => {
    for (const lic of [undefined, '', null]) {
      const url = callbackUrl('ABC123', 'a@b.com', 'L', 'pro', lic);
      assert.ok(!url.includes('lic='), `lic leaked for ${String(lic)}: ${url}`);
    }
    return 'undefined / "" / null all omit lic (app clamps plan)';
  });

check('L4', 'the license key is URL-encoded in the query string',
  () => {
    const special = 'KDX+PRO/SPECIAL=1';
    const url = callbackUrl('ABC123', 'a@b.com', 'L', 'pro', special);
    assert.ok(url.includes('%2B') && url.includes('%3D'), `not encoded: ${url}`);
    assert.equal(parse(url).get('lic'), special);
    return 'URLSearchParams encodes + → %2B, = → %3D';
  });

check('L5', 'stored entitlement key (loadEntitlement) flows into callbackUrl',
  () => {
    store.set('sadeem-web-entitlement', JSON.stringify({
      key: KEY, plan: 'pro', expiryDays: 0, redeemedAt: 1,
    }));
    const ent = loadEntitlement();
    assert.ok(ent, 'loadEntitlement returned null for a stored record');
    assert.equal(ent.key, KEY);
    const url = callbackUrl('ABC123', 'a@b.com', 'L', ent.plan, ent.key);
    assert.equal(parse(url).get('lic'), KEY);
    return `loadEntitlement().key=${ent.key} → &lic=${parse(url).get('lic')}`;
  });

// ---------------------------------------------------------------------------
// Wiring in the React page: both link sources must pass the stored key, and
// the plan must still default to 'free' when there is no entitlement.
check('P1', 'both callbackUrl call sites pass the stored entitlement key',
  () => {
    const hits = pageSrc.match(/callbackUrl\([\s\S]*?entitlement\?\.key/g) || [];
    assert.ok(hits.length >= 2,
      `expected >=2 callbackUrl(...entitlement?.key) call sites, found ${hits.length}`);
    return `${hits.length} call sites (submit + done-recap effect)`;
  });

check('P2', 'page keeps plan=free when no entitlement (never self-asserts pro)',
  () => {
    assert.ok(/entitlement\?\.plan\s*\?\?\s*'free'/.test(pageSrc),
      "missing `entitlement?.plan ?? 'free'` fallback");
    return "plan = entitlement?.plan ?? 'free'";
  });

check('P3', 'page loads the entitlement from localStorage via loadEntitlement()',
  () => {
    assert.ok(/loadEntitlement\(\)/.test(pageSrc), 'loadEntitlement() not called in page');
    return 'loadEntitlement() wired into page state';
  });

// ---------------------------------------------------------------------------
const STATUS = { PASS: '+', FAIL: 'X' };
console.log('=== V1133 WEBSITE → APP LICENSE HANDOFF GUARD ===');
console.log(`root: ${ROOT}`);
console.log('');
for (const r of results) {
  console.log(`[${STATUS[r.status]}] ${r.id} ${r.title}`);
  console.log(`      ${r.detail}`);
}
const fails = results.filter((r) => r.status === 'FAIL').length;
const passes = results.filter((r) => r.status === 'PASS').length;
console.log('');
console.log(`RESULT: ${passes} PASS / ${fails} FAIL`);
process.exit(fails ? 1 : 0);
