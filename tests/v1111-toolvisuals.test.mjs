import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.11 — TOOL VISUALS test suite (Task wave3-A2): the founder's demand —
// "تصميم لكل أداة" — every tool the AI uses wears its OWN distinctive card
// design, with animation. Each family pinned by a test:
//
//   1. FAMILY CLASSIFIER — lib/toolGrouping.ts maps every tool to exactly
//      one visual family (write/edit/read/bash/browser/mcp/think/other).
//   2. STACK GROUPER — consecutive same-tool calls group with an ×N counter;
//      a different tool (or a narration gap) breaks the run.
//   3. FAMILY SKINS — per-family CSS classes (.tv-write/.tv-edit/.tv-read/
//      .tv-bash/.tv-browser/.tv-mcp + neutral .tv-other) exist in chat.css
//      and are wired from ToolCallCard.
//   4. EDIT MINI-VIEW — the inline diff reuses DiffView (add/del tints,
//      height-clamped with expand).
//   5. RUNLINE — the slim indeterminate progress line sits UNDER the header,
//      replaces the old top scan bar in tool cards, unmounts on completion.
//   6. MOTION LAW — the new CSS animates transform/opacity ONLY, honors
//      prefers-reduced-motion + the app-level reduce-motion switch, and
//      mounts at 160ms.
//   7. TOKEN LAW — zero hex in the new section; hues ride --tvf-*/--v-*
//      tokens (both themes adapt).
//   8. RTL LAW — logical properties only in the new section; chips isolate
//      their LTR content so filename/URL/server truncation behaves in RTL.
//   9. TIMELINE SYNC — StreamTimeline's WORK node wears the READ family
//      glyph (FileText); the THINK band keeps the SADEEM brand mark.
//
// Harness: esbuild TS→CJS bundle of the pure lib (same posture as
// v1111-stream-ui) + source assertions on the renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1111-toolvisuals-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

const libPath = join(tmp, 'toolGrouping.cjs');
bundle('src/lib/toolGrouping.ts', libPath);
const tg = require(libPath);

const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const messageView = src('src/components/MessageView.tsx');
const streamTimeline = src('src/components/StreamTimeline.tsx');
const chatCss = src('src/components/chat.css');

// the wave3-A2 section — everything NEW this wave lives between the markers
const SECTION_START = chatCss.indexOf('[wave3-A2-start]');
const SECTION_END = chatCss.indexOf('[wave3-A2-end]');
assert.ok(SECTION_START > 0 && SECTION_END > SECTION_START, 'the wave3-A2 CSS section is marked');
const section = chatCss.slice(SECTION_START, SECTION_END);

// ============================================================
// 1 · Family classifier — one family per tool, mcp by prefix
// ============================================================
test('toolFamilyOf maps every tool family exactly (mcp by prefix, unknown → other)', () => {
  // write — creation
  assert.equal(tg.toolFamilyOf('write_file'), 'write');
  assert.equal(tg.toolFamilyOf('image_generate'), 'write');
  assert.equal(tg.toolFamilyOf('download'), 'write');
  // edit — mutation
  assert.equal(tg.toolFamilyOf('edit_file'), 'edit');
  assert.equal(tg.toolFamilyOf('multi_edit'), 'edit');
  assert.equal(tg.toolFamilyOf('str_replace'), 'edit');
  // read — perception (reads AND searches share the cool family)
  assert.equal(tg.toolFamilyOf('read_file'), 'read');
  assert.equal(tg.toolFamilyOf('list_dir'), 'read');
  assert.equal(tg.toolFamilyOf('search_files'), 'read');
  assert.equal(tg.toolFamilyOf('code_search'), 'read');
  assert.equal(tg.toolFamilyOf('web_search'), 'read');
  assert.equal(tg.toolFamilyOf('grep'), 'read');
  // bash — terminal work
  assert.equal(tg.toolFamilyOf('run_command'), 'bash');
  assert.equal(tg.toolFamilyOf('run_background'), 'bash');
  assert.equal(tg.toolFamilyOf('process_output'), 'bash');
  assert.equal(tg.toolFamilyOf('test_run'), 'bash');
  assert.equal(tg.toolFamilyOf('lint_check'), 'bash');
  assert.equal(tg.toolFamilyOf('debug_step'), 'bash');
  // browser — URL surface
  assert.equal(tg.toolFamilyOf('browser_navigate'), 'browser');
  assert.equal(tg.toolFamilyOf('browser_screenshot'), 'browser');
  assert.equal(tg.toolFamilyOf('browser_click'), 'browser');
  assert.equal(tg.toolFamilyOf('web_fetch'), 'browser');
  assert.equal(tg.toolFamilyOf('preview_screenshot'), 'browser');
  // mcp — prefix wins over any exact match
  assert.equal(tg.toolFamilyOf('mcp__github__create_issue'), 'mcp');
  assert.equal(tg.toolFamilyOf('mcp__x'), 'mcp');
  // think — untouched violet coding
  assert.equal(tg.toolFamilyOf('todo_write'), 'think');
  assert.equal(tg.toolFamilyOf('task'), 'think');
  assert.equal(tg.toolFamilyOf('use_skill'), 'think');
  // unknown / missing → neutral other
  assert.equal(tg.toolFamilyOf('totally_new_tool'), 'other');
  assert.equal(tg.toolFamilyOf(undefined), 'other');
  assert.equal(tg.toolFamilyOf(''), 'other');
});

