#!/usr/bin/env node
// ============================================================
// SADEEM — Microsoft Store packaging PREFLIGHT (fail fast, no fake readiness).
//
// This script deliberately refuses to let `npm run dist:store` produce a
// package until the things that CANNOT be synthesized in this repo exist:
//   1. a Windows build host (electron-builder AppX needs Windows 10+),
//   2. real Identity Name / Publisher values reserved in Partner Center,
//   3. the sadeem:// OAuth deep link registered (dead link otherwise),
//   4. a signing credential that electron-builder v26 can ACTUALLY consume.
//
// It never invents a certificate. A green PASS only means the local
// config/host/assets are consistent — it does NOT prove the APPX is signed
// or Store-ready. Verify the signature with signtool after the build.
// ============================================================
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function fail(msg) {
  console.error(`\n[store-preflight] BLOCKED: ${msg}\n`);
  process.exit(1);
}
function note(msg) {
  console.log(`[store-preflight]   - ${msg}`);
}

console.log('[store-preflight] Checking Microsoft Store packaging prerequisites...\n');

// ---------------------------------------------------------------- 1. HOST
if (process.platform !== 'win32') {
  problems.push(
    `AppX packaging requires a Windows 10+ build host (detected: ${process.platform}). ` +
    `electron-builder v26 calls makeappx.exe/makepri.exe from its winCodeSign tools. ` +
    `Run this on Windows, or in a Windows CI agent / Windows VM.`
  );
}

// ------------------------------------------------ 2. PARTNER CENTER IDENTITY
const ymlPath = join(ROOT, 'electron-builder.yml');
const ymlRaw = readFileSync(ymlPath, 'utf8');
const manifest = join(ROOT, 'build', 'store', 'appx', 'appxmanifest.xml');
// Only the ACTIVE values count: the word REPLACE_WITH_* also appears in the
// explanatory YAML comments, so a whole-file search would never clear.
const appxBlock = ymlRaw.slice(ymlRaw.indexOf('\nappx:'));
const identityMatch = /^\s{2}identityName:\s*(\S+)/m.exec(appxBlock);
const publisherMatch = /^\s{2}publisher:\s*(\S+)/m.exec(appxBlock);
if (!identityMatch || !publisherMatch) {
  problems.push('electron-builder.yml has no valid `appx.identityName` / `appx.publisher` values.');
} else {
  const identity = identityMatch[1];
  const publisher = publisherMatch[1];
  if (identity.includes('REPLACE_WITH_') || publisher.includes('REPLACE_WITH_')) {
    problems.push(
      'electron-builder.yml still has REPLACE_WITH_* placeholders under `appx:`. ' +
      'Reserve the app in Microsoft Partner Center, then set:\n' +
      '      appx.identityName = the exact reserved app identity (3-50 chars)\n' +
      '      appx.publisher    = CN=<exact Publisher CN from Partner Center>\n' +
      '    They must also match the signing certificate Subject CN. See build/store/README.md.'
    );
  }
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity)) {
    problems.push(`appx.identityName "${identity}" is invalid (needs 3-50 chars: letters, digits, dots, dashes).`);
  }
  if (!publisher.startsWith('CN=') || publisher.length <= 3) {
    problems.push(`appx.publisher "${publisher}" must be the Partner Center CN written as CN=...`);
  }
}

// ------------------------------- 2b. OAUTH DEEP LINK (APPX <Extensions>)
// electron/main.ts claims `sadeem` and website/lib/site.ts redirects to
// sadeem://auth/callback. electron-builder injects top-level `protocols`
// into the APPX manifest via the ${extensions} macro. If either side is
// missing, the Store build has a dead auth callback.
const ymlLines = ymlRaw.split(/\r?\n/);
const protoStart = ymlLines.findIndex((line) => /^protocols:\s*$/.test(line));
const protoLines = [];
if (protoStart >= 0) {
  for (let i = protoStart + 1; i < ymlLines.length; i++) {
    if (/^\S/.test(ymlLines[i])) break; // next top-level key
    protoLines.push(ymlLines[i]);
  }
}
const protoText = protoLines.join('\n');
if (protoStart < 0 || !/\bsadeem\b/.test(protoText)) {
  problems.push(
    'electron-builder.yml has no `protocols` entry for `sadeem`. The Store APPX would ' +
    'ship a DEAD sadeem://auth/callback deep link. Add (top level):\n' +
    '      protocols:\n' +
    '        - schemes: [sadeem]\n' +
    '          name: SADEEM authentication callback'
  );
}
if (/\bsurnia\b/.test(protoText)) {
  problems.push(
    '`surnia://` is an INTERNAL bundle scheme and must NOT appear under `protocols` — ' +
    'do not register it with the OS.'
  );
}
const manifestRaw = existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
if (manifestRaw && !manifestRaw.includes('${extensions}')) {
  problems.push(
    'build/store/appx/appxmanifest.xml is missing the ${extensions} macro, so the ' +
    'sadeem:// protocol registration would not be injected into the APPX.'
  );
}

