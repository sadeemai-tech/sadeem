// ============================================================
// SADEEM v11.33 — ACCOUNT SIGN-IN FLOW (website + honest entitlement)
// ============================================================
// Proves the founder's request: "when I sign in, open the website so I can
// sign in there." The PRIMARY action mints a one-use pair code via authService
// and hands the URL to the OS browser (api.openExternal) — the app window is
// never navigated. A signed `lic` key is the only receipt that can back a paid
// plan; a self-asserted `plan=pro` alone always resolves to `free`.
//
// Covers:
//   (a) source wiring: live website base, /auth route, openExternal, offline key
//   (b) runtime pair URL: live domain + /auth#pair=<6>&mode=signin|signup
//   (c) deep-link honesty: plan=pro→free, valid signed lic→pro, bad lic→free+error
//   (d) SSR of AccountAuthCard: primary buttons + pair code + offline fallback
//
// Run: node --test --test-force-exit tests/v1133-account.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Live (non-comment) lines only — historical/copy comments may mention old paths. */
const live = (src) => src.split('\n').filter((l) => {
  const t = l.trim();
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
}).join('\n');
const fwd = (p) => p.replace(/\\/g, '/');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1133-'));
const LIVE = 'https://sadeem-ai.com'; // v11.40 — official domain; preview retired

// ---------- (a) SOURCE WIRING ----------
test('(a1) authService points at the LIVE domain and the /auth route (not /auth.html)', () => {
  const src = live(read('electron/services/authService.ts'));
  assert.match(src, /return 'https:\/\/sadeem-ai\.com'/, 'official domain is the default');
  assert.doesNotMatch(src, /return 'https:\/\/sadeem\.app'/, 'dead sadeem.app domain is gone');
  assert.match(src, /process\.env\.SADEEM_SITE_URL/, 'dev/staging env override kept');
  assert.match(src, /\$\{websiteBaseUrl\(\)\}\/auth#pair=\$\{pair\}&mode=\$\{mode\}/, 'URL uses /auth#pair=…&mode=…');
  assert.doesNotMatch(src, /\/auth\.html/, 'the 404 /auth.html path is never emitted');
});

test('(a2) account screens mint a pair code and open the EXTERNAL browser', () => {
  for (const rel of ['src/components/settings/AccountAuthCard.tsx', 'src/components/AuthScreen.tsx']) {
    const src = read(rel);
    assert.match(src, /api\.authWebBegin\(/, `${rel}: pair code minted via authService`);
    assert.match(src, /api\.openExternal\(res\.url\)/, `${rel}: URL handed to the OS browser`);
    assert.doesNotMatch(src, /api\.authWebOpen\(/, `${rel}: no in-app navigation helper`);
    assert.match(src, /'signin'/, `${rel}: sign-in mode wired`);
    assert.match(src, /'signup'/, `${rel}: sign-up mode wired`);
    assert.match(src, /Use a license key offline|استخدام مفتاح رخصة دون اتصال/, `${rel}: offline key fallback kept`);
  }
  const card = live(read('src/components/settings/AccountAuthCard.tsx'));
  assert.match(card, /Sign in on the website/, 'primary sign-in button is the website');
  assert.match(card, /Signed in as \$\{account\.email\} · \$\{statusLabel\}/, 'honest signed-in status');
  assert.doesNotMatch(card, /Free trial|Pro trial|\btrial\b/i, 'no fake trial claim');

  const main = read('electron/main.ts');
  assert.match(main, /lic: q\.get\('lic'\) \?\? undefined/, 'main.ts parses the signed lic parameter');
  const svc = read('electron/services/authService.ts');
  assert.match(svc, /validateKey\(lic\)/, 'lic is verified via licenseService');
  assert.match(svc, /activateLicense\(lic\)/, 'verified key is stored via licenseService');
  assert.match(svc, /const plan = entitledPlan \?\? honestPlan\(requestedPlan\)/, 'plan=pro alone never promotes');
});

// ---------- isolated main-process services ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {}, showItemInFolder() {}, openPath: async () => '' },
    Notification: { isSupported: () => false },
  };`,
);

const entry = join(tmp, 'entry.ts');
writeFileSync(
  entry,
  [
    `export * as auth from '${fwd(join(ROOT, 'electron/services/authService.ts'))}';`,
    `export * as license from '${fwd(join(ROOT, 'electron/services/licenseService.ts'))}';`,
    `export * as store from '${fwd(join(ROOT, 'electron/services/storeService.ts'))}';`,
  ].join('\n'),
  'utf8',
);
const svcOut = join(tmp, 'svc.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
  `--outfile=${svcOut}`, '--external:electron'], { cwd: ROOT, stdio: 'pipe' });
const { auth, license, store } = require(svcOut);

function reset() {
  for (const f of ['accounts.json', 'session.json', 'guest.json', 'license.json', 'settings.json', 'license.secret']) {
    rmSync(join(userDataDir, f), { force: true });
  }
  store.invalidateSettingsCache();
}
after(() => {
  delete process.env.SADEEM_SITE_URL;
  for (const f of cardBundles) rmSync(f, { force: true });
  rmSync(tmp, { recursive: true, force: true });
});

// ---------- (b) PAIR URL ----------
test('(b) sign-in URL: live domain + /auth#pair=<6>&mode=signin', () => {
  reset();
  delete process.env.SADEEM_SITE_URL;
  const begin = auth.beginWebAuth('signin');
  assert.match(begin.pair, /^[A-Z0-9]{6}$/);
  assert.equal(
    begin.url,
    `${LIVE}/auth#pair=${begin.pair}&mode=signin`,
    'exact founder URL shape on the live deployment',
  );
  assert.ok(!begin.url.includes('/auth.html'), 'never the 404 path');

  const up = auth.beginWebAuth('signup');
  assert.equal(up.url, `${LIVE}/auth#pair=${up.pair}&mode=signup`);

  // env override still works for dev/staging.
  process.env.SADEEM_SITE_URL = 'https://staging.example.test/';
  assert.equal(auth.websiteBaseUrl(), 'https://staging.example.test');
  delete process.env.SADEEM_SITE_URL;
});

