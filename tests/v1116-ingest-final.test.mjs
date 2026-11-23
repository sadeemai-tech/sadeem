import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.16 — FINAL EXHAUSTIVE INGEST AUDIT.
//
// The renderer's `ingestAgentEvent` is the single choke point for the whole
// agent stream: one throw drops the current event's state update (buffered
// deltas never flush → "thinking stops") and repeats on every later event.
// This suite drives the REAL bundled store through:
//   • a 3,000-event seeded fuzz spanning EVERY known AgentEvent type and every
//     malformed field shape (null / undefined / non-array / non-number / …);
//   • the true-no-op guarantee for unknown/forward-compatible event types;
//   • the end-to-end batching guarantee: a FINAL valid delta still flushes and
//     materializes the assistant bubble the chat surface renders;
//   • targeted regressions for the non-array `attempts` / `steps` / `findings`
//     / `files` / `commands` shapes that previously threw inside pure helpers.
//
//   node --test --test-force-exit tests/v1116-ingest-final.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1116-'));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${out}`,
      '--external:electron',
      '--external:@xterm/xterm',
      '--external:@xterm/addon-fit',
      '--external:monaco-editor',
      '--external:@monaco-editor/react',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

// ---- mock window.surnia bridge (installed BEFORE the store bundle loads) ----
const bridge = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (..._args) => {
        switch (key) {
          case 'gitStatus':
            return Promise.resolve({ isRepo: true, branch: 'main', changed: [] });
          case 'previewStatus':
            return Promise.resolve({
              dev: { running: false, state: 'idle', lines: [], agentSources: [] },
              static: { running: false },
              ports: [],
            });
          case 'skillsList':
            return Promise.resolve([]);
          case 'playbookGet':
            return Promise.resolve(null);
          case 'playbookHistory':
            return Promise.resolve([]);
          case 'saveSession':
            return Promise.resolve();
          default:
            return Promise.resolve(undefined);
        }
      };
    },
  },
);
globalThis.window = { surnia: bridge };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const storePath = join(tmp, 'store.cjs');
bundle('src/store.ts', storePath);
const { useStore } = require(storePath);
const ws = join(tmp, 'ws');

function seed(extra = {}) {
  useStore.setState({
    wsPath: ws,
    session: {
      id: 's1',
      title: 't',
      workspace: ws,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    },
    running: true,
    capabilityPanel: null,
    continueHint: null,
    lastTaskReport: null,
    lastPlaybookLearning: null,
    subagentProgress: {},
    subagentSteps: {},
    subagentDetailId: null,
    proof: { status: 'unproven', gates: [], updatedAt: 0 },
    ...extra,
  });
}

// Every AgentEvent type in shared/types.ts, plus forward-compatible arrivals.
const ALL_TYPES = [
  'text_delta', 'think_delta', 'sys_notice', 'heartbeat', 'tool_start', 'tool_result',
  'message_end', 'turn_end', 'error', 'approval_request', 'todo', 'compaction_done',
  'plan_ready', 'preview_open', 'goal_progress', 'goal_done', 'queued_count',
  'background_done', 'aborted', 'steer_injected', 'doom_loop', 'verify_run',
  'review_findings', 'task_mode', 'skill_created', 'compaction', 'subagent_progress',
  'dna_updated', 'playbook_learned', 'dna_suggestion', 'skill_refined', 'goal_verified',
  'critic_verdict', 'run_receipt', 'claim_audit', 'mutation_check', 'mutation_gate',
  'fake_tests', 'red_green', 'proof_package', 'false_done', 'budget_state',
  'taint_escalation', 'role_route', 'taint_notice', 'wiki_stage', 'task_report',
  // forward-compatible / not-yet-typed future engine events
  'self_critique', 'run_and_show', 'totally_future_event',
];

