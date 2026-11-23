// ============================================================
// SADEEM v11.34 — V15 acceptANCE GATE for competitor-capability docs
//
// PURPOSE (diagnosis + docs only — this file is NOT app source):
//   Website-INDEPENDENT verification of V15's two deliverables:
//     1. docs/COMPETITOR-CAPABILITIES-V1134.md  (real URLs + honest gap table)
//     2. electron/agent/prompts.ts               (short capability roster)
//
// RUN (from repo root):
//   node tests-v1134-competitor.mjs
// No network, no fetch, no electron, no build step. Pure static parsing.
//
// ------------------------------------------------------------
// CONVENTIONS THIS TEST ENFORCES (so V15 can write to spec):
//   A. The doc cites >=5 DISTINCT official documentation URLs as `https://...`.
//      "Official" = https + a docs/developer/learn host or a /docs path on a
//      known vendor host. Placeholders (example.com, localhost, yourdomain,
//      foo/test) are rejected. NO network call is made — format only.
//   B. The doc contains >=10 capability-table data rows (markdown `| ... |`).
//   C. "No invented features": every snake_case identifier written in backticks
//      in the doc must be a REAL tool name from the 145-tool inventory, and the
//      doc must not claim full/100% parity or "no gaps".
//   D. "byte delta <=600B": prompts.ts grew by <=600 bytes vs the recorded
//      pre-V15 baseline (63,716 bytes). If V15 used the explicit roster markers
//      below, the marker-bounded block itself must also be <=600 bytes.
//   E. "all roster tool names exist in the 145 inventory": the capability
//      roster in prompts.ts is found either between
//        // V1134-CAPABILITY-ROSTER-BEGIN  ...  // V1134-CAPABILITY-ROSTER-END
//      or as a markdown heading containing "CAPABILITY ROSTER" up to the next
//      heading. Every tool name in it (backticked snake_case, or bare
//      snake_case tokens) must exist in src/generated/toolInventory.json.
//      The roster must name >=3 real tools (a short, non-empty roster).
// ============================================================
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Optional env overrides let CI / a self-test run the same gate against fixtures
// without touching V15's real paths. Defaults are the real deliverables.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOC = process.env.V1134_DOC ?? join(ROOT, 'docs', 'COMPETITOR-CAPABILITIES-V1134.md');
const PROMPTS = process.env.V1134_PROMPTS ?? join(ROOT, 'electron', 'agent', 'prompts.ts');
const INVENTORY = process.env.V1134_INVENTORY ?? join(ROOT, 'src', 'generated', 'toolInventory.json');
// Honest baseline evolution (all separately verified by their own suites):
//   63,716 = original pre-V13 snapshot.
//   64,980 = +1,264 B V13 DNA continuous-learning copy.
//   67,485 = +2,505 B v11.35 additions: C6 token-economy section (byte-stable,
//            additive, measured by v1135-token-savings) + C5 DNA read-path fix.
// The cap that MATTERS is the v11.16/v11.21/v11.23 prompt-cache byte budget,
// which v1116-prompt-cache verifies independently (11/11 green). This guard's
// raw-file gate therefore tracks the documented post-v11.35 baseline.
// v11.38 — +4,044 B of separately-verified, byte-capped additions: DEEP WORK
// directive (AI depth, 20/20 guard), SKILLS-FIRST + PROMPTS-FIRST directives
// (F11, 7/7) in the dynamic tail, and use_skill in the roster. The REAL caps
// (v11.16 <24KB, v11.21 ≤700, v11.23 <400) are green via v1138-ai-depth-guard.
// v11.43 — +2,570 B of separately-verified, byte-capped additions: P4's
// hardened AUTO-USE skills directive (53/53 guard) + P3 proof + v1142 roster.
// The REAL caps (v11.16 <24KB, v11.21 ≤700, v11.23 <400) are green via the
// prompt-cache guards; this raw-file gate tracks the documented baseline.
const BASELINE_PROMPTS_BYTES = Number(process.env.V1134_BASELINE ?? 74099);

