// v11.12 enhancements — honest LSP language matrix + real heuristic fallbacks.
//
// Contract under test:
//   1. The 16 wired servers pass a launch-command / root-marker / install-hint
//      audit (the very specs lsp.ts spawns from, not a hand-written copy).
//   2. PHP / Go / Python workspaces yield REAL symbols even with no server
//      installed — via the explicitly named symbol_outline heuristic, plus an
//      honest "server not installed: <command>" line. Never an empty success.
//   3. lsp_rename REFUSES when the server is missing (no fabricated edits).
//   4. Heuristic-only languages (YAML/Markdown/SQL/GraphQL/…) really extract
//      symbols through the regex/AST-lite readers.
//
// Self-bootstrapping esbuild bundles, same posture as the other harnesses.
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1112-lsp-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
    '--external:../services/terminalService',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const lsp = (() => {
  const p = join(tmp, 'lsp.cjs');
  bundle('electron/agent/lsp.ts', p);
  return require(p);
})();
const codeintel = (() => {
  const p = join(tmp, 'codeintel.cjs');
  bundle('electron/agent/codeintel.ts', p);
  return require(p);
})();

function ctxFor(ws) {
  return {
    workspace: ws, sessionId: 'v1112', mcpServers: [], emit() {},
    approve: async () => true, fullAccess: true, denyHint: true,
  };
}

// ---------------------------------------------------------------------------
// 1. Matrix correctness
// ---------------------------------------------------------------------------

test('v1112 support matrix: all 16 wired servers have command, roots, install hint', () => {
  const report = lsp.verifyLanguageMatrix();
  assert.equal(report.total, 16, 'exactly 16 wired language servers');
  assert.equal(report.ok, true, `every row is honest: ${report.rows.filter((r) => !r.ok).map((r) => `${r.lang}=${r.issues}`).join('; ')}`);
  assert.deepEqual(report.rows.map((r) => r.lang), [
    'typescript', 'python', 'go', 'rust', 'java', 'php', 'ruby', 'cpp',
    'csharp', 'kotlin', 'swift', 'dart', 'elixir', 'r', 'lua', 'zig',
  ]);
  for (const row of report.rows) {
    assert.ok(row.command.length > 1, `${row.lang}: launch command`);
    assert.ok(row.rootFiles.length > 0, `${row.lang}: root markers`);
    assert.ok(row.installHint.length > 5, `${row.lang}: install hint`);
    assert.ok(row.extensions.length > 0, `${row.lang}: extensions resolve back to the server`);
    if (!row.autoInstall) assert.ok(row.externalBinary, `${row.lang}: manual server names its external binary`);
  }
  const byLang = Object.fromEntries(report.rows.map((r) => [r.lang, r]));
  assert.match(byLang.php.installHint, /npm i -g intelephense/);
  assert.match(byLang.go.installHint, /go install .*gopls/);
  assert.match(byLang.python.installHint, /pyright/);
  assert.equal(byLang.cpp.autoInstall, false, 'clangd is never auto-installed');
  assert.match(byLang.cpp.externalBinary, /LLVM|clangd/);
});

// ---------------------------------------------------------------------------
// 2. Real symbols for a PHP / Go / Python workspace, named as heuristic
// ---------------------------------------------------------------------------

const WORKSPACES = [
  {
    lang: 'php', file: 'index.php', command: 'intelephense',
    source: '<?php\nfunction greet($n) { return $n; }\nclass Box { public function open() {} }\n',
    symbols: ['greet', 'Box'],
    line: 2, character: 10,
  },
  {
    lang: 'go', file: 'main.go', command: 'gopls',
    source: 'package main\n\nfunc Serve() {}\ntype Server struct{}\n',
    symbols: ['Serve', 'Server'],
    line: 3, character: 6,
  },
  {
    lang: 'python', file: 'app.py', command: 'pyright-langserver',
    source: 'class App:\n    def run(self):\n        return 1\n\ndef main():\n    return App()\n',
    symbols: ['App', 'run', 'main'],
    line: 2, character: 9,
  },
];

