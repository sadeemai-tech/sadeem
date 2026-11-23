import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.31 — UI OVERLAYS AUDIT (preview / terminal / diff / rewind /
// clone / new project / model picker / clarification).
//
// Locks the concrete fixes made to the owned overlay files:
//   • no dead controls (every action has a real handler + a11y name)
//   • no stale data across reopens (clone / new-project / diff toggle)
//   • approvals cannot be silently abandoned by closing the diff
//   • focus goes to the first real control, rAF-after-Modal
//   • bilingual honesty (Arabic UI never falls back to bare English)
//   • keyboard is never trapped (Esc closes popovers; Enter not doubled)
//
//   node --test --test-force-exit tests/v1131-ui-overlays.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const AREA = read('src', 'components', 'PreviewArea.tsx');
const BROWSER = read('src', 'components', 'BrowserDock.tsx');
const TERM = read('src', 'components', 'TerminalView.tsx');
const DIFFMODAL = read('src', 'components', 'DiffModal.tsx');
const DIFFVIEW = read('src', 'components', 'DiffView.tsx');
const REWIND = read('src', 'components', 'RewindChooser.tsx');
const CLONE = read('src', 'components', 'CloneDialog.tsx');
const WIZARD = read('src', 'components', 'NewProjectWizard.tsx');
const PICKER = read('src', 'components', 'ModelPicker.tsx');
const CLARIF = read('src', 'components', 'ClarificationCard.tsx');

// ------------------------------------------------------------
// 1 · PREVIEW — popover keyboard escape + bilingual status/actions
// ------------------------------------------------------------
test('PV1: source/history popovers are Esc-dismissible — no focus trap', () => {
  assert.match(AREA, /if \(e\.key === 'Escape'\) setOpenMenu\('none'\)/, 'Escape closes the open popover');
  assert.match(AREA, /window\.addEventListener\('keydown', onKey\)/, 'keyboard listener is installed');
  assert.match(AREA, /return \(\) => window\.removeEventListener\('keydown', onKey\)/, 'listener is torn down');
});

test('PV1: status pill + copy URL never fall back to bare English in Arabic', () => {
  assert.match(AREA, /error: t\('preview\.state\.error', lang === 'ar' \? 'خطأ' : 'ERROR'\)/);
  assert.match(AREA, /loading: t\('preview\.state\.loading', lang === 'ar' \?/);
  assert.match(AREA, /ready: t\('preview\.state\.ready', lang === 'ar' \? 'جاهز' : 'READY'\)/);
  assert.match(AREA, /idle: t\('preview\.state\.idle', lang === 'ar' \? 'خامل' : 'IDLE'\)/);
  assert.match(AREA, /const statusLabel = t\('preview\.status', lang === 'ar' \? 'حالة المعاينة' : 'Preview status'\)/);
  assert.match(AREA, /const copyLabel = t\([\s\S]{0,220}lang === 'ar' \? \(copiedUrl \? 'تم النسخ' : 'نسخ الرابط'\)/);
  assert.match(AREA, /title=\{copyLabel\}\s*\n\s*aria-label=\{copyLabel\}/, 'copy control uses the localized label');
});

test('PV1: every toolbar action still has a real (non-dead) onClick handler', () => {
  const wired = [
    ['pv-toolbar', /data-testid="pv-toolbar"/],
    ['pv-url', /data-testid="pv-url"[\s\S]{0,160}onChange=\{\(e\) => setDraft\(e\.target\.value\)\}/],
    ['pv-copy-url', /data-testid="pv-copy-url"[\s\S]{0,220}onClick=\{\(\) => void copyUrl\(\)\}/],
    ['pv-reload', /data-testid="pv-reload"[\s\S]{0,160}onClick=\{reload\}/],
    ['pv-open-external', /data-testid="pv-open-external"[\s\S]{0,160}onClick=\{openExternal\}/],
    ['pv-close', /data-testid="pv-close"[\s\S]{0,160}onClick=\{\(\) => setPreviewOpen\(false\)\}/],
    ['pv-built-dismiss', /data-testid="pv-built-dismiss"[\s\S]{0,340}onClick=\{\(\) => setBuiltDismissedSeq\(/],
    ['pv-error-dismiss', /data-testid="pv-error-dismiss"[\s\S]{0,220}dismissPreviewError\(\)/],
    ['pv-failed-log-toggle', /data-testid="pv-failed-log-toggle"[\s\S]{0,200}onClick=\{\(\) => setFailedLogOpen\(\(v\) => !v\)\}/],
    ['pv-failed-reload', /data-testid="pv-failed-reload"[\s\S]{0,80}onClick=\{reload\}/],
  ];
  for (const [id, re] of wired) assert.match(AREA, re, `${id} is wired`);
});

// ------------------------------------------------------------
// 2 · BROWSER DOCK / TERMINAL — named controls, real actions
// ------------------------------------------------------------
test('BD1: browser tabs are keyboard-selectable and close does not double-fire', () => {
  assert.match(BROWSER, /role="tab"[\s\S]{0,120}aria-selected=\{tab\.active\}[\s\S]{0,120}tabIndex=\{0\}/);
  assert.match(BROWSER, /if \(e\.target !== e\.currentTarget\) return;/);
  assert.match(BROWSER, /void tabAction\('select', tab\.id\)/);
});

test('TM1: interrupt + clear are named controls wired to real PTY actions', () => {
  assert.match(TERM, /title=\{t\('term\.interrupt'\)\}[\s\S]{0,60}aria-label=\{t\('term\.interrupt'\)\}/);
  assert.match(TERM, /aria-label=\{t\('term\.clear'\)\}[\s\S]{0,240}termRef\.current\?\.clear\(\)/);
  assert.match(TERM, /void api\.termExec\(id, cmd\)/, 'Enter runs the command in the PTY');
  assert.match(TERM, /void api\.termInterrupt\(id\)/, 'Ctrl+C interrupts the PTY');
  assert.match(TERM, /if \(!document\.querySelector\('\[data-modal-open="true"\]'\)\) term\.focus\(\)/, 'xterm takes focus on mount unless an overlay owns it');
});

// ------------------------------------------------------------
// 3 · DIFF — approval close, honest top-3, no stale toggle
// ------------------------------------------------------------
test('DF1: closing an APPROVAL diff denies it — the engine can never hang', () => {
  assert.match(DIFFMODAL, /if \(diffView\?\.approvalRequestId\) \{[\s\S]{0,260}decideApproval\('deny'\)/, 'X/backdrop/Esc deny the approval');
  assert.match(DIFFMODAL, /decideApproval\('deny'\)[\s\S]{0,240}\.finally\(\(\) => setDiffView\(null\)\)/, 'surface always clears');
  assert.match(DIFFMODAL, /else \{\s*setDiffView\(null\);\s*\}/, 'plain diff still closes normally');
});

test('DF1: a fresh diff resets the stale unified/split choice', () => {
  assert.match(DIFFMODAL, /useEffect\(\(\) => setSplitView\(true\), \[diffView\]\)/);
});

test('DF1: "Review the top 3" lands on the LARGEST hunk (not the last scroll)', () => {
  assert.doesNotMatch(DIFFMODAL, /top3\.forEach\(\(start\) => scrollToHunk\(start\)\)/, 'old triple-scroll removed');
  assert.match(DIFFMODAL, /onClick=\{\(\) => \{ if \(top3\.length\) scrollToHunk\(top3\[0\]\); \}\}/);
});

test('DF1: diff stat + view toggle speak Arabic when the UI is Arabic', () => {
  assert.match(DIFFMODAL, /t\('diff\.statTitle', lang === 'ar' \? '\{a\} مضاف · \{r\} محذوف'/);
  assert.match(DIFFMODAL, /t\('diff\.viewUnified', lang === 'ar' \? 'عرض موحّد' : 'Unified view'\)/);
  assert.match(DIFFMODAL, /t\('diff\.viewSplit', lang === 'ar' \? 'عرض جنباً إلى جنب' : 'Side-by-side view'\)/);
});

test('DF2: diff view Before/After labels are exposed to AT and follow the UI direction', () => {
  assert.doesNotMatch(DIFFVIEW, /className="diffv-split-cols" aria-hidden/, 'labels no longer hidden');
  assert.match(DIFFVIEW, /<span dir="auto">\{t\('diff\.before'/);
  assert.match(DIFFVIEW, /<span dir="auto">\{t\('diff\.after'/);
  assert.match(DIFFVIEW, /className="diffv-more" dir="auto"/);
});

// ------------------------------------------------------------
// 4 · REWIND — empty state + whole-row restore target
// ------------------------------------------------------------
test('RW1: the chooser is reachable even with an empty checkpoint list', () => {
  assert.match(REWIND, /open=\{!!cps\}/, 'modal opens whenever the picker slice exists');
  assert.match(REWIND, /cps\?\.length === 0[\s\S]{0,260}slash\.rewind\.empty/, 'localized empty state is shown');
});

test('RW1: the whole row restores, the chip does not double-fire, one at a time', () => {
  assert.match(REWIND, /onClick=\{\(\) => void onRestore\(cp\.id\)\}/, 'row is a real target');
  assert.match(REWIND, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); void onRestore\(cp\.id\); \}\}/);
  assert.match(REWIND, /if \(busyId !== null\) return;/, 'concurrent restores are blocked');
});

// ------------------------------------------------------------
// 5 · CLONE / NEW PROJECT — no stale data, no stuck busy, real focus
// ------------------------------------------------------------
test('CL1: reopening the clone dialog clears the previous attempt and focuses the URL', () => {
  assert.match(CLONE, /if \(!open\) return;[\s\S]{0,260}setUrl\(''\); setDestDir\(''\); setName\(''\); setBranch\(''\)/);
  assert.match(CLONE, /setError\(null\); setLog\(\[\]\); setBusy\(false\)/, 'error/log/busy reset');
  assert.match(CLONE, /requestAnimationFrame\(\(\) => urlRef\.current\?\.focus\(\)\)/, 'focus queued after Modal');
  assert.match(CLONE, /<input ref=\{urlRef\} className="input font-code"/, 'real ref target (TextInput does not forward refs)');
});

test('CL1: a thrown clone IPC error is caught and busy is always released', () => {
  assert.match(CLONE, /try \{[\s\S]{0,900}const res = await cloneRepo\(\{/, 'cloneRepo is guarded');
  assert.match(CLONE, /\} catch \{[\s\S]{0,160}setError\(cloneFailed\)[\s\S]{0,80}\} finally \{[\s\S]{0,160}setBusy\(false\)/);
});

test('CL1: clone hints speak Arabic in the Arabic UI', () => {
  assert.match(CLONE, /cl\.needFields', lang === 'ar' \? 'أضف رابط المستودع ومجلد الوجهة أولاً\.'/);
  assert.match(CLONE, /cl\.needUrl', lang === 'ar' \? 'الصق رابط المستودع للمتابعة\.'/);
  assert.match(CLONE, /cl\.needDest', lang === 'ar' \?/);
});

test('NP1: Arabic / Unicode project names produce a valid slug (not an empty one)', () => {
  assert.match(WIZARD, /replace\(\/\[\^\\p\{L\}\\p\{N\}\\-_ \]\/gu, ''\)/, 'slug keeps Unicode letters');
  assert.doesNotMatch(WIZARD, /replace\(\/\[\^a-z0-9-_ \]\/g, ''\)/, 'ASCII-only filter removed');
});

test('NP1: create errors are localized prose + a dir="ltr" machine detail', () => {
  assert.match(WIZARD, /useState<\{ text: string; detail\?: string \} \| null>\(null\)/);
  assert.match(WIZARD, /np\.createFailed', lang === 'ar' \? 'تعذّر إنشاء المجلد'/);
  assert.match(WIZARD, /font-code text-\[10px\] opacity-70 block mt-0\.5 break-all" dir="ltr"/, 'raw FS message is machine text');
});

// ------------------------------------------------------------
// 6 · MODEL PICKER & CLARIFICATION — focus, bilingual, no double action
// ------------------------------------------------------------
test('MP1: reasoning levels + search focus are localized / reliable', () => {
  assert.match(PICKER, /const REASON_LABEL: Record<'off' \| 'low' \| 'medium' \| 'high', \[string, string\]>/);
  assert.match(PICKER, /off: \['off', 'إيقاف'\]/);
  assert.match(PICKER, /high: \['high', 'مرتفع'\]/);
  assert.match(PICKER, /t\('mp\.reasoning\.' \+ lv, REASON_LABEL\[lv\]\[lang === 'ar' \? 1 : 0\]\)/);
  assert.match(PICKER, /requestAnimationFrame\(\(\) => searchRef\.current\?\.focus\(\)\)/);
});

test('MP1: Enter on a focused model row does not pick twice', () => {
  assert.match(PICKER, /\(e\.target as HTMLElement \| null\)\?\.tagName === 'BUTTON'\) return;/, 'native click owns row selection');
});

test('CF1: Enter on Skip/Confirm is not double-submitted; option Enter still confirms', () => {
  assert.ok(
    CLARIF.includes("e.key === 'Enter' && target?.closest?.('.clarif-actions')) return;"),
    'action buttons exempt',
  );
  assert.match(CLARIF, /e\.preventDefault\(\); \/\/ Enter always confirms \(also from the Other field\)/, 'radios/Other still confirm');
});

// ---------- ClarificationCard: real bundle + SSR (semantics still intact) ----------
const buildDir = mkdtempSync(join(ROOT, 'tests', '.v1131-clarif-'));
const bundleOut = join(buildDir, 'clarif.cjs');
execFileSync(
  ESBUILD_NODE,
  [
    ESBUILD_BIN,
    join(ROOT, 'src', 'components', 'ClarificationCard.tsx'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${bundleOut}`,
    '--loader:.css=empty',
    '--external:react',
    '--external:react/jsx-runtime',
  ],
  { cwd: ROOT, stdio: 'pipe' },
);
const clarif = require(bundleOut);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('CF2: ClarificationCard still SSR-renders AR/rtl semantics after the guard fix', () => {
  const html = renderToStaticMarkup(React.createElement(clarif.ClarificationCard, {
    question: { en: 'Which stack?', ar: 'أي تقنية؟' },
    lang: 'ar',
    options: [
      { value: 'a', label: 'React', description: 'سريع' },
      { value: 'b', label: 'Next' },
    ],
    onDismiss: () => {},
    onAnswer: () => {},
  }));
  assert.match(html, /dir="rtl"/);
  assert.match(html, /أي تقنية\؟/);
  assert.match(html, /تأكيد/, 'default confirm is Arabic');
  assert.match(html, /تخطي/, 'default skip is Arabic');
  assert.equal((html.match(/role="radio"/g) || []).length, 2);
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 1);
});

test('CF2: pure helpers keep their precise selection contract', () => {
  const { localize, itemCount, clampSelection, navIndex, digitToIndex, resolveAnswer } = clarif;
  assert.equal(localize({ en: 'OK', ar: 'حسناً' }, 'ar'), 'حسناً');
  assert.equal(itemCount([1, 2, 3], true), 4);
  assert.equal(clampSelection(99, 4), 3);
  assert.equal(navIndex(0, -1, 4), 3);
  assert.equal(digitToIndex('3', 3), 2);
  assert.equal(digitToIndex('4', 3), -1);
  assert.equal(resolveAnswer([{ value: 'x' }], 0, '', true), 'x');
  assert.equal(resolveAnswer([{ value: 'x' }], 1, '  ', true), null);
});

test.after(() => {
  try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* best effort */ }
});