// ============================================================
// 2 · Stack grouper — consecutive same-tool runs, ×N counter
// ============================================================
test('toolRunOrdinal groups consecutive same-tool runs; anything else breaks the run', () => {
  const run = (...keys) => {
    const ords = [];
    const hist = [];
    for (const k of keys) {
      ords.push(tg.toolRunOrdinal(hist, k));
      hist.push(k);
    }
    return ords;
  };
  // read_file ×3 → heads at 1, continuations count up
  assert.deepEqual(run('read', 'read', 'read'), [1, 2, 3]);
  // a different tool breaks the run
  assert.deepEqual(run('read', 'read', 'edit', 'read'), [1, 2, 1, 1]);
  // narration gaps (undefined) break too — cards never merge across prose
  assert.deepEqual(run('read', undefined, 'read'), [1, 1, 1]);
  assert.deepEqual(run('bash', null, 'bash'), [1, 1, 1]);
  // a long run keeps counting
  assert.deepEqual(run('browser', 'browser', 'browser', 'browser', 'browser'), [1, 2, 3, 4, 5]);
  // mixed interleaving stays exact
  assert.deepEqual(run('mcp', 'mcp', 'write', 'write', 'mcp'), [1, 2, 1, 2, 1]);
  // empty history = run head
  assert.equal(tg.toolRunOrdinal([], 'read'), 1);
});

// ============================================================
// 3 · Family skins — per-family classes in CSS, wired in the card
// ============================================================
test('per-family CSS classes exist in chat.css and ride token hues', () => {
  for (const fam of ['write', 'edit', 'read', 'bash', 'browser', 'mcp', 'other']) {
    assert.ok(chatCss.includes(`.tl2-card.tv-${fam}`), `.tl2-card.tv-${fam} exists in chat.css`);
  }
  // the card emits the family class + data attribute + family hue
  assert.ok(messageView.includes('`tv-${fam}`'), 'ToolCallCard emits the tv-<family> skin class');
  assert.ok(messageView.includes('data-tvfam={fam}'), 'cards carry data-tvfam for sibling-run scans');
  assert.ok(messageView.includes('--tvf-write'), 'family hues come from the --tvf-* token set');
  // all seven token vars defined in the new section
  for (const v of ['--tvf-write', '--tvf-edit', '--tvf-read', '--tvf-bash', '--tvf-browser', '--tvf-mcp', '--tvf-other']) {
    assert.ok(section.includes(`${v}:`), `${v} token defined`);
  }
});

