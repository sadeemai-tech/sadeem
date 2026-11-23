// v11.16 — LSP language coverage (the founder's long-standing demand).
//
// Contract under test:
//   1. The shared registry (electron/agent/lspLanguages.ts) is the single
//      source of truth and contains >= 12 languages with real, wired servers,
//      each with an exact package, install hint, launch command and root
//      markers — plus an HONEST external-binary note where one is required.
//   2. Launching a server that is not installed returns an honest error that
//      names the install command and the heuristic fallbacks — never a crash.
//   3. Languages with no feasible LSP explicitly name find_refs /
//      symbol_outline / repo_map / search_files so the model can still work.
//   4. The existing LSP tools dispatch for a NEW language (PHP workspace) and
//      return a useful result or an honest "install X" error.
//
// Self-bootstrapping esbuild bundles, same posture as the other harnesses.
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1116-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
    // lsp.ts requires terminalService lazily (only when auto-installing). The
    // tests pass denyHint, so it is never executed; externalising keeps this
    // harness independent of unrelated modules that other agents may be editing.
    '--external:../services/terminalService',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// The pure registry needs no electron stub.
const registry = (() => {
  const p = join(tmp, 'lspLanguages.cjs');
  bundle('electron/agent/lspLanguages.ts', p);
  return require(p);
})();

const {
  LSP_SERVERS, HEURISTIC_ONLY, HEURISTIC_FALLBACKS,
  specForFile, hasRealServer, detectRoot, findLanguage, formatMatrix,
  describeLanguage, heuristicSentence,
} = registry;

// The LSP tool executors are tested directly from lsp.ts — this is the exact
// function tools.ts forwards to (verified by a source-contract check below),
// and it keeps this harness independent of the wider tool graph.
const lsp = (() => {
  const p = join(tmp, 'lsp.cjs');
  bundle('electron/agent/lsp.ts', p);
  return require(p);
})();

// ---------------------------------------------------------------------------
// 1. Matrix completeness + honesty
// ---------------------------------------------------------------------------

test('v11.16 registry: >=12 real servers, each with package/install/launch/root markers', () => {
  assert.ok(LSP_SERVERS.length >= 12, `expected >=12 wired servers, got ${LSP_SERVERS.length}`);
  const keys = new Set();
  for (const s of LSP_SERVERS) {
    assert.ok(s.lang && s.language, 'stable key + display name present');
    assert.ok(!keys.has(s.lang), `no duplicate key: ${s.lang}`);
    keys.add(s.lang);
    assert.ok(s.command && s.command.length > 1, `${s.lang}: launch command present`);
    assert.ok(s.package && s.package.length > 3, `${s.lang}: exact package named`);
    assert.ok(s.installHint && s.installHint.length > 5, `${s.lang}: install hint present`);
    assert.ok(Array.isArray(s.exts) && s.exts.length > 0, `${s.lang}: extensions present`);
    assert.ok(Array.isArray(s.rootFiles) && s.rootFiles.length > 0, `${s.lang}: root markers present`);
    assert.ok(s.languageId && s.languageId.length > 0, `${s.lang}: LSP languageId present`);
    if (s.install) {
      assert.ok(s.install.exe && Array.isArray(s.install.args), `${s.lang}: declarative install recipe is well formed`);
    } else {
      // Manual/external servers must say so honestly.
      assert.ok(s.externalBinary && s.externalBinary.length > 5, `${s.lang}: manual server has an honest external-binary note`);
    }
  }
  // The founder's explicitly named languages must all be present.
  for (const lang of ['java', 'php', 'ruby', 'cpp', 'csharp', 'kotlin', 'swift', 'dart', 'elixir', 'r', 'lua', 'zig']) {
    assert.ok(keys.has(lang), `${lang} is wired with a real server`);
  }
  // At least a handful are honest about an external binary / runtime.
  assert.ok(LSP_SERVERS.filter((s) => s.externalBinary).length >= 8, 'external binaries are disclosed honestly');
});

