// =====================================================================
// SADEEM v11.36 — CHILD-SESSION GUARD  (D3 verification)
//
// DIAGNOSIS + TEST + DOC ONLY. This file is NOT app source. It edits nothing
// under src/, shared/ or electron/. It is a website-free, network-free,
// no-build, static-source gate that verifies the "click an agent card → land
// inside a REAL child session like OpenCode" deliverable (task D3).
//
// It enforces FIVE things, all by source inspection (no runtime, no mocks):
//
//   G1  SubagentRecord has a real `toolCalls` ARRAY field + parent sessionId
//       link                                    (shared/types.ts)
//   G2  SubagentDetailModal renders REAL tool-call rows: name / input /
//       status / output — NOT a generic "Step n of total" counter
//                                                (SubagentDetailModal.tsx)
//   G3  Agent card has a real click handler opening the view, AND a parent
//       breadcrumb "back to main session" that NAVIGATES via sessionId
//                                    (AgentTeamCard.tsx + modal)
//   G4  No fabricated transcript / no invented tool names; single-language
//       bilingual labels, RTL logical props, reduced-motion guards, hairline
//                                    (modal + card + subagents.css)
//   G5  Tool calls are ACCUMULATED from real events in store.ts (a handler
//       writes to toolCalls from an `e.*` event) — NOT a hardcoded demo
//                                                (src/store.ts)
//
// RUN (repo root):  node tests-v1136-child-session-guard.mjs
//
// HONESTY CONTRACT
// ----------------
// This guard was written BEFORE D3 landed. On the pre-D3 tree it MUST fail the
// D3-specific gates (G1 toolCalls, G2 real rows, G3 breadcrumb, G5 store
// accumulation) while passing the already-satisfied gates (card click, i18n,
// RTL, motion, hairline). A FAIL here is the truthful verdict, not a broken
// harness. Re-run the exact same command after D3 finishes; every gate must
// flip to PASS with no edits to this file. If a gate still fails, the report
// below prints file:line for the missing marker.
// =====================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const P = {
  guard: join(ROOT, 'tests-v1136-child-session-guard.mjs'),
  types: join(ROOT, 'shared', 'types.ts'),
  modal: join(ROOT, 'src', 'components', 'SubagentDetailModal.tsx'),
  card: join(ROOT, 'src', 'components', 'AgentTeamCard.tsx'),
  store: join(ROOT, 'src', 'store.ts'),
  css: join(ROOT, 'src', 'components', 'subagents.css'),
  doc: join(ROOT, 'docs', 'CHILD-SESSION-GUARD-V1136.md'),
  engine: join(ROOT, 'electron', 'agent', 'subagents.ts'),
};

const failures = [];
function check(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
  if (!ok) failures.push(`${id} — ${detail}`);
  return ok;
}
function read(path, label) {
  const present = existsSync(path);
  check(`FILE-${label}`, present, present ? `${path} present` : `${path} MISSING`);
  return present ? readFileSync(path, 'utf8') : '';
}

// ---- small source helpers -------------------------------------------------
function ifaceBlock(src, name) {
  const m = src.match(new RegExp('interface\\s+' + name + '\\s*\\{([\\s\\S]*?)\\n\\}'));
  return m ? m[1] : '';
}
function winOf(src, re, before = 500, after = 1300) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(src))) {
    out.push(src.slice(Math.max(0, m.index - before), m.index + after));
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}
function lineOf(src, needle) {
  const i = src.split(/\r?\n/).findIndex((l) => l.includes(needle));
  return i < 0 ? '?' : i + 1;
}

const guard = read(P.guard, 'GUARD');
const types = read(P.types, 'TYPES');
const modal = read(P.modal, 'MODAL');
const card = read(P.card, 'CARD');
const store = read(P.store, 'STORE');
const css = read(P.css, 'CSS');
const doc = read(P.doc, 'DOC');
const engine = read(P.engine, 'ENGINE');

const recBlock = ifaceBlock(types, 'SubagentRecord');

console.log('\n================ G1 — SubagentRecord data shape ================');
// G1.1 a real toolCalls ARRAY field on the record (not a counter, not a demo).
const toolCallsField = /\btoolCalls\s*\??\s*:\s*(?:[^\n;]*\[\]|Array\s*<)/.test(recBlock);
check('G1-TOOLCALLS-FIELD', toolCallsField,
  `SubagentRecord declares a toolCalls array field (shared/types.ts:${lineOf(types, 'export interface SubagentRecord')})`);

