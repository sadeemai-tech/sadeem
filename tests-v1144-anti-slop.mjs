#!/usr/bin/env node
// =============================================================================
// V1144 — ANTI-SLOP + INTEGRATION HONESTY GUARD  (DIAGNOSIS + TEST ONLY)
// -----------------------------------------------------------------------------
// Run from anywhere:  node tests-v1144-anti-slop.mjs
//   --no-guards       skip orchestrating the existing guard suites
//   --json            emit machine-readable findings instead of the report
//
// This file NEVER edits source. It reads:
//   website/app/**/*.tsx, website/components/**/*.tsx, website/lib/site.ts
// and reports exact file:line for:
//   1. BANNED SLOP (founder's hype list) — EN + AR
//   2. INTERNAL LEAKS (staging/build/billing tokens, decorative 64-hex)
//   3. MIXED-LANGUAGE prose (one string with both EN + AR sentences)
//   4. FALSE-CLAIM WATCH (unverifiable 20+ / 12-subagent / 100% stats)
//   5. i18n duplicate keys, conflict markers, new-file wiring, CSS collisions
//   6. pass/fail of every existing guard (hero-honesty, homepage-seo, seo,
//      v1141 / v1142 / v1143 suites)
//
// NOTE ON "first": the founder bans the HYPE use ("the first AI agent"),
// not the literal use ("local-first", "first run", "newest-first"). This
// guard classifies every hit so a literal hit is never mistaken for hype.
// See docs/INTEGRATION-V1144.md.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = path.join(ROOT, 'website');
const NO_GUARDS = process.argv.includes('--no-guards');
const JSON_MODE = process.argv.includes('--json');

const SKIP_DIR = new Set(['node_modules', '.next', '.vercel', 'dist', 'build', 'release', '.git', 'out']);
const FINDINGS = []; // { id, sev, kind, file, line, text, verdict, why }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function add(id, sev, kind, file, line, text, verdict, why) {
  FINDINGS.push({ id, sev, kind, file, line, text, verdict, why });
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------
function walk(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name), exts));
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const lineAt = (src, index) => src.slice(0, index).split('\n').length;

function extractStrings(src) {
  const out = [];
  // single / double / template literals (template may span lines)
  const re = /'((?:\\.|[^'\\\r\n])*)'|"((?:\\.|[^"\\\r\n])*)"|`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({ line: lineAt(src, m.index), text: m[1] ?? m[2] ?? m[3] ?? '', where: 'str' });
  }
  // JSX text nodes (coarse, but enough for slop detection)
  const jre = />\s*([^<>{}]{2,})\s*</g;
  while ((m = jre.exec(src))) {
    const t = m[1].trim();
    if (!/[\p{L}]/u.test(t) || /[=(){};]/.test(t)) continue;
    out.push({ line: lineAt(src, m.index), text: t, where: 'jsx' });
  }
  return out;
}

// Files in scope of the prose scan.
const PROSE = [
  ...walk(path.join(WEB, 'app'), ['.tsx']),
  ...walk(path.join(WEB, 'components'), ['.tsx']),
  path.join(WEB, 'lib', 'site.ts'),
].map((p) => {
  const raw = read(p);
  const code = stripComments(raw);
  return { p, rel: rel(p), raw, code, strings: extractStrings(code) };
});

// Files that actually render. Homepage showcase helpers are known orphans.
const ORPHAN_COMPONENTS = new Set([
  'website/components/home/HomeContent.tsx',
  'website/components/home/TerminalDemo.tsx',
  'website/components/home/Reveal.tsx',
  'website/components/home/ProviderLogo.tsx',
]);
const isLive = (f) => !ORPHAN_COMPONENTS.has(f);

// =============================================================================
// 1. BANNED SLOP
// =============================================================================
const EN_HARD = ['unbeatable', 'seamless', 'revolutionary', 'supercharge', 'supercharged',
  'powerful', 'game-changing', 'game changing'];
