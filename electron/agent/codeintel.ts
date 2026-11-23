// ============================================================
// Surnia v7 — code intelligence (symbol index)
// Closes the #1 agent gap: code_search is a blind 200-file text
// scan — no LSP, no repo map, no symbol index. This module gives
// the agent real code understanding, pure Node, zero deps:
//   1. extractSymbols / extractImports — multi-language, regex +
//      structure heuristics (brace depth, indent depth, keyword
//      blocks). Pragmatic by design, not tree-sitter: a slightly
//      wrong symbol at line N beats no symbol at all.
//   2. CodeIndex — incremental (mtime+size keyed) index over a
//      repo root with definition search, reference search, blast
//      radius (impactOf), a budget-capped repo map and per-file
//      outlines. Caps: 8000 files, 60s per update, 512KB per
//      file — stop and report partial=true instead of hanging.
// Every public function is defensive: it NEVER throws. Failures
// degrade to empty results and bump stats.errors, mirroring the
// editEngine contract. No Electron imports — safe to bundle for
// CLI and tests alike.
// ============================================================
import { promises as fsp, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { HEURISTIC_FALLBACKS } from './lspLanguages';

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

/** Kinds a symbol can have across all supported languages. */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'impl'
  | 'module'
  | 'const'
  | 'variable';

export interface Symbol {
  name: string;
  kind: SymbolKind;
  /** 1-based declaration line (python: first decorator line when decorators are present). */
  line: number;
  /** 1-based end of the body — approximate (brace/indent/keyword matching), always >= line. */
  endLine: number;
  /** First line of the declaration, trimmed to 120 chars. */
  signature: string;
  /** Enclosing class/struct/interface/impl/module name, or null at top level. */
  container?: string | null;
}

export interface SymbolHit {
  symbol: Symbol;
  relPath: string;
  /** 3 = exact name, 2 = prefix, 1 = substring. */
  score: number;
}

export interface RefHit {
  relPath: string;
  line: number;
  /** The reference line, trimmed to 120 chars. */
  text: string;
}

export interface ImpactFile {
  relPath: string;
  refs: number;
  /** true when this file imports the module that defines the symbol. */
  imports: boolean;
}

export interface ImpactReport {
  symbol: Symbol | null;
  files: ImpactFile[];
  /** Machine-readable blast radius summary, e.g. `blast_radius name=Foo kind=class def=a.ts:8 files=3 refs=12 importers=1 radius=medium`. */
  summary: string;
}

export interface FindOpts {
  kind?: string;
  limit?: number;
}

export interface IndexStats {
  /** Files currently indexed. */
  files: number;
  /** Files actually read from disk during the last update(). */
  scanned: number;
  /** Files (re)indexed during the last update(). */
  changed: number;
  /** Cumulative errors since construction. */
  errors: number;
  /** true when caps (files/time) cut the last update short. */
  partial: boolean;
  durationMs: number;
  langs: Record<string, number>;
}

// ------------------------------------------------------------
// Language tables
// ------------------------------------------------------------

/** ext (no dot) -> language name(s); doubles as the "indexable extension" whitelist. */
export const LANGS: Record<string, string[]> = {
  ts: ['TypeScript'],
  tsx: ['TypeScript'],
  js: ['JavaScript'],
  jsx: ['JavaScript'],
  mjs: ['JavaScript'],
  cjs: ['JavaScript'],
  py: ['Python'],
  pyi: ['Python'],
  go: ['Go'],
  rs: ['Rust'],
  java: ['Java'],
  kt: ['Kotlin'],
  kts: ['Kotlin'],
  cs: ['C#'],
  dart: ['Dart'],
  c: ['C'],
  h: ['C', 'C++'],
  cpp: ['C++'],
  cxx: ['C++'],
  cc: ['C++'],
  hpp: ['C++'],
  hh: ['C++'],
  php: ['PHP'],
  rb: ['Ruby'],
  swift: ['Swift'],
  lua: ['Lua'],
  ex: ['Elixir'],
  exs: ['Elixir'],
  heex: ['Elixir'],
  r: ['R'],
  rmd: ['R'],
  zig: ['Zig'],
  zon: ['Zig'],
  sh: ['Shell'],
  bash: ['Shell'],
  zsh: ['Shell'],
  vue: ['Vue'],
  svelte: ['Svelte'],
  // v11.12+ — heuristic-only languages (NO LSP server is claimed for these).
  // Real regex/AST-lite extraction so symbol_outline / find_refs / repo_map
  // return useful results instead of an empty string.
  md: ['Markdown'], mdx: ['Markdown'],
  json: ['JSON'], jsonc: ['JSON'],
  yaml: ['YAML'], yml: ['YAML'],
  css: ['CSS'], scss: ['SCSS'], less: ['Less'],
  html: ['HTML'], htm: ['HTML'],
  sql: ['SQL'],
  ps1: ['PowerShell'], psm1: ['PowerShell'],
  dockerfile: ['Dockerfile'],
  hs: ['Haskell'], lhs: ['Haskell'],
  clj: ['Clojure'], cljs: ['Clojure'], cljc: ['Clojure'], edn: ['Clojure'],
  scala: ['Scala'],
  pl: ['Perl'], pm: ['Perl'],
  m: ['Objective-C'], mm: ['Objective-C'],
  graphql: ['GraphQL'], gql: ['GraphQL'],
};

type Family = 'js' | 'py' | 'go' | 'rs' | 'jvm' | 'cpp' | 'php' | 'ruby' | 'swift' | 'lua' | 'elixir' | 'r' | 'zig' | 'sh' | 'embed'
  | 'md' | 'data' | 'style' | 'html' | 'sql' | 'ps' | 'docker' | 'hs' | 'clj' | 'scala' | 'pl' | 'objc' | 'graphql';

const FAMILY_OF: Record<string, Family> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  py: 'py', pyi: 'py',
  go: 'go',
  rs: 'rs',
  java: 'jvm', kt: 'jvm', kts: 'jvm', cs: 'jvm', dart: 'jvm',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hh: 'cpp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  lua: 'lua',
  ex: 'elixir', exs: 'elixir', heex: 'elixir',
  r: 'r', rmd: 'r',
  zig: 'zig', zon: 'zig',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  vue: 'embed', svelte: 'embed',
  md: 'md', mdx: 'md',
  json: 'data', jsonc: 'data', yaml: 'data', yml: 'data',
  css: 'style', scss: 'style', less: 'style',
  html: 'html', htm: 'html',
  sql: 'sql',
  ps1: 'ps', psm1: 'ps',
  dockerfile: 'docker',
  hs: 'hs', lhs: 'hs',
  clj: 'clj', cljs: 'clj', cljc: 'clj', edn: 'clj',
  scala: 'scala',
  pl: 'pl', pm: 'pl',
  m: 'objc', mm: 'objc',
  graphql: 'graphql', gql: 'graphql',
};

/** Kinds whose span can enclose other symbols (used for container resolution). */
const CONTAINER_KINDS = new Set<SymbolKind>(['class', 'interface', 'struct', 'trait', 'impl', 'module']);

/** When a `function` sits inside a container of one of these kinds, it is re-kinded to `method`. */
const REKIND: Record<string, Set<SymbolKind>> = {
  js: new Set(['class', 'struct', 'interface', 'impl', 'trait']),
  jvm: new Set(['class', 'struct', 'interface', 'impl', 'trait']),
  cpp: new Set(['class', 'struct', 'interface', 'impl', 'trait']),
  go: new Set<SymbolKind>(), // methods come from the receiver syntax directly
  rs: new Set(['impl', 'trait', 'struct', 'enum']),
  py: new Set(['class']),
  php: new Set(['class', 'interface', 'trait']),
  ruby: new Set(['class', 'module']),
  swift: new Set(['class', 'struct', 'interface', 'impl', 'enum']),
  lua: new Set<SymbolKind>(),
  elixir: new Set(['class', 'module']),
  r: new Set<SymbolKind>(),
  zig: new Set(['struct', 'class']),
  sh: new Set<SymbolKind>(),
  embed: new Set(['class', 'struct', 'interface', 'impl', 'trait']),
  // heuristic-only families: containers are shallow (no reliable brace tree),
  // so no re-kindling — the declared kind is the honest one.
  md: new Set<SymbolKind>(),
  data: new Set<SymbolKind>(),
  style: new Set<SymbolKind>(),
  html: new Set<SymbolKind>(),
  sql: new Set<SymbolKind>(),
  ps: new Set<SymbolKind>(),
  docker: new Set<SymbolKind>(),
  hs: new Set<SymbolKind>(),
  clj: new Set<SymbolKind>(),
  scala: new Set<SymbolKind>(),
  pl: new Set<SymbolKind>(),
  objc: new Set<SymbolKind>(),
  graphql: new Set<SymbolKind>(),
};

const NO_REKIND = new Set<SymbolKind>();

// ------------------------------------------------------------
// Small shared helpers
// ------------------------------------------------------------

