// ============================================================
// SADEEM v11.21 — PANELS SMOKE (source-level regression guard).
//
// The founder reported a React #300 crash in the Skills panel and asked
// to verify every section. Two distinct source-level classes cause that
// family of crashes, and BOTH are checked here centrally so a future
// panel / settings section cannot reintroduce them:
//
//   1. Unstable zustand selector: `useStore((s) => ({ ... }))` returns a
//      NEW object on every render. With zustand v5 + useSyncExternalStore
//      that is an infinite re-render loop ("getSnapshot should be cached")
//      and the React "too many re-renders" fault.
//
//   2. Hook called AFTER a conditional early return inside the same
//      component (e.g. `if (open) return <Detail/>; ... useCallback(...)`).
//      The hook count changes between renders → React #300
//      "Rendered more hooks than during the previous render" (and #310
//      "Rendered fewer hooks than expected" on the way back).
//      This is the exact class that broke SkillsPanel (loadRivals).
//
//   Run: node --test --test-force-exit tests/v1121-panels-smoke.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');

const PANELS_DIR = join(ROOT, 'src', 'components', 'panels');
const SETTINGS_DIR = join(ROOT, 'src', 'components', 'settings');

function tsxFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

const FILES = [
  ...tsxFiles(PANELS_DIR),
  ...tsxFiles(SETTINGS_DIR),
  join(ROOT, 'src', 'components', 'SearchPanel.tsx'),
].filter((f) => {
  try { readFileSync(f); return true; } catch { return false; }
});

const rel = (f) => f.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');

// ------------------------------------------------------------------
// 1. Unstable object selectors
// ------------------------------------------------------------------
// Matches `useStore((s) => ({`, `useStore((state)=>({`, `useStore(s=>({`,
// with any spacing. `useShallow` / `shallow` wrappers are not used in this
// codebase, so ANY object-returning selector is unsafe here.
const OBJECT_SELECTOR = /useStore\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\s*\{/g;

test('v11.21: no panel/settings uses an unstable object selector useStore((s) => ({...}))', () => {
  const offenders = [];
  for (const file of FILES) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (OBJECT_SELECTOR.test(line)) {
        offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        OBJECT_SELECTOR.lastIndex = 0;
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'Unstable object selectors cause an infinite re-render loop (React #300 / zustand getSnapshot). Return primitives or stable refs instead.',
  );
});

// ------------------------------------------------------------------
// 2. Hook after conditional early return (React #300)
// ------------------------------------------------------------------
function isHook(name) {
  return /^use[A-Z]/.test(name);
}
function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'React') {
    return expr.name.text;
  }
  return null;
}

/** Return [{ hook, line, guardLine, fn }] for hooks placed after an
 *  early-return guard within the SAME function component. */
function hooksAfterEarlyReturns(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
      node.body && ts.isBlock(node.body)
    ) {
      let guardLine = null;
      for (const st of node.body.statements) {
        // An `if (...) { return ...; }` guard at this function's top level.
        if (ts.isIfStatement(st) && st.thenStatement && ts.isBlock(st.thenStatement)) {
          const hasReturn = st.thenStatement.statements.some((s) => ts.isReturnStatement(s));
          if (hasReturn) guardLine = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
        }
        let hookLine = null;
        let hookName = null;
        (function findHook(n) {
          if (ts.isCallExpression(n)) {
            const nm = calleeName(n.expression);
            if (nm && isHook(nm)) {
              hookLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
              hookName = nm;
              return;
            }
          }
          ts.forEachChild(n, findHook);
        })(st);
        if (guardLine && hookLine && hookLine > guardLine) {
          const fn = node.name
            ? node.name.text
            : ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(sf) : '<anonymous>';
          out.push({ hook: hookName, line: hookLine, guardLine, fn });
        }
        if (hookLine) guardLine = null;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

test('v11.21: no panel/settings calls a hook after an early return (React #300)', () => {
  const offenders = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    for (const o of hooksAfterEarlyReturns(src, file)) {
      offenders.push(
        `${rel(file)}:${o.line}: ${o.fn}() calls ${o.hook}() after early return @${o.guardLine}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'React #300 "Rendered more hooks than during the previous render": move ALL hooks above any conditional return.',
  );
});