const EN_UNLOCK = /\bunlock\w*\b/i;

// "first" — hype only under these patterns.
const FIRST_HYPE = [
  /\bthe\s+first\s+(?:ever|of\s+its\s+kind|in\s+the\s+world|and\s+(?:the\s+)?only)\b/i,
  /\bworld'?s\s+first\b/i,
  /\bfirst\s+of\s+its\s+kind\b/i,
  /\bfirst\s+ever\b/i,
  /(?<![\w-])\bfirst[\s-]+(?:ai|local)[\s-]+(?:coding\s+)?(?:agent|assistant|tool)\b/i,
];
// Arabic regexes must NOT match inside longer words (e.g. سلس inside سلسلة
// "series", or قوي inside قوية). Boundaries are Arabic letters.
const AR_W = (s) => new RegExp('(?<![\\u0600-\\u06FF])' + s + '(?![\\u0600-\\u06FF])');
const AR_HARD = [
  ['في المقدمة', /في\s+المقدمة/],
  ['الأفضل', AR_W('الأفضل')],
  ['لا مثيل له', /لا\s+مثيل\s+له/],
  ['ثورة', AR_W('ثورة')],
  ['قوي', AR_W('قوي')],
  ['سلس', AR_W('سلس')],
  ['اطلاق العنان', /إ?طلاق\s+العنان/],
];
// Arabic "الأول" is literal in these contexts; hype otherwise.
const AR_FIRST_LITERAL = /المرة\s+الأولى|التشغيل\s+الأول|الأولى\b|أولاً|أولا\b|الأول\s+والثاني|المرة\s+الأولى/;
const AR_FIRST_HYPE = /الأول\s+عالمياً|وكيل\s+الأول|الأول\s+في\s+العالم|أول\s+وكيل/;

let slopHard = 0, slopFirst = 0, slopFirstLiteral = 0, slopAr = 0, slopArLiteral = 0;

for (const f of PROSE) {
  for (const s of f.strings) {
    const t = s.text;
    // EN hard slop
    for (const w of EN_HARD) {
      if (new RegExp('\\b' + esc(w) + '\\b', 'i').test(t)) {
        slopHard++;
        add('SL-EN', 'FAIL', 'slop', f.rel, s.line, t.slice(0, 180), 'HYPE',
          `banned hype adjective "${w}"`);
      }
    }
    if (EN_UNLOCK.test(t)) {
      slopHard++;
      add('SL-EN', 'FAIL', 'slop', f.rel, s.line, t.slice(0, 180), 'HYPE', 'banned hype verb "unlock"');
    }
    // "first" classification
    if (/\bfirst\b/i.test(t)) {
      const hype = FIRST_HYPE.some((r) => r.test(t));
      if (hype) {
        slopFirst++;
        add('SL-FIRST', 'FAIL', 'slop', f.rel, s.line, t.slice(0, 180), 'HYPE',
          'definite/superlative "first" claim');
      } else {
        slopFirstLiteral++;
        add('SL-FIRST', 'INFO', 'slop', f.rel, s.line, t.slice(0, 180), 'LITERAL',
          'literal "first" (local-first / first-run / newest-first / ordinal) — not hype');
      }
    }
    // Arabic hard slop
    for (const [label, r] of AR_HARD) {
      if (!r.test(t)) continue;
      if (label === 'في المقدمة' && /والخلفية|في\s+الخلفية|foreground|background|البنى\s+والاختبارات/i.test(t)) {
        slopArLiteral++;
        add('SL-AR', 'INFO', 'slop', f.rel, s.line, t.slice(0, 180), 'LITERAL',
          '"في المقدمة" means foreground (vs background processes), not "in the lead"');
        continue;
      }
      slopAr++;
      add('SL-AR', 'FAIL', 'slop', f.rel, s.line, t.slice(0, 180), 'HYPE', `banned Arabic hype "${label}"`);
    }
    if (/الأول/.test(t)) {
      if (AR_FIRST_HYPE.test(t)) {
        slopAr++;
        add('SL-AR', 'FAIL', 'slop', f.rel, s.line, t.slice(0, 180), 'HYPE', 'Arabic "الأول" superiority claim');
      } else {
        slopArLiteral++;
        add('SL-AR', 'INFO', 'slop', f.rel, s.line, t.slice(0, 180), 'LITERAL',
          'Arabic "الأول/الأولى" is ordinal (first time / first run) — not hype');
      }
    }
  }
}