test('v11.16 registry: external-binary notes name the real runtimes', () => {
  const byLang = Object.fromEntries(LSP_SERVERS.map((s) => [s.lang, s]));
  assert.match(byLang.java.externalBinary, /Java|JDK/i);
  assert.match(byLang.cpp.externalBinary, /clangd|LLVM/i);
  assert.match(byLang.csharp.externalBinary, /\.NET|dotnet/i);
  assert.match(byLang.ruby.externalBinary, /Ruby/i);
  assert.match(byLang.python.installHint, /pyright/i);
  assert.equal(byLang.php.install, byLang.php.install, 'php has a declarative auto-install recipe');
  assert.ok(byLang.php.install, 'intelephense is auto-installable via npm');
});

test('v11.16 registry: extension → spec, root detection, and language lookup', () => {
  assert.equal(specForFile('a.php')?.lang, 'php');
  assert.equal(specForFile('Main.java')?.lang, 'java');
  assert.equal(specForFile('build.zig')?.lang, 'zig');
  assert.equal(specForFile('script.sh'), null, 'shell has no real server');
  assert.equal(hasRealServer('.php'), true);
  assert.equal(hasRealServer('sh'), false);

  const nested = join(tmp, 'proj', 'src', 'deep');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(tmp, 'proj', 'composer.json'), '{}');
  writeFileSync(join(nested, 'Thing.php'), '<?php class Thing {}');
  assert.equal(detectRoot(join(nested, 'Thing.php'), tmp, ['composer.json']), join(tmp, 'proj'), 'root walks up to composer.json');

  assert.equal(findLanguage('PHP').kind, 'server');
  assert.equal(findLanguage('.php').spec.lang, 'php');
  assert.equal(findLanguage('shell').kind, 'heuristic');
  assert.equal(findLanguage('totally-made-up'), null);
});

// ---------------------------------------------------------------------------
// 2 & 3. Honest errors + named heuristics
// ---------------------------------------------------------------------------

test('v11.16 formatMatrix/describeLanguage name every heuristic fallback', () => {
  const matrix = formatMatrix();
  for (const fb of HEURISTIC_FALLBACKS) assert.ok(matrix.includes(fb), `matrix names ${fb}`);
  for (const s of LSP_SERVERS) assert.ok(matrix.includes(s.command), `matrix lists ${s.command}`);
  assert.ok(HEURISTIC_ONLY.length >= 10, 'heuristic-only languages are enumerated');

  const php = describeLanguage('php');
  assert.match(php, /intelephense/);
  assert.match(php, /npm i -g intelephense/);

  const shell = describeLanguage('shell');
  assert.match(shell, /NOT backed by a real LSP server/i);
  for (const fb of HEURISTIC_FALLBACKS) assert.ok(shell.includes(fb), `unsupported answer names ${fb}`);
  assert.match(heuristicSentence(), /find_refs \/ symbol_outline \/ repo_map \/ search_files/);
});