// G1.2 a tool-call shape (named type OR inline on the record field) describing
// name / input / status / output. D3 may use either representation.
const tcDecl = types.match(/(?:interface|type)\s+[A-Za-z_$][\w$]*(?:ToolCall|toolCall)[\w$]*\s*[=\{]/i);
const tcFieldIdx = recBlock.indexOf('toolCalls');
const inlineShape = tcFieldIdx >= 0 ? recBlock.slice(tcFieldIdx, tcFieldIdx + 800) : '';
const tcShape = (tcDecl ? types.slice(tcDecl.index, tcDecl.index + 1100) : '') + '\n' + inlineShape;
const hasName = /\bname\s*[?:]?\s*:/.test(tcShape);
const hasInput = /\binput\s*[?:]?\s*:/.test(tcShape);
const hasStatus = /\b(?:status|state)\s*[?:]?\s*:/.test(tcShape);
const hasOutput = /\b(?:output|content|result)\s*[?:]?\s*:/.test(tcShape);
check('G1-TOOLCALL-SHAPE', hasName && hasInput && hasStatus && hasOutput,
  `a tool-call type declares name(${hasName}) input(${hasInput}) status/state(${hasStatus}) output/content(${hasOutput})`);

// G1.3 the parent sessionId link is present on the record.
const recStartLine = lineOf(types, 'export interface SubagentRecord');
const relSid = recBlock.split(/\r?\n/).findIndex((l) => /\bsessionId\s*[?:]?\s*:\s*string/.test(l));
const sidLine = relSid < 0 ? '?' : recStartLine + relSid;
check('G1-PARENT-LINK', relSid >= 0,
  `SubagentRecord carries a parent sessionId link (shared/types.ts:${sidLine})`);

console.log('\n================ G2 — modal renders REAL tool-call rows ================');
const hasToolCallsRead = /\btoolCalls\b/.test(modal);
check('G2-READ-TOOLCALLS', hasToolCallsRead,
  `modal reads record.toolCalls (SubagentDetailModal.tsx:${lineOf(modal, 'toolCalls')})`);

const mapRe = /toolCalls\s*\??\s*\.\s*map\s*\(|for\s*\(\s*const\s+\w+\s+of\s+[^)]*toolCalls/;
const mapsToolCalls = mapRe.test(modal);
check('G2-MAPS-TOOLCALLS', mapsToolCalls,
  `modal iterates toolCalls into rows (.map / for..of) (SubagentDetailModal.tsx:${lineOf(modal, 'toolCalls')})`);

const mapIdx = modal.search(mapRe);
const tcWin = mapIdx >= 0
  ? modal.slice(Math.max(0, mapIdx - 300), mapIdx + 1700)
  : (hasToolCallsRead ? modal.slice(Math.max(0, modal.indexOf('toolCalls') - 200), modal.indexOf('toolCalls') + 1700) : '');
const rowName = /\.\s*name\b|\bname\s*:/.test(tcWin);
const rowInput = /\binput\b/.test(tcWin);
const rowStatus = /\b(?:status|state)\b/.test(tcWin);
const rowOutput = /\b(?:output|content|result)\b/.test(tcWin);
check('G2-ROW-NAME', rowName, 'a rendered tool row shows the tool NAME');
check('G2-ROW-INPUT', rowInput, 'a rendered tool row shows the tool INPUT');
check('G2-ROW-STATUS', rowStatus, 'a rendered tool row shows the tool STATUS/STATE');
check('G2-ROW-OUTPUT', rowOutput, 'a rendered tool row shows the tool OUTPUT/CONTENT');

const genericCounter = /Step \{n\} of \{total\}/.test(modal);
check('G2-NOT-GENERIC', mapsToolCalls || !genericCounter,
  genericCounter && !mapsToolCalls
    ? `timeline is still generic "Step n of total" only (SubagentDetailModal.tsx:${lineOf(modal, "t('sad.step'")})`
    : 'real tool-call rows exist (generic counter removed or demoted)');

const fabricated = /const\s+(?:FAKE|MOCK|SAMPLE|DUMMY|DEMO)[\s\S]{0,80}(?:transcript|toolCall)|Lorem ipsum|role:\s*['"]assistant['"][\s\S]{0,120}(?:fake|dummy|sample|invented)/i.test(modal);
check('G2-NO-FABRICATION', !fabricated, 'no hardcoded/fabricated assistant transcript or invented rows in the modal');

console.log('\n================ G3 — card click + parent breadcrumb ================');
const cardClick = /onClick=\{\(\)\s*=>[^\n]*openSubagentDetail/.test(card)
  && /openSubagentDetail\?\.\(/.test(card);
check('G3-CARD-CLICK', cardClick,
  `agent card opens the detail view via a real onClick (AgentTeamCard.tsx:${lineOf(card, 'openSubagentDetail?.(m.recordId)')})`);
check('G3-CARD-BUTTON', /<button\s[\s\S]{0,200}type="button"/.test(card)
  && /agt-(?:drill|node|legend-item)/.test(card),
  'the opener is a native <button type="button"> (Enter/Space activate)');

// NOTE: deliberately NOT matching the pre-existing `sad-back` (back-to-TEAM)
// control — that button only calls close() and is not a parent-session crumb.
const breadcrumbUI = /(sad-(?:breadcrumb|crumb|parent)|data-testid=["']sad-breadcrumb|back to (?:the )?(?:main|parent|root)|parent session|الجلسة (?:الرئيسية|الأم|الجذرية)|خبز[^\n]*جلسة)/i.test(modal);
check('G3-BREADCRUMB-UI', breadcrumbUI,
  `a parent breadcrumb "back to main session" is rendered (SubagentDetailModal.tsx:${lineOf(modal, 'sad-back')})`);

const sidLines = modal.split(/\r?\n/).filter((l) => /\bsessionId\b/.test(l));
const navLine = sidLines.find((l) =>
  /(open|navigat|goto|goTo|drill|enter|parent|backTo|Main)/i.test(l) && !/close\(\)/.test(l));
check('G3-BREADCRUMB-NAV', !!navLine,
  navLine
    ? `breadcrumb NAVIGATES to parent session via sessionId (SubagentDetailModal.tsx:${lineOf(modal, navLine.trim().slice(0, 40))})`
    : `no sessionId-based navigation handler found — only close() exists (SubagentDetailModal.tsx:${lineOf(modal, 'onClick={close}')})`);

console.log('\n================ G4 — i18n / RTL / motion / hairline ================');
check('G4-I18N-IMPORT', /import\s*\{\s*useT/.test(card) && /import\s*\{\s*useT/.test(modal),
  'both components import useT');
const tCalls = (card.match(/\bt\(\s*['"]/g) || []).length + (modal.match(/\bt\(\s*['"]/g) || []).length;
check('G4-BILINGUAL', tCalls >= 24, `>=24 t('key','English fallback') labels (got ${tCalls})`);
const mixed = new RegExp("[\\u0600-\\u06FF][^\\n'\\\"]*[A-Za-z]{3}|[A-Za-z]{3}[^\\n'\\\"]*[\\u0600-\\u06FF]");
const mixedHits = [...card.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g), ...modal.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)]
  .map((m) => m[1] || m[2]).filter((s) => mixed.test(s));
check('G4-ONE-LANGUAGE', mixedHits.length === 0,
  mixedHits.length ? `no single string mixes Arabic+Latin (got: ${mixedHits.slice(0, 3).join(' | ')})`
    : 'no single string literal mixes Arabic + Latin');
check('G4-RTL-CSS', /inset-inline-start/.test(css) && /inset-inline-end/.test(css)
  && /padding-inline/.test(css) && /margin-inline-start/.test(css),
  'CSS uses logical inset/padding/margin properties (RTL mirrors)');
check('G4-RTL-DIR', /dir="auto"/.test(card) && /dir="auto"/.test(modal),
  'TSX uses dir="auto" on text runs');
check('G4-MOTION', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css)
  && /html\.reduce-motion/.test(css) && /animation:\s*none\s*!important/.test(css),
  'reduced-motion guards present (OS media query + in-app html.reduce-motion)');
const agtBlock = (css.match(/\.agt-card\s*\{[\s\S]*?\}/) || [''])[0];
check('G4-HAIRLINE', /border:\s*0/.test(agtBlock) && /border-radius:\s*0/.test(agtBlock)
  && /background:\s*none/.test(agtBlock) && /box-shadow:\s*none/.test(agtBlock),
  'card is frame-free (no box/border/radius/shadow) — hairline is the art');

console.log('\n================ G5 — store accumulates real tool calls ================');
// Exclude the unrelated i18n key `slash.share.toolCalls` (a share-menu label).
const tcRe = /(?<!slash\.share\.)\btoolCalls\b/;
const tcWins = winOf(store, tcRe, 700, 900);
check('G5-STORE-TOOLCALLS', tcWins.length > 0,
  tcWins.length
    ? `store.ts references toolCalls (src/store.ts:${lineOf(store, 'toolCalls')})`
    : 'store.ts has no subagent toolCalls accumulator (only the slash.share label)');
const appendWrite = tcWins.some((w) => /\[\s*\.\.\.|\.\.\.\s*\w+|push\s*\(|concat\s*\(/.test(w));
check('G5-APPEND-WRITE', appendWrite,
  'a store handler APPENDS to toolCalls ([...prev], push, spread or concat) — not a one-off assignment');
const fromEvent = tcWins.some((w) => /\be\.\w+|\bevent\.\w+/.test(w)
  && /(?:case\s*['"]|subagent|tool)/i.test(w));
check('G5-EVENT-DRIVEN', fromEvent,
  'the toolCalls write reads a real event object (e.*) — accumulated from live events');
const hardcodedDemo = /toolCalls\s*:\s*\[\s*\{\s*(?:name|tool)\s*:\s*['"]/.test(store)
  || /(?:FAKE|MOCK|SAMPLE|DEMO)[\s\S]{0,60}toolCalls/.test(store);
check('G5-NOT-HARDCODED', !hardcodedDemo,
  'no hardcoded demo array of tool names assigned to toolCalls');

// A real source must exist to feed the accumulator: either the engine emits
// tool-call data, or the IPC event union declares a tool-call event.
const realSource = /tool(?:Call|_call)|toolLoop/.test(engine)
  || /subagent_tool|tool_call|toolCallEvent/.test(types);
check('G5-REAL-SOURCE', realSource,
  `a real tool-call source exists (engine electron/agent/subagents.ts:${lineOf(engine, 'progress')} or IPC event union in shared/types.ts)`);

console.log('\n----- LIVE MARKER LINES (current tree) -----');
console.log(`  SubagentRecord block        : shared/types.ts:${lineOf(types, 'export interface SubagentRecord')}`);
console.log(`  toolCalls field             : shared/types.ts:${lineOf(types, 'toolCalls')}`);
console.log(`  modal toolCalls read        : SubagentDetailModal.tsx:${lineOf(modal, 'toolCalls')}`);
console.log(`  generic step counter        : SubagentDetailModal.tsx:${lineOf(modal, "t('sad.step'")}`);
console.log(`  back control (close only)   : SubagentDetailModal.tsx:${lineOf(modal, 'data-testid="sad-back"')}`);
console.log(`  card open handler           : AgentTeamCard.tsx:${lineOf(card, 'openSubagentDetail?.(m.recordId)')}`);
console.log(`  store toolCalls write       : src/store.ts:${lineOf(store, 'toolCalls')}`);
console.log(`  store progress accumulator  : src/store.ts:${lineOf(store, "case 'subagent_progress'")}`);
console.log('--------------------------------------------');

console.log('\n================ V11.36 CHILD-SESSION GUARD SUMMARY ================');
console.log(`Checks failed: ${failures.length}`);
if (failures.length === 0) {
  console.log('RESULT: PASS — you CAN click the agent card and land inside a real child session like OpenCode.');
  process.exitCode = 0;
} else {
  console.log('RESULT: FAIL — gate(s) failed:');
  for (const f of failures) console.log('  - ' + f);
  console.log('\nBLUNT VERDICT / الحكم الصريح:');
  console.log('  EN: NO — the child-session drill is not real yet. The failing gates above');
  console.log('      are exactly the missing substance (toolCalls data + real rows + parent');
  console.log('      breadcrumb + event-driven store accumulation). Re-run after D3 lands.');
  console.log('  AR: لا — التنقّل إلى جلسة الوكيل الفرعي ليس حقيقياً بعد. الفحوصات الحمراء');
  console.log('      أعلاه هي بالضبط الجوهر الناقص (بيانات toolCalls + صفوف حقيقية + خبز سلف');
  console.log('      + تجميع من أحداث حقيقية في المتجر). أعد التشغيل بعد انتهاء D3.');
  process.exitCode = 1;
}