test('family identities: rail, terminal strip, sheen, chips, receipts, thumbnail', () => {
  // write/edit — accent left-rail (logical inset → mirrors in RTL)
  assert.ok(section.includes('.tl2-card.tv-write::before'), 'write rail');
  assert.ok(section.includes('.tl2-card.tv-edit::before'), 'edit rail');
  // bash — dark terminal strip + $ prompt glyph + EXIT badge
  assert.ok(section.includes('.tl2-card.tv-bash'), 'terminal strip');
  assert.match(section, /\.tv-bash \.sc18-targ::before\s*\{\s*content: '\$ '/, '$ prompt glyph');
  assert.ok(section.includes('.tv-exit.is-ok') && section.includes('.tv-exit.is-bad'), 'exit-code badge tones');
  // read — one-shot scanned sheen on the icon chip
  assert.ok(section.includes('.tv-read .sc18-tico::after'), 'scanned sheen');
  assert.ok(section.includes('tv-sheen 0.9s'), 'sheen plays ONCE (not infinite)');
  // chips — filename / URL host / MCP server (shared .tv-chip)
  assert.ok(section.includes('.tv-chip'), 'family chip');
  assert.ok(messageView.includes('className="tv-chip"'), 'card renders the family chip');
  // receipts — size badge, lines/hits count, thumbnail
  assert.ok(section.includes('.tv-badge'), 'size/count badge');
  assert.ok(messageView.includes('readCountOf'), 'read-family receipt counter');
  assert.ok(messageView.includes("'hits' : 'lines'"), 'search results count hits, file reads count lines');
  assert.ok(section.includes('.tv-shot'), 'screenshot thumbnail');
});

// ============================================================
// 4 · The EDIT mini-view — inline diff, reused DiffView
// ============================================================
test('edit cards reuse DiffView (red/green tinted, height-clamped with expand)', () => {
  assert.ok(messageView.includes('<DiffView'), 'DiffView rendered inside the tool card drawer');
  assert.ok(messageView.includes('diffInputsFromToolArgs'), 'diff inputs normalized from tool args');
  // the diff tints + clamp/expand grammar exist (chat.css v10.2 section)
  assert.ok(chatCss.includes('.diffv-add'), 'added lines tinted');
  assert.ok(chatCss.includes('.diffv-del'), 'removed lines tinted');
  assert.ok(chatCss.includes('--diff-add-bg') && chatCss.includes('--diff-del-bg'), 'tints ride the theme-safe diff tokens');
  assert.ok(chatCss.includes('.diffv-more'), 'clamped diff expands (Show all changes)');
});

// ============================================================
// 5 · The runline — slim progress UNDER the header, gone on completion
// ============================================================
test('running cards show the under-header runline; the top scan bar is retired from tool cards', () => {
  assert.ok(messageView.includes('{!result && <span className="tv-runline"'), 'runline mounts only while running (unmounts when done)');
  assert.ok(section.includes('.tv-runline'), 'runline CSS shipped');
  // the top scan bar is retired everywhere — no tool card uses tl2-scan
  const scanHits = messageView.split('tl2-scan').length - 1;
  assert.equal(scanHits, 0, `tl2-scan retired from all cards (found ${scanHits})`);
});

// ============================================================
// 6 · Merged stack — the ×N counter chip + tight stack CSS
// ============================================================
test('consecutive same-tool cards merge: stack chip, collapsed seams, DOM scan', () => {
  assert.ok(messageView.includes('toolRunOrdinal'), 'the card consumes the unit-tested grouper');
  assert.ok(messageView.includes('useLayoutEffect'), 'run position scanned after DOM commit');
  assert.ok(messageView.includes('tv-stack'), 'the ×N counter chip renders');
  assert.ok(messageView.includes('×{n(stackOrdinal)}'), 'counter reads the run ordinal');
  assert.ok(section.includes('.tv-stack'), 'stack chip CSS');
  assert.ok(section.includes('.tv-stacked'), 'wrapper tightens the band gap');
  assert.ok(section.includes('.tl2-card.is-stacked'), 'stacked card flattens its top seam');
  assert.match(section, /margin-block-start:\s*-7px/, 'the 10px gap collapses to a ~3px seam');
});

// ============================================================
// 7 · Motion law — transform/opacity only + reduced-motion honored
// ============================================================
/** Brace-matched extraction of @keyframes tv-* bodies (per-cent blocks are
 *  nested braces — a flat regex would miss them). */
function keyframesOf(css) {
  const out = [];
  const re = /@keyframes\s+(tv-[\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ name: m[1], body: css.slice(re.lastIndex, i - 1) });
  }
  return out;
}

test('new CSS animates ONLY transform/opacity (no layout properties)', () => {
  // every @keyframes in the wave3-A2 section declares transform/opacity only
  const kfs = keyframesOf(section);
  assert.ok(kfs.length >= 3, `tv-sheen/tv-sweep/tv-sweep-rtl keyframes parsed (got ${kfs.length})`);
  for (const { name, body } of kfs) {
    for (const m of body.matchAll(/([a-z-]+)\s*:/g)) {
      assert.ok(
        m[1] === 'transform' || m[1] === 'opacity',
        `@keyframes ${name} animates only transform/opacity (found: ${m[1]})`,
      );
    }
  }
  // every animation reference names one of those keyframes (or none)
  for (const m of section.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
    const name = m[1].trim().split(/\s+/)[0];
    assert.ok(
      ['tv-sheen', 'tv-sweep', 'tv-sweep-rtl', 'none'].includes(name),
      `animation references a transform-based keyframe (found: ${name})`,
    );
  }
  // no transition in the new section animates a layout property
  for (const m of section.matchAll(/transition\s*:\s*([^;]+);/g)) {
    assert.ok(!/\b(width|height|margin|padding|top|left|right|bottom|inset)\b/.test(m[1]), 'transitions never touch layout');
  }
});

