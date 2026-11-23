// ============================================================
// SADEEM v11.12.1 — MCP + DOWNLOAD TRUTH (source-level audit)
//
// The founder believed Blender MCP "was never added" and asked for
// Hugging Face MCP. Both claims are checked here against the REAL
// source files, not against memory or marketing copy:
//
//   1. Blender MCP is in the catalog with the official uvx command.
//   2. Hugging Face MCP is in the catalog BOTH as the hosted HTTP
//      endpoint and as the local @llmindset/hf-mcp-server stdio CLI.
//   3. Every catalog logo exists on disk as a real SVG.
//   4. website/lib/site.ts download links point to the Vercel Blob
//      release artifacts and their SHA-256 values are 64-hex and
//      match the published SHA256SUMS.txt for those exact files.
//   5. The one-click add path really goes through MCPPanel's
//      catalogEntryToConfig -> api.mcpServerSave -> updateSettings.
//   6. The MCP client really implements stdio/http/sse, and its
//      OAuth helper really requires RFC 7591 dynamic registration.
//
// Run: node --test --test-force-exit tests/v1121-mcp-truth.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const catalog = read('src/data/mcpCatalog.ts');
const site = read('website/lib/site.ts');
const panel = read('src/components/panels/MCPPanel.tsx');
const sums = read('website/public/downloads/SHA256SUMS.txt');

/** Slice one MCP_CATALOG entry out of the source by its id. */
function catalogEntry(id) {
  const blocks = catalog.split(/\n  \{\n/).slice(1);
  const block = blocks.find((b) => b.includes(`id: '${id}',`));
  assert.ok(block, `MCP_CATALOG has no entry with id='${id}'`);
  return block;
}

function has(source, needle, label) {
  assert.ok(source.includes(needle), `${label}: expected to find ${JSON.stringify(needle)}`);
}

function capture(source, re, label) {
  const m = source.match(re);
  assert.ok(m, `${label} not found`);
  return m[1];
}

// ------------------------------------------------------------
// 1 · Blender MCP — present, not "never added"
// ------------------------------------------------------------
test('catalog: Blender MCP is present with the official uvx command and a logo on disk', () => {
  const e = catalogEntry('blender');
  has(e, "name: 'Blender'", 'blender.name');
  has(e, "category: '3D & Design'", 'blender.category');
  has(e, "publisher: 'Community · ahujasid", 'blender.publisher (community, not Blender Foundation)');
  has(e, "transport: 'stdio'", 'blender.transport');
  has(e, "command: 'uvx'", 'blender.command');
  has(e, "args: ['mcp-for-blender']", 'blender.args');
  has(e, 'BLENDER_HOST', 'blender env host');
  has(e, 'BLENDER_PORT', 'blender env port');
  has(e, 'https://github.com/ahujasid/mcp-for-blender', 'blender.docsUrl');
  has(e, 'logo: blenderLogo', 'blender.logo');
  has(catalog, "import blenderLogo from '../assets/mcp-logos/blender.svg';", 'blender logo import');
  assert.ok(existsSync(join(ROOT, 'src/assets/mcp-logos/blender.svg')), 'blender.svg is missing on disk');
});

// ------------------------------------------------------------
// 2 · Hugging Face MCP — hosted HTTP + local stdio CLI
// ------------------------------------------------------------
test('catalog: Hugging Face MCP (hosted HTTP + local CLI) is present with logos on disk', () => {
  const hosted = catalogEntry('huggingface');
  has(hosted, "name: 'Hugging Face'", 'huggingface.name');
  has(hosted, "publisher: 'Official · Hugging Face'", 'huggingface.publisher');
  has(hosted, "transport: 'http'", 'huggingface.transport');
  has(hosted, "url: 'https://huggingface.co/mcp'", 'huggingface.url');
  has(hosted, 'Authorization', 'huggingface auth header');
  has(hosted, 'Bearer <YOUR_HF_TOKEN>', 'huggingface token placeholder');
  has(hosted, 'HF_TOKEN', 'huggingface token hint');
  has(hosted, 'https://huggingface.co/mcp?login', 'huggingface OAuth alternative hint');
  has(hosted, 'https://github.com/huggingface/hf-mcp-server', 'huggingface.docsUrl');
  has(hosted, 'logo: huggingfaceLogo', 'huggingface.logo');

  const local = catalogEntry('huggingface-local');
  has(local, "transport: 'stdio'", 'huggingface-local.transport');
  has(local, "command: 'npx'", 'huggingface-local.command');
  has(local, "'@llmindset/hf-mcp-server'", 'huggingface-local package');
  has(local, 'HF_TOKEN', 'huggingface-local env');
  has(local, '@llmindset/hf-mcp-server-http', 'huggingface-local HTTP sibling note');
  has(local, 'logo: huggingfaceLogo', 'huggingface-local.logo');

  has(catalog, "import huggingfaceLogo from '../assets/mcp-logos/huggingface.svg';", 'huggingface logo import');
  assert.ok(existsSync(join(ROOT, 'src/assets/mcp-logos/huggingface.svg')), 'huggingface.svg is missing on disk');
});

// ------------------------------------------------------------
// 3 · Every catalog logo resolves to a real file
// ------------------------------------------------------------
test('catalog: every logo import resolves to an SVG on disk', () => {
  const logos = [...catalog.matchAll(/from '\.\.\/assets\/mcp-logos\/([^']+\.svg)'/g)].map((m) => m[1]);
  assert.ok(logos.length >= 19, `expected >= 19 logo imports, found ${logos.length}`);
  for (const file of logos) {
    assert.ok(existsSync(join(ROOT, 'src/assets/mcp-logos', file)), `logo asset missing: ${file}`);
  }
  const entries = catalog.split(/\n  \{\n/).slice(1);
  assert.ok(entries.length >= 19, `expected >= 19 catalog entries, found ${entries.length}`);
  for (const e of entries) {
    assert.match(e, /logo: \w+/, 'every catalog entry must declare a logo');
  }
});

// ------------------------------------------------------------
// 4 · Download links — real Vercel Blob artifacts, rendered
// ------------------------------------------------------------
test('site.ts: download links are the real Vercel Blob artifacts for 11.12.0', () => {
  const exe = capture(site, /exe:\s*'([^']+)'/, 'download.exe');
  const zip = capture(site, /zip:\s*'([^']+)'/, 'download.zip');
  assert.match(
    exe,
    /^https:\/\/[\w-]+\.public\.blob\.vercel-storage\.com\/sadeem\/SADEEM-Setup-11\.12\.0\.exe$/,
    'exe must be the hosted installer, not a placeholder',
  );
  assert.match(
    zip,
    /^https:\/\/[\w-]+\.public\.blob\.vercel-storage\.com\/sadeem\/SADEEM-11\.12\.0-win\.zip$/,
    'zip must be the hosted portable archive, not a placeholder',
  );
  assert.notEqual(exe, zip);
  const downloadPage = read('website/components/download/DownloadPage.tsx');
  has(downloadPage, 'href={SITE.download.exe}', 'DownloadPage installer link');
  has(downloadPage, 'href={SITE.download.zip}', 'DownloadPage zip link');
});

