import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// ============================================================
// v11.16 signing preparation — SOURCE-LEVEL checks.
//
// The founder wants the SmartScreen warning fixed by signing. A cert
// cannot be bought here, so the honest state is: signing config is
// PRESENT BUT DISABLED and the download page says UNSIGNED.
// These tests lock that state in so nobody accidentally claims we
// are signed before a signed artifact actually exists.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

// `yaml` is preferred; the repo also ships `js-yaml` (used by
// electron-builder), so the test works with either parser.
function parseYaml(source) {
  try {
    return require('yaml').parse(source);
  } catch {
    return require('js-yaml').load(source);
  }
}

const YML_PATH = join(ROOT, 'electron-builder.yml');
const PAGE_PATH = join(ROOT, 'website', 'components', 'download', 'DownloadPage.tsx');
const ROUTE_PATH = join(ROOT, 'website', 'app', 'download', 'page.tsx');
const DOC_PATH = join(ROOT, 'website', 'docs', 'SIGNING.md');

const ymlRaw = readFileSync(YML_PATH, 'utf8');

// ------------------------------------------------------------
// 1. YAML still parses, and the UNSIGNED build config is intact
// ------------------------------------------------------------
test('electron-builder.yml parses and the current unsigned build config is untouched', () => {
  const cfg = parseYaml(ymlRaw);
  assert.equal(cfg.appId, 'app.sadeem.desktop');
  assert.equal(cfg.productName, 'SADEEM');
  assert.equal(cfg.win.icon, 'build/icon.ico');
  assert.ok(Array.isArray(cfg.win.target), 'win.target is a list');
  const targets = cfg.win.target.map((t) => (typeof t === 'string' ? t : t.target));
  assert.ok(targets.includes('nsis'), 'nsis target still builds');
  assert.ok(targets.includes('zip'), 'zip target still builds');
  assert.ok(targets.includes('portable'), 'portable target still builds');
  assert.equal(cfg.nsis.warningsAsErrors, false, 'benign-NSIS-warning workaround retained');
  assert.ok(cfg.portable, 'portable artifact name retained');
});

// Active (uncommented) signing keys would make electron-builder try to
// sign with missing credentials and break `npm run dist:win`.
const SIGNING_KEYS = [
  'sign',
  'certificateFile',
  'certificatePassword',
  'certificateSubjectName',
  'certificateSha1',
  'signingHashAlgorithms',
  'rfc3161TimeStampServer',
  'signAndEditExecutable',
  'cscLink',
];

test('signing config is present-but-disabled: no active signing keys in the parsed YAML', () => {
  const cfg = parseYaml(ymlRaw);
  for (const key of SIGNING_KEYS) {
    assert.equal(cfg.win[key], undefined, `win.${key} must stay commented/disabled`);
    assert.equal(cfg[key], undefined, `top-level ${key} must stay disabled`);
  }
});

test('every signing instruction lives in a YAML comment, so unsigned builds keep working', () => {
  const signingToken = /(certificateFile|certificatePassword|certificateSubjectName|certificateSha1|signingHashAlgorithms|rfc3161TimeStampServer|signAndEditExecutable|WIN_CSC_LINK|WIN_CSC_KEY_PASSWORD)/;
  const activeLines = ymlRaw
    .split(/\r?\n/)
    .filter((line) => signingToken.test(line) && !/^\s*#/.test(line));
  assert.deepEqual(activeLines, [], 'signing tokens appear only on comment lines');
});

test('the commented block is genuinely ready to enable (env vars + sha256 + timestamp + azure)', () => {
  assert.match(ymlRaw, /PRESENT BUT DISABLED/);
  assert.match(ymlRaw, /WIN_CSC_LINK/);
  assert.match(ymlRaw, /WIN_CSC_KEY_PASSWORD/);
  assert.match(ymlRaw, /certificateFile/);
  assert.match(ymlRaw, /signingHashAlgorithms/);
  assert.match(ymlRaw, /sha256/);
  assert.match(ymlRaw, /rfc3161TimeStampServer/);
  assert.match(ymlRaw, /certificateSubjectName/);
  assert.match(ymlRaw, /type: azure/);
  assert.match(ymlRaw, /npm run dist:win/);
});

// ------------------------------------------------------------
// 2. Download page is honest: unsigned + More info flow + planned
// ------------------------------------------------------------
// v11.44 — the founder ordered internal/build-status talk OFF the public
// download page. The honest contract now: NEVER claim a signed artifact,
// and do not dump signing state as decoration. Keep only the truth guard.
test('download page never falsely claims the artifact is signed', () => {
  const page = readFileSync(PAGE_PATH, 'utf8');
  const route = readFileSync(ROUTE_PATH, 'utf8');
  const sources = page + route;
  assert.doesNotMatch(sources, /this build is (now |already )?signed/i);
  assert.doesNotMatch(sources, /digitally signed build available/i);
  assert.doesNotMatch(sources, /code-signed build is planned/i);
});

test('download page keeps signing status out of public prose', () => {
  const page = readFileSync(PAGE_PATH, 'utf8');
  assert.doesNotMatch(page, /UNSIGNED BUILD/i, 'no signing badge as decoration');
});

// ------------------------------------------------------------
// 3. The bilingual documentation exists, cites sources, and is honest
// ------------------------------------------------------------
test('website/docs/SIGNING.md documents exact steps, cost, timeline, sources and honest status', () => {
  assert.ok(existsSync(DOC_PATH), 'SIGNING.md exists');
  const doc = readFileSync(DOC_PATH, 'utf8');
  assert.match(doc, /CURRENT STATUS[\s\S]{0,400}UNSIGNED/);
  assert.match(doc, /الوضع الحالي/, 'Arabic section present');
  assert.match(doc, /WIN_CSC_LINK/);
  assert.match(doc, /WIN_CSC_KEY_PASSWORD/);
  assert.match(doc, /signingHashAlgorithms/);
  assert.match(doc, /June 2023|يونيو 2023/, 'OV/EV change explained');
  assert.match(doc, /1.{0,3}30 business days/, 'validation timeline quoted');
  assert.match(doc, /npm run dist:win/);
  assert.match(doc, /signtool verify/);
  assert.match(doc, /electronjs\.org/);
  assert.match(doc, /learn\.microsoft\.com/);
  assert.match(doc, /electron\.build/);
  assert.match(doc, /azure\.microsoft\.com/);
  assert.match(doc, /did\s+\*\*not\*\*\s+sign|لا نستطيع/, 'states we cannot sign without a cert');
});