// =============================================================================
// 2. INTERNAL LEAKS
// =============================================================================
const HEX64 = /\b[0-9a-fA-F]{64}\b/;
const LEAK_TOKENS = [
  ['0.0.0-stage', /0\.0\.0-stage/i, 'FAIL'],
  ['sha512:', /sha512\s*:/i, 'FAIL'],
  ['SHA256SUMS', /\bSHA256SUMS\b/i, 'FAIL'],
  ['npm view', /\bnpm\s+view\b/i, 'FAIL'],
  ['staged', /\bstaged\b/i, 'CTX'],
  ['billing', /\bbilling\b/i, 'CTX'],
  ['placeholder', /\bplaceholders?\b/i, 'CTX'],
  ['manual update', /\bmanual(?:ly)?\s+updates?\b|\bupdates?\s+are\s+manual\b/i, 'CTX'],
  ['BUILD', /\bBUILD\b/, 'CTX'],
  ['env', /\benv\b/i, 'CTX'],
  ['token', /\btokens?\b/i, 'CTX'],
  ['debug', /\bdebug\w*\b/i, 'CTX'],
  ['publish', /\bpublish\w*\b/i, 'CTX'],
];
let leakHard = 0, leakCtx = 0;

for (const f of PROSE) {
  for (const s of f.strings) {
    const t = s.text;
    const hm = HEX64.exec(t);
    if (hm) {
      const okVerify = /Sha256|checksum/i.test(f.rel) || /checksum|بصمة/i.test(t)
        || f.rel.endsWith('lib/site.ts');
      if (okVerify) {
        add('LK-HEX', 'INFO', 'leak', f.rel, s.line, hm[0] + '…', 'OK-VERIFY',
          'real SHA-256 checksum disclosure — explicitly allowed (verify-before-run)');
      } else {
        leakHard++;
        add('LK-HEX', 'FAIL', 'leak', f.rel, s.line, hm[0] + '…', 'DECORATION-LEAK',
          '64-hex string outside a checksum field — decorative internal build hash');
      }
    }
    for (const [label, r, base] of LEAK_TOKENS) {
      if (!r.test(t)) continue;
      let verdict = base, why = `internal token "${label}"`;
      if (label === 'staged' && /staged[,\s]+unstaged/.test(t)) {
        verdict = 'OK-GIT'; why = 'git status terminology, not a staging-environment marker';
      } else if (label === 'placeholder' && /never a placeholder button/i.test(t)) {
        verdict = 'OK-HONEST'; why = 'honest "never a placeholder button" copy';
      } else if (label === 'placeholder' && /placeholders? are filled in|header placeholders/i.test(t)) {
        verdict = 'WARN'; why = 'reveals internal MCP config-card UI detail';
      } else if (label === 'manual update') {
        verdict = 'OK-HONEST'; why = 'honest release-status disclosure (updates are manual)';
      } else if (label === 'BUILD' && (/^(BUILD|PLAN|DEBUG|REVIEW|THINK|WORK|RUN|PROVE)$/.test(t)
        || /THINK\s*\/\s*WORK\s*\/\s*BUILD|phase timeline/i.test(t))) {
        verdict = 'OK-PRODUCT'; why = 'product task-mode / phase label, not a build marker';
      } else if (label === 'BUILD' && /\b(?:stable|unsigned|portable|signed|this)\s+build\b/i.test(t)) {
        verdict = 'OK-LITERAL'; why = '"build" as compiled artifact, not a staging marker';
      } else if (label === 'env' && (/stdio|http|oauth|headers/i.test(t) || /^env$/i.test(t))) {
        verdict = 'OK-TECHNICAL'; why = 'MCP transport / config key, not an env-var leak';
      } else if (label === 'token' && /refresh[- ]tokens?|token rotation/i.test(t)) {
        verdict = 'OK-TECHNICAL'; why = 'auth flow name, not an internal secret';
      } else if (label === 'debug') {
        verdict = 'OK-TECHNICAL'; why = 'tool / agent / mode name';
      } else if (label === 'publish' && /not published|once .* published|never published|until .* published|when the release is published|have not been posted/i.test(t)) {
        verdict = 'OK-STATUS'; why = 'honest release-status disclosure ("not published yet")';
      } else if (label === 'publish' && /publisher|published[^.]{0,30}checksums|checksums?[^.]{0,30}published|published\s+(?:package|CLI|artifact|binary|binaries)/i.test(t)) {
        verdict = 'OK-LITERAL'; why = 'schema/publisher vocabulary, published artifact, or checksum disclosure';
      }
      if (verdict === 'FAIL') leakHard++; else leakCtx++;
      add('LK-' + label.toUpperCase().replace(/[^A-Z]/g, ''), verdict === 'FAIL' ? 'FAIL' : 'INFO',
        'leak', f.rel, s.line, t.slice(0, 180), verdict, why);
    }
  }
}

