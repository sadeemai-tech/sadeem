// v11.31 — UI SCREENS AUDIT GUARD (source-level invariants, diagnosis only).
//
// Owns the seven auth/onboarding/welcome/plans/home/whatsnew surfaces. These
// checks do NOT edit application source; they read it and report the truth.
//  (a) AuthScreen has NO monthly-subscription UI and NO dead paid-plan picker
//  (b) AuthScreen still fulfils the auth-gate contract + is accessible
//  (c) Onboarding shows ONE language at a time and every control is wired
//  (d) Welcome entry points all call existing store actions
//  (e) Home entry points all call existing store actions, no fake data
//  (f) Plans + billingShared are free-season only (no checkout, no /mo)
//  (g) What's New is once-per-version, bilingual, honest (no monthly plan)
//
// Run: node --test --test-force-exit tests/v1131-ui-screens.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const AUTH = read('src/components/AuthScreen.tsx');
const ONBOARD = read('src/components/Onboarding.tsx');
const WELCOME = read('src/components/Welcome.tsx');
const HOME = read('src/components/Home.tsx');
const PLANS = read('src/components/PlansScreen.tsx');
const SHARED = read('src/components/billingShared.tsx');
const WHATSNEW = read('src/components/WhatsNew.tsx');

/** Regex hits on LIVE (non-comment) lines only — comments may describe the
 *  removed monthly UI and must not trip the guards. */
function live(src, re) {
  return src.split('\n').filter((line) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    return re.test(line);
  });
}
function noLive(src, re, msg) {
  const hits = live(src, re);
  assert.equal(hits.length, 0, `${msg}\n${hits.join('\n')}`);
}

