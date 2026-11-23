// Kodex E2E — spawns the compiled CLI bundle (the real engine) and
// streams its output. Returns { code, stdout, stderr }.
import { spawn } from 'node:child_process';
import path from 'node:path';

export function runCLI({ root, task, mode, workspace, baseUrl, apiKey, model, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn('node', [
      path.join(root, 'dist-cli/kodex.cjs'),
      task,
      '--mode', mode,
      '--workspace', workspace,
      '--base-url', baseUrl,
      '--api-key', apiKey,
      '--model', model,
      '--provider', 'custom',
    ], { cwd: root, env: { ...process.env, KODEX_HOME: '/tmp/kodex-e2e-home' } });

    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      stderr += '\n[e2e] TIMEOUT — aborted';
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
