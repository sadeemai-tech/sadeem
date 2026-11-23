// ============================================================
// v11.37 — INDEPENDENT GUARD A: TOOLS (pdf / docx / xlsx / pptx)
// ------------------------------------------------------------
// Founder's complaint M1: "the document tools loop / fail cryptically on my
// Arabic cell-biology PDF whose path has spaces + parentheses".
//
// DIAGNOSIS + TEST ONLY — no app source is edited. This script esbuild-bundles
// the REAL electron/agent/tools.ts, drives the REAL executeTool dispatch with
// the founder's exact payload shape (Arabic cell-biology content, a path with
// spaces + parens, BOTH the format:"pdf" and the title variants), injects an
// Electron-like printToPdf device bridge (the same injection main.ts performs
// at boot), and asserts:
//   1. ONE call succeeds OR returns ONE honest actionable error — never a
//      cryptic retry/loop;
//   2. Arabic UTF-8 bytes survive into the produced file;
//   3. missing parent directories are created;
//   4. the same holds for docx_make / xlsx_make / pptx_make (+ native docx/xlsx
//      builders, which need no Python).
//
// Local temp dirs only; no network, no real Electron, no model.
// Run: node tests-v1137-tools-guard.mjs
// ============================================================
import { createRequire } from 'node:module';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
process.env.SURNIA_NO_BROWSER = '1';

const failures = [];
function check(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
  if (!ok) failures.push(`${id} — ${detail}`);
  return ok;
}
/** Exact file:line of the first source line containing `needle` (live tree). */
function loc(rel, needle) {
  try {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(needle));
    return `${rel}:${i >= 0 ? i + 1 : '?'}`;
  } catch { return `${rel}:?`; }
}
const hasArabic = (buf) => {
  const s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  return /[\u0600-\u06FF]/.test(s);
};
const LOOP_MARKER = /still reasoning|calling (?:it|again)|Unknown tool|retry once|loop detected|max retries exceeded|tool error:\s*\n?\s*tool error/i;
const HONEST_ERROR = /FAILED HONESTLY|pip install|not installed|Missing required|needs a |Unsupported|Fix:|does not exist|no file was written|is not available/i;

// ------------------------------------------------------------
// 1. bundle the REAL tools.ts (electron stubbed, no net)
// ------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1137-tools-'));
process.env.SURNIA_HOME = join(TMP, 'userdata');
mkdirSync(process.env.SURNIA_HOME, { recursive: true });
const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const P = { temp: ${JSON.stringify(TMP)}, userData: ${JSON.stringify(process.env.SURNIA_HOME)}, home: ${JSON.stringify(TMP)}, appData: ${JSON.stringify(TMP)} };
module.exports = {
  app: { getPath: (k) => P[k] ?? P.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { on() {} }, screen: {},
};`);

const bundlePath = join(TMP, 'tools.bundle.cjs');
let tools;
try {
  esbuild.buildSync({
    stdin: {
      contents: "export { executeTool, setDeviceImpl } from './electron/agent/tools';",
      resolveDir: ROOT,
      sourcefile: 'v1137-tools-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['electron'],
    logLevel: 'silent',
  });
  tools = require(bundlePath);
} catch (err) {
  check('A0-BUNDLE', false, `esbuild of real tools.ts failed: ${err?.message ?? err}`);
}

// The Electron hidden-window printer is the ONLY piece we substitute. The
// tool's own HTML building, path resolution, approval, mkdir + write are real.
// The stub deliberately embeds the rendered Arabic text as UTF-8 bytes so we
// can prove the pipeline did not transliterate/drop it.
const printed = [];
if (tools?.setDeviceImpl) {
  tools.setDeviceImpl({
    screenshotScreen: async () => ({ ok: false }),
    openPath: async () => ({ ok: true }),
    clipboardRead: () => '',
    clipboardWrite: () => {},
    notify: () => ({ ok: true }),
    printToPdf: async (html) => {
      const body = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
      printed.push(body);
      return { ok: true, data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(body, 'utf8'), Buffer.from('\n%%EOF\n')]) };
    },
  });
}

// ------------------------------------------------------------
// 2. the founder's EXACT payload shape
// ------------------------------------------------------------
const WS = join(TMP, 'workspace');
mkdirSync(WS, { recursive: true });
const AR_TITLE = 'تقرير علم الأحياء الخلوية';
const AR_CONTENT = [
  `# ${AR_TITLE}`,
  '',
  '## ملخص تنفيذي',
  'تدرس هذه الوثيقة بنية الخلية حقيقية النواة ووظائف العضيات الخلوية بالتفصيل.',
  'تعمل النواة والميتوكوندريا والريبوسوم معاً للحفاظ على التوازن الخلوي.',
  '',
  '## العضيات الخلوية',
  '| العضية | الوظيفة الأساسية |',
  '| --- | --- |',
  '| النواة | تخزين المادة الوراثية والتحكم بالخلية |',
  '| الميتوكوندريا | إنتاج الطاقة على شكل ATP |',
  '| الريبوسوم | تخليق البروتينات |',
  '',
  '- الخلية حقيقية النواة تحتوي على عضيات غشائية.',
  '- الخلية بدائية النواة تفتقر إلى نواة حقيقية.',
].join('\n');
const SUBDIR = 'reports/cell biology (v1)'; // spaces + parentheses, exactly the fragile shape
const PDF_PATH = join(WS, SUBDIR, 'cell-biology.pdf');
const DOCX_PATH = join(WS, SUBDIR, 'cell-biology.docx');
const XLSX_PATH = join(WS, SUBDIR, 'cell-biology.xlsx');
const PPTX_PATH = join(WS, SUBDIR, 'cell-biology.pptx');

