// ============================================================
// Kodex E2E — GLM bridge: a tiny local OpenAI-compatible server
// that forwards requests through the sandbox SDK. This lets the
// REAL Kodex provider layer run unmodified against a REAL LLM.
// ============================================================
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const SDK_URL = 'file://' + path.join(os.homedir(), '.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js');
const { default: ZAI } = await import(SDK_URL);
const zai = await ZAI.create();

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400).end('bad json');
    return;
  }

  // Count image parts (vision proof) and strip them before forwarding:
  // glm-4.6 is text-only, but the Kodex wire format must still be correct.
  let imageCount = 0;
  const messages = (body.messages ?? []).map((m) => {
    let content = m.content;
    if (Array.isArray(content)) {
      imageCount += content.filter((p) => p?.type === 'image_url').length;
      content = content
        .filter((p) => p?.type === 'text')
        .map((p) => p.text)
        .join('\n');
    }
    const out = { role: m.role, content };
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    return out;
  });
  if (imageCount) console.log(`[glm-bridge] vision: request carried ${imageCount} image part(s) ✓`);
  const reqTools = (body.tools ?? []).map((t) => ({
    type: 'function',
    function: t.function ?? { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const started = Date.now();
  try {
    let completion = null;
    const delays = [5000, 15000, 30000, 60000, 120000, 180000];
    for (let attempt = 0; ; attempt++) {
      try {
        completion = await zai.chat.completions.create({
          messages,
          ...(reqTools.length ? { tools: reqTools, tool_choice: 'auto' } : {}),
          ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
        });
        break;
      } catch (e) {
        const retriable = /429|rate/i.test(String(e?.message || e));
        if (!retriable || attempt >= delays.length) throw e;
        console.log(`[glm-bridge] 429 — retry ${attempt + 1} in ${delays[attempt]}ms`);
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    const msg = completion.choices?.[0]?.message ?? {};
    const usage = completion.usage ?? {};
    const id = 'bridge-' + Date.now();
    const sse = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    // content deltas (split into readable chunks)
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content) {
      for (let i = 0; i < content.length; i += 24) {
        sse({
          id, object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta: { content: content.slice(i, i + 24) }, finish_reason: null }],
        });
      }
    }
    // tool calls (single complete block)
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      sse({
        id, object: 'chat.completion.chunk', model: body.model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: msg.tool_calls.map((tc, i) => ({
              index: i, id: tc.id, type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          },
          finish_reason: null,
        }],
      });
    }
    const finish = msg.tool_calls?.length ? 'tool_calls' : 'stop';
    sse({
      id, object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      usage: {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
      },
    });
    res.write('data: [DONE]\n\n');
    res.end();
    console.log(`[glm-bridge] ${body.model} · ${messages.length} msgs · tools=${reqTools.length} · finish=${finish} · ${Date.now() - started}ms`);
  } catch (err) {
    console.error('[glm-bridge] ERROR', err?.message || err);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String(err?.message || err) } }));
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60_000;
export function startBridge(port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
}
