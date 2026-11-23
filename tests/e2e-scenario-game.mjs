// ============================================================
// E2E SCENARIO A (Task e2e-harness-A) — THE REAL ENGINE BUILDS A
// LARGE BROWSER SHOOTING GAME, END TO END.
// ------------------------------------------------------------
// Harness posture: EXACTLY the proven recipe of
// tests/v1111-antifreeze.test.mjs — the REAL engine loop
// (electron/agent/engine.ts runAgent) + the REAL provider streaming
// layer, driven by a SCRIPTED local OpenAI-compatible provider
// (scripts/e2e/fake-provider.mjs). Nothing here touches app source.
//
// What this PROVES: the engine -> tools -> filesystem pipeline works
// end to end (planning, workspace sanity, multi-file writes, a real
// edit, the Skills path, a REAL MCP stdio roundtrip through the app's
// own MCP code, and a shell command proof).
// What this does NOT prove: model intelligence — the LLM here is a
// deterministic script, not a thinking model.
//
// Scripted model order (per the mission):
//   a. todo_write   — 6-item plan
//   b. list_dir + read_file — workspace sanity
//   c. write_file index.html — large canvas shooter page (>= 250 lines)
//   d. write_file game.js (>= 300 lines) + style.css, then ui_quality_check
//      on index.html (the model probing its own UI sets the engine's
//      uiQualityRan flag — without it the engine-run UI-quality gate starts
//      a forced fix round that consumes an extra scripted turn)
//   e. edit_file game.js — a real small balance edit
//   f. use_skill 'canvas-game-basics' (fails — skill does not exist),
//      then create_skill (writes .surnia/skills/canvas-game-basics/SKILL.md)
//   g. mcp__proof__echo — REAL MCP stdio roundtrip (initialize ->
//      tools/list -> tools/call) via the engine's own MCP discovery
//      (params.mcpServers) against scripts/mcp-proof-server.mjs
//   h. run_command `node --check game.js` (syntax proof, auto-allow)
//   i. final text 'GAME BUILD COMPLETE ...'
//
// HARD ASSERTIONS: completion, on-disk files with promised line counts,
// node --check ok, SKILL.md exists, MCP call ok, task_report completed,
// >= 8 DISTINCT tools used. Prints: SCENARIO-A-RESULT: pass tools=<n> files=<n>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScenario } from '../scripts/e2e/run-engine.mjs';
import { INDEX_HTML, GAME_JS, STYLE_CSS, SKILL_BODY } from '../scripts/e2e/game-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROOF_SERVER = fileURLToPath(new URL('../scripts/mcp-proof-server.mjs', import.meta.url));
const RESULTS_DIR = process.env.E2E_RESULTS_DIR ?? '/home/z/my-project/work/e2e-results';
const MODEL = 'e2e-game-model';
const SKILL_SLUG = 'canvas-game-basics';

const countLines = (text) => text.replace(/\n$/, '').split('\n').length;