function extNoDot(p: string): string {
  const base = path.basename(String(p || ''));
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function langOf(p: string): string {
  const names = LANGS[extNoDot(p)];
  return names && names.length ? names[0] : 'Unknown';
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Visual width of leading whitespace (tab = 4) — borrowed from editEngine. */
function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

function leadingWs(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

/**
 * Strips comments and string/template-literal contents from every line while
 * preserving length and indentation, so brace counting / indent tracking and
 * declaration regexes all see only real code. State (strings, block comments,
 * template ${} nesting) carries ACROSS lines — a `}` inside a multi-line
 * template must not terminate a function body.
 */
type CommentStyle = 'c' | 'hash' | 'lua' | 'rs';

function codeLines(lines: string[], style: CommentStyle): string[] {
  const out: string[] = [];
  let inStr: string | null = null; // ", ' or `
  let tplDepth = 0; // ${ ... } nesting inside a template literal
  let inBlock = false; // /* ... */
  for (const raw of lines) {
    // Rust lifetimes ('a, 'static) are not strings — blank them before quote tracking.
    const line = style === 'rs' ? raw.replace(/'(?:[A-Za-z_]\w*|static)\b/g, ' L') : raw;
    let res = '';
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = j + 1 < line.length ? line[j + 1] : '';
      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          res += '   ';
          j++;
        } else {
          res += ' ';
        }
        continue;
      }
      if (inStr === '`') {
        if (ch === '\\') {
          res += '  ';
          j++;
          continue;
        }
        if (ch === '`') {
          inStr = null;
          res += ' ';
          continue;
        }
        if (ch === '$' && next === '{') {
          inStr = null;
          tplDepth = 1;
          res += '  ';
          j++;
          continue;
        }
        res += ' ';
        continue;
      }
      if (inStr) {
        if (ch === '\\') {
          res += '  ';
          j++;
          continue;
        }
        if (ch === inStr) {
          inStr = null;
          res += ' ';
          continue;
        }
        res += ' ';
        continue;
      }
      if (tplDepth > 0) {
        if (ch === '{') {
          tplDepth++;
          res += ' ';
          continue;
        }
        if (ch === '}') {
          tplDepth--;
          if (tplDepth === 0) inStr = '`';
          res += ' ';
          continue;
        }
        if (ch === '`') {
          inStr = '`';
          res += ' ';
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = ch;
          res += ' ';
          continue;
        }
        if (ch === '/' && next === '/') break; // comment inside an interpolation
        res += ch;
        continue;
      }
      // plain code
      if ((style === 'c' || style === 'rs') && ch === '/' && next === '/') break;
      if ((style === 'c' || style === 'rs') && ch === '/' && next === '*') {
        inBlock = true;
        res += '  ';
        j++;
        continue;
      }
      // '#' starts a comment only at line start or after whitespace (keeps ${x#y} in shell intact)
      if (style === 'hash' && ch === '#' && (j === 0 || /\s/.test(line[j - 1]))) break;
      if (style === 'lua' && ch === '-' && next === '-') break;
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
        res += ' ';
        continue;
      }
      res += ch;
    }
    out.push(res);
  }
  return out;
}

/**
 * 1-based line where the block opened on `startIdx` (0-based) closes.
 * Declarations without a body end at their `;`, or at the next blank line.
 */
function braceEnd(cs: string[], startIdx: number): number {
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < cs.length; i++) {
    const code = cs[i] ?? '';
    for (const ch of code) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (opened && depth <= 0) return i + 1;
    if (!opened) {
      if (code.includes(';')) return i + 1;
      if (!code.trim()) return Math.max(startIdx + 1, i);
    }
  }
  return cs.length;
}

/** 1-based end of a python block: last line indented deeper than the declaration. */
function indentEnd(cs: string[], declIdx: number, declIndent: number): number {
  let end = declIdx;
  for (let i = declIdx + 1; i < cs.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    if (indentWidth(leadingWs(code)) <= declIndent) break;
    end = i;
  }
  return end + 1;
}

/** 1-based end of a ruby block via keyword depth (def/class/module/if/... vs end). */
function kwEndRuby(cs: string[], declIdx: number): number {
  let depth = 0;
  for (let i = declIdx; i < cs.length; i++) {
    const code = cs[i] ?? '';
    const openAt = /^\s*(?:def|class|module|if|unless|while|until|case|begin|for)\b/.test(code);
    const doAt = /\bdo\s*(?:\|[^|]*\|)?\s*$/.test(code);
    const closes = (code.match(/\bend\b/g) ?? []).length;
    depth += (openAt ? 1 : 0) + (doAt ? 1 : 0) - closes;
    if (depth <= 0) return i + 1;
  }
  return cs.length;
}

/** 1-based end of a lua block via keyword depth (function/then/do vs end). */
function kwEndLua(cs: string[], declIdx: number): number {
  let depth = 0;
  for (let i = declIdx; i < cs.length; i++) {
    const code = cs[i] ?? '';
    let opens = 0;
    if (/^\s*(?:local\s+)?function\b/.test(code)) opens++;
    const thens = (code.match(/\bthen\b/g) ?? []).length;
    const elseifs = (code.match(/\belseif\b/g) ?? []).length;
    opens += Math.max(0, thens - elseifs);
    opens += (code.match(/\bdo\b/g) ?? []).length;
    const closes = (code.match(/\bend\b/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) return i + 1;
  }
  return cs.length;
}

// ------------------------------------------------------------
// Symbol extraction — scanners
// ------------------------------------------------------------

interface RawSym {
  name: string;
  kind: SymbolKind;
  /** 1-based, offset-inclusive (offset > 0 only for vue/svelte script blocks). */
  line: number;
  /** 1-based line of the actual declaration (differs from line only for python decorators). */
  sigLine: number;
  endLine: number;
  container?: string | null;
  lockContainer?: boolean;
}

function mkRaw(name: string, kind: SymbolKind, idx: number, cs: string[], offset: number, endLine?: number): RawSym {
  return {
    name,
    kind,
    line: idx + 1 + offset,
    sigLine: idx + 1 + offset,
    endLine: (endLine ?? braceEnd(cs, idx)) + offset,
  };
}

/**
 * Keywords that precede a `(` far too often to be symbol names
 * (if/for/while/return...). Method and function makers filter through this.
 */
const CONTROL_WORDS = new Set([
  'if', 'else', 'for', 'while', 'switch', 'catch', 'return', 'do', 'try', 'new', 'case', 'default', 'throw',
  'typeof', 'await', 'yield', 'delete', 'void', 'super', 'this', 'function', 'class', 'struct', 'enum',
  'interface', 'namespace', 'import', 'export', 'extends', 'implements', 'unless', 'elsif', 'def', 'end',
  'fn', 'let', 'var', 'const', 'with', 'except', 'finally', 'lambda', 'match', 'use', 'package', 'func',
  'defer', 'local', 'then', 'begin', 'rescue', 'module', 'until', 'select', 'range', 'echo', 'source',
  'require', 'foreach', 'elseif', 'in', 'as', 'is', 'not', 'and', 'or', 'loop', 'repeat', 'print', 'println',
]);

type BodyMaker = (code: string) => { name: string; kind: SymbolKind; container?: string | null; lockContainer?: boolean } | null;

/**
 * Scans lines of a region (or a whole file when targetDepth is 0) and collects
 * candidates that sit exactly at `targetDepth` braces deep — e.g. methods live
 * at depth 1 inside a class body, never inside a method's own braces (depth 2+).
 */
function scanBody(
  lines: string[],
  cs: string[],
  offset: number,
  startIdx: number,
  endIdxEx: number,
  targetDepth: number,
  regionContainer: string | null,
  makers: BodyMaker[],
  out: RawSym[],
): void {
  let depth = 0;
  for (let i = startIdx; i < endIdxEx && i < lines.length; i++) {
    const depthBefore = depth;
    const code = cs[i] ?? '';
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depthBefore !== targetDepth) continue;
    if (!code.trim()) continue;
    for (const make of makers) {
      const r = make(code);
      if (r) {
        out.push({
          name: r.name,
          kind: r.kind,
          container: r.container ?? regionContainer,
          lockContainer: r.lockContainer ?? regionContainer !== null,
          line: i + 1 + offset,
          sigLine: i + 1 + offset,
          endLine: braceEnd(cs, i) + offset,
        });
        break;
      }
    }
  }
}

// ---------- JavaScript / TypeScript ----------