test('v11.16 lsp.ts consumes the shared registry (no divergent local SERVERS table)', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/lsp.ts'), 'utf8');
  assert.match(src, /from '\.\/lspLanguages'/, 'lsp.ts imports the shared matrix');
  assert.doesNotMatch(src, /const SERVERS: ServerSpec\[\]/, 'no second, local server table');
  assert.match(src, /heuristicSentence\(\)/, 'unsupported/missing-server results name the heuristics');
  assert.match(src, /detectRoot\(/, 'root resolution is wired into ensureSession');
  assert.match(src, /if \(!spec\.install\)/, 'manual/external servers are never auto-installed');

  // tools.ts is a thin forwarder to these exact executors (no re-implementation).
  const toolsSrc = readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8');
  // The dispatch may be wrapped by lspAssisted() (TOOL-ERRORS integration) —
  // either form still forwards to the exact executor exported by lsp.ts.
  assert.match(toolsSrc, /case 'lsp_definition':\s*return await (?:lspAssisted\('lsp_definition',\s*)?lspDefinitionTool\(args, ctx\)/, 'lsp_definition dispatch wired');
  assert.match(toolsSrc, /case 'lsp_hover':\s*return await (?:lspAssisted\('lsp_hover',\s*)?lspHoverTool\(args, ctx\)/, 'lsp_hover dispatch wired');
});

// ---------------------------------------------------------------------------
// 4. End-to-end dispatch for a NEW language (PHP), never a crash
// ---------------------------------------------------------------------------

function ctxFor(extra = {}) {
  return {
    workspace: tmp, sessionId: 'v1116', mcpServers: [],
    emit: () => {}, approve: async () => true, fullAccess: true,
    // Prevent the test from actually performing a global npm install.
    denyHint: true,
    ...extra,
  };
}

test('v11.16 LSP tools dispatch for PHP: honest "install intelephense" error, no crash', async () => {
  const phpDir = join(tmp, 'phpws');
  mkdirSync(phpDir, { recursive: true });
  writeFileSync(join(phpDir, 'index.php'), '<?php\nfunction greet($n) { return $n; }\n');

  const ctx = ctxFor({ workspace: phpDir });
  let r;
  try {
    r = await lsp.lspDefinitionTool({ path: 'index.php', line: 2, character: 10 }, ctx);
  } catch (err) {
    assert.fail(`lsp_definition threw for PHP: ${err.message}`);
  }
  assert.ok(r && typeof r === 'object', 'a result object is returned');
  assert.equal(typeof r.ok, 'boolean', 'ok flag present');
  assert.ok(typeof r.output === 'string' && r.output.length > 20, 'an honest, non-empty message is returned');
  assert.match(r.output, /^lsp_definition:/, 'the LSP executor ran and reported itself');
  assert.doesNotMatch(r.output, /Tool error:/, 'the last-resort crash guard was not hit');
  assert.match(r.output, /intelephense/, 'the missing server is named');
  assert.match(r.output, /npm i -g intelephense/, 'the exact install command is given');
  assert.match(r.output, /find_refs/, 'heuristic fallbacks are named');
  assert.match(r.output, /symbol_outline/);
  assert.match(r.output, /repo_map/);
  assert.match(r.output, /search_files/);
});

test('v11.16 unsupported language (shell) returns honest heuristic guidance, no crash', async () => {
  const shDir = join(tmp, 'shws');
  mkdirSync(shDir, { recursive: true });
  writeFileSync(join(shDir, 'build.sh'), '#!/bin/sh\necho hi\n');
  const ctx = ctxFor({ workspace: shDir });
  let r;
  try {
    r = await lsp.lspHoverTool({ path: 'build.sh', line: 1, character: 1 }, ctx);
  } catch (err) {
    assert.fail(`lsp_hover threw for shell: ${err.message}`);
  }
  assert.equal(r.ok, false, 'unsupported language is refused honestly');
  assert.match(r.output, /no real language server is configured for \.sh/i);
  for (const fb of HEURISTIC_FALLBACKS) assert.ok(r.output.includes(fb), `shell refusal names ${fb}`);
  assert.doesNotMatch(r.output, /Tool error:/);
});

test('v11.16 heuristic fallbacks actually index the newly covered languages', async () => {
  const p = join(tmp, 'codeintel.cjs');
  bundle('electron/agent/codeintel.ts', p);
  const { LANGS, extractSymbols } = require(p);
  assert.ok(LANGS.php && LANGS.ex && LANGS.r && LANGS.zig, 'PHP/Elixir/R/Zig are indexable');

  const syms = extractSymbols('greet.php', '<?php\nfunction greet($n) { return $n; }\n');
  assert.ok(syms.some((s) => s.name === 'greet'), 'PHP symbol_outline works');
  const ex = extractSymbols('app.ex', 'defmodule App do\n  def run(x), do: x\nend\n');
  assert.ok(ex.some((s) => s.name === 'App' && s.kind === 'module'), 'Elixir module symbol extracted');
  const zig = extractSymbols('main.zig', 'pub fn main() void {\n}\n');
  assert.ok(zig.some((s) => s.name === 'main'), 'Zig function symbol extracted');
});