test('motion gates: prefers-reduced-motion + app-level reduce-motion freeze the new animations', () => {
  const rmAt = section.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(rmAt >= 0, 'reduced-motion block present');
  // brace-match the whole @media block (nesting-aware)
  let depth = 0;
  let rmEnd = rmAt;
  for (let i = section.indexOf('{', rmAt); i < section.length; i++) {
    if (section[i] === '{') depth++;
    else if (section[i] === '}') {
      depth--;
      if (depth === 0) {
        rmEnd = i + 1;
        break;
      }
    }
  }
  const rmBlock = section.slice(rmAt, rmEnd);
  assert.ok(rmBlock.includes('.tv-runline::before'), 'runline sweep frozen under reduced motion');
  assert.ok(rmBlock.includes('animation: none'), 'animations set to none');
  assert.ok(rmBlock.includes('transform: none'), 'the parked runline stays visible (static bar)');
  assert.ok(section.includes('html.reduce-motion .tv-runline::before'), 'app-level reduce-motion freezes the runline');
  assert.ok(section.includes('html.reduce-motion .tv-read .sc18-tico::after'), 'app-level reduce-motion freezes the sheen');
  // the 160ms card mount is intact and transform/opacity-based
  assert.ok(chatCss.includes('sc18-card-in 0.16s'), 'cards mount at 160ms');
  const mountAt = chatCss.indexOf('@keyframes sc18-card-in');
  const mountBody = chatCss.slice(mountAt, chatCss.indexOf('}', mountAt));
  assert.ok(/transform|opacity/.test(mountBody), 'mount animation is fade+slide (transform/opacity)');
});

// ============================================================
// 8 · Token + RTL law — zero hex, logical properties, isolated chips
// ============================================================
test('token law: no hardcoded hex in the new section — hues ride --tvf-*/--v-* vars', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), 'zero hex literals in the wave3-A2 CSS section');
  assert.ok(messageView.includes('var(--tvf-'), 'the card consumes the --tvf-* family tokens');
  assert.ok(section.includes('color-mix(in srgb'), 'derivatives mix tokens, not literals');
});

test('RTL law: logical properties only — no physical left/right in the new section', () => {
  assert.ok(!/(margin|padding|inset|border)-(left|right)\b/.test(section), 'no physical margin/padding/inset/border sides');
  assert.ok(!/(^|[^-\w])(left|right)\s*:/.test(section), 'no physical left:/right: declarations');
  assert.ok(section.includes('inset-inline-start'), 'positional work uses inset-inline-*');
  assert.ok(section.includes('margin-block-start'), 'spacing uses margin-block-*');
  assert.ok(section.includes('border-block-start-color'), 'borders use block-start/end sides');
  // chips keep LTR content (filenames, hosts, server names) isolated so
  // truncation is stable in RTL
  assert.match(section, /\.tv-chip-txt\s*\{[^}]*unicode-bidi:\s*isolate/, 'chip text isolates LTR content');
  assert.match(section, /\.tv-stack\s*\{[^}]*unicode-bidi:\s*isolate/, 'stack counter isolates too');
  assert.ok(messageView.includes("<span className=\"tv-chip-txt\" dir=\"ltr\">"), 'chip text hard-LTR');
});

// ============================================================
// 9 · Timeline sync + status glyphs + collapsed default
// ============================================================
test('StreamTimeline WORK node wears the READ family glyph; THINK wears the spinning circle', () => {
  assert.ok(streamTimeline.includes('icon: FileText'), 'WORK band node = read_file family glyph');
  // v11.23 — the founder demanded the app-logo brand mark beside THINK be
  // REPLACED by the precise spinning circle. These old assertions expected it.
  assert.ok(!streamTimeline.includes('brand: true'), 'no brand treatment on THINK');
  assert.ok(!streamTimeline.includes("import { Logo } from './Logo'"), 'no app-logo import');
  assert.ok(streamTimeline.includes('ThinkOrbit'), 'the spinning circle owns the THINK band');
  assert.ok(!/<Brain/.test(streamTimeline), 'no Brain glyph in StreamTimeline');
  assert.ok(streamTimeline.includes('toolGrouping'), 'the family grammar is cross-referenced');
});

test('status glyph grammar: spinner → check → ×, collapsed by default', () => {
  const pillAt = messageView.indexOf('function StatusPill');
  const pill = messageView.slice(pillAt, pillAt + 1600);
  assert.ok(pill.includes('<Spinner size={8} />'), 'running → spinner');
  assert.ok(pill.includes('<Check size={9}'), 'done → check');
  assert.ok(pill.includes('<X size={8}'), 'error → ×');
  assert.ok(messageView.includes('COLLAPSED by default for every family'), 'cards collapsed by default');
  assert.ok(messageView.includes('useState(false)'), 'expanded state starts false');
});