const JS_CLASS_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const JS_INTERFACE_RE = /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/;
const JS_ENUM_RE = /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/;
const JS_TYPE_RE = /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/;
const JS_MODULE_RE = /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/;
const JS_FUNCTION_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const JS_CONST_ARROW_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+?)?=\s*(?:async\s+)?(?:function\s*\*?\s*)?\(/;

const JS_METHOD_RE = /^\s{2,}(?:(?:public|private|protected|static|readonly|override|abstract|declare|get|set|async)\s+)*(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
const JS_ARROW_RE = /^\s{2,}(?:(?:public|private|protected|static|readonly)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b)?\s*\(/;

const jsMethodMaker: BodyMaker = (code) => {
  const m = JS_METHOD_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: 'method', lockContainer: true };
};

const jsArrowMaker: BodyMaker = (code) => {
  const m = JS_ARROW_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: 'method', lockContainer: true };
};

function scanJsFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    let sym: RawSym | null = null;
    let m = JS_CLASS_RE.exec(code);
    if (m) sym = mkRaw(m[1], 'class', i, cs, offset);
    if (!sym) {
      m = JS_INTERFACE_RE.exec(code);
      if (m) sym = mkRaw(m[1], 'interface', i, cs, offset);
    }
    if (!sym) {
      m = JS_ENUM_RE.exec(code);
      if (m) sym = mkRaw(m[1], 'enum', i, cs, offset);
    }
    if (!sym) {
      m = JS_TYPE_RE.exec(code);
      if (m) sym = mkRaw(m[1], 'type', i, cs, offset);
    }
    if (!sym) {
      m = JS_MODULE_RE.exec(code);
      if (m) sym = mkRaw(m[1], 'module', i, cs, offset);
    }
    if (!sym) {
      m = JS_FUNCTION_RE.exec(code);
      if (m) sym = mkRaw(m[1], 'function', i, cs, offset);
    }
    if (!sym) {
      m = JS_CONST_ARROW_RE.exec(code);
      if (m) sym = mkRaw(m[1], /^\s*(?:export\s+)?const\b/.test(code) ? 'const' : 'variable', i, cs, offset);
    }
    if (sym) raw.push(sym);
  }
  // Methods / arrow-properties: only inside class-like bodies, only at class-body depth.
  for (const region of raw) {
    if (region.kind !== 'class' && region.kind !== 'interface' && region.kind !== 'struct') continue;
    scanBody(lines, cs, offset, region.line - 1 - offset, region.endLine - offset, 1, region.name, [jsMethodMaker, jsArrowMaker], raw);
  }
  return raw;
}

// ---------- JVM family (java / kotlin / c# / dart) ----------

const JVM_CLASS_RE = /^\s*(?:(?:public|private|protected|internal|abstract|final|open|data|sealed|inner|value|non-sealed|static|partial|readonly|enum)\s+)*(class|interface|enum(?:\s+class)?|struct|object|record|mixin)\s+([A-Za-z_]\w*)/;
const JVM_FUN_RE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|async|suspend|override|open|inline|fun)\s+)*(?:<[^()]*>\s*)?(?:[\w$][\w$<>\[\],.?\s]*?\s+)?([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:async\s*)?\{/;
const JVM_METHOD_RE = /^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|sealed|synchronized|extern|unsafe|partial|suspend|inline|open|mutating|required|convenience|lateinit|const|new|fun)\s+)*(?:<[^()]*>\s*)?(?:[\w$][\w$<>\[\],.?\s]*?\s+)?([A-Za-z_~][\w]*)\s*\(/;

const jvmMethodMaker: BodyMaker = (code) => {
  const m = JVM_METHOD_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: 'method' };
};

function scanJvmFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    const m = JVM_CLASS_RE.exec(code);
    if (!m) continue;
    const kw = m[1];
    const kind: SymbolKind = kw === 'interface' ? 'interface' : kw === 'enum' || kw === 'enum class' ? 'enum' : kw === 'struct' ? 'struct' : 'class';
    raw.push(mkRaw(m[2], kind, i, cs, offset));
  }
  const regions = raw.filter((r) => CONTAINER_KINDS.has(r.kind));
  const insideRegion = (idx: number): boolean =>
    regions.some((r) => {
      const s = r.line - 1 - offset;
      const e = r.endLine - 1 - offset;
      return s < idx && idx <= e;
    });
  // Top-level functions (kotlin `fun main`, dart `void main`) — never inside a type body.
  for (let i = 0; i < lines.length; i++) {
    if (insideRegion(i)) continue;
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const m = JVM_FUN_RE.exec(code);
    if (!m) continue;
    const name = m[1];
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push({ name, kind: 'function', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: braceEnd(cs, i) + offset });
  }
  for (const region of raw) {
    if (region.kind !== 'class' && region.kind !== 'interface' && region.kind !== 'struct') continue;
    scanBody(lines, cs, offset, region.line - 1 - offset, region.endLine - offset, 1, region.name, [jvmMethodMaker], raw);
  }
  return raw;
}

// ---------- C / C++ ----------

const CPP_ENUM_RE = /^[\w:<>*&\s]*\benum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/;
const CPP_CLASS_RE = /^[\w:<>*&\s]*\b(?:class|struct)\s+([A-Za-z_]\w*)/;
const CPP_MEMBER_RE = /^[\w:<>*&~\s]*\b(\w+)::(~?[A-Za-z_]\w*)\s*\(/;
const CPP_FN_RE = /^[\w:<>*&\s]+\s\*?([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{/;

const cppMemberMaker: BodyMaker = (code) => {
  const m = CPP_MEMBER_RE.exec(code);
  if (!m) return null;
  if (!m[1] || m[1] === 'std') return null; // std::string(...) calls are not methods
  const name = m[2];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: 'method', container: m[1], lockContainer: true };
};

const cppFnMaker: BodyMaker = (code) => {
  const m = CPP_FN_RE.exec(code);
  if (!m) return null;
  const name = m[1];
  if (!name || CONTROL_WORDS.has(name.toLowerCase())) return null;
  return { name, kind: 'function' };
};

function scanCppFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const e = CPP_ENUM_RE.exec(code);
    if (e) {
      raw.push(mkRaw(e[1], 'enum', i, cs, offset));
      continue;
    }
    const m = CPP_CLASS_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], /\bclass\b/.test(code) ? 'class' : 'struct', i, cs, offset));
      continue;
    }
  }
  // Out-of-class member definitions (`void Server::start() {`) and plain
  // top-level functions (`int main() {`) live at global brace depth 0.
  scanBody(lines, cs, offset, 0, lines.length, 0, null, [cppMemberMaker, cppFnMaker], raw);
  for (const region of raw) {
    if (region.kind !== 'class' && region.kind !== 'struct') continue;
    scanBody(lines, cs, offset, region.line - 1 - offset, region.endLine - offset, 1, region.name, [jvmMethodMaker], raw);
  }
  return raw;
}

// ---------- Go ----------

const GO_STRUCT_RE = /^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+struct\b/;
const GO_IFACE_RE = /^\s*type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+interface\b/;
const GO_METHOD_RE = /^\s*func\s*\(\s*\w+\s+\*?([\w.]+)\s*\)\s*(\w+)/;
const GO_FUNC_RE = /^\s*func\s+([A-Za-z_]\w*)\s*\(/;
const GO_TYPE_RE = /^\s*type\s+([A-Za-z_]\w*)/;

function scanGoFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    let m = GO_STRUCT_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'struct', i, cs, offset));
      continue;
    }
    m = GO_IFACE_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'interface', i, cs, offset));
      continue;
    }
    m = GO_METHOD_RE.exec(code);
    if (m) {
      raw.push({ name: m[2], kind: 'method', container: m[1], lockContainer: true, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: braceEnd(cs, i) + offset });
      continue;
    }
    m = GO_FUNC_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'function', i, cs, offset));
      continue;
    }
    m = GO_TYPE_RE.exec(code);
    if (m) {
      // Simple alias (`type ID string`) — no body to track.
      raw.push({ name: m[1], kind: 'type', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}

// ---------- Rust ----------

const RS_FN_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]*"\s+)?)?fn\s+([A-Za-z_]\w*)/;
const RS_ITEM_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/;
const RS_IMPL_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?impl(?:<[^>]*>)?\s+(?:[\w:<>,\s]+?\s+for\s+)?([\w:]+)/;
const RS_MOD_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/;
const RS_TYPE_RE = /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/;

function scanRsFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'rs');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    let m = RS_ITEM_RE.exec(code);
    if (m) {
      const kind: SymbolKind = m[1] === 'struct' ? 'struct' : m[1] === 'enum' ? 'enum' : 'trait';
      raw.push(mkRaw(m[2], kind, i, cs, offset));
      continue;
    }
    m = RS_IMPL_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'impl', i, cs, offset));
      continue;
    }
    m = RS_MOD_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'module', i, cs, offset));
      continue;
    }
    m = RS_FN_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'function', i, cs, offset));
      continue;
    }
    m = RS_TYPE_RE.exec(code);
    if (m) {
      raw.push({ name: m[1], kind: 'type', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}

// ---------- Python ----------

const PY_CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/;
const PY_DEF_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/;

function scanPyFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'hash');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const mc = PY_CLASS_RE.exec(code);
    const md = mc ? null : PY_DEF_RE.exec(code);
    if (!mc && !md) continue;
    const m = (mc ?? md) as RegExpExecArray;
    // Decorators captured: the symbol's span starts at the first contiguous @-line.
    let start = i;
    for (let j = i - 1; j >= 0 && /^\s*@/.test(cs[j] ?? ''); j--) start = j;
    const end = indentEnd(cs, i, indentWidth(leadingWs(code)));
    raw.push({ name: m[1], kind: mc ? 'class' : 'function', line: start + 1 + offset, sigLine: i + 1 + offset, endLine: end + offset });
  }
  return raw;
}

// ---------- PHP ----------

const PHP_CLASS_RE = /^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait)\s+([A-Za-z_]\w*)/;
const PHP_FUNC_RE = /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?([A-Za-z_]\w*)/;
const PHP_NS_RE = /^\s*namespace\s+([\w\\]+)/;

function scanPhpFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    let m = PHP_CLASS_RE.exec(code);
    if (m) {
      const kind: SymbolKind = m[1] === 'interface' ? 'interface' : m[1] === 'trait' ? 'trait' : 'class';
      raw.push(mkRaw(m[2], kind, i, cs, offset));
      continue;
    }
    m = PHP_NS_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'module', i, cs, offset));
      continue;
    }
    m = PHP_FUNC_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'function', i, cs, offset));
    }
  }
  return raw;
}

// ---------- Ruby ----------

const RB_MODULE_RE = /^\s*module\s+([A-Za-z_][\w:]*)/;
const RB_CLASS_RE = /^\s*class\s+([A-Za-z_][\w:]*)/;
const RB_DEF_RE = /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/;

function scanRubyFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'hash');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    let m = RB_MODULE_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'module', i, cs, offset, kwEndRuby(cs, i)));
      continue;
    }
    m = RB_CLASS_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'class', i, cs, offset, kwEndRuby(cs, i)));
      continue;
    }
    m = RB_DEF_RE.exec(code);
    if (m) {
      raw.push(mkRaw(m[1], 'function', i, cs, offset, kwEndRuby(cs, i)));
    }
  }
  return raw;
}

// ---------- Swift ----------

const SWIFT_TYPE_RE = /^\s*(?:@\w+\s*)*(?:(?:public|private|fileprivate|internal|open|final|indirect|frozen|required|nonisolated)\s+)*(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_]\w*)/;
const SWIFT_FUNC_RE = /^\s*(?:@\w+\s*)*(?:(?:public|private|fileprivate|internal|open|static|class|final|override|required|convenience|mutating|nonmutating|nonisolated)\s+)*func\s+([A-Za-z_]\w*)/;
const SWIFT_INIT_RE = /^\s*(?:@\w+\s*)*(?:(?:public|private|internal|override|convenience|required)\s+)?(?:init|deinit)\s*[!(?]/;

function scanSwiftFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const m = SWIFT_TYPE_RE.exec(code);
    if (m) {
      const kind: SymbolKind = m[1] === 'struct' ? 'struct' : m[1] === 'enum' ? 'enum' : m[1] === 'protocol' ? 'interface' : m[1] === 'extension' ? 'impl' : 'class';
      raw.push(mkRaw(m[2], kind, i, cs, offset));
      continue;
    }
    const f = SWIFT_FUNC_RE.exec(code);
    if (f) {
      raw.push(mkRaw(f[1], 'function', i, cs, offset));
      continue;
    }
    const init = SWIFT_INIT_RE.exec(code);
    if (init) {
      raw.push(mkRaw(init[0].trim().startsWith('deinit') ? 'deinit' : 'init', 'function', i, cs, offset));
    }
  }
  return raw;
}

// ---------- Lua ----------

const LUA_FUNC_RE = /^\s*(?:local\s+)?function\s+([\w.:]+)/;

function scanLuaFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'lua');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const m = LUA_FUNC_RE.exec(code);
    if (m) raw.push(mkRaw(m[1], 'function', i, cs, offset, kwEndLua(cs, i)));
  }
  return raw;
}

// ---------- Elixir ----------

const EX_MODULE_RE = /^\s*defmodule\s+([A-Za-z_][\w.]*)/;
const EX_FUN_RE = /^\s*def(?:p|macro|macrop|delegate|overridable|struct|impl)?\b\s+([A-Za-z_]\w*[?!]?)/;

/** Elixir blocks end with `end`; count declaration keywords vs `end` (approximate). */
function kwEndElixir(cs: string[], declIdx: number): number {
  let depth = 0;
  for (let i = declIdx; i < cs.length; i++) {
    const code = cs[i] ?? '';
    const opens = /^\s*(?:defmodule|def(?:p|macro|macrop|delegate|overridable|struct|impl)?)\b/.test(code) ? 1 : 0;
    const closes = (code.match(/\bend\b/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) return i + 1;
  }
  return cs.length;
}

function scanElixirFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'hash');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const isModule = EX_MODULE_RE.test(code);
    const m = isModule ? EX_MODULE_RE.exec(code) : EX_FUN_RE.exec(code);
    if (!m) continue;
    const name = m[1];
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push(mkRaw(name, isModule ? 'module' : 'function', i, cs, offset, kwEndElixir(cs, i)));
  }
  return raw;
}

// ---------- R ----------

const R_FUN_RE = /^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\s*\(/;

function scanRFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'hash');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const m = R_FUN_RE.exec(code);
    if (!m) continue;
    const name = m[1].split('.').pop() ?? m[1];
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push(mkRaw(name, 'function', i, cs, offset, indentEnd(cs, i, indentWidth(leadingWs(code)))));
  }
  return raw;
}

// ---------- Zig ----------

const ZIG_FN_RE = /^\s*(?:pub\s+)?(?:(?:extern|inline|noinline|export)\s+)*fn\s+([A-Za-z_]\w*)/;
const ZIG_TYPE_RE = /^\s*(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:struct|enum|union|opaque)\b/;

function scanZigFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'c');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const t = ZIG_TYPE_RE.exec(code);
    const f = t ? null : ZIG_FN_RE.exec(code);
    const m = t ?? f;
    if (!m) continue;
    raw.push(mkRaw(m[1], t ? 'struct' : 'function', i, cs, offset));
  }
  return raw;
}

// ---------- Shell ----------

const SH_FN_RE = /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/;
const SH_FN2_RE = /^\s*function\s+([A-Za-z_]\w*)\s*\{?\s*$/;

function scanShFamily(lines: string[], offset: number): RawSym[] {
  const cs = codeLines(lines, 'hash');
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    if (!code.trim()) continue;
    const m = SH_FN_RE.exec(code);
    if (m && !CONTROL_WORDS.has(m[1].toLowerCase())) {
      raw.push(mkRaw(m[1], 'function', i, cs, offset));
      continue;
    }
    const m2 = SH_FN2_RE.exec(code);
    if (m2 && !CONTROL_WORDS.has(m2[1].toLowerCase())) {
      raw.push(mkRaw(m2[1], 'function', i, cs, offset));
    }
  }
  return raw;
}

// ------------------------------------------------------------
// v11.12+ — heuristic-only languages. These are REAL regex/AST-lite
// readers, NOT LSP results and NOT fabricated placeholders. A missing
// language server never means "no answer" for these files.
// ------------------------------------------------------------

// ---------- Markdown (ATX headings) ----------

const MD_HEAD_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