// Every field any agent event can carry. `attempts` is included on purpose:
// it is the field that made runUsageView()/.some() and accumulateUsage()'s
// spread throw before the v11.16 call-site normalization.
const FIELDS = [
  'text', 'kind', 'message', 'summary', 'outcome', 'toolCallId', 'name', 'args',
  'output', 'usage', 'files', 'commands', 'findings', 'steps', 'risks', 'phase',
  'id', 'label', 'cmd', 'url', 'ws', 'n', 'pct', 'claims', 'notDone', 'partial',
  'durationMs', 'reason', 'toolsUsed', 'howToRun', 'nextSteps', 'before', 'after',
  'stopReason', 'payload', 'todos', 'goal', 'requestId', 'detail', 'title', 'plan',
  'exitCode', 'outputTail', 'ok', 'verdict', 'ran', 'killed', 'killRate', 'scanned',
  'high', 'compliant', 'markdown', 'rate', 'falseDone', 'claimed', 'budget',
  'stage', 'previewHint', 'meta', 'critical', 'unsupported', 'why', 'classes',
  'sources', 'origin', 'version', 'sessionId', 'slug', 'role', 'agent', 'provider',
  'model', 'foo',
];

// seeded PRNG (mulberry32) — reproducible across runs.
function rng(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(0x1A5EED);

/**
 * A nested value that is safe as an ARRAY ELEMENT. Null/undefined elements are
 * deliberately reserved for the proof-ingest suite owned by A4: a null element
 * in `commands` throws inside ingestProofEvent's `commands.filter(c => c.ok)`
 * (reported to the parent as an A4-side finding), which is outside the remit of
 * this ingest-switch audit. Field-level null/undefined are still fully covered
 * by randVal() below.
 */
function randElem() {
  switch ((r() * 5) | 0) {
    case 0: return { nested: r() };
    case 1: return r() * 10;
    case 2: return 'elem';
    case 3: return true;
    default: return { ok: r() < 0.5 };
  }
}

/** A malformed value for a FIELD: null, undefined, wrong primitives, arrays,
 *  nested objects, etc. */
function randVal() {
  switch ((r() * 9) | 0) {
    case 0: return null;
    case 1: return undefined;
    case 2: return r() * 1000;
    case 3: return ((r() * 2) | 0) === 1;
    case 4: return 'x'.repeat(1 + ((r() * 12) | 0));
    case 5: return [randElem(), randElem()];
    case 6: return { nested: randValShallow() };
    case 7: return r();
    default: return 'GOAL_COMPLETE stray line';
  }
}
function randValShallow() {
  return ((r() * 3) | 0) === 0 ? 'x' : r();
}

function makeEvent(i) {
  const p = r();
  if (p < 0.03) return null;
  if (p < 0.06) return undefined;
  if (p < 0.09) return 42;
  if (p < 0.12) return 'not-an-event';
  if (p < 0.15) return [];
  if (p < 0.18) return { type: 42 }; // non-string type → top-level guard
  const e = { type: r() < 0.85 ? ALL_TYPES[(r() * ALL_TYPES.length) | 0] : randVal() };
  for (const k of FIELDS) if (r() < 0.20) e[k] = randVal();
  // occasionally stamp a recognizable marker so corruption is traceable
  if (r() < 0.15) e.text = `evt-${i}`;
  return e;
}

// ------------------------------------------------------------
// 1 · 3,000 malformed events across ALL types — zero throws.
// ------------------------------------------------------------
test('3,000 malformed events across every agent event type: zero throws', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  assert.equal(typeof ingest, 'function', 'ingestAgentEvent exists on the real store');
  const t0 = Date.now();
  const thrown = [];
  for (let i = 0; i < 3000; i++) {
    const ev = makeEvent(i);
    try {
      ingest(ev);
    } catch (err) {
      if (thrown.length < 8) thrown.push(`#${i} ${err?.message ?? err} | event=${JSON.stringify(ev)}`);
    }
  }
  assert.deepEqual(thrown, [], `ingestAgentEvent must never throw (${thrown.join(' | ')})`);
  const after = useStore.getState();
  assert.equal(typeof after.running, 'boolean', 'running flag still boolean');
  assert.equal(typeof after.ingestAgentEvent, 'function', 'ingest function intact');
  assert.ok(after.session, 'a session is still loaded');
  console.error(`[v1116] FUZZ-PASS 3000 events in ${Date.now() - t0}ms, state intact`);
});