let approvals = 0;
const ctx = () => ({
  workspace: WS,
  sessionId: 'v1137-tools-' + Math.random().toString(36).slice(2),
  mcpServers: [],
  emit() {},
  approve: async () => { approvals++; return true; },
  fullAccess: false,
});

/** Dispatch exactly one REAL tool call and validate the one-call contract. */
async function oneCall(name, args, label) {
  if (!tools) return null;
  approvals = 0;
  const before = printed.length;
  let r;
  try {
    r = await tools.executeTool(name, JSON.stringify(args), ctx());
  } catch (err) {
    check(`${label}-NO-THROW`, false, `${name} threw: ${err?.message ?? err}`);
    return null;
  }
  const out = typeof r?.output === 'string' ? r.output : '';
  check(`${label}-ONE-CALL`, approvals <= 1 && printed.length - before <= 1,
    `${name} produced ${approvals} approval(s), ${printed.length - before} print job(s) — expected ≤1 (no cryptic retry loop) @ ${loc('electron/agent/tools.ts', 'export async function executeTool(')}`);
  check(`${label}-SHAPE`, !!r && typeof r.ok === 'boolean' && out.trim().length > 0,
    `${name} returned a structured {ok, output} with non-empty output`);
  check(`${label}-NO-LOOP`, !LOOP_MARKER.test(out),
    `${name} output has no cryptic retry/loop marker: ${JSON.stringify(out.slice(0, 160))}`);
  if (!r?.ok) {
    check(`${label}-HONEST-ERROR`, HONEST_ERROR.test(out),
      `${name} failure is ONE actionable error (got: ${JSON.stringify(out.slice(0, 200))}) @ ${loc('electron/agent/tools.ts', 'FAILED HONESTLY')}`);
  }
  return { r, out };
}
const bytes = (p) => (existsSync(p) ? readFileSync(p) : Buffer.alloc(0));
const fileProof = (label, p) => {
  const b = bytes(p);
  check(`${label}-FILE`, b.length > 0, `${basenameSafe(p)} exists and is non-empty (${b.length} bytes)`);
  check(`${label}-ARABIC`, hasArabic(b), `${basenameSafe(p)} carries Arabic UTF-8 bytes`);
  check(`${label}-PARENTS`, existsSync(dirname(p)), `parent dirs created: ${dirname(p)}`);
};
const basenameSafe = (p) => p.split(/[\\/]/).pop();

async function main() {
  console.log('===== GUARD A — TOOLS (real tools.ts, founder payload) =====');
  check('A0-HARNESS', typeof tools?.executeTool === 'function' && typeof tools?.setDeviceImpl === 'function',
    `real executeTool + setDeviceImpl bundled @ ${loc('electron/agent/tools.ts', 'export async function executeTool(')}`);

  // --- make_document with format:"pdf" (variant 1) ---
  const a1 = await oneCall('make_document', { path: PDF_PATH, content: AR_CONTENT, format: 'pdf' }, 'A1-FORMAT-PDF');
  if (a1?.r?.ok) {
    fileProof('A1', PDF_PATH);
    check('A1-PRINT', printed.length === 1 && hasArabic(printed[0]),
      `print engine received the Arabic HTML body @ ${loc('electron/agent/tools.ts', 'html→print engine')}`);
  }

  // --- pdf_make with title variant (variant 2) ---
  const a2 = await oneCall('pdf_make', { path: PDF_PATH, content: AR_CONTENT, title: AR_TITLE }, 'A2-TITLE-PDF');
  if (a2?.r?.ok) fileProof('A2', PDF_PATH);

  // --- native docx / xlsx builders: real Arabic bytes, zero Python ---
  for (const [fmt, dest, label] of [['docx', DOCX_PATH, 'A3-DOCX'], ['xlsx', XLSX_PATH, 'A4-XLSX']]) {
    const res = await oneCall('make_document', { path: dest, content: AR_CONTENT, format: fmt, title: AR_TITLE }, label);
    if (res?.r?.ok) fileProof(label, dest);
    check(`${label}-NATIVE`, res?.r?.ok === true,
      `native ${fmt.toUpperCase()} built without Python @ ${loc('electron/agent/tools.ts', `fmt === '${fmt}'`)}`);
  }

  // --- the three *_make builders with Arabic (success OR one honest error) ---
  const office = [
    ['docx_make', DOCX_PATH, { content: AR_CONTENT, title: AR_TITLE }, 'A5-DOCX-MAKE'],
    ['xlsx_make', XLSX_PATH, { csv: 'العضية,الوظيفة\nالنواة,تخزين المادة الوراثية\nالميتوكوندريا,إنتاج الطاقة' }, 'A6-XLSX-MAKE'],
    ['pptx_make', PPTX_PATH, { title: AR_TITLE, slides: [{ title: 'الخلية حقيقية النواة', bullets: ['النواة', 'الميتوكوندريا'] }] }, 'A7-PPTX-MAKE'],
  ];
  for (const [name, dest, extra, label] of office) {
    const res = await oneCall(name, { path: dest, ...extra }, label);
    if (res?.r?.ok) fileProof(label, dest);
    else check(`${label}-ACTIONABLE`, HONEST_ERROR.test(res?.out ?? ''),
      `${name} failing path returns a single pip/fix command @ ${loc('electron/agent/tools.ts', 'FAILED HONESTLY')}`);
  }

  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* gone */ }
  console.log(`\n===== GUARD A SUMMARY: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} failure(s)) =====`);
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = failures.length ? 1 : 0;
}
main().catch((err) => {
  console.error('GUARD A crashed:', err);
  process.exitCode = 1;
});
