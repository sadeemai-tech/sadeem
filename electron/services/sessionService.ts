// ============================================================
// Surnia — session persistence (userData/sessions/<id>.json)
// v2.3: this module also self-registers two IPC channels
// (kdx:session:export — standalone HTML share file, and
// kdx:session:transcribe — whisper voice input) following the
// dna.ts / mcp.ts v2 pattern: ipc.ts is not touched.
// ============================================================
import { promises as fsp } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { ChatMessage, SessionData, SessionMeta } from '../../shared/types';

const MAX_MESSAGES = 500;
const MAX_TOOL_CONTENT = 60 * 1024; // 60KB per tool_result content
const MAX_LIST = 300;

function sessionsDir(): string {
  // v11.31 — safeUserDir() is hoisted and guards a missing/throwing electron
  // `app` (headless CLI harness), matching the export paths below.
  return path.join(safeUserDir('userData'), 'sessions');
}

async function ensureDir(): Promise<string> {
  const dir = sessionsDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id: string): string {
  // v11.31 — keep the path jail strict: only word chars / dot / dash survive,
  // and a dot-only name ("..", ".") is rejected outright so no file can be
  // addressed outside <userData>/sessions.
  const s = String(id ?? '')
    .replace(/[^\w.-]/g, '_')
    .slice(0, 128);
  return /^[._-]+$/.test(s) ? '' : s;
}

// ---------- sanitize ----------
function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  const kept = Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [];
  return kept.map((m) => {
    if (m && m.kind === 'tool_result' && typeof m.content === 'string' && m.content.length > MAX_TOOL_CONTENT) {
      return { ...m, content: m.content.slice(0, MAX_TOOL_CONTENT) + '\n…[truncated]' };
    }
    return m;
  });
}

// ---------- API ----------
export async function save(data: SessionData): Promise<SessionMeta> {
  const dir = await ensureDir();
  const id = safeId(data?.id ?? '');
  if (!id) throw new Error('SESSION_ID_REQUIRED');

  const now = Date.now();
  const messages = sanitizeMessages(data?.messages ?? []);
  const record: SessionData = {
    ...(data as SessionData),
    id,
    title: data.title || 'Untitled',
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    messages,
    todos: Array.isArray(data?.todos) ? data.todos : [],
    // v11.31 — report the count of messages ACTUALLY stored (the 500-message
    // tail cap), not the input length. The old meta lied after truncation.
    messageCount: messages.length,
    totalTokens: Number(data?.totalTokens) || 0,
    totalCostUsd: Number(data?.totalCostUsd) || 0,
  };

  // v11.31 — atomic 0600 write: a crash mid-save must never leave a torn
  // session file that load() silently treats as a missing session.
  const finalPath = path.join(dir, `${id}.json`);
  const tmpPath = path.join(dir, `${id}.json.${randomUUID().slice(0, 8)}.tmp`);
  try {
    await fsp.writeFile(tmpPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tmpPath, finalPath);
  } catch (err) {
    try {
      await fsp.rm(tmpPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw err; // surface the write failure — no silent data loss
  }

  const { messages: _messages, todos: _todos, ...meta } = record;
  void _messages;
  void _todos;
  return meta as SessionMeta;
}

export async function load(id: string): Promise<SessionData | null> {
  const sid = safeId(id);
  if (!sid) return null;
  try {
    const raw = await fsp.readFile(path.join(sessionsDir(), `${sid}.json`), 'utf8');
    const parsed = JSON.parse(raw) as SessionData;
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null;
    const messages = sanitizeMessages(parsed.messages ?? []);
    // v11.31 — normalize on read: a hand-edited/corrupt file cannot feed raw
    // junk into fork/export, and the id always matches the safe filename.
    return {
      ...parsed,
      id: sid,
      title: parsed.title || 'Untitled',
      createdAt: Number(parsed.createdAt) || 0,
      updatedAt: Number(parsed.updatedAt) || Number(parsed.createdAt) || 0,
      messages,
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      messageCount: messages.length,
      totalTokens: Number(parsed.totalTokens) || 0,
      totalCostUsd: Number(parsed.totalCostUsd) || 0,
    };
  } catch {
    return null;
  }
}

export async function remove(id: string): Promise<boolean> {
  const sid = safeId(id);
  if (!sid) return false;
  try {
    await fsp.unlink(path.join(sessionsDir(), `${sid}.json`));
    return true;
  } catch (err) {
    // v11.31 — honest status: a missing session is false, a real IO error
    // surfaces instead of being swallowed as a fake success.
    if ((err as { code?: string })?.code === 'ENOENT') return false;
    throw err;
  }
}

export async function list(): Promise<SessionMeta[]> {
  const dir = sessionsDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const metas: SessionMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    // v11.31 — ignore files whose stem is not a safe id (no traversal /
    // hidden-file smuggling into the session list).
    const sid = name.slice(0, -'.json'.length);
    if (!safeId(sid) || safeId(sid) !== sid) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, name), 'utf8');
      const d = JSON.parse(raw) as Partial<SessionData>;
      const messageCount = d.messageCount ?? (Array.isArray(d.messages) ? d.messages.length : 0);
      const totalTokens = d.totalTokens ?? 0;
      metas.push({
        id: d.id ?? name.replace(/\.json$/, ''),
        title: d.title ?? 'Untitled',
        createdAt: d.createdAt ?? 0,
        updatedAt: d.updatedAt ?? d.createdAt ?? 0,
        workspace: d.workspace,
        model: d.model,
        messageCount,
        totalTokens,
        totalCostUsd: d.totalCostUsd ?? 0,
      });
    } catch {
      /* corrupt file — skip */
    }
  }

  return metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, MAX_LIST);
}