for (const w of WORKSPACES) {
  test(`v1112 ${w.lang} workspace: lsp_symbols returns real symbols, named fallback, install hint`, async () => {
    const ws = join(tmp, `${w.lang}-ws`);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, w.file), w.source);
    const ctx = ctxFor(ws);

    const r = await lsp.lspSymbolsTool({ path: w.file }, ctx);
    assert.equal(r.ok, true, `${w.lang}: informative result, never an empty success`);
    assert.ok(r.output.startsWith('lsp_symbols:'), 'executor identifies itself');
    assert.match(r.output, new RegExp(`server not installed: ${w.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(r.output, /HEURISTIC FALLBACK/);
    for (const fb of ['find_refs', 'symbol_outline', 'repo_map', 'search_files']) {
      assert.ok(r.output.includes(fb), `${w.lang}: result names ${fb}`);
    }
    for (const name of w.symbols) assert.ok(r.output.includes(name), `${w.lang}: real symbol ${name} present`);
  });

  test(`v1112 ${w.lang}: definition + references fallbacks are useful and labelled`, async () => {
    const ws = join(tmp, `${w.lang}-ws`);
    const ctx = ctxFor(ws);
    const args = { path: w.file, line: w.line, character: w.character };
    const def = await lsp.lspDefinitionTool(args, ctx);
    assert.equal(def.ok, true);
    assert.match(def.output, /HEURISTIC FALLBACK/);
    assert.match(def.output, /definition of /);
    const refs = await lsp.lspReferencesTool(args, ctx);
    assert.equal(refs.ok, true);
    assert.match(refs.output, /HEURISTIC FALLBACK/);
    assert.match(refs.output, /find_refs/);
  });

  test(`v1112 ${w.lang}: rename refuses when the server is missing`, async () => {
    const ws = join(tmp, `${w.lang}-ws`);
    const ctx = ctxFor(ws);
    const r = await lsp.lspRenameTool({
      path: w.file, line: w.line, character: w.character, new_name: 'renamed',
    }, ctx);
    assert.equal(r.ok, false, 'no fabricated rename edits');
    assert.match(r.output, /server not installed: /);
    assert.match(r.output, /Refusing to guess rename edits/);
    assert.doesNotMatch(r.output, /Tool error:/);
  });
}

// ---------------------------------------------------------------------------
// 3. Heuristic-only languages really extract symbols
// ---------------------------------------------------------------------------

test('v1112 heuristic-only languages: regex/AST-lite scanners return real symbols', () => {
  const { extractSymbols, symbolAtPosition, HEURISTIC_LABEL } = codeintel;
  assert.match(HEURISTIC_LABEL, /NOT LSP/);
  const cases = [
    ['a.yaml', 'name: demo\nserver:\n  port: 8080\n', ['name', 'server', 'port']],
    ['a.md', '# Title\n## Section\n', ['Title', 'Section']],
    ['a.sql', 'CREATE TABLE users (id int);\nCREATE FUNCTION f() RETURNS int;\n', ['users', 'f']],
    ['a.scala', 'class Foo {\n  def bar(): Int = 1\n}\n', ['Foo', 'bar']],
    ['a.graphql', 'type User { id: ID! }\nquery GetUser { user }\n', ['User', 'GetUser']],
    ['a.cs', 'class C {\n  void M() {}\n}\n', ['C', 'M']],
  ];
  for (const [file, content, names] of cases) {
    const syms = extractSymbols(file, content);
    for (const n of names) assert.ok(syms.some((s) => s.name === n), `${file}: ${n} extracted`);
  }
  assert.equal(symbolAtPosition('app.py', 'def greet():\n    pass\n', 1, 6), 'greet');
});

test('v1112 unsupported language still yields a named heuristic outline, never a crash', async () => {
  const ws = join(tmp, 'shell-ws');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'build.sh'), '#!/bin/sh\nbuild_all() { echo hi; }\n');
  const r = await lsp.lspSymbolsTool({ path: 'build.sh' }, ctxFor(ws));
  assert.equal(r.ok, true);
  assert.match(r.output, /no real language server is configured for \.sh/i);
  assert.match(r.output, /HEURISTIC FALLBACK/);
  assert.ok(r.output.includes('build_all'), 'real shell function symbol extracted');
});
