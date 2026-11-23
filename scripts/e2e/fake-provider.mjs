// E2E harness (Task e2e-harness-A) — SCRIPTED FAKE LLM PROVIDER.
// ------------------------------------------------------------
// A deterministic, zero-network (loopback-only) OpenAI-compatible SSE server
// for driving the REAL SADEEM engine (electron/agent/engine.ts runAgent) in
// headless end-to-end scenarios. It serves POST /v1/chat/completions with
// `chat.completion.chunk` SSE frames, exactly the wire shape the engine's
// provider layer consumes (mirrors tests/v1111-antifreeze.test.mjs).
//
// Scripts map model-name -> array of STEPS. A step is one assistant turn:
//   { text: '...' }                        plain assistant text (stop)
//   { think: '...' }                       optional reasoning_content
//   { tool: { name, args, id } }           ONE tool call (finish tool_calls)
//   { usage: {...} }                       optional usage override
// When a model's script is exhausted the server answers 500 so any engine
// overrun is detected immediately instead of hanging. Deterministic: no
// randomness, no artificial delays, steps served strictly in queue order.
import http from 'node:http';

const SSE_ID = 'e2e-fake-provider';

/** One OpenAI streaming chunk in the exact shape the engine parses. */
function sseChunk(delta, finish = null) {
  return `data: ${JSON.stringify({
    id: SSE_ID,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

/** Tool args may be given as an object (preferred) or a raw JSON string. */
function normalizeArgs(args) {
  if (args === undefined || args === null) return '{}';
  return typeof args === 'string' ? args : JSON.stringify(args);
}

/**
 * Create the scripted provider.
 * @param {{ scripts?: Record<string, Array<object|Function>> }} opts
 *   scripts: model-name -> step queue. A step may also be a raw
 *   `async ({ res, body }) => void` handler escape hatch.
 */
export function createFakeProvider({ scripts = {} } = {}) {
  const routes = new Map(Object.entries(scripts)); // model -> step queue
  const requests = []; // every POST body.model, in arrival order
  const served = []; // steps actually streamed { model, kind, at }
  const exhausted = []; // requests that found an empty queue (answered 500)
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* keep {} */
      }
      const model = body.model ?? '(none)';
      requests.push({ model, at: Date.now(), path: req.url ?? '' });

      const queue = routes.get(model);
      const step = queue && queue.length ? queue.shift() : null;
      if (!step) {
        exhausted.push({ model, at: Date.now(), path: req.url ?? '' });
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: `E2E fake provider: script exhausted for model ${model}` },
          }),
        );
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      try {
        // Escape hatch: raw handler owns the whole response.
        if (typeof step === 'function') {
          await step({ res, body });
          return;
        }
        if (step.think) res.write(sseChunk({ reasoning_content: step.think }));
        if (step.text !== undefined && step.text !== null) {
          res.write(sseChunk({ content: step.text }));
        }
        if (step.tool) {
          const id = step.tool.id ?? 'call_e2e_' + (seq++);
          // Announce the call (name), then stream the full args JSON.
          res.write(
            sseChunk({
              tool_calls: [
                { index: 0, id, function: { name: step.tool.name, arguments: '' } },
              ],
            }),
          );
          res.write(
            sseChunk({
              tool_calls: [
                { index: 0, function: { arguments: normalizeArgs(step.tool.args) } },
              ],
            }),
          );
        }
        // Usage snapshot, terminal finish_reason chunk, then [DONE] —
        // byte-compatible with the recipe mock (v1111-antifreeze finishSse).
        res.write(
          `data: ${JSON.stringify({
            id: SSE_ID,
            object: 'chat.completion.chunk',
            usage: step.usage ?? { prompt_tokens: 10, completion_tokens: 10 },
            choices: [],
          })}\n\n`,
        );
        res.write(sseChunk({}, step.tool ? 'tool_calls' : 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
        served.push({ model, kind: step.tool ? 'tool' : 'text', at: Date.now() });
      } catch {
        try {
          res.destroy();
        } catch {
          /* socket already gone */
        }
      }
    });
  });

  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  const listening = new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );

  return {
    /** Model -> step queue (mutate to append more steps mid-run if needed). */
    scripts: routes,
    requests,
    served,
    exhausted,
    /** Resolves with the bound port. */
    port: () => listening,
    /** Resolves with the OpenAI-style base URL the engine should be given. */
    baseUrl: async () => `http://127.0.0.1:${await listening}/v1`,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