// ---------- v2: fork ----------

/** Duplicate a session under a new id ("Fork of …") — transcript is deep-copied. */
export async function forkSession(
  id: string,
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  try {
    const src = await load(id);
    if (!src) return { ok: false, error: 'SESSION_NOT_FOUND' };
    const now = Date.now();
    const newId = randomUUID();
    const fork: SessionData = {
      ...src,
      id: newId,
      title: `Fork of ${src.title || 'Untitled'}`,
      createdAt: now,
      updatedAt: now,
      // never carry streaming state into the fork
      messages: (Array.isArray(src.messages) ? src.messages : []).map((m) => ({
        ...m,
        streaming: false,
      })),
    };
    await save(fork);
    return { ok: true, sessionId: newId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- v11.31: create / rename (explicit, honest API) ----------

/** Create a fresh session with a generated id (no caller-forged key). */
export async function createSession(partial: Partial<SessionData> = {}): Promise<SessionData> {
  const now = Date.now();
  const messages = sanitizeMessages(Array.isArray(partial.messages) ? partial.messages : []);
  const data: SessionData = {
    id: randomUUID(),
    title: String(partial.title ?? '').trim().slice(0, 200) || 'Untitled',
    createdAt: Number(partial.createdAt) || now,
    updatedAt: Number(partial.updatedAt) || now,
    ...(partial.workspace ? { workspace: partial.workspace } : {}),
    ...(partial.model ? { model: partial.model } : {}),
    ...(partial.worktree ? { worktree: partial.worktree } : {}),
    messages,
    todos: Array.isArray(partial.todos) ? partial.todos : [],
    messageCount: messages.length,
    totalTokens: Number(partial.totalTokens) || 0,
    totalCostUsd: Number(partial.totalCostUsd) || 0,
  };
  await save(data);
  return data;
}

/** Rename a session in place; never reports success without a real write. */
export async function renameSession(
  id: string,
  title: string,
): Promise<{ ok: boolean; session?: SessionMeta; error?: string }> {
  const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!name) return { ok: false, error: 'TITLE_REQUIRED' };
  const data = await load(id);
  if (!data) return { ok: false, error: 'SESSION_NOT_FOUND' };
  data.title = name;
  data.updatedAt = Date.now();
  try {
    const session = await save(data);
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- v2: markdown export ----------

function slugify(title: string): string {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'session';
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
}

function renderMessage(m: ChatMessage): string {
  if (m.kind === 'tool_call') {
    return `### tool call — ${m.toolName ?? 'unknown'}\n\n\`\`\`\n${clip(m.content ?? '', 2000)}\n\`\`\``;
  }
  if (m.kind === 'tool_result') {
    const status = m.resultOk === false ? 'error' : 'ok';
    return `### tool result${m.toolName ? ` — ${m.toolName}` : ''} (${status})\n\n\`\`\`\n${clip(m.content ?? '', 2000)}\n\`\`\``;
  }
  const role = m.role === 'user' ? 'user' : 'assistant';
  return `### ${role}\n\n${clip(m.content ?? '', 20_000)}`;
}

/** Full transcript as markdown, saved under <userData>/exports/. */
export async function exportSessionMarkdown(
  id: string,
): Promise<{ ok: boolean; path?: string; markdown?: string; error?: string }> {
  try {
    const data = await load(id);
    if (!data) return { ok: false, error: 'SESSION_NOT_FOUND' };

    const created = data.createdAt ? new Date(data.createdAt).toISOString() : 'unknown';
    const header = [
      `# ${data.title || 'Untitled'}`,
      '',
      `- Session: \`${data.id}\``,
      `- Created: ${created}`,
      data.workspace ? `- Workspace: \`${data.workspace}\`` : null,
      data.model ? `- Model: ${data.model}` : null,
      `- Messages: ${Array.isArray(data.messages) ? data.messages.length : 0}`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n');

    const body = (Array.isArray(data.messages) ? data.messages : [])
      .map(renderMessage)
      .join('\n\n---\n\n');

    const markdown = `${header}\n\n---\n\n${body || '_(empty transcript)_'}\n`;

    const dir = path.join(app.getPath('userData'), 'exports');
    await fsp.mkdir(dir, { recursive: true });
    // v11.31 — a short random suffix prevents two exports in the same second
    // (same title) from silently overwriting each other.
    const file = path.join(dir, `${slugify(data.title)}-${stamp()}-${randomUUID().slice(0, 6)}.md`);
    await fsp.writeFile(file, markdown, 'utf8');
    return { ok: true, path: file, markdown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- v2.3: standalone HTML export (share, OpenCode-style but local) ----------

export interface SessionExportHtmlResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared paths that keep working when `app` is the headless CLI stub. */
function safeUserDir(kind: 'userData' | 'downloads'): string {
  try {
    return app.getPath(kind);
  } catch {
    return process.cwd();
  }
}

function fmtWhen(ts: number | undefined): string {
  try {
    return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
  } catch {
    return '—';
  }
}

/** One transcript row — user/assistant bubbles + mono tool cards, like the app. */
function htmlRow(m: ChatMessage): string {
  const content = escapeHtml(m.content ?? '');
  if (m.kind === 'tool_call') {
    const name = escapeHtml(m.toolName ?? 'tool');
    return (
      `<div class="row tool"><div class="tag">TOOL · ${name}</div>` +
      `<pre dir="ltr">${content}</pre></div>`
    );
  }
  if (m.kind === 'tool_result') {
    const name = m.toolName ? escapeHtml(m.toolName) : 'result';
    const state = m.resultOk === false ? 'err' : 'ok';
    const label = state === 'err' ? 'ERROR' : 'OK';
    return (
      `<div class="row tool ${state}"><div class="tag">RESULT · ${name} · ${label}</div>` +
      `<pre dir="ltr">${content}</pre></div>`
    );
  }
  const who = m.role === 'user' ? 'YOU' : 'SURNIA';
  const cls = m.role === 'user' ? 'user' : 'assistant';
  const model = m.model && m.model !== 'error' ? ` <span class="mini">${escapeHtml(m.model)}</span>` : '';
  const imgs = (Array.isArray(m.images) ? m.images : [])
    .filter((src) => typeof src === 'string' && src.startsWith('data:'))
    .map((src) => `<img class="shot" src="${escapeHtml(src)}" alt="attachment" />`)
    .join('');
  return (
    `<div class="row ${cls}"><div class="tag">${who}${model}</div>` +
    `<div class="body" dir="auto">${content.replace(/\n/g, '<br/>')}${imgs}</div></div>`
  );
}

/** Self-contained HTML transcript — inline CSS, no external assets. */
function renderSessionHtml(data: SessionData): string {
  const title = data.title || 'Untitled';
  const rows = (Array.isArray(data.messages) ? data.messages : []).map(htmlRow).join('\n');
  const meta = [
    ['Session', data.id],
    ['Created', fmtWhen(data.createdAt)],
    ['Updated', fmtWhen(data.updatedAt)],
    ['Workspace', data.workspace],
    ['Model', data.model],
    ['Messages', String(Array.isArray(data.messages) ? data.messages.length : 0)],
  ]
    .filter(([, v]) => !!v)
    .map(([k, v]) => `<div class="meta-item"><span class="k">${k}</span><span class="v" dir="auto">${escapeHtml(String(v))}</span></div>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — SADEEM session</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px 64px; background: #f4f2ea; color: #26251f;
         font: 14px/1.6 "Inter", "IBM Plex Sans Arabic", system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 14px; margin: 14px 0 26px;
          background: #ece8db; border: 1px solid #ddd7c3; border-radius: 8px; font-size: 12px; }
  .meta-item .k { color: #8a887c; text-transform: uppercase; letter-spacing: .08em; font-size: 10px;
                  display: block; }
  .meta-item .v { font-family: ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .row { margin: 0 0 14px; padding: 10px 14px; border-radius: 8px; background: #fff;
         border: 1px solid #e2ddcd; border-inline-start-width: 3px; }
  .row.user { border-inline-start-color: #d0a215; }
  .row.assistant { border-inline-start-color: #58a99b; }
  .row.tool { background: #1a2126; border-color: #1a2126; color: #d3c6aa; }
  .tag { font-size: 10px; font-weight: 700; letter-spacing: .12em; color: #8a887c; margin-bottom: 4px; }
  .row.tool .tag { color: #9aa8ad; }
  .row.tool.err .tag { color: #d14d41; }
  .row.tool.ok .tag { color: #a7c080; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; }
  .row pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left;
             font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; }
  .mini { font-weight: 400; letter-spacing: 0; text-transform: none; color: #b4b1a2; }
  .shot { max-width: 100%; max-height: 320px; display: block; margin-top: 8px; border-radius: 6px; }
  .empty { color: #8a887c; font-style: italic; }
  footer { margin-top: 36px; text-align: center; color: #b4b1a2; font-size: 11px; }
</style>
</head>
<body>
<main>
  <h1 dir="auto">${escapeHtml(title)}</h1>
  <div class="meta">${meta}</div>
  ${rows || '<p class="empty">(empty transcript)</p>'}
  <footer>Exported from Surnia · ${escapeHtml(fmtWhen(Date.now()))}</footer>
</main>
</body>
</html>
`;
}

/**
 * Render the session as a standalone HTML file. When `filePath` is omitted a
 * native save dialog asks where to put it (defaults to Downloads). The dialog
 * only exists in the app; the headless CLI harness falls back to
 * <userData>/exports/.
 */
export async function exportSessionHtml(
  id: string,
  filePath?: string,
): Promise<SessionExportHtmlResult> {
  try {
    const data = await load(id);
    if (!data) return { ok: false, error: 'SESSION_NOT_FOUND' };

    const html = renderSessionHtml(data);

    // explicit path (e.g. schedule/API callers) — write directly
    const explicit = typeof filePath === 'string' ? filePath.trim() : '';
    if (explicit) {
      await fsp.writeFile(explicit.endsWith('.html') ? explicit : `${explicit}.html`, html, 'utf8');
      return { ok: true, path: explicit.endsWith('.html') ? explicit : `${explicit}.html` };
    }

    let target: string | null = null;
    const dlg = dialog as unknown as {
      showSaveDialog?: (...args: unknown[]) => Promise<{ canceled?: boolean; filePath?: string }>;
    };
    if (dlg && typeof dlg.showSaveDialog === 'function') {
      const opts = {
        title: 'Export session as HTML',
        defaultPath: path.join(safeUserDir('downloads'), `surnia-session-${stamp()}.html`),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      };
      const parent = BrowserWindow.getFocusedWindow();
      const r = parent ? await dlg.showSaveDialog(parent, opts) : await dlg.showSaveDialog(opts);
      if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true };
      target = r.filePath;
    } else {
      // headless harness — no dialog, land next to the markdown exports
      const dir = path.join(safeUserDir('userData'), 'exports');
      await fsp.mkdir(dir, { recursive: true });
      target = path.join(dir, `surnia-session-${stamp()}.html`);
    }

    await fsp.writeFile(target, html, 'utf8');
    // v10.2 — Library: session exports land in the cross-session gallery
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./libraryService').noteLibraryItem({
        kind: 'export',
        title: path.basename(target),
        path: target,
        origin: 'session_export',
      });
    } catch {
      /* library is best-effort */
    }
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- v2.3 + v10.2: voice input transcription (multi-provider ASR) ----------
// v10.2 FIX — voice input was de-facto broken two ways:
//   1) main.ts denied the 'media' permission → getUserMedia never started;
//   2) this path only attempted the ACTIVE provider with model whisper-1, so
//      Z.AI / GLM / Groq / Anthropic installs always failed with
//      NO_TRANSCRIPTION_ENDPOINT or an HTTP 404 model error.
// Now: per-family endpoint + ASR-model presets, an explicit Voice settings
// override (settings.voice.asrProvider/asrModel), and a Z.AI model-name
// fallback (glm-asr-2512 → glm-asr) for older keys.

const TRANSCRIBE_TIMEOUT_MS = 45_000;

/** Providers with a real /audio/transcriptions route (OpenAI wire format). */
const AUDIO_BASE_PRESETS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  openrouter: 'https://openrouter.ai/api/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  mistral: 'https://api.mistral.ai/v1',
};

/** Default ASR model per family (settings.voice.asrModel overrides). */
const ASR_MODEL_PRESETS: Record<string, string> = {
  openai: 'whisper-1',
  groq: 'whisper-large-v3',
  zai: 'glm-asr-2512',
  zhipu: 'glm-asr-2512',
  openrouter: 'openai/whisper-large-v3',
};

/** Families whose native endpoints have NO transcription route at all. */
const NO_TRANSCRIPTION_PROVIDERS = new Set(['anthropic', 'ollama']);

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

interface VoiceSettingsShape {
  asrProvider?: string; // 'auto' | 'off' | <providerId>
  asrModel?: string;
  /** BCP-47 dictation hint ('en-US'); 'auto'/empty = omit on the wire. */
  language?: string;
}

interface ResolvedAsr {
  provider: string;
  base: string;
  key: string;
  model: string;
  error?: string;
}

/**
 * Transcribe recorded audio (base64) through the ACTIVE provider's
 * OpenAI-compatible /audio/transcriptions endpoint. Credentials never leave
 * the main process — read from storeService (which decrypts safeStorage keys).
 */
/** Read voice prefs + provider creds from storeService (main-side, decrypted). */
function readAsrConfig(): { active: string; voice: VoiceSettingsShape; providers: Record<string, { apiKey?: string; baseUrl?: string }> } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svc = require('./storeService') as { getSettings?: () => unknown };
    const s = (svc.getSettings?.() ?? {}) as {
      model?: { provider?: string };
      voice?: VoiceSettingsShape;
      providers?: Record<string, { apiKey?: string; baseUrl?: string }>;
    };
    return {
      active: String(s.model?.provider ?? ''),
      voice: s.voice ?? {},
      providers: s.providers ?? {},
    };
  } catch {
    return { active: '', voice: {}, providers: {} };
  }
}

/** Pick provider → (base, key, model) from explicit settings or the active provider. */
function resolveAsr(): ResolvedAsr {
  const cfg = readAsrConfig();
  const wanted = String(cfg.voice.asrProvider ?? 'auto').trim();
  if (wanted === 'off') {
    return { provider: '', base: '', key: '', model: '', error: 'VOICE_DISABLED' };
  }
  const provider = wanted && wanted !== 'auto' ? wanted : cfg.active;
  if (!provider) return { provider: '', base: '', key: '', model: '', error: 'NO_PROVIDER' };

  const entry = cfg.providers[provider] ?? {};
  const key = String(entry.apiKey ?? '').trim();
  const base = (String(entry.baseUrl ?? '').trim() || AUDIO_BASE_PRESETS[provider] || '').replace(/\/+$/, '');
  if (!base) return { provider, base: '', key, model: '', error: 'NO_TRANSCRIPTION_ENDPOINT' };
  if (!key) return { provider, base, key: '', model: '', error: 'NO_API_KEY' };
  const model = String(cfg.voice.asrModel ?? '').trim() || ASR_MODEL_PRESETS[provider] || 'whisper-1';
  return { provider, base, key, model };
}

/**
 * v11.4 — BCP-47 voice hint ('en-US' / 'ar' / 'auto') → the wire value the
 * OpenAI transcription route expects: ISO-639-1 ('en-US' rides as 'en').
 * Returns '' (omit the field entirely) for 'auto', empty or unparseable input.
 */
function wireLanguage(v?: string): string {
  const s = String(v ?? '').trim();
  if (!s || s.toLowerCase() === 'auto') return '';
  const base = s.split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2,8}$/.test(base) ? base : '';
}

/** POST one transcription attempt. Returns the parsed text or an error code. */
async function postTranscription(
  base: string,
  key: string,
  model: string,
  b64: string,
  mime: string,
  language?: string,
): Promise<{ ok: boolean; text?: string; error?: string; status?: number }> {
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    return { ok: false, error: 'NO_FETCH_RUNTIME' };
  }
  const audioType = (mime || 'audio/webm').split(';')[0].trim();
  const rawExt = (audioType.split('/')[1] || 'webm').trim() || 'webm';
  // The filename extension steers server-side parsers — 'x-wav'/'wave' → 'wav'.
  const ext = rawExt.replace(/^x-/, '').replace(/^wave$/, 'wav') || 'webm';
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(b64, 'base64')], { type: audioType }), `audio.${ext}`);
  form.append('model', model);
  const lang = wireLanguage(language);
  if (lang) form.append('language', lang);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRANSCRIBE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes('abort') ? 'TIMEOUT' : msg };
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = bodyText.slice(0, 200);
    try {
      const j = JSON.parse(bodyText) as { error?: { message?: string } | string; msg?: string };
      const m = typeof j?.error === 'string' ? j.error : j?.error?.message ?? j?.msg;
      if (m) detail = String(m);
    } catch {
      /* keep raw body slice */
    }
    return { ok: false, error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`, status: res.status };
  }
  let json: { text?: string } = {};
  try {
    json = JSON.parse(bodyText || '{}') as { text?: string };
  } catch {
    /* non-JSON success body — treated as empty below */
  }
  const text = typeof json?.text === 'string' ? json.text.trim() : '';
  if (!text) return { ok: false, error: 'EMPTY_TRANSCRIPT', status: res.status };
  return { ok: true, text };
}

/**
 * Transcribe recorded audio (base64) through the configured ASR provider.
 * v10.2 — multi-family: OpenAI whisper-1, Groq whisper-large-v3, Z.AI GLM-ASR,
 * custom OpenAI-compatible baseUrls. Credentials never leave the main process.
 * v11.4 — BCP-47 language hint from settings.voice.language (omitted on 'auto'),
 * zai/zhipu format guard (GLM-ASR: WAV/MP3 only), no identical-byte retries.
 */
export async function transcribeAudio(
  base64Data: string,
  mime: string,
): Promise<TranscribeResult> {
  try {
    const b64 = String(base64Data ?? '').replace(/^data:[^,]*,/, '');
    if (!b64) return { ok: false, error: 'EMPTY_AUDIO' };

    const cfg = readAsrConfig();
    if (cfg.voice.asrProvider === 'off') return { ok: false, error: 'VOICE_DISABLED' };

    const active = cfg.active;
    if (NO_TRANSCRIPTION_PROVIDERS.has(active) && (cfg.voice.asrProvider ?? 'auto') === 'auto') {
      // active family cannot transcribe and the user did not pin another —
      // say exactly that instead of a generic failure.
      return { ok: false, error: 'NO_TRANSCRIPTION_ENDPOINT' };
    }

    const asr = resolveAsr();
    if (asr.error) return { ok: false, error: asr.error };

    // v11.4 — GLM-ASR (zai/zhipu) only accepts WAV/MP3; the composer now
    // records 16 kHz mono PCM WAV, so a webm/ogg blob reaching this point
    // would 400 server-side. Say so honestly instead of uploading doomed bytes.
    if (asr.provider === 'zai' || asr.provider === 'zhipu') {
      if (!/^audio\/(x-)?(wav|wave|mpeg|mp3)$/i.test(String(mime || ''))) {
        return { ok: false, error: 'VOICE_FORMAT' };
      }
    }

    // v11.4 — the old "legacy glm-asr model" retry resent the IDENTICAL bytes
    // (guaranteed the same 4xx) — removed. Failures surface as honest errors.
    const r = await postTranscription(asr.base, asr.key, asr.model, b64, mime, cfg.voice.language);
    return r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error ?? 'UNKNOWN' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- v2.3 IPC self-registration (dna.ts / mcp.ts v2 pattern) ----------

let sessionExtrasIpcRegistered = false;

function registerSessionExtrasIpc(): void {
  if (sessionExtrasIpcRegistered) return;
  // The CLI engine runs under plain Node with an electron stub — ipcMain is
  // undefined there. Guard so the module keeps working headless.
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  sessionExtrasIpcRegistered = true;

  ipcMain.handle('kdx:session:export', async (_e: unknown, sessionId?: unknown, filePath?: unknown) => {
    // A8 security fix — the renderer-facing channel no longer accepts an
    // explicit write path: a compromised renderer could otherwise write files
    // to ANY location (no dialog, no containment). The renderer UI never
    // passes a path (ChatPanel calls sessionExportHtml(sid)); schedule/API
    // callers that need a fixed target may still use the service function
    // directly from the main process. Renderer path args are ignored.
    void filePath;
    return exportSessionHtml(String(sessionId ?? ''));
  });

  // v11.31 — explicit rename channel; renderer path args are never accepted
  // for exports (see above), and a rename is a real persisted write.
  ipcMain.handle('kdx:session:rename', async (_e: unknown, sessionId?: unknown, title?: unknown) =>
    renameSession(String(sessionId ?? ''), String(title ?? '')),
  );

  ipcMain.handle('kdx:session:transcribe', async (_e: unknown, base64?: unknown, mime?: unknown) =>
    transcribeAudio(String(base64 ?? ''), typeof mime === 'string' && mime ? mime : 'audio/webm'),
  );
}

// Module init: sessionService is imported by ipc.ts at startup, so this runs
// once before app ready. Under the headless CLI the guard makes it a no-op.
registerSessionExtrasIpc();
