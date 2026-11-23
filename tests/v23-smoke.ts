// ============================================================
// Surnia v2.3.0 — core smoke tests (no LLM). Bundled like cli.ts:
//   npx esbuild tests/v23-smoke.ts --bundle --platform=node --format=cjs \
//     --outfile=/tmp/v23-smoke.cjs --external:electron && node /tmp/v23-smoke.cjs
// ============================================================
import * as path from 'node:path';
import * as os from 'node:os';
import Module from 'node:module';

// ---------- electron stub (same trick as cli.ts, BEFORE engine imports) ----------
const KODEX_HOME = process.env.SURNIA_HOME || path.join(os.tmpdir(), 'surnia-smoke-home');
const electronStub = {
  app: { getPath: () => KODEX_HOME, whenReady: async () => true, getName: () => 'Surnia' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
};
const origLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') return electronStub;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (origLoad as any).call(this, request, ...rest);
};

const fsp = require('node:fs') as typeof import('node:fs');

const results: { name: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note = ''): void => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? ' — ' + note : ''}`);
};

async function main(): Promise<void> {
  const { buildSystemPrompt } = await import('../electron/agent/prompts');
  const { parseTextToolCalls } = await import('../electron/agent/engine');
  const { getToolDefs, executeTool } = await import('../electron/agent/tools');
  const { renderDNAPrompt } = await import('../electron/agent/dna');

  // ---------- 1. refusal regex (mirror of engine REFUSAL_RE) ----------
  const REFUSAL_RE =
    /\b(i can'?t|i cannot|i can not|i'?m unable|unable to|i don'?t have (?:access|the (?:tools|capability|ability))|not able to|(?:do|can)?n['o]t have the (?:necessary|required) tools|cannot assist|i lack (?:the|access))\b|(لا أستطيع|لا اقدر|لا أقدر|لا أملك|لا يمكنني|غير قادر|لا أعرف كيف|لا أملك الأدوات)/i;
  const CASES: [string, boolean][] = [
    ["I can't do that", true],
    ['I cannot build that', true],
    ["I'm unable to help with that", true],
    ["I don't have the tools needed to build this", true],
    ['Sorry, I lack the access required', true],
    ['لا أستطيع عمل ذلك', true],
    ['لا أملك الأدوات اللازمة للبناء', true],
    ['غير قادر على التنفيذ', true],
    ['I will start by reading the files', false],
    ['تمام، سأبني لك التطبيق الآن', false],
    ['Here is the plan. First, I create the file…', false],
    ["Yes I can help — I don't have a preference though", false],
    ['أستطيع المساعدة', false],
    ['نستطيع المتابعة', false],
  ];
  let reFail = 0;
  for (const [text, expected] of CASES) if (REFUSAL_RE.test(text) !== expected) reFail++;
  check('refusal regex EN+AR', reFail === 0, `${CASES.length - reFail}/${CASES.length}`);

  // ---------- 2. text tool protocol ----------
  {
    const known = new Set(['list_dir', 'read_file', 'run_command', 'fs_browse', 'workspace_map']);
    const text = [
      'Let me look around.',
      '```surnia-tool',
      '{"tool": "fs_browse", "args": {"path": "~/Desktop"}}',
      '```',
      '```surnia-tool',
      '{"tool": "not_a_real_tool", "args": {}}',
      '```',
      '```surnia-tool',
      '{broken json',
      '```',
      '```surnia-tool',
      '{"name": "list_dir", "arguments": {"path": "/home"}}',
      '```',
    ].join('\n');
    const calls = parseTextToolCalls(text, known);
    check(
      'parseTextToolCalls valid-only',
      calls.length === 2 && calls[0].name === 'fs_browse' && calls[1].name === 'list_dir',
      calls.map((c) => c.name).join(','),
    );
    const stripped = text.replace(/```surnia-tool[ \t]*\r?\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
    check('strip keeps prose', stripped.startsWith('Let me look around.') && !stripped.includes('surnia-tool'));
  }

  // ---------- 3. system prompt ----------
  {
    const sys = buildSystemPrompt({
      workspace: '/tmp/ws',
      mode: 'autoEdit',
      platform: 'linux',
      language: 'ar',
      textToolProtocol: true,
      dna: 'PROFILE:\n- prefers: tabs',
    });
    check('capability contract present', sys.includes('# Capability contract') && sys.includes('NEVER say'));
    check('general assistant line', sys.includes('GENERAL desktop assistant'));
    check('DNA advisory ban', sys.includes('NEVER refuse, delay or narrow a task because of a DNA entry'));
    check('text protocol block', sys.includes('```surnia-tool'));
    check('new tools documented', sys.includes('workspace_map') && sys.includes('fs_browse') && sys.includes('ANYWHERE on disk'));
    const sysNoProto = buildSystemPrompt({ workspace: '/tmp/ws', mode: 'default', platform: 'linux' });
    check('no protocol for native providers', !sysNoProto.includes('```surnia-tool'));
  }

  // ---------- 4. tool defs ----------
  {
    const names = new Set(getToolDefs([]).map((d: { name: string }) => d.name));
    check('fs_browse defined', names.has('fs_browse'));
    check('workspace_map defined', names.has('workspace_map'));
  }

  // ---------- 5. DNA advisory rendering ----------
  {
    const now = Date.now();
    const rendered = renderDNAPrompt({
      version: 1,
      profile: { expertise: [], languages: [], likes: ['tabs'], dislikes: ['semicolons'], styleNotes: [] },
      patterns: [{ id: 'p1', kind: 'workflow', text: 'runs npm test after edits', count: 3, firstSeen: now, lastSeen: now, confidence: 0.7 }],
      feedback: [{ ts: now, kind: 'correction', note: 'User declined running "rm -rf build" once', context: 'one-time denial' }],
      stats: { sessionsObserved: 4, factsRecorded: 2, updatedAt: now },
    } as never);
    check('DNA advisory header', rendered.includes('NEVER rules, NEVER bans'));
    check('dislikes framed as default-only', rendered.includes('always yield to the current request'));
    check('denial marked one-time', rendered.includes('[once — may be routine review]'));
    const empty = renderDNAPrompt({
      version: 1,
      profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
      patterns: [],
      feedback: [],
      stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
    } as never);
    check('empty DNA → empty string', empty === '');
  }

  // ---------- 6-9. filesystem behavior ----------
  const ctxBase = {
    workspace: '/tmp/surnia-smoke-nonexistent-ws',
    fullAccess: false,
    mcpServers: [] as never[],
    approve: async (): Promise<boolean> => false,
  };
  {
    const secretDir = path.join(os.homedir(), '.surnia-smoke-test');
    fsp.mkdirSync(secretDir, { recursive: true });
    fsp.writeFileSync(path.join(secretDir, '.env'), 'API_KEY=super-secret-value-123\nDEBUG=true\n');
    try {
      const res = await executeTool('read_file', JSON.stringify({ path: path.join(secretDir, '.env') }), ctxBase);
      const out = String(res.output || '');
      check(
        'secret .env masked',
        !out.includes('super-secret-value-123') && out.includes('MASKED'),
        out.split('\n')[0]?.slice(0, 90),
      );
      check('mask keeps structure', out.includes('API_KEY=') && out.includes('DEBUG=true'));
    } finally {
      fsp.rmSync(secretDir, { recursive: true, force: true });
    }
  }
  {
    const probe = path.join(os.homedir(), '.surnia-smoke-readable.txt');
    fsp.writeFileSync(probe, 'machine-wide-read-ok');
    try {
      const res = await executeTool('read_file', JSON.stringify({ path: probe }), {
        ...ctxBase,
        approve: async () => {
          throw new Error('approval must NOT be requested for normal outside reads');
        },
      });
      check('outside read: NO approval', res.ok && String(res.output).includes('machine-wide-read-ok'), String(res.output).slice(-30));
    } catch (e) {
      check('outside read: NO approval', false, String(e).slice(0, 90));
    } finally {
      fsp.rmSync(probe, { force: true });
    }
  }
  {
    const res = await executeTool('fs_browse', '{}', ctxBase);
    check('fs_browse overview', res.ok && String(res.output).includes('HOME:'), String(res.output).split('\n')[0]);
    const res2 = await executeTool('fs_browse', JSON.stringify({ path: os.homedir(), depth: 1 }), ctxBase);
    check('fs_browse tree', res2.ok && String(res2.output).includes(os.homedir()));
  }
  {
    const projectRoot = process.cwd();
    const res = await executeTool('workspace_map', JSON.stringify({ path: projectRoot }), {
      ...ctxBase,
      workspace: projectRoot,
    });
    const out = String(res.output || '');
    check(
      'workspace_map',
      res.ok && out.includes('PROJECT MAP') && out.includes('package.json'),
      out.split('\n').slice(0, 2).join(' | '),
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — FIX BEFORE SHIPPING' : ' — ALL GREEN'}`);
  process.exit(failed.length ? 1 : 0);
}

void main();