/** STEP 4 — artifacts: game workspace + full event stream + summary JSON. */
function writeArtifacts(workspace, result) {
  const out = { copied: [], jsonl: false, summary: false, error: null };
  try {
    mkdirSync(join(RESULTS_DIR, 'game'), { recursive: true });
    for (const f of ['index.html', 'game.js', 'style.css']) {
      copyFileSync(join(workspace, f), join(RESULTS_DIR, 'game', f));
      out.copied.push(f);
    }
    const skillSrc = join(workspace, '.surnia', 'skills', SKILL_SLUG, 'SKILL.md');
    if (existsSync(skillSrc)) {
      copyFileSync(skillSrc, join(RESULTS_DIR, 'game', 'SKILL.md'));
      out.copied.push('SKILL.md');
    }
    writeFileSync(
      join(RESULTS_DIR, 'scenario-a-events.jsonl'),
      result.events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
    out.jsonl = true;
    writeFileSync(
      join(RESULTS_DIR, 'scenario-a-summary.json'),
      JSON.stringify(
        {
          pass: true,
          toolsUsed: result.toolsUsed,
          filesWritten: result.filesWritten,
          taskReport: result.taskReport,
          durationMs: result.durationMs,
          providerRequests: result.providerRequests.length,
        },
        null,
        2,
      ),
    );
    out.summary = true;
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

test('E2E Scenario A: real engine + scripted provider build a large canvas shooting game', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'sadeem-e2e-game-'));
  // A seed file so the scripted read_file sanity check has something real to
  // read (list_dir + read_file on a genuinely present file).
  writeFileSync(
    join(workspace, 'seed-notes.md'),
    'ملاحظات ساحة العمل (ملف بذرة من منظم الاختبار).\nالمطلوب: لعبة إطلاق نار على لوحة الرسم بثلاث ملفات ثم تحقق بالصياغة.\n',
  );

  // ---- the scripted model: 13 deterministic assistant turns ----
  const steps = [
    // (a) plan
    {
      tool: {
        name: 'todo_write',
        id: 'call_plan',
        args: {
          todos: [
            { id: 't1', content: 'فحص مجلد العمل وقراءة الملاحظات', status: 'in_progress' },
            { id: 't2', content: 'كتابة index.html صفحة اللعبة الكاملة', status: 'pending' },
            { id: 't3', content: 'كتابة game.js منطق اللعبة الكامل', status: 'pending' },
            { id: 't4', content: 'كتابة style.css التصميم الداكن', status: 'pending' },
            { id: 't5', content: 'تعديل توازن سرعة الأعداء في game.js', status: 'pending' },
            { id: 't6', content: 'حفظ مهارة canvas-game-basics والتحقق ب node --check', status: 'pending' },
          ],
        },
      },
    },
    // (b) workspace sanity
    { tool: { name: 'list_dir', id: 'call_dir', args: { path: workspace } } },
    { tool: { name: 'read_file', id: 'call_seed', args: { path: join(workspace, 'seed-notes.md') } } },
    // (c) index.html — large real shooter page
    { tool: { name: 'write_file', id: 'call_html', args: { path: 'index.html', content: INDEX_HTML } } },
    // (d) game.js + style.css
    { tool: { name: 'write_file', id: 'call_js', args: { path: 'game.js', content: GAME_JS } } },
    { tool: { name: 'write_file', id: 'call_css', args: { path: 'style.css', content: STYLE_CSS } } },
    { tool: { name: 'ui_quality_check', id: 'call_uiq', args: { path: 'index.html' } } },
    // (e) a REAL small edit (harness-enforced read-before-edit satisfied above)
    { tool: { name: 'read_file', id: 'call_readjs', args: { path: 'game.js', offset: 1, limit: 30 } } },
    {
      tool: {
        name: 'edit_file',
        id: 'call_edit',
        args: {
          path: 'game.js',
          old_string: 'const ENEMY_BASE_SPEED = 1.6;',
          new_string: 'const ENEMY_BASE_SPEED = 2.1; // توازن بعد اختبار اللعب',
        },
      },
    },
    // (f) Skills path: use_skill fails (no such skill) -> create_skill writes SKILL.md
    { tool: { name: 'use_skill', id: 'call_useskill', args: { slug: SKILL_SLUG } } },
    {
      tool: {
        name: 'create_skill',
        id: 'call_createskill',
        args: {
          name: 'Canvas game basics',
          description: 'وصفة بناء لعبة كانفس كاملة: حلقة رسم، أعداء، جسيمات، مراحل.',
          scope: 'workspace',
          body: SKILL_BODY,
        },
      },
    },
    // (g) MCP stdio roundtrip through the engine's own MCP discovery
    { tool: { name: 'mcp__proof__echo', id: 'call_mcp', args: { message: 'ping-from-scenario-a' } } },
    // (h) syntax proof (auto-allowed)
    { tool: { name: 'run_command', id: 'call_check', args: { command: 'node --check game.js', timeout_seconds: 60 } } },
    // (i) final text ends the run
    {
      text: 'GAME BUILD COMPLETE — كُتبت لعبة سهم السديم كاملة: index.html و game.js و style.css، مع مهارة canvas-game-basics محفوظة ونداء MCP ناجح وتحقق node --check سليم.',
    },
  ];

  const mcpServers = [
    {
      id: 'proof',
      name: 'proof',
      command: process.execPath,
      args: [PROOF_SERVER],
      enabled: true,
    },
  ];

  const result = await runScenario({
    name: 'scenario-a-game',
    prompt:
      'ابنِ لعبة إطلاق نار كاملة تعمل على لوحة الرسم: index.html و game.js و style.css داخل مجلد العمل، ' +
      'مع خطة من ست خطوات، ثم عدّل توازن السرعة، واحفظ مهارة باسم canvas-game-basics، ' +
      'ونادِ أداة MCP echo من خادم proof، وتحقق من صياغة game.js بأمر node --check. Build it end to end.',
    model: MODEL,
    steps,
    workspace,
    timeoutMs: 240_000,
    mcpServers,
  });

  try {
    // ---------- 1. the run COMPLETED (harness hard assertion) ----------
    assert.equal(result.taskReport?.outcome, 'completed', 'task_report outcome is completed');
    assert.deepEqual(
      result.errors,
      [],
      `no engine error events (got: ${JSON.stringify(result.errors)})`,
    );
    assert.ok(result.finalText.includes('GAME BUILD COMPLETE'), 'final text carries the completion marker');

    // scripted turns consumed exactly as ordered (no overrun / no 500s)
    assert.equal(result.providerExhausted.length, 0, 'provider script never exhausted (no overrun)');
    assert.equal(result.providerServed.length, steps.length, 'every scripted turn served exactly once');

    // (a) the plan reached the UI as a todo event with 6 items
    assert.equal(result.todos?.length, 6, 'todo_write produced a 6-item todo event');

    // ---------- 2. files exist on disk with the promised line counts ----------
    const htmlPath = join(workspace, 'index.html');
    const jsPath = join(workspace, 'game.js');
    const cssPath = join(workspace, 'style.css');
    assert.ok(existsSync(htmlPath) && existsSync(jsPath) && existsSync(cssPath), 'the three game files exist on disk');
    const html = readFileSync(htmlPath, 'utf8');
    const js = readFileSync(jsPath, 'utf8');
    const css = readFileSync(cssPath, 'utf8');
    assert.ok(countLines(html) >= 250, `index.html >= 250 lines (got ${countLines(html)})`);
    assert.ok(countLines(js) >= 300, `game.js >= 300 lines (got ${countLines(js)})`);
    assert.ok(countLines(css) >= 60, `style.css substantial (got ${countLines(css)})`);
    // honest game page: Arabic title, canvas, game.js wiring
    assert.ok(html.includes('سهم السديم'), 'index.html carries the Arabic game title');
    assert.ok(html.includes('<canvas') && html.includes('game.js'), 'index.html wires the canvas + game.js');
    // (e) the edit really landed
    assert.ok(
      js.includes('const ENEMY_BASE_SPEED = 2.1;') && !js.includes('const ENEMY_BASE_SPEED = 1.6;'),
      'edit_file rewrote the enemy speed constant on disk',
    );

    // the model probed its own UI through the REAL ui_quality_check tool
    const uiq = result.toolCalls.find((t) => t.name === 'ui_quality_check');
    assert.ok(uiq, 'ui_quality_check ran through the engine (self-probed UI)');
    assert.equal(uiq.ok, true, 'ui_quality_check tool result is ok');

    // ---------- 3. run_command `node --check game.js` OK ----------
    const check = result.toolCalls.find(
      (t) => t.name === 'run_command' && String(t.args?.command ?? '').includes('--check game.js'),
    );
    assert.ok(check, 'the scripted node --check command ran through run_command');
    assert.equal(check.ok, true, 'node --check game.js exited OK');

    // ---------- 4. the SKILL.md exists on disk (Skills path writes real files) ----------
    const skillPath = join(workspace, '.surnia', 'skills', SKILL_SLUG, 'SKILL.md');
    assert.ok(existsSync(skillPath), 'create_skill wrote .surnia/skills/canvas-game-basics/SKILL.md');
    const skillMd = readFileSync(skillPath, 'utf8');
    assert.ok(skillMd.includes('Canvas game basics') && skillMd.includes('---'), 'SKILL.md has frontmatter + body');

    // (f) use_skill honestly FAILED first (skill did not exist)
    const useSkill = result.toolCalls.find((t) => t.name === 'use_skill');
    assert.ok(useSkill, 'use_skill ran');
    assert.equal(useSkill.ok, false, 'use_skill for the missing skill failed (expected)');

    // ---------- 5. REAL MCP stdio roundtrip with an ok result ----------
    const mcp = result.toolCalls.find((t) => t.name === 'mcp__proof__echo');
    assert.ok(mcp, 'the engine advertised + the model called the MCP tool');
    assert.equal(mcp.ok, true, 'MCP tools/call roundtrip OK');
    assert.ok(
      String(mcp.output).includes('echo: ping-from-scenario-a'),
      'MCP result text round-tripped from the real proof server',
    );

    // ---------- 6. toolUsage: >= 8 DISTINCT tool names ----------
    const distinct = result.toolsUsed.length;
    assert.ok(
      distinct >= 8,
      `>= 8 distinct tools used (got ${distinct}: ${result.toolsUsed.join(', ')})`,
    );
    assert.ok(result.filesWritten.length >= 3, `>= 3 files written (got ${result.filesWritten.join(', ')})`);

    console.log(`[scenario-a] durationMs=${result.durationMs} providerRequests=${result.providerRequests.length}`);
    console.log(`[scenario-a] lines: index.html=${countLines(html)} game.js=${countLines(js)} style.css=${countLines(css)}`);
    console.log(`SCENARIO-A-RESULT: pass tools=${distinct} files=${result.filesWritten.length}`);

    // ---------- STEP 4: artifacts ----------
    const artifacts = writeArtifacts(workspace, result);
    if (artifacts.error) {
      console.error(`[scenario-a] artifact writing failed: ${artifacts.error}`);
    } else {
      console.log(`[scenario-a] artifacts -> ${RESULTS_DIR} (${artifacts.copied.join(', ')})`);
    }
  } finally {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
});
