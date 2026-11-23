// ============================================================
// SADEEM v12 — Jupyter notebook (.ipynb) tools
// Real cell read / edit / execute. Never throws to callers: bad
// input and missing runtimes produce HONEST refusals. Notebook JSON
// is preserved byte-for-byte outside the field being edited.
// ============================================================
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { ToolContext, ToolOutcome } from './tools';
import { runCaptured } from '../services/terminalService';

interface NbCell {
  cell_type?: string;
  source?: string | string[];
  outputs?: unknown[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}
interface NbDoc {
  cells?: NbCell[];
  nbformat?: number;
  [k: string]: unknown;
}

const asString = (v: unknown): string => typeof v === 'string' ? v : v == null ? '' : String(v);
const asNumber = (v: unknown, d = 0): number => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : d; };
const sourceOf = (c: NbCell): string => Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
const setSource = (c: NbCell, text: string): void => {
  // Keep the canonical .ipynb string-array form so diffs stay line-oriented.
  const lines = text.split('\n');
  c.source = lines.map((l, i) => i < lines.length - 1 ? `${l}\n` : l);
};

function resolveNb(raw: string, ctx: ToolContext): string | null {
  if (!raw.trim()) return null;
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(ctx.workspace, raw);
  if (!abs.toLowerCase().endsWith('.ipynb')) return null;
  if (!abs.startsWith(path.resolve(ctx.workspace))) return null; // path jail
  return abs;
}

async function readNb(abs: string): Promise<NbDoc> {
  const raw = await fsp.readFile(abs, 'utf8');
  const doc = JSON.parse(raw) as NbDoc;
  if (!doc || !Array.isArray(doc.cells)) throw new Error('not a valid .ipynb (missing cells array)');
  return doc;
}