// ------------------------------------------------------ 3. SIGNING CREDENTIAL
// electron-builder v26 natively consumes ONLY WIN_CSC_LINK / CSC_LINK (.pfx,
// .p12, https URL or base64). It has NO native Azure/Trusted-Signing support
// and does not read SIGNING_CERTIFICATE_BASE64 or STORE_CERT_SUBJECT. Those
// need a custom `sign` hook or an external signtool/jsign step.
const NATIVE_CERT_KEYS = ['WIN_CSC_LINK', 'CSC_LINK'];
const HOOK_ONLY_KEYS = [
  'SIGNING_CERTIFICATE_BASE64', // read by scripts/sign-windows.cjs, NOT by electron-builder
  'STORE_CERT_SUBJECT',         // EV token selection needs certificateSubjectName in config
  'AZURE_CLIENT_ID',            // v26 has no native Azure signer
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
];
const present = (k) => !!(process.env[k] && process.env[k].trim());
const nativeSupplied = NATIVE_CERT_KEYS.filter(present);
const hookOnlySupplied = HOOK_ONLY_KEYS.filter(present);

if (nativeSupplied.length === 0 && hookOnlySupplied.length === 0) {
  problems.push(
    'No code-signing credential found in the environment. Microsoft Store REQUIRES a ' +
    'signed APPX whose Publisher matches the certificate Subject CN.\n' +
    '    Set (PowerShell):\n' +
    '      $env:WIN_CSC_LINK          = "C:\\secrets\\sadeem.pfx"\n' +
    '      $env:WIN_CSC_KEY_PASSWORD  = "the-pfx-password"\n' +
    '    Reuse the existing commented signing block in electron-builder.yml — do NOT commit secrets.'
  );
} else if (nativeSupplied.length === 0) {
  // FALSE-PASS FIX: hook-only variables alone must NOT produce a green PASS.
  problems.push(
    'Credentials present but NOT consumable by electron-builder v26: ' +
    hookOnlySupplied.join(', ') + '. SIGNING REQUIRES A CUSTOM HOOK / CERTIFICATE. ' +
    'v26 has no native Azure Artifact Signing / store-subject support and does not read ' +
    'SIGNING_CERTIFICATE_BASE64. Either set WIN_CSC_LINK (+ WIN_CSC_KEY_PASSWORD) with a ' +
    'real .pfx/.p12 whose Subject CN equals appx.publisher, or wire a custom `sign` hook / ' +
    'sign the APPX externally with signtool or jsign. This preflight will not report a ' +
    'green PASS for a package that would be built unsigned.'
  );
} else {
  note(`electron-builder-native certificate detected via: ${nativeSupplied.join(', ')}`);
  const hasPassword = !!(process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD);
  if (!hasPassword) {
    note('WARNING: WIN_CSC_KEY_PASSWORD is not set — signing may still prompt or fail.');
  }
  if (hookOnlySupplied.length) {
    note(`Additionally set but IGNORED by v26 (need a custom sign hook): ${hookOnlySupplied.join(', ')}`);
  }
  note('PASS only checks config/host/assets — it does NOT prove the APPX is signed. Verify with: signtool verify /pa <appx>');
}

// ---------------------------------------------------------- 4. LOCAL ASSETS
if (!existsSync(manifest)) problems.push(`missing Store manifest template: ${manifest}`);
const logos = join(ROOT, 'build', 'store', 'logos');
if (!existsSync(logos)) problems.push(`missing Store logo assets: ${logos}`);
if (!existsSync(join(ROOT, 'node_modules', 'electron-builder'))) {
  problems.push('electron-builder is not installed — run "npm ci" first.');
}

// ---------------------------------------------------------------- RESULT
if (problems.length) {
  console.error(`[store-preflight] ${problems.length} unresolved prerequisite(s):`);
  problems.forEach((p, i) => console.error(`\n  ${i + 1}. ${p}`));
  console.error(
    '\n[store-preflight] No package was produced. Nothing here is "ready to submit".\n' +
    '  Fix the items above on a properly configured Windows machine, then re-run:\n' +
    '      npm run dist:store\n' +
    '  Full checklist (AR/EN): build/store/README.md\n'
  );
  process.exit(1);
}

console.log('\n[store-preflight] PASS — local config / host / asset prerequisites satisfied.');
console.log('[store-preflight] IMPORTANT: PASS does NOT mean the APPX is signed or Store-ready.');
console.log('[store-preflight] After the build verify: signtool verify /pa <appx>, confirm the');
console.log('[store-preflight] manifest Identity/Publisher match Partner Center, and that the');
console.log('[store-preflight] sadeem:// protocol extension is present.');
console.log('[store-preflight] Next: npm run full && npm run dist:store:assets && electron-builder --win appx');