// ---------- (c) DEEP-LINK ENTITLEMENT HONESTY ----------
test('(c1) plan=pro with NO signed key -> free (a claim is not a receipt)', () => {
  reset();
  const b = auth.beginWebAuth('signin');
  const r = auth.completeWebAuth({ pair: b.pair, email: 'free@example.test', name: 'Free', plan: 'pro' });
  assert.equal(r.ok, true);
  assert.equal(r.account.plan, 'free', 'self-asserted pro is clamped');
  assert.equal(r.licenseError, undefined);
});

test('(c2) plan=free WITH a valid signed lic -> pro (stored via licenseService)', () => {
  reset();
  const key = license.buildKeyV2('pro', 30);
  const b = auth.beginWebAuth('signin');
  const r = auth.completeWebAuth({ pair: b.pair, email: 'paid@example.test', name: 'Paid', plan: 'free', lic: key });
  assert.equal(r.ok, true);
  assert.equal(r.account.plan, 'pro', 'the verified signed key backs the plan');
  assert.equal(store.getLicense().plan, 'pro', 'the key was persisted on this device');
  assert.equal(r.licenseError, undefined);
});

test('(c3) invalid lic -> free with an honest error (no silent Pro)', () => {
  reset();
  const tampered = license.buildKeyV2('pro', 30);
  const bad = tampered.slice(0, -1) + (tampered.endsWith('Z') ? 'Y' : 'Z');
  const b = auth.beginWebAuth('signin');
  const r = auth.completeWebAuth({ pair: b.pair, email: 'bad@example.test', name: 'Bad', plan: 'pro', lic: bad });
  assert.equal(r.ok, true, 'the pairing itself still completes');
  assert.equal(r.account.plan, 'free', 'a broken key grants nothing');
  assert.match(r.licenseError, /signature|Invalid license key/i, 'honest reason is surfaced');
  assert.equal(store.getLicense().plan, 'free', 'nothing was stored');
});

