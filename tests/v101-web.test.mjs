// v101-web.test.mjs — SADEEM v10.1 internet-tool tests.
// (1) web_search parses DuckDuckGo results (mocked fetch — deterministic).
// (2) web_fetch readability pass: TITLE kept, nav/script chrome stripped,
//     paragraph structure preserved (mocked fetch).
// (3) download_file writes a real file inside the workspace (mocked fetch).
// (4) LIVE: real network fetch of example.com through the shipped code path.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tools = await import('./.tools.bundle.mjs');

const DDG_HTML = `<!doctype html><html><head><title>q at DuckDuckGo</title></head><body>
<div class="result">
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Felectronjs.org%2Fdocs%2Ftutorial%2Fexamples&amp;rut=abc">Electron docs &amp; examples</a>
<a class="result__snippet" href="#">Build cross-platform desktop apps with <b>JavaScript</b>, HTML and CSS.</a>
</div>
<div class="result">
<a class="result__a" href="https://www.electronforge.io/">Electron Forge</a>
<a class="result__snippet" href="#">The toolkit to build and ship Electron apps.</a>
</div>
</body></html>`;

const PAGE_HTML = `<!doctype html><html><head><title>SADEEM release notes</title>
<style>.x{color:red}</style><script>console.log('evil')</script></head>
<body>
<nav><a href="#">Home</a><a href="#">Docs</a></nav>
<article><p>First paragraph about the release.</p>
<p>Second paragraph with details.</p></article>
<footer>copyright footer noise</footer>
</body></html>`;

function mkCtx(workspace) {
  const events = [];
  return {
    ctx: {
      workspace,
      sessionId: 'test-session',
      mcpServers: [],
      emit: (e) => events.push(e),
      approve: async () => true,
      fullAccess: false,
    },
    events,
  };
}

test('web_search parses DuckDuckGo results through the shipped dispatcher', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(DDG_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    const { ctx } = mkCtx(mkdtempSync(join(tmpdir(), 'sadeem-web-')));
    const out = await tools.executeTool('web_search', JSON.stringify({ query: 'electron docs' }), ctx);
    assert.ok(out.ok, `web_search failed: ${out.output}`);
    assert.match(out.output, /electronjs\.org\/docs/, 'should include the decoded result URL');
    assert.match(out.output, /Electron docs & examples|Electron docs/, 'should include the result title');
    assert.match(out.output, /SEARCH RESULTS/, 'should be fenced as untrusted content');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('search_web (legacy alias) works too', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(DDG_HTML, { status: 200 });
  try {
    const { ctx } = mkCtx(mkdtempSync(join(tmpdir(), 'sadeem-web-')));
    const out = await tools.executeTool('search_web', JSON.stringify({ query: 'forge' }), ctx);
    assert.ok(out.ok, `search_web failed: ${out.output}`);
    assert.match(out.output, /electronforge\.io/, 'should list the forge result');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('web_fetch keeps the title, strips nav/script/footer, preserves paragraphs', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(PAGE_HTML, { status: 200 });
  try {
    const { ctx } = mkCtx(mkdtempSync(join(tmpdir(), 'sadeem-web-')));
    const out = await tools.executeTool('web_fetch', JSON.stringify({ url: 'https://example.test/notes' }), ctx);
    assert.ok(out.ok, `web_fetch failed: ${out.output}`);
    assert.match(out.output, /TITLE: SADEEM release notes/, 'page title must be surfaced');
    assert.match(out.output, /First paragraph about the release\.\nSecond paragraph/, 'paragraph structure must survive');
    assert.doesNotMatch(out.output, /console\.log/, 'script content must be stripped');
    assert.doesNotMatch(out.output, /copyright footer noise/, 'footer chrome must be stripped');
    assert.doesNotMatch(out.output, /<a href="#">Home<\/a>/, 'nav chrome must be stripped');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('download_file writes a real file inside the workspace', async () => {
  const realFetch = globalThis.fetch;
  const body = Buffer.from('hello SADEEM download');
  globalThis.fetch = async () =>
    new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
  try {
    const ws = mkdtempSync(join(tmpdir(), 'sadeem-web-'));
    const { ctx } = mkCtx(ws);
    const out = await tools.executeTool(
      'download_file',
      JSON.stringify({ url: 'https://example.test/file.txt', dest: 'downloads/file.txt' }),
      ctx,
    );
    assert.ok(out.ok, `download_file failed: ${out.output}`);
    const p = join(ws, 'downloads', 'file.txt');
    assert.ok(existsSync(p), 'file must exist on disk');
    assert.equal(readFileSync(p, 'utf8'), 'hello SADEEM download', 'content must match byte-for-byte');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('LIVE: web_fetch reads a real page over the real network', { timeout: 45_000 }, async (t) => {
  // real internet required — skipped (marked) only when the sandbox has none
  let live = false;
  try {
    const probe = await fetch('https://example.com', { signal: AbortSignal.timeout(8000) });
    live = probe.ok;
  } catch {
    live = false;
  }
  if (!live) return t.skip('no internet access in this environment');
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-web-'));
  const { ctx } = mkCtx(ws);
  const out = await tools.executeTool('web_fetch', JSON.stringify({ url: 'https://example.com' }), ctx);
  // The probe succeeded but the real fetch can still be blocked by an egress
  // proxy / bot filter (HTTP 403). That is an environment limit, not a tool
  // bug — skip honestly instead of reporting a false failure.
  if (!out.ok && /HTTP 403|Forbidden|blocked/i.test(out.output)) {
    return t.skip(`site blocked the request (${out.output.slice(0, 120)})`);
  }
  assert.ok(out.ok, `live web_fetch failed: ${out.output}`);
  assert.match(out.output, /Example domain|example\.com/i, 'should read the real page');
});

test('LIVE: web_search reaches the real DuckDuckGo endpoint', { timeout: 45_000 }, async (t) => {
  let live = false;
  try {
    const probe = await fetch('https://html.duckduckgo.com/html/?q=ping', {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) SADEEM/10.1' },
    });
    live = probe.ok;
  } catch {
    live = false;
  }
  if (!live) return t.skip('no internet access in this environment');
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-web-'));
  const { ctx } = mkCtx(ws);
  const out = await tools.executeTool('web_search', JSON.stringify({ query: 'SADEEM electron desktop agent' }), ctx);
  // endpoint reachable but may rate-limit datacenter IPs — accept either real
  // results or an explicit upstream refusal, NEVER a silent fake.
  if (!out.ok) {
    // v11.34 (V5) — honest anti-bot / anomaly-page failure with a concrete
    // next step is the desired behaviour; accept it alongside the old forms.
    assert.match(
      out.output,
      /Search failed|HTTP \d+|Web search is currently unavailable|anti-bot|anomaly page|no results were (obtained|fabricated)/i,
      'failure must be explicit, not fabricated',
    );
    return t.skip(`duckduckgo refused the datacenter IP: ${out.output.slice(0, 120)}`);
  }
  assert.match(out.output, /SEARCH RESULTS/, 'should be fenced as untrusted content');
});

rmSync('/tmp/__nonexistent__', { force: true, recursive: true });