// =============================================================================
// 3. MIXED-LANGUAGE PROSE
// =============================================================================
const BRANDS = [
  'SADEEM', 'سديم', 'BYOK', 'MCP', 'API', 'RTL', 'LTR', 'SHA-256', 'HMAC', 'NSIS',
  'ZIP', 'Windows', 'PowerShell', 'CMD', 'PLAYBOOK.md', 'JSON', 'JSON-LD', 'OAuth',
  'stdio', 'http', 'headers', 'env', 'GitHub', 'Figma', 'Supabase', 'Playwright',
  'Notion', 'OpenAI', 'Anthropic', 'Google', 'Ollama', 'OpenRouter', 'Mistral',
  'DeepSeek', 'xAI', 'Groq', 'Azure', 'LM Studio', 'Together', 'Claude', 'GPT',
  'Gemini', 'GLM', 'Linear', 'Stripe', 'Blender', 'Maya', 'Hugging Face', 'Context7',
  'SmartScreen', 'Web Crypto', 'localStorage', 'README', 'PLAYBOOK', 'SADEEM.exe',
  'sadeem', 'npm', 'curl', 'bash', 'PowerShell', 'VS Code', 'Zed', 'Cursor',
];
const brandRe = new RegExp(BRANDS.map((b) => esc(b)).join('|') + '|https?://\\S+|/[^\\s]+', 'gi');
let mixed = 0;
for (const f of PROSE) {
  for (const s of f.strings) {
    const t = s.text;
    if (!/[\u0600-\u06FF]/.test(t) || !/[A-Za-z]{3,}/.test(t)) continue;
    const clean = t.replace(brandRe, ' ');
    const enSentence = /[A-Za-z]{2,}(?:\s+[A-Za-z',’.-]+){2,}[.!?]?/.test(clean);
    const arSentence = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]+){2,}/.test(clean);
    if (enSentence && arSentence) {
      mixed++;
      add('MIX', 'FAIL', 'mixed', f.rel, s.line, t.slice(0, 180), 'MIXED',
        'single string carries both an English sentence and an Arabic sentence');
    }
  }
}

