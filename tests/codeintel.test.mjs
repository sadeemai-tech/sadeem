// v7 unit tests — codeintel (multi-language symbol index)
// Self-bootstrapping: bundles electron/agent/codeintel.ts with esbuild into
// tests/.codeintel.bundle.mjs when the bundle is missing or older than the
// source, then dynamic-imports it. No checked-in build artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const SRC = path.join(projectRoot, 'electron', 'agent', 'codeintel.ts');
const BUNDLE = path.join(here, '.codeintel.bundle.mjs');

// ---------- prelude: rebuild the bundle when stale ----------
function ensureBundle() {
  const stale = !existsSync(BUNDLE) || statSync(BUNDLE).mtimeMs < statSync(SRC).mtimeMs;
  if (!stale) return;
  const cmd =
    `npx esbuild ${JSON.stringify(SRC)} ` +
    `--bundle --platform=node --format=esm --outfile=${JSON.stringify(BUNDLE)}`;
  try {
    execSync(cmd, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    throw new Error(`codeintel bundle build failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
ensureBundle();

const { CodeIndex, extractSymbols, extractImports, LANGS } = await import(pathToFileURL(BUNDLE).href);

// ---------- fixtures ----------
const dir = mkdtempSync(path.join(tmpdir(), 'surnia-codeintel-'));
const join = (f) => path.join(dir, f);

const aTs = [
  "import { helper } from './util';",
  '',
  'export interface Shape {',
  '  area(): number;',
  '  perimeter(): number;',
  '}',
  '',
  'export class Helper {',
  '  private count = 0;',
  '',
  '  greet(name: string): string {',
  '    this.count++;',
  '    return `hello ${name} (${this.count})`;',
  '  }',
  '',
  '  run(n: number): number {',
  '    return n * 2;',
  '  }',
  '',
  '  reset(): void {',
  '    this.count = 0;',
  '  }',
  '}',
  '',
  'export function ping(msg: string): string {',
  '  return `ping:${msg}`;',
  '}',
  '',
  'export function pong(msg: string): string {',
  '  return ping(`pong:${msg}`);',
  '}',
  '',
  'export const double = (x: number) => x * 2;',
  '',
].join('\n');

const bTs = [
  "import { Helper, ping } from './a';",
  '',
  '// greet helper docs — see a.ts (comments must never count as references)',
  'export function main(): void {',
  '  const h = new Helper();',
  "  console.log(h.greet('world'));",
  "  console.log(ping('pong'));",
  '}',
  '',
].join('\n');

const utilPy = [
  'import os',
  '',
  'class Parser:',
  '    def __init__(self):',
  '        self.items = []',
  '',
  '    @staticmethod',
  '    def parse(line):',
  '        return line.strip()',
  '',
  '    def load(self, path):',
  '        with open(path) as fh:',
  '            return fh.read()',
  '',
  '    def save(self, path, data):',
  "        with open(path, 'w') as fh:",
  '            fh.write(data)',
  '',
  'def helper(x):',
  '    return os.path.basename(x)',
  '',
  'def shout(s):',
  '    return helper(s).upper()',
  '',
].join('\n');

const mainGo = [
  'package main',
  '',
  'import "fmt"',
  '',
  'type Server struct {',
  '    Port int',
  '}',
  '',
  'func (s *Server) Start() error {',
  '    fmt.Println("start", s.Port)',
  '    return nil',
  '}',
  '',
  'func main() {',
  '    s := &Server{Port: 8080}',
  '    s.Start()',
  '}',
  '',
].join('\n');

const appRb = [
  "require 'json'",
  '',
  'module Util',
  '  class Greeter',
  '    def initialize(name)',
  '      @name = name',
  '    end',
  '',
  '    def greet',
  '      "hello #{@name}"',
  '    end',
  '  end',
  'end',
  '',
  'def shout(s)',
  '  s.upcase',
  'end',
  '',
].join('\n');

const serviceJava = [
  'import java.util.List;',
  '',
  'public class Service {',
  '    private int calls = 0;',
  '',
  '    public int getCalls() {',
  '        return calls;',
  '    }',
  '',
  '    public void run(String name) {',
  '        calls++;',
  '        System.out.println(name);',
  '    }',
  '}',
  '',
].join('\n');

writeFileSync(join('a.ts'), aTs);
writeFileSync(join('b.ts'), bTs);
writeFileSync(join('util.py'), utilPy);
writeFileSync(join('main.go'), mainGo);
writeFileSync(join('app.rb'), appRb);
writeFileSync(join('Service.java'), serviceJava);

const pyLines = utilPy.split('\n');
const parseDecorLine = pyLines.findIndex((l) => l.trim() === '@staticmethod') + 1;
const parseDefLine = pyLines.findIndex((l) => l.includes('def parse')) + 1;
const parseBodyEnd = pyLines.findIndex((l) => l.includes('return line.strip()')) + 1;

const idx = new CodeIndex(dir);
const first = await idx.update();

// ---------- tests ----------

test('LANGS covers the advertised languages', () => {
  assert.equal(LANGS.ts[0], 'TypeScript');
  assert.equal(LANGS.py[0], 'Python');
  assert.equal(LANGS.go[0], 'Go');
  assert.equal(LANGS.sh[0], 'Shell');
  assert.ok(Array.isArray(LANGS.vue) && LANGS.vue[0] === 'Vue');
});

test('extractSymbols: ts class + methods + interface + const-arrow, with containers', () => {
  const syms = extractSymbols(join('a.ts'), aTs);
  const byName = new Map(syms.map((s) => [s.name, s]));
  const helper = byName.get('Helper');
  assert.ok(helper, 'Helper class found');
  assert.equal(helper.kind, 'class');
  assert.ok(helper.endLine > helper.line, 'endLine spans the body');
  const greet = byName.get('greet');
  assert.equal(greet.kind, 'method');
  assert.equal(greet.container, 'Helper');
  assert.equal(byName.get('Shape').kind, 'interface');
  assert.equal(byName.get('area').container, 'Shape');
  assert.equal(byName.get('ping').kind, 'function');
  const dbl = byName.get('double');
  assert.equal(dbl.kind, 'const');
  assert.ok(dbl.signature.startsWith('export const double'), dbl.signature);
  assert.ok(dbl.signature.length <= 120);
});

test('extractSymbols: python indent tracking, methods and decorators captured', () => {
  const syms = extractSymbols(join('util.py'), utilPy);
  const byName = new Map(syms.map((s) => [s.name, s]));
  const parser = byName.get('Parser');
  assert.equal(parser.kind, 'class');
  const parse = byName.get('parse');
  assert.equal(parse.kind, 'method');
  assert.equal(parse.container, 'Parser');
  // decorator captured: span starts at @staticmethod, signature still points at the def
  assert.equal(parse.line, parseDecorLine);
  assert.equal(parseDefLine, parseDecorLine + 1);
  assert.equal(parse.signature, 'def parse(line):');
  assert.equal(parse.endLine, parseBodyEnd);
  const helper = byName.get('helper');
  assert.equal(helper.kind, 'function');
  assert.ok(!helper.container, 'top-level def has no container');
});

test('extractSymbols: go struct + receiver method + func', () => {
  const syms = extractSymbols(join('main.go'), mainGo);
  const byName = new Map(syms.map((s) => [s.name, s]));
  const server = byName.get('Server');
  assert.equal(server.kind, 'struct');
  const start = byName.get('Start');
  assert.equal(start.kind, 'method');
  assert.equal(start.container, 'Server');
  const main = byName.get('main');
  assert.equal(main.kind, 'function');
  assert.ok(!main.container);
});

test('extractSymbols: unknown extension and imports edge cases return []', () => {
  assert.deepEqual(extractSymbols('x.weird', 'class A {}'), []);
  assert.deepEqual(extractImports('x.weird', "import 'x'"), []);
  assert.deepEqual(extractSymbols(join('a.ts'), ''), []);
});

test('extractImports: module specifiers per language', () => {
  assert.deepEqual(extractImports(join('b.ts'), bTs), ['./a']);
  assert.ok(extractImports(join('a.ts'), aTs).includes('./util'));
  assert.ok(extractImports(join('util.py'), utilPy).includes('os'));
  assert.ok(extractImports(join('main.go'), mainGo).includes('fmt'));
  assert.ok(extractImports(join('app.rb'), appRb).includes('json'));
  assert.ok(extractImports(join('Service.java'), serviceJava).includes('java.util.List'));
});

test('update() indexes the fixture repo with per-language stats', () => {
  assert.equal(first.files, 6);
  assert.equal(first.scanned, 6);
  assert.equal(first.changed, 6);
  assert.equal(first.partial, false);
  assert.equal(first.errors, 0);
  assert.equal(first.langs.TypeScript, 2);
  assert.equal(first.langs.Python, 1);
  assert.equal(first.langs.Go, 1);
  assert.equal(first.langs.Ruby, 1);
  assert.equal(first.langs.Java, 1);
  assert.ok(first.durationMs >= 0);
});

test('findDefinitions: exact > prefix > substring, kind filter and limit', () => {
  const defs = idx.findDefinitions('Helper');
  assert.ok(defs.length >= 1);
  assert.equal(defs[0].score, 3);
  assert.equal(defs[0].symbol.kind, 'class');
  assert.equal(defs[0].relPath, 'a.ts');
  assert.equal(defs[0].symbol.name, 'Helper');
  const onlyClass = idx.findDefinitions('Helper', { kind: 'class' });
  assert.equal(onlyClass.length, 1);
  assert.equal(onlyClass[0].symbol.name, 'Helper');
  const shape = idx.findDefinitions('Shape');
  assert.equal(shape.length, 1);
  assert.equal(shape[0].symbol.kind, 'interface');
  // prefix hits: ping, pong, parse, perimeter, Parser — capped by limit
  const p = idx.findDefinitions('p', { limit: 3 });
  assert.equal(p.length, 3);
  assert.ok(p.every((h) => h.score === 2));
  const limited = idx.findDefinitions('Helper', { limit: 1 });
  assert.equal(limited.length, 1);
});

test('findReferences: call site found; comments and the definition excluded', () => {
  const refs = idx.findReferences('greet');
  assert.equal(refs.length, 1, JSON.stringify(refs));
  assert.equal(refs[0].relPath, 'b.ts');
  assert.equal(refs[0].line, 6);
  assert.ok(refs[0].text.includes('h.greet'), refs[0].text);
  const ping = idx.findReferences('ping');
  assert.ok(ping.some((r) => r.relPath === 'b.ts' && r.line === 7));
});

test('impactOf: groups referencing files, flags importers, machine-readable summary', () => {
  const imp = idx.impactOf('Helper');
  assert.ok(imp.symbol);
  assert.equal(imp.symbol.kind, 'class');
  assert.equal(imp.symbol.name, 'Helper');
  const b = imp.files.find((f) => f.relPath === 'b.ts');
  assert.ok(b, 'b.ts in blast radius');
  assert.ok(b.refs >= 1);
  assert.equal(b.imports, true, "b.ts imports './a' -> flagged as importer");
  assert.match(imp.summary, /blast_radius name=Helper kind=class def=a\.ts:\d+ files=\d+ refs=\d+ importers=\d+ radius=\w+/);
});

test('repoMap: respects a tiny budget (ends with …, stays small), lists files with symbols', () => {
  const map = idx.repoMap(200);
  assert.ok(map.length < 400, `map too long: ${map.length}`);
  assert.ok(map.endsWith('…'), 'truncated map ends with ellipsis');
  assert.ok(map.includes('a.ts:'), map);
  const full = idx.repoMap(4000);
  assert.ok(full.includes('main.go: Server (5), Start (9), main (14)'), full);
});

test('outline: indented symbol tree with line numbers', () => {
  const out = idx.outline(join('util.py'));
  assert.ok(out.includes('util.py'), out);
  assert.ok(out.includes('class Parser ('), out);
  assert.match(out, /method parse \(\d+\)/, out);
  assert.ok(out.includes('  method parse'), 'methods are indented under their class');
  const ts = idx.outline(join('a.ts'));
  assert.match(ts, /interface Shape \(\d+\)/);
  assert.ok(ts.includes('  method greet'), ts);
});

test('update() is incremental: unchanged files are skipped entirely', async () => {
  const second = await idx.update();
  assert.equal(second.scanned, 0);
  assert.equal(second.changed, 0);
  assert.equal(second.files, 6);
  assert.equal(second.partial, false);
  assert.equal(second.errors, 0);
  const stats = idx.stats();
  assert.equal(stats.files, 6);
});

test('defensive: empty queries and missing files never throw', () => {
  assert.deepEqual(idx.findDefinitions(''), []);
  assert.deepEqual(idx.findReferences(''), []);
  const imp = idx.impactOf('');
  assert.equal(imp.symbol, null);
  assert.deepEqual(imp.files, []);
  assert.equal(typeof idx.outline(path.join(dir, 'does-not-exist.ts')), 'string');
  assert.equal(typeof idx.repoMap(1), 'string');
  assert.equal(idx.query('Helper', { limit: 1 }).length, 1, 'query() aliases findDefinitions');
});