// ---------------------------------------------------------------------------
test('(a) AuthScreen: no monthly plan, no paid-tier picker, no fake trial', () => {
  // Explicitly removed tokens — none may survive in live code.
  noLive(AUTH, /\bPLAN_ORDER\b|\bplans\.per\.mo\b|\bpriceUsd\b/, 'no plan order / /mo price / USD price');
  noLive(AUTH, /api\.billingGet\b|\btrialDaysLeft\b|\bpick\b/, 'no billing picker state, no trial clock');
  noLive(
    AUTH,
    /auth\.welcome\.trial|auth\.welcome\.team|auth\.plan\.(?:pro|team|free)\.sub|14-day Pro trial|Pro trial started|Seats & central billing|no card needed/i,
    'no trial/team/seats copy',
  );
  noLive(AUTH, /\/(?:mo|user\/mo)\b|['"]\$\d/, 'no per-month price string anywhere in live code');

  // The honest free-season copy is present and reused from the shared module.
  assert.match(AUTH, /from '\.\/billingShared'/, 'imports billingShared');
  assert.match(AUTH, /FreeSeasonBadge/, 'renders the free-season badge');
  assert.match(AUTH, /PlanBadge/, 'account chip uses the always-free plan badge');
  assert.match(AUTH, /t\('billing\.freeSeason\.statement'/, 'uses the shared free-season statement');
  assert.match(AUTH, /There is no monthly plan/, 'states there is no monthly plan');
  assert.match(AUTH, /t\('auth\.welcome\.free'/, 'welcome panel uses the honest free title');
  assert.match(AUTH, /SeasonSeal/, 'polished season-dial motif present');
});

test('(a2) AuthScreen sign-up always registers a free account', () => {
  const m = /api\.authRegister\([\s\S]*?authLogin/.exec(AUTH);
  assert.ok(m, 'authRegister call exists');
  assert.match(m[0], /password, 'free'\)/, 'explicit free plan — no self-asserted pro/team');
  assert.doesNotMatch(m[0], /\bpick\b/, 'no user-selected plan is forwardable');
});

// ---------------------------------------------------------------------------
test('(b) AuthScreen keeps the gate contract, validation and accessibility', () => {
  assert.match(AUTH, /setAccount\((?:res\.account|acc|account)/, 'gate releases via setAccount');
  assert.match(AUTH, /localOnly: true/, 'local-only escape hatch persists');
  assert.match(AUTH, /updateSettings/, 'escape hatch writes settings');
  assert.match(AUTH, /role="tablist"/, 'tabs are a tablist');
  assert.match(AUTH, /aria-selected=\{tab === v\}/, 'active tab is announced');
  assert.match(AUTH, /role="alert"/, 'errors are announced');
  assert.match(AUTH, /api\.authStrength\(password\)/, 'password strength uses the real API');
  assert.match(AUTH, /EMAIL_RE\.test/, 'email is validated before submit');
  assert.match(AUTH, /t\('auth\.deviceNote'/, 'local storage is disclosed');
});

// ---------------------------------------------------------------------------
test('(c) Onboarding: one language at a time, no stacked EN+AR brand lines', () => {
  assert.match(ONBOARD, /const lang = useStore\(\(s\) => s\.settings\.language\)/, 'reads the active language');
  noLive(ONBOARD, /onboard\.caps\.latin|onboard\.caps\.arabic/, 'no two stacked capability paragraphs');
  const tag = ONBOARD.slice(ONBOARD.indexOf('ck.tagline.latin') - 400, ONBOARD.indexOf('ck.tagline.latin') + 400);
  assert.match(tag, /lang === 'ar'/, 'tagline is selected by active language');
  assert.match(tag, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/, 'direction follows the active language');
});

test('(c2) Onboarding: every quick-start and setup control is wired', () => {
  assert.match(ONBOARD, /void openFolderDialog\(\)/, 'open folder');
  assert.match(ONBOARD, /setNewProject\(true\)/, 'new project');
  assert.match(ONBOARD, /setCloneOpen\(true\)/, 'clone repository');
  assert.match(ONBOARD, /apiKey: e\.target\.value, enabled: true/, 'API key enables the provider (no model-less trap)');
  assert.match(ONBOARD, /setLater\(true\)/, 'configure-later escape hatch');
  assert.match(ONBOARD, /applyPreset\(id\)/, 'security preset applies a real preset');
  assert.match(ONBOARD, /e\.key === 'Escape'/, 'Esc exits onboarding');
  assert.match(ONBOARD, /onboardingDone: true/, 'finishing marks onboarding done');
  assert.match(ONBOARD, /t\('onboard\.enter', 'Enter SADEEM'\)/, 'primary Enter button present');
});

// ---------------------------------------------------------------------------
test('(d) Welcome: all entry points call existing store actions', () => {
  for (const needle of [
    /void openFolderDialog\(\)/,
    /setNewProject\(true\)/,
    /setCloneOpen\(true\)/,
    /setModelPicker\(true\)/,
    /setSettings\(true, 'security'\)/,
    /void openWorkspace\(/,
    /setPalette\(true\)/,
    /void signOut\(\)/,
  ]) {
    assert.match(WELCOME, needle, `missing wired action ${needle}`);
  }
  assert.match(WELCOME, /const launchTarget = recentPaths\[0\]/, 'Enter uses the real recent project');
  assert.match(WELCOME, /if \(launchTarget\) void openWorkspace\(launchTarget\)/, 'Enter opens it when present');
  assert.match(WELCOME, /else void openFolderDialog\(\)/, 'Enter falls back to folder dialog');
  noLive(WELCOME, /\b\/mo\b|\bpriceUsd\b|\bcheckout\b/i, 'no monthly subscription UI');
});

// ---------------------------------------------------------------------------
test('(e) Home: real store data + wired navigation, no fake metrics', () => {
  for (const needle of [
    /void newSession\(\)/,
    /void openFolderDialog\(\)/,
    /setRail\('sessions'\)/,
    /setRail\('git'\)/,
    /setRail\('mcp'\)/,
    /setScheduled\(true\)/,
    /setSettings\(true\)/,
    /setModelPicker\(true\)/,
    /void openSession\(s\.id\)/,
    /void openWorkspace\(p\)/,
  ]) {
    assert.match(HOME, needle, `missing wired home action ${needle}`);
  }
  assert.match(HOME, /useStore\(\(s\) => s\.sessions\)/, 'sessions come from the store');
  assert.match(HOME, /chartGeometry\(values\)/, 'chart is engraved from the live token series');
  assert.match(HOME, /falseDoneStats/, 'honesty metric is read from the store');
  assert.doesNotMatch(HOME, /Lorem|dummy|placeholder data|Math\.random\(\) \* 1000/, 'no fabricated values');
});

// ---------------------------------------------------------------------------
test('(f) Plans + billingShared: free-season only, no checkout or /mo', () => {
  for (const src of [PLANS, SHARED]) {
    noLive(src, /\bpriceUsd\b|\/mo\b|\bcheckout\b|\bCheckout\b|\bcoupon\b/i, 'no subscription UI left');
  }
  assert.match(PLANS, /FreeSeasonStatement/, 'plans renders the single honest statement');
  assert.match(PLANS, /<FreeSeasonBadge \/>/, 'free-season badge in the masthead');
  assert.match(PLANS, /api\.licenseActivate\(k\)/, 'license activation still works');
  assert.match(PLANS, /api\.licenseDeactivate\(\)/, 'license deactivation still works');
  assert.match(PLANS, /navigator\.clipboard\s*\.writeText\(APP_SITE_URL\)/, 'share copies the real download link');
  assert.match(PLANS, /setPlans\(false\)/, 'close action works');
  assert.match(SHARED, /export function fmtDate/, 'date formatter kept');
  assert.match(SHARED, /export function fmtInt/, 'integer formatter kept');
  assert.match(SHARED, /void plan;[\s\S]{0,40}return <FreeSeasonBadge \/>/, 'every plan reads as the free season');
});

// ---------------------------------------------------------------------------
test("(g) What's New: once per version, bilingual, honest", () => {
  assert.match(WHATSNEW, /lastSeen !== APP_VERSION/, 'shown only for a fresh version');
  assert.match(WHATSNEW, /updateSettings\(\{ lastSeenVersion: APP_VERSION \}\)/, 'dismiss stamps the version');
  assert.match(WHATSNEW, /ar \? h\.ar : h\.en/, 'one language is chosen from the pair');
  assert.match(WHATSNEW, /no subscription and no monthly plan/, 'BYOK / no monthly plan is stated');
  noLive(WHATSNEW, /\bcheckout\b|\$20|\/mo price/i, 'no paid-plan UI');
});
