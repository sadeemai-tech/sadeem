#!/usr/bin/env node
// ============================================================
// SADEEM v11.11 (A7-COGNITION) — LIVE MCP ROUND-TRIP PROOF, headless.
// Drives the REAL stdio MCP server (scripts/mcp-proof-server.mjs — genuine
// JSON-RPC 2.0 / Model Context Protocol) and proves the full trip:
//   initialize → tools/list → tools/call → result
//
//   (default)  PHASE 1 — raw protocol: this script speaks MCP JSON-RPC
//              directly over the server's stdio and prints every response.
//   --client   PHASE 2 — the app's REAL MCP client: bundles
//              electron/agent/mcp.ts with esbuild (same electron stub the
//              test harness uses) and drives the SAME live server through
//              mcpListTools() + mcpCallTool().
//
// Exit 0 = round trip proven; any failed assertion exits 1 with a
// diagnostic. Used by scripts/qa-mcp-live.sh (phases 1-2).
// ============================================================
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = path.join(ROOT, 'scripts', 'mcp-proof-server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed = true;
    console.error(`  ✗ ${label}`);
  }
}

// ------------------------------------------------------------
// PHASE 1 — raw MCP JSON-RPC 2.0 over stdio
// ------------------------------------------------------------
async function rawRoundTrip() {
  console.log('phase 1: raw MCP protocol round trip (stdio JSON-RPC)');
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          lines.push(JSON.parse(line));
        } catch {
          /* torn line — never expected on this protocol */
        }
      }
    }
  });
  child.stderr.on('data', () => {}); // diagnostics only
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const byId = (id) => lines.find((m) => m && m.id === id);
  const waitFor = async (id, label, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = byId(id);
      if (m) return m;
      await sleep(20);
    }
    ok(false, `${label} — no response within ${ms}ms`);
    return null;
  };

  try {
    // 1. initialize handshake (per the MCP spec)
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sadeem-qa', version: '11.11.0' } },
    });
    const init = await waitFor(1, 'initialize');
    ok(!!init, 'initialize → response received');
    if (init) {
      console.log('  ← ' + JSON.stringify(init.result));
      ok(init.result?.serverInfo?.name === 'sadeem-proof-mcp', 'serverInfo.name === sadeem-proof-mcp');
    }
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // 2. tools/list
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await waitFor(2, 'tools/list');
    const toolNames = (list?.result?.tools ?? []).map((t) => t.name);
    console.log('  ← tools: ' + toolNames.join(', '));
    ok(toolNames.includes('echo') && toolNames.includes('now'), 'tools/list → echo + now discovered');

    // 3. tools/call echo
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { message: 'SADEEM live round trip' } } });
    const echo = await waitFor(3, 'tools/call echo');
    const echoText = echo?.result?.content?.[0]?.text;
    console.log('  ← ' + JSON.stringify(echo?.result));
    ok(echoText === 'echo: SADEEM live round trip' && echo?.result?.isError === false, `tools/call echo → "${echoText}"`);

    // 4. tools/call now
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'now', arguments: {} } });
    const now = await waitFor(4, 'tools/call now');
    const nowText = now?.result?.content?.[0]?.text;
    const asDate = new Date(nowText ?? '');
    console.log('  ← ' + JSON.stringify(now?.result));
    ok(!Number.isNaN(asDate.getTime()), `tools/call now → valid ISO timestamp "${nowText}"`);

    ok(!failed, 'PHASE 1 ROUND TRIP COMPLETE: list tools → call tools → results received');
  } finally {
    child.kill();
  }
  return !failed;
}

// ------------------------------------------------------------
// PHASE 2 — the app's REAL MCP client (electron/agent/mcp.ts)
// ------------------------------------------------------------
function clientRoundTrip() {
  console.log('phase 2: SADEEM MCP client round trip (bundled electron/agent/mcp.ts)');
  const tmp = mkdtempSync(path.join(tmpdir(), 'sadeem-mcp-proof-'));
  const ud = path.join(tmp, 'userdata');
  mkdirSync(ud, { recursive: true });
  try {
    // electron stub — exactly the posture tests/v1110-subsystems.test.mjs uses
    const stubDir = path.join(tmp, 'node_modules', 'electron');
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
    writeFileSync(path.join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(ud)} } };`);

    const out = path.join(tmp, 'mcp.cjs');
    execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
      path.join(ROOT, 'electron', 'agent', 'mcp.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
      '--external:electron',
    ], { cwd: ROOT, stdio: 'pipe' });

    const require = createRequire(import.meta.url);
    const mcp = require(out);
    const cfg = {
      id: 'proof', name: 'sadeem-proof-mcp',
      command: process.execPath, args: [SERVER],
      transport: 'stdio', timeoutMs: 10000, enabled: true,
    };
    return (async () => {
      const list = await mcp.mcpListTools(cfg);
      ok(list?.ok === true, `mcpListTools OK (${(list?.tools ?? []).length} tools)`);
      const names = (list?.tools ?? []).map((t) => t.name);
      console.log('  ← tools: ' + (names.join(', ') || '(none)'));
      ok(names.includes('echo') && names.includes('now'), 'real client discovered echo + now');

      const echo = await mcp.mcpCallTool(cfg, 'echo', { message: 'hello from the SADEEM client' });
      console.log('  ← ' + String(echo?.output ?? '').replace(/\n/g, ' ').slice(0, 200));
      ok(echo?.ok === true && String(echo?.output).includes('echo: hello from the SADEEM client'),
        'mcpCallTool(echo) result text round-tripped through the REAL client');

      const now = await mcp.mcpCallTool(cfg, 'now', {});
      console.log('  ← ' + String(now?.output ?? '').replace(/\n/g, ' ').slice(0, 200));
      ok(now?.ok === true && !Number.isNaN(new Date(String(now?.output).trim()).getTime()),
        'mcpCallTool(now) returned a valid timestamp through the REAL client');

      ok(!failed, 'PHASE 2 ROUND TRIP COMPLETE: list tools → call tools → results received');
      return !failed;
    })().finally(() => {
      try { mcp.closeAllMcpClients(); } catch { /* already gone */ }
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }
    });
  } catch (err) {
    console.error('  ✗ client harness failed: ' + (err?.message ?? err));
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }
    return Promise.resolve(false);
  }
}

const isClient = process.argv.includes('--client');
const pass = await (isClient ? clientRoundTrip() : rawRoundTrip());
process.exit(pass ? 0 : 1);