// =============================================================================
// 4. FALSE-CLAIM WATCH (unverifiable stats established by v1140/v1143 audits)
// =============================================================================
const FALSE_CLAIMS = [
  [/20\+|Twenty-plus|أكثر من عشرين|أكثر من ٢٠/, 'unverifiable "20+ MCP servers" — servers are user-configured, no fixed catalog'],
  [/\b12\s+(?:specialist\s+)?(?:sub)?agents?\b|\b12\s+وكيل/, 'false subagent count — roster is 16 (electron/agent/agents.ts)'],
  [/100%\s*(?:local|محلي)/i, 'absolute "100% local" overstates offline capability'],
];
let falseClaims = 0;
for (const f of PROSE) {
  if (!isLive(f.rel)) continue;
  for (const s of f.strings) {
    for (const [r, why] of FALSE_CLAIMS) {
      if (r.test(s.text)) {
        falseClaims++;
        add('FC', 'FAIL', 'false-claim', f.rel, s.line, s.text.slice(0, 180), 'FALSE', why);
      }
    }
  }
}
// Also attribute the false claim on the "catalog" lead line even though it is
// spelled out ("Twenty-plus") — already covered above.

// =============================================================================
// 5. i18n / CONFLICT MARKERS / WIRING / CSS COLLISIONS
// =============================================================================
// 5a. duplicate i18n keys
const i18nPath = path.join(ROOT, 'src', 'i18n.ts');
let i18nDup = 0, i18nKeys = 0;
if (fs.existsSync(i18nPath)) {
  const code = stripComments(read(i18nPath));
  const keys = [...code.matchAll(/^\s*['"]([^'"]+)['"]\s*:\s*\[/gm)].map((m) => m[1]);
  i18nKeys = keys.length;
  const seen = new Map();
  for (let i = 0; i < keys.length; i++) {
    if (seen.has(keys[i])) {
      const prev = seen.get(keys[i]);
      i18nDup++;
      add('I18N', 'FAIL', 'i18n', 'src/i18n.ts', prev,
        keys[i], 'DUPLICATE', `key "${keys[i]}" duplicated (first near line ${prev})`);
    } else seen.set(keys[i], lineAt(code, code.indexOf(keys[i])));
  }
}

// 5b. conflict markers
const ALL_SRC = [
  ...walk(ROOT, ['.ts', '.tsx', '.mjs', '.js', '.css', '.json']),
  ...walk(path.join(WEB, 'app'), ['.ts', '.tsx', '.mjs', '.css']),
  ...walk(path.join(WEB, 'components'), ['.ts', '.tsx', '.css']),
  ...walk(path.join(WEB, 'lib'), ['.ts', '.tsx']),
];
let conflicts = 0;
const seenFiles = new Set();
for (const p of ALL_SRC) {
  if (seenFiles.has(p)) continue;
  seenFiles.add(p);
  const lines = read(p).split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/^<<<<<<<|^>>>>>>>/.test(l)) {
      conflicts++;
      add('CONFLICT', 'FAIL', 'conflict', rel(p), i + 1, l.trim(), 'MARKER', 'merge conflict marker');
    }
  });
}

// 5c. new-file wiring
const wiring = [];
function wired(needle, searchDirs) {
  for (const d of searchDirs) {
    for (const p of walk(d, ['.tsx', '.ts', '.css'])) {
      if (p.endsWith(needle)) continue;
      if (read(p).includes(path.basename(needle))) return rel(p);
    }
  }
  return '';
}
const APP = path.join(WEB, 'app');
for (const sheet of ['art-motion.css', 'home.css', 'app-mock.css', 'hero-panels.css']) {
  const by = wired(sheet, [APP, path.join(WEB, 'components')]);
  wiring.push({ sheet, by });
  if (!by) add('WIRE', 'FAIL', 'wiring', 'website/app', 0, sheet, 'ORPHAN', 'CSS sheet is never imported');
}
const seoMounted = (() => {
  const p = path.join(APP, 'page.tsx');
  const s = fs.existsSync(p) ? read(p) : '';
  return /import\s*\{\s*SEOContent\s*\}/.test(s) && /<SEOContent\s*\/?>/.test(s);
})();
if (!seoMounted) add('WIRE', 'FAIL', 'wiring', 'website/app/page.tsx', 0, 'SEOContent', 'UNMOUNTED', 'SEOContent not imported/mounted');
// orphan components (informational)
for (const f of ORPHAN_COMPONENTS) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  add('WIRE', 'INFO', 'wiring', f, 0, 'component export', 'ORPHAN',
    'never imported — dead code; contains legacy claim/copy (safe today, risky if wired)');
}