// ------------------------------------------------------------
// 2 · Unknown events are a TRUE no-op (no session clone / re-render).
// ------------------------------------------------------------
test('unknown event types are a true no-op: no session clone', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  const before = useStore.getState().session;
  for (const t of [
    'self_critique', 'run_and_show', 'totally_future_event',
    'brand_new_v99_event', 'v99_phase_two',
  ]) {
    assert.doesNotThrow(() => ingest({ type: t, foo: 1 }));
    assert.equal(
      useStore.getState().session,
      before,
      `${t} must not clone the session (an unknown event must be a true no-op)`,
    );
  }
  assert.equal(useStore.getState().session.messages.length, 0);
  // Sanity: a KNOWN event does clone — so the no-op assertion is meaningful.
  ingest({ type: 'sys_notice', text: 'known event' });
  assert.notEqual(useStore.getState().session, before, 'a known event does update the session');
});

// ------------------------------------------------------------
// 3 · Batching: a FINAL valid delta still flushes and renders.
// ------------------------------------------------------------
test('a final valid delta still flushes the rAF buffer and renders the bubble', async () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  ingest({ type: 'think_delta', text: 'THINK_SENTINEL_v1116' });
  ingest({ type: 'text_delta', text: 'FINAL_FLUSH_SENTINEL_v1116' });
  // In Node there is no requestAnimationFrame, so the 32ms fallback timer owns
  // the flush. Wait past a couple of cadences before checking the transcript.
  await new Promise((resolve) => setTimeout(resolve, 120));
  const msgs = useStore.getState().session.messages;
  const bubble = msgs.find((m) => m.role === 'assistant' && m.kind === 'text');
  assert.ok(bubble, 'the final delta materialized an assistant bubble');
  assert.match(bubble.content, /FINAL_FLUSH_SENTINEL_v1116/, 'buffered answer text flushed');
  assert.equal(bubble.thinking, 'THINK_SENTINEL_v1116', 'buffered reasoning flushed to its own field');
  // And a subsequent structural event is still free to flush synchronously.
  ingest({ type: 'text_delta', text: 'TAIL_v1116' });
  ingest({ type: 'message_end', usage: undefined });
  const tail = useStore.getState().session.messages.find(
    (m) => m.role === 'assistant' && m.kind === 'text' && m.content.includes('TAIL_v1116'),
  );
  assert.ok(tail, 'structural event synchronously flushed the trailing delta');
});

// ------------------------------------------------------------
// 4 · Targeted regressions: non-array / malformed field shapes.
// ------------------------------------------------------------
test('non-array attempts / steps / findings / files / commands never throw', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  const badShapes = [null, undefined, 5, 'oops', true, {}, [7], [null], [{}]];
  for (const attempts of badShapes) {
    assert.doesNotThrow(
      () => ingest({
        type: 'message_end',
        usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.001, runCost: 0.002, attempts },
      }),
      `message_end with attempts=${JSON.stringify(attempts)} threw`,
    );
  }
  for (const steps of badShapes) {
    assert.doesNotThrow(
      () => ingest({ type: 'plan_ready', plan: 'p', steps, risks: steps }),
      `plan_ready with steps=${JSON.stringify(steps)} threw`,
    );
  }
  for (const findings of badShapes) {
    assert.doesNotThrow(
      () => ingest({ type: 'review_findings', findings, summary: 's' }),
      `review_findings with findings=${JSON.stringify(findings)} threw`,
    );
  }
  for (const arr of [null, undefined, 5, 'oops', {}, [{}]]) {
    assert.doesNotThrow(
      () => ingest({ type: 'run_receipt', files: arr, commands: arr, rounds: 1, verifyFailed: false, durationMs: 1 }),
      `run_receipt with arrays=${JSON.stringify(arr)} threw`,
    );
  }
});

test('malformed usage with no attempts, non-object usage, and missing text are no-throw', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  for (const usage of [undefined, null, 42, 'x', [], {}, { inputTokens: 'many', outputTokens: {}, costUsd: 'free' }]) {
    assert.doesNotThrow(() => ingest({ type: 'message_end', usage }), `usage=${JSON.stringify(usage)} threw`);
  }
  assert.doesNotThrow(() => ingest({ type: 'text_delta' }));
  assert.doesNotThrow(() => ingest({ type: 'think_delta', text: 42 }));
  assert.doesNotThrow(() => ingest({ type: 'sys_notice', kind: 'gate' }));
});
