// Surnia v2.1 — LONG-TASK field test: the engine builds a complete system
// from scratch (URL shortener: server + storage + tests), runs its own
// tests, and must leave a green workspace. Real model via the GLM bridge.
import { startBridge } from './glm-bridge.mjs';
import { runCLI } from './cli-driver.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'surnia-longtask-'));
const started = Date.now();

console.log('── LONG TASK: build a URL shortener service from an empty folder ──');
console.log('   workspace:', ws);

const port = await startBridge(0);
const TASK = `Build a complete URL-shortener service in this empty workspace, in JavaScript (Node.js, NO npm dependencies, no package.json install step needed):
1) storage.js — JSON-file-backed store (save/load a map of short codes to URLs, atomic write via temp file + rename).
2) server.js — a zero-dependency http server on PORT env (default 3000): POST /shorten {url} -> {code}; GET /:code -> 302 redirect; GET /stats/:code -> {url, hits}. Persist hits in storage.
3) test/server.test.js — node:test tests that start the server on an ephemeral port, cover shorten + redirect + stats + 404, and pass with "node --test".
4) README.md — how to run it.
Then RUN "node --test" yourself and keep fixing until all tests pass. Do not use any external packages.`;

const res = await runCLI({
  root,
  task: TASK,
  mode: 'fullAccess',
  workspace: ws,
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: 'bridge-local',
  model: 'glm-5.3-flash',
  timeoutMs: 420_000,
});

const dt = Math.round((Date.now() - started) / 1000);
console.log(`\n── engine finished in ${dt}s, exit=${res.code} ──`);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

// 1) deliverables exist
const files = ['storage.js', 'server.js', 'README.md'];
for (const f of files) check(`file: ${f}`, fs.existsSync(path.join(ws, f)));
check('file: test/server.test.js', fs.existsSync(path.join(ws, 'test', 'server.test.js')));

// 2) independent verification — WE run the tests, not just the agent's claim
const t = spawnSync('node', ['--test'], { cwd: ws, encoding: 'utf8', timeout: 60_000 });
const out = (t.stdout || '') + (t.stderr || '');
const m = out.match(/ℹ (?:pass|tests)\s+(\d+)[\s\S]*?ℹ fail\s+(\d+)/);
const testsTotal = m ? Number(m[1]) : 0;
const testsFail = m ? Number(m[2]) : (t.status === 0 ? 0 : -1);
check('independent test run: exit 0', t.status === 0, `status=${t.status}`);
check('tests exist and pass', testsTotal >= 3 && testsFail === 0, `${testsTotal} tests, ${testsFail} failing`);

// 3) real smoke: start the built server on a FIXED port and exercise the contract
let smokeOk = false;
let smokeDetail = 'server did not start';
if (fs.existsSync(path.join(ws, 'server.js'))) {
  const FIXED_PORT = String(30000 + Math.floor(Math.random() * 20000));
  const srv = spawnSync('node', ['-e', `
    const { spawn } = require('child_process');
    const http = require('http');
    const PORT = ${JSON.stringify(FIXED_PORT)};
    const child = spawn(process.execPath, ['server.js'], { cwd: ${JSON.stringify(ws)}, env: { ...process.env, PORT } });
    let buf = '';
    child.stdout.on('data', (d) => { buf += String(d); });
    child.stderr.on('data', (d) => { buf += String(d); });
    // retry-connect until the port accepts (we don't trust the banner format)
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (tries > 50) { console.error('SMOKE_FAIL never-accepted tail=' + buf.slice(-120).replace(/\\n/g, ' ')); clearInterval(iv); child.kill(); process.exit(1); }
      const probe = http.get({ host: '127.0.0.1', port: PORT, path: '/__probe__' }, () => { clearInterval(iv); run(); });
      probe.on('error', () => {}); probe.end();
    }, 200);
    function post() {
      return new Promise((res2, rej2) => {
        const r = http.request({ host: '127.0.0.1', port: PORT, path: '/shorten', method: 'POST', headers: { 'content-type': 'application/json' } }, (resp) => {
          let b = ''; resp.on('data', c => b += c); resp.on('end', () => res2({ status: resp.statusCode, body: b }));
        });
        r.on('error', rej2); r.end(JSON.stringify({ url: 'https://example.com/very/long/path' }));
      });
    }
    const get = (p) => new Promise((res3, rej3) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, (r2) => { let b=''; r2.on('data', c=>b+=c); r2.on('end', () => res3({ status: r2.statusCode, loc: r2.headers.location, body: b })); }).on('error', rej3); });
    async function run() {
      try {
        const { status, body } = await post();
        if (status !== 200) throw new Error('shorten status ' + status + ' ' + body.slice(0, 80));
        const code = JSON.parse(body).code;
        const r1 = await get('/' + code);
        if (r1.status !== 302 || r1.loc !== 'https://example.com/very/long/path') throw new Error('redirect got ' + r1.status + ' ' + r1.loc);
        const r2 = await get('/stats/' + code);
        if (r2.status !== 200) throw new Error('stats status ' + r2.status);
        const st = JSON.parse(r2.body);
        if (!st.url || !(st.hits >= 1)) throw new Error('stats body ' + r2.body);
        console.log('SMOKE_OK');
        child.kill(); process.exit(0);
      } catch (e) {
        console.error('SMOKE_FAIL ' + e.message);
        child.kill(); process.exit(1);
      }
    }
    setTimeout(() => { console.error('SMOKE_FAIL timeout'); child.kill(); process.exit(1); }, 25000);
  `], { encoding: 'utf8', timeout: 35_000 });
  smokeOk = srv.status === 0 && /SMOKE_OK/.test(srv.stdout);
  smokeDetail = (srv.stdout.trim() || srv.stderr.trim()).split('\n').pop() ?? '';
}
check('live HTTP smoke: shorten→302 redirect→stats hits≥1', smokeOk, smokeDetail);

// 4) engine discipline: it actually used its tools (transcript evidence)
const usedTools = /tool_use|edit|write|run/i.test(res.stdout);
check('agent ran a real tool loop', usedTools);

console.log(`\n══════ LONG TASK RESULT: ${pass} passed, ${fail} failed · ${dt}s ══════`);
process.exit(fail === 0 ? 0 : 1);
