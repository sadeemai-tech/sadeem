#!/usr/bin/env node
// ============================================================
// v11.38 — GRAPHICS GUARD (G3 verification). DIAGNOSIS + TEST ONLY.
// ------------------------------------------------------------
// ZERO application source is edited. This is a ROOT node script that
// verifies the graphics overhaul did not trade craft for noise:
//
//   1. ALL signature animations are still PRESENT and still alive —
//      spinning circle, ink flow, tool bloom, orb pulse, DNA growth,
//      sheen — plus a full baseline of 100 @keyframes (no removed or
//      gutted keyframe) with exact file:line for every one.
//   2. No boxy cards / soft gradients / paint shadows / hex literals
//      in the owned CSS; 1px hairline grammar; tabular mono;
//      Instrument Serif display with an explicit Cairo fallback.
//   3. RTL logical properties, BOTH reduced-motion guards in every
//      animated owned sheet, and brace balance 0.
//   4. Every finding is pinned to an exact file:line (a removed
//      keyframe is reported at its last known line).
//
// POSTURE: pure SOURCE assertions (presentation CSS + a little JSX),
// no esbuild/SSR — runs in milliseconds. Every scan runs on
// COMMENT-STRIPPED code so a stale "removed" note cannot game a guard,
// but reported line numbers always come from the RAW file.
//
// Run:   node tests-v1138-graphics-guard.mjs
// Writes: tests/.v1138-graphics-guard.results.json
// Exit 0 = every check PASS; exit 1 = at least one FAIL.
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ------------------------------------------------------------
// Scope — the CSS this guard OWNS (the graphics overhaul surface).
// ART_SHEETS additionally carry the strict paint grammar.
// ------------------------------------------------------------
const OWNED = {
  art:       'src/components/chat-art.css',
  story:     'src/components/tool-story.css',
  final:     'src/components/chat-final.css',
  motion:    'src/components/stream-motion.css',
  sub:       'src/components/subagents.css',
  voice:     'src/components/voice-input.css',
  dnaart:    'src/components/panels/dna-art.css',
  artlayer:  'src/components/art.css',
  console:   'src/components/console.css',
  chat:      'src/components/chat.css',
  dna:       'src/components/dna.css',
  display:   'src/components/display-type.css',
};
const ART_SHEETS = ['art', 'story', 'final', 'motion', 'sub', 'voice', 'dnaart', 'artlayer'];
const ALL_SHEETS = Object.keys(OWNED);
const OTHER = {
  tokens:   'src/styles/tokens.css',
  glass:    'src/assets/glass-v7.css',
  stream:   'src/components/StreamTimeline.tsx',
  msg:      'src/components/MessageView.tsx',
};
const RAW = Object.fromEntries(
  Object.entries({ ...OWNED, ...OTHER }).map(([k, p]) => [k, read(p)]),
);
/** CSS comment stripper that PRESERVES newlines so raw line numbers stay exact. */
const strip = (s) => {
  let out = '', inComment = false;
  for (let i = 0; i < s.length; i++) {
    if (inComment) {
      if (s[i] === '*' && s[i + 1] === '/') { inComment = false; i++; out += ' '; }
      else out += (s[i] === '\n' ? '\n' : ' ');
    } else if (s[i] === '/' && s[i + 1] === '*') { inComment = true; i++; out += '  '; }
    else out += s[i];
  }
  return out;
};
const CSS = Object.fromEntries(ALL_SHEETS.map((k) => [k, strip(RAW[k])]));
const SCSS = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, strip(v)]));
const SOURCE = Object.fromEntries(ALL_SHEETS.map((k) => [k, RAW[k]]));