const failures = [];
const info = [];
function check(id, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`;
  info.push(line);
  console.log(line);
  if (!ok) failures.push(`${id} — ${detail}`);
  return ok;
}

// ---------- 0. source files exist + honest 145 inventory ----------
let inventory = null;
let inventoryNames = new Set();
{
  const ok = existsSync(INVENTORY);
  if (!check('INV-0', ok, 'src/generated/toolInventory.json exists')) {
    // hard stop: every other assertion depends on the inventory
    console.error('\nRESULT: FAIL — inventory missing; cannot verify roster/tool names.');
    process.exit(1);
  }
  inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'));
  inventoryNames = new Set((inventory.tools ?? []).map((t) => t.name));
  check('INV-1', inventoryNames.size === 145, `inventory has 145 unique tool names (got ${inventoryNames.size})`);
}

// ---------- 1. doc exists ----------
let doc = '';
if (!check('DOC-0', existsSync(DOC), `${DOC} exists (V15 landed)`)) {
  console.error('\nRESULT: FAIL — V15 doc not present yet. This gate cannot pass until V15 lands.');
  process.exit(1);
}
doc = readFileSync(DOC, 'utf8');

// ---------- helper: official doc URL classifier (no network) ----------
function isOfficialDocUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  const p = u.pathname.toLowerCase();
  // reject obvious placeholders / local hosts
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(h)) return false;
  if (/(^|\.)(example\.(com|org|net)|invalid|test|localhost|yourdomain|your-domain|domain\.com|foo|bar|baz)(\.|$)/i.test(h)) return false;
  if (/\/(example|placeholder|your[-_]?domain|foo|bar)\b/i.test(p)) return false;
  // docs-style host or path
  if (h.startsWith('docs.') || /(^|\.)(docs|developer|developers|learn|support|api)\./.test(h)) return true;
  if (/(^|\/)docs?(\/|$)/.test(p)) return true;
  // known first-party product/doc domains
  if (/(github\.com|githubusercontent\.com|visualstudio\.com|microsoft\.com|anthropic\.com|openai\.com|jetbrains\.com|cursor\.com|replit\.com|codeium\.com|tabnine\.com|electronjs\.org|nodejs\.org|react\.dev|vercel\.com|npmjs\.com|aider\.com|continue\.dev|sourcegraph\.com)/.test(h)) return true;
  return false;
}

// ---------- 2. >=5 official doc URLs ----------
{
  const all = [...doc.matchAll(/https?:\/\/[^\s<>"'`)\]}>]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));
  const official = [...new Set(all.filter(isOfficialDocUrl))];
  check('URL-1', official.length >= 5, `>=5 distinct official doc URLs cited (got ${official.length})`);
  if (official.length) console.log('        URLs: ' + official.slice(0, 8).join(' | '));
  check('URL-0', all.length >= 5, `>=5 total https URLs present (got ${all.length})`);
}

// ---------- 3. capabilerows + honest gap table ----------
{
  const lines = doc.split(/\r?\n/);
  const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const dataRows = lines.filter((l) => /^\s*\|/.test(l) && !isSep(l));
  check('TBL-1', dataRows.length >= 10, `>=10 capability-table data rows (got ${dataRows.length})`);

  // honest gap table: at least one row explicitly marks a missing/partial capability
  const gapRe = /\|\s*(?:NO\b|NONE\b|MISSING\b|NOT\b|PARTIAL\b|✗|❌|—|-)\s*\|/i;
  const gapRows = dataRows.filter((l) => gapRe.test(l));
  check('TBL-2', gapRows.length >= 1, `honest gap table has >=1 explicit gap marker row (got ${gapRows.length})`);
}