// ------------------------------------------------------------
// 5 · Hashes — 64-hex and equal to the released artifacts
// ------------------------------------------------------------
test('site.ts: SHA-256 values are 64-hex and match published SHA256SUMS.txt', () => {
  const exeSha = capture(site, /exeSha256:\s*'([^']+)'/, 'exeSha256');
  const zipSha = capture(site, /zipSha256:\s*'([^']+)'/, 'zipSha256');
  assert.match(exeSha, /^[0-9a-f]{64}$/, 'exeSha256 must be 64 lowercase hex characters');
  assert.match(zipSha, /^[0-9a-f]{64}$/, 'zipSha256 must be 64 lowercase hex characters');
  assert.match(sums, new RegExp(`^${exeSha}  SADEEM-Setup-11\\.12\\.0\\.exe`, 'm'), 'exe hash mismatch');
  assert.match(sums, new RegExp(`^${zipSha}  SADEEM-11\\.12\\.0-win\\.zip`, 'm'), 'zip hash mismatch');
});

// ------------------------------------------------------------
// 6 · One-click add really uses the existing MCPPanel flow
// ------------------------------------------------------------
test('catalog entries one-click add through mcpServerSave + updateSettings', () => {
  has(catalog, 'export function catalogEntryToConfig', 'catalogEntryToConfig export');
  has(panel, 'catalogEntryToConfig(entry, uid())', 'panel builds a config from the catalog');
  has(panel, 'api.mcpServerSave(cfg)', 'panel persists via mcpServerSave');
  has(panel, 'updateSettings({', 'panel syncs the renderer store');
  has(panel, 'catalogEntryHasPlaceholders(entry)', 'credential placeholders open the edit form');
  has(panel, "const TRANSPORTS: MCPTransport[] = ['stdio', 'http', 'sse']", 'panel supports stdio/http/sse');
});

// ------------------------------------------------------------
// 7 · Client transport + OAuth truth (source-level)
// ------------------------------------------------------------
test('client: stdio/http/sse are implemented; OAuth requires dynamic registration', () => {
  const mcp = read('electron/agent/mcp.ts');
  has(mcp, "transport === 'http'", 'http transport branch');
  has(mcp, "transport === 'sse'", 'sse transport branch');
  has(mcp, 'new McpHttpClient(server)', 'http client');
  has(mcp, 'new McpSseClient(server)', 'sse client');

  const oauth = read('electron/agent/mcpOAuth.ts');
  has(oauth, 'registerClient(meta)', 'RFC 7591 dynamic client registration');
  has(oauth, 'server offers no dynamic client registration and none is configured', 'DCR failure message');
});