export async function notebookReadTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const abs = resolveNb(asString(args.path), ctx);
  if (!abs) return { ok: false, output: 'Missing/invalid path: provide a workspace-relative .ipynb file.' };
  try {
    const doc = await readNb(abs);
    const lines = doc.cells!.map((c, i) => {
      const src = sourceOf(c);
      const preview = src.length > 160 ? src.slice(0, 160) + '…' : src.replace(/\n/g, ' ⏎ ');
      const outN = Array.isArray(c.outputs) ? c.outputs.length : 0;
      return `[${i}] ${c.cell_type ?? '?'} (${c.execution_count ?? ' '}) ${outN ? `${outN} outputs ` : ''}· ${preview || '(empty)'}`;
    });
    return { ok: true, output: `${abs}\nnbformat ${doc.nbformat ?? '?'} · ${doc.cells!.length} cell(s)\n${lines.join('\n')}` };
  } catch (err) {
    return { ok: false, output: `notebook_read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function notebookEditCellTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const abs = resolveNb(asString(args.path), ctx);
  if (!abs) return { ok: false, output: 'Missing/invalid path: provide a workspace-relative .ipynb file.' };
  const idx = asNumber(args.index, -1);
  const source = asString(args.source);
  if (idx < 0) return { ok: false, output: 'Missing required parameter: index (0-based cell index).' };
  if (!source) return { ok: false, output: 'Missing required parameter: source (new cell content).' };
  try {
    const doc = await readNb(abs);
    const cell = doc.cells![idx];
    if (!cell) return { ok: false, output: `Cell ${idx} does not exist (notebook has ${doc.cells!.length} cells).` };
    const before = sourceOf(cell);
    const ask = await ctx.approve({
      kind: 'write',
      title: `Edit notebook cell ${idx}`,
      detail: `${abs} · cell ${idx} (${cell.cell_type ?? '?'})`,
      payload: { path: abs, oldText: before, newText: source },
    });
    if (!ask) return { ok: false, output: 'notebook_edit_cell: denied by user.' };
    setSource(cell, source);
    await fsp.writeFile(abs, JSON.stringify(doc, null, 1) + '\n', 'utf8');
    return { ok: true, output: `Updated cell ${idx} of ${abs} (${before.length} → ${source.length} chars).` };
  } catch (err) {
    return { ok: false, output: `notebook_edit_cell failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Real Jupyter-kernel runner (uses nbclient when available; TS stays in
// control of serialization by writing a small result.json sidecar).
const PY_NBCLIENT_RUNNER = [
  'import sys, json, nbformat',
  'from nbclient import NotebookClient',
  'nb_path, idx, kernel, timeout, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3], float(sys.argv[4]), sys.argv[5]',
  'nb = nbformat.read(nb_path, as_version=4)',
  'client = NotebookClient(nb, timeout=timeout, kernel_name=kernel, allow_errors=True)',
  'with client.setup_kernel():',
  '    for i in range(idx + 1):',
  '        client.execute_cell(nb.cells[i], i)',
  'c = nb.cells[idx]',
  'json.dump({"index": idx, "execution_count": c.get("execution_count"),',
  '  "outputs": c.get("outputs", []), "summary": str(len(c.get("outputs", []))) + " output(s)"},',
  '  open(out_path, "w"))',
  '',
].join('\n');

async function pyModuleAvailable(module: string): Promise<boolean> {
  try {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const { execFile } = require('node:child_process') as typeof import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile(py, ['-c', `import ${module}`], { timeout: 5000, windowsHide: true }, (err) => err ? reject(err) : resolve());
    });
    return true;
  } catch { return false; }
}

export async function notebookRunTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const abs = resolveNb(asString(args.path), ctx);
  if (!abs) return { ok: false, output: 'Missing/invalid path: provide a workspace-relative .ipynb file.' };
  const idx = asNumber(args.index, -1);
  if (idx < 0) return { ok: false, output: 'Missing required parameter: index (0-based cell index).' };
  const timeoutMs = Math.max(1000, Math.min(120_000, asNumber(args.timeout_ms, 30_000)));
  try {
    const doc = await readNb(abs);
    const cell = doc.cells![idx];
    if (!cell) return { ok: false, output: `Cell ${idx} does not exist (notebook has ${doc.cells!.length} cells).` };
    if (cell.cell_type !== 'code') return { ok: false, output: `Cell ${idx} is ${cell.cell_type ?? '?'}, not a code cell — nothing to execute.` };
    const code = sourceOf(cell).trim();
    if (!code) return { ok: false, output: `Cell ${idx} is empty — nothing to execute.` };
    const meta = (doc.metadata ?? {}) as any;
    const lang = String(meta.kernelspec?.language || 'python').toLowerCase();
    if (!lang.startsWith('py')) return { ok: false, output: `Notebook kernel language "${lang}" is not executable here (python only).` };
    const kernel = String(meta.kernelspec?.name || 'python3');

    // Detect a real Jupyter kernel stack (honest probe).
    const [hasNbclient, hasNbformat] = await Promise.all([pyModuleAvailable('nbclient'), pyModuleAvailable('nbformat')]);
    const realKernel = hasNbclient && hasNbformat;

    const ask = await ctx.approve({
      kind: 'command',
      title: `Run notebook cell ${idx}`,
      detail: `${abs} · cell ${idx} · via ${realKernel ? `real ${kernel} kernel (nbclient)` : 'plain python (no kernel state)'}\n${code.slice(0, 500)}`,
      payload: { command: `python <cell ${idx} of ${path.basename(abs)}>`, cwd: ctx.workspace },
    });
    if (!ask) return { ok: false, output: 'notebook_run: denied by user.' };

    const tmpDir = await fsp.mkdtemp(path.join(require('node:os').tmpdir(), 'sadeem-nb-'));
    try {
      if (realKernel) {
        // REAL kernel execution — preserves rich outputs + execution_count.
        const runner = path.join(tmpDir, 'run_nb.py');
        const resultPath = path.join(tmpDir, 'result.json');
        await fsp.writeFile(runner, PY_NBCLIENT_RUNNER, 'utf8');
        const py = process.platform === 'win32' ? 'python' : 'python3';
        const r = await runCaptured(
          `${py} ${JSON.stringify(runner)} ${JSON.stringify(abs)} ${idx} ${JSON.stringify(kernel)} ${timeoutMs} ${JSON.stringify(resultPath)}`,
          ctx.workspace, timeoutMs,
        );
        if (r.exitCode !== 0) {
          return { ok: false, output: `notebook_run via nbclient failed (exit ${r.exitCode}): ${r.output.slice(-1500)}` };
        }
        const res = JSON.parse(await fsp.readFile(resultPath, 'utf8')) as { outputs: unknown[]; execution_count: number | null; summary: string };
        cell.outputs = res.outputs;
        cell.execution_count = res.execution_count;
        await fsp.writeFile(abs, JSON.stringify(doc, null, 1) + '\n', 'utf8');
        return { ok: true, output: `Cell ${idx} executed in a real ${kernel} kernel via nbclient. ${res.summary} (outputs saved to the notebook).` };
      }

      // FALLBACK — plain Python script (stdout only, no kernel state).
      const script = path.join(tmpDir, `cell-${idx}.py`);
      await fsp.writeFile(script, code, 'utf8');
      const py = process.platform === 'win32' ? 'python' : 'python3';
      const r = await runCaptured(`${py} ${JSON.stringify(script)}`, ctx.workspace, timeoutMs);
      const output = r.output;
      const exitCode = r.exitCode;
      cell.outputs = [{
        output_type: exitCode === 0 ? 'stream' : 'error',
        name: exitCode === 0 ? 'stdout' : 'stderr',
        text: output.split('\n').map((l) => l + '\n'),
        ...(exitCode !== 0 ? { ename: 'CellExecutionError', evalue: `exit ${exitCode}`, traceback: [] } : {}),
      }];
      cell.execution_count = (typeof cell.execution_count === 'number' ? cell.execution_count : 0) + 1;
      await fsp.writeFile(abs, JSON.stringify(doc, null, 1) + '\n', 'utf8');
      return {
        ok: true,
        output: `Cell ${idx} executed as plain Python (exit ${exitCode}) — no Jupyter kernel state (stdout only). For rich outputs install: pip install nbclient nbformat jupyter_client.\n${output.slice(0, 4000)}`,
      };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (err) {
    return { ok: false, output: `notebook_run failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
