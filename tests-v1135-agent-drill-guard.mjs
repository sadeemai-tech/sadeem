// =============================================================
// SADEEM v11.35 — AGENT-DRILL GUARD (verifier + reverse-engineer)
//
// DIAGNOSIS + TEST + DOC ONLY. This file is NOT app source and edits
// nothing under src/ or shared/. It is a website-free, network-free,
// static-source gate for two deliverables:
//
//   PART 1  docs/OPENCODE-SESSION-DRILL-V1135.md
//           - reverse-engineers OpenCode "session within a session"
//             from real official docs + real source URLs
//           - honest, cited comparison against SADEEM's read-only
//             SubagentDetailModal.tsx / AgentTeamCard.tsx
//
//   PART 2  the implemented UI under src/components/
//           - AgentTeamCard.tsx: real click/keyboard handler opens view
//           - SubagentDetailModal.tsx: real task + step-by-step TOOL CALLS,
//             no fabricated transcript
//           - bilingual single-language labels, RTL logical props,
//             reduced-motion guards, no boxy card grid
//           - handoff: missing data fields with exact file:line
//
// RUN (repo root):  node tests-v1135-agent-drill-guard.mjs
// No fetch, no build, no electron. Pure static parsing.
//
// HONESTY CONTRACT: this guard does NOT claim full session parity.
// It PASSES the cosmetic/UX checks but intentionally FAILS the
// "real per-tool-call transcript" check when the tree only renders
// generic "Step n of total" counters. That failure IS the verdict.
// =============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const P = {
  card: join(ROOT, 'src', 'components', 'AgentTeamCard.tsx'),
  modal: join(ROOT, 'src', 'components', 'SubagentDetailModal.tsx'),
  css: join(ROOT, 'src', 'components', 'subagents.css'),
  types: join(ROOT, 'shared', 'types.ts'),
  doc: join(ROOT, 'docs', 'OPENCODE-SESSION-DRILL-V1135.md'),
};

const failures = [];
function check(id, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`;
  console.log(line);
  if (!ok) failures.push(`${id} — ${detail}`);
  return ok;
}

function read(path, label) {
  if (!existsSync(path)) {
    check(`${label}-EXISTS`, false, `${path} missing`);
    return '';
  }
  check(`${label}-EXISTS`, true, `${path} present`);
  return readFileSync(path, 'utf8');
}

const card = read(P.card, 'CARD');
const modal = read(P.modal, 'MODAL');
const css = read(P.css, 'CSS');
const types = read(P.types, 'TYPES');
const doc = read(P.doc, 'DOC');

console.log('\n===== PART 1 — REVERSE-ENGINEERING DOC =====');

// Official-doc URL classifier (format only, no network).
function isOfficial(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(h)) return false;
  if (/opencode\.ai|github\.com|githubusercontent\.com|developer\.mozilla|react\.dev|mdn/.test(h)) return true;
  if (/(^|\.)docs?\.|developer\.|learn\./.test(h)) return true;
  return false;
}
{
  const all = [...doc.matchAll(/https?:\/\/[^\s<>"'`)\]}>]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));
  const official = [...new Set(all.filter(isOfficial))];
  check('DOC-URL-1', official.length >= 5, `>=5 distinct official URLs cited (got ${official.length})`);
  check('DOC-URL-0', all.length >= 5, `>=5 total https URLs present (got ${all.length})`);
  if (official.length) console.log('        ' + official.slice(0, 8).join(' | '));
}

