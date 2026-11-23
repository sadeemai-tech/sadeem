// Vision pipeline E2E — proves the REAL CLI → engine → providers chain
// sends image parts in the OpenAI wire format (bridge logs image count).
// GLM-4.6 is text-only, so the bridge strips images before forwarding;
// the assertion is on the wire format + a clean model roundtrip.
import { startBridge } from './glm-bridge.mjs';
import { spawn } from 'node:child_process';
import { promises as fs, mkdtempSync } from 'node:fs';
import * as path from 'node:path';

const ws = mkdtempSync('/tmp/kodex-vision-');
await fs.writeFile(path.join(ws, 'notes.txt'), 'hello vision test\n');

const port = await startBridge(0);
console.log(`bridge on :${port}`);

// The bridge logs from THIS process — capture its console.log for assertions.
let bridgeLog = '';
const origLog = console.log.bind(console);
console.log = (...a) => {
  const line = a.join(' ');
  bridgeLog += line + '\n';
  origLog(line);
};

const args = [
  'dist-cli/kodex.cjs',
  'Describe the attached image briefly, then summarize notes.txt.',
  '--mode', 'fullAccess',
  '--workspace', ws,
  '--provider', 'custom',
  '--model', 'glm-4.6',
  '--base-url', `http://127.0.0.1:${port}/v1`,
  '--api-key', 'bridge-test-key',
  '--image', '/tmp/kodex-vision-test.png',
  '--print-cap', '120',
];

const child = spawn('node', args, {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, KODEX_HOME: '/tmp/kodex-e2e-home' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let bridgeOut = '';
child.stdout.on('data', (d) => {
  out += d.toString();
});
child.stderr.on('data', (d) => {
  bridgeOut += d.toString();
  process.stderr.write(d);
});

const code = await new Promise((resolve, reject) => {
  const t = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('vision E2E timeout'));
  }, 180_000);
  child.on('exit', (c) => {
    clearTimeout(t);
    resolve(c ?? 1);
  });
});

console.log('\n──────── vision E2E ────────');
const sawVision = /vision: request carried (\d+) image part/.test(bridgeLog);
console.log(`  exit=${code}`);
console.log(`  ${sawVision ? '✅' : '✗'} image part(s) reached the provider wire format`);
const engineRan = out.includes('▸') || out.includes('—') || out.length > 50;
console.log(`  ${engineRan && code === 0 ? '✅' : '✗'} engine roundtrip completed cleanly`);
if (!sawVision || code !== 0) {
  console.log('STDOUT:', out.slice(-1500));
  process.exit(1);
}
console.log('──────── VISION E2E: PASS ────────');
console.log('  (model reply ignores the image: glm-4.6 is text-only and the');
console.log('   bridge strips image parts before forwarding — wire format is the assertion)');