function scanMdFamily(lines: string[], _cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = MD_HEAD_RE.exec(lines[i] ?? '');
    if (!m) continue;
    const name = m[2].trim().replace(/[*_`]/g, '').slice(0, 80);
    if (!name) continue;
    raw.push({ name, kind: 'module', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- JSON / YAML (key names) ----------

const DATA_KEY_RE = /^\s*(?:-\s*)?["']?([A-Za-z_][\w.\- ]*?)["']?\s*:/;

function scanDataFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DATA_KEY_RE.exec(cs[i] ?? '');
    if (!m) continue;
    const name = m[1].trim().replace(/["']/g, '');
    if (!name || CONTROL_WORDS.has(name.toLowerCase())) continue;
    raw.push({ name, kind: 'const', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- CSS / SCSS / Less ----------

const CSS_RULE_RE = /^\s*([^{}]+?)\s*\{/;
const CSS_MIXIN_RE = /^\s*@(?:mixin|function)\s+([\w-]+)/;
const CSS_VAR_RE = /^\s*([$@][\w-]+)\s*:/;

function scanStyleFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    const mixin = CSS_MIXIN_RE.exec(code);
    if (mixin) { raw.push(mkRaw(mixin[1], 'function', i, cs, offset)); continue; }
    const v = CSS_VAR_RE.exec(code);
    if (v) { raw.push(mkRaw(v[1], 'variable', i, cs, offset)); continue; }
    const r = CSS_RULE_RE.exec(code);
    if (!r) continue;
    const sel = r[1].trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!sel || sel.startsWith('@') || CONTROL_WORDS.has(sel.toLowerCase())) continue;
    raw.push(mkRaw(sel, 'const', i, cs, offset));
  }
  return raw;
}

// ---------- HTML (ids + custom/component tags) ----------

const HTML_ID_RE = /\bid\s*=\s*["']([^"']+)["']/;
const HTML_TAG_RE = /<\s*([A-Za-z][\w-]*)/;

function scanHtmlFamily(lines: string[], _cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const id = HTML_ID_RE.exec(line);
    if (id) {
      raw.push({ name: id[1], kind: 'const', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const tag = HTML_TAG_RE.exec(line);
    if (tag && (/[A-Z]/.test(tag[1]) || tag[1].includes('-'))) {
      raw.push({ name: tag[1], kind: 'class', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}

// ---------- SQL (DDL objects) ----------

const SQL_CREATE_RE = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|TRIGGER|SCHEMA|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`\[]?([\w.]+)/i;

function scanSqlFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  const kinds: Record<string, SymbolKind> = {
    TABLE: 'struct', VIEW: 'struct', INDEX: 'const', FUNCTION: 'function',
    PROCEDURE: 'function', TRIGGER: 'function', SCHEMA: 'module', TYPE: 'type',
  };
  for (let i = 0; i < lines.length; i++) {
    const m = SQL_CREATE_RE.exec(cs[i] ?? '');
    if (!m) continue;
    const kind = kinds[m[1].toUpperCase()] ?? 'const';
    const name = m[2].split('.').pop() ?? m[2];
    raw.push({ name, kind, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- PowerShell ----------

const PS_FUNC_RE = /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\{/i;
const PS_CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/i;
const PS_NAMED_FUNC_RE = /^\s*function\s+([A-Za-z_][\w-]*)/i;

function scanPsFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    const c = PS_CLASS_RE.exec(code);
    if (c) { raw.push(mkRaw(c[1], 'class', i, cs, offset)); continue; }
    const f = PS_NAMED_FUNC_RE.exec(code);
    if (f) { raw.push(mkRaw(f[1], 'function', i, cs, offset)); continue; }
    // `verb-noun {` blocks are PowerShell's implicit function syntax.
    const implicit = PS_FUNC_RE.exec(code);
    if (implicit && implicit[1].includes('-') && !CONTROL_WORDS.has(implicit[1].toLowerCase())) {
      raw.push(mkRaw(implicit[1], 'function', i, cs, offset));
    }
  }
  return raw;
}

// ---------- Dockerfile ----------

const DOCKER_STAGE_RE = /^\s*FROM\s+\S+(?:\s+AS\s+([A-Za-z_]\w*))?/i;
const DOCKER_ENV_RE = /^\s*ENV\s+([A-Za-z_]\w*)\s*=/i;

function scanDockerFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    const s = DOCKER_STAGE_RE.exec(code);
    if (s) {
      const name = s[1] ?? (s[0].split(/\s+/)[1] ?? '').split('/').pop() ?? 'stage';
      raw.push({ name, kind: 'module', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const e = DOCKER_ENV_RE.exec(code);
    if (e) raw.push({ name: e[1], kind: 'const', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- Haskell ----------

const HS_DECL_RE = /^\s*(module|data|newtype|type|class|instance)\s+([A-Z][\w.]*)/;
const HS_FUN_RE = /^\s*([a-z][\w']*)\s*::/;

function scanHsFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  const kinds: Record<string, SymbolKind> = { module: 'module', data: 'struct', newtype: 'struct', type: 'type', class: 'interface', instance: 'impl' };
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    const d = HS_DECL_RE.exec(code);
    if (d) {
      raw.push({ name: d[2], kind: kinds[d[1].toLowerCase()] ?? 'type', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const f = HS_FUN_RE.exec(code);
    if (f && !CONTROL_WORDS.has(f[1].toLowerCase())) {
      raw.push({ name: f[1], kind: 'function', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}

// ---------- Clojure ----------

const CLJ_RE = /^\s*\(\s*(ns|defn-?|defmacro|defmulti|defmethod|deftype|defrecord|defprotocol|def)\s+([\w.\-]+)/;

function scanCljFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CLJ_RE.exec(cs[i] ?? '');
    if (!m) continue;
    const kw = m[1].toLowerCase();
    const kind: SymbolKind = kw === 'ns' ? 'module'
      : kw.startsWith('defn') || kw === 'defmacro' || kw === 'defmulti' || kw === 'defmethod' ? 'function'
      : kw === 'def' ? 'const'
      : kw === 'defprotocol' ? 'interface' : 'struct';
    raw.push({ name: m[2], kind, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- Scala ----------

const SCALA_RE = /^\s*(?:(?:case|final|abstract|sealed|implicit|lazy|override)\s+)*(class|object|trait|def|val|var|type)\s+([A-Za-z_]\w*)/;

function scanScalaFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  const kinds: Record<string, SymbolKind> = { class: 'class', object: 'module', trait: 'interface', def: 'function', val: 'const', var: 'variable', type: 'type' };
  for (let i = 0; i < lines.length; i++) {
    const m = SCALA_RE.exec(cs[i] ?? '');
    if (!m) continue;
    raw.push({ name: m[2], kind: kinds[m[1].toLowerCase()] ?? 'const', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- Perl ----------

const PERL_RE = /^\s*(sub|package)\s+([\w:]+)/;

function scanPlFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PERL_RE.exec(cs[i] ?? '');
    if (!m) continue;
    raw.push({ name: m[2], kind: m[1] === 'sub' ? 'function' : 'module', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- Objective-C ----------

const OBJC_TYPE_RE = /^\s*@(interface|implementation|protocol)\s+([A-Za-z_]\w*)/;
const OBJC_METHOD_RE = /^\s*[-+]\s*\([^)]*\)\s*([A-Za-z_]\w*)/;

function scanObjcFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  let container: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const code = cs[i] ?? '';
    const t = OBJC_TYPE_RE.exec(code);
    if (t) {
      container = t[2];
      raw.push({ name: t[2], kind: t[1].toLowerCase() === 'implementation' ? 'impl' : 'interface', container: null, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
      continue;
    }
    const m = OBJC_METHOD_RE.exec(code);
    if (m && !CONTROL_WORDS.has(m[1].toLowerCase())) {
      raw.push({ name: m[1], kind: 'method', container, lockContainer: true, line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
    }
  }
  return raw;
}

// ---------- GraphQL ----------

const GQL_RE = /^\s*(type|interface|enum|input|scalar|union|schema|query|mutation|subscription|fragment)\s+([A-Za-z_]\w*)/;

function scanGraphqlFamily(lines: string[], cs: string[], offset: number): RawSym[] {
  const raw: RawSym[] = [];
  const kinds: Record<string, SymbolKind> = {
    type: 'type', interface: 'interface', enum: 'enum', input: 'struct', scalar: 'type',
    union: 'type', schema: 'module', query: 'function', mutation: 'function',
    subscription: 'function', fragment: 'function',
  };
  for (let i = 0; i < lines.length; i++) {
    const m = GQL_RE.exec(cs[i] ?? '');
    if (!m) continue;
    raw.push({ name: m[2], kind: kinds[m[1].toLowerCase()] ?? 'type', line: i + 1 + offset, sigLine: i + 1 + offset, endLine: i + 1 + offset });
  }
  return raw;
}

// ---------- Vue / Svelte (<script> blocks scanned as JS/TS) ----------

function embedPieces(lines: string[]): Array<{ raw: RawSym[]; lines: string[]; offset: number }> {
  const pieces: Array<{ raw: RawSym[]; lines: string[]; offset: number }> = [];
  const text = lines.join('\n');
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(text)) !== null) {
    const nlBeforeTag = (text.slice(0, m.index).match(/\n/g) ?? []).length;
    // Line (1-based) of the first code line inside the block.
    const bodyStart = nlBeforeTag + 1 + (m[1].startsWith('\n') ? 1 : 0);
    const inner = m[1].replace(/^\r?\n/, '');
    const innerLines = inner.split('\n');
    pieces.push({ raw: scanJsFamily(innerLines, bodyStart), lines: innerLines, offset: bodyStart });
    found = true;
  }
  if (!found) pieces.push({ raw: scanJsFamily(lines, 0), lines, offset: 0 });
  return pieces;
}

// ------------------------------------------------------------
// Symbol extraction — finalize (containers, re-kindling, clamps)
// ------------------------------------------------------------

function finalize(raw: RawSym[], lines: string[], offset: number, rekindInto: Set<SymbolKind>): Symbol[] {
  // First symbol on a line wins — pass-1 declarations beat body-scan candidates.
  const seen = new Set<number>();
  const ordered: RawSym[] = [];
  for (const r of raw) {
    if (seen.has(r.line)) continue;
    seen.add(r.line);
    ordered.push(r);
  }
  const containers = ordered.filter((r) => CONTAINER_KINDS.has(r.kind));
  const out: Symbol[] = [];
  for (const r of ordered) {
    let container = r.container ?? null;
    if (!r.lockContainer) {
      container = null;
      let best: RawSym | null = null;
      for (const c of containers) {
        if (c === r) continue;
        if (c.line < r.line && r.line <= c.endLine) {
          if (!best || c.endLine - c.line < best.endLine - best.line) best = c;
        }
      }
      if (best) {
        container = best.name;
        // A function nested in a class-like container is a method.
        if (r.kind === 'function' && rekindInto.has(best.kind)) r.kind = 'method';
      }
    }
    const line = Math.max(1, r.line);
    const sig = (lines[r.sigLine - 1 - offset] ?? '').trim().slice(0, 120);
    const endLine = Math.min(Math.max(r.endLine, line), Math.max(line, lines.length + offset));
    out.push({ name: r.name, kind: r.kind, line, endLine, signature: sig, container });
  }
  return out;
}

function scanFamily(family: Family, lines: string[], cs: string[]): RawSym[] {
  switch (family) {
    case 'js':
      return scanJsFamily(lines, 0);
    case 'jvm':
      return scanJvmFamily(lines, 0);
    case 'cpp':
      return scanCppFamily(lines, 0);
    case 'go':
      return scanGoFamily(lines, 0);
    case 'rs':
      return scanRsFamily(lines, 0);
    case 'py':
      return scanPyFamily(lines, 0);
    case 'php':
      return scanPhpFamily(lines, 0);
    case 'ruby':
      return scanRubyFamily(lines, 0);
    case 'swift':
      return scanSwiftFamily(lines, 0);
    case 'lua':
      return scanLuaFamily(lines, 0);
    case 'elixir':
      return scanElixirFamily(lines, 0);
    case 'r':
      return scanRFamily(lines, 0);
    case 'zig':
      return scanZigFamily(lines, 0);
    case 'sh':
      return scanShFamily(lines, 0);
    case 'md':
      return scanMdFamily(lines, cs, 0);
    case 'data':
      return scanDataFamily(lines, cs, 0);
    case 'style':
      return scanStyleFamily(lines, cs, 0);
    case 'html':
      return scanHtmlFamily(lines, cs, 0);
    case 'sql':
      return scanSqlFamily(lines, cs, 0);
    case 'ps':
      return scanPsFamily(lines, cs, 0);
    case 'docker':
      return scanDockerFamily(lines, cs, 0);
    case 'hs':
      return scanHsFamily(lines, cs, 0);
    case 'clj':
      return scanCljFamily(lines, cs, 0);
    case 'scala':
      return scanScalaFamily(lines, cs, 0);
    case 'pl':
      return scanPlFamily(lines, cs, 0);
    case 'objc':
      return scanObjcFamily(lines, cs, 0);
    case 'graphql':
      return scanGraphqlFamily(lines, cs, 0);
    default:
      return [];
  }
}

// ------------------------------------------------------------
// Public: extractSymbols / extractImports
// ------------------------------------------------------------

/**
 * Extracts symbols from one file. Unknown extensions, empty content and any
 * internal failure return [] — this must never throw.
 */
export function extractSymbols(absPath: string, content: string): Symbol[] {
  try {
    const family = FAMILY_OF[extNoDot(absPath)];
    if (!family || typeof content !== 'string' || !content.length) return [];
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const rekind = REKIND[family] ?? NO_REKIND;
    if (family === 'embed') {
      const out: Symbol[] = [];
      for (const piece of embedPieces(lines)) {
        out.push(...finalize(piece.raw, piece.lines, piece.offset, rekind));
      }
      return out;
    }
    const style: CommentStyle = family === 'rs' ? 'rs'
      : family === 'ruby' || family === 'sh' || family === 'elixir' || family === 'r'
        || family === 'ps' || family === 'docker' || family === 'hs' || family === 'clj'
        || family === 'pl' || family === 'graphql' || family === 'data' ? 'hash'
      : family === 'lua' ? 'lua' : 'c';
    // Markdown headings (# …) and HTML ids/tags ARE the symbols — running them
    // through the comment/string stripper would delete exactly what we need.
    const cs = family === 'md' || family === 'html' ? lines : codeLines(lines, style);
    return finalize(scanFamily(family, lines, cs), lines, 0, rekind);
  } catch {
    return [];
  }
}

/**
 * Extracts module specifiers (imports / requires / includes / uses) from one
 * file. Raw specifiers, deduplicated, in order of appearance. Never throws.
 */
export function extractImports(absPath: string, content: string): string[] {
  try {
    const family = FAMILY_OF[extNoDot(absPath)];
    if (!family || typeof content !== 'string' || !content.length) return [];
    const out: string[] = [];
    const push = (s: string): void => {
      const v = String(s || '').trim();
      if (v && !out.includes(v)) out.push(v);
    };
    const lines = content.split('\n');
    switch (family) {
      case 'js':
      case 'embed': {
        const staticRe = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g;
        const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
        const reqRe = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;
        for (const re of [staticRe, dynRe, reqRe]) {
          let m = re.exec(content);
          while (m !== null) {
            push(m[1]);
            m = re.exec(content);
          }
        }
        break;
      }
      case 'py': {
        for (const line of lines) {
          let m = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line);
          if (m) {
            for (const part of m[1].split(',')) push(part.trim().split(/\s+as\s+/)[0]);
            continue;
          }
          m = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'go': {
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (t === 'import (') {
            for (i++; i < lines.length; i++) {
              if (lines[i].trim() === ')') break;
              const mm = /"([^"]+)"/.exec(lines[i]);
              if (mm) push(mm[1]);
            }
            continue;
          }
          const mm = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/.exec(lines[i]);
          if (mm) push(mm[1]);
        }
        break;
      }
      case 'jvm': {
        for (const line of lines) {
          let m = /^\s*import\s+['"]([^'"]+)['"]/ .exec(line); // dart
          if (!m) m = /^\s*(?:import|using)\s+(?:static\s+)?([\w.*]+)\s*;/.exec(line); // java/kt/cs
          if (m) push(m[1]);
        }
        break;
      }
      case 'cpp': {
        for (const line of lines) {
          const m = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'rs': {
        for (const line of lines) {
          const m = /^\s*use\s+([\w:]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'php': {
        for (const line of lines) {
          let m = /^\s*use\s+([\w\\]+)/.exec(line);
          if (m) {
            push(m[1]);
            continue;
          }
          m = /^\s*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'ruby': {
        for (const line of lines) {
          const m = /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'swift': {
        for (const line of lines) {
          const m = /^\s*(?:@testable\s+)?import\s+(\w+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'lua': {
        for (const line of lines) {
          const m = /^\s*(?:local\s+)?require\s*\(?\s*['"]([^'"]+)['"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'elixir': {
        for (const line of lines) {
          const m = /^\s*(?:alias|import|require|use)\s+([A-Z][\w.]*)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'r': {
        for (const line of lines) {
          const m = /^\s*(?:library|require|source)\s*\(?\s*['"]?([\w./-]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'zig': {
        for (const line of lines) {
          const m = /@import\s*\(\s*["']([^"']+)["']\s*\)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'sh': {
        for (const line of lines) {
          const m = /^\s*(?:source|\.)\s+(\S+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      // ---------- heuristic-only families ----------
      case 'style': {
        for (const line of lines) {
          let m = /@import\s+["']([^"']+)["']/.exec(line);
          if (!m) m = /url\(\s*["']?([^"')]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'html': {
        for (const line of lines) {
          let m = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(line);
          if (!m) m = /<link[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'sql': {
        for (const line of lines) {
          const m = /^\s*(?:\\i|SOURCE)\s+(\S+)/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'ps': {
        for (const line of lines) {
          const m = /^\s*Import-Module\s+([\w.-]+)/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'docker': {
        for (const line of lines) {
          const m = /^\s*FROM\s+(\S+)/i.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'hs': {
        for (const line of lines) {
          const m = /^\s*import\s+(?:qualified\s+)?([A-Z][\w.]*)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'clj': {
        for (const line of lines) {
          const ns = /^\s*\(\s*ns\s+([\w.-]+)/.exec(line);
          if (ns) { push(ns[1]); continue; }
          const req = /\[([\w.-]+)\]/.exec(line);
          if (req) push(req[1]);
        }
        break;
      }
      case 'scala':
      case 'objc': {
        for (const line of lines) {
          let m = /^\s*import\s+([\w.]+)/.exec(line);
          if (!m) m = /^\s*#import\s+[<"]([^>"]+)[>"]/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'pl': {
        for (const line of lines) {
          const m = /^\s*use\s+([\w:]+)/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
      case 'graphql': {
        for (const line of lines) {
          const m = /^\s*#\s*import\s+["']([^"']+)["']/.exec(line);
          if (m) push(m[1]);
        }
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------
// CodeIndex — incremental, mtime+size keyed workspace index
// ------------------------------------------------------------

const MAX_FILES = 8000;
const MAX_UPDATE_MS = 60_000;
const MAX_FILE_BYTES = 512 * 1024; // files above this are not parsed
const MAX_WALK_BYTES = 1_000_000; // files above this are presumed binaries and skipped
const MAX_REF_HITS = 300;
const RAW_REF_CAP = 3000; // ranking needs a bounded candidate pool

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '__pycache__', '.venv', 'venv', 'coverage']);
const ENTRY_POINT_RE = /(?:^|\/)(?:index|main|app|server|mod|__init__|__main__)\.[A-Za-z]+$/;
const JS_FAMILY_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte']);

interface FileEntry {
  relPath: string;
  mtimeMs: number;
  size: number;
  lang: string;
  symbols: Symbol[];
  imports: string[];
}

function rankSymbols(syms: Symbol[]): Symbol[] {
  const KIND_WEIGHT: Record<SymbolKind, number> = {
    class: 3, interface: 3, struct: 3, trait: 3, impl: 3, enum: 3,
    function: 2, method: 2, module: 1, type: 1, const: 1, variable: 1,
  };
  return [...syms].sort((a, b) => (KIND_WEIGHT[b.kind] ?? 0) - (KIND_WEIGHT[a.kind] ?? 0) || a.line - b.line);
}

function topDirOf(rel: string): string {
  const i = rel.indexOf('/');
  return i < 0 ? '.' : rel.slice(0, i);
}

function baseNoExt(rel: string): string {
  const last = rel.split('/').pop() ?? rel;
  return last.replace(/\.[^.]+$/, '');
}

/** Does an import specifier point at the file that defines the symbol (basename match)? */
function specifierTargets(spec: string, defBase: string): boolean {
  if (!defBase) return false;
  const clean = spec.replace(/^[.]{1,2}\//, '').split(/[?#]/)[0].trim();
  const last = clean.split('/').pop() ?? '';
  const noExt = last.replace(/\.[A-Za-z0-9]+$/, '');
  // python dotted modules (`a.util`) resolve to their last segment too
  return noExt === defBase || (noExt.split('.').pop() ?? '') === defBase;
}

function pathDepth(rel: string): number {
  return rel.split('/').length;
}

export class CodeIndex {
  private root: string;
  /** absPath -> entry. absPath keys keep outline() cheap; relPath is derived for display. */
  private files = new Map<string, FileEntry>();
  private errorCount = 0;
  private lastStats: IndexStats = { files: 0, scanned: 0, changed: 0, errors: 0, partial: false, durationMs: 0, langs: {} };
  private jsDeps: boolean | null = null;

  constructor(root: string) {
    // Never throws even for nonsense input — update() will just report 0 files.
    this.root = path.resolve(String(root || '.'));
  }

  /**
   * Walks the workspace root and (re)indexed changed files. Incremental: a file
   * whose mtimeMs+size are unchanged since the previous run is skipped WITHOUT
   * a read. Caps at 8000 files / 60s — reports partial=true instead of hanging.
   */
  async update(): Promise<IndexStats> {
    const t0 = Date.now();
    const stats: IndexStats = { files: this.files.size, scanned: 0, changed: 0, errors: this.errorCount, partial: false, durationMs: 0, langs: {} };
    try {
      const deadline = t0 + MAX_UPDATE_MS;
      const found: string[] = [];
      let truncated = false;
      const queue: string[] = [this.root];
      while (queue.length) {
        if (found.length >= MAX_FILES || Date.now() > deadline) {
          truncated = true;
          break;
        }
        const dir = queue.shift() as string;
        let entries;
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          this.errorCount++; // unreadable dir (permissions) — skip quietly
          continue;
        }
        for (const ent of entries) {
          if (found.length >= MAX_FILES || Date.now() > deadline) {
            truncated = true;
            break;
          }
          if (ent.isDirectory()) {
            const name = ent.name;
            if (SKIP_DIRS.has(name.toLowerCase())) continue;
            if (name.startsWith('.') && name !== '.src') continue; // hidden dirs except .src
            queue.push(path.join(dir, name));
            continue;
          }
          if (!ent.isFile()) continue;
          const name = ent.name;
          if (name.includes('.min.')) continue;
          if (!LANGS[extNoDot(name)]) continue;
          let st;
          try {
            st = await fsp.stat(path.join(dir, name));
          } catch {
            continue;
          }
          if (st.size > MAX_WALK_BYTES) continue; // presumed binary
          found.push(path.join(dir, name));
        }
      }
      // Prune deleted files — but only when the walk was complete, otherwise we
      // would drop live entries the cap prevented us from visiting.
      if (!truncated) {
        const present = new Set(found);
        for (const abs of [...this.files.keys()]) {
          if (!present.has(abs)) this.files.delete(abs);
        }
      }
      for (const abs of found) {
        if (Date.now() > deadline) {
          stats.partial = true;
          break;
        }
        try {
          const st = await fsp.stat(abs);
          const prev = this.files.get(abs);
          if (prev && prev.size === st.size && Math.abs(prev.mtimeMs - st.mtimeMs) < 1) continue; // unchanged — skip the read
          const content = await fsp.readFile(abs, 'utf8');
          if (Buffer.byteLength(content) > MAX_FILE_BYTES) continue; // too big to parse — leave unindexed
          this.files.set(abs, {
            relPath: this.relOf(abs),
            mtimeMs: st.mtimeMs,
            size: st.size,
            lang: langOf(abs),
            symbols: extractSymbols(abs, content),
            imports: extractImports(abs, content),
          });
          stats.scanned++;
          stats.changed++;
        } catch {
          this.errorCount++;
        }
      }
      if (truncated) stats.partial = true;
      stats.files = this.files.size;
      stats.langs = this.langCounts();
    } catch {
      stats.partial = true;
      this.errorCount++;
    }
    stats.errors = this.errorCount;
    stats.durationMs = Date.now() - t0;
    this.lastStats = { ...stats, langs: { ...stats.langs } };
    return stats;
  }

  /** Current index state (files reflects the live map, errors the running total). */
  stats(): IndexStats {
    try {
      return { ...this.lastStats, files: this.files.size, errors: this.errorCount };
    } catch {
      return { files: 0, scanned: 0, changed: 0, errors: 0, partial: false, durationMs: 0, langs: {} };
    }
  }

  /**
   * Generic query entry point — currently an alias of findDefinitions.
   */
  query(q: string, opts?: FindOpts): SymbolHit[] {
    return this.findDefinitions(q, opts);
  }

  /**
   * Symbol search: exact name match scores 3, prefix 2, substring 1.
   * Ties break by path depth, then line. Never throws.
   */
  findDefinitions(q: string, opts?: FindOpts): SymbolHit[] {
    const out: SymbolHit[] = [];
    try {
      const needle = String(q ?? '').trim().toLowerCase();
      if (!needle) return [];
      const limit = clampInt(opts?.limit, 1, 200, 20);
      const kind = opts?.kind ? String(opts.kind) : null;
      for (const entry of this.files.values()) {
        for (const sym of entry.symbols) {
          if (kind && sym.kind !== kind) continue;
          const nm = sym.name.toLowerCase();
          let score = 0;
          if (nm === needle) score = 3;
          else if (nm.startsWith(needle)) score = 2;
          else if (nm.includes(needle)) score = 1;
          if (!score) continue;
          out.push({ symbol: sym, relPath: entry.relPath, score });
        }
      }
      out.sort((a, b) =>
        b.score - a.score ||
        pathDepth(a.relPath) - pathDepth(b.relPath) ||
        a.symbol.line - b.symbol.line ||
        a.symbol.name.localeCompare(b.symbol.name),
      );
      return out.slice(0, limit);
    } catch {
      this.errorCount++;
      return [];
    }
  }

  /**
   * Reference search over indexed files. Comment lines (// # *) and the
   * definition line(s) are excluded. Reads files from disk (bounded by the
   * 300-hit cap and a 3000-candidate ranking pool). Never throws.
   */
  findReferences(name: string, opts?: { limit?: number }): RefHit[] {
    try {
      const needle = String(name ?? '').trim();
      if (!needle || needle.length > 200) return [];
      const limit = clampInt(opts?.limit, 1, MAX_REF_HITS, 50);
      const boundary = new RegExp(`\\b${escapeRegExp(needle)}\\b`);
      const declRe = new RegExp(
        `^\\s*(?:(?:export|default|async|pub|unsafe|local|abstract|final|open|static|public|private|protected|readonly)\\s+)*(?:def|function|fn|func)\\s*\\(?\\s*(?:self\\.)?${escapeRegExp(needle)}\\b`,
      );
      const typeDeclRe = new RegExp(
        `^\\s*(?:(?:export|abstract|final|open|sealed|data|pub|static|public|private|protected|readonly)\\s+)*(?:class|struct|interface|trait|impl|enum|module|namespace|type)\\s+${escapeRegExp(needle)}\\b`,
      );
      const raw: Array<RefHit & { boundary: boolean }> = [];
      for (const [abs, entry] of this.files) {
        if (raw.length >= RAW_REF_CAP) break;
        let content: string;
        try {
          content = readFileSync(abs, 'utf8'); // deleted/unreadable since the index ran — soft skip
        } catch {
          continue;
        }
        const lines = content.split('\n');
        const defLines = new Set<number>();
        for (const s of entry.symbols) {
          if (s.name === needle) defLines.add(s.line);
        }
        for (let i = 0; i < lines.length && raw.length < RAW_REF_CAP; i++) {
          const line = lines[i];
          if (!line.includes(needle)) continue;
          const t = line.trim();
          if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*')) continue; // comment lines
          if (defLines.has(i + 1) || declRe.test(line) || typeDeclRe.test(line)) continue; // the definition itself
          raw.push({ relPath: entry.relPath, line: i + 1, text: t.slice(0, 120), boundary: boundary.test(line) });
        }
      }
      // Rank: word-boundary matches over bare substrings, shallower paths first.
      raw.sort((a, b) =>
        Number(b.boundary) - Number(a.boundary) ||
        pathDepth(a.relPath) - pathDepth(b.relPath) ||
        a.relPath.localeCompare(b.relPath) ||
        a.line - b.line,
      );
      return raw.slice(0, limit).map(({ relPath, line, text }) => ({ relPath, line, text }));
    } catch {
      this.errorCount++;
      return [];
    }
  }

  /**
   * Blast radius: the definition of `name`, every referencing file, and which
   * of those files import the defining module. Never throws.
   */
  impactOf(name: string): ImpactReport {
    try {
      const hit = this.findDefinitions(name, { limit: 1 })[0];
      const symbol = hit ? hit.symbol : null;
      const refs = this.findReferences(name, { limit: MAX_REF_HITS });
      const byFile = new Map<string, number>();
      for (const r of refs) byFile.set(r.relPath, (byFile.get(r.relPath) ?? 0) + 1);
      const defRel = hit ? hit.relPath : null;
      if (defRel) byFile.set(defRel, byFile.get(defRel) ?? 0); // the definition file always counts, even with 0 refs
      const defBase = defRel ? baseNoExt(defRel) : '';
      const files: ImpactFile[] = [];
      for (const [rel, n] of byFile) {
        const imports = rel === defRel || (defBase ? this.importsOf(rel).some((spec) => specifierTargets(spec, defBase)) : false);
        files.push({ relPath: rel, refs: n, imports });
      }
      files.sort((a, b) =>
        (a.relPath === defRel ? -1 : 0) - (b.relPath === defRel ? -1 : 0) ||
        b.refs - a.refs ||
        a.relPath.localeCompare(b.relPath),
      );
      const importers = files.filter((f) => f.imports && f.relPath !== defRel).length;
      const radius = files.length <= 2 ? 'small' : files.length <= 8 ? 'medium' : 'large';
      const where = defRel ? `${defRel}:${symbol?.line ?? '?'}` : '?';
      const summary = `blast_radius name=${name} kind=${symbol?.kind ?? 'unknown'} def=${where} files=${files.length} refs=${refs.length} importers=${importers} radius=${radius}`;
      return { symbol, files, summary };
    } catch {
      this.errorCount++;
      return { symbol: null, files: [], summary: 'blast_radius unavailable (index error)' };
    }
  }

  /**
   * Importance-ranked repo map, grouped by top-level dir, hard-capped at
   * `budgetChars` with a '…' tail when truncated. Never throws.
   */
  repoMap(budgetChars = 4000): string {
    try {
      const budget = clampInt(budgetChars, 80, 200_000, 4000);
      const rows: Array<{ dir: string; score: number; text: string }> = [];
      const jsBoost = this.hasJsDeps();
      for (const entry of this.files.values()) {
        const top = rankSymbols(entry.symbols).slice(0, 3);
        if (!top.length) continue;
        let weight = 1;
        if (ENTRY_POINT_RE.test(entry.relPath)) weight += 1; // entry points matter more
        if (jsBoost && JS_FAMILY_EXTS.has(extNoDot(entry.relPath))) weight += 1; // package.json deps -> JS-family files matter more
        const depthPenalty = Math.max(0, pathDepth(entry.relPath) - 1) * 0.5;
        rows.push({
          dir: topDirOf(entry.relPath),
          score: entry.symbols.length * weight - depthPenalty,
          text: `${entry.relPath}: ${top.map((s) => `${s.name} (${s.line})`).join(', ')}`,
        });
      }
      // Group by top-level dir: dirs with more total importance surface first.
      const dirAgg = new Map<string, number>();
      for (const r of rows) dirAgg.set(r.dir, (dirAgg.get(r.dir) ?? 0) + r.score);
      rows.sort((a, b) => (dirAgg.get(b.dir) ?? 0) - (dirAgg.get(a.dir) ?? 0) || b.score - a.score || a.text.localeCompare(b.text));
      const full = rows.map((r) => r.text).join('\n');
      if (full.length <= budget) return full;
      const taken: string[] = [];
      let used = 0;
      for (const r of rows) {
        const add = r.text.length + (taken.length ? 1 : 0);
        if (used + add > budget - 1) break; // reserve one char for the ellipsis
        taken.push(r.text);
        used += add;
      }
      if (taken.length) return `${taken.join('\n')}…`;
      return `${rows[0].text.slice(0, Math.max(1, budget - 1))}…`;
    } catch {
      return '';
    }
  }

  /**
   * Indented symbol tree of one file with line numbers. Uses the index when
   * the file is unchanged, otherwise reads it. Never throws.
   */
  outline(absPath: string): string {
    try {
      const abs = path.resolve(String(absPath ?? ''));
      let symbols: Symbol[] | null = null;
      try {
        const st = statSync(abs);
        const prev = this.files.get(abs);
        if (prev && prev.size === st.size && Math.abs(prev.mtimeMs - st.mtimeMs) < 1) symbols = prev.symbols;
      } catch {
        // fall through to a direct read
      }
      if (!symbols) {
        symbols = extractSymbols(abs, readFileSync(abs, 'utf8'));
      }
      if (!symbols.length) return '(no symbols)';
      const sorted = [...symbols].sort((a, b) => a.line - b.line);
      const out: string[] = [path.basename(abs)];
      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        let depth = 0;
        for (let j = 0; j < i; j++) {
          const t = sorted[j];
          if (CONTAINER_KINDS.has(t.kind) && t.line < s.line && s.line <= t.endLine) depth++;
        }
        out.push(`${'  '.repeat(depth)}${s.kind} ${s.name} (${s.line})`);
      }
      return out.join('\n');
    } catch {
      this.errorCount++;
      return '(outline unavailable)';
    }
  }

  // ---------- internals ----------

  private relOf(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  private importsOf(rel: string): string[] {
    for (const entry of this.files.values()) {
      if (entry.relPath === rel) return entry.imports;
    }
    return [];
  }

  private langCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of this.files.values()) {
      counts[entry.lang] = (counts[entry.lang] ?? 0) + 1;
    }
    return counts;
  }

  /** true when the workspace root has a package.json with dependencies — boosts JS-family files in repoMap. */
  private hasJsDeps(): boolean {
    if (this.jsDeps !== null) return this.jsDeps;
    try {
      const pkg = JSON.parse(readFileSync(path.join(this.root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      this.jsDeps = !!pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
    } catch {
      this.jsDeps = false;
    }
    return this.jsDeps;
  }
}

// ------------------------------------------------------------
// v11.12 — EXPLICIT HEURISTIC FALLBACK API
//
// These are the real, named fallbacks used when NO language server is
// available (or when the configured server is not installed). Every string
// produced here is stamped as a heuristic — it is NEVER presented as an LSP
// result. All of them are backed by the same regex/AST-lite index that powers
// symbol_outline / find_refs / repo_map; nothing is fabricated.
// ------------------------------------------------------------

/** Stamp prepended to every heuristic result so callers can never mistake it for LSP. */
export const HEURISTIC_LABEL = `HEURISTIC FALLBACK (${HEURISTIC_FALLBACKS.join(' / ')}; NOT LSP):`;

/** Identifier containing a 1-based (line, character) position, or the nearest one to the right. */
export function symbolAtPosition(absPath: string, content: string, line: number, character: number): string | null {
  try {
    const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n');
    const text = lines[Math.max(0, Math.floor(line) - 1)] ?? '';
    const target = Math.max(0, Math.floor(character) - 1);
    const re = /[A-Za-z_$][\w$]*/g;
    let m: RegExpExecArray | null;
    let nearest: { name: string; dist: number } | null = null;
    while ((m = re.exec(text)) !== null) {
      if (m.index <= target && target < m.index + m[0].length) return m[0];
      const dist = m.index - target;
      if (dist >= 0 && (!nearest || dist < nearest.dist)) nearest = { name: m[0], dist };
    }
    void absPath; // path kept in the signature for symmetry with the LSP tools
    return nearest?.name ?? null;
  } catch {
    return null;
  }
}

/** Real symbol outline of one file (regex/AST-lite), with an optional name filter. */
export function heuristicOutline(absPath: string, content?: string, query?: string, limit = 80): string {
  try {
    const text = content ?? readFileSync(absPath, 'utf8');
    const needle = String(query ?? '').trim().toLowerCase();
    const all = extractSymbols(absPath, text);
    const syms = needle ? all.filter((s) => s.name.toLowerCase().includes(needle)) : all;
    if (!syms.length) {
      return `symbol_outline found no symbols${needle ? ` matching "${query}"` : ''} in ${path.basename(String(absPath))}.`;
    }
    const cap = clampInt(limit, 1, 200, 80);
    const rows = syms.slice(0, cap).map((s) =>
      `  ${String(s.line).padStart(5)}  ${s.kind.padEnd(9)} ${s.name}${s.container ? ` (in ${s.container})` : ''}`,
    );
    return `symbol_outline: ${syms.length} symbol(s)${syms.length > cap ? ` (showing ${cap})` : ''}:\n${rows.join('\n')}`;
  } catch (err) {
    return `symbol_outline unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Incremental index shared by the LSP fallback paths (one per workspace root). */
const fallbackIndexes = new Map<string, CodeIndex>();

export async function fallbackIndexFor(workspace: string): Promise<CodeIndex> {
  const root = path.resolve(String(workspace || '.'));
  let idx = fallbackIndexes.get(root);
  if (!idx) { idx = new CodeIndex(root); fallbackIndexes.set(root, idx); }
  await idx.update().catch(() => undefined);
  return idx;
}

/** Real reference search across the workspace — never an LSP claim. */
export async function heuristicFindReferences(workspace: string, name: string, limit = 50): Promise<RefHit[]> {
  try {
    const idx = await fallbackIndexFor(workspace);
    return idx.findReferences(name, { limit: clampInt(limit, 1, MAX_REF_HITS, 50) });
  } catch {
    return [];
  }
}

/** Real, budget-capped repo map across the workspace — never an LSP claim. */
export async function heuristicRepoMap(workspace: string, budgetChars = 4000): Promise<string> {
  try {
    const idx = await fallbackIndexFor(workspace);
    return idx.repoMap(budgetChars);
  } catch {
    return '(repo_map unavailable)';
  }
}
