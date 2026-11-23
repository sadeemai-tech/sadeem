#!/usr/bin/env node
// ============================================================
// SADEEM — upload release artifacts to Vercel Blob and VERIFY them.
//
//   node scripts/upload-blobs.mjs
//
// Reads the public URLs + SHA-256 values from website/lib/site.ts (single
// source of truth), refreshes the short-lived Vercel OIDC token if it is
// expired, uploads both artifacts to the SAME pathnames with --access public,
// then GETs them back and hashes the actually-served bytes. Exits non-zero on
// any mismatch — so a failed upload can never be mistaken for a good one.
//
// No secrets are printed. Only Node built-ins; no new dependencies.
// ============================================================
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEBSITE = path.join(ROOT, 'website');
const SITE_TS = path.join(WEBSITE, 'lib', 'site.ts');
const RELEASE = path.join(ROOT, 'release');
const ENV_FILE = path.join(WEBSITE, '.env.vercel.local');
const ENV_LOCAL = path.join(WEBSITE, '.env.local');
const TMP_ENV = path.join(WEBSITE, '.env.blob-upload.tmp');
// Node >=20 refuses to spawn *.cmd with shell:false (EINVAL), so drive npm's
// npx-cli.js through node.exe directly when available; fall back to shell.
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const HAS_NPX_CLI = fs.existsSync(NPX_CLI);

const pick = (re, text, label) => {
  const m = text.match(re);
  if (!m) throw new Error(`upload-blobs: cannot find ${label} in website/lib/site.ts`);
  return m[1];
};

function readTargets() {
  const src = fs.readFileSync(SITE_TS, 'utf8');
  const rows = [
    { url: pick(/exe:\s*'([^']+)'/, src, 'exe URL'), sha256: pick(/exeSha256:\s*'([^']+)'/, src, 'exe SHA-256') },
    { url: pick(/zip:\s*'([^']+)'/, src, 'zip URL'), sha256: pick(/zipSha256:\s*'([^']+)'/, src, 'zip SHA-256') },
  ];
  return rows.map((t) => {
    const u = new URL(t.url);
    const pathname = u.pathname.replace(/^\//, '');
    const name = path.posix.basename(pathname);
    return { ...t, sha256: t.sha256.toLowerCase(), pathname, name, file: path.join(RELEASE, name) };
  });
}

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function tokenExp(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8')).exp || 0;
  } catch {
    return 0;
  }
}

// Preserve existing line endings: match up to (but not including) CR/LF.
function upsertEnvVar(file, name, value) {
  if (!fs.existsSync(file)) return;
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^${name}=[^\\r\\n]*`, 'm');
  const line = `${name}="${value}"`;
  fs.writeFileSync(file, re.test(src) ? src.replace(re, line) : `${src.trimEnd()}\n${line}\n`, 'utf8');
}

function run(args, cwd) {
  const opts = { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
  if (HAS_NPX_CLI) return spawnSync(process.execPath, [NPX_CLI, ...args], opts);
  return spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args,
    { ...opts, shell: process.platform === 'win32' },
  );
}

const redact = (text, token) => (token ? String(text).split(token).join('[REDACTED]') : String(text));

function refreshOidc() {
  console.log('[upload-blobs] OIDC token expired/missing — refreshing via `vercel env pull` ...');
  try { fs.unlinkSync(TMP_ENV); } catch { /* ignore */ }
  const r = run(
    ['--yes', 'vercel@latest', 'env', 'pull', path.basename(TMP_ENV), '--environment=development', '--yes'],
    WEBSITE,
  );
  if (r.status !== 0) {
    throw new Error(`vercel env pull failed (run "npx vercel login" first): ${redact(r.stderr || r.stdout || r.error?.message || '', '')}`);
  }
  const token = readEnv(TMP_ENV).VERCEL_OIDC_TOKEN;
  if (!token || tokenExp(token) <= Math.floor(Date.now() / 1000)) {
    throw new Error('vercel env pull did not return a valid VERCEL_OIDC_TOKEN');
  }
  upsertEnvVar(ENV_FILE, 'VERCEL_OIDC_TOKEN', token);
  upsertEnvVar(ENV_LOCAL, 'VERCEL_OIDC_TOKEN', token);
  try { fs.unlinkSync(TMP_ENV); } catch { /* ignore */ }
  console.log('[upload-blobs] fresh OIDC token stored in website/.env*.local');
  return token;
}

function upload(target, token, store) {
  const r = run(
    [
      '--yes', 'vercel@latest', 'blob', 'put', target.file,
      '--pathname', target.pathname,
      '--access', 'public',
      '--force',
      '--oidc-token', token,
      '--store', store,
    ],
    WEBSITE,
  );
  if (r.status !== 0) {
    throw new Error(`upload failed for ${target.name}: ${redact(r.stderr || r.stdout || r.error?.message || '', token).slice(-600)}`);
  }
  console.log(`[upload-blobs] uploaded ${target.pathname}`);
}

async function verify(target) {
  const url = `${target.url}${target.url.includes('?') ? '&' : '?'}verify=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  return { got, bytes: bytes.length, ok: got === target.sha256 };
}

async function main() {
  const targets = readTargets();
  const env = readEnv(ENV_FILE);
  const store = process.env.BLOB_STORE_ID || env.BLOB_STORE_ID;
  if (!store) throw new Error('BLOB_STORE_ID not found in website/.env.vercel.local');

  let token = process.env.VERCEL_OIDC_TOKEN || env.VERCEL_OIDC_TOKEN;
  if (!token || tokenExp(token) <= Math.floor(Date.now() / 1000) + 60) {
    token = refreshOidc();
  } else {
    console.log('[upload-blobs] using valid OIDC token from website/.env.vercel.local');
  }

  for (const t of targets) {
    if (!fs.existsSync(t.file)) throw new Error(`missing artifact: ${t.file}`);
    upload(t, token, store);
  }

  let allOk = true;
  for (const t of targets) {
    const v = await verify(t);
    allOk = allOk && v.ok;
    console.log(
      `[upload-blobs] ${t.name}: bytes=${v.bytes} sha256=${v.got} expected=${t.sha256} MATCH=${v.ok}`,
    );
  }

  if (!allOk) {
    console.error('[upload-blobs] VERIFICATION FAILED — hosted bytes do NOT match the advertised hashes.');
    process.exitCode = 1;
  } else {
    console.log('[upload-blobs] ALL VERIFIED — hosted bytes match website/lib/site.ts.');
  }
}

main().catch((e) => {
  console.error(`[upload-blobs] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