// Real OpenCode facts must be named (source-level identifiers, not vibes).
{
  const facts = {
    'parentID field': /parentID/,
    'Session.Info schema': /Session\.Info|session\.ts/,
    'subagent tool creates child': /subagent tool|tool\/plugin\/subagent/,
    'assistant tool message parts': /AssistantTool|assistant.*tool|tool.*state|ToolState/,
    'durable log / replay': /sessions\.log|replay|durable/,
    'TUI Subagents tab': /Subagents tab|subagents-tab|composer\.subagent/,
    'navigate to child session': /navigate\(\{\s*type:\s*["']session|sessionID:\s*entry\.sessionID|drill/i,
    'child navigation test': /subagent-child-navigation|session-subagent-navigation/,
  };
  for (const [name, re] of Object.entries(facts)) check(`DOC-FACT`, re.test(doc), `doc names ${name}`);
}

// Honest comparison + blunt verdict + file:line citations.
{
  const cited = ['AgentTeamCard.tsx', 'SubagentDetailModal.tsx', 'shared/types.ts', 'subagents.css'];
  for (const f of cited) check('DOC-CITE', doc.includes(f), `doc cites ${f}`);
  check('DOC-LINE', /\.tsx:\d+|\.ts:\d+|\.css:\d+/.test(doc), 'doc uses file:line citations');
  check('DOC-VERDICT', /cannot drill|can(?:not|'t) actually drill|NO\b/i.test(doc), 'doc gives a blunt "cannot drill" verdict');
  check('DOC-GAP', /MISSING|PARTIAL|NO\b|✗|❌/.test(doc), 'doc contains explicit gap markers');
  check('DOC-NO-OVERCLAIM', !/(100\s*%|full)\s*(feature\s*)?parity|feature[- ]complete|no gaps/i.test(doc), 'doc does not overclaim parity');
  const tableRows = doc.split(/\r?\n/).filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  check('DOC-TABLE', tableRows.length >= 8, `>=8 comparison table rows (got ${tableRows.length})`);
}

console.log('\n===== PART 2 — IMPLEMENTATION GATES =====');

// --- 1. AgentTeamCard: a live, keyboard-operable detail opener ---
{
  const opens = /onClick\s*=\s*\{\(\)\s*=>\s*m\.recordId\s*&&\s*openSubagentDetail\?\.\(m\.recordId\)\}/.test(card);
  check('C1-CLICK', opens, 'agent node has real onClick -> openSubagentDetail(recordId)');
  check('C1-BUTTON', /<button\s[\s\S]{0,160}type="button"/.test(card), 'opener is a native <button type="button"> (Enter/Space activate)');
  check('C1-A11Y', /aria-label=\{label\}/.test(card) && /title=\{/.test(card), 'opener carries aria-label + title');
  check('C1-LIVE-JOIN', /matchLedgerRecord\s*\(/.test(card) && /disabled=\{!m\.recordId\}/.test(card),
    'ledger join has role/description/running fallbacks (chip not permanently dead)');
  check('C1-NO-CONTAINER-CLICK', !/className=\{?["'`]agt-card[\s\S]{0,80}onClick/.test(card),
    'honest note: container div is NOT the click target; the agent nodes are (informational)');
}

// --- 2. SubagentDetailModal: real task + real tool calls, no fabrication ---
{
  check('C2-REAL-TASK', /\{record\.prompt\s*\|\|/.test(modal) && /record\.description/.test(modal),
    'renders record.prompt + record.description (real delegated task)');

  // Real tool-call rendering would read a tool name / input / state off a
  // per-step part. Generic progress counters ("Step n of total") are NOT tool calls.
  const toolSignals = ['toolCalls', 'toolParts', 'tool_calls', 'state.input', 'part.name', 'tool.name', 'toolName', 'toolCallId'];
  const hasToolCalls = toolSignals.some((s) => modal.includes(s)) || /\.name\}/.test(modal) && /input/.test(modal);
  check('C2-TOOL-CALLS', hasToolCalls,
    'renders step-by-step TOOL CALLS (name/input/state) — FAIL means generic progress only');
  const genericOnly = /t\('sad\.step',\s*'Step \{n\} of \{total\}'/.test(modal);
  check('C2-GENERIC-TIMELINE', true,
    genericOnly
      ? 'timeline is generic "Step n of total" from subagentSteps (no tool names/inputs/outputs) — gap logged'
      : 'timeline source is not the known generic-counter form; re-inspect manually');

  const fabricated = /const\s+(FAKE|MOCK|SAMPLE)[\s\S]{0,40}transcript|role:\s*['"]assistant['"][\s\S]{0,80}fake|Lorem ipsum/i.test(modal);
  check('C2-NO-FABRICATION', !fabricated, 'no hardcoded/fabricated assistant transcript in the modal');
}

// --- 3. Bilingual single-language labels, RTL, motion, no box ---
{
  check('C3-I18N-IMPORT', /import\s*\{\s*useT/.test(card) && /import\s*\{\s*useT/.test(modal), 'both components import useT');
  const tCalls = (card.match(/\bt\(\s*['"]/g) || []).length + (modal.match(/\bt\(\s*['"]/g) || []).length;
  check('C3-BILINGUAL', tCalls >= 20, `>=20 t('key','English fallback') labels (got ${tCalls})`);
  const mixed = new RegExp("[\\u0600-\\u06FF][^\\n'\\\"]*[A-Za-z]{3}|[A-Za-z]{3}[^\\n'\\\"]*[\\u0600-\\u06FF]");
  const mixedHits = [...card.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] || m[2]).filter((s) => mixed.test(s));
  check('C3-ONE-LANGUAGE', mixedHits.length === 0,
    mixedHits.length ? `no single string literal mixes Arabic+Latin (got: ${mixedHits.slice(0, 3).join(' | ')})`
      : 'no single string literal mixes Arabic + Latin');
  check('C3-RTL-CSS', /inset-inline-start/.test(css) && /inset-inline-end/.test(css) && /padding-inline/.test(css) && /margin-inline-start/.test(css),
    'CSS uses logical inset/padding/margin properties (RTL mirrors)');
  check('C3-RTL-DIR', /dir="auto"/.test(card) && /dir="ltr"/.test(card) && /dir="auto"/.test(modal),
    'TSX uses dir="auto"/"ltr" on text runs');
  check('C3-MOTION', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css) && /html\.reduce-motion/.test(css) && /animation:\s*none\s*!important/.test(css),
    'reduced-motion guards present (OS media query + in-app html.reduce-motion)');
  const agtBlock = (css.match(/\.agt-card\s*\{[\s\S]*?\}/) || [''])[0];
  check('C3-NO-BOX', /border:\s*0/.test(agtBlock) && /border-radius:\s*0/.test(agtBlock) && /background:\s*none/.test(agtBlock) && /box-shadow:\s*none/.test(agtBlock),
    '.agt-card is frame-free (no box/border/radius/shadow) — orbit is the art');
}

// --- 4. Handoff: missing data fields with exact file:line ---
// A5 is actively editing, so line numbers drift. We require the doc to cite
// each file WITH a line number (any digits) and we additionally resolve the
// CURRENT live line of each marker below and print it as a handoff aid.
{
  const needs = [
    ['shared/types.ts:NN', /shared\/types\.ts:\d+/],
    ['SubagentDetailModal.tsx:NN', /SubagentDetailModal\.tsx:\d+/],
    ['AgentTeamCard.tsx:NN', /AgentTeamCard\.tsx:\d+/],
  ];
  for (const [label, re] of needs) check('C4-HANDOFF', re.test(doc), `handoff cites ${label}`);
  check('C4-TRANSCRIPT-WORD', /per-agent transcript|per-step tool|no tool-call/i.test(doc), 'handoff names the missing per-agent transcript');
  check('C4-PARENT-LINK', /parent session link|parentID|sessionId.*not.*used|no parent/i.test(doc), 'handoff names the missing parent-session link');
}

// Live handoff lines — recomputed from the CURRENT tree on every run so the
// report stays accurate while A5 is still saving files.
function liveLine(src, needle) {
  const i = src.split(/\r?\n/).findIndex((l) => l.includes(needle));
  return i < 0 ? '?' : i + 1;
}
console.log('\n----- LIVE HANDOFF LINES (current tree) -----');
console.log(`  real click opener      : AgentTeamCard.tsx:${liveLine(card, 'openSubagentDetail?.(m.recordId)')}`);
console.log(`  generic step timeline  : SubagentDetailModal.tsx:${liveLine(modal, "t('sad.step'")}`);
console.log(`  no-tool-transcript note: SubagentDetailModal.tsx:${liveLine(modal, 'never a per-agent tool-call transcript')}`);
console.log(`  footer (id + retry)    : SubagentDetailModal.tsx:${liveLine(modal, 'className="sad-foot"')}`);
console.log(`  labelled back control  : SubagentDetailModal.tsx:${liveLine(modal, 'data-testid="sad-back"')}`);
console.log(`  SubagentRecord fields  : shared/types.ts:${liveLine(types, 'export interface SubagentRecord')}`);
{
  const recStart = types.split(/\r?\n/).findIndex((l) => l.includes('export interface SubagentRecord'));
  const rel = types.split(/\r?\n/).slice(recStart).findIndex((l) => l.includes('sessionId: string'));
  console.log(`  sessionId field        : shared/types.ts:${recStart < 0 || rel < 0 ? '?' : recStart + rel + 1}`);
}
console.log('--------------------------------------------');

// --- 5. A5's v11.35 additions: labelled back control + counter-only rail ---
{
  const back = /data-testid="sad-back"/.test(modal) && /className="sad-back/.test(modal) && /onClick=\{close\}/.test(modal);
  check('C5-BACK-CONTROL', back,
    'labelled "back to team" control exists (it calls close() — a modal dismissal, NOT session navigation)');
  const rail = /sad-orbit-rail/.test(modal) && /never a substitute transcript/.test(modal);
  check('C5-COUNTER-RAIL', rail, 'orbital rail is explicitly counter-only, not a substitute transcript');
}

// v11.36 — the gap is CLOSED: the ledger now carries a real per-agent tool-call
// transcript, and `sessionId` is USED by the child-session breadcrumb. The old
// "NO transcript field" assertion was inverted (it asserted the bug itself).
{
  const recBlock = (types.match(/export interface SubagentRecord\s*\{[\s\S]*?\}/) || [''])[0];
  check('SRC-SESSIONID-FIELD', /sessionId:\s*string/.test(recBlock),
    'SubagentRecord has a sessionId parent link (used by the child-session breadcrumb)');
  check('SRC-TRANSCRIPT-FIELD', /toolCalls\s*\??\s*:\s*SubagentToolCall\[\]/.test(recBlock),
    'SubagentRecord HAS a real toolCalls transcript field (v11.36 gap closed)');
}

// --- 6. A5's own precise drop-point: the real per-step ACTION LABEL ---
// Engine emits subagent_progress.step (electron/agent/subagents.ts:61), but
// the IPC union and the store accumulator drop it. The modal is already
// ready to show it. This is the cheapest real-data win in the handoff.
{
  const ep = join(ROOT, 'electron', 'agent', 'subagents.ts');
  const sp = join(ROOT, 'src', 'store.ts');
  const engine = existsSync(ep) ? readFileSync(ep, 'utf8') : '';
  const store = existsSync(sp) ? readFileSync(sp, 'utf8') : '';
  check('C6-ENGINE-EMITS-STEP', /step\?: string/.test(engine), 'engine emits a real short action label (subagent_progress.step)');
  const evtLine = types.split(/\r?\n/).find((l) => l.includes("type: 'subagent_progress'")) || '';
  check('C6-IPC-DROPS-STEP', !!evtLine && !/\bstep\b/.test(evtLine),
    'IPC union subagent_progress event drops the engine step label (shared/types.ts:432)');
  const accLine = store.split(/\r?\n/).find((l) => l.includes('at: Date.now(), done: e.done, total: e.total')) || '';
  check('C6-STORE-DROPS-STEP', !!accLine && !/\bstep\b/.test(accLine),
    'store subagentSteps accumulator drops the step label (store.ts:~4760)');
  check('C6-MODAL-READY', /step\?: string/.test(modal) && /\$\{base\} · \$\{s\.step\}/.test(modal),
    'modal already renders s.step when present — no fabricated feed');
  check('C6-DOC-CITES', /electron\/agent\/subagents\.ts:61/.test(doc) && /shared\/types\.ts:432/.test(doc) && /store\.ts:4760/.test(doc),
    'doc handoff cites the three exact drop/wire lines');
}

console.log('\n================ V11.35 AGENT-DRILL GUARD SUMMARY ================');
console.log(`UI/POLISH gates failed: ${failures.length}`);
if (failures.length === 0) {
  console.log('RESULT: PASS — all agent-drill gates satisfied.');
  process.exitCode = 0;
} else {
  console.log('RESULT: FAIL — gate(s) failed:');
  for (const f of failures) console.log('  - ' + f);
  console.log('\nBLUNT VERDICT: cosmetic/UX gates pass, but if C2-TOOL-CALLS failed,');
  console.log('you CANNOT drill into a real agent session like OpenCode — only a');
  console.log('ledger detail modal with generic "Step n of total" counters exists.');
  process.exitCode = 1;
}