// 5d. CSS collisions across the three named sheets + siblings
// Mini-parser: extract (selector, scope) -> declarations, tracking the enclosing
// at-rule so a base rule is never compared against a @media/@supports override.
function parseCssRules(src, fileRel) {
  const rules = [];
  const kf = new Map();
  let i = 0, buf = '', scopeStack = [], atStack = 0;
  while (i < src.length) {
    if (src[i] === '@') {
      let j = i;
      while (j < src.length && src[j] !== '{' && src[j] !== ';') j++;
      const header = src.slice(i, j).trim().replace(/\s+/g, ' ');
      if (src[j] === '{') {
        const km = header.match(/@keyframes\s+([\w-]+)/);
        if (km) {
          if (!kf.has(km[1])) kf.set(km[1], []);
          kf.get(km[1]).push(`${fileRel}:${lineAt(src, i)}`);
        }
        scopeStack.push(header); atStack++;
        buf = ''; i = j + 1; continue;
      }
      i = j + 1; continue;
    }
    if (src[i] === '{') {
      const sel = buf.trim().replace(/\s+/g, ' ');
      const line = lineAt(src, i);
      let depth = 1, k = i + 1;
      while (k < src.length && depth > 0) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}') depth--;
        k++;
      }
      const body = src.slice(i + 1, k - 1);
      const scope = scopeStack[scopeStack.length - 1] || '';
      if (sel && !scope.startsWith('@keyframes')) {
        const props = new Map();
        for (const decl of body.split(';')) {
          const c = decl.indexOf(':');
          if (c < 0) continue;
          const prop = decl.slice(0, c).trim();
          const val = decl.slice(c + 1).trim();
          if (prop && val) props.set(prop, val);
        }
        for (const one of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
          rules.push({ sel: one, line, scope, props });
        }
      }
      buf = ''; i = k; continue;
    }
    if (src[i] === '}') {
      if (atStack > 0) { scopeStack.pop(); atStack--; }
      buf = ''; i++; continue;
    }
    if (buf.trim() === '' && /\s/.test(src[i])) { i++; continue; }
    buf += src[i]; i++;
  }
  return { rules, kf };
}
const CSS_FILES = [
  ...walk(APP, ['.css']),
  ...walk(path.join(WEB, 'components', 'visuals'), ['.css']),
];
// A stylesheet is "wired" only if some import literally resolves to it.
const importSources = [...walk(APP, ['.tsx', '.ts', '.css']), ...walk(path.join(WEB, 'components'), ['.tsx', '.ts', '.css'])];
function isCssWired(target) {
  const base = path.basename(target);
  for (const src of importSources) {
    if (path.resolve(src) === path.resolve(target)) continue;
    const txt = read(src);
    const re = new RegExp("(?:import|@import)\\s+['\"]\\./" + esc(base) + "['\"]", 'g');
    if (!re.test(txt)) continue;
    if (path.resolve(path.dirname(src), './' + base) === path.resolve(target)) return rel(src);
  }
  return '';
}
const cssWired = new Map(CSS_FILES.map((p) => [rel(p), isCssWired(p)]));
for (const [sheet, by] of cssWired) {
  if (by) continue;
  add('WIRE', 'INFO', 'wiring', sheet, 0, 'stylesheet', 'ORPHAN-SHEET',
    'never imported — duplicate/orphan sheet; its selectors cannot win the cascade');
}
const sheetRules = new Map(); // `${sel}||${scope}` -> [{file,line,props}]
const kfNames = new Map();    // name -> [file:line]
for (const p of CSS_FILES) {
  const frel = rel(p);
  const s = read(p).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const { rules, kf } = parseCssRules(s, frel);
  for (const [name, where] of kf) {
    if (!kfNames.has(name)) kfNames.set(name, []);
    kfNames.get(name).push(...where);
  }
  for (const r of rules) {
    const key = `${r.sel}||${r.scope}`;
    if (!sheetRules.has(key)) sheetRules.set(key, []);
    sheetRules.get(key).push({ file: frel, line: r.line, props: r.props });
  }
}
let cssCollisions = 0, kfCollisions = 0;
for (const [key, decls] of sheetRules) {
  const files = new Set(decls.map((d) => d.file));
  if (files.size < 2) continue; // same-file redefinition = intentional cascade
  const [sel, scope] = key.split('||');
  const propMap = new Map();
  for (const d of decls) {
    for (const [prop, val] of d.props) {
      if (!propMap.has(prop)) propMap.set(prop, []);
      propMap.get(prop).push({ val, file: d.file, where: `${d.file}:${d.line}` });
    }
  }
  for (const [prop, entries] of propMap) {
    // A real collision needs two DIFFERENT files disagreeing on the value.
    // Two values inside one file are an intentional cascade override.
    const cross = [];
    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        if (entries[a].file !== entries[b].file && entries[a].val !== entries[b].val) {
          cross.push(entries[a], entries[b]);
        }
      }
    }
    if (cross.length) {
      const uniq = [...new Map(cross.map((e) => [e.where + '=' + e.val, e])).values()];
      const orphan = uniq.filter((e) => !cssWired.get(e.file));
      if (orphan.length) {
        add('CSS', 'INFO', 'css', uniq[0].file, +uniq[0].where.split(':').pop(),
          `${sel}${scope ? ' @ ' + scope : ''} { ${prop} }`, 'ORPHAN-SHEET',
          `conflict ${prop} only across unwired sheets: ${uniq.map((e) => `${e.where}=${e.val}`).join(' vs ')}`);
      } else {
        cssCollisions++;
        add('CSS', 'FAIL', 'css', uniq[0].file, +uniq[0].where.split(':').pop(),
          `${sel}${scope ? ' @ ' + scope : ''} { ${prop} }`, 'COLLISION',
          `cross-file conflict ${prop}: ${uniq.map((e) => `${e.where}=${e.val}`).join(' vs ')}`);
      }
    }
  }
}
for (const [name, where] of kfNames) {
  if (where.length > 1) {
    const files = new Set(where.map((w) => w.split(':')[0]));
    if (files.size > 1) {
      kfCollisions++;
      add('CSS', 'FAIL', 'css', [...files][0], 0, `@keyframes ${name}`, 'DUP-KEYFRAME',
        `duplicate keyframe name in ${where.join(', ')}`);
    }
  }
}

