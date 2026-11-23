#!/usr/bin/env node
// ============================================================
// SADEEM — one-command Authenticode signing for the Windows build.
// Everything is ready; the ONLY missing input is a trusted code-signing
// certificate (OV/EV .pfx + password, or a cert already in the Windows store).
//
// Usage:
//   node scripts/sign-windows.cjs --pfx C:\secrets\sadeem.pfx --password "pw"
//   node scripts/sign-windows.cjs --pfx-base64 "<BASE64>" --password "pw"
//   node scripts/sign-windows.cjs --subject "SADEEM"      # cert in CurrentUser\My
//   (or set WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD env vars — no flags needed)
//
// After signing, re-run: node scripts/publish-release.mjs && update website/lib/site.ts
// hashes && upload artifacts to Vercel Blob && deploy the website.
// ============================================================
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'release', 'SADEEM-Setup-11.12.0.exe');
const KITS = [
  'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
  'C:\\Program Files\\Windows Kits\\10\\bin',
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function findSignTool() {
  if (process.env.SIGNTOOL_PATH && fs.existsSync(process.env.SIGNTOOL_PATH)) return process.env.SIGNTOOL_PATH;
  for (const base of KITS) {
    if (!fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, ver, 'x64', 'signtool.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('signtool.exe not found (install Windows SDK 10).');
}

function main() {
  if (!fs.existsSync(TARGET)) throw new Error(`Missing installer: ${TARGET} (run npm run dist:win first)`);
  const pfx = arg('pfx') || process.env.WIN_CSC_LINK;
  const b64 = arg('pfx-base64') || process.env.SIGNING_CERTIFICATE_BASE64;
  const password = arg('password') || process.env.WIN_CSC_KEY_PASSWORD || '';
  const subject = arg('subject');
  if (!pfx && !b64 && !subject) {
    throw new Error(
      'No certificate supplied. Provide --pfx / --pfx-base64 / --subject ' +
      '(or WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD). A trusted OV/EV code-signing ' +
      'certificate is REQUIRED — a self-signed cert will NOT remove SmartScreen.',
    );
  }

  let certPath = pfx;
  let temp = null;
  if (b64) {
    temp = path.join(os.tmpdir(), `sadeem-sign-${process.pid}.pfx`);
    fs.writeFileSync(temp, Buffer.from(b64, 'base64'));
    certPath = temp;
  }

  const opts = [];
  if (certPath) opts.push('/f', certPath, '/p', password);
  else opts.push('/n', subject);
  opts.push('/fd', 'sha256', '/tr', 'http://timestamp.digicert.com', '/td', 'sha256');

  const signtool = findSignTool();
  console.log(`[sign] ${path.basename(TARGET)} with ${certPath || `store:${subject}`}`);
  try {
    execFileSync(signtool, ['sign', ...opts, TARGET], { stdio: 'inherit' });
    execFileSync(signtool, ['verify', '/pa', TARGET], { stdio: 'inherit' });
  } finally {
    if (temp) fs.rmSync(temp, { force: true });
  }
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(TARGET)).digest('hex');
  console.log(`[sign] DONE — SHA-256 ${hash}`);
  console.log('[sign] NEXT: node scripts/publish-release.mjs → update website/lib/site.ts hashes → re-upload to Blob → redeploy website');
}

try { main(); } catch (e) { console.error(`[sign] FAILED: ${e.message}`); process.exit(1); }