// ---------- (d) SSR of AccountAuthCard ----------
let React, renderToStaticMarkup;
const cardBundles = [];
function renderCard(seed = {}) {
  const id = Math.random().toString(36).slice(2);
  const entryFile = join(tmp, `card-entry-${id}.ts`);
  // Output under ROOT/tests so externalized react/zustand/lucide resolve.
  const out = join(ROOT, 'tests', `.v1133-card-${id}.cjs`);
  cardBundles.push(out);
  writeFileSync(
    entryFile,
    `export { AccountAuthCard as Component } from '${fwd(join(ROOT, 'src/components/settings/AccountAuthCard'))}';\n` +
      `export { useStore } from '${fwd(join(ROOT, 'src/store'))}';`,
    'utf8',
  );
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entryFile, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--loader:.css=empty', '--loader:.svg=empty', '--loader:.png=empty',
    '--external:react', '--external:react-dom', '--external:react/jsx-runtime',
    '--external:zustand', '--external:lucide-react', '--external:electron'],
    { cwd: ROOT, stdio: 'pipe' });
  const mod = require(out);
  const prev = mod.useStore.getState();
  const seeded = {
    account: null,
    webAuthPending: null,
    license: { plan: 'free', mode: 'local' },
    settings: { ...(prev.settings ?? {}), language: 'en' },
    ...seed,
  };
  mod.useStore.setState(seeded);
  // zustand v5 uses getInitialState() as the SSR snapshot — mutate it too so
  // the seeded account/pair state actually reaches renderToStaticMarkup.
  Object.assign(mod.useStore.getInitialState(), seeded);
  return renderToStaticMarkup(React.createElement(mod.Component));
}

try {
  React = require('react');
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
} catch {
  /* handled by tests below with a clear failure */
}

test('(d1) SSR renders the website-primary sign-in flow + offline fallback', () => {
  assert.ok(React && renderToStaticMarkup, 'react + react-dom/server must be installed');
  const html = renderCard();
  assert.match(html, /Sign in on the website/, 'primary sign-in opens the website');
  assert.match(html, /Create account/, 'second action creates an account on the website');
  assert.match(html, /Use a license key offline/, 'offline key fallback is visible');
  assert.match(html, /SADEEM website/, 'explains the browser handoff');
  assert.doesNotMatch(html, /auth\.html/, 'no dead route in rendered markup');
});

test('(d2) SSR shows the one-use pair code while waiting for the deep link', () => {
  assert.ok(React && renderToStaticMarkup, 'react + react-dom/server must be installed');
  const pair = 'ABC234';
  const html = renderCard({
    webAuthPending: { pair, url: `${LIVE}/auth#pair=${pair}&mode=signin` },
  });
  assert.match(html, /ABC-234/, 'the 3·2 pair code is displayed for the browser');
  assert.match(html, /15 minutes|15 دقيقة/, 'TTL is stated honestly');
  assert.match(html, /Reopen the website/, 'reopen uses the same external URL');
});

test('(d3) SSR of signed-in state shows the honest status, no fake Pro/trial', () => {
  assert.ok(React && renderToStaticMarkup, 'react + react-dom/server must be installed');
  const html = renderCard({
    account: { id: 'acct_v1133_00001', email: 'member@example.test', name: 'Member', plan: 'free', createdAt: 1 },
    license: { plan: 'free', mode: 'local' },
  });
  assert.match(html, /Signed in as member@example\.test · Free season/, 'honest signed-in status');
  assert.doesNotMatch(html, /Pro trial|Free trial|\btrial\b/i, 'no fake trial');

  const owner = renderCard({
    account: { id: 'acct_v1133_00002', email: 'owner@example.test', name: 'Owner', plan: 'pro', createdAt: 1 },
    license: { plan: 'pro', mode: 'local', activatedAt: 1 },
  });
  assert.match(owner, /Signed in as owner@example\.test · Owner License/, 'a real local license shows Owner License');
});