// =============================================================================
// 6. RUN ALL EXISTING GUARDS
// =============================================================================
const GUARDS = [
  ['hero-honesty', ROOT, 'tests-v1140-hero-honesty.mjs'],
  ['homepage-seo', ROOT, 'website/tests-homepage-seo.mjs'],
  ['seo(47)', ROOT, 'tests-v1142-seo.mjs'],
  ['v1141-hero-visual', ROOT, 'tests-v1141-hero-visual.mjs'],
  ['v1141-hero-mosaic', ROOT, 'tests-v1141-hero-mosaic.mjs'],
  ['v1142-hero-light', ROOT, 'tests-v1142-hero-light.mjs'],
  ['v1142-hero-panels', ROOT, 'tests-v1142-hero-panels.mjs'],
];
for (const d of walk(path.join(ROOT, 'tests'), ['.test.mjs'])) {
  const b = path.basename(d);
  if (/^v114[23]-/.test(b)) GUARDS.push([b.replace(/\.test\.mjs$/, ''), ROOT, rel(d)]);
}
const GUARD_RESULTS = [];
for (const [name, cwd, script] of GUARDS) {
  if (!fs.existsSync(path.join(cwd, script))) {
    GUARD_RESULTS.push({ name, status: 'MISSING', detail: script + ' not found' });
    continue;
  }
  const r = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', timeout: 120000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const last = out.split('\n').filter((l) => /RESULT|PASS|FAIL|#[ ]*pass|#[ ]*fail|tests passed|tests failed/i.test(l)).slice(-2).join(' | ');
  GUARD_RESULTS.push({ name, status: r.status === 0 ? 'PASS' : 'FAIL', detail: last || `exit ${r.status}` });
}