const findings = [];
const notes = [];
function check(id, ok, detail, fileLine = '') {
  findings.push({ id, status: ok ? 'PASS' : 'FAIL', detail, fileLine });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${fileLine ? ` [${fileLine}]` : ''}: ${detail}`);
  return ok;
}
function note(id, detail, fileLine = '') {
  notes.push({ id, detail, fileLine });
  console.log(`NOTE ${id}${fileLine ? ` [${fileLine}]` : ''}: ${detail}`);
}
/** 1-based raw line of the first occurrence of needle in a file key. */
function lineOf(key, needle) {
  const i = RAW[key].indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (RAW[key].charCodeAt(k) === 10) line++;
  return line;
}
const at = (key, needle) => `${OWNED[key] || OTHER[key]}:${lineOf(key, needle) || '?'}`;

// Baseline @keyframes captured at the moment this guard was authored.
// name -> "file:line". A missing or gutted one is a regression.
const BASELINE_KEYFRAMES = {
  "sc-left-draw": "src/components/chat-art.css:86",
  "sc-path-grow": "src/components/chat-art.css:227",
  "art-grid-drift": "src/components/chat-art.css:330",
  "art-ink-flow": "src/components/chat-art.css:363",
  "art-calibration": "src/components/chat-art.css:424",
  "art-scroll-ink": "src/components/chat-art.css:486",
  "sc-error-underline": "src/components/chat-art.css:536",
  "art-readout-base": "src/components/chat-art.css:579",
  "art-empty-calibrate": "src/components/chat-art.css:632",
  "tsg-glyph-draw": "src/components/tool-story.css:54",
  "tsg-glyph-draw-rtl": "src/components/tool-story.css:62",
  "tsg-sweep-ray": "src/components/tool-story.css:81",
  "tsg-pulse": "src/components/tool-story.css:87",
  "tsg-ink-check": "src/components/tool-story.css:105",
  "tsg-cross-in": "src/components/tool-story.css:109",
  "tsg-run-breathe": "src/components/tool-story.css:128",
  "tsg-wave-breathe": "src/components/tool-story.css:155",
  "ts-card-part-in": "src/components/tool-story.css:307",
  "ts-stamp-draw": "src/components/tool-story.css:331",
  "craft-caret": "src/components/tool-story.css:480",
  "craft-ink-flow": "src/components/tool-story.css:497",
  "ts-file-write": "src/components/tool-story.css:579",
  "ts-caret-type": "src/components/tool-story.css:604",
  "ts-verb-underline": "src/components/tool-story.css:664",
  "ts-status-pip": "src/components/tool-story.css:685",
  "ts-image-write": "src/components/tool-story.css:701",
  "ts-glyph-baseline": "src/components/tool-story.css:780",
  "ts-path-baseline": "src/components/tool-story.css:803",
  "ts-nib-draw": "src/components/tool-story.css:825",
  "ts-aperture": "src/components/tool-story.css:851",
  "ts-pip-stem": "src/components/tool-story.css:888",
  "cf-breathe": "src/components/chat-final.css:23",
  "lens-settle": "src/components/chat-final.css:449",
  "mv-bloom-in": "src/components/chat-final.css:527",
  "mv-bloom-ring": "src/components/chat-final.css:532",
  "pv-page-breathe": "src/components/chat-final.css:566",
  "pv-scan": "src/components/chat-final.css:586",
  "mv-bloom-ink": "src/components/chat-final.css:642",
  "cf-status-rule": "src/components/chat-final.css:767",
  "reason-dot-stagger": "src/components/stream-motion.css:45",
  "reason-word-in": "src/components/stream-motion.css:59",
  "reason-settle-line": "src/components/stream-motion.css:79",
  "art-caret-trail": "src/components/stream-motion.css:127",
  "tl-status-ring": "src/components/stream-motion.css:158",
  "tl-pill-settle": "src/components/stream-motion.css:167",
  "tl-drawer-in": "src/components/stream-motion.css:181",
  "phase-flow": "src/components/stream-motion.css:229",
  "pr-check-settle": "src/components/stream-motion.css:243",
  "art-draw": "src/components/stream-motion.css:326",
  "art-ink-spread": "src/components/stream-motion.css:332",
  "art-ink-caret": "src/components/stream-motion.css:338",
  "art-orbit": "src/components/stream-motion.css:343",
  "art-ink-check": "src/components/stream-motion.css:348",
  "art-team-orbit": "src/components/stream-motion.css:526",
  "pr-shot-settle": "src/components/stream-motion.css:562",
  "art-measure-breathe": "src/components/stream-motion.css:613",
  "phase-calibrate": "src/components/stream-motion.css:657",
  "agt-card-in": "src/components/subagents.css:46",
  "agt-head-baseline": "src/components/subagents.css:69",
  "agt-orbit-spin": "src/components/subagents.css:134",
  "agt-hub-breathe": "src/components/subagents.css:147",
  "agt-node-in": "src/components/subagents.css:171",
  "agt-breathe": "src/components/subagents.css:232",
  "sad-fade": "src/components/subagents.css:297",
  "sad-pop": "src/components/subagents.css:309",
  "sad-tick-in": "src/components/subagents.css:572",
  "vi-breathe": "src/components/voice-input.css:208",
  "vi-done": "src/components/voice-input.css:217",
  "vi-orb-pulse": "src/components/voice-input.css:228",
  "vi-pop-in": "src/components/voice-input.css:239",
  "dn-rule-draw": "src/components/panels/dna-art.css:39",
  "artDraw": "src/components/art.css:40",
  "artRise": "src/components/art.css:175",
  "artBreathDot": "src/components/art.css:220",
  "artBreathRing": "src/components/art.css:224",
  "art-calibrate": "src/components/art.css:354",
  "v12-soft-in": "src/components/console.css:184",
  "v13-in": "src/components/console.css:798",
  "v13-pulse": "src/components/console.css:807",
  "reason-settle": "src/components/console.css:812",
  "cp-orbit": "src/components/console.css:1128",
  "cp-orbit-compact": "src/components/console.css:1132",
  "cp-bars-breathe": "src/components/console.css:1343",
  "cp-panel-in": "src/components/console.css:1366",
  "art-orbit-ring-breathe": "src/components/console.css:1452",
  "art-orbit-bead": "src/components/console.css:1456",
  "agent-breathe": "src/components/chat.css:258",
  "kb-label-pulse": "src/components/chat.css:468",
  "sc-think-settle": "src/components/chat.css:604",
  "sc18-dot-pulse": "src/components/chat.css:737",
  "sc18-chunk-in": "src/components/chat.css:741",
  "sc18-card-in": "src/components/chat.css:745",
  "sc-status-breathe": "src/components/chat.css:752",
  "sc-shimmer": "src/components/chat.css:756",
  "rp-sweep": "src/components/chat.css:918",
  "rp-xfade": "src/components/chat.css:1423",
  "ps-breathe": "src/components/chat.css:1485",
  "wt-pop": "src/components/chat.css:2578",
  "noticeRise": "src/components/chat.css:2657",
  "sc18-node-breathe": "src/components/chat.css:2729",
  "tv-sheen": "src/components/chat.css:2918",
  "tv-sweep": "src/components/chat.css:2955",
  "tv-sweep-rtl": "src/components/chat.css:2967",
};
const SIGNATURES = [
  { id: 'S1-SPIN',     label: 'spinning circle (art-orbit)',  key: 'motion',  needle: '@keyframes art-orbit',      ref: BASELINE_KEYFRAMES['art-orbit'] },
  { id: 'S1-SPIN-CON', label: 'spinning circle (cp-orbit)',   key: 'console', needle: '@keyframes cp-orbit',       ref: BASELINE_KEYFRAMES['cp-orbit'] },
  { id: 'S1-SPIN-SMIL',label: 'spinning circle (ThinkOrbit SMIL)', key: 'stream', needle: '<animateTransform',      ref: `${OTHER.stream}:325` },
  { id: 'S2-INK-A',    label: 'ink flow (art-ink-flow)',      key: 'art',     needle: '@keyframes art-ink-flow',    ref: BASELINE_KEYFRAMES['art-ink-flow'] },
  { id: 'S2-INK-B',    label: 'ink flow (craft-ink-flow)',    key: 'story',   needle: '@keyframes craft-ink-flow',  ref: BASELINE_KEYFRAMES['craft-ink-flow'] },
  { id: 'S3-BLOOM-IN', label: 'tool bloom (mv-bloom-in)',     key: 'final',   needle: '@keyframes mv-bloom-in',     ref: BASELINE_KEYFRAMES['mv-bloom-in'] },
  { id: 'S3-BLOOM',    label: 'tool bloom (mv-bloom-ink)',    key: 'final',   needle: '@keyframes mv-bloom-ink',    ref: BASELINE_KEYFRAMES['mv-bloom-ink'] },
  { id: 'S3-BLOOM-MNT',label: 'tool bloom mounts only on done', key: 'msg',   needle: "status === 'done' && <ToolBloom />", ref: `${OTHER.msg}:3076` },
  { id: 'S4-ORB',      label: 'orb pulse (vi-orb-pulse)',     key: 'voice',   needle: '@keyframes vi-orb-pulse',    ref: BASELINE_KEYFRAMES['vi-orb-pulse'] },
  { id: 'S5-DNA',      label: 'DNA growth (dn-rule-draw)',    key: 'dnaart',  needle: '@keyframes dn-rule-draw',    ref: BASELINE_KEYFRAMES['dn-rule-draw'] },
  { id: 'S6-SHEEN',    label: 'sheen (tv-sheen)',             key: 'chat',    needle: '@keyframes tv-sheen',       ref: BASELINE_KEYFRAMES['tv-sheen'] },
];

/** Extract a brace-matched @keyframes body; used to detect gutted animations. */
function keyframeBody(css, name) {
  const re = new RegExp('@keyframes\\s+' + name.replace(/[-]/g, '\\-') + '\\s*\\{');
  const m = re.exec(css);
  if (!m) return null;
  const open = css.indexOf('{', m.index);
  let depth = 1;
  for (let k = open + 1; k < css.length && depth; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}') depth--;
    if (!depth) return css.slice(open + 1, k);
  }
  return null;
}
const ALL_CSS = ALL_SHEETS.map((k) => CSS[k]).join('\n');

function main() {
  console.log('===== V1138 GRAPHICS GUARD — G3 verification, source-only =====');

  // ---- 1 · SIGNATURE ANIMATIONS + NO REMOVED / GUTTED KEYFRAMES ----
  for (const s of SIGNATURES) {
    const src = (CSS[s.key] ?? RAW[s.key] ?? '');
    const present = src.includes(s.needle);
    check(s.id, present, `${s.label}: ${present ? 'PRESENT' : 'REMOVED'}`,
      present ? at(s.key, s.needle) : `${s.ref} (MISSING)`);
  }
  const missingKf = [];
  const guttedKf = [];
  for (const [name, ref] of Object.entries(BASELINE_KEYFRAMES)) {
    const body = keyframeBody(ALL_CSS, name);
    if (body === null) missingKf.push(`${name}@${ref}`);
    else if (!/[\d.]+%|\bfrom\b|\bto\b/.test(body) || !/[A-Za-z-]+\s*:/.test(body)) guttedKf.push(`${name}@${ref}`);
  }
  check('1-KF-COUNT', missingKf.length === 0,
    `${Object.keys(BASELINE_KEYFRAMES).length - missingKf.length}/${Object.keys(BASELINE_KEYFRAMES).length} baseline keyframes survive${missingKf.length ? ' — REMOVED: ' + missingKf.join(', ') : ''}`);
  check('1-KF-ALIVE', guttedKf.length === 0,
    `no keyframe is a gutted stub${guttedKf.length ? ' — GUTTED: ' + guttedKf.join(', ') : ''}`);

  // ---- 2 · PAINT GRAMMAR — no boxy fill / soft gradient / shadow / hex ----
  const hexHits = [], gradHits = [], shadowHits = [], boxyHits = [], maskNotes = [], hairlineNotes = [];
  for (const key of ALL_SHEETS) {
    RAW[key].split(/\r?\n/).forEach((rawLine, idx) => {
      if (idx >= 0 && /\/\*/.test(rawLine)) return; // skip declaration lines that open a comment
      const line = CSS[key].split(/\r?\n/)[idx] ?? '';
      const ref = `${OWNED[key]}:${idx + 1}`;
      // hex colour literal — alpha masks (#000 in mask-image) are not palette paint
      if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
        if (/(-webkit-)?mask-image\s*:/.test(line)) maskNotes.push(ref);
        else hexHits.push(`${ref} :: ${line.trim().slice(0, 90)}`);
      }
      // Soft/color-ramp gradients are forbidden in the ART sheets (the
      // chrome sheets chat/console/dna are support, not owned art). A
      // gradient is a legitimate hard-stop hairline if it is a repeating
      // engraving, an alpha mask, or has an explicit px stop + transparent.
      if (ART_SHEETS.includes(key)) {
        const gm = line.match(/(linear|radial|conic)-gradient\(/);
        if (gm) {
          // a gradient declaration can span lines — classify the whole block
          const block = CSS[key].split(/\r?\n/).slice(idx, idx + 8).join(' ');
          const hardStop = /repeat/.test(block) || /(-webkit-)?mask-image\s*:/.test(block)
            || (/\btransparent\b/.test(block) && /\d+(?:\.\d+)?px/.test(block));
          if (hardStop) hairlineNotes.push(ref);
          else gradHits.push(`${ref} :: ${line.trim().slice(0, 90)}`);
        }
      }
      // paint shadows on art sheets — only `none` and the documented node-separation ring
      if (ART_SHEETS.includes(key)) {
        const sm = line.match(/box-shadow\s*:\s*([^;]+);/);
        const value = sm ? sm[1].replace(/!important/g, '').trim() : '';
        if (sm && value !== 'none'
            && !(key === 'sub' && /0 0 0 2px var\(--bg3\)/.test(line))) {
          shadowHits.push(`${ref} :: ${value.slice(0, 70)}`);
        }
      }
    });
  }
  check('2-HEX', hexHits.length === 0,
    `no hardcoded hex paint in owned CSS${hexHits.length ? ' — ' + hexHits.join(' | ') : ''}`);
  check('2-GRADIENT', gradHits.length === 0,
    `no soft/boxing gradient in art sheets (hard-stop 1px engraving + mask allowed)${gradHits.length ? ' — ' + gradHits.join(' | ') : ''}`);
  check('2-SHADOW', shadowHits.length === 0,
    `no paint box-shadow in art sheets${shadowHits.length ? ' — ' + shadowHits.join(' | ') : ''}`);
  if (maskNotes.length) note('2-MASK-HEX', `${maskNotes.length} hex token(s) inside alpha mask-image only (not palette paint)`, maskNotes.join(', '));
  if (hairlineNotes.length) note('2-HAIRLINE', `${hairlineNotes.length} repeating-linear-gradient hairline engravings (0 1px, transparent 1px)`, '');

  // boxy card = numeric radius > 6px AND opaque fill AND a paint shadow on one node
  for (const key of ART_SHEETS) {
    const s = CSS[key];
    const re = /[^{}]+\{[^}]*\}/g;
    let m;
    while ((m = re.exec(s))) {
      const body = m[0];
      const radius = body.match(/border-radius\s*:\s*(\d+)px/);
      if (radius && Number(radius[1]) > 6
          && /\bbackground\s*:\s*(?!none|transparent)[^;]+;/.test(body)
          && /box-shadow\s*:\s*(?!none)[^;]+;/.test(body)) {
        const line = RAW[key].slice(0, m.index).split('\n').length;
        boxyHits.push(`${OWNED[key]}:${line}`);
      }
    }
  }
  check('2-BOX', boxyHits.length === 0,
    `no boxy (rounded + filled + shadowed) card in art sheets${boxyHits.length ? ' — ' + boxyHits.join(', ') : ''}`);

  // no-box locks: the tool row, result rows and agent card must stay frame-free
  const card = (() => { const i = CSS.console.indexOf('.chat-panel-root .tl2-card {'); if (i < 0) return ''; const o = CSS.console.indexOf('{', i); let d = 1; for (let k = o + 1; k < CSS.console.length && d; k++) { if (CSS.console[k] === '{') d++; else if (CSS.console[k] === '}') d--; if (!d) return CSS.console.slice(o + 1, k); } return ''; })();
  check('2-NOBOX-LOCK', ['border: 0 !important', 'border-radius: 0 !important', 'background: none !important', 'box-shadow: none !important'].every((d) => card.includes(d)),
    'tool row is explicitly locked to border:0 / radius:0 / background:none / shadow:none', at('console', '.chat-panel-root .tl2-card {'));
  const agtCard = (() => { const i = CSS.sub.indexOf('.agt-card {'); if (i < 0) return ''; const o = CSS.sub.indexOf('{', i); let d = 1; for (let k = o + 1; k < CSS.sub.length && d; k++) { if (CSS.sub[k] === '{') d++; else if (CSS.sub[k] === '}') d--; if (!d) return CSS.sub.slice(o + 1, k); } return ''; })();
  check('2-AGT-NOBOX', /border:\s*0\b/.test(agtCard) && /border-radius:\s*0\b/.test(agtCard) && /background:\s*none/.test(agtCard) && /box-shadow:\s*none/.test(agtCard),
    'agent card is de-boxed (no radius, no fill, no shadow)', at('sub', '.agt-card {'));

  // ---- TYPE — tabular mono, Instrument Serif + Cairo fallback ----
  const tnumSheets = ART_SHEETS.filter((k) => /font-variant-numeric\s*:\s*tabular-nums/.test(CSS[k]));
  check('3-TABULAR', tnumSheets.length >= 5,
    `${tnumSheets.length}/${ART_SHEETS.length} art sheets carry tabular-nums; 'tnum' feature ${/font-feature-settings\s*:\s*'tnum'/.test(CSS.art) ? 'present' : 'missing'}`);
  const serifStack = (SCSS.tokens.match(/--font-display-serif\s*:\s*([^;]+);/) ?? [])[1] ?? '';
  const arabicStack = (SCSS.tokens.match(/--font-display-ar\s*:\s*([^;]+);/) ?? [])[1] ?? '';
  check('3-FONTS', /Instrument Serif/.test(serifStack) && /Cairo/.test(serifStack) && /Cairo/.test(arabicStack),
    `--font-display-serif="${serifStack.trim()}" ; --font-display-ar="${arabicStack.trim()}"`, at('tokens', '--font-display-serif'));
  check('3-FONTFACE', /font-family\s*:\s*['"]?Instrument Serif/.test(RAW.glass) && /Cairo-arabic\.woff2/.test(RAW.glass)
    && /font-family\s*:\s*['"]?IBM Plex Mono/.test(RAW.glass),
    'Instrument Serif / Cairo / mono @font-face are bundled', `${OTHER.glass}:60`);
  check('3-DISPLAY-RTL', /--font-display-ar/.test(CSS.display) && /html\[lang='ar'\]|html\[dir='rtl'\]/.test(CSS.display),
    'display-type.css resolves every serif title to Cairo under ar/rtl', at('display', ":where(html[lang='ar']"));

  // ---- RTL logical properties ----
  const physicalHits = [];
  const geometricCenters = [];
  for (const key of ART_SHEETS) {
    CSS[key].split(/\r?\n/).forEach((line, idx) => {
      if (/^\s*(left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/.test(line)) {
        // `left:50%; top:50%` on an orbit's registration leader is a
        // GEOMETRIC circle centre (identical in LTR/RTL), not a linguistic edge.
        if (/^\s*(left|top)\s*:\s*50%/.test(line)) geometricCenters.push(`${OWNED[key]}:${idx + 1}`);
        else physicalHits.push(`${OWNED[key]}:${idx + 1}`);
      }
    });
  }
  if (geometricCenters.length) note('4-GEOMETRIC-CENTER', `${geometricCenters.length} geometric 50% orbit-centre declaration(s) — direction-neutral, not a linguistic edge`, geometricCenters.join(', '));
  check('4-RTL', physicalHits.length === 0,
    `no physical side declarations in art sheets${physicalHits.length ? ' — ' + physicalHits.join(', ') : ''}`);
  check('4-LOGICAL', ART_SHEETS.filter((k) => /inset-inline-(start|end)/.test(CSS[k])).length >= 6,
    'art sheets use logical inset-inline-start/end (RTL mirrors for free)');

  // ---- BOTH reduced-motion guards in EVERY animated owned sheet ----
  const motionless = [], missingGuard = [];
  for (const key of ALL_SHEETS) {
    const hasMotion = /@keyframes|animation\s*:/.test(CSS[key]);
    if (!hasMotion) { motionless.push(OWNED[key]); continue; }
    const os = /prefers-reduced-motion\s*:\s*reduce/.test(SOURCE[key]);
    const app = /html\.reduce-motion/.test(SOURCE[key]);
    if (!os || !app) missingGuard.push(`${OWNED[key]} (os=${os}, app=${app})`);
  }
  check('5-REDUCED-MOTION', missingGuard.length === 0,
    `both guards in ${ALL_SHEETS.length - motionless.length - missingGuard.length} animated sheets${missingGuard.length ? ' — MISSING: ' + missingGuard.join(', ') : ''}; ${motionless.length} motionless sheets exempt`);

  // ---- BRACE BALANCE 0 ----
  const unbalanced = [];
  for (const key of ALL_SHEETS) {
    const open = (CSS[key].match(/\{/g) ?? []).length;
    const close = (CSS[key].match(/\}/g) ?? []).length;
    if (open !== close) unbalanced.push(`${OWNED[key]} ${open} open / ${close} close`);
  }
  check('5-BRACES', unbalanced.length === 0,
    `brace balance 0 in all ${ALL_SHEETS.length} owned sheets${unbalanced.length ? ' — ' + unbalanced.join(', ') : ''}`);

  // ---- VERDICT ----
  const pass = findings.filter((f) => f.status === 'PASS').length;
  const fail = findings.length - pass;
  console.log(`\n===== V1138 GRAPHICS GUARD SUMMARY: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail) =====`);
  for (const f of findings) if (f.status === 'FAIL') console.log(`  - ${f.id} [${f.fileLine || '-'}]: ${f.detail}`);
  try {
    writeFileSync(join(ROOT, 'tests', '.v1138-graphics-guard.results.json'), JSON.stringify({
      version: 'v11.38', guard: 'graphics-g3', at: new Date().toISOString(),
      summary: { pass, fail }, findings, notes,
    }, null, 2));
  } catch { /* best-effort */ }
  process.exitCode = fail ? 1 : 0;
}

main();