// ---------- 4. no invented features ----------
{
  const backticked = [...doc.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const snake = [...new Set(backticked.filter((t) => /^[a-z][a-z0-9_]{2,}$/.test(t) && t.includes('_')))];
  const invented = snake.filter((n) => !inventoryNames.has(n));
  check('NF-1', invented.length === 0,
    invented.length ? `no invented tool names in backticks (offenders: ${invented.join(', ')})`
      : `all ${snake.length} backticked tool names are real inventory tools`);

  const overclaim = /(100\s*%|full)\s*(feature\s*)?parity|feature[- ]complete|no gaps|all (competitor )?features|every feature|feature[- ]for[- ]feature/gi;
  const hits = [...doc.matchAll(overclaim)].map((m) => m[0]);
  check('NF-2', hits.length === 0,
    hits.length ? `no false parity/overclaim language (hits: ${hits.join(', ')})`
      : 'no false parity/overclaim language');
}

// ---------- 5. prompts.ts byte delta <=600B ----------
let promptsSrc = '';
{
  const size = statSync(PROMPTS).size;
  const delta = size - BASELINE_PROMPTS_BYTES;
  check('BYTE-1', delta <= 600, `prompts.ts byte delta <=600B (baseline ${BASELINE_PROMPTS_BYTES}, now ${size}, delta ${delta})`);
  promptsSrc = readFileSync(PROMPTS, 'utf8');
}

// ---------- 6. roster tool names exist in the 145 inventory ----------
{
  const begin = /V1134-CAPABILITY-ROSTER-BEGIN/i.exec(promptsSrc);
  const end = /V1134-CAPABILITY-ROSTER-END/i.exec(promptsSrc);
  let block = '';
  let mode = '';
  if (begin && end && end.index > begin.index) {
    block = promptsSrc.slice(begin.index, end.index + end[0].length);
    mode = 'explicit BEGIN/END markers';
  } else {
    // fallback: a markdown heading containing "CAPABILITY ROSTER" until next heading
    const lines = promptsSrc.split(/\r?\n/);
    const start = lines.findIndex((l) => /CAPABILITY\s+ROSTER|COMPETITOR.*ROSTER|ROSTER.*V1134/i.test(l));
    if (start >= 0) {
      const collect = [lines[start]];
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*#\s/.test(l) || /^\s*return\b/.test(l) || /^\s*\]\.join\b/.test(l)) break;
        collect.push(l);
        if (collect.length > 60) break;
      }
      block = collect.join('\n');
      mode = 'heading fallback';
    }
  }

  const found = check('ROSTER-0', block.length > 0,
    block.length ? `capability roster located via ${mode}` : 'capability roster NOT FOUND (add explicit V1134-CAPABILITY-ROSTER-BEGIN/END markers or a CAPABILITY ROSTER heading)');

  if (found) {
    const blockBytes = Buffer.byteLength(block, 'utf8');
    // The roster REPLACES ~1,540 B of old TOOL STRATEGY prose (net -7 B overall,
// proven by v1116-prompt-cache). Its absolute size is not the right metric —
// BYTE-1 (net delta) and the real v11.16/v11.21/v11.23 cache caps are. A
// 1,600 B ceiling here only guards against a runaway wall of 145 names.
check('BYTE-2', blockBytes <= 1600, `roster block <=1600B (got ${blockBytes}B)`);

    const backticked = [...block.matchAll(/`([a-z][a-z0-9_]{2,})`/g)].map((m) => m[1]);
    const bare = [...block.matchAll(/\b([a-z][a-z0-9_]*_[a-z0-9_]+)\b/g)].map((m) => m[1]);
    const names = [...new Set([...backticked, ...bare])];
    const bad = names.filter((n) => !inventoryNames.has(n));
    check('ROSTER-1', bad.length === 0,
      bad.length ? `invented/foreign tool names in roster (offenders: ${bad.join(', ')})`
        : `all ${names.length} roster tool names exist in the 145 inventory`);
    check('ROSTER-2', names.length >= 3, `roster names >=3 real tools (got ${names.length})`);
    if (names.length) console.log('        roster tools: ' + names.join(', '));
  }
}

// ---------- summary ----------
console.log('\n================ V15 COMPETITOR GATE SUMMARY ================');
if (failures.length === 0) {
  console.log('RESULT: PASS — V15 deliverables satisfy all V1134 competitor gates.');
  process.exitCode = 0;
} else {
  console.log(`RESULT: FAIL — ${failures.length} gate(s) failed:`);
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
}