// =============================================================================
// REPORT
// =============================================================================
const counts = {
  slopHard, slopFirst, slopFirstLiteral, slopAr, slopArLiteral,
  leakHard, leakCtx, mixed, falseClaims, i18nKeys, i18nDup,
  conflicts, cssCollisions, kfCollisions,
};
const hardFail = slopHard + slopFirst + slopAr + leakHard + mixed + falseClaims
  + i18nDup + conflicts + cssCollisions + kfCollisions;

if (JSON_MODE) {
  console.log(JSON.stringify({ counts, findings: FINDINGS, guards: GUARD_RESULTS, hardFail, cssWired: Object.fromEntries(cssWired) }, null, 2));
  process.exit(hardFail ? 1 : 0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log('=============================================================================');
console.log(' V1144 — ANTI-SLOP + INTEGRATION HONESTY GUARD (diagnosis only, NO edits)');
console.log('=============================================================================');
console.log('');
console.log(`SLOP   : ${slopHard} hard hype | ${slopFirst} hype "first" | ${slopFirstLiteral} literal "first" | ${slopAr} AR hype | ${slopArLiteral} AR literal`);
console.log(`LEAKS  : ${leakHard} hard | ${leakCtx} context-classified (see rows)`);
console.log(`MIXED  : ${mixed} single-string EN+AR sentences`);
console.log(`FALSE  : ${falseClaims} unverifiable stat claims (live files)`);
console.log(`I18N   : ${i18nKeys} keys, ${i18nDup} duplicates`);
console.log(`MERGE  : ${conflicts} conflict markers`);
console.log(`CSS    : ${cssCollisions} property collisions, ${kfCollisions} duplicate keyframes (${CSS_FILES.length} sheets)`);
console.log('');
const sections = ['slop', 'leak', 'mixed', 'false-claim', 'i18n', 'conflict', 'wiring', 'css'];
for (const kind of sections) {
  const rows = FINDINGS.filter((f) => f.kind === kind);
  if (!rows.length) continue;
  console.log(`--- ${kind.toUpperCase()} (${rows.length}) ---`);
  for (const f of rows) {
    const loc = `${f.file}${f.line ? ':' + f.line : ''}`;
    console.log(`[${pad(f.sev, 4)}] ${pad(f.verdict, 15)} ${pad(loc, 62)} ${f.why}`);
    console.log(`         ${f.text}`);
  }
  console.log('');
}
if (!NO_GUARDS) {
  console.log('--- EXISTING GUARDS ---');
  for (const g of GUARD_RESULTS) {
    console.log(`[${pad(g.status, 7)}] ${pad(g.name, 26)} ${g.detail}`);
  }
  console.log('');
}
const gp = GUARD_RESULTS.filter((g) => g.status === 'PASS').length;
const gf = GUARD_RESULTS.filter((g) => g.status === 'FAIL').length;
console.log('=============================================================================');
console.log(`HARD FAILURES: ${hardFail}  |  GUARDS: ${gp} pass / ${gf} fail`);
console.log(`VERDICT: ${hardFail === 0 && gf === 0 ? 'CLEAN' : 'DIRTY — see rows above'}`);
console.log('=============================================================================');
process.exit(hardFail || gf ? 1 : 0);
