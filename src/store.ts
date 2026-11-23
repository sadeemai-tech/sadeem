// SADEEM central store (zustand) — single source of truth for the renderer.
import { create } from 'zustand';
import type {
  AgentEvent,
  AppSettings,
  ProviderEntry,
  AccountInfo,
  ChatMessage,
  CheckpointInfo,
  DiffViewRequest,
  FileNode,
  GitStatus,
  LicenseState,
  ModelConfig,
  OpenTab,
  PermissionMode,
  PlanApprovalChoice,
  PreviewStatusResult,
  ReviewFinding,
  ScheduleJob,
  SearchHit,
  SessionData,
  SessionMeta,
  SkillInfo,
  TaskMode,
  ToolProfile,
  TodoItem,
  Usage,
  UsageAttempt,
  ProviderId,
  PlaybookData,
  PlaybookRevision,
  SubagentRecord,
  SubagentToolCall,
  CommandRunResult,
} from '../shared/types';
import { clampMaxSubagents } from '../shared/types';
import { api } from './lib/api';
// v11.10 (A5) — exact-token honesty math: the store's session accumulation,
// per-row attachment and live estimate all route through these pure helpers
// (tests/v1110-usage.test.mjs asserts them to the token).
import { accumulateUsage, emptySessionUsage, runUsageView, ctxFillTokens, isCompactionEligible } from './lib/ctx';
import { attachTurnUsage } from './lib/usage';
// v11.11 (A6) — canonical provider-slice derivation (pure): the ModelPicker
// and persistence checks read the SAME shape the Settings UI writes
// (ProviderEntry.lastModels).
import { providerHasCredentials, providerModelIds } from './lib/providerSlice';
export { providerHasCredentials, providerModelIds };
import type { DNAData, DnaStatsInfo } from './lib/api';
import { PERMISSION_MODES, nextIn, deriveToolScope, firstCommandLike } from './lib/modes';
// A1 — runtime import of makeT (pair-array dictionary lookup for the built-in
// slash commands). Safe cycle: store ↔ i18n both only CALL each other's
// functions at event time, never at module-evaluation time.
import { makeT } from './i18n';
import type { Lang } from './i18n';
import { pushToast } from './components/Toasts';

// v2.4: 'flows' joins the rail (07) — retires the RailViewEx shims elsewhere.
export type RailView = 'home' | 'workspace' | 'sessions' | 'git' | 'mcp' | 'usage' | 'dna' | 'flows' | 'skills' | 'artifacts' | 'library' | 'wiki' | 'prompts' | 'search' | 'subagents' | 'signature' | 'proof' | 'editor';

/** One accumulated step of a subagent's live timeline (renderer-only). */
export interface SubagentStep {
  at: number;
  done: number;
  total: number;
  /** v11.35 — the real per-step action label emitted by the engine. */
  step?: string;
  pct?: number;
}

/**
 * v11.36 (CHILD-SESSION) — append REAL tool calls from IPC events to a
 * subagent's transcript. Entries are keyed by `toolCallId` (a start/result pair
 * stays ONE row and gains its real output/status) or by `name:at`. The newest
 * 120 calls are kept; nothing is synthesised — `incoming` always comes from an
 * engine event, never from a UI placeholder.
 */
export function mergeSubagentToolCalls(
  prev: SubagentToolCall[] | undefined,
  incoming: SubagentToolCall[],
): SubagentToolCall[] {
  const next = Array.isArray(prev) ? [...prev] : [];
  for (const c of incoming) {
    if (!c || typeof c.name !== 'string' || !c.name) continue;
    const key = c.toolCallId ? `id:${c.toolCallId}` : `${c.name}:${c.at}`;
    const idx = next.findIndex((x) => (x.toolCallId ? `id:${x.toolCallId}` : `${x.name}:${x.at}`) === key);
    if (idx >= 0) next[idx] = { ...next[idx], ...c };
    else next.push(c);
  }
  return next.slice(-120);
}

/** Stable empty transcript — avoids zustand v5 snapshot churn. */
const EMPTY_TOOL_CALLS: SubagentToolCall[] = [];

/**
 * v11.20 (A1 — INSTANT LIVENESS) — engine-independent run activity. The store
 * records this the SYNCHRONOUS moment the user presses send (running:false →
 * true) so the live strip paints IMMEDIATELY, before the first engine event.
 * A1 `sys_notice` run_start / liveness / preparing events may refine the phase
 * and note, but NEVER reset `startedAt`: the elapsed clock belongs to the
 * exact press, not to the first engine event.
 */
export type RunActivityPhase =
  | 'preparing'
  | 'thinking'
  | 'working'
  | 'building'
  | 'running'
  | 'verifying'
  | 'compacting'
  | 'approval'
  | 'done'
  | 'error'
  | 'aborted';

export interface RunActivityState {
  phase: RunActivityPhase;
  /** epoch ms of the exact send press (mirrors AppState.runStartedAt). */
  startedAt: number;
  /** last epoch ms this activity was touched (liveness pulses bump this). */
  at: number;
  /** optional short label carried by an A1 sys_notice. */
  note?: string;
}

/** v2.4 slash prompt templates (/pr · /changelog · /tests) — expand to a rich
 *  prompt, then ride the normal send path like any plain message. */
const SLASH_PROMPT_TEMPLATES: Record<'pr' | 'changelog' | 'tests' | 'handoff' | 'grill', (arg: string) => string> = {
  pr: () =>
    'Draft a pull-request title + description from my current uncommitted changes (git diff). ' +
    'Format: Title, Summary, Changes bulleted, Screenshots/Testing notes sections.',
  changelog: () =>
    'Generate release notes from the last 20 git commits: group by Added/Changed/Fixed, ' +
    'concise bullets, semantic-tone headings, bilingual not needed — match the repo language.',
  tests: (arg) =>
    `Write focused unit tests for ${arg || 'the most test-worthy file changed recently'} ` +
    "using the project's existing test framework and style. Create/update the test file and run the tests.",
  // v6 — session handoff (original): solves "the session died / I'm leaving mid-task".
  // The agent writes a self-contained HANDOFF.md the next session (or a teammate)
  // can resume from — then keeps working if there is still work left.
  handoff: () =>
    'Write a session HANDOFF note for whoever continues this work (a future me, or the user).\n' +
    'Read the workspace state (git status/diff, MEMORY.md if present) and cover EXACTLY these sections:\n' +
    '1) Task in one line — what was being built/fixed and why.\n' +
    '2) DONE — changes already made, with file paths (and which of them are verified: build/tests run and passing).\n' +
    '3) NOT DONE / NEXT — the precise remaining steps, ordered, each with the file to touch and how to verify it.\n' +
    '4) HOW TO RUN — the exact commands to install, run and verify this project.\n' +
    '5) WATCH OUT — gotchas discovered this session (failing tests, missing env vars, flaky steps).\n' +
    'Save it as HANDOFF.md in the workspace root, then summarize it in 3 bullets in chat.',
  // v6 — grill-first planning (Antigravity /grill-me): interview BEFORE coding.
  grill: (arg) =>
    `We are about to work on: ${arg || 'the task I am about to describe'}. ` +
    'Before writing ANY code, interview me ONE question at a time using the ask_user tool — ' +
    'each question offers 2-4 concrete options, your recommended option FIRST and marked (Recommended), ' +
    'plus a free-text alternative. Ask ONLY questions the codebase cannot answer: first inspect the workspace ' +
    '(workspace_map / read_file), never ask what you can read. Each answer shapes the next question. ' +
    'After at most 5 questions, restate the final spec in 5 bullets and start implementing.',
};

// ── A1 — built-in slash command helpers (/status · /export · /diff · /rewind · /share) ──

/** Pair-array dictionary lookup for store-side command strings (src/i18n.ts). */
function slashT(ar: boolean): (key: string, fallback?: string, params?: Record<string, string | number>) => string {
  return makeT(ar ? 'ar' : 'en');
}

/** Append an assistant transcript row to the active session and persist it. */
function appendAssistantRow(get: () => AppState, content: string, model?: string): void {
  const cur = get().session;
  if (!cur) return;
  const msg: ChatMessage = {
    id: uid(),
    role: 'assistant',
    // kind stays unset (plain text) — MessageView renders it as an answer row
    content,
    ...(model ? { model } : {}),
    timestamp: Date.now(),
  };
  useStore.setState({ session: { ...cur, messages: [...cur.messages, msg] } });
  void get().persistSession();
}

/** Workspace-joined absolute path — <ws>/<parts…> (workspace paths are the
 *  renderer's canonical form; forward slashes work on every platform). */
function wsJoin(ws: string, ...parts: string[]): string {
  return [ws.replace(/[\\/]+$/, ''), ...parts].join('/');
}

/**
 * v11.20 — spread into EVERY `running:false` write so the instant-activity
 * strip disappears cleanly at the exact end of a run (no leftover ghost strip
 * that makes the UI look stuck).
 */
function clearedRunActivity(): Pick<AppState, 'runStartedAt' | 'runActivity' | 'runPhase'> {
  return { runStartedAt: null, runActivity: null, runPhase: null };
}

/**
 * v11.19 — the founder's 402 / "Insufficient credits" payload, translated into
 * the SELECTED language ONLY (never EN+AR together). Returns null for any other
 * error so callers can fall back to their normal handling.
 */
function noCreditsToast(raw: string, ar: boolean): string | null {
  if (!/Insufficient credits|no_credits|\b402\b/i.test(raw)) return null;
  // v11.22 — the canonical i18n key reuses this EXACT wording verbatim; the
  // inline fallback keeps an older i18n bundle honest if the key is missing.
  return makeT(ar ? 'ar' : 'en')(
    'err.setup.noCredits',
    ar
      ? 'رصيد غير كافٍ: حساب المزوّد ليس لديه رصيد. أضف رصيداً أو بدّل المزوّد/المفتاح من الإعدادات ← المزوّدون.'
      : 'Insufficient credits: add balance to the provider account or switch the provider/key in Settings → Providers.',
  );
}

// ── v11.23 (INGEST HARDENING) — honest, monolingual failure copy ──────────
// The IPC boundary is untrusted: `error.message` can be raw provider JSON
// (often EN while the UI is AR), or two languages stitched together. Map the
// MACHINE code / well-known patterns onto the eight canonical err.* keys
// (src/i18n.ts, owned by the i18n agent) and render exactly ONE language.
/** Which canonical err.* key describes this payload? null ⇒ the engine's own
 *  text is already an honest single-language string we must not rewrite. */
function runErrorKey(raw: string, code?: string): string | null {
  // A canonical key pinned by the preceding `error` event is authoritative.
  if (code && code.startsWith('err.')) return code;
  if (code === 'NO_PARAMS' || code === 'BAD_SHAPE') return 'err.run.badParams';
  if (code === 'NO_MODEL') return 'err.setup.noModel';
  if (code === 'NO_USER_MESSAGE') return 'err.run.noUserMessage';
  if (/invalid run parameters|missing messages/i.test(raw)) return 'err.run.badParams';
  if (/Insufficient credits|no_credits|\b402\b|credit balance|out of credits/i.test(raw)) return 'err.setup.noCredits';
  if (/rate.?limit|\b429\b|too many requests/i.test(raw)) return 'err.run.rateLimited';
  if (/no api key|missing api key|invalid api key|no key configured|unauthorized|\b401\b|\b403\b/i.test(raw)) return 'err.setup.noApiKey';
  if (/no model|model.*(?:missing|not selected|not configured)/i.test(raw)) return 'err.setup.noModel';
  if (/no workspace|workspace.*(?:not open|missing)/i.test(raw)) return 'err.setup.noWorkspace';
  if (/offline|unavailable|unreachable|econn|enotfound|network|fetch failed|timed? ?out|\b5\d\d\b/i.test(raw)) return 'err.run.providerUnavailable';
  return null;
}

const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;
const LATIN_WORD_RE = /^[A-Za-z][A-Za-z0-9_.\/-]*$/;
// Technical tokens are legal inside an Arabic sentence (API, JSON, npm…);
// they are NOT English prose and must not trigger a "mixed language" rewrite.
const ERROR_TECH_TOKENS = new Set([
  'api', 'url', 'http', 'https', 'www', 'json', 'jsonl', 'npm', 'git', 'ide',
  'ai', 'mcp', 'llm', 'openrouter', 'anthropic', 'openai', 'deepseek', 'ollama',
  'gemini', 'claude', 'settings', 'providers', 'dna', 'sadeem', 'kdx', 'gpt',
  'glm', 'qwen', 'moonshot', 'mistral', 'html', 'css', 'sql', 'cli', 'pdf',
  'provider', 'error', 'code', 'key', 'model', 'credits', 'balance', 'run',
]);

/** True when the string carries a run of ≥3 real English words (URLs and
 *  technical tokens don't count) — the same rule the i18n G14 suites use. */
function hasLatinProse(s: string): boolean {
  const clean = s.replace(/https?:\/\/\S+/g, ' ').replace(/[\w.+-]+@[\w.-]+/g, ' ');
  let streak = 0;
  for (const w of clean.split(/[^\p{L}\p{N}]+/u)) {
    if (!w || !LATIN_WORD_RE.test(w) || ERROR_TECH_TOKENS.has(w.toLowerCase()) || /^[A-Z0-9_.\/-]+$/.test(w)) {
      streak = 0;
      continue;
    }
    if (++streak >= 3) return true;
  }
  return false;
}

/**
 * v11.23 (C6/P0) — extract a SHORT, language-neutral machine reason from
 * untrusted provider / server text. Never prose, never JSON: an HTTP status,
 * a POSIX/Node code, or a compact code-like token. This keeps the REAL cause
 * visible even when the surrounding sentence must be re-localized — the old
 * "unknown ⇒ generic providerUnavailable" rewrite destroyed that reason.
 */
function machineReason(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const status = s.match(/\b([45]\d{2})\b/);
  if (status) return status[1];
  const posix = s.match(/\b(E[A-Z0-9]{2,}|KDX_[A-Z0-9_]+|NO_[A-Z_]+|BAD_SHAPE)\b/);
  if (posix) return posix[1];
  const upper = s.match(/\b([A-Z][A-Z0-9_.-]{2,24})\b/);
  if (upper && !/^(JSON|JSONL|HTTP|HTTPS|URL|API|AI|OK|EN|AR|UTF|GET|POST|MCP|LSP|PDF|CLI|IDE)$/.test(upper[1])) return upper[1];
  const quoted = s.match(/["']([A-Za-z0-9_.:/-]{3,40})["']/);
  if (quoted) return quoted[1];
  const keyed = s.match(/(?:error|reason|code|failed)\s*[:#=]\s*([A-Za-z0-9_.:/-]{3,40})/i);
  if (keyed) return keyed[1];
  return '';
}

/** `Error` / error-like objects cross the bridge too — read the MESSAGE, never
 *  String(error) (which can dump a stack or a hostile toString). */
function errorText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { message?: unknown }).message === 'string') {
    return (raw as { message: string }).message;
  }
  return '';
}

/** Render ANY untrusted error text as a single-language, actionable message. */
function localizeRunError(raw: unknown, ar: boolean, code?: string): string {
  const text = errorText(raw);
  const key = runErrorKey(text, code);
  if (key) return makeT(ar ? 'ar' : 'en')(key);
  const arabic = ARABIC_SCRIPT_RE.test(text);
  const latin = hasLatinProse(text);
  const mixed = arabic && latin;
  const wrongLanguage = ar ? !arabic && latin : arabic;
  if (mixed || wrongLanguage) {
    const base = makeT(ar ? 'ar' : 'en')('err.run.providerUnavailable');
    const reason = machineReason(text);
    // Preserve the concrete cause as a neutral token instead of losing it.
    return reason ? `${base} (${reason})` : base;
  }
  return text;
}

/**
 * v11.23 (C6/P0) — the ONE localized message for a preview failure. Known
 * classes reuse their canonical err.* copy; unknown server output collapses
 * to the honest preview.err.startFailed guidance plus a sanitized machine
 * reason. No raw JSON, no raw log dump, no mixed languages.
 */
function localizePreviewError(raw: unknown, ar: boolean): string {
  const text = errorText(raw);
  const key = runErrorKey(text);
  const base = key
    ? makeT(ar ? 'ar' : 'en')(key)
    : makeT(ar ? 'ar' : 'en')('preview.err.startFailed');
  const reason = machineReason(text);
  if (reason) return `${base} (${reason})`;
  // With no machine reason the localized error card body already carries the
  // WHY + next step — an empty detail avoids a second, duplicate wording.
  return key ? base : '';
}

/** Dev-server log lines are displayed verbatim in a code-styled block. Strip
 *  ANSI/JSON blobs and cap their length before they reach any surface. */
function sanitizeLogLine(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^[{[]/.test(s) && /[}\]]$/.test(s)) return ''; // raw JSON dump
  return s.slice(0, 200);
}

/** Defensive normalizers for untrusted transcript payloads: a `null` / string
 *  where an array was expected must never throw at ingest OR in a renderer. */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function asCommandArray(v: unknown): { cmd: string; ok: boolean }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ cmd: typeof c.cmd === 'string' ? c.cmd : '', ok: c.ok === true }));
}
function asFiniteMs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}
/** Proof-gate detail strings are rendered verbatim — coerce untrusted IPC
 *  scalars to a bounded string so a non-string can never poison the ribbon. */
function safeDetail(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v.slice(0, 800);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

/**
 * v11.13 — detect a project's test command from its package.json. An explicit
 * `test` script wins; common CI aliases are accepted next. Returns '' when the
 * project genuinely declares no test command (the caller then reports that
 * honestly rather than inventing one).
 */
export function detectTestCommand(packageJson: string | null | undefined): string {
  if (!packageJson) return '';
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> };
    const scripts = parsed?.scripts ?? {};
    for (const name of ['test', 'test:unit', 'test:ci']) {
      const v = scripts[name];
      if (typeof v === 'string' && v.trim()) return `npm run ${name}`;
    }
  } catch {
    /* malformed package.json — no honest command to derive */
  }
  return '';
}

/** Does the workspace file tree contain a Python test entry point? */
function hasPythonTests(tree: { name?: string; path?: string; type?: string; children?: unknown[] } | null): boolean {
  if (!tree) return false;
  const node = tree as { name?: string; path?: string; type?: string; children?: unknown[] };
  const name = String(node.name ?? (node.path ? node.path.split(/[\\/]/).pop() : '') ?? '');
  if (/^test_.*\.py$/.test(name) || /^.*_test\.py$/.test(name) || name === 'pytest.ini') return true;
  if (node.type === 'dir' && Array.isArray(node.children)) {
    for (const c of node.children) if (hasPythonTests(c as typeof node)) return true;
  }
  return false;
}

/** Resolve an /explain argument to a path INSIDE the open workspace ('' = reject). */
function resolveExplainPath(ws: string, arg: string): string {
  const a = String(arg ?? '').trim().replace(/^["']|["']$/g, '');
  if (!a) return '';
  const absolute = /^[A-Za-z]:[\\/]/.test(a) || a.startsWith('/') || a.startsWith('\\');
  if (!absolute) return wsJoin(ws, a);
  // absolute paths are accepted only when they live inside the workspace
  const norm = a.replace(/\\/g, '/').toLowerCase();
  const wsn = String(ws ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return wsn && norm.startsWith(`${wsn}/`) ? a : '';
}

/** Last-resort save when the fs bridge is unavailable (browser dev / older main):
 *  hand the content to the browser download flow (Downloads folder). */
function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const clipMd = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + '\n…[truncated]' : s);

/**
 * v11.12 (/continue) — the last REAL user task in the transcript. Skips steering
 * injections, queued rows, compaction summaries and slash-command echoes: none
 * of those is a task worth re-sending. Returns '' when there is nothing to
 * continue (the caller then reports that honestly instead of looping).
 */
function lastUserTask(msgs: ChatMessage[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user' || m.id.startsWith('sys:')) continue;
    if (m.model === 'steer' || m.model === 'queued' || m.model === 'compaction') continue;
    const content = String(m.content ?? '').trim();
    if (!content || content.startsWith('/') || content.startsWith('[Compacted')) continue;
    return content;
  }
  return '';
}

/** Full current transcript as clean markdown — roles, tool names, contents,
 *  timestamps and tool results (same shape as sessionService's exporter, but
 *  built renderer-side so the Blob fallback shares one code path). */
function buildSessionMarkdown(s: SessionData): string {
  const header = [
    `# ${s.title || 'SADEEM session'}`,
    '',
    `- Session: \`${s.id}\``,
    `- Created: ${new Date(s.createdAt).toISOString()}`,
    `- Exported: ${new Date().toISOString()}`,
    s.workspace ? `- Workspace: \`${s.workspace}\`` : null,
    s.model ? `- Model: ${s.model}` : null,
    `- Messages: ${s.messages.length}`,
  ]
    .filter((l): l is string => !!l)
    .join('\n');
  const body = s.messages
    .map((m) => {
      const time = new Date(m.timestamp).toISOString();
      if (m.kind === 'tool_call') {
        return `### tool call — ${m.toolName ?? 'unknown'}\n\n_${time}_\n\n\`\`\`\n${clipMd(m.content ?? '', 2000)}\n\`\`\``;
      }
      if (m.kind === 'tool_result') {
        const status = m.resultOk === false ? 'error' : 'ok';
        return `### tool result${m.toolName ? ` — ${m.toolName}` : ''} (${status})\n\n_${time}_\n\n\`\`\`\n${clipMd(m.content ?? '', 2000)}\n\`\`\``;
      }
      const role = m.role === 'user' ? 'user' : 'assistant';
      const model = m.model ? ` _(model: ${m.model})_` : '';
      return `### ${role}${model}\n\n_${time}_\n\n${clipMd(m.content ?? '', 20_000)}`;
    })
    .join('\n\n---\n\n');
  return `${header}\n\n---\n\n${body || '_(empty transcript)_'}\n`;
}

const escapeHtml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const PROOF_DOT: Record<ProofGate['tone'], string> = { ok: '#a9be56', warn: '#fbbf24', bad: '#e8e4d8' };
const PROOF_LABEL: Record<ProofGate['id'], string> = {
  redGreen: 'red/green',
  mutation: 'mutation',
  fakes: 'fake tests',
  critic: 'critic',
  verify: 'verify',
  receipt: 'receipt',
};

/** /share — self-contained HTML report of the session: inline CSS only (no
 *  network), dark palette, RTL-safe (dir=auto per message + logical CSS
 *  properties), bilingual footer. Covers title, messages, tool stats and the
 *  Proof Ribbon gate lines. */
function buildShareHtml(
  s: SessionData,
  opts: { ar: boolean; proof: ProofState; usage: { inputTokens: number; outputTokens: number; costUsd: number } },
): string {
  const { ar, proof, usage } = opts;
  const t = slashT(ar);
  const esc = escapeHtml;
  const time = (at: number) => new Date(at).toLocaleString(ar ? 'ar' : 'en');

  // tool stats — calls per tool + ok/fail from the paired results
  const stats = new Map<string, { calls: number; ok: number; fail: number }>();
  for (const m of s.messages) {
    if (m.kind === 'tool_call') {
      const name = m.toolName ?? 'unknown';
      const row = stats.get(name) ?? { calls: 0, ok: 0, fail: 0 };
      row.calls++;
      stats.set(name, row);
    } else if (m.kind === 'tool_result' && m.toolName) {
      const row = stats.get(m.toolName) ?? { calls: 0, ok: 0, fail: 0 };
      if (m.resultOk === false) row.fail++;
      else row.ok++;
      stats.set(m.toolName, row);
    }
  }
  const statChips = [...stats.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(
      ([name, r]) =>
        `<span class="chip"><b>${esc(name)}</b> ×${r.calls}${
          r.ok + r.fail > 0 ? ` · <i class="ok">${r.ok} ok</i>${r.fail ? ` · <i class="bad">${r.fail} err</i>` : ''}` : ''
        }</span>`,
    )
    .join(' ');

  const gateRows = proof.gates.length
    ? proof.gates
        .map(
          (g) =>
            `<li class="gate"><span class="dot" style="background:${PROOF_DOT[g.tone]}"></span>` +
            `<b>${esc(PROOF_LABEL[g.id] ?? g.id)}</b> — <span>${esc(g.detail)}</span>` +
            `<time>${esc(time(g.at))}</time></li>`,
        )
        .join('')
    : `<li class="gate none">${esc(t('slash.share.noProof', 'No gates ran in this session yet.'))}</li>`;

  const msgRows = s.messages
    .map((m) => {
      const head =
        m.kind === 'tool_call'
          ? `<span class="tag tool">${esc(t('slash.share.tool', 'tool'))} · ${esc(m.toolName ?? 'unknown')}</span>`
          : m.kind === 'tool_result'
            ? `<span class="tag ${m.resultOk === false ? 'err' : 'okk'}">${m.resultOk === false ? 'error' : 'ok'}${
                m.toolName ? ' · ' + esc(m.toolName) : ''
              }</span>`
            : `<span class="tag ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? (ar ? 'أنت' : 'You') : 'SADEEM'}</span>${
                m.model && m.model !== 'error' ? `<span class="model">${esc(m.model)}</span>` : ''
              }`;
      const isCode = m.kind === 'tool_call' || m.kind === 'tool_result';
      const bodyHtml = isCode
        ? `<pre dir="ltr">${esc(clipMd(m.content ?? '', 4000))}</pre>`
        : `<div class="content" dir="auto">${esc(clipMd(m.content ?? '', 20_000))}</div>`;
      return `<article class="msg ${m.role === 'user' ? 'user' : 'ai'}"><header>${head}<time>${esc(
        time(m.timestamp),
      )}</time></header>${bodyHtml}</article>`;
    })
    .join('\n');

  const title = esc(s.title || (ar ? 'جلسة سديم' : 'SADEEM session'));
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — SADEEM</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0f14; color: #d8d4cb; font: 14px/1.6 'Inter', 'Cairo', system-ui, sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 6px; color: #f2f7fc; }
  .meta { color: #898986; font-size: 12px; margin: 0 0 18px; word-break: break-all; }
  .meta code { color: #aeaeab; font-family: 'IBM Plex Mono', Menlo, Consolas, monospace; }
  .stats { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
  .chip { background: #1b1b18; border: 1px solid #2e2e2b; border-radius: 999px; padding: 3px 10px; font-size: 11.5px; color: #babab7; }
  .chip i { font-style: normal; }
  .chip .ok { color: #a9be56; } .chip .bad { color: #e8e4d8; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #9f9f9c; margin: 22px 0 8px; }
  ul.gates { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .gate { background: #121922; border: 1px solid #2e2e2b; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .gate time { margin-inline-start: auto; color: #6f6f6c; font-size: 11px; }
  .gate.none { color: #6f6f6c; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
  .msg { background: #121922; border: 1px solid #2e2e2b; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
  .msg.user { border-inline-start: 3px solid #c9a488; }
  .msg.ai { border-inline-start: 3px solid #a9be56; }
  .msg header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .tag { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 7px; border-radius: 4px; }
  .tag.user { background: rgba(217,119,6,.15); color: #f0a949; }
  .tag.ai { background: rgba(52,211,153,.14); color: #b7cf45; }
  .tag.tool { background: rgba(161,161,156,.14); color: #b5b5b2; text-transform: none; }
  .tag.okk { background: rgba(52,211,153,.14); color: #b7cf45; text-transform: none; }
  .tag.err { background: rgba(232,228,216,.14); color: #e8e4d8; text-transform: none; }
  .model { color: #6f6f6c; font-size: 10.5px; font-family: 'IBM Plex Mono', Menlo, Consolas, monospace; }
  .msg time { margin-inline-start: auto; color: #6f6f6c; font-size: 11px; }
  .content { white-space: pre-wrap; overflow-wrap: anywhere; }
  pre { margin: 0; background: #0b0f14; border: 1px solid #262623; border-radius: 6px; padding: 8px 10px; overflow-x: auto; font: 12px/1.5 'IBM Plex Mono', Menlo, Consolas, monospace; color: #c2c2bf; white-space: pre-wrap; overflow-wrap: anywhere; }
  footer { margin-top: 28px; color: #6f6f6c; font-size: 11.5px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${title}</h1>
  <p class="meta">
    <code>${esc(s.id)}</code> · ${esc(new Date(s.createdAt).toISOString())} ·
    ${esc(new Date().toISOString())}${s.workspace ? ` · <code>${esc(s.workspace)}</code>` : ''}${
    s.model ? ` · ${esc(s.model)}` : ''
  } · ${s.messages.length} ${esc(t('slash.share.messages', 'Messages'))} ·
    ${usage.inputTokens + usage.outputTokens} tok · $${usage.costUsd.toFixed(4)}
  </p>
  ${
    statChips
      ? `<h2>${esc(t('slash.share.toolCalls', 'Tool calls'))}</h2><div class="stats">${statChips}</div>`
      : ''
  }
  <h2>${esc(t('slash.share.proof', 'Proof & gates'))}</h2>
  <ul class="gates">${gateRows}</ul>
  ${msgRows}
  <footer>${ar ? 'أُنشئت بواسطة سديم — محطة العمل البرمجية بالذكاء الاصطناعي' : 'Generated by SADEEM — the AI coding workstation'}</footer>
</div>
</body>
</html>
`;
}
// ── end A1 slash helpers ──

/**
 * v11.10 — map a devStart error string to the honest preview-error card's
 * reason bucket (EN+AR copy lives in i18n under preview.err.*).
 */
function mapDevStartError(err?: string): 'noWorkspace' | 'noDevScript' | 'noPackage' | 'noPython' | 'noCustom' | 'startFailed' {
  const s = String(err ?? '');
  if (/no package\.json/i.test(s)) return 'noPackage';
  if (/no dev\/start\/serve script/i.test(s)) return 'noDevScript';
  if (/no python entry/i.test(s)) return 'noPython';
  if (/no custom preview command/i.test(s)) return 'noCustom';
  return 'startFailed';
}

interface PendingApproval {
  requestId: string;
  // 'mcp_elicitation' mirrors shared/types ApprovalKind (added by the MCP
  // elicitation agent) — kept in sync so ingestAgentEvent type-checks.
  kind: 'write' | 'command' | 'mcp' | 'delete' | 'doom_loop' | 'question' | 'mcp_elicitation';
  title: string;
  detail: string;
  /** doom_loop approvals carry the repeating tool's name (payload {toolName}). */
  toolName?: string;
  /** v11.10 — the raw command line (command kind) so decideApproval can
   * derive the per-tool ALWAYS scope when the card sends no explicit one. */
  command?: string;
  /** v3.1 — ask_user: choice buttons + optional free-text field. */
  choices?: string[];
  allowText?: boolean;
}

/** A structured plan proposal submitted by the engine (propose_plan / plan mode). */
export interface PlanProposal {
  title: string;
  steps: string[];
  risks: string[];
  raw: string;
}

// ── v7.2 UI-TSX additions (additive) ────────────────────────────────
/** One proof/verification gate verdict for the Proof Ribbon + trust map. */
export interface ProofGate {
  id: 'redGreen' | 'mutation' | 'fakes' | 'critic' | 'verify' | 'receipt';
  /** 'ok' = passed · 'warn' = partial/unknown-detail · 'bad' = failed. */
  tone: 'ok' | 'warn' | 'bad';
  /** One-line honest detail from the event payload. */
  detail: string;
  at: number;
}

/** v8.1 mutation verdict vocabulary (mirrors electron/agent/mutation.ts). */
export type ProofMutationVerdict =
  | 'killed-enough'
  | 'survivors'
  | 'boundary-survivors'
  | 'strong-small'
  | 'weak'
  | 'no-mutations'
  | 'baseline-failed'
  | 'skipped';

/** The RAW mutation_gate verdict. The pre-v8.1 ProofGate tone cannot express
 *  "inconclusive", so the ribbon needs the verdict itself. Keeping it in the
 *  proof slice (instead of a module-level tap in the component) means it is
 *  cleared with the rest of the proof at every turn boundary — a mutation
 *  verdict from an earlier turn can never decorate a later plain answer. */
export interface ProofMutation {
  verdict: ProofMutationVerdict;
  ran: number;
  killed: number;
  inconclusive: boolean;
}

/** Run-wide proof state: gray (unproven) → green (proven) → red (failed). */
export interface ProofState {
  status: 'unproven' | 'proven' | 'failed';
  gates: ProofGate[];
  /** Epoch ms of the last gate event (ribbon tooltip). */
  updatedAt: number;
  /** Latest raw mutation verdict for this turn (null until one is emitted). */
  mutation: ProofMutation | null;
}

const EMPTY_PROOF: ProofState = { status: 'unproven', gates: [], updatedAt: 0, mutation: null };

/**
 * v11.13 — one structured output panel rendered INSIDE the composer for the
 * real slash capabilities (/diff /test /explain /skills /mcp /budget). It is
 * not a decorative card: `text` is the actual command output (diff patch,
 * test stdout+stderr, model explanation, server list, usage totals) and the
 * composer offers a real copy-to-clipboard button for it. Also appended to the
 * transcript as an assistant row so the result survives panel dismissal.
 */
export interface CapabilityPanel {
  seq: number;
  title: string;
  kind: 'diff' | 'test' | 'explain' | 'skills' | 'mcp' | 'budget';
  text: string;
  at: number;
}

/** Focus mode persists across reloads via localStorage (chat + diff only). */
const FOCUS_KEY = 'surnia.focusMode';
function readFocusMode(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === '1';
  } catch {
    return false;
  }
}
// ── end v7.2 additions ─────────────────────────────────────────────

/**
 * v11.11 (A4-CLOSURE) — the guaranteed completion report, mirrored in the
 * store. Shape matches the engine's `task_report` AgentEvent (+ `at` stamp).
 */
export interface TaskReportSlice {
  outcome: 'completed' | 'error' | 'aborted';
  summary: string;
  files: string[];
  commands: { cmd: string; ok: boolean }[];
  howToRun?: string;
  nextSteps: string[];
  /** v11.12 (A4-REPORT) — per-tool usage chips (what the run ACTUALLY used). */
  toolsUsed?: { name: string; count: number; ok: number; fail: number }[];
  /** v11.12 (A4-REPORT) — open todos: what was NOT done. */
  notDone?: string[];
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  partial?: boolean;
  taskMode?: 'plan' | 'debug' | 'review';
  stopReason?: string;
  durationMs: number;
  at: number;
}

interface AppState {
  booted: boolean;
  settings: AppSettings;
  license: LicenseState;

  // workspace
  wsPath: string;
  fileTree: FileNode | null;
  treeLoading: boolean;

  // editor tabs
  tabs: OpenTab[];
  activeTab: string | null;

  // chat / agent
  session: SessionData | null;
  sessions: SessionMeta[];
  running: boolean;
  /**
   * v11.20 (A1) — exact epoch-ms moment the user pressed send (the
   * running:false→true edge). The UI animates the elapsed clock from HERE,
   * NOT from the first engine event. Null while idle.
   */
  runStartedAt: number | null;
  /**
   * v11.20 (A1) — immediate, engine-independent activity for the live strip.
   * `phase` is 'preparing' the instant send is pressed; A1 liveness notices
   * refine it. Null while idle (strip hidden).
   */
  runActivity: RunActivityState | null;
  /** v11.20 — convenience mirror of `runActivity?.phase` (null while idle). */
  runPhase: RunActivityPhase | null;
  /**
   * v12 (RECOVERY) — live run-health status. Set by the renderer watchdog when
   * a run goes quiet (no agent events) while `running` is true — the exact
   * "يعلق وما كتب شي" failure. The main-process engine has its own watchdogs,
   * but terminal events can be lost at the IPC boundary (window gone) and a
   * main-process crash leaves `running` stuck. This surface makes recovery
   * VISIBLE and force-clears a truly dead run so the user can retry.
   * Cleared on every agent event and on every terminal path.
   */
  runRecovery: { since: number; phase: 'stalled' | 'recovering' | 'recovered'; note?: string } | null;
  /**
   * v12 (RESUME) — a task that was in flight when the app closed. Detected at
   * boot from a durable localStorage marker; the user gets a one-click resume
   * chip instead of losing the task to an abrupt disconnect.
   */
  resumableRun: { task: string; sessionId: string; workspace: string; at: number } | null;
  todos: TodoItem[];
  pendingApproval: PendingApproval | null;
  planProposal: PlanProposal | null;
  /** v7 — carries the provider cache split (accumulated from message_end usage).
   *  v11.10 (A5) — accumulated from the RUN VIEW (whole-turn billing totals:
   *  all rounds + all attempts), so the Usage tab reconciles
   *  sum(per-message) == session total exactly. */
  sessionUsage: Usage & {
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    attempts?: UsageAttempt[];
    /** v11.40 — true when numbers came from stale session metadata, not
     *  reconciled provider usage rows; consumers show `≈` accordingly. */
    estimated?: boolean;
  };
  /** v11.3 — usage of the LAST COMPLETED TURN (per-turn DELTA). Context-fill %
   *  everywhere (Composer bar, status-bar ring, ContextLens) derives from
   *  THIS — the real current context size — not from the session SUM, which
   *  grew every turn and made the ring lie. v11.10 (A5): `estimated` true ⇒
   *  the provider never reported usage (chars/4 estimate → show "≈"). */
  lastTurnUsage: (Usage & { cacheReadTokens?: number; cacheCreationTokens?: number }) | null;

  // agent v2: live goal tracking + message queue while the agent is busy
  activeGoal: { goal: string; pct?: number } | null;
  queuedCount: number;

  // ---------- v2.1 engine: control surface (chat/control D2) ----------
  /** Session task mode — shapes the engine protocol (BUILD default). */
  taskMode: TaskMode;
  /** True between agentSteer() and the engine's steer_injected event. */
  steerPending: boolean;
  /** Local mirror of queued messages (dismissible chips; engine queue is FIFO). */
  queuedItems: string[];
  /** Live background-subagent progress (id → progress). */
  subagentProgress: Record<string, { label: string; done: number; total: number }>;
  /** v7.1 — False-Done Rate (published honesty metric), updated after each run. */
  falseDoneStats: { claimed: number; falseDone: number; rate: number } | null;
  /** v7.1 — verification budget chip label (429s refunded, never consumed). */
  verificationBudgetLabel: string;
  /**
   * v11.11 (A4-CLOSURE) — THE GUARANTEED COMPLETION REPORT. The engine emits
   * `task_report` on EVERY terminal path (completed / error / aborted —
   * incl. failover-exhausted and watchdog-recovered runs) right before
   * turn_end. The full slice is mirrored here for programmatic use (/report);
   * v11.28 — the user-facing surface is ONE localized toast, NOT a transcript
   * card. Reset on run start.
   */
  lastTaskReport: TaskReportSlice | null;
  /**
   * v11.28 — mirror of the single terminal-report toast emitted for the last
   * settled run. Lets headless hosts / a11y inspect the exact text shown; the
   * real surface is `pushToast`. `seq` increments once per emitted report.
   */
  lastReportToast: { title: string; severity: 'info' | 'success' | 'warn' | 'error'; seq: number } | null;
  /** Latest structured review result (rendered at the top of the transcript). */
  lastReview: { findings: ReviewFinding[]; summary?: string } | null;
  /** Workspace skills (.surnia/skills) — loaded on workspace change + skill_created. */
  skills: SkillInfo[];
  skillsOpen: boolean;
  /** Model context window (tokens) — fetched once per model by the StatusBar. */
  ctxWindow: number;
  /** v11.10 (A5) — true ⇒ the model id matched NO catalog row: ctxWindow is
   *  the honest 200k default and every display must show "≈". */
  ctxWindowEstimated: boolean;
  /** v11.10 (A5) — chars streamed in the LIVE turn (text + thinking). While a
   *  run streams, the context bar shows an honest chars/4 estimate marked
   *  "≈" on top of the last exact fill; message_end replaces it with the
   *  provider's exact usage. Null ⇒ no live estimate (idle or exact known). */
  liveStreamChars: number;

  // ---------- v2.2 SADEEM DNA (the closed learning loop) ----------
  /** Merged (global + workspace) DNA model — null until the first load. */
  dna: DNAData | null;
  /** 14-day growth + counters (drives the StatusBar chip + DnaPanel strip). */
  dnaStats: DnaStatsInfo | null;
  /** Proactive skill suggestion chip ({patternId?, text}) from the engine. */
  dnaSuggestion: { patternId?: string; text: string } | null;
  dnaLoading: boolean;
  /** A 'skills-trust' DNA event arrived — the workspace skills need consent. */
  skillsTrustNeeded: boolean;

  // ---------- v11.12 — Living Playbook (signature feature) ----------
  playbook: PlaybookData | null;
  playbookHistory: PlaybookRevision[];
  playbookLoading: boolean;
  /** Latest "SADEEM learned: …" notice, shown as a chip + toast. */
  lastPlaybookLearning: { summary: string; version: number; ts: number } | null;
  /**
   * v11.12 CHAT CAPABILITIES — the last turn ended early (truncated / budget /
   * compaction / error) and the task can be re-sent with a "continue" directive.
   * Drives the composer's Continue button and the /continue slash command.
   * Null ⇒ nothing to continue (cleared on every run start / session switch).
   */
  continueHint: { task: string; reason: 'truncated' | 'compacted' | 'error' } | null;

  // ---------- v11.12 — Subagent dashboard ----------
  subagents: SubagentRecord[];
  subagentsLoading: boolean;
  /** Detail view: the subagent whose dedicated page is open (null = closed). */
  subagentDetailId: string | null;
  /** Live step timeline per subagent, fed by `subagent_progress` events. */
  subagentSteps: Record<string, SubagentStep[]>;
  /**
   * v11.36 — REAL per-agent tool-call transcript, keyed by subagent id. Fed by
   * the engine's `subagent_toolcall` IPC event (and `subagent_progress.step`);
   * this is what the child-session view renders. Never a fabricated feed.
   */
  subagentToolCalls: Record<string, SubagentToolCall[]>;

  // ---------- v2.4 Flows ----------
  /** Chip raised when a sent message looks flow-worthy (api.flowsHit). */
  flowSuggest: { text: string } | null;

  // ---------- v6 artifact comments (Antigravity pending-comment chips) ----------
  /** Comments queued on the Artifacts hub — they ride along with the NEXT message. */
  artifactComments: string[];
  addArtifactComment: (text: string) => void;
  removeArtifactComment: (index: number) => void;
  clearArtifactComments: () => void;

  // chat panel width — single source in the store, persisted via localStorage
  chatWidth: number;

  // scheduled jobs (cron agent runs) + the /schedule drawer
  scheduledJobs: ScheduleJob[];
  scheduledOpen: boolean;

  // /commit bridge: the generated suggestion fills the GitPanel commit input
  commitSuggestion: { text: string; seq: number } | null;

  // terminal
  terminalId: string | null;
  terminalOpen: boolean;
  termHeight: number;

  // live preview
  previewOpen: boolean;
  previewUrl: string;
  previewStatus: PreviewStatusResult | null;
  /** v8: workspace the current previewUrl belongs to — the preview is PER-SESSION, never inherited from an older conversation. */
  previewWs: string;
  /** v11.10 — who chose the current URL: 'user' (typed), 'static', 'dev' (ready event) or '' (none). Drives adoption on dev restarts (port change). */
  previewSource: '' | 'user' | 'static' | 'dev';
  /** v11.10 — honest failure card: WHY there is nothing to preview (EN/AR keys resolved in PreviewArea). */
  previewError: { reason: 'noWorkspace' | 'noDevScript' | 'noPackage' | 'noPython' | 'noCustom' | 'startFailed'; detail?: string } | null;
  /**
   * v11.11 (A3) — engine-driven AUTO-OPEN request. The completion hook emits
   * `preview_open` + `previewHint` when a run wrote runnable files; the store
   * turns it into this sequenced request and PreviewArea consumes it
   * (auto-start + auto-switch to the preview view). seq dedupes; ws scopes it
   * to the active workspace.
   */
  previewAuto: {
    seq: number;
    kind: 'dev' | 'static' | 'artifact';
    dir?: string;
    runtime?: 'npm' | 'python' | 'custom' | 'go';
    label?: string;
    ws: string;
  } | null;

  // git
  git: GitStatus | null;

  // search
  searchResults: SearchHit[] | null;
  searching: boolean;

  // ui
  rail: RailView;
  sidebarOpen: boolean;
  chatOpen: boolean;
  paletteOpen: boolean;
  modelPickerOpen: boolean;
  settingsOpen: boolean;
  settingsSection: string;
  plansOpen: boolean;
  shortcutsOpen: boolean;
  onboardingOpen: boolean;
  diffView: DiffViewRequest | null;
  /** v11.13 — captured output of the last real slash capability, shown in the composer. */
  capabilityPanel: CapabilityPanel | null;
  /** A1 /rewind — chooser payload: checkpoints being picked from (null = closed). */
  rewindPicker: CheckpointInfo[] | null;
  notice: string | null;

  // auth + project creation
  account: AccountInfo | null;
  /** v11.3 — active website-activation handshake (pair code + site URL). */
  webAuthPending: { pair: string; url: string } | null;
  authChecked: boolean;
  newProjectOpen: boolean;
  cloneOpen: boolean;

  // editor AI → composer bridge (editor actions push text, Composer consumes it)
  composerInsert: { text: string; seq: number } | null;

  // ---------- v7.2 UI-TSX additions ----------
  /** Focus mode — hides rail+sidebar+editor/terminal/preview, leaving chat+diff. Esc exits. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
  /** Proof Ribbon state, driven by the v6/v7.1 proof & verdict events. */
  proof: ProofState;
  /** Run-wide gate tone for the diff trust map: ok/partial/bad/unknown. */
  proofTone: () => 'ok' | 'partial' | 'bad' | 'unknown';
  /**
   * v11.15 — TRUE only when the CURRENT turn produced real, tool-backed work:
   * files changed, a command ran, tests ran, or a run receipt was emitted.
   * A pure chat/answer turn (no tool use) has none → the ribbon stays hidden.
   * Recomputed on every ingest event from the per-turn evidence ledger below,
   * and cleared by resetProofForTurn() at the start of each user turn.
   */
  proofVisible: boolean;

  // ---------- actions ----------
  init: () => Promise<void>;
  applyDoc: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setLang: (l: Lang) => void;
  cycleTheme: () => void;
  setMode: (m: PermissionMode) => void;

  openFolderDialog: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  setTabContent: (path: string, content: string) => void;
  saveTab: (path: string) => Promise<void>;
  saveAll: () => Promise<void>;
  createEntry: (type: 'file' | 'dir', parentDir: string, name: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (oldPath: string, newName: string) => Promise<void>;
  runSearch: (q: string) => Promise<void>;

  newSession: (title?: string) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  /** v10.2 — pin/unpin THIS chat to a git worktree (Codex-style hand-off). */
  setSessionWorktree: (name: string | null) => Promise<boolean>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  persistSession: () => Promise<void>;

  // scheduled jobs (v2)
  loadJobs: () => Promise<void>;
  scheduleAdd: (job: Partial<ScheduleJob>) => Promise<void>;
  scheduleRemoveJob: (id: string) => Promise<void>;
  scheduleToggleJob: (id: string, enabled: boolean) => Promise<void>;
  scheduleRunJobNow: (id: string) => Promise<void>;
  setScheduled: (o: boolean) => void;
  clearGoal: () => Promise<void>;

  sendMessage: (text: string, images?: string[], displayAs?: string) => Promise<void>;
  /** /goal — set (or, with no argument, report) the tracked goal + visible banner. */
  setGoal: (goal: string) => Promise<void>;
  /** /compact — run a REAL compaction turn with immediate visible feedback. */
  compact: () => Promise<void>;
  /** v12 — re-send the task that was interrupted by an app close/crash. */
  resumeTask: () => Promise<void>;
  dismissResumable: () => void;
  runAgent: (task: 'chat' | 'compact' | 'init') => Promise<void>;
  ingestAgentEvent: (e: AgentEvent) => void;
  /** v11.15 — proof is PER-TURN: call at every new user turn (see sendMessage). */
  resetProofForTurn: () => void;
  decideApproval: (
    action: 'allow' | 'deny' | 'always' | 'always_session' | 'always_project' | 'never' | 'never_always' | 'answer',
    value?: string,
  ) => Promise<void>;
  clearPlan: () => void;
  abortAgent: () => Promise<void>;
  setModel: (provider: ProviderId, model: string) => void;
  refreshLicense: () => Promise<void>;

  // ---------- v2.1 engine actions (chat/control D2) ----------
  setTaskMode: (m: TaskMode) => void;
  approvePlan: (choice: PlanApprovalChoice, feedback?: string) => Promise<void>;
  sendSteer: (text: string) => Promise<void>;
  runReview: () => Promise<void>;
  exportRecap: () => Promise<void>;
  loadSkills: () => Promise<void>;
  deleteSkill: (slug: string) => Promise<void>;
  setSkillsOpen: (o: boolean) => void;
  dismissQueued: (index: number) => void;
  clearReview: () => void;
  setCtxWindow: (n: number) => void;
  /** v11.10 (A5) — honesty flag for the context window (unknown model → ≈). */
  setCtxWindowEstimated: (v: boolean) => void;

  // ---------- v2.2 DNA actions ----------
  /** dnaGet + dnaStats (workspace-scoped), defensive against older preloads. */
  loadDna: () => Promise<void>;
  /** Dismiss the proactive skill suggestion chip (engine + local mirror). */
  clearDnaSuggestion: () => void;
  /** Trust the current workspace's skills (.surnia/skills-trusted). */
  trustWorkspaceSkills: () => Promise<void>;

  // ---------- v11.12 actions ----------
  loadPlaybook: () => Promise<void>;
  clearPlaybook: () => Promise<void>;
  loadSubagents: () => Promise<void>;
  retrySubagent: (id: string) => Promise<void>;
  clearSubagents: () => Promise<void>;
  /** Open/close the dedicated subagent detail view (chat chip / rail card). */
  openSubagentDetail: (id: string) => void;
  closeSubagentDetail: () => void;
  /** Chat panel width (clamped + persisted to localStorage). */
  setChatWidth: (w: number) => void;

  // ---------- v2.4 Flows actions ----------
  setFlowSuggest: (s: { text: string } | null) => void;
  dismissFlowSuggest: () => void;

  toggleTerminal: () => Promise<void>;
  setTermHeight: (h: number) => void;

  // live preview
  setPreviewOpen: (o: boolean) => void;
  togglePreview: () => void;
  navigatePreview: (url: string) => void;
  refreshPreviewStatus: () => Promise<void>;
  startStaticPreview: (dir?: string) => Promise<void>;
  startDevPreview: (runtime?: 'npm' | 'python' | 'custom' | 'go') => Promise<void>;
  stopDevPreview: () => Promise<void>;
  /** v11.10 — clear the honest preview error card. */
  dismissPreviewError: () => void;

  loadGit: () => Promise<void>;
  gitStage: (paths: string[]) => Promise<void>;
  gitCommit: (message: string) => Promise<string>;

  setRail: (v: RailView) => void;
  toggleSidebar: () => void;
  setPalette: (o: boolean) => void;
  setModelPicker: (o: boolean) => void;
  setSettings: (o: boolean, section?: string) => void;
  setPlans: (o: boolean) => void;
  setShortcuts: (o: boolean) => void;
  setDiffView: (d: DiffViewRequest | null) => void;
  /** A1 /rewind — open/close the checkpoint chooser. */
  setRewindPicker: (cps: CheckpointInfo[] | null) => void;
  /** v12 — list this workspace's checkpoints and open the chooser. Reachable
   *  from the composer button, the same payload the /rewind command uses. */
  openRewindPicker: () => Promise<void>;
  /** A1 /rewind — restore the picked checkpoint (row + toast + tree refresh). */
  restoreCheckpoint: (id: string) => Promise<void>;

  // ---------- v11.12 CHAT CAPABILITIES (real, end-to-end slash actions) ----------
  /** `/model <name>` — resolve a model reference and switch it for this session.
   *  Empty argument opens the existing picker (no fake success). */
  switchModel: (arg: string) => Promise<void>;
  /** `/profile essential|balanced|full` — switch the advertised tool set. */
  switchToolProfile: (profile: string) => Promise<void>;
  /** `/undo` — restore the newest checkpoint through the existing cp bridge. */
  undoLastCheckpoint: () => Promise<void>;
  /** `/continue` / Continue button — re-send the last task with a continuation directive. */
  continueTask: () => Promise<void>;

  // ---------- v11.13 — real composer capabilities (all backed by an existing service/IPC) ----------
  /** `/diff [path]` — unified diff of uncommitted changes via kdx:git:diff. */
  showDiff: (arg: string) => Promise<void>;
  /** `/test [cmd]` — run the project's test command; REAL exit code verdict via kdx:cmd:run. */
  runTests: (arg: string) => Promise<void>;
  /** `/explain <path>` — read a file and run a real one-shot model completion in the UI language. */
  explainFile: (arg: string) => Promise<void>;
  /** `/skills on|off|list` — toggle the real workspace skill-injection gate; list loaded skills. */
  skillsCommand: (arg: string) => Promise<void>;
  /** `/mcp list|test <id>` — list configured servers with real status; health-check one. */
  mcpCommand: (arg: string) => Promise<void>;
  /** `/budget` — real session token/cost totals from the usage store (no invented numbers). */
  budgetCommand: () => Promise<void>;
  /** Open/close the composer's captured-output panel. */
  showCapabilityPanel: (panel: Omit<CapabilityPanel, 'seq' | 'at'>) => void;
  dismissCapabilityPanel: () => void;

  toggleChat: () => void;
  notify: (msg: string) => void;
  clearNotice: () => void;
  insertIntoComposer: (text: string) => void;

  // auth + project creation actions
  signOut: () => Promise<void>;
  setAccount: (a: AccountInfo | null) => void;
  setNewProject: (o: boolean) => void;
  setCloneOpen: (o: boolean) => void;
  cloneRepo: (
    opts: import('../shared/types').CloneOptions,
  ) => Promise<{ ok: boolean; projectPath?: string; error?: string }>;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  // v11.3 — the DEVICE decides: 'follow' mirrors the OS light/dark nature.
  // Light is the primary SADEEM design; dark themes stay secondary.
  theme: 'follow',
  permissionMode: 'default',
  model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
  providers: {},
  fontSize: 13,
  terminalFontSize: 12,
  autoApproveEdits: false,
  checkpointsEnabled: true,
  onboardingDone: false,
  localOnly: false,
  recentPaths: [],
  mcpServers: [],
  billing: {},
  usageLog: [],
  // v11.4 — additive settings defaults only (editor / terminal / logs /
  // voice / shortcuts groups; main-process storeService mirrors these).
  editor: { wordWrap: 'off', tabSize: 2, minimap: false, fontSize: 13, indentGuides: true },
  terminal: { shell: 'default', scrollback: 1000 },
  logs: { level: 'info' },
  voice: { asrProvider: 'auto', language: 'en-US', autoSend: false, deviceId: '' },
  shortcuts: {},
};

export const PROVIDER_PRESETS: Record<
  ProviderId,
  { label: string; baseUrl: string; protocol: 'anthropic' | 'openai'; keyless?: boolean; models: string[] }
> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    protocol: 'anthropic',
    models: [
      'claude-opus-5.5',
      'claude-sonnet-5.5',
      'claude-haiku-5.5',
      'claude-fable-5.1',
      'claude-opus-5',
      'claude-sonnet-5',
    ],
  },
  openai: {
    label: 'OpenAI (GPT)',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai',
    models: [
      'gpt-6.1-terra',
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-5.3-codex',
      'gpt-5.5',
      'gpt-5.5-mini',
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    models: [
      'anthropic/claude-opus-5.5',
      'openai/gpt-6-astra',
      'openai/gpt-6.1-sol',
      'anthropic/claude-sonnet-5.5',
      'google/gemini-4-argon',
      'qwen/qwen3.8-max',
      'moonshotai/kimi-k3.1-pro',
      'openai/gpt-5.3-codex',
      'z-ai/glm-5.3',
      'minimax/minimax-m3.1-flash',
      'deepseek/deepseek-chat',
      'x-ai/grok-4.7',
    ],
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    protocol: 'openai',
    keyless: true,
    models: ['qwen3-coder', 'deepseek-v4-pro', 'glm-5.2', 'kimi-k3', 'devstral-small-2', 'gpt-oss:20b'],
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'openai',
    models: ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  },
  zai: {
    label: 'Z.ai (GLM)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    protocol: 'openai',
    models: ['glm-5.3', 'glm-5.3-prime', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2'],
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocol: 'openai',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  },
  xai: {
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    protocol: 'openai',
    models: ['grok-4.7', 'grok-4.6', 'grok-build-0.1', 'grok-4.20'],
  },
  moonshot: {
    label: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.ai/v1',
    protocol: 'openai',
    models: ['kimi-k3.1-pro', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'],
  },
  qwen: {
    label: 'Qwen (DashScope)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai',
    models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3-coder-next', 'qwen3-coder-flash'],
  },
  mistral: {
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    protocol: 'openai',
    models: ['mistral-large-4', 'devstral-2512', 'codestral-2508', 'mistral-medium-3-5', 'mistral-small-2603'],
  },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', protocol: 'openai', models: [] },
};

/**
 * v11.12 `/model <name>` — resolve a typed model reference against the SAME
 * catalog the ModelPicker uses (curated presets + each provider's discovered
 * `lastModels`). Accepts `provider/model` (provider id with the longest match
 * wins — `openrouter/…` before `openai/…`) or a bare id/substring. Prefers the
 * currently active provider on ties. Never invents a model that is not known.
 */
function resolveModelRef(
  settings: AppSettings,
  raw: string,
): { provider: ProviderId; model: string } | null {
  const query = String(raw ?? '').trim();
  if (!query) return null;
  const lower = query.toLowerCase();
  const providers = Object.keys(PROVIDER_PRESETS).sort((a, b) => b.length - a.length) as ProviderId[];
  for (const pid of providers) {
    const prefix = `${pid}/`;
    if (lower.startsWith(prefix)) {
      const model = query.slice(prefix.length).trim();
      if (model) return { provider: pid, model };
    }
  }
  const current = settings.model.provider;
  const candidates: { provider: ProviderId; model: string }[] = [];
  const add = (provider: ProviderId, model: string) => {
    const m = String(model ?? '').trim();
    if (m && !candidates.some((c) => c.provider === provider && c.model === m)) {
      candidates.push({ provider, model: m });
    }
  };
  // active provider first, then every configured preset
  for (const m of PROVIDER_PRESETS[current]?.models ?? []) add(current, m);
  for (const m of settings.providers?.[current]?.lastModels ?? []) add(current, m);
  for (const pid of providers) {
    for (const m of PROVIDER_PRESETS[pid].models) add(pid, m);
    for (const m of settings.providers?.[pid]?.lastModels ?? []) add(pid, m);
  }
  const exact = candidates.filter(
    (c) => c.model.toLowerCase() === lower || `${c.provider}/${c.model}`.toLowerCase() === lower,
  );
  const pool = exact.length > 0 ? exact : candidates.filter((c) => c.model.toLowerCase().includes(lower));
  pool.sort((a, b) => Number(b.provider === current) - Number(a.provider === current));
  return pool[0] ?? null;
}

/**
 * v11.22 (A6) — a run payload must NEVER carry a half-written model config.
 * A settings write can land mid-send (e.g. an async `/model` switch) leaving
 * `{ provider }` with no `model` id, which the bridge rejects as
 * "Invalid run parameters (missing messages or model)". This pure helper
 * resolves the best VALID `{ provider, model }` from the settings available at
 * send time:
 *   1. the current selection when it is already well-formed;
 *   2. a configured model on the SAME provider (`lastModels` / preset list);
 *   3. the first ENABLED provider that has at least one model.
 * Returns null only when the user genuinely has no usable model configured —
 * the caller then notifies (one language) and never calls the bridge.
 */
function isValidModelConfig(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false;
  const c = m as Partial<ModelConfig>;
  return (
    !!c.provider &&
    Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, c.provider as string) &&
    typeof c.model === 'string' &&
    c.model.trim() !== ''
  );
}

function resolveRunModel(settings: AppSettings): ModelConfig | null {
  const current = settings?.model as Partial<ModelConfig> | undefined;
  // 1 — already valid (preserve per-model extras: maxTokens / reasoning / …).
  if (current && isValidModelConfig(current)) {
    const c = current as ModelConfig;
    return { ...c, model: c.model.trim() };
  }

  const providers = settings?.providers ?? {};
  const currentProvider =
    current && Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, current.provider as string)
      ? (current.provider as ProviderId)
      : undefined;

  // 2 — same provider, configured model list (honour an explicit disable).
  if (currentProvider && providers[currentProvider]?.enabled !== false) {
    const ids = providerModelIds(providers[currentProvider], PROVIDER_PRESETS[currentProvider].models);
    if (ids.length) return { ...(current ?? {}), provider: currentProvider, model: ids[0] } as ModelConfig;
  }

  // 3 — first enabled provider that actually has a model.
  for (const pid of Object.keys(PROVIDER_PRESETS) as ProviderId[]) {
    const entry = providers[pid];
    if (entry?.enabled === false) continue;
    if (entry?.enabled !== true && !providerHasCredentials(entry, PROVIDER_PRESETS[pid])) continue;
    const ids = providerModelIds(entry, PROVIDER_PRESETS[pid].models);
    if (ids.length) return { provider: pid, model: ids[0] };
  }
  return null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

let persistTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- v3.2 streaming ingest coalescing (rAF batch) ----------
// Per-token set() clones the whole session and re-renders the app. text_delta
// events append to a module-level buffer and ONE requestAnimationFrame flush
// (16ms timeout fallback when rAF is unavailable) joins them into a single
// state update. Structural events (message_end / turn_end / error / aborted /
// tool_start / tool_result / …) synchronously flush the buffer FIRST so
// ordering never drifts.
let pendingDelta = '';
// v11.3 — thinking rides its own renderer buffer: reasoning NEVER lands in
// the answer text, and both channels join into ONE state update per frame.
let pendingThink = '';
let deltaScheduled = false;
let deltaRaf: number | null = null;
let deltaFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let deltaWatchdog: ReturnType<typeof setTimeout> | null = null;
// v11.10 (A5) — chars streamed in the LIVE turn (answer + thinking). Drives
// the context bar's honest chars/4 estimate (marked "≈") until message_end
// replaces it with the provider's exact usage.
let liveStreamChars = 0;
// v11.3 — STEADY CADENCE: flush on a fixed 85ms rhythm instead of every
// rAF frame. Token bursts land as one smooth, evenly-paced reveal — the
// stream reads fluid instead of machine-gun bursts one after another.
const DELTA_CADENCE_MS = 32;

// ---------- v11.23 — per-run ingest lifecycle (terminal guard) ----------
// `turn_end` is the HARD end of a run. Any agent event that crosses the IPC
// boundary after it is a stale duplicate from an older run: ingesting it can
// resurrect streaming bubbles, flip `running`, or paint a second summary card
// ("random errors in chat"). These flags are renderer-only and reset at every
// user turn (sendMessage → resetProofForTurn) and at the synchronous run start.
let runClosed = false;
/** Session object the closing `turn_end` wrote. A different object means a
 *  fresh session was loaded/seeded → a new run, not a stale event. */
let closedSession: SessionData | null = null;
let runFailed = false;
let runAborted = false;
// ── v11.26 (WRITTEN REPORT GUARANTEE + WEB PREVIEW AUTO-OPEN) ──────────
/**
 * THE per-run report ledger. Every terminal path (engine `task_report`,
 * `error`, `aborted`, renderer watchdog, silent `turn_end`) writes into this
 * ONE record and reuses ONE transcript card id. `final` latches when the
 * terminal report is committed: any later non-terminal event from the dead
 * run is dropped instead of reopening a stale row / re-setting `running`.
 */
interface RunReportLedger {
  /** v11.28 — sentinel: a report slice has been published this run (there is
   *  NO transcript card anymore). Used so a silent turn_end can tell whether
   *  an earlier error event already owns the single final report. */
  cardId: string | null;
  /** true once the FINAL terminal report has been published */
  final: boolean;
  /** outcome observed from real terminal events (honest when the report is missing) */
  outcome: 'completed' | 'error' | 'aborted';
  /** single-language summary from an `error` event */
  errorSummary: string;
  /** canonical err.* key from an `error` event (authoritative for re-localization) */
  errorKey: string | null;
  /** agent-loop stop reason observed from message_end (silent-end honesty) */
  stopReason: string;
  /** files actually written this run (workspace paths) */
  files: string[];
  /** commands actually executed this run + their real exit status */
  commands: { cmd: string; ok: boolean }[];
  /** first activity timestamp for an honest duration (no fabricated time) */
  firstAt: number;
  /** v11.28 — ONE terminal-report toast per run. Latched on first emit; every
   *  later terminal path (error → task_report → turn_end → watchdog) is a no-op
   *  here so the founder never gets two report toasts for the same run. */
  toastShown: boolean;
}
function freshRunReport(firstAt = 0): RunReportLedger {
  return {
    cardId: null,
    final: false,
    outcome: 'completed',
    errorSummary: '',
    errorKey: null,
    stopReason: '',
    files: [],
    commands: [],
    firstAt,
    toastShown: false,
  };
}
let runReport: RunReportLedger = freshRunReport();

/** Tool-call → path/command maps: a tool_start is a PROMISE; only its paired
 *  tool_result (ok) is honest evidence of a write / an executed command. */
let rrWriteByCall: Record<string, string> = {};
let rrCmdByCall: Record<string, string> = {};

/** Deferred, store-side web-artifact detection. Published only when the run
 *  settles, so a preview never starts mid-write. */
interface WebPreviewRequest {
  kind: 'static' | 'dev';
  dir?: string;
  runtime?: 'npm' | 'python' | 'custom' | 'go';
  ws: string;
}
let pendingWebPreview: WebPreviewRequest | null = null;
let enginePreviewRequested = false;
/** An explicit user close is authoritative — auto-open never fights it. */
let previewUserClosed = false;

/**
 * EXACT detection rules for "genuinely a web artifact":
 *  • a SUCCESSFUL write/edit tool whose target path ends in
 *    .html / .tsx / .jsx / .vue / .css / .js (case-insensitive, optional ?/#);
 *  • a SUCCESSFUL command tool whose command matches a real build/dev/serve
 *    verb (npm|yarn|pnpm run build|dev|start|serve, vite, next dev|build|start,
 *    webpack, ng serve, python -m http.server, go run, serve).
 * Non-web paths (.py/.go/.md/.json/…) and test/lint/install commands are
 * ignored. `.html` → static preview of its directory; every other web source
 * or a build command → dev preview (runtime inferred from the command).
 */
const RR_WEB_FILE_RE = /\.(html|tsx|jsx|vue|css|js)(?:[?#]|$)/i;
const RR_WRITE_TOOL = /^(?:write_file|edit_file|multi_edit|multi_file_edit|create_file|apply_patch|write_|edit_|notebook_|csv_)/i;
const RR_CMD_TOOL = /^(?:run_command|run_and_show|bash|shell|terminal_)/i;
const RR_BUILD_CMD = /\b(?:npm\s+(?:run\s+)?(?:build|dev|start|serve)|yarn\s+(?:build|dev|start)|pnpm\s+(?:build|dev|start)|vite\b|next\s+(?:dev|build|start)|webpack\b|ng\s+serve|python3?\s+-m\s+http\.server|go\s+run\b|serve\b)/i;
const RR_NON_WEB_CMD = /\b(?:test|lint|install|ci|typecheck|check)\b/i;

/** Read a string arg from untrusted tool args (object or string/array form). */
function rrArgString(args: unknown, keys: string[]): string {
  if (typeof args === 'string') return args.trim();
  if (!args || typeof args !== 'object') return '';
  const o = args as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').join(' ').trim();
  }
  return '';
}

/** Record real file evidence; a web extension also arms a deferred preview. */
function noteReportFile(path: unknown, ws: string): void {
  if (typeof path !== 'string') return;
  const p = path.trim().slice(0, 400);
  if (!p) return;
  if (!runReport.files.includes(p)) runReport.files.push(p);
  if (!RR_WEB_FILE_RE.test(p)) return;
  const ext = (p.toLowerCase().match(/\.(html|tsx|jsx|vue|css|js)(?:[?#]|$)/) ?? [])[1] ?? '';
  if (ext === 'html') {
    const clean = p.replace(/\\/g, '/');
    const slash = clean.lastIndexOf('/');
    pendingWebPreview = { kind: 'static', dir: slash >= 0 ? clean.slice(0, slash) : '', ws };
  } else {
    pendingWebPreview = { kind: 'dev', runtime: 'npm', ws };
  }
}

/** Arm a deferred dev preview for a genuine build/dev/serve command. */
function noteBuildCommand(cmd: unknown, ws: string): void {
  const c = typeof cmd === 'string' ? cmd.trim() : '';
  if (!c) return;
  // A test/lint/install command is NOT a build even if its name contains "run".
  if (RR_NON_WEB_CMD.test(c) && !/\b(?:dev|start|serve|build)\b/i.test(c)) return;
  if (!RR_BUILD_CMD.test(c)) return;
  const runtime: 'npm' | 'python' | 'custom' | 'go' = /python/i.test(c)
    ? 'python'
    : /\bgo\s+run\b/i.test(c)
      ? 'go'
      : 'npm';
  pendingWebPreview = { kind: 'dev', runtime, ws };
}

/** Fold one IPC event into the honest per-run ledger (best-effort, never throws). */
function noteRunEvidence(e: AgentEvent): void {
  try {
    const state = useStore.getState();
    const ws = state.wsPath;
    if (!runReport.firstAt) runReport.firstAt = state.runStartedAt ?? Date.now();
    switch (e.type) {
      case 'tool_start': {
        const name = String((e as { name?: unknown }).name ?? '');
        const id = (e as { toolCallId?: unknown }).toolCallId;
        if (RR_WRITE_TOOL.test(name)) {
          const p = rrArgString((e as { args?: unknown }).args, [
            'path', 'file_path', 'filePath', 'filename', 'file', 'target',
          ]);
          if (p && typeof id === 'string') rrWriteByCall[id] = p.slice(0, 400);
        } else if (RR_CMD_TOOL.test(name)) {
          const c = rrArgString((e as { args?: unknown }).args, ['cmd', 'command', 'cmdline']);
          if (c) {
            runReport.commands.push({ cmd: c.slice(0, 300), ok: false });
            if (typeof id === 'string') rrCmdByCall[id] = c.slice(0, 300);
          }
        }
        break;
      }
      case 'tool_result': {
        const id = (e as { toolCallId?: unknown }).toolCallId;
        if (typeof id !== 'string') break;
        const written = rrWriteByCall[id];
        if (written) {
          delete rrWriteByCall[id];
          if (e.ok === true) noteReportFile(written, ws);
        }
        const cmd = rrCmdByCall[id];
        if (cmd) {
          delete rrCmdByCall[id];
          for (let i = runReport.commands.length - 1; i >= 0; i--) {
            if (runReport.commands[i].cmd === cmd) {
              runReport.commands[i] = { ...runReport.commands[i], ok: e.ok === true };
              break;
            }
          }
          if (e.ok === true) noteBuildCommand(cmd, ws);
        }
        break;
      }
      case 'run_receipt': {
        const files = Array.isArray((e as { files?: unknown }).files) ? (e as { files: unknown[] }).files : [];
        for (const f of files) if (typeof f === 'string') noteReportFile(f, ws);
        for (const c of asCommandArray((e as { commands?: unknown }).commands)) {
          if (!c.cmd) continue;
          if (!runReport.commands.some((x) => x.cmd === c.cmd)) {
            runReport.commands.push({ cmd: c.cmd.slice(0, 300), ok: c.ok });
          }
          if (c.ok) noteBuildCommand(c.cmd, ws);
        }
        break;
      }
      case 'verify_run': {
        const c = typeof (e as { cmd?: unknown }).cmd === 'string' ? String((e as { cmd: unknown }).cmd) : '';
        if (c) {
          if (!runReport.commands.some((x) => x.cmd === c)) {
            runReport.commands.push({ cmd: c.slice(0, 300), ok: (e as { exitCode?: unknown }).exitCode === 0 });
          }
          if ((e as { exitCode?: unknown }).exitCode === 0) noteBuildCommand(c, ws);
        }
        break;
      }
      case 'message_end': {
        const sr = (e as { stopReason?: unknown }).stopReason;
        if (typeof sr === 'string') runReport.stopReason = sr;
        break;
      }
      case 'error': {
        const raw = typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '';
        const ar = state.settings.language === 'ar';
        const code = typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : undefined;
        runReport.errorSummary = noCreditsToast(raw, ar) ?? localizeRunError(raw, ar, code);
        runReport.errorKey = runErrorKey(raw, code);
        runReport.outcome = 'error';
        break;
      }
      case 'aborted':
        runReport.outcome = 'aborted';
        break;
      case 'task_report': {
        const o = (e as { outcome?: unknown }).outcome;
        runReport.outcome = o === 'aborted' ? 'aborted' : o === 'error' ? 'error' : 'completed';
        break;
      }
      case 'preview_open':
        // The engine already requested a preview — never double-open locally.
        enginePreviewRequested = true;
        break;
      default:
        break;
    }
  } catch {
    /* evidence is best-effort; never stall the run over a malformed payload */
  }
}

/** Build an HONEST local report from events actually seen (no invention). */
function rrSynthesize(
  outcome: TaskReportSlice['outcome'],
  ar: boolean,
  override?: { summary?: string; stopReason?: string },
): TaskReportSlice {
  const t = makeT(ar ? 'ar' : 'en');
  const summary =
    override?.summary ??
    (outcome === 'error'
      ? runReport.errorSummary || t('chat.report.error')
      : outcome === 'aborted'
        ? t('chat.report.aborted')
        : t('chat.report.done'));
  const nextSteps =
    outcome === 'error' ? [summary]
      : outcome === 'aborted' ? [t('chat.continue.error')]
        : [];
  const stopReason = override?.stopReason ?? runReport.stopReason ?? '';
  return {
    outcome,
    summary,
    files: [...runReport.files],
    commands: runReport.commands.map((c) => ({ ...c })),
    nextSteps,
    partial: outcome !== 'completed',
    ...(stopReason ? { stopReason } : {}),
    durationMs: runReport.firstAt ? Math.max(0, Date.now() - runReport.firstAt) : 0,
    at: Date.now(),
  };
}

/**
 * v11.28 — THE WRITTEN REPORT IS A TOAST, NOT A TRANSCRIPT CARD.
 * The founder wants no report card in chat but does want a written report when
 * the run stops. The full slice stays in `lastTaskReport` (programmatic use,
 * e.g. /report); the user gets ONE concise, honest, localized toast at the
 * terminal edge: real outcome + summary + real file/command/duration counts.
 * No raw JSON, no provider dumps, exactly one language, one toast per run.
 */
function rrToastSummary(report: TaskReportSlice, ar: boolean, t: ReturnType<typeof makeT>): string {
  let s = String(report.summary ?? '').trim();
  // Raw JSON / bridge dumps are never a human summary.
  if (!s || /^\s*[{[]/.test(s) || /["']\s*(?:message|error|code)\s*["']\s*:/i.test(s)) s = '';
  // Synthesized reports reuse the chat.report.* card copy ("… — summary
  // below"); keep only its first clause so a toast never promises a summary
  // that lives underneath it.
  const firstClause = (v: string) => v.split(/[—–]/)[0].trim();
  if (s === t('chat.report.done') || s === t('chat.report.error') || s === t('chat.report.aborted')) {
    s = firstClause(s);
  }
  if (s) {
    const arabic = ARABIC_SCRIPT_RE.test(s);
    const latin = hasLatinProse(s);
    const wrong = ar ? (!arabic && latin) : arabic;
    if (!wrong) return s.slice(0, 200);
  }
  return report.outcome === 'completed'
    ? firstClause(t('chat.report.done'))
    : report.outcome === 'aborted'
      ? firstClause(t('chat.report.aborted'))
      : t('err.run.providerUnavailable');
}

/** Emit the single terminal-report toast. Deduped per run via `runReport`. */
function rrEmitReportToast(report: TaskReportSlice | null, ar: boolean): void {
  if (!report || runReport.toastShown) return;
  runReport.toastShown = true;
  const t = makeT(ar ? 'ar' : 'en');
  const firstClause = (v: string) => v.split(/[—–]/)[0].trim();
  const outcome =
    report.outcome === 'completed'
      ? firstClause(t('chat.report.done'))
      : report.outcome === 'aborted'
        ? firstClause(t('chat.report.aborted'))
        : firstClause(t('chat.report.error'));
  const summary = rrToastSummary(report, ar, t);
  const files = Array.isArray(report.files) ? report.files.length : 0;
  const cmds: { cmd: string; ok: boolean }[] = Array.isArray(report.commands) ? report.commands : [];
  const failed = cmds.filter((c) => !!c && c.ok === false).length;
  const ms = Math.max(0, Math.floor(report.durationMs || 0));
  const dur = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  const counts = ar
    ? `${files} ملفات · ${cmds.length} أوامر${failed ? ` (${failed} فاشلة)` : ''} · ${dur}`
    : `${files} files · ${cmds.length} commands${failed ? ` (${failed} failed)` : ''} · ${dur}`;
  const title = `${outcome}: ${summary} · ${counts}`;
  const severity = report.outcome === 'completed' ? 'success' : report.outcome === 'aborted' ? 'warn' : 'error';
  try {
    pushToast({ title, severity, duration: severity === 'error' ? 7000 : 6000 });
  } catch {
    /* toast stack may be unavailable in a headless/test host */
  }
  // Mirror for programmatic / headless inspection — the real surface is pushToast.
  const seq = (useStore.getState().lastReportToast?.seq ?? 0) + 1;
  useStore.setState({ lastReportToast: { title, severity, seq } });
}

/** Publish the report slice; a FINAL commit latches the run and emits its one
 *  toast. A provisional (final=false) commit only refreshes `lastTaskReport`. */
function rrPublish(report: TaskReportSlice, ar: boolean, final: boolean): void {
  if (!runReport.cardId) runReport.cardId = 'report'; // sentinel — no transcript row
  if (final) runReport.final = true;
  useStore.setState({ lastTaskReport: report });
  if (final) rrEmitReportToast(report, ar);
}

/** Kept by name/signature for the ingest call sites (and source-level locks);
 *  it no longer pushes a transcript row — it publishes the report toast. */
function rrCommitInto(
  msgs: ChatMessage[],
  report: TaskReportSlice,
  final: boolean,
  continueReason?: 'error' | 'truncated',
): void {
  rrPublish(report, useStore.getState().settings.language === 'ar', final);
  if (continueReason) {
    const task = lastUserTask(msgs);
    if (task) useStore.setState({ continueHint: { task, reason: continueReason } });
  }
}

/** Settle a deferred web preview AFTER the run, using the existing actions.
 *  start*Preview set previewOpen:true + the real URL/target and already show
 *  the localized error card when the server cannot start. */
function rrFlushAutoPreview(): void {
  const hint = pendingWebPreview;
  pendingWebPreview = null;
  if (!hint || enginePreviewRequested || previewUserClosed) return;
  const s = useStore.getState();
  if (hint.ws && s.wsPath && hint.ws !== s.wsPath) return;
  if (hint.kind === 'static') {
    const clean = (hint.dir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const absolute = /^[A-Za-z]:[\\/]/.test(clean) || clean.startsWith('/');
    void s.startStaticPreview(clean ? (absolute ? clean : wsJoin(s.wsPath, clean)) : s.wsPath);
  } else {
    void s.startDevPreview(hint.runtime ?? 'npm');
  }
}

// ---------- v12 (RECOVERY): renderer-side run watchdog ----------
// The engine's own watchdogs live in the main process and recover from stream
// stalls, but a lost terminal event or a main-process crash leaves the UI
// stuck with `running:true` and no answer. These timers make that state
// visible ("stalled" → "recovering") and, after a hard timeout, force the run
// closed with an HONEST partial report so the user can retry immediately.
// Engine retry/backoff + failover legitimately runs for a while, so the hard
// cutoff is generous (6 min) while the visible stall hint appears at 20 s.
const RESUME_MARKER_KEY = 'sadeem.active-run-v12';

function writeResumeMarker(m: { task: string; sessionId: string; workspace: string }): void {
  try {
    localStorage.setItem(RESUME_MARKER_KEY, JSON.stringify({ ...m, at: Date.now() }));
  } catch { /* storage may be full/disabled */ }
}
function clearResumeMarker(): void {
  try { localStorage.removeItem(RESUME_MARKER_KEY); } catch { /* ignore */ }
}
function readResumeMarker(): AppState['resumableRun'] {
  try {
    const raw = localStorage.getItem(RESUME_MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as NonNullable<AppState['resumableRun']>;
    if (!m?.task || !m.at) return null;
    // Only offer a resume when the run was in flight for a meaningful time
    // (avoids offering it right after a normal, fast send).
    return Date.now() - m.at > 8000 ? m : null;
  } catch { return null; }
}

const RUN_STALL_MS = 20_000;
// v12 — the engine now emits heartbeats through compaction/retries and the
// approval timeout is 45 s, so 6 minutes of true silence means the main
// process is really gone. 10 minutes avoids any false "disconnected" report.
const RUN_HARD_TIMEOUT_MS = 10 * 60_000;
let lastAgentActivityAt = 0;
let runWatchdog: ReturnType<typeof setInterval> | null = null;

function stopRunWatchdog(): void {
  if (runWatchdog) {
    clearInterval(runWatchdog);
    runWatchdog = null;
  }
}

/** v11.26 — a hard timeout is a terminal path TOO: it must leave exactly one
 *  honest written report (and clear `running`), not just a bare slice. */
function rrCommitWatchdog(quietMs: number): void {
  if (runReport.final) return;
  const s = useStore.getState();
  const ar = s.settings.language === 'ar';
  const t = makeT(ar ? 'ar' : 'en');
  const report = rrSynthesize('aborted', ar, {
    summary: t('err.run.providerUnavailable'),
    stopReason: 'renderer_watchdog',
  });
  let session = s.session;
  if (session) {
    const msgs = [...session.messages].map((m) => (m.streaming ? { ...m, streaming: false } : m));
    rrCommitInto(msgs, report, true, 'error');
    session = { ...session, messages: msgs };
  } else {
    runReport.final = true;
    useStore.setState({ lastTaskReport: report });
  }
  stopRunWatchdog();
  clearResumeMarker();
  useStore.setState({
    ...(session ? { session } : {}),
    running: false,
    runRecovery: null,
    ...clearedRunActivity(),
    // Keep the watchdog's honest elapsed silence in the report detail.
    lastTaskReport: { ...report, durationMs: Math.max(report.durationMs, quietMs) },
  });
  void useStore.getState().persistSession();
  rrFlushAutoPreview();
}

/** Called on every agent event — proves the run is alive. */
function noteAgentActivity(): void {
  lastAgentActivityAt = Date.now();
  const s = useStore.getState();
  if (s.runRecovery) useStore.setState({ runRecovery: null });
}

/**
 * Start (or restart) the watchdog for a new run. idempotent.
 * NOTE: defined as a function so it can reference `useStore` at call time.
 */
function startRunWatchdog(): void {
  stopRunWatchdog();
  lastAgentActivityAt = Date.now();
  runWatchdog = setInterval(() => {
    const s = useStore.getState();
    if (!s.running) {
      stopRunWatchdog();
      return;
    }
    const quiet = Date.now() - lastAgentActivityAt;
    if (quiet > RUN_HARD_TIMEOUT_MS) {
      // v11.26 — synthesize ONE honest report card + clear `running`. The old
      // code only wrote the slice, leaving the founder with no written report.
      rrCommitWatchdog(quiet);
      return;
    }
    if (quiet > RUN_STALL_MS) {
      const phase = quiet > RUN_STALL_MS * 2 ? 'recovering' : 'stalled';
      if (s.runRecovery?.phase !== phase) useStore.setState({ runRecovery: { since: lastAgentActivityAt, phase } });
    }
  }, 2000);
  try {
    runWatchdog.unref?.();
  } catch {
    /* timers without unref are fine */
  }
}

// v11.9 S1 — id of the assistant row currently rendering as LIVE (the delta
// walk-back target). Structural events (message_end / turn_end / …) clear
// streaming by this id first (one findIndex) and fall back to a full
// transcript walk when the id is unknown — a steer/queued row can sit BELOW
// the streaming bubble and the old last-row-only check missed it, leaving
// the blinking cursor forever.
let streamingMsgId: string | null = null;

/** Walk-back append for streamed text: a steer/queued synthetic user row may
 *  sit between the still-streaming assistant message and the next delta —
 *  append to the most recent streaming assistant instead of splitting the
 *  answer into a new bubble. Only when NO assistant is streaming does a new
 *  assistant message get created. */
function appendDeltaToMessages(msgs: ChatMessage[], text: string): void {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant') {
      if (m.kind === 'text' && m.streaming) {
        msgs[i] = { ...m, content: m.content + text };
        return;
      }
      // v12 (CONTINUITY) — meta assistant rows (sys_notice / compaction) must
      // NOT split a live answer. Walk straight through them to the real
      // streaming bubble underneath — this is what caused "the answer broke
      // into pieces with blinking cursors" right after compaction.
      if (m.kind === 'notice' || m.model === 'compaction' || m.model === 'sys') continue;
      break; // finished assistant row → the next delta starts a new bubble
    }
    if (m.role === 'user' && (m.model === 'steer' || m.model === 'queued')) continue; // walk through
    break; // tool rows / anything else → new bubble
  }
  const id = uid();
  msgs.push({
    id,
    role: 'assistant',
    kind: 'text',
    content: text,
    timestamp: Date.now(),
    streaming: true,
    model: `${useStore.getState().settings.model.provider}/${useStore.getState().settings.model.model}`,
  });
  streamingMsgId = id; // v11.9 S1 — structural events clear by this id
}

/** v11.3 — walk-back append for THINKING: lands in the dedicated thinking
 *  field of the streaming assistant (creates the bubble lazily, mirroring
 *  the text walk-back so steer rows never split the reasoning). */
function appendThinkToMessages(msgs: ChatMessage[], text: string): void {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant') {
      if (m.kind === 'text' && m.streaming) {
        msgs[i] = { ...m, thinking: (m.thinking ?? '') + text };
        return;
      }
      break;
    }
    if (m.role === 'user' && (m.model === 'steer' || m.model === 'queued')) continue;
    break;
  }
  const id = uid();
  msgs.push({
    id,
    role: 'assistant',
    kind: 'text',
    content: '',
    thinking: text,
    timestamp: Date.now(),
    streaming: true,
    model: `${useStore.getState().settings.model.provider}/${useStore.getState().settings.model.model}`,
  });
  streamingMsgId = id; // v11.9 S1 — structural events clear by this id
}

/** v11.9 S4 — Claude Code steer semantics: a steer/queued transcript row
 *  CLOSES the streaming assistant bubble at insert time, so the next delta
 *  opens a NEW assistant row below the steer (old answer stays, new answer
 *  follows the new instruction). The tracked streaming id is intentionally
 *  kept — a trailing message_end for the closed bubble must still attach
 *  usage/thinkMs to the right row. */
function closeStreamingAssistant(msgs: ChatMessage[]): void {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant') {
      if (m.kind === 'text' && m.streaming) msgs[i] = { ...m, streaming: false };
      return;
    }
    if (m.role === 'user' && (m.model === 'steer' || m.model === 'queued')) continue; // walk through
    return; // tool rows / anything else → nothing live to close
  }
}

/** v11.9 S1 — clear streaming:true on the live assistant row(s). Fast path:
 *  one findIndex by the tracked streaming id; when the id is unknown/misses
 *  (steer splits, reloads, …), walk the whole transcript. Returns true when
 *  at least one row was cleared. */
function clearStreamingRows(msgs: ChatMessage[]): boolean {
  let cleared = false;
  if (streamingMsgId != null) {
    const i = msgs.findIndex((m) => m.id === streamingMsgId && m.streaming);
    if (i >= 0) {
      msgs[i] = { ...msgs[i], streaming: false };
      cleared = true;
    }
  }
  if (!cleared) {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].streaming) {
        msgs[i] = { ...msgs[i], streaming: false };
        cleared = true;
      }
    }
  }
  streamingMsgId = null;
  return cleared;
}

/** v11.9 S6 (cross-team) — GOAL_COMPLETE is an engine-internal completion
 *  marker; it must never leak into the transcript. Strip marker lines
 *  (^[ \t]*GOAL_COMPLETE…) and the trailing blank lines they leave behind.
 *  (The engine strips its own copy; this owns the renderer copy.) */
function stripGoalComplete(text: string): string {
  if (!/^[ \t]*GOAL_COMPLETE\b/m.test(text)) return text;
  return text.replace(/^[ \t]*GOAL_COMPLETE\b.*$/gm, '').replace(/\s+$/, '');
}

/** ONE state update joining all pending text AND reasoning (idempotent). */
function flushPendingDelta(): void {
  if (deltaRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(deltaRaf);
    deltaRaf = null;
  }
  if (deltaFallbackTimer) {
    clearTimeout(deltaFallbackTimer);
    deltaFallbackTimer = null;
  }
  if (deltaWatchdog) {
    clearTimeout(deltaWatchdog);
    deltaWatchdog = null;
  }
  deltaScheduled = false;
  const text = pendingDelta;
  const think = pendingThink;
  pendingDelta = '';
  pendingThink = '';
  if (!text && !think) {
    // v11.10 (A5) — keep the live ≈ estimate fresh even between burst gaps.
    if (liveStreamChars > 0 && useStore.getState().liveStreamChars !== liveStreamChars) {
      useStore.setState({ liveStreamChars });
    }
    return;
  }
  const session = useStore.getState().session;
  if (!session) return;
  const msgs = [...session.messages];
  if (think) appendThinkToMessages(msgs, think);
  if (text) appendDeltaToMessages(msgs, text);
  useStore.setState({ session: { ...session, messages: msgs }, liveStreamChars });
}

/** Schedule a single steady-cadence flush (100ms watchdog keeps the stream
 *  alive when timers are throttled on a hidden window). */
function scheduleDeltaFlush(): void {
  if (deltaScheduled) return;
  deltaScheduled = true;
  if (typeof requestAnimationFrame === 'function') {
    deltaRaf = requestAnimationFrame(() => {
      deltaRaf = null;
      flushPendingDelta();
    });
    deltaWatchdog = setTimeout(() => {
      deltaWatchdog = null;
      if (deltaScheduled) flushPendingDelta();
    }, DELTA_CADENCE_MS);
  } else {
    deltaFallbackTimer = setTimeout(() => {
      deltaFallbackTimer = null;
      flushPendingDelta();
    }, DELTA_CADENCE_MS);
  }
}

// ---------- v3.2 usageLog persist batching ----------
// message_end used to write settings.json every turn (updateSettings → disk).
// usageLog now stays in memory: persisted at most every 10s AND synchronously
// flushed on turn_end / error / aborted.
const USAGE_PERSIST_MS = 10_000;
let usagePersistTimer: ReturnType<typeof setTimeout> | null = null;
let usageDirty = false;

function scheduleUsagePersist(): void {
  usageDirty = true;
  if (usagePersistTimer) return;
  usagePersistTimer = setTimeout(() => {
    usagePersistTimer = null;
    flushUsageLog();
  }, USAGE_PERSIST_MS);
}

/** Synchronous (fire-and-forget) disk flush of a dirty usageLog. */
function flushUsageLog(): void {
  if (usagePersistTimer) {
    clearTimeout(usagePersistTimer);
    usagePersistTimer = null;
  }
  if (!usageDirty) return;
  usageDirty = false;
  try {
    void api.saveSettings(useStore.getState().settings);
  } catch {
    /* best-effort */
  }
}

// ---------- chat width (single source — ChatPanel reads the store) ----------
const CHAT_WIDTH_KEY = 'surnia.chatWidth';
export const CHAT_MIN = 320;
export const CHAT_MAX = 720;
export const CHAT_DEFAULT = 400;

function readChatWidth(): number {
  try {
    const n = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    if (Number.isFinite(n) && n > 0) return Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(n)));
  } catch {
    /* storage unavailable */
  }
  return CHAT_DEFAULT;
}

// ---------- dna reload coalescing ('updated'/'refined' bursts) ----------
let dnaReloadTimer: ReturnType<typeof setTimeout> | null = null;
let dnaLastLoad = 0;

// ── v11.15 — PER-TURN proof evidence (the visibility gate) ─────────
// The old proof slice was RUN-WIDE: once any gate landed in a session, every
// later plain "salam" answer kept showing a STALE proof strip (the founder's
// exact complaint). We now track ONLY the current turn's real tool work.
// No event → no evidence → ProofRibbon renders nothing. Nothing here is
// fabricated: every flag is set by an actual tool_start / proof event.
interface TurnProofEvidence {
  files: number;
  commands: number;
  tests: number;
  receipt: boolean;
}
const emptyTurnEvidence = (): TurnProofEvidence => ({ files: 0, commands: 0, tests: 0, receipt: false });
let turnEvidence: TurnProofEvidence = emptyTurnEvidence();

// Tool names that constitute REAL work. Read-only tools (read_file, search,
// list_dir, …) are intentionally absent — inspecting code is not proof.
const PR_WRITE_TOOL = /^(?:write_file|edit_file|multi_edit|multi_file_edit|create_file|make_document|apply_patch|write_|edit_|notebook_|csv_)/i;
const PR_TEST_TOOL = /^(?:test_run|lint_check|verify_|coverage_|test_|lint_)/i;
const PR_CMD_TOOL = /^(?:run_command|run_and_show|bash|shell|terminal_)/i;

function noteProofToolName(name: unknown): void {
  if (typeof name !== 'string') return;
  let changed = false;
  if (PR_WRITE_TOOL.test(name)) { turnEvidence.files++; changed = true; }
  if (PR_TEST_TOOL.test(name)) { turnEvidence.tests++; changed = true; }
  if (PR_CMD_TOOL.test(name)) { turnEvidence.commands++; changed = true; }
  if (changed) syncProofVisible();
}

/** Recompute the single bit the ribbon reads. BOTH halves must hold:
 *  (a) THIS turn did real work (a write / command / test / receipt), AND
 *  (b) at least one REAL gate verdict was recorded for this turn.
 *  A tool_start alone is a promise, not proof — it must never paint an empty
 *  "PROOF" strip. Requiring a gate also blocks a late event from a previous
 *  run (work flags and gates are both cleared at every turn boundary). */
function syncProofVisible(): void {
  const ev = turnEvidence;
  const hasWork = ev.files > 0 || ev.commands > 0 || ev.tests > 0 || ev.receipt;
  const hasGates = useStore.getState().proof.gates.length > 0;
  const visible = hasWork && hasGates;
  if (useStore.getState().proofVisible !== visible) {
    useStore.setState({ proofVisible: visible });
  }
}

// ── v7.2 — Proof Ribbon ingest ──────────────────────────────────────
// Folds the v6/v7.1 proof & verdict events into the run-wide proof state:
// gray (unproven) → green (proven) → red (failed). Detail strings come
// VERBATIM from the event payloads — the ribbon never invents data.
const upsertGate = (gates: ProofGate[], g: ProofGate): ProofGate[] => {
  const i = gates.findIndex((x) => x.id === g.id);
  if (i >= 0) {
    const next = [...gates];
    next[i] = g;
    return next;
  }
  return [...gates, g];
};

function ingestProofEvent(e: AgentEvent): void {
  // v11.15 — the earliest honest sign of work is the tool call itself.
  if (e.type === 'tool_start') noteProofToolName(e.name);
  else if (e.type === 'tool_result' && e.meta && typeof e.meta === 'object') {
    noteProofToolName((e.meta as Record<string, unknown>).toolName);
  }
  let patch: Partial<ProofState> | null = null;
  switch (e.type) {
    case 'verify_run':
      // A real command actually executed and produced a test result.
      turnEvidence.commands++;
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: 'verify',
          tone: e.exitCode === 0 ? 'ok' : 'bad',
          detail: safeDetail(e.cmd, 'command') + ` — exit ${safeDetail(e.exitCode, '?')}`,
          at: Date.now(),
        }),
      };
      break;
    case 'red_green':
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: 'redGreen',
          tone: e.compliant ? 'ok' : 'bad',
          detail: safeDetail(e.reason),
          at: Date.now(),
        }),
      };
      break;
    case 'fake_tests':
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: 'fakes',
          tone: e.high > 0 ? 'bad' : 'ok',
          detail: safeDetail(e.summary) || `${e.high} high-severity findings of ${e.scanned} scanned`,
          at: Date.now(),
        }),
      };
      break;
    case 'mutation_gate':
      turnEvidence.tests++;
      patch = {
        mutation: {
          verdict: e.verdict as ProofMutationVerdict,
          ran: e.ran,
          killed: e.killed,
          inconclusive: e.inconclusive === true,
        },
        gates: upsertGate(useStore.getState().proof.gates, {
          id: 'mutation',
          // 'killed-enough' / 'no-mutations' pass; survivors/weak = partial;
          // baseline-failed = bad; skipped stays unproven (no gate recorded).
          // The ribbon re-derives the HONEST v8.1 tone from `mutation` above;
          // this rollup tone only feeds proofTone()/status.
          tone:
            e.verdict === 'killed-enough' || e.verdict === 'no-mutations'
              ? 'ok'
              : e.verdict === 'survivors'
                ? 'bad'
                : 'warn',
          detail: safeDetail(e.detail) || safeDetail(e.verdict),
          at: Date.now(),
        }),
      };
      break;
    case 'critic_verdict':
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: 'critic',
          tone: e.critical > 0 ? 'bad' : e.findings > 0 ? 'warn' : 'ok',
          detail: safeDetail(e.summary) || `${e.findings} findings · ${e.critical} critical`,
          at: Date.now(),
        }),
      };
      break;
    case 'run_receipt': {
      // v11.14 — ingestProofEvent runs for EVERY event BEFORE the main switch;
      // a receipt with missing arrays must not throw here or the whole event
      // (including the transcript update) is lost.
      const files = Array.isArray(e.files) ? e.files : [];
      const commands = Array.isArray(e.commands) ? e.commands : [];
      // v11.15 — a receipt is emitted by the engine ONLY for runs that wrote
      // files or ran commands: it is direct, honest evidence of work.
      // HARDENING: untrusted IPC may send commands:[null] — never read .ok on
      // a null/primitive element (fuzz #250: "thinking stops" symptom family).
      // v11.21 (G11 honesty fix): the engine emits `files` as PATH STRINGS
      // (run_receipt in engine.ts), while older/foreign senders may use objects.
      // Filtering to objects-only made every receipt print "0 files" even after
      // real writes — a false claim in the ledger. Accept both shapes.
      const safeFiles = Array.isArray(files)
        ? files.filter((f) => typeof f === 'string' || (!!f && typeof f === 'object'))
        : [];
      const safeCommands = Array.isArray(commands) ? commands.filter((c): c is NonNullable<typeof c> => !!c && typeof c === 'object') : [];
      turnEvidence.receipt = true;
      turnEvidence.files += safeFiles.length;
      turnEvidence.commands += safeCommands.length;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: 'receipt',
          tone: e.verifyFailed ? 'bad' : 'ok',
          detail: `${safeFiles.length} files · ${safeCommands.filter((c) => (c as { ok?: boolean }).ok === true).length}/${safeCommands.length} commands ok · ${e.rounds} rounds`,
          at: Date.now(),
        }),
      };
      break;
    }
    case 'proof_package':
      // The signed package verdict is authoritative for ribbon color:
      // proven → green, partial/unproven/aborted → gray, failed → red.
      patch = {
        status:
          e.verdict === 'proven' ? 'proven' : e.verdict === 'failed' ? 'failed' : 'unproven',
        updatedAt: Date.now(),
      };
      break;
    case 'error':
      // v11.23 — a hard error ALWAYS fails the run's proof, even when no gate
      // landed (e.g. a 402 before any tool ran). The old "only if gates exist"
      // guard could leave a green `proof_package` verdict standing on a failed
      // run — a false "proven" claim.
      runFailed = true;
      patch = { status: 'failed', updatedAt: Date.now() };
      break;
    case 'aborted':
      // An aborted run is UNPROVEN, never proven — the user stopped it.
      runAborted = true;
      patch = { status: 'unproven', updatedAt: Date.now() };
      break;
    case 'task_report':
      // A terminal report is authoritative even if its error/abort event was
      // lost at the IPC boundary. Never let a report say "error" while the
      // ribbon still advertises green.
      if (e.outcome === 'error') {
        runFailed = true;
        patch = { status: 'failed', updatedAt: Date.now() };
      } else if (e.outcome === 'aborted') {
        runAborted = true;
        patch = { status: 'unproven', updatedAt: Date.now() };
      }
      break;
    case 'turn_end': {
      // Run finished: roll up the recorded gates into a status when the
      // proof package alone didn't set one. Any bad gate → failed; any
      // partial → unproven (honest: unproven, not proven); all-ok → proven.
      // A terminal failure/abort OUTRANKS the gate rollup — green gates from
      // a run that crashed at the end must never read "proven".
      const p = useStore.getState().proof;
      if (runFailed) {
        patch = { status: 'failed', updatedAt: Date.now() };
      } else if (runAborted) {
        patch = { status: 'unproven', updatedAt: Date.now() };
      } else if (p.gates.length > 0) {
        const bad = p.gates.some((g) => g.tone === 'bad');
        const warn = p.gates.some((g) => g.tone === 'warn');
        patch = { status: bad ? 'failed' : warn ? 'unproven' : 'proven', updatedAt: Date.now() };
      }
      break;
    }
    default:
      break;
  }
  // v11.15 — recompute visibility for EVERY event (including tool_start,
  // which writes no gate patch but IS real evidence).
  syncProofVisible();
  if (!patch) return;
  const cur = useStore.getState().proof;
  useStore.setState({ proof: { ...cur, ...patch, updatedAt: patch.updatedAt ?? Date.now() } });
  syncProofVisible();
}
// ── end Proof Ribbon ingest ─────────────────────────────────────────

/**
 * v11.23 — build ONE honest, normalized terminal report from an untrusted
 * `task_report` payload. Known error classes are re-localized into the
 * SELECTED language (no raw EN JSON, no EN+AR mix); arrays are coerced so the
 * card renderer can never crash on a malformed IPC shape.
 */
type TaskReportEvent = Extract<AgentEvent, { type: 'task_report' }>;
function reportSliceFromEvent(e: TaskReportEvent, ar: boolean, errorKeyOverride?: string): TaskReportSlice {
  const outcome: TaskReportSlice['outcome'] =
    e.outcome === 'completed' ? 'completed' : e.outcome === 'aborted' ? 'aborted' : 'error';
  const summary =
    outcome === 'completed'
      ? safeDetail(e.summary)
      : localizeRunError(e.summary, ar, errorKeyOverride ?? (e as { code?: string }).code);
  let nextSteps = asStringArray(e.nextSteps);
  // An error report whose next steps arrive in the wrong language would put
  // EN+AR side by side in one card. Replace them with the canonical,
  // monolingual message (which already carries the exact next step).
  const wrongLanguage = ar
    ? nextSteps.some((s) => !ARABIC_SCRIPT_RE.test(s) && hasLatinProse(s))
    : nextSteps.some((s) => ARABIC_SCRIPT_RE.test(s));
  if (outcome === 'error' && wrongLanguage) nextSteps = [summary];
  return {
    outcome,
    summary,
    files: asStringArray(e.files),
    commands: asCommandArray(e.commands),
    ...(typeof e.howToRun === 'string' && e.howToRun.trim() ? { howToRun: e.howToRun.slice(0, 500) } : {}),
    nextSteps,
    ...(Array.isArray(e.toolsUsed) ? { toolsUsed: e.toolsUsed.filter((t) => !!t && typeof t === 'object') } : {}),
    ...(Array.isArray(e.notDone) ? { notDone: asStringArray(e.notDone) } : {}),
    ...(e.usage && typeof e.usage === 'object' ? { usage: e.usage } : {}),
    ...(typeof e.partial === 'boolean' ? { partial: e.partial } : {}),
    ...(typeof e.taskMode === 'string' ? { taskMode: e.taskMode } : {}),
    ...(typeof e.stopReason === 'string' ? { stopReason: e.stopReason } : {}),
    durationMs: asFiniteMs(e.durationMs),
    at: Date.now(),
  };
}

export const useStore = create<AppState>()((set, get) => ({
  booted: false,
  settings: DEFAULT_SETTINGS,
  license: { plan: 'free', mode: 'local' },

  wsPath: '',
  fileTree: null,
  treeLoading: false,

  tabs: [],
  activeTab: null,

  session: null,
  sessions: [],
  running: false,
  // v11.20 (A1) — no immediate activity until the user actually sends.
  runStartedAt: null,
  runActivity: null,
  runPhase: null,
  runRecovery: null,
  resumableRun: null,
  todos: [],
  pendingApproval: null,
  planProposal: null,
  sessionUsage: emptySessionUsage() as AppState['sessionUsage'],
  lastTurnUsage: null,
  activeGoal: null,
  queuedCount: 0,
  taskMode: 'build',
  steerPending: false,
  queuedItems: [],
  subagentProgress: {},
  lastReview: null,
  skills: [],
  skillsOpen: false,
  ctxWindow: 0,
  ctxWindowEstimated: false,
  liveStreamChars: 0,
  // v7.1 — Proven Change: published honesty metric + verification budget chip.
  falseDoneStats: null as null | { claimed: number; falseDone: number; rate: number },
  verificationBudgetLabel: '' as string,
  // v11.11 (A4-CLOSURE) — the guaranteed completion report (reset per run).
  lastTaskReport: null as TaskReportSlice | null,
  // v11.28 — the one written-report toast for the last settled run.
  lastReportToast: null,
  // v11.12 CHAT CAPABILITIES — nothing to continue until a turn ends early.
  continueHint: null,

  dna: null,
  dnaStats: null,
  dnaSuggestion: null,
  dnaLoading: false,
  skillsTrustNeeded: false,

  // v11.12 — Living Playbook + Subagent dashboard
  playbook: null,
  playbookHistory: [],
  playbookLoading: false,
  lastPlaybookLearning: null,
  subagents: [],
  subagentsLoading: false,
  subagentDetailId: null,
  subagentSteps: {},
  subagentToolCalls: {},
  flowSuggest: null,
  artifactComments: [],
  chatWidth: readChatWidth(),
  scheduledJobs: [],
  scheduledOpen: false,
  commitSuggestion: null,

  terminalId: null,
  terminalOpen: false,
  termHeight: 240,

  git: null,

  searchResults: null,
  searching: false,

  previewOpen: false,
  previewUrl: '',
  previewSource: '',
  previewError: null,
  previewStatus: null,
  previewWs: '',
  previewAuto: null,

  rail: 'workspace',
  sidebarOpen: true,
  chatOpen: true,
  paletteOpen: false,
  modelPickerOpen: false,
  settingsOpen: false,
  settingsSection: 'general',
  plansOpen: false,
  shortcutsOpen: false,
  onboardingOpen: false,
  diffView: null,
  capabilityPanel: null,
  rewindPicker: null,
  notice: null,

  account: null,
  webAuthPending: null,
  authChecked: false,
  newProjectOpen: false,
  cloneOpen: false,
  composerInsert: null,

  // v7.2 — focus mode (localStorage-persisted) + empty proof state
  focusMode: readFocusMode(),
  proof: EMPTY_PROOF,
  // v11.15 — hidden until THIS turn produces real, tool-backed evidence.
  proofVisible: false,
  // Run-wide gate tone for the diff trust map (green passed / amber partial /
  // red failed / unknown when no gate has run).
  proofTone: () => {
    const gates = get().proof.gates;
    if (gates.length === 0) return 'unknown';
    if (gates.some((g) => g.tone === 'bad')) return 'bad';
    if (gates.some((g) => g.tone === 'warn')) return 'partial';
    return 'ok';
  },

  // v11.15 — a fresh user turn starts with a CLEAN proof slate. Stale gates
  // from an earlier turn must never make a plain "salam" look proven.
  resetProofForTurn: () => {
    turnEvidence = emptyTurnEvidence();
    // v11.23 — the ingest lifecycle is PER-TURN too: a stale post-turn_end
    // event from the previous run must never be mistaken for this run's stream.
    runClosed = false;
    closedSession = null;
    runFailed = false;
    runAborted = false;
    // v11.26 — one fresh report ledger + one clean preview decision per task.
    runReport = freshRunReport(Date.now());
    rrWriteByCall = {};
    rrCmdByCall = {};
    pendingWebPreview = null;
    enginePreviewRequested = false;
    previewUserClosed = false;
    useStore.setState({
      proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null },
      proofVisible: false,
    });
  },

  // ---------------- init ----------------
  init: async () => {
    try {
      const [settings, license, sessions] = await Promise.all([
        api.getSettings(),
        api.licenseGet(),
        api.listSessions(),
      ]);
      const loaded = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      // v11.3 migration — 'soft' was the pre-11.3 default, not a deliberate
      // choice: such profiles move to the new device-following default.
      // Explicit light/dark picks are honored and stay.
      if ((settings as AppSettings | undefined)?.theme === 'soft') loaded.theme = 'follow';
      set({
        settings: loaded,
        license: license || { plan: 'free', mode: 'local' },
        sessions: sessions || [],
        // v12 (RESUME) — a marker left by a run that never reached a terminal
        // event means the app closed/crashed mid-task. Offer a one-click resume.
        resumableRun: readResumeMarker(),
      });
    } catch {
      /* first run */
    }
    // local account session (device-stored, may be null on first run)
    try {
      const account = (await api.authCurrent()) ?? null;
      set({ account, authChecked: true });
    } catch {
      set({ authChecked: true });
    }
    api.onAgentEvent((e) => get().ingestAgentEvent(e));
    // v11.3 — the website activation deep link landed: adopt the account
    // (or surface the error) and drop the "waiting" state on the auth card.
    if (api.onAuthChanged) {
      api.onAuthChanged((res) => {
        const r = res as { ok: boolean; account?: AccountInfo; error?: string; licenseError?: string };
        if (r?.ok && r.account) {
          set({ account: r.account, webAuthPending: null });
          get().notify(
            get().settings.language === 'ar'
              ? `تم تفعيل الحساب من الموقع: ${r.account.email}`
              : `Account activated from the website: ${r.account.email}`,
          );
          // v11.33 — a self-asserted paid plan is never trusted. If the deep
          // link carried a bad signed key, say so honestly instead of
          // silently claiming Pro. The account stays on the free season.
          if (r.licenseError) get().notify(r.licenseError);
        } else {
          set({ webAuthPending: null });
          get().notify(
            get().settings.language === 'ar'
              ? 'تعذّر تفعيل الحساب — رمز الاقتران غير صالح أو منتهي.'
              : 'Activation failed — the pair code is invalid or expired.',
          );
        }
      });
    }
    api.onPreviewEvent((e) => {
      // BUG FIX — a dev/static server that dies was only reflected in the
      // status poll; the panel kept showing a blank/ready surface. Surface the
      // concrete error (detail + last log lines) into the honest error card.
      if (e.state === 'error') {
        // v11.23 (C6/P0) — never forward `e.error` / raw log lines to the card.
        // One localized message with a sanitized machine reason and next step.
        const raw = e.error || (Array.isArray(e.lines) ? e.lines.slice(-3).join(' ') : '');
        set({ previewOpen: true, previewError: { reason: 'startFailed', detail: localizePreviewError(raw, get().settings.language === 'ar') } });
      }
      void get().refreshPreviewStatus();
    });
    // ---------- E4 security feedback (toasts; the inline blocked banner lives
    // in TerminalView, which subscribes separately) ----------
    if (api.onTermBlocked) {
      api.onTermBlocked((e) => {
        const ar = get().settings.language === 'ar';
        pushToast({
          title: (ar ? 'أمر محظور: ' : 'Blocked command: ') + e.cmd,
          severity: 'error',
          actionLabel: ar ? 'اسمح مرة' : 'Allow once',
          onAction: () => {
            void api.termAllowOnce(e.cmd).catch(() => undefined);
            get().notify(ar ? 'سُمح مرة واحدة — أعد تشغيل الأمر' : 'Allowed once — re-run the command');
          },
          duration: 8000,
        });
      });
    }
    if (api.onTermWarn) {
      api.onTermWarn((e) => {
        const ar = get().settings.language === 'ar';
        pushToast({ title: (ar ? 'تحذير أمر: ' : 'Command warning: ') + e.cmd, severity: 'warn', duration: 2600 });
      });
    }
    if (api.onFsBlock) {
      api.onFsBlock((e) => {
        const ar = get().settings.language === 'ar';
        pushToast({ title: (ar ? 'كتابة محظورة خارج مساحة العمل: ' : 'Write blocked outside workspace: ') + (e.path || ''), severity: 'error' });
      });
    }
    // ---------- v2.2 SADEEM DNA: live refresh + suggestion/trust chips ----------
    if (typeof api.onDnaEvent === 'function') {
      api.onDnaEvent((e) => {
        if (e.type === 'updated' || e.type === 'refined') {
          void get().loadDna(); // loadDna coalesces bursts (500ms trailing)
        } else if (e.type === 'suggestion') {
          const p = (e.payload ?? {}) as { patternId?: unknown; text?: unknown };
          const text = typeof p.text === 'string' ? p.text : '';
          const patternId = typeof p.patternId === 'string' ? p.patternId : undefined;
          if (text) set({ dnaSuggestion: { patternId, text } });
        } else if (e.type === 'skills-trust') {
          set({ skillsTrustNeeded: true });
        }
      });
    }
    // ---------- v11.12 Living Playbook push events ----------
    if (typeof api.onPlaybookEvent === 'function') {
      api.onPlaybookEvent(() => {
        // The agent's `playbook_learned` event owns the toast; here we only
        // refresh so manual IPC updates (and clears) stay in sync.
        void get().loadPlaybook();
      });
    }
    // ---------- v11.12 Subagent dashboard push events ----------
    if (typeof api.onSubagentsEvent === 'function') {
      api.onSubagentsEvent((e) => {
        // Patch the in-memory list instantly; periodic/panel loads stay authoritative.
        const rec = e.record;
        set((st) => {
          if (e.type === 'cleared') {
            return { subagents: [], subagentSteps: {}, subagentToolCalls: {}, subagentDetailId: null };
          }
          // v11.36 — a REAL tool call just executed inside a child agent. Append
          // it to the per-agent transcript (and to the record) from the event's
          // own `call` — no placeholder, no invented name/input/output/status.
          if ((e.type === 'toolcall' || e.type === 'tool') && e.id) {
            const call = e.call ?? e.toolCall;
            const incoming: SubagentToolCall[] = call ? [call] : [];
            return {
              subagentToolCalls: {
                ...st.subagentToolCalls,
                [e.id]: mergeSubagentToolCalls(st.subagentToolCalls[e.id], incoming),
              },
              subagents: st.subagents.map((r) =>
                r.id === e.id ? { ...r, toolCalls: mergeSubagentToolCalls(r.toolCalls, incoming) } : r,
              ),
            };
          }
          if (e.type === 'retried' && rec) {
            // A retry starts a fresh record — seed a clean timeline for it.
            return {
              subagents: [rec, ...st.subagents.filter((r) => r.id !== rec.id)].sort((a, b) => b.startedAt - a.startedAt),
              subagentSteps: { ...st.subagentSteps, [rec.id]: [{ at: rec.startedAt, done: 0, total: rec.total }] },
              subagentToolCalls: { ...st.subagentToolCalls, [rec.id]: [] },
            };
          }
          if (!rec) return {};
          const others = st.subagents.filter((r) => r.id !== rec.id);
          return {
            subagents: [rec, ...others].sort((a, b) => b.startedAt - a.startedAt),
            // Any ledger push may carry the authoritative persisted transcript.
            ...(rec.toolCalls?.length
              ? { subagentToolCalls: { ...st.subagentToolCalls, [rec.id]: mergeSubagentToolCalls(st.subagentToolCalls[rec.id], rec.toolCalls) } }
              : {}),
          };
        });
      });
    }
    // ---------- cross-surface commands (workspace quick actions → chat) ----------
    window.addEventListener('surnia:run-review', () => {
      void get().runReview();
    });
    window.addEventListener('surnia:run-recap', () => {
      void get().exportRecap();
    });
    // scheduled jobs: one boot-time poll (channel events are not bridged in
    // preload — panels re-poll after mutations instead)
    void get().loadJobs();
    api.onMenu((action) => {
      const s = get();
      if (action === 'open-folder') s.openFolderDialog();
      else if (action === 'new-session') s.newSession();
      else if (action === 'toggle-terminal') s.toggleTerminal();
      else if (action === 'toggle-preview') s.togglePreview();
      else if (action === 'save') s.saveAll();
      else if (action === 'settings') s.setSettings(true);
      else if (action === 'palette') s.setPalette(true);
    });
    get().applyDoc();
    // auto-open last workspace
    const recent = get().settings.recentPaths || [];
    if (recent.length > 0) await get().openWorkspace(recent[0]);
    const onboarded = get().settings.onboardingDone;
    if (!onboarded || !get().wsPath) set({ onboardingOpen: !onboarded });
    set({ booted: true });
  },

  applyDoc: () => {
    // v11.11 (A6) — SSR/plain-node safe: the store must keep working where
    // there is no DOM (tests bundle it directly).
    if (typeof document === 'undefined') return;
    const { language, theme } = get().settings;
    const html = document.documentElement;
    html.lang = language;
    html.dir = language === 'ar' ? 'rtl' : 'ltr';
    html.dataset.theme = theme;
  },

  updateSettings: (patch) => {
    // v11.11 (A6) — providers merge at the ENTRY level: a fastSettings patch
    // built from a stale render closure (e.g. ModelsSection.fetchModels after
    // the enable toggle) used to REPLACE the whole providers object and wipe
    // `enabled` / `lastModels` the toggle had just written — the founder's
    // "providers sometimes not showing" bug. Entry-level merge keeps explicit
    // overrides (enabled:false still wins) while never resurrecting fields the
    // patch merely doesn't mention.
    const prev = get().settings;
    const patchProviders = patch.providers as Partial<Record<string, ProviderEntry>> | undefined;
    const prevProviders = (prev.providers ?? {}) as Record<string, ProviderEntry>;
    const mergedProviders: AppSettings['providers'] = patchProviders
      ? (Object.fromEntries(
          Object.entries({ ...prevProviders, ...(patchProviders as Record<string, ProviderEntry>) }).map(
            ([id, entry]) => [
              id,
              patchProviders[id]
                ? { ...(prevProviders[id] ?? {}), ...(patchProviders[id] as ProviderEntry) }
                : entry,
            ],
          ),
        ) as AppSettings['providers'])
      : prev.providers;
    const settings = {
      ...prev,
      ...patch,
      ...(patchProviders ? { providers: mergedProviders } : {}),
      // v1142 — clamp the subagent limit at the REAL settings write so a
      // hand-edited / hostile patch can never persist 0, NaN or 1e9. The engine
      // re-clamps on read; this is the first line of defence.
      ...(patch.maxSubagents !== undefined ? { maxSubagents: clampMaxSubagents(patch.maxSubagents) } : {}),
    };
    set({ settings });
    get().applyDoc();
    // v11.11 (A6) — the bridge is missing in plain-node contexts (tests); an
    // optional call keeps settings state alive instead of throwing.
    void api.saveSettings?.(settings);
  },

  setLang: (l) => get().updateSettings({ language: l }),
  cycleTheme: () => {
    // v11.3 — light first (primary), dark themes second; device decides by default.
    const order: AppSettings['theme'][] = ['follow', 'light', 'obsidian', 'midnight', 'soft', 'high'];
    const cur = order.includes(get().settings.theme) ? get().settings.theme : 'follow';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    get().updateSettings({ theme: next });
  },
  setMode: (m) => get().updateSettings({ permissionMode: m }),

  // ---------------- workspace ----------------
  openFolderDialog: async () => {
    const path = await api.openFolderDialog();
    if (path) await get().openWorkspace(path);
  },

  openWorkspace: async (path) => {
    // v8: the preview belongs to a workspace — a NEW folder must start with a
    // clean preview, never the previous conversation's server (user-reported bug:
    // "المعاينة الحية معلقة على المحادثة الأقدم").
    // v11.26 — a new workspace starts with a clean auto-preview decision.
    pendingWebPreview = null;
    enginePreviewRequested = false;
    previewUserClosed = false;
    set({ wsPath: path, fileTree: null, searchResults: null, previewUrl: '', previewWs: '', previewStatus: null, previewSource: '', previewError: null, previewAuto: null });
    get().updateSettings({
      recentPaths: [path, ...(get().settings.recentPaths || []).filter((p) => p !== path)].slice(0, 8),
    });
    await get().refreshTree();
    void get().loadGit();
    void get().loadSkills();
    void get().loadDna(); // workspace DNA layer (merged view)
    void get().loadPlaybook(); // v11.12 — workspace learning playbook
    void get().loadSubagents(); // v11.12 — subagent dashboard
    void get().newSession();
  },

  refreshTree: async () => {
    const { wsPath } = get();
    if (!wsPath) return;
    set({ treeLoading: true });
    try {
      const tree = await api.readDir(wsPath);
      set({ fileTree: tree, treeLoading: false });
    } catch {
      set({ treeLoading: false });
    }
  },

  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      // v14 — 'workspace'/'search' are full section pages now; opening a file
      // must surface the editor (the non-stage work-area surface).
      set({ activeTab: path, rail: 'editor' });
      return;
    }
    try {
      const content = await api.readFile(path);
      const tab: OpenTab = { path, content, original: content, dirty: false };
      set({ tabs: [...get().tabs, tab], activeTab: path, rail: 'editor' });
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر فتح الملف' : 'Cannot open file');
    }
  },

  closeTab: (path) => {
    const tabs = get().tabs.filter((t) => t.path !== path);
    const activeTab =
      get().activeTab === path ? tabs[tabs.length - 1]?.path ?? null : get().activeTab;
    set({ tabs, activeTab });
  },

  setActiveTab: (path) => set({ activeTab: path, rail: 'editor' }),

  setTabContent: (path, content) => {
    set({
      tabs: get().tabs.map((t) => (t.path === path ? { ...t, content, dirty: content !== t.original } : t)),
    });
  },

  saveTab: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    await api.writeFile(path, tab.content);
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, original: t.content, dirty: false } : t)) });
  },

  saveAll: async () => {
    const dirty = get().tabs.filter((t) => t.dirty);
    for (const t of dirty) await api.writeFile(t.path, t.content);
    set({ tabs: get().tabs.map((t) => ({ ...t, original: t.content, dirty: false })) });
    void get().loadGit();
  },

  createEntry: async (type, parentDir, name) => {
    if (!name) return;
    const p = `${parentDir}/${name}`.replace(/\/+/g, '/');
    try {
      if (type === 'file') await api.createFile(p, '');
      else await api.createDir(p);
      await get().refreshTree();
      if (type === 'file') void get().openFile(p);
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر الإنشاء' : 'Create failed');
    }
  },

  deleteEntry: async (path) => {
    try {
      await api.deletePath(path);
      set({ tabs: get().tabs.filter((t) => !t.path.startsWith(path)) });
      const at = get().activeTab;
      if (at && at.startsWith(path)) set({ activeTab: null });
      await get().refreshTree();
      void get().loadGit();
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر الحذف' : 'Delete failed');
    }
  },

  renameEntry: async (oldPath, newName) => {
    const parent = oldPath.split('/').slice(0, -1).join('/');
    const newPath = `${parent}/${newName}`;
    try {
      await api.renamePath(oldPath, newPath);
      set({
        tabs: get().tabs.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)),
        activeTab: get().activeTab === oldPath ? newPath : get().activeTab,
      });
      await get().refreshTree();
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّرت إعادة التسمية' : 'Rename failed');
    }
  },

  runSearch: async (q) => {
    if (!q.trim() || !get().wsPath) {
      set({ searchResults: null });
      return;
    }
    set({ searching: true });
    try {
      const hits = await api.searchFiles(get().wsPath, q);
      set({ searchResults: hits, searching: false });
    } catch {
      set({ searchResults: [], searching: false });
    }
  },

  // ---------------- sessions ----------------
  newSession: async (title) => {
    // v11.31 — switching away from an IN-FLIGHT run is a terminal edge for the
    // UI: drop its watchdog + durable resume marker so a later crash cannot
    // offer to resume a task the user abandoned. A boot-time newSession has no
    // running task and MUST keep a pending crash-resume marker intact.
    const abandoningRun = get().running;
    flushPendingDelta(); // drain coalesced deltas into the PREVIOUS session first
    // v11.31 — proof is per-TURN and per-SESSION. Without this, gates from a
    // previous chat decorated a fresh session's ribbon until its first send.
    get().resetProofForTurn();
    if (abandoningRun) {
      stopRunWatchdog();
      clearResumeMarker();
    }
    const now = Date.now();
    const s: SessionData = {
      id: uid(),
      title: title ?? (get().settings.language === 'ar' ? 'جلسة جديدة' : 'New session'),
      createdAt: now,
      updatedAt: now,
      workspace: get().wsPath || undefined,
      model: `${get().settings.model.provider}/${get().settings.model.model}`,
      messageCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      messages: [],
      todos: [],
    };
    set({
      session: s,
      todos: [],
      pendingApproval: null,
      running: false,
      ...clearedRunActivity(),
      sessionUsage: emptySessionUsage() as AppState['sessionUsage'],
      lastTurnUsage: null,
      liveStreamChars: 0, // v11.10 (A5) — no live estimate across sessions
      // v2.1 control surface resets per session
      taskMode: 'build',
      steerPending: false,
      queuedItems: [],
      subagentProgress: {},
      subagentToolCalls: {}, // v11.36 — transcripts belong to the old session
      lastReview: null,
      planProposal: null,
      continueHint: null, // v11.12 — a fresh/restored session has nothing to continue
    });
    // Do NOT persist empty sessions — a fresh session only hits disk once the
    // first message arrives (persistSession enforces the same guard). This
    // keeps the sessions list free of "New session · 0 messages" spam.
    try {
      const sessions = await api.listSessions();
      set({ sessions: sessions || [] });
    } catch {
      /* list refresh is best-effort */
    }
  },

  // v10.2 — Codex-style worktree hand-off: pin this chat to an isolated
  // worktree (agent cwd + tools + preview all follow), or unpin to main tree.
  setSessionWorktree: async (name) => {
    const s = get();
    if (!s.session) return false;
    const cur = s.session;
    const ar = s.settings.language === 'ar';
    if (!name) {
      if (!cur.worktree) return true;
      set({ session: { ...cur, worktree: undefined } });
      s.notify(ar ? 'عادت الجلسة إلى الشجرة الرئيسية' : 'Chat moved back to the main tree');
      return true;
    }
    if (!s.wsPath) {
      s.notify(ar ? 'افتح مجلد المشروع أولاً' : 'Open a project folder first');
      return false;
    }
    try {
      const wt = await api.worktreeResolve(s.wsPath, name);
      if (!wt) {
        s.notify(ar ? `ورك تري غير موجودة: ${name}` : `Worktree not found: ${name}`);
        return false;
      }
      set({ session: { ...cur, worktree: { name: wt.name, path: wt.path, branch: wt.branch } } });
      s.notify(
        ar
          ? `تعمل هذه الجلسة الآن داخل: ${wt.name} (${wt.branch})`
          : `This chat now runs in: ${wt.name} (${wt.branch})`,
      );
      return true;
    } catch (err) {
      // v11.23 (C6/P1) — FIXED raw-payload leak: the old
      // `s.notify(String(err))` printed thrown bridge text verbatim (often
      // EN+AR mixed). One localized message, reason preserved as a token.
      s.notify(localizeRunError(err, ar));
      return false;
    }
  },

  openSession: async (id) => {
    // v11.31 — same in-flight-switch rule as newSession (boot resume marker
    // preserved; an abandoned live run's marker/watchdog are dropped).
    const abandoningRun = get().running;
    flushPendingDelta(); // pending streamed text belongs to the previous session
    const s = await api.loadSession(id);
    if (!s) return;
    // v11.31 — a loaded session is a DIFFERENT conversation: never let the
    // previous chat's proof gates / report / preview decision follow it.
    get().resetProofForTurn();
    if (abandoningRun) {
      stopRunWatchdog();
      clearResumeMarker();
    }
    // v11.9 S2 — sanitize the loaded transcript: a torn stream may have
    // persisted streaming:true. NEVER render a historical row as live —
    // force streaming:false on every row before it reaches state (thinkMs
    // footers survive untouched).
    if (s.messages.some((m) => m.streaming)) {
      s.messages = s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
    }
    streamingMsgId = null;
    // restore the session usage meters from the persisted per-message usage
    // footers; fall back to the SessionMeta totals when footers are missing.
    // v11.10 (A5) — accumulate through the SAME accumulateUsage function the
    // live path uses: per-message rows and the rebuilt total reconcile exactly
    // (rows carry the run view; the sum IS the session total by construction).
    let sessionUsage = emptySessionUsage() as AppState['sessionUsage'];
    for (const m of s.messages) {
      if (m.usage) sessionUsage = accumulateUsage(sessionUsage, m.usage) as AppState['sessionUsage'];
    }
    const footerTokens = sessionUsage.inputTokens + sessionUsage.outputTokens;
    const metaTokens = s.totalTokens || 0;
    const metaCost = s.totalCostUsd || 0;
    if (footerTokens <= 0 && (metaTokens > 0 || metaCost > 0)) {
      // v11.40 — stale session metadata is an ESTIMATE, not provider-exact.
      sessionUsage = { inputTokens: metaTokens, outputTokens: 0, costUsd: metaCost, estimated: true };
    }
    // v11.10 (A5) — the last persisted usage row is the last known context fill.
    const lastUsageRow = [...s.messages].reverse().find((m) => m.usage)?.usage ?? null;
    set({
      session: s,
      todos: s.todos || [],
      running: false,
      ...clearedRunActivity(),
      pendingApproval: null,
      sessionUsage,
      lastTurnUsage: lastUsageRow,
      liveStreamChars: 0, // restored sessions are idle — no ≈ estimate
      activeGoal: null,
      queuedCount: 0,
      taskMode: 'build',
      steerPending: false,
      queuedItems: [],
      subagentProgress: {},
      subagentToolCalls: {}, // v11.36 — transcripts belong to the old session
      lastReview: null,
      planProposal: null,
      continueHint: null, // v11.12 — a fresh/restored session has nothing to continue
    });
    // hydrate the goal banner from the backend (persisted per session)
    try {
      const g = await api.goalGet(id);
      if (g && g.goal) set({ activeGoal: { goal: g.goal, pct: g.pct } });
    } catch {
      /* goal store unavailable — banner stays empty */
    }
    // lifecycle list refresh (saves no longer reload the list — see persistSession)
    try {
      const sessions = await api.listSessions();
      set({ sessions: sessions || [] });
    } catch {
      /* list refresh is best-effort */
    }
  },

  // ---------------- scheduled jobs (v2) ----------------
  loadJobs: async () => {
    try {
      const jobs = await api.scheduleList();
      set({ scheduledJobs: jobs || [] });
    } catch {
      /* backend unavailable (browser dev / older main) */
    }
  },
  scheduleAdd: async (job) => {
    try {
      await api.scheduleAdd(job);
      await get().loadJobs();
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر إنشاء المهمة المجدولة' : 'Could not create the scheduled job');
    }
  },
  scheduleRemoveJob: async (id) => {
    try {
      await api.scheduleRemove(id);
      await get().loadJobs();
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر حذف المهمة' : 'Could not delete the job');
    }
  },
  scheduleToggleJob: async (id, enabled) => {
    // optimistic toggle, then reconcile with the backend
    set({ scheduledJobs: get().scheduledJobs.map((j) => (j.id === id ? { ...j, enabled } : j)) });
    try {
      await api.scheduleToggle(id, enabled);
      await get().loadJobs();
    } catch {
      void get().loadJobs();
    }
  },
  scheduleRunJobNow: async (id) => {
    set({ scheduledJobs: get().scheduledJobs.map((j) => (j.id === id ? { ...j, lastStatus: 'running' } : j)) });
    try {
      await api.scheduleRunNow(id);
      get().notify(get().settings.language === 'ar' ? 'أُطلقت المهمة الآن' : 'Job launched');
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر تشغيل المهمة' : 'Could not run the job');
    } finally {
      await get().loadJobs();
    }
  },
  setScheduled: (o) => {
    set({ scheduledOpen: o });
    if (o) void get().loadJobs();
  },
  clearGoal: async () => {
    const sid = get().session?.id;
    set({ activeGoal: null });
    if (!sid) return;
    try {
      await api.goalClear(sid);
    } catch {
      /* backend unavailable — banner already cleared */
    }
  },

  deleteSession: async (id) => {
    flushPendingDelta(); // pending streamed text belongs to the dying session
    await api.deleteSession(id);
    const sessions = await api.listSessions();
    set({ sessions });
    if (get().session?.id === id) void get().newSession();
  },

  renameSession: async (id, title) => {
    if (get().session?.id === id) {
      const s = { ...get().session!, title };
      set({ session: s });
      await get().persistSession();
    }
  },

  persistSession: async () => {
    const s = get().session;
    if (!s) return;
    const doSave = async () => {
      const cur = get().session;
      if (!cur) return;
      // Empty sessions never reach disk (lazy persistence).
      if (cur.messages.length === 0) return;
      const tokens = cur.messages.reduce((a, m) => a + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0), 0);
      const cost = cur.messages.reduce((a, m) => a + (m.usage?.costUsd ?? 0), 0);
      const data: SessionData = {
        ...cur,
        // v11.9 S3 — never persist a torn stream: strip streaming:true in the
        // serialized copy (a saved live-looking row would resurrect the
        // blinking cursor on reload; S2 sanitizes the load path too).
        // thinkMs footers survive untouched.
        messages: cur.messages.some((m) => m.streaming)
          ? cur.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          : cur.messages,
        todos: get().todos,
        messageCount: cur.messages.length,
        totalTokens: tokens,
        totalCostUsd: cost,
        updatedAt: Date.now(),
      };
      await api.saveSession(data);
      // v3.2 perf — NO listSessions reload in the save path (a full IPC reload
      // per save was pure churn). Patch the matching meta entry locally; the
      // authoritative reload happens in openSession/newSession/delete/fork.
      const meta: SessionMeta = {
        id: cur.id,
        title: cur.title,
        createdAt: cur.createdAt,
        updatedAt: data.updatedAt,
        workspace: cur.workspace,
        worktree: cur.worktree,
        model: cur.model,
        messageCount: data.messageCount,
        totalTokens: data.totalTokens,
        totalCostUsd: data.totalCostUsd,
      };
      const prev = get().sessions;
      set({
        sessions: prev.some((m) => m.id === cur.id)
          ? prev.map((m) => (m.id === cur.id ? meta : m))
          : [...prev, meta],
      });
    };
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void doSave(), 400);
  },

  // ---------------- agent ----------------
  resumeTask: async () => {
    const r = get().resumableRun;
    if (!r) return;
    const note = get().settings.language === 'ar'
      ? '[استئناف بعد انقطاع] واصل من حيث توقفت — العمل المنجز محفوظ، لا تعِد ما تم.'
      : '[RESUMED after interruption] Continue exactly where you stopped — completed work is saved, do not redo it.';
    set({ resumableRun: null, runRecovery: { since: Date.now(), phase: 'recovered', note: 'resumed from checkpoint' } });
    await get().sendMessage(`${note}\n\n${r.task}`);
  },
  dismissResumable: () => { clearResumeMarker(); set({ resumableRun: null }); },

  sendMessage: async (text, images, displayAs) => {
    const raw = text.trim();
    if (!raw && !(images && images.length)) return;
    const s = get();

    // v2.4 flows — non-blocking hit-probe: when this message looks like a
    // repeatable request, raise the "save as flow" chip. Never blocks the send.
    // v11.31 — `flowsHit` is a typed member of SurniaAPI (api.ts) AND is exposed
    // by preload.ts; the old `as unknown as { … }` cast + TODO were stale.
    // The optional call keeps plain-node/test hosts (bridge = {}) harmless.
    void api.flowsHit?.(raw)
      .then((r) => {
        if (r?.suggest) set({ flowSuggest: { text: raw } });
      })
      .catch(() => {});

    // Busy → engine queue. The message lands as a dismissible chip + a
    // QUEUED-stamped transcript row; queued_count reconciles the mirror.
    if (s.running) {
      if (raw.startsWith('/')) return; // slash commands stay idle-only
      const sid = s.session?.id;
      if (!sid) return;
      try {
        await api.queueSend(sid, raw);
        // v11.9 S4 — flush buffered deltas FIRST so text streamed before the
        // queue event lands in the OLD bubble; a queued row must not steal it.
        flushPendingDelta();
        const cur = get().session;
        if (cur) {
          // v11.9 S4 — steer semantics: the queued/steer transcript row CLOSES
          // the streaming assistant at insert time so the next delta opens a
          // NEW assistant row below it (old answer stays, new answer follows).
          const msgs = [...cur.messages];
          closeStreamingAssistant(msgs);
          msgs.push({ id: uid(), role: 'user', kind: 'text', content: raw, model: 'queued', timestamp: Date.now() });
          set({
            queuedItems: [...get().queuedItems, raw],
            queuedCount: get().queuedCount + 1,
            session: { ...cur, messages: msgs },
          });
        } else {
          set({ queuedItems: [...get().queuedItems, raw], queuedCount: get().queuedCount + 1 });
        }
        void get().persistSession();
      } catch {
        get().notify(s.settings.language === 'ar' ? 'تعذّر إضافة الرسالة للطابور' : 'Could not queue the message');
      }
      return;
    }

    if (raw.startsWith('/')) {
      const cmd = raw.slice(1).split(/\s+/)[0].toLowerCase();
      const ar = s.settings.language === 'ar';
      if (cmd === 'help') {
        const tt = slashT(ar);
        const msg: ChatMessage = {
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content:
            (ar ? 'أوامر كودكس المتاحة:\n' : 'Available SADEEM commands:\n') +
            '/init — ' + (ar ? 'إنشاء ذاكرة المشروع (MEMORY.md)' : 'generate project memory (MEMORY.md)') + '\n' +
            '/compact — ' + (ar ? 'تلخيص وضغط السياق' : 'summarize and compact context') + '\n' +
            '/context — ' + (ar ? 'تفصيل نافذة السياق' : 'context window breakdown') + '\n' +
            '/rewind — ' + (ar ? 'اختيار نقطة تحقق واستعادتها (قائمة)' : 'pick a checkpoint to restore (chooser)') + '\n' +
            '/effort — ' + (ar ? 'تبديل التفكير العميق' : 'toggle deep thinking effort') + '\n' +
            '/plan — ' + (ar ? 'وضع الخطة (قراءة فقط)' : 'plan mode (read-only)') + '\n' +
            '/clear — ' + (ar ? 'جلسة جديدة' : 'start a fresh session') + '\n' +
            '/model — ' + (ar ? 'تغيير النموذج (اكتب ‎/model ثم الاسم)' : 'change model (use /model <name>)') + '\n' +
            '/profile — ' + tt('slash.help.profile', 'switch the tool profile (essential | balanced | full)') + '\n' +
            '/undo — ' + tt('slash.help.undo', 'restore the newest checkpoint') + '\n' +
            '/continue — ' + tt('slash.help.continue', 'continue the last interrupted task') + '\n' +
            '/mode — ' + (ar ? 'تبديل وضع الأذونات' : 'cycle permission mode') + '\n' +
            '/theme — ' + (ar ? 'تبديل السمة' : 'cycle theme') + '\n' +
            '/lang — ' + (ar ? 'تبديل اللغة' : 'toggle language') + '\n' +
            '/terminal — ' + (ar ? 'إظهار الطرفية' : 'toggle terminal') + '\n' +
            '/cost — ' + (ar ? 'استخدام الجلسة' : 'session usage') + '\n' +
            '/goal — ' + (ar ? 'تعيين هدف للوكيل وتتبع تقدمه' : 'set a goal the agent tracks') + '\n' +
            '/review — ' + (ar ? 'مراجعة ذكية للتغييرات غير المودعة' : 'AI review of uncommitted changes') + '\n' +
            '/handoff — ' + (ar ? 'مذكرة تسليم الجلسة (HANDOFF.md) للمتابعة لاحقاً' : 'session handoff note (HANDOFF.md) for resuming later') + '\n' +
            '/grill — ' + (ar ? 'مقابلة أسئلة قبل البرمجة (خيارات موصى بها)' : 'interview me before coding (recommended options first)') + '\n' +
            '/dna — ' + (ar ? 'ملخص ما تعلّمه سديم (‏/dna forget للنسيان)' : 'what SADEEM has learned (/dna forget to clear)') + '\n' +
            '/commit — ' + (ar ? 'اقتراح رسالة إيداع ذكية' : 'AI-suggested commit message') + '\n' +
            '/fork — ' + (ar ? 'تشعيب هذه الجلسة' : 'fork this session') + '\n' +
            '/export — ' + (ar ? 'تصدير الجلسة إلى Markdown' : 'export the session as Markdown') + '\n' +
            '/status — ' + (ar ? 'حالة الجلسة (النموذج، الوضع، الاستخدام)' : 'session status (model, mode, usage)') + '\n' +
            '/diff — ' + (ar ? 'عرض فرق شجرة العمل في عارض الفروقات' : 'open the working-tree diff in the diff viewer') + '\n' +
            '/share — ' + (ar ? 'توليد صفحة HTML للمشاركة من الجلسة' : 'generate a shareable HTML report of the session') + '\n' +
            '/schedule — ' + (ar ? 'المهام المجدولة (cron)' : 'scheduled jobs (cron)') + '\n' +
            '/plans — ' + (ar ? 'الخطط' : 'plans'),
          timestamp: Date.now(),
        };
        const session = s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null;
        set({ session });
        void get().persistSession();
        return;
      }
      // v11.12 — /clear is DESTRUCTIVE to the live transcript: confirm first
      // (the saved session is never deleted, only a fresh one becomes active).
      if (cmd === 'clear') {
        const tt = slashT(ar);
        if (
          typeof window !== 'undefined' &&
          typeof window.confirm === 'function' &&
          !window.confirm(tt('slash.clear.confirm', 'Start a new session? The current transcript stays saved in Sessions.'))
        ) {
          return;
        }
        await get().newSession();
        get().notify(tt('slash.clear.done', 'New session started'));
        return;
      }
      // v11.12 — `/model <name>` switches directly; bare `/model` opens the picker.
      if (cmd === 'model') return void (await get().switchModel(raw.slice(cmd.length + 1).trim()));
      // v11.12 — real runtime capabilities added to the chat panel.
      if (cmd === 'profile') return void (await get().switchToolProfile(raw.slice(cmd.length + 1).trim()));
      if (cmd === 'undo') return void (await get().undoLastCheckpoint());
      if (cmd === 'continue') return void (await get().continueTask());
      if (cmd === 'mode') {
        // shared canonical order (lib/modes) — includes PLAN
        return get().setMode(nextIn(PERMISSION_MODES, s.settings.permissionMode));
      }
      if (cmd === 'dna') {
        const arg = raw.slice(cmd.length + 1).trim().toLowerCase();
        if (arg.startsWith('forget')) {
          if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
          const userMsg: ChatMessage = { id: uid(), role: 'user', kind: 'text', content: raw, timestamp: Date.now() };
          set({ session: s.session ? { ...s.session, messages: [...s.session.messages, userMsg] } : null });
          const before = get().dna;
          const n = (before?.patterns.length ?? 0) + (before?.feedback.length ?? 0);
          try {
            await api.dnaClear('workspace', s.wsPath);
          } catch {
            /* older preload — continue with the reply */
          }
          void get().loadDna();
          const out: ChatMessage = {
            id: uid(),
            role: 'assistant',
            kind: 'text',
            content: ar
              ? `نُسيت ذاكرة مساحة العمل — مُسحت ${n} مدخلة. الجلسات القادمة تبدأ من صفحة جديدة.`
              : `Forgot the workspace DNA — ${n} entries cleared. Future sessions start fresh.`,
            timestamp: Date.now(),
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, out] } : null });
        }
        const userMsg: ChatMessage = { id: uid(), role: 'user', kind: 'text', content: raw, timestamp: Date.now() };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, userMsg] } : null });
        const dna = get().dna;
        const stats = get().dnaStats;
        const patterns = dna?.patterns ?? [];
        // v11.34 — show CUMULATIVE learning next to the bounded active window.
        // The active count plateaus at 60 by design (oldest reinforced facts
        // retire); factsRecorded keeps rising. Showing both is the honest
        // answer to "وقف على عدد معين / بطل يتعلم" — it is bounded, not frozen.
        const factsLearned = dna?.stats.factsRecorded ?? 0;
        const top3 = [...patterns]
          .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
          .slice(0, 3);
        const lines: string[] = [
          ar
            ? `ذاكرة سديم — ${patterns.length} أنماط · ${factsLearned} حقيقة متعلَّمة · ${dna?.stats.sessionsObserved ?? 0} جلسة مُلاحَظة`
            : `SADEEM DNA — ${patterns.length} patterns · ${factsLearned} facts learned · ${dna?.stats.sessionsObserved ?? 0} sessions observed`,
        ];
        if (top3.length > 0) {
          lines.push(ar ? 'أبرز الأنماط:' : 'Top patterns:');
          for (const p of top3) {
            lines.push(`• ${p.text} (${p.kind} ×${p.count})`);
          }
        } else {
          lines.push(ar ? 'لا أنماط بعد — اعمل مع سديم وعد لاحقاً.' : 'No patterns yet — work with SADEEM and check back.');
        }
        // The cap is honest (60 active patterns), never presented as unlimited.
        lines.push(
          ar
            ? `النافذة النشطة: ${patterns.length}/60 نمط — ${factsLearned} حقيقة تعلّمها سديم في المجمل. أقدم الأنماط المتكررة تُستبدل تلقائياً بأنماط جديدة؛ التعلّم لا يتوقف.`
            : `Active window: ${patterns.length}/60 patterns — ${factsLearned} facts learned in total. Oldest reinforced patterns retire automatically as new ones arrive; learning never stops.`,
        );
        if (typeof stats?.growth !== 'undefined' && stats.growth.length > 0) {
          const week = stats.growth.slice(-7).reduce((a, g) => a + g.count, 0);
          lines.push(ar ? `النشاط خلال 7 أيام: ${week}` : `Last 7 days: ${week} new facts`);
        }
        lines.push(ar ? 'افتح 06 — DNA من الشريط الجانبي للخريطة الكاملة.' : 'Open 06 — DNA in the rail for the full map.');
        const out: ChatMessage = { id: uid(), role: 'assistant', kind: 'text', content: lines.join('\n'), timestamp: Date.now() };
        const cur = get().session;
        return set({ session: cur ? { ...cur, messages: [...cur.messages, out] } : null });
      }
      if (cmd === 'theme') return get().cycleTheme();
      if (cmd === 'lang') return get().setLang(ar ? 'en' : 'ar');
      if (cmd === 'terminal') return void (await get().toggleTerminal());
      if (cmd === 'plans') return set({ plansOpen: true });
      // v2.4 — open the Flows panel (rail 07); the sidebar opens with it.
      if (cmd === 'flows') return set({ rail: 'flows', sidebarOpen: true });
      // v2.4 prompt templates — expand to a rich English prompt, then ride the
      // normal send path exactly like a plain message (recursion is safe: the
      // expanded text never starts with '/', and we are idle-only here).
      if (cmd === 'pr' || cmd === 'changelog' || cmd === 'tests' || cmd === 'handoff' || cmd === 'grill') {
        const arg = raw.slice(cmd.length + 1).trim();
        // v11.7 — the transcript shows the SHORT command (e.g. “/pr”); the
        // model receives the rich expanded template. Previously the whole
        // expanded English prompt was echoed into the transcript as a user
        // row — confusing and broken-looking.
        return void get().sendMessage(SLASH_PROMPT_TEMPLATES[cmd](arg), images, raw);
      }
      if (cmd === 'schedule') {
        if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
        return get().setScheduled(true);
      }
      if (cmd === 'goal') return void get().setGoal(raw.slice(cmd.length + 1).trim());
      if (cmd === 'review') {
        if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
        const reviewMsg: ChatMessage = {
          id: uid(),
          role: 'user',
          kind: 'text',
          content: '/review',
          timestamp: Date.now(),
        };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, reviewMsg] } : null });
        try {
          const res = await api.gitReview(s.wsPath);
          const out: ChatMessage = {
            id: uid(),
            role: 'assistant',
            kind: 'text',
            content: res.ok && res.review ? res.review : (res.error ?? (ar ? 'لا توجد ملاحظات مراجعة.' : 'No review notes.')),
            model: 'review',
            timestamp: Date.now(),
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, out] } : null });
        } catch {
          const errMsg: ChatMessage = {
            id: uid(),
            role: 'assistant',
            kind: 'text',
            content: ar ? 'فشلت مراجعة التغييرات — تأكد أن المستودع git وسجّل الدخول للمزود.' : 'Change review failed — make sure this is a git repo and a provider key is set.',
            model: 'error',
            timestamp: Date.now(),
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, errMsg] } : null });
        }
      }
      if (cmd === 'fork') {
        if (!s.session) return;
        try {
          const res = await api.sessionFork(s.session.id);
          if (res.ok && res.sessionId) {
            get().notify(ar ? 'تم تشعيب الجلسة' : 'Session forked');
            const sessions = await api.listSessions();
            set({ sessions });
            return void (await get().openSession(res.sessionId));
          }
          return get().notify(res.error ?? (ar ? 'تعذّر التشعيب' : 'Fork failed'));
        } catch {
          return get().notify(ar ? 'تعذّر التشعيب' : 'Fork failed');
        }
      }
      // A1 /export — full transcript → <workspace>/.surnia/export/session-<ISO date>.md
      // (fs bridge first — fsService.writeFile creates parent dirs recursively;
      // Blob download is the fallback when the bridge is unavailable, e.g. browser dev)
      if (cmd === 'export') {
        const sess = get().session;
        if (!sess) return;
        const tt = slashT(ar);
        const md = buildSessionMarkdown(sess);
        const stamp = new Date().toISOString().slice(0, 10); // ISO date (YYYY-MM-DD)
        if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
        const file = wsJoin(s.wsPath, '.surnia', 'export', `session-${stamp}.md`);
        try {
          await api.writeFile(file, md);
          get().notify(tt('slash.export.written', 'Session exported to {path}', { path: file }));
        } catch {
          downloadBlob(md, `session-${stamp}.md`, 'text/markdown;charset=utf-8');
          get().notify(tt('slash.export.downloaded', 'Session exported (Markdown download)'));
        }
        return;
      }
      if (cmd === 'commit') {
        if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
        const commitMsg: ChatMessage = {
          id: uid(),
          role: 'user',
          kind: 'text',
          content: '/commit',
          timestamp: Date.now(),
        };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, commitMsg] } : null });
        try {
          const res = await api.gitCommitMessage(s.wsPath);
          const text = res.ok && res.message ? res.message : '';
          if (text) {
            // fill the GitPanel commit box via the suggestion bridge
            set({ commitSuggestion: { text, seq: (get().commitSuggestion?.seq ?? 0) + 1 } });
            const out: ChatMessage = {
              id: uid(),
              role: 'assistant',
              kind: 'text',
              content:
                (ar ? 'رسالة إيداع مقترحة:\n```\n' : 'Suggested commit message:\n```\n') +
                text +
                (ar ? '\n```\nراجعها من لوحة التحكم بالمصدر ثم أودِع.' : '\n```\nReview it in the Source control panel, then commit.'),
              timestamp: Date.now(),
            };
            const cur = get().session;
            return set({ session: cur ? { ...cur, messages: [...cur.messages, out] } : null });
          }
          const none: ChatMessage = {
            id: uid(),
            role: 'assistant',
            kind: 'text',
            content: res.error ?? (ar ? 'لا توجد تغييرات لإيداعها.' : 'No changes to commit.'),
            model: 'error',
            timestamp: Date.now(),
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, none] } : null });
        } catch {
          return get().notify(ar ? 'تعذّر توليد رسالة الإيداع' : 'Could not generate a commit message');
        }
      }
      if (cmd === 'cost') {
        const u = get().sessionUsage;
        const msg: ChatMessage = {
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: ar
            ? `استخدام الجلسة: ${u.inputTokens + u.outputTokens} رمز — تكلفة تقديرية $${u.costUsd.toFixed(4)}`
            : `Session usage: ${u.inputTokens + u.outputTokens} tokens — est. cost $${u.costUsd.toFixed(4)}`,
          timestamp: Date.now(),
        };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null });
        return;
      }
      // A1 /status — compact system snapshot built purely from store state
      // (assistant row · kind unset · model 'system-status'; ≤ 10 lines).
      if (cmd === 'status') {
        const tt = slashT(ar);
        const st = get();
        const u = st.sessionUsage;
        const provLabel = PROVIDER_PRESETS[st.settings.model.provider]?.label ?? st.settings.model.provider;
        // keyless presets (Ollama) and any provider entry with a stored key count as ready
        const hasKey = !!PROVIDER_PRESETS[st.settings.model.provider]?.keyless || !!st.settings.providers[st.settings.model.provider]?.apiKey;
        const lines: string[] = [
          tt('slash.status.title', 'Session status'),
          '• ' + tt('slash.status.model', 'Model') + `: ${provLabel} — ${st.settings.model.model}` +
            ` (${hasKey ? tt('slash.status.keyOn', 'key set') : tt('slash.status.keyOff', 'no key')})`,
          '• ' + tt('slash.status.mode', 'Permission mode') + ': ' + tt(`tb.mode.${st.settings.permissionMode}`, st.settings.permissionMode),
          '• ' + tt('slash.status.workspace', 'Workspace') + `: ${st.wsPath || '—'}`,
          '• ' + tt('slash.status.tokens', 'Tokens') + `: ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`,
          '• ' + tt('slash.status.cost', 'Est. cost') + `: $${u.costUsd.toFixed(4)}`,
        ];
        if (st.verificationBudgetLabel) {
          lines.push('• ' + tt('slash.status.budget', 'Verification budget') + `: ${st.verificationBudgetLabel}`);
        }
        if (st.falseDoneStats) {
          lines.push(
            '• ' + tt('slash.status.falseDone', 'False-done rate') +
              `: ${(st.falseDoneStats.rate * 100).toFixed(1)}% (${st.falseDoneStats.falseDone}/${st.falseDoneStats.claimed})`,
          );
        }
        appendAssistantRow(get, lines.join('\n'), 'system-status');
        return;
      }
      // A1 /diff + v11.13 [`path`] — unified diff of uncommitted changes,
      // rendered in a transcript panel with a real copy button (plus the
      // established diff-viewer behavior, kept for compatibility).
      if (cmd === 'diff') {
        return void (await get().showDiff(raw.slice(cmd.length + 1).trim()));
      }
      // v11.13 /test [cmd] — REAL test run with an exit-code verdict.
      if (cmd === 'test') {
        return void (await get().runTests(raw.slice(cmd.length + 1).trim()));
      }
      // v11.13 /explain <path> — real one-shot model turn over a real file.
      if (cmd === 'explain') {
        return void (await get().explainFile(raw.slice(cmd.length + 1).trim()));
      }
      // v11.13 /budget — real usage totals from this session's usage store.
      if (cmd === 'budget') {
        return void (await get().budgetCommand());
      }
      // v11.13 /skills on|off|list and /mcp list|test <id> need to be handled
      // BEFORE the generic rail-opening group below (which keeps /git,
      // /prompts, /usage and /library opening their panels).
      if (cmd === 'skills') {
        return void (await get().skillsCommand(raw.slice(cmd.length + 1).trim()));
      }
      if (cmd === 'mcp') {
        return void (await get().mcpCommand(raw.slice(cmd.length + 1).trim()));
      }
      // A1 /share — self-contained dark/RTL-safe HTML report → <workspace>/.surnia/share/
      if (cmd === 'share') {
        const sess = get().session;
        if (!sess) return;
        const tt = slashT(ar);
        const html = buildShareHtml(sess, { ar, proof: get().proof, usage: get().sessionUsage });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // filesystem-safe ts
        const fallbackDownload = () => {
          downloadBlob(html, `session-${stamp}.html`, 'text/html;charset=utf-8');
          get().notify(tt('slash.share.downloaded', 'Share page downloaded (HTML)'));
        };
        if (!s.wsPath) return fallbackDownload();
        const file = wsJoin(s.wsPath, '.surnia', 'share', `session-${stamp}.html`);
        try {
          await api.writeFile(file, html);
          get().notify(tt('slash.share.written', 'Share page saved to {path}', { path: file }));
        } catch {
          fallbackDownload();
        }
        return;
      }
      if (cmd === 'init') {
        if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
        const userMsg: ChatMessage = { id: uid(), role: 'user', kind: 'text', content: '/init', timestamp: Date.now() };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, userMsg] } : null });
        return void get().runAgent('init');
      }
      if (cmd === 'compact') return void get().compact();
      if (cmd === 'plan') {
        // BUG FIX — this used to call setMode('plan') (permission radiogroup)
        // only, so the BUILD/PLAN/DEBUG/REVIEW strip never changed and the
        // engine kept the previous TASK posture. Switch the task mode (which
        // also drives the read-only plan protocol in the engine), keep the
        // permission posture in sync, and let setTaskMode() post the visible
        // bilingual notice row.
        get().setTaskMode('plan');
        return get().setMode('plan');
      }
      if (cmd === 'effort') {
        const agent = s.settings.agent ?? {};
        const next = agent.effort === 'deep' ? 'standard' : 'deep';
        get().updateSettings({ agent: { ...agent, effort: next } });
        const msg: ChatMessage = {
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content:
            next === 'deep'
              ? ar
                ? 'التفكير العميق مُفعّل — ميزانية خطوات مضاعفة وتفكير معمّق قبل الكتابة.'
                : 'Deep effort ON — 2× step budget and thinking-first execution.'
              : ar
                ? 'التفكير العميق مُعطّل — الوضع القياسي.'
                : 'Deep effort OFF — standard mode.',
          timestamp: Date.now(),
        };
        return set({ session: s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null });
      }
      if (cmd === 'context') {
        // v11.11 (A6) — EXACT context math, same formula as the bar:
        // (last prompt incl. cache + its generated tokens) / context window.
        // The old code divided the SESSION SUM by the window — a number that
        // grows every turn and never meant window occupancy.
        const lastTurn = get().lastTurnUsage;
        const fill = ctxFillTokens(lastTurn);
        const cacheRead = lastTurn?.cacheReadTokens ?? 0;
        const cacheWrite = lastTurn?.cacheCreationTokens ?? 0;
        let windowTokens = get().ctxWindow;
        let estimated = get().ctxWindowEstimated;
        if (!(windowTokens > 0)) {
          try {
            const info = await api.modelInfo(s.settings.model.model);
            windowTokens = info.contextWindow || 0;
            estimated = info.ctxEstimated === true;
          } catch {
            /* model info unavailable — degrade gracefully */
          }
        }
        const pct = windowTokens > 0 ? Math.min(100, (fill / windowTokens) * 100) : 0;
        const lines = [
          ar ? 'تفصيل نافذة السياق:' : 'Context window breakdown:',
          '• ' + (ar ? 'حجم السياق الحالي' : 'current context') + `: ${fill.toLocaleString()} tok` +
            (lastTurn?.estimated === true ? ' (≈)' : ''),
          '• ' + (ar ? 'منها من الكاش' : 'of which cached') + `: ${cacheRead.toLocaleString()} tok` +
            (cacheWrite > 0 ? ` + ${cacheWrite.toLocaleString()} ${ar ? 'كتابة كاش' : 'cache write'}` : ''),
          windowTokens > 0
            ? '• ' + (ar ? 'الاستخدام' : 'used') + `: ${fill.toLocaleString()} / ${windowTokens.toLocaleString()} tok · ${pct.toFixed(1)}%` +
              (estimated ? ' (≈ ' + (ar ? 'النافذة تقديرية 200 ألف' : 'window estimated 200k') + ')' : '')
            : '• ' + (ar ? 'حجم النافذة غير معروف لهذا النموذج' : 'window size unknown for this model'),
          // v11.34 — the advisory now tracks the REAL 90% ceiling, not a fixed
          // 70% of a possibly-200k fallback window.
          isCompactionEligible(fill, windowTokens)
            ? '• ' + (ar ? 'النافذة شبه ممتلئة — نفّذ /compact' : 'window nearly full — run /compact')
            : '• ' + (ar ? 'الضغط التلقائي مُفعّل عند الحاجة' : 'auto-compact engages when needed'),
        ];
        const msg: ChatMessage = { id: uid(), role: 'assistant', kind: 'text', content: lines.join('\n'), timestamp: Date.now() };
        return set({ session: s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null });
      }
      // A1 /rewind — list checkpoints inline + open the click-to-restore picker
      // (was: blind restore of the newest checkpoint; now the user chooses).
      if (cmd === 'rewind') {
        if (!s.wsPath) return get().notify(ar ? 'افتح مجلداً أولاً' : 'Open a folder first');
        const tt = slashT(ar);
        try {
          const cps = await api.cpList(s.wsPath);
          if (!cps.length) {
            appendAssistantRow(get, tt('slash.rewind.empty', 'No checkpoints yet — they are created automatically before edits.'));
            return;
          }
          // inline transcript list (informational) — newest first, ≤ 8 rows
          const rows = cps.slice(0, 8).map(
            (cp, i) =>
              `• ${cp.label} — ${new Date(cp.at).toLocaleTimeString()} · ` +
              tt('slash.rewind.files', '{n} files', { n: cp.fileCount }) +
              (i === 0 ? ` (${tt('slash.rewind.latest', 'latest')})` : ''),
          );
          appendAssistantRow(
            get,
            '⏪ ' + tt('slash.rewind.list', 'Checkpoints ({n})', { n: cps.length }) + '\n' +
              rows.join('\n') + '\n' +
              tt('slash.rewind.pick', 'Pick a checkpoint to restore — files go back, the conversation stays.'),
          );
          set({ rewindPicker: cps });
        } catch {
          get().notify(tt('slash.rewind.failed', 'Restore failed'));
        }
        return;
      }
      // v11.7 — PANEL SLASH COMMANDS: /prompts /git /mcp /skills /usage
      // /library /settings were registered in the Composer's slash menu but had
      // NO store handler — typing one (without picking from the menu) fell
      // through to the model as literal text ("weird replies to /commands").
      // Every registered command now executes; none can reach the model.
      if (cmd === 'prompts' || cmd === 'git' || cmd === 'usage' || cmd === 'library') {
        return set({ rail: cmd, sidebarOpen: true });
      }
      if (cmd === 'settings') return get().setSettings(true);
      // unknown slash -> treat as normal text
    }

    // v2.4 — the daily-run paywall gate is GONE. The app is in a free season:
    // no message is ever swallowed, no plans screen ever pops mid-chat.
    // Billing is visibility-only (see billingService FREE_SEASON).

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      kind: 'text',
      // v6 — pending artifact comments ride along with this message
      // (Antigravity pending-comment chips), then the queue clears.
      // v11.7 — slash templates (/pr /tests /grill …) expand to rich hidden
      // prompts: the TRANSCRIPT shows the short command the user actually
      // typed (displayAs), the model receives the full expansion.
      content: displayAs?.trim()
        ? displayAs.trim()
        : get().artifactComments.length
          ? `${raw}\n\n[artifact feedback]\n${get()
              .artifactComments.map((c, i) => `${i + 1}. ${c}`)
              .join('\n')}`
          : raw,
      timestamp: Date.now(),
      ...(images && images.length ? { images } : {}),
    };
    if (get().artifactComments.length) set({ artifactComments: [] });
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, messages: [...session.messages, userMsg] } });
    if (session.messages.length === 0 && session.title) {
      const titleSrc = displayAs?.trim() || raw;
      const title = titleSrc.slice(0, 48) + (titleSrc.length > 48 ? '…' : '');
      set({ session: { ...get().session!, title } });
    }
    // v11.16 — reset proof at EVERY send, before runAgent can bail out early
    // (no folder / no key / already running). A plain chat can therefore never
    // inherit the previous turn's proof strip, even on a rejected send.
    get().resetProofForTurn();
    await get().runAgent('chat');
  },

  // ---------------- /goal + /compact (real effects, visible feedback) ----------------
  setGoal: async (goal) => {
    const ar = get().settings.language === 'ar';
    const session = get().session;
    const text = String(goal ?? '').trim();
    if (!session) {
      get().notify(ar ? 'ابدأ جلسة أولاً' : 'Open a session first');
      return;
    }
    if (!text) {
      const g = get().activeGoal;
      appendAssistantRow(
        get,
        g
          ? (ar ? 'الهدف الحالي: ' : 'Active goal: ') + `“${g.goal}”` + (g.pct !== undefined ? ` — ${g.pct}%` : '')
          : ar
            ? 'لا يوجد هدف نشط. اكتب ‎/goal <الهدف> لتحديد هدف يتتبعه الوكيل.'
            : 'No active goal. Type /goal <objective> to set a goal the agent will track.',
      );
      return;
    }
    try {
      if (api.goalSet) await api.goalSet(session.id, text);
    } catch {
      /* bridge unavailable — the local banner + transcript still land */
    }
    set({ activeGoal: { goal: text } });
    appendAssistantRow(get, (ar ? 'تم تعيين الهدف: ' : 'Goal set: ') + `“${text}”`);
    get().notify(ar ? `تم تعيين الهدف: ${text}` : `Goal set: ${text}`);
  },
  compact: async () => {
    const ar = get().settings.language === 'ar';
    if (!get().session) {
      get().notify(ar ? 'ابدأ جلسة أولاً' : 'Open a session first');
      return;
    }
    if (get().running) {
      get().notify(ar ? 'الوكيل مشغول — انتظر اكتمال المهمة' : 'Agent is busy — wait for the current run');
      return;
    }
    // Show the command in the transcript AND a toast immediately; the engine
    // then emits compaction/compaction_done, which adds the summary row.
    appendAssistantRow(get, ar ? 'جارٍ ضغط السياق…' : 'Compacting context…', 'compaction');
    get().notify(ar ? 'جارٍ ضغط السياق…' : 'Compacting context…');
    await get().runAgent('compact');
  },

  runAgent: async (task: 'chat' | 'compact' | 'init') => {
    const s = get();
    // v11.22 — canonical, monolingual failure copy. The SELECTED language
    // wins; the inline strings are only fallbacks for an older i18n bundle.
    const t = slashT(s.settings.language === 'ar');
    if (!s.session || s.running) return;
    if (!s.wsPath) {
      s.notify(s.settings.language === 'ar' ? 'افتح مجلداً أولاً' : 'Open a folder first');
      return;
    }
    // v11.22 (A6) — resolve a VALID model BEFORE any visible state changes.
    // A half-written `settings.model` ({ provider } with no `model` id) was
    // sent to the bridge as "Invalid run parameters (missing messages or
    // model)". Validating up front also avoids stranding `running:true` when
    // the user genuinely has no model configured.
    const earlyModel = resolveRunModel(s.settings);
    if (!earlyModel) {
      s.notify(t(
        'err.setup.noModel',
        'No model is selected. Open Settings → AI providers and choose a model, then send your message again.',
      ));
      return;
    }
    const prov = s.settings.providers[earlyModel.provider];
    const preset = PROVIDER_PRESETS[earlyModel.provider];
    if (!preset?.keyless && !prov?.apiKey && earlyModel.provider !== 'custom') {
      s.notify(t('err.setup.noApiKey', 'This provider has no API key. Open Settings → AI providers and add a key for the provider, then try again.'));
      s.setSettings(true, 'providers');
      return;
    }
    if (earlyModel.provider === 'custom' && !prov?.baseUrl) {
      s.notify(s.settings.language === 'ar' ? 'اضبط عنوان الخدمة للمزود المخصص' : 'Set the base URL for the custom provider');
      s.setSettings(true, 'providers');
      return;
    }

    // usage log run counter
    const today = todayStr();
    const log = [...(s.settings.usageLog || [])];
    const i = log.findIndex((e) => e.date === today);
    if (i >= 0) log[i] = { ...log[i], runs: log[i].runs + 1 };
    else log.push({ date: today, runs: 1, tokens: 0, costUsd: 0 });
    get().updateSettings({ usageLog: log });

    // v11.20 (A1) — IMMEDIATE visible state at the EXACT press moment, before
    // any engine event. The founder saw a blank screen after sending: the
    // strip must appear synchronously and the elapsed clock must start here,
    // not when the first liveness/token event finally crosses the IPC bridge.
    const pressAt = Date.now();
    set({
      running: true,
      todos: [],
      lastTaskReport: null,
      continueHint: null,
      runRecovery: null,
      resumableRun: null,
      runStartedAt: pressAt,
      runActivity: { phase: 'preparing', startedAt: pressAt, at: pressAt },
      runPhase: 'preparing',
    });
    // v11.15 — proof is PER-TURN: drop any gates/evidence from the previous
    // run so a pure chat answer can never inherit a stale proof strip.
    get().resetProofForTurn();
    writeResumeMarker({
      task,
      sessionId: s.session.id,
      workspace: s.session.worktree?.path || s.wsPath,
    });
    startRunWatchdog();
    try {
      // v11.22 (A6) — FRESH read at the exact IPC boundary. `s` was captured
      // before the usage-log write / liveness set / proof reset; every set()
      // there (and any concurrent model/message update in the gap) leaves it
      // stale. Rebuild the ENTIRE payload from the live store so messages /
      // model / sessionId / workspace can never be from a prior snapshot.
      const fresh = get();
      const session = fresh.session ?? s.session;
      if (!session) {
        set({ running: false, runRecovery: null, ...clearedRunActivity() });
        fresh.notify(fresh.settings.language === 'ar' ? 'انتهت الجلسة — افتح جلسة أولاً' : 'Session closed — open a session first');
        return;
      }
      // Re-validate against the fresh settings; if the gap corrupted them, the
      // model resolved before the visible-state writes is the safe fallback.
      const runModel = resolveRunModel(fresh.settings) ?? earlyModel;
      const nowMs = Date.now();
      // synthetic UI rows (verify/compaction/subagent/review meta) and the
      // engine-side steer/queue injections never go back to the model
      let messages: ChatMessage[] = session.messages
        .filter((m) => !m.id.startsWith('sys:') && m.model !== 'steer' && m.model !== 'queued')
        .map((m) => ({ ...m, streaming: false }));
      if (messages.length === 0) {
        // A chat send always carries the just-appended user turn. If the
        // filter removed every row, recover the latest REAL user message.
        const latestUser = [...session.messages].reverse().find(
          (m) =>
            m.role === 'user' &&
            typeof m.id === 'string' &&
            !m.id.startsWith('sys:') &&
            m.model !== 'queued' &&
            typeof m.content === 'string' &&
            m.content.trim() !== '',
        );
        if (latestUser) {
          messages = [{ ...latestUser, streaming: false }];
        } else {
          // compact / init synthesize a REAL, non-empty instruction row.
          const content =
            task === 'compact'
              ? fresh.settings.language === 'ar'
                ? 'لخّص واضغط سياق المحادثة'
                : 'Summarize and compact the conversation context'
              : task === 'init'
                ? '/init'
                : fresh.settings.language === 'ar'
                  ? 'أكمل المهمة'
                  : 'Continue the task';
          messages = [{ id: `uid-synth-${nowMs}`, role: 'user', kind: 'text', content, timestamp: nowMs } as ChatMessage];
        }
      }
      await api.agentRun({
        task,
        sessionId: session.id,
        messages,
        model: runModel,
        mode: fresh.settings.permissionMode,
        taskMode: fresh.taskMode,
        // v10.2 — Codex-style: a chat pinned to a worktree RUNS in it
        // (isolated checkout), not in the main tree.
        workspace: session.worktree?.path || fresh.wsPath,
        mcpServers: (fresh.settings.mcpServers || []).filter((m) => m.enabled),
      });
    } catch (err) {
      stopRunWatchdog();
      // v11.31 — the bridge rejected the run BEFORE it started. The durable
      // resume marker was already written above; leaving it behind offered a
      // "resume" chip on the next launch for a run that never existed. Close
      // the run lifecycle here too: drop the marker + lock out late events.
      clearResumeMarker();
      liveStreamChars = 0;
      runClosed = true;
      closedSession = get().session;
      runFailed = true;
      // v11.19 — translate classified provider errors into the SELECTED
      // language only. Never show EN+AR together (founder complaint). A
      // translated toast is the ONLY feedback for 402 — never also push the
      // raw English JSON as a model:'error' transcript row.
      const raw = String(err ?? '');
      const ar = s.settings.language === 'ar';
      // v11.23 — classify EVERY bridge rejection (not just 402) into the
      // selected language so a raw "Invalid run parameters (missing messages
      // or model)" can never reach the founder untranslated or EN+AR mixed.
      const friendly = noCreditsToast(raw, ar) ?? localizeRunError(raw, ar);
      set({
        running: false,
        steerPending: false,
        runRecovery: null,
        resumableRun: null,
        liveStreamChars: 0,
        ...clearedRunActivity(),
      });
      if (get().notice !== friendly) get().notify(friendly);
    }
  },

  ingestAgentEvent: (e) => {
    // v11.14 (INGEST HARDENING) — the IPC boundary is untrusted: a malformed or
    // forward-compatible event (newer engine emits a type this renderer does
    // not know yet) must NEVER throw here. This listener is the single choke
    // point for the whole stream — one throw aborts the current event's state
    // update (buffered deltas never flush → "thinking stops") and floods the
    // console on every subsequent event.
    if (!e || typeof e.type !== 'string') return;
    // v11.26 — a new run is armed by the running:false → true edge. Every
    // terminal report clears `running`, so `running:true` + a latched final
    // report can only mean a NEW task (sendMessage / resume / a test harness
    // seeding a fresh run). Re-arm before any stale-event guard drops it.
    if (runReport.final && get().running) {
      runReport = freshRunReport(get().runStartedAt ?? Date.now());
      rrWriteByCall = {};
      rrCmdByCall = {};
      pendingWebPreview = null;
      enginePreviewRequested = false;
      previewUserClosed = false;
    }
    // v11.23 — `turn_end` is the HARD end of a run. Anything crossing the IPC
    // boundary after it belongs to a dead run: ingesting it reopens streaming
    // bubbles, flips `running`, or paints a second summary card at random
    // (the founder's "random errors in chat"). A new run is armed by
    // resetProofForTurn(); external code that sets `running:true` directly is
    // recognized here too (keeps the store test harness honest).
    if (runClosed) {
      const freshRun = get().running || get().session !== closedSession;
      if (!freshRun) return; // stale — drop it, never touch state
      runClosed = false;
      closedSession = null;
      runFailed = false;
      runAborted = false;
      // v11.26 — a fresh run gets a fresh report ledger + fresh preview decision.
      runReport = freshRunReport(get().runStartedAt ?? Date.now());
      rrWriteByCall = {};
      rrCmdByCall = {};
      pendingWebPreview = null;
      enginePreviewRequested = false;
      previewUserClosed = false;
    }
    // v11.26 — the written report latches `final`: a LATE terminal event may
    // never add a second card or re-write the report. Non-terminal traffic is
    // still governed by the existing `runClosed` (turn_end) guard, which is
    // what actually closes a run — a task_report can arrive just before it.
    if (runReport.final && (e.type === 'error' || e.type === 'aborted' || e.type === 'task_report')) return;
    // v11.23 — ONE safety net around the entire ingest. A single malformed
    // payload must never abort this event's state update: the token buffer
    // would stay stranded ("thinking stops") and a terminal event could leave
    // `running:true` forever. The catch below is the last line of defence.
    try {
      // v12 (RECOVERY) — every agent event proves the run is alive. On terminal
      // events stop the watchdog outright so it can never force-clear a run that
      // already delivered its report.
      noteAgentActivity();
      // v11.26 — fold this event into the per-run evidence ledger BEFORE any
      // terminal decision: a missing engine report is then rebuilt from the
      // files/commands/outcome actually seen (never invented).
      noteRunEvidence(e);
      if (e.type === 'turn_end' || e.type === 'error' || e.type === 'aborted' || e.type === 'task_report') {
        stopRunWatchdog();
        clearResumeMarker(); // the run reached a terminal state — nothing to resume
        if (get().runRecovery) set({ runRecovery: null });
      }
      // v12 (CONTINUITY) — a heartbeat is a PURE liveness pulse: reset the
      // watchdog and return. It never touches the transcript, so a quiet engine
      // (compacting / retrying / awaiting approval) can never look disconnected.
      if (e.type === 'heartbeat') return;
      // v3.2 — ordering: structural events must see (and land after) any
      // coalesced text. v12 — think_delta is EXEMPT too: flushing on every
      // thinking token caused one React state update per token (choppy/hot).
      if (e.type !== 'text_delta' && e.type !== 'think_delta') flushPendingDelta();
      // v7.2 — Proof Ribbon: fold gate/verdict events into the run-wide proof
      // state BEFORE the transcript switch (pure state update, no message rows).
      // v11.23 — even a pure fold can be handed a malformed payload; isolate it
      // so it can never swallow the transcript/terminal update below.
      try { ingestProofEvent(e); } catch { /* proof is best-effort; never stall the stream */ }
    const st = get();
    const session = st.session;
    // v11.12 (A4-CLOSURE) — TERMINAL events are never dropped, even when no
    // session is loaded: the running-flag and the report MUST land, or the UI
    // stays "running" forever and every next send silently no-ops (the
    // founder's "it hangs and nothing happens").
    if (!session) {
      const ar = st.settings.language === 'ar';
      if (e.type === 'task_report') {
        const report = reportSliceFromEvent(e, ar, runReport.errorKey ?? undefined);
        set({ running: false, steerPending: false, ...clearedRunActivity(), lastTaskReport: report });
        runReport.final = true;
        // v11.28 — no transcript to render into, so the written report IS the
        // one toast. Deduped per run so a later turn_end cannot double it.
        rrEmitReportToast(report, ar);
        rrFlushAutoPreview();
      } else if (e.type === 'error') {
        // No transcript to render into — still publish an HONEST report slice
        // so the title bar / toast never claim a successful run. A later real
        // task_report may still replace this with the engine's fuller report.
        const report = rrSynthesize('error', ar);
        set({ running: false, steerPending: false, ...clearedRunActivity(), lastTaskReport: report });
        rrFlushAutoPreview();
      } else if (e.type === 'turn_end' || e.type === 'aborted') {
        // v11.26 — even with no transcript, a silent/aborted end MUST publish a
        // written report slice and clear `running`.
        if (!runReport.final) {
          const report = rrSynthesize(runReport.outcome, ar);
          set({
            running: false,
            steerPending: false,
            ...clearedRunActivity(),
            lastTaskReport: report,
          });
          runReport.final = true;
          rrEmitReportToast(report, ar);
          rrFlushAutoPreview();
        } else {
          set({ running: false, steerPending: false, ...clearedRunActivity() });
        }
      }
      // v11.23 — terminal guard applies with no session too: a late event from
      // the dead run must not reopen anything once a session is loaded later.
      if (e.type === 'turn_end') {
        runClosed = true;
        closedSession = get().session; // null here — a fresh session resets the guard
      }
      return;
    }
    const msgs = [...session.messages];

    switch (e.type) {
      case 'text_delta': {
        // rAF-batched: append to the module buffer; ONE flush joins all
        // pending text into a single state update (no per-token set()).
        // v11.14 — a missing/non-string `text` must not throw before the
        // flush is scheduled (that would strand the buffer and stall the
        // stream mid-token).
        const text = typeof e.text === 'string' ? e.text : '';
        if (!text) return;
        pendingDelta += text;
        liveStreamChars += text.length; // v11.10 (A5) — live ≈ estimate counter
        scheduleDeltaFlush();
        return;
      }
      case 'think_delta': {
        // v11.3 — reasoning joins its own buffer: it renders in the
        // dedicated thinking block, never inside the answer text.
        const text = typeof e.text === 'string' ? e.text : '';
        if (!text) return;
        pendingThink += text;
        liveStreamChars += text.length; // v11.10 (A5) — thinking occupies the window too
        scheduleDeltaFlush();
        return;
      }
      case 'sys_notice': {
        // v11.20 (A1) — run_start / liveness / preparing are LIVENESS notices:
        // refine the immediate activity strip, but NEVER reset startedAt —
        // the elapsed clock belongs to the exact send press, not this event.
        const noticeKind = typeof e.kind === 'string' ? e.kind.toLowerCase() : '';
        if (
          get().running &&
          (noticeKind === 'run_start' || noticeKind === 'liveness' || noticeKind === 'preparing')
        ) {
          const cur = get().runActivity;
          const startedAt = get().runStartedAt ?? cur?.startedAt ?? Date.now();
          const phase: RunActivityPhase =
            noticeKind === 'preparing'
              ? 'preparing'
              : noticeKind === 'run_start'
                ? 'working'
                : (cur?.phase ?? 'working');
          set({
            runActivity: {
              phase,
              startedAt,
              at: Date.now(),
              ...(typeof e.text === 'string' && e.text.trim()
                ? { note: e.text.trim().slice(0, 160) }
                : cur?.note
                  ? { note: cur.note }
                  : {}),
            },
            runPhase: phase,
          });
        }
        // v11.3 — harness notices (gates/verifiers/compaction/progress) are
        // DEDICATED chip rows: clean, deduped, never interleaved with the
        // answer. The engine already dedupes per run; this second guard
        // keeps legacy double-emit paths honest.
        const noticeText = typeof e.text === 'string' ? e.text.trim() : String(e.text ?? '').trim();
        if (!noticeText) break;
        const nKey = `${e.kind ?? 'sys'}::${noticeText}`;
        const recent = msgs.filter((m) => m.kind === 'notice').slice(-40);
        if (recent.some((m) => `${m.noticeKind ?? 'sys'}::${m.content.trim()}` === nKey)) break;
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'notice',
          noticeKind: e.kind,
          content: noticeText,
          timestamp: Date.now(),
        });
        break;
      }
      case 'tool_start': {
        const last = msgs[msgs.length - 1];
        if (last && last.streaming) msgs[msgs.length - 1] = { ...last, streaming: false };
        msgs.push({
          id: uid(),
          role: 'tool',
          kind: 'tool_call',
          toolName: e.name,
          toolCallId: e.toolCallId,
          content: typeof e.args === 'string' ? e.args : JSON.stringify(e.args ?? {}),
          timestamp: Date.now(),
        });
        break;
      }
      case 'tool_result': {
        const idx = msgs.findIndex((m) => m.toolCallId === e.toolCallId && m.kind === 'tool_call');
        msgs.push({
          id: uid(),
          role: 'tool',
          kind: 'tool_result',
          toolCallId: e.toolCallId,
          toolName: idx >= 0 ? msgs[idx].toolName : undefined,
          content: e.output,
          resultOk: e.ok,
          timestamp: Date.now(),
        });
        break;
      }
      case 'message_end': {
        // v11.9 S5 (cross-team) — the engine now reports thinkMs (integer ms ≥ 0)
        // in the message_end payload; ride it onto the finalized assistant row.
        // The streaming sanitizers (S1–S3) never touch it, so it persists.
        const rawThinkMs = (e as { thinkMs?: unknown }).thinkMs;
        const thinkMs =
          typeof rawThinkMs === 'number' && Number.isFinite(rawThinkMs) && rawThinkMs >= 0
            ? rawThinkMs
            : undefined;
        // v11.16 (FINAL AUDIT) — `usage` is untrusted IPC. The pure helpers below
        // are NOT defensive: runUsageView() calls `.some()` on `usage.attempts`
        // and accumulateUsage() SPREADS it, so a non-array `attempts` (fuzz:
        // number / string / object) threw HERE and dropped the entire finalize
        // update — the "thinking stops" symptom family. Normalize ONCE, locally
        // (never mutate the event) so every downstream read sees a safe shape.
        const rawUsage = e.usage;
        const usage = (
          rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
            ? {
                ...rawUsage,
                // runUsageView() calls `.some(a => a.estimated)` on every element
                // and accumulateUsage() spreads the array — so BOTH a non-array
                // `attempts` and a null element inside one threw here. Filter to
                // real objects; an absent/invalid breakdown is honest (no rows).
                attempts: Array.isArray((rawUsage as { attempts?: unknown }).attempts)
                  ? (rawUsage as { attempts: unknown[] }).attempts.filter(
                      (a): a is UsageAttempt => !!a && typeof a === 'object',
                    )
                  : undefined,
              }
            : rawUsage
        ) as typeof rawUsage;
        // v11.10 (A5) — the ROW gets the BILLING view (whole-turn run totals:
        // all continuation rounds + all retry/failover attempts — the real
        // money, with the honesty marker), while lastTurnUsage keeps the raw
        // per-turn DELTA (the context bar's true window occupancy).
        const runView = usage
          ? (runUsageView(usage) as NonNullable<ChatMessage['usage']>)
          : undefined;
        /** Close one assistant row: streaming off + usage/thinkMs attached +
         *  the engine-internal GOAL_COMPLETE marker stripped from the content
         *  (S6 — renderer copy). */
        const finalizeRow = (idx: number): void => {
          const m = msgs[idx];
          const row: ChatMessage & { thinkMs?: number } = {
            ...m,
            streaming: false,
            usage: runView ?? m.usage,
            content: stripGoalComplete(m.content),
            ...(thinkMs !== undefined ? { thinkMs } : {}),
          };
          msgs[idx] = row;
        };
        // v11.9 S1 — clear streaming on EVERY assistant row that has it: steer/
        // queued rows can sit below the live bubble and the old last-row-only
        // check missed it, leaving a blinking cursor forever. Fast path: clear
        // by the tracked streaming id; fall back to a full walk when unknown.
        let finalized = false;
        if (streamingMsgId != null) {
          const i = msgs.findIndex((m) => m.id === streamingMsgId && m.role === 'assistant');
          if (i >= 0) {
            finalizeRow(i);
            finalized = true;
          }
        }
        if (!finalized) {
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m.role === 'assistant' && m.streaming) finalizeRow(i);
          }
        }
        streamingMsgId = null;
        if (usage) {
          // v11.10 (A5) — GUARANTEED single-row attachment: a turn with no
          // streaming assistant row (tool-only turns, error-only turns) used to
          // drop its usage from the per-message view while the session totals
          // still counted it — the books didn't balance. attachTurnUsage finds
          // the honest owner row (last assistant → last tool_call → synthetic)
          // so sum(per-message usage) == sessionUsage ALWAYS reconciles.
          const hasSpend =
            usage.inputTokens > 0 ||
            usage.outputTokens > 0 ||
            (usage.runCost ?? usage.costUsd) > 0;
          if (!finalized && hasSpend && runView) {
            attachTurnUsage(msgs, runView);
          }
          // Billing accumulator: run view (falls back to the delta for older
          // payloads) — per-message rows and this total share one function.
          const su = accumulateUsage(st.sessionUsage, runView ?? usage);
          // v11.3 — lastTurnUsage is the per-turn DELTA: each turn re-sends the
          // whole transcript, so the newest inputTokens (+ cache split, which
          // is ALREADY inside inputTokens — A5 fixed the old double-count)
          // measures the real window usage. The cumulative sessionUsage stays
          // for cost/billing only — it must never drive the context ring.
          // The live ≈ estimate is replaced by the EXACT provider figure here.
          set({ sessionUsage: su as AppState['sessionUsage'], lastTurnUsage: { ...usage }, liveStreamChars: 0 });
          const rvTokens = (runView ?? usage).inputTokens + (runView ?? usage).outputTokens;
          const rvCost = (runView ?? usage).costUsd;
          const today = todayStr();
          const log = [...(st.settings.usageLog || [])];
          const i = log.findIndex((x) => x.date === today);
          if (i >= 0)
            log[i] = {
              ...log[i],
              tokens: log[i].tokens + rvTokens,
              costUsd: Math.round((log[i].costUsd + rvCost) * 1e6) / 1e6,
            };
          else log.push({ date: today, runs: 0, tokens: rvTokens, costUsd: rvCost });
          // v3.2 perf — usageLog stays in memory here: updateSettings would
          // hit settings.json EVERY turn. In-memory set + 10s-batched persist
          // (flushUsageLog also runs synchronously on turn_end/error/aborted).
          set({ settings: { ...st.settings, usageLog: log } });
          scheduleUsagePersist();
        } else {
          set({ liveStreamChars: 0 }); // v11.10 (A5) — no usage payload: kill the ≈ estimate
        }
        break;
      }
      case 'todo':
        set({ todos: e.todos });
        break;
      case 'goal_progress':
        // engine reports live goal progress — the GoalBanner reads this
        set({ activeGoal: { goal: e.goal, pct: e.pct } });
        break;
      case 'goal_done':
        set({ activeGoal: null });
        st.notify(
          (st.settings.language === 'ar' ? 'تحقّق الهدف: ' : 'Goal achieved: ') + e.goal,
        );
        break;
      case 'approval_request': {
        const pa = {
          requestId: e.requestId,
          kind: e.kind,
          title: e.title,
          detail: e.detail,
          toolName: e.payload?.toolName,
          // v11.10 — the command line rides along so decideApproval can
          // derive the per-tool "always" scope (founder complaint #1).
          command: typeof e.payload?.command === 'string' ? e.payload.command : undefined,
          // v3.1 — ask_user questions carry choice buttons + free-text flag.
          choices: e.payload?.choices,
          allowText: e.payload?.allowText,
        };
        set({ pendingApproval: pa });
        if (e.kind === 'write' && e.payload && typeof e.payload.path === 'string') {
          set({
            diffView: {
              title: e.title,
              path: e.payload.path,
              oldText: e.payload.oldText ?? '',
              newText: e.payload.newText ?? '',
              approvalRequestId: e.requestId,
            },
          });
        }
        break;
      }
      case 'plan_ready': {
        // v2.1: structured plan (propose_plan / plan-mode run) — raw text is
        // the fallback when the engine sends only the legacy string payload.
        // v11.12 (A4-GUARANTEE): the plan is ALSO a transcript row — the
        // proposal card is ephemeral (approval clears it, reload drops it);
        // the conversation keeps an honest record of every plan produced.
        const raw = typeof e.plan === 'string' ? e.plan : '';
        const lines = raw
          .split('\n')
          .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
          .filter(Boolean);
        // HARDENING: an untrusted IPC payload may send a non-array `steps`
        // (fuzz event #242) — never call .join/.map on it; a throw here drops
        // the whole event update (the "thinking stops" symptom family).
        const steps: string[] = Array.isArray(e.steps)
          ? e.steps.filter((s): s is string => typeof s === 'string')
          : typeof e.steps === 'string'
            ? [e.steps]
            : (e.title ? lines : lines.slice(1));
        const planBody = raw.trim() || steps.join('\n');
        set({
          planProposal: {
            title: e.title ?? lines[0] ?? 'Implementation plan',
            steps: steps.length > 0 ? steps : raw.trim() ? [raw.trim()] : [],
            risks: Array.isArray(e.risks) ? e.risks.filter((r): r is string => typeof r === 'string') : [],
            raw,
          },
        });
        if (planBody) {
          closeStreamingAssistant(msgs);
          msgs.push({
            id: uid(),
            role: 'assistant',
            kind: 'text',
            content: planBody,
            model: 'plan-note',
            timestamp: Date.now(),
          });
        }
        break;
      }
      case 'task_mode': {
        // v11.12 (A4-GUARANTEE) — engine → strip sync: a /slash mode switch
        // updates the SAME strip state the next run sends back as a param, so
        // the visible mode is always the mode that runs.
        set({ taskMode: e.taskMode });
        break;
      }
      // ---------- v2.1 engine events (chat/control D2) ----------
      case 'steer_injected': {
        // rendered as an amber note row (MessageView special-cases model:'steer')
        // v11.9 S4 — the steer row CLOSES the streaming assistant bubble at
        // insert time so the next delta opens a NEW bubble below the steer
        // (old answer stays, new answer follows the new instruction).
        closeStreamingAssistant(msgs);
        msgs.push({
          id: uid(),
          role: 'user',
          kind: 'text',
          content: e.text,
          model: 'steer',
          timestamp: Date.now(),
        });
        set({ steerPending: false });
        break;
      }
      case 'doom_loop': {
        // informational — the actionable dialog arrives as an approval_request
        // with kind 'doom_loop'; the ChatPanel card special-cases the copy.
        st.notify(
          st.settings.language === 'ar'
            ? `تكرار أداة: ${e.tool} ×${e.count} — بانتظار قرارك`
            : `Repeating tool call: ${e.tool} ×${e.count} — awaiting your decision`,
        );
        break;
      }
      // v11.27 — the `dna_note` tool writes dna.json and emits this EVENT but
      // never fires kdx:dna:event, so the UI stayed stale until restart. Reload
      // DNA here too — no transcript message, just a silent honest refresh.
      case 'dna_updated': {
        void get().loadDna();
        break;
      }
      case 'verify_run': {
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ cmd: e.cmd, exitCode: e.exitCode, outputTail: e.outputTail }),
          model: 'verify',
          timestamp: Date.now(),
        });
        break;
      }
      case 'review_findings': {
        // v11.14 — a review that produced no findings can arrive with the
        // array missing. Normalize ONCE so neither the store slice, the
        // transcript row nor the chip can throw on `.length` later.
        const findings = Array.isArray(e.findings) ? e.findings : [];
        set({ lastReview: { findings, summary: e.summary } });
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ findings, summary: e.summary }),
          model: 'review-findings',
          timestamp: Date.now(),
        });
        st.notify(
          (st.settings.language === 'ar' ? 'اكتملت المراجعة: ' : 'Review complete: ') +
            `${findings.length} ${st.settings.language === 'ar' ? 'ملاحظة' : 'findings'}`,
        );
        break;
      }
      case 'skill_created': {
        st.notify(
          (st.settings.language === 'ar' ? 'حُفظت مهارة جديدة: ' : 'Skill saved: ') + e.name,
        );
        void get().loadSkills();
        break;
      }
      case 'goal_verified': {
        // v6 — the evidence-based verifier confirmed the goal before goal_done.
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ goal: e.goal }),
          model: 'goal-verified',
          timestamp: Date.now(),
        });
        break;
      }
      case 'critic_verdict': {
        // v6 — adversarial critic verdict chip (fullAccess runs).
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ findings: e.findings, critical: e.critical, summary: e.summary }),
          model: 'critic',
          timestamp: Date.now(),
        });
        break;
      }
      case 'run_receipt': {
        // v6 — end-of-run proof-of-work card.
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({
            files: e.files,
            commands: e.commands,
            rounds: e.rounds,
            verifyFailed: e.verifyFailed,
            durationMs: e.durationMs,
          }),
          model: 'receipt',
          timestamp: Date.now(),
        });
        break;
      }
      case 'task_report': {
        // v11.11 (A4-CLOSURE) — THE GUARANTEED COMPLETION REPORT. Emitted once
        // on every terminal path before turn_end. v11.28 — the founder wants
        // NO report card in chat: the full slice stays in `lastTaskReport`
        // (programmatic /report use) and ONE localized toast carries the real
        // outcome + summary + file/command/duration counts to the user.
        // Normalize the payload too: a null `files` or string `nextSteps` from
        // the bridge must never poison the toast.
        const report = reportSliceFromEvent(e, st.settings.language === 'ar', runReport.errorKey ?? undefined);
        // A report IS terminal: publish the slice + single toast, latch `final`
        // (late events can no longer emit a stale one) and clear `running` even
        // if turn_end is lost at the IPC boundary.
        const incomplete =
          report.partial === true ||
          report.outcome !== 'completed' ||
          (typeof report.stopReason === 'string' && report.stopReason.length > 0 && report.stopReason !== 'completed');
        rrCommitInto(
          msgs,
          report,
          true,
          incomplete ? (report.outcome === 'error' || report.outcome === 'aborted' ? 'error' : 'truncated') : undefined,
        );
        set({ running: false, steerPending: false, ...clearedRunActivity() });
        rrFlushAutoPreview();
        break;
      }
      case 'claim_audit': {
        // v7 — claim→evidence audit chip: unevidenced claims flagged.
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ summary: e.summary, unsupported: e.unsupported, claims: e.claims }),
          model: 'claim-audit',
          timestamp: Date.now(),
        });
        break;
      }
      case 'mutation_check': {
        // v7 — tests-honesty probe chip.
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ honest: e.honest, detail: e.detail }),
          model: 'mutation-check',
          timestamp: Date.now(),
        });
        break;
      }
      // ---------- v7.1 — Proven Change pipeline cards ----------
      case 'proof_package': {
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ id: e.id, file: e.file, verdict: e.verdict, markdown: e.markdown }),
          model: 'proof',
          timestamp: Date.now(),
        });
        break;
      }
      case 'mutation_gate': {
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ verdict: e.verdict, ran: e.ran, killed: e.killed, killRate: e.killRate, detail: e.detail }),
          model: 'mutation-gate',
          timestamp: Date.now(),
        });
        break;
      }
      case 'red_green': {
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ compliant: e.compliant, reason: e.reason }),
          model: 'red-green',
          timestamp: Date.now(),
        });
        break;
      }
      case 'fake_tests': {
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ scanned: e.scanned, high: e.high, summary: e.summary, findings: e.findings }),
          model: 'fake-tests',
          timestamp: Date.now(),
        });
        break;
      }
      // v11.27 — the founder demanded the TAINT UI row be removed with NO
      // trace. These two events no longer create any transcript message at
      // all; taint detection/escalation still works internally in electron/.
      case 'taint_escalation':
      case 'taint_notice':
        break;
      case 'false_done': {
        set({ falseDoneStats: { claimed: e.claimed, falseDone: e.falseDone, rate: e.rate } });
        break;
      }
      case 'budget_state': {
        set({ verificationBudgetLabel: e.label });
        break;
      }
      case 'wiki_stage': {
        // v6 — Repo Wiki pipeline stage toast (generation runs outside a chat run).
        st.notify(
          (st.settings.language === 'ar' ? 'الويكي: ' : 'Wiki: ') + e.stage + (e.detail ? ` · ${e.detail}` : ''),
        );
        break;
      }
      case 'compaction': {
        msgs.push({
          id: uid(),
          role: 'assistant',
          kind: 'text',
          content: JSON.stringify({ before: e.before, after: e.after }),
          model: 'compaction',
          timestamp: Date.now(),
        });
        break;
      }
      case 'playbook_learned': {
        // v11.12 — VISIBLE learning: toast + refresh the playbook timeline.
        const summary = String((e as { summary?: unknown }).summary ?? '').slice(0, 240);
        const version = Math.max(0, Math.floor(Number((e as { version?: unknown }).version) || 0));
        set({ lastPlaybookLearning: { summary, version, ts: Date.now() } });
        void get().loadPlaybook();
        const ar = st.settings.language === 'ar';
        pushToast({
          title: (ar ? 'تعلّم سادهيم: ' : 'SADEEM learned: ') + (summary || 'new lessons saved to the playbook'),
          severity: 'success',
          duration: 5600,
        });
        break;
      }
      case 'subagent_progress': {
        set((s) => ({
          subagentProgress: {
            ...s.subagentProgress,
            [e.id]: { label: e.label, done: e.done, total: e.total, step: e.step, pct: e.pct },
          },
          // Accumulate a live step timeline for the detail view. Dedupe the
          // identical (done,total) tail — progress events repeat at step edges.
          subagentSteps: {
            ...s.subagentSteps,
            [e.id]: (() => {
              const prev = s.subagentSteps[e.id] ?? [];
              const last = prev[prev.length - 1];
              if (last && last.done === e.done && last.total === e.total && last.step === e.step) return prev;
              const stamp = { at: Date.now(), done: e.done, total: e.total };
              return [...prev, { ...stamp, step: e.step, pct: e.pct }].slice(-60);
            })(),
          },
          // v11.36 — when the engine carries a real tool call on the progress
          // tick, append it. No `toolCall` on the event ⇒ no row, no invention.
          subagentToolCalls: e.toolCall
            ? { ...s.subagentToolCalls, [e.id]: mergeSubagentToolCalls(s.subagentToolCalls[e.id], [e.toolCall]) }
            : s.subagentToolCalls,
        }));
        // inline transcript progress row (updated in place per subagent id)
        const sid = `sys:subagent:${e.id}`;
        const payload = JSON.stringify({ id: e.id, label: e.label, done: e.done, total: e.total });
        const sidx = msgs.findIndex((m) => m.id === sid);
        if (sidx >= 0) msgs[sidx] = { ...msgs[sidx], content: payload, timestamp: Date.now() };
        else
          msgs.push({
            id: sid,
            role: 'assistant',
            kind: 'text',
            content: payload,
            model: 'subagent',
            timestamp: Date.now(),
          });
        break;
      }
      case 'subagent_toolcall': {
        // v11.36 — the authoritative child-session feed. Every row is a real
        // tool call the engine observed; a second event with the same
        // `toolCallId` upgrades the row (running → done/error) with real output.
        const call = e.call;
        set((s) => ({
          subagentToolCalls: {
            ...s.subagentToolCalls,
            [e.id]: mergeSubagentToolCalls(s.subagentToolCalls[e.id], [call]),
          },
          subagents: s.subagents.map((r) =>
            r.id === e.id ? { ...r, toolCalls: mergeSubagentToolCalls(r.toolCalls, [call]) } : r,
          ),
        }));
        break;
      }
      case 'queued_count': {
        // queue drain feedback — reconcile the local dismissible-chip mirror.
        // v11.31 — `n` is untrusted IPC: a string / NaN used to be stored
        // verbatim in the numeric `queuedCount` field and lie to every chip.
        // Keep the last honest count when the engine sends nonsense.
        const n =
          typeof e.n === 'number' && Number.isFinite(e.n) && e.n >= 0
            ? Math.floor(e.n)
            : st.queuedCount;
        const items = st.queuedItems;
        const next = n <= 0 ? [] : n < items.length ? items.slice(items.length - n) : items;
        set({ queuedCount: n, queuedItems: next });
        break;
      }
      case 'compaction_done': {
        // v12 (CONTINUITY) — NEVER delete the user's transcript. The old code
        // kept only 4 rows and persisted that, which looked like the app lost
        // the conversation. Insert ONE summary row at the front and keep every
        // existing message (just settle any lingering streaming cursor).
        const summaryMsg: ChatMessage = {
          id: uid(),
          role: 'user',
          kind: 'text',
          content: `[Compacted context]\n${e.summary}`,
          timestamp: Date.now(),
        };
        const merged = [summaryMsg, ...msgs.map((m) => (m.streaming ? { ...m, streaming: false } : m))];
        // v11.12 — compaction is a legitimate "continue" moment: the work was
        // cut short by a context boundary, not by the user.
        const continuedTask = lastUserTask(msgs);
        set({
          session: { ...session, messages: merged },
          ...(continuedTask ? { continueHint: { task: continuedTask, reason: 'compacted' as const } } : {}),
        });
        st.notify(st.settings.language === 'ar' ? 'تم ضغط السياق (محفوظ بالكامل)' : 'Context compacted (full history kept)');
        void get().persistSession();
        return;
      }
      case 'error': {
        // v11.23 — CRITICAL STATE FIRST. Even if a later read of the untrusted
        // payload throws (outer safety net), the UI can never be left
        // "running" with a ghost liveness strip after an error/abort.
        liveStreamChars = 0;
        set({ running: false, steerPending: false, ...clearedRunActivity() });
        const lastIdx = msgs.length - 1;
        const last = msgs[lastIdx];
        if (last && last.streaming) msgs[lastIdx] = { ...last, streaming: false };
        const ar = st.settings.language === 'ar';
        const rawMessage = typeof (e as { message?: unknown }).message === 'string'
          ? (e as { message: string }).message
          : '';
        const code = typeof (e as { code?: unknown }).code === 'string'
          ? (e as { code: string }).code
          : undefined;
        // v11.19 + v11.22 — 402 is re-localized from its machine pattern, never
        // raw English JSON. v11.28 — the localized text is carried by the ONE
        // report toast at the terminal edge, so there is NO separate 402 notify
        // here (that would be a second toast for the same run).
        const msg = noCreditsToast(rawMessage, ar) ?? localizeRunError(rawMessage, ar, code);
        const key = runErrorKey(rawMessage, code);
        runReport.errorKey = key;
        // Provisional report slice only: no transcript row and no toast yet.
        // A real `task_report` may replace it; if none arrives, turn_end emits
        // the single toast from this honest slice.
        const report: TaskReportSlice = {
          outcome: 'error',
          summary: msg,
          files: [],
          commands: [],
          nextSteps: [],
          ...(code ? { stopReason: code } : { stopReason: 'error' }),
          partial: true,
          durationMs: 0,
          at: Date.now(),
        };
        // v11.26 — this provisional card is the SAME single card a later
        // task_report (or the final turn_end) reuses; never a second row.
        rrCommitInto(msgs, report, false, 'error');
        break;
      }
      case 'aborted':
        liveStreamChars = 0; // v11.10 (A5)
        set({ running: false, steerPending: false, ...clearedRunActivity() });
        if (!runReport.final) {
          // v11.26 — an abort is a terminal path TOO: the founder gets one
          // honest written report of what actually happened, then `running`
          // is already false and late events are locked out.
          rrCommitInto(msgs, rrSynthesize('aborted', st.settings.language === 'ar'), true, 'error');
          rrFlushAutoPreview();
        }
        break;
      case 'preview_open': {
        // v8: only adopt previews that belong to the ACTIVE workspace — a stale
        // session's dev server can no longer hijack this conversation's panel.
        const evWs = (e as { ws?: string }).ws;
        if (!evWs || evWs === get().wsPath) {
          // v11.11 (A3) — AUTO-OPEN: the engine's completion hook describes WHAT
          // to preview; turn the hint into a sequenced request the panel
          // consumes (auto-start + auto-switch to the preview view). Guard: a
          // repeat run must not restart a preview the user is ALREADY looking
          // at (same kind + dir + runtime while the panel is open).
          const hint = (e as { previewHint?: { kind?: string; dir?: string; runtime?: string; label?: string } }).previewHint;
          const prev = get().previewAuto;
          const normDir = (p?: string) => (p ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '');
          const sameAlready =
            !!get().previewOpen &&
            !!prev &&
            !!hint?.kind &&
            prev.kind === hint.kind &&
            normDir(prev.dir) === normDir(hint.dir) &&
            (prev.runtime ?? '') === (hint.runtime ?? '');
          // v11.38 (F9) — a REAL verified preview URL (HTTP 200 checked by the
          // tool) must be adopted even if the user previously navigated the UI
          // close — that was ordinary panel navigation, not a refusal of a built
          // page. Only hint-only auto-opens respect previewUserClosed.
          const hasVerifiedUrl = typeof e.url === 'string' && /^https?:\/\//i.test(e.url);
          if (!previewUserClosed || hasVerifiedUrl) {
            set({
              previewOpen: true,
              previewWs: evWs || get().wsPath,
              ...(e.url ? { previewUrl: e.url } : {}),
              ...(!sameAlready && (hint?.kind === 'dev' || hint?.kind === 'static' || hint?.kind === 'artifact')
                ? {
                    previewAuto: {
                      seq: (prev?.seq ?? 0) + 1,
                      kind: hint.kind as 'dev' | 'static' | 'artifact',
                      ...(hint.dir ? { dir: hint.dir } : {}),
                      ...(hint.runtime ? { runtime: hint.runtime as 'npm' | 'python' | 'custom' | 'go' } : {}),
                      ...(hint.label ? { label: hint.label } : {}),
                      ws: evWs || get().wsPath,
                    },
                  }
                : {}),
            });
          }
        }
        void get().refreshPreviewStatus();
        break;
      }
      case 'turn_end':
        set({ running: false, steerPending: false, ...clearedRunActivity() });
        if (!runReport.final) {
          // v11.26 — a SILENT provider end (no engine task_report) is still a
          // terminal path. v11.28 — rebuild one honest report from the files,
          // commands and outcome actually seen and emit its ONE toast. If an
          // earlier error event published the provisional slice, turn_end is
          // the settling edge that finally emits the single report toast.
          if (!runReport.cardId) {
            const outcome = runReport.outcome;
            rrCommitInto(
              msgs,
              rrSynthesize(outcome, st.settings.language === 'ar'),
              true,
              outcome === 'completed' ? undefined : 'error',
            );
          } else {
            runReport.final = true;
            rrEmitReportToast(get().lastTaskReport, st.settings.language === 'ar');
          }
        }
        rrFlushAutoPreview();
        void get().loadGit();
        // v11.23 — close the run only AFTER all state updates above landed.
        // From here on the top guard drops stale events from this dead run.
        runClosed = true;
        break;
      default:
        // v11.14 — forward compatibility: a newer engine can emit event types
        // this renderer does not know yet (e.g. v11.13 `self_critique` /
        // `run_and_show`). Unknown events are a TRUE no-op: falling through to
        // the shared tail below cloned the whole session + messages array on
        // EVERY occurrence, re-rendering the entire chat for an event that has
        // no meaning here. Returning here keeps the stream flat and immune to
        // future event additions.
        return;
    }

    // never persist a blinking cursor — v11.9 S1: clear streaming on EVERY
    // assistant row that has it (steer/queued rows can sit below the live
    // bubble; the old last-row-only check missed it). Fast path clears by the
    // tracked streaming id and falls back to a full transcript walk.
    if (e.type === 'turn_end' || e.type === 'aborted' || e.type === 'error' || e.type === 'task_report') {
      clearStreamingRows(msgs);
    }

    set({ session: { ...session, messages: msgs } });
    if (e.type === 'turn_end') closedSession = get().session; // pin the object the closing event wrote
    if (e.type === 'turn_end' || e.type === 'error' || e.type === 'aborted' || e.type === 'task_report') {
      flushUsageLog(); // end-of-turn: usage persisted synchronously
      void get().persistSession();
    } else if (msgs.length % 4 === 0) void get().persistSession();
    } catch {
      // v11.23 — LAST line of defence for the "thinking stops" symptom family:
      // one malformed IPC payload must never strand the rAF token buffer, and
      // a terminal event must never leave `running:true` / a ghost liveness
      // strip behind. Everything else is best-effort.
      try { flushPendingDelta(); } catch { /* nothing left to do */ }
      if (e.type === 'error' || e.type === 'aborted' || e.type === 'turn_end' || e.type === 'task_report') {
        try { set({ running: false, steerPending: false, ...clearedRunActivity() }); } catch { /* nothing left to do */ }
        if (e.type === 'turn_end') {
          runClosed = true;
          closedSession = get().session;
        }
        // v11.28 — even a payload hostile enough to throw here is a terminal
        // path: the founder must still get ONE honest report, never silence.
        try {
          if (!runReport.toastShown) {
            if (e.type === 'error') runReport.outcome = 'error';
            else if (e.type === 'aborted') runReport.outcome = 'aborted';
            else if (e.type === 'task_report') {
              const o = (e as { outcome?: unknown }).outcome;
              runReport.outcome = o === 'aborted' ? 'aborted' : o === 'error' ? 'error' : 'completed';
            }
            const ar = get().settings.language === 'ar';
            rrEmitReportToast(rrSynthesize(runReport.outcome, ar), ar);
            runReport.final = true;
          }
        } catch { /* nothing left to do */ }
      }
    }
  },

  decideApproval: async (action, value) => {
    const pa = get().pendingApproval;
    if (!pa) return;
    const ar = get().settings.language === 'ar';
    try {
      if (pa.kind === 'mcp_elicitation') {
        // v11.9 S7 — MCP elicitation cards resolve through the MCP registry's
        // pendingElicitations map (kdx:mcp:elicitDecision), NOT kdx:agent:approval
        // — the agent-permission registry is the WRONG registry for these and
        // left the elicitation pending forever (the card could never be answered).
        const elAction: 'accept' | 'decline' | 'cancel' =
          action === 'deny' || action === 'never' || action === 'never_always'
            ? 'decline'
            : action === 'answer' && !(value ?? '').trim()
              ? 'cancel'
              : 'accept';
        // free-text answers ride as best-effort content ({text}) — the MCP bridge
        // forwards it to the server for requestedSchema validation.
        await api.mcpElicitDecision(
          pa.requestId,
          elAction,
          action === 'answer' && (value ?? '').trim() ? { text: (value ?? '').trim() } : undefined,
        );
      } else {
        // v11.10 — THE "ALWAYS ALLOW KEEPS ASKING" FIX (founder complaint #1).
        // The engine stores the rule keyed by decision.value (editable scope)
        // when present. Plain "ALWAYS" with no scope used to remember the
        // EXACT normalized command ("cmd:npm install"), so the very next
        // sibling command ("npm run dev") re-prompted — forever. Now a bare
        // ALWAYS derives the PER-TOOL scope from the command line (first real
        // token after env-prefixes / shell separators: "npm install …" →
        // "npm"), which the engine persists as "cmd:npm" and prefix-matches
        // against every later npm invocation — the dialog genuinely never
        // asks again for that tool. An explicit card scope (typed in the
        // card's field) still wins; deny stays exact (precise by design).
        const scope =
          value != null && String(value).trim()
            ? String(value).trim()
            : (action === 'always' || action === 'always_session' || action === 'always_project') &&
                pa.kind === 'command'
              ? deriveToolScope(pa.command ?? firstCommandLike(pa.detail))
              : undefined;
        // v3.1 — ask_user answers travel as action:'answer' + the chosen/typed value.
        await api.agentApproval({
          requestId: pa.requestId,
          action,
          ...(scope ? { value: scope } : {}),
        });
      }
    } catch {
      // v11.31 — a dead approval IPC must never pin the decision card on
      // screen forever (the user could no longer answer OR abort cleanly).
      // One localized notice; the card always closes in `finally` below.
      get().notify(
        ar
          ? 'تعذّر إرسال القرار — أُغلقت البطاقة محلياً.'
          : 'Could not send the decision — the card was closed locally.',
      );
    } finally {
      set({
        pendingApproval: null,
        diffView: get().diffView?.approvalRequestId === pa.requestId ? null : get().diffView,
      });
    }
  },

  // ---------------- v2.1 engine actions (chat/control D2) ----------------
  setTaskMode: (m) => {
    set({ taskMode: m });
    const sid = get().session?.id;
    // v11.12 (A4-GUARANTEE) — the strip switch is now VISIBLE in the chat: the
    // i18n notice texts existed (mode.*.switched) but nothing ever rendered
    // them — the founder's "I switch the mode and nothing happens". One
    // deduped notice row, exactly like the slash path.
    try {
      const ar = get().settings.language === 'ar';
      const notices: Record<string, [string, string]> = {
        build: [
          'تم التبديل إلى وضع البناء — عادت الكتابة والأوامر وحلقة الأدوات الكاملة إلى العمل.',
          'Switched to BUILD mode — execution posture restored.',
        ],
        plan: [
          'تم التبديل إلى وضع الخطة — قراءة فقط: أبحث وأنهي بكارت خطة، والكتابة والأوامر ممنوعة حتى تنتقل إلى البناء.',
          'Switched to PLAN mode — read-only: produce the step-by-step plan (plan.md + propose_plan); edits/commands are denied (persists for this session).',
        ],
        debug: [
          'تم التبديل إلى وضع الفحص — فرضية ثم اختبار ثم إصلاح، والمحرك يتحقق من الإصلاح بنفسه ويُظهر تقرير فحص.',
          'Switched to DEBUG mode — hypothesis → test discipline with an engine-run verification loop.',
        ],
        review: [
          'تم التبديل إلى وضع المراجعة — قراءة فقط، وتنتهي المهمة بكارت نتائج منظم يُحفظ في مجلد المراجعات.',
          'Switched to REVIEW mode — read-only review posture ending with a structured findings card.',
        ],
      };
      const pair = notices[m] ?? ['', ''];
      const text = ar ? pair[0] : pair[1];
      const session = get().session;
      if (session && text) {
        const msgs = [...session.messages];
        msgs.push({
          id: `mode-${m}-${Date.now()}`,
          role: 'assistant',
          kind: 'notice',
          noticeKind: 'mode',
          content: text,
          timestamp: Date.now(),
        });
        set({ session: { ...session, messages: msgs } });
      }
    } catch {
      /* notice is best-effort — the mode still switches */
    }
    if (!sid) return;
    api.agentTaskMode(sid, m).catch(() => {
      get().notify(get().settings.language === 'ar' ? 'تعذّر تغيير وضع المهمة' : 'Task mode change failed');
    });
  },

  approvePlan: async (choice, feedback) => {
    const ar = get().settings.language === 'ar';
    const sid = get().session?.id;
    set({ planProposal: null });
    try {
      if (sid) await api.agentPlanApprove(sid, choice, feedback);
    } catch {
      // legacy engine fallback — no plan-approve IPC: run it as a normal turn
      const note =
        choice === 'auto'
          ? ar
            ? 'تمت الموافقة على الخطة. نفّذها خطوة بخطوة مع التحقق أولاً بأول.'
            : 'Plan approved. Implement it step by step, verifying with tests/builds as you go.'
          : choice === 'manual'
            ? ar
              ? 'تمت الموافقة على الخطة — اسأل قبل كل خطوة.'
              : 'Plan approved — ask before each step.'
            : ar
              ? `راجع الخطة: ${feedback ?? ''}`
              : `Revise the plan: ${feedback ?? ''}`;
      if (choice === 'auto') get().setMode('autoEdit');
      void get().sendMessage(note);
    }
  },

  sendSteer: async (text) => {
    const v = text.trim();
    const sid = get().session?.id;
    if (!v || !sid || !get().running) return;
    try {
      await api.agentSteer(sid, v);
      set({ steerPending: true });
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر إرسال التوجيه' : 'Steer failed');
    }
  },

  runReview: async () => {
    const sid = get().session?.id;
    const ar = get().settings.language === 'ar';
    if (!sid) {
      get().notify(ar ? 'لا توجد جلسة نشطة' : 'No active session');
      return;
    }
    try {
      const res = await api.agentReviewRun(sid);
      const findings = res?.findings ?? [];
      set({ lastReview: { findings, summary: res?.summary } });
      get().notify(
        findings.length === 0
          ? ar
            ? 'اكتملت المراجعة — لا ملاحظات'
            : 'Review complete — clean'
          : (ar ? 'اكتملت المراجعة: ' : 'Review complete: ') + `${findings.length} findings`,
      );
    } catch {
      get().notify(ar ? 'فشلت المراجعة' : 'Review failed');
    }
  },

  exportRecap: async () => {
    const sid = get().session?.id;
    const s = get().session;
    const ar = get().settings.language === 'ar';
    if (!sid || !s) return;
    try {
      const res = await api.agentRecap(sid);
      const md = res?.markdown;
      if (!md) {
        get().notify(ar ? 'لا يوجد ملخص بعد — شغّل الوكيل أولاً' : 'No recap yet — run the agent first');
        return;
      }
      // same download path as /export (blob → anchor click)
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(s.title || 'recap').replace(/[^\w\u0600-\u06FF-]+/g, '-').slice(0, 48)}-recap.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      get().notify(ar ? 'تم تنزيل الملخص (Markdown)' : 'Recap downloaded (Markdown)');
    } catch {
      get().notify(ar ? 'تعذّر توليد الملخص' : 'Recap failed');
    }
  },

  loadSkills: async () => {
    const ws = get().wsPath;
    if (!ws) {
      set({ skills: [] });
      return;
    }
    try {
      const list = await api.skillsList(ws);
      set({ skills: list || [] });
    } catch {
      /* backend unavailable (browser dev / older main) */
    }
  },

  deleteSkill: async (slug) => {
    const ws = get().wsPath;
    if (!ws) return;
    try {
      await api.skillDelete(ws, slug);
      await get().loadSkills();
      get().notify(get().settings.language === 'ar' ? 'حُذفت المهارة' : 'Skill deleted');
    } catch {
      get().notify(get().settings.language === 'ar' ? 'تعذّر حذف المهارة' : 'Could not delete skill');
    }
  },

  setSkillsOpen: (o) => {
    set({ skillsOpen: o });
    if (o) void get().loadSkills();
  },

  dismissQueued: (index) => {
    // NOTE: the engine queue has no cancel IPC yet — dismissal hides the chip
    // locally and the FIFO drain reconciliation from queued_count keeps the
    // mirror honest once the engine reports n.
    const items = [...get().queuedItems];
    items.splice(index, 1);
    set({ queuedItems: items, queuedCount: Math.max(0, get().queuedCount - 1) });
  },

  clearReview: () => set({ lastReview: null }),
  setCtxWindow: (n) => set({ ctxWindow: n }),
  setCtxWindowEstimated: (v) => set({ ctxWindowEstimated: v }),

  // ---------------- v2.2 DNA (the closed learning loop) ----------------
  loadDna: async () => {
    // Coalesce event bursts ('updated'/'refined' can fire per-write) with a
    // 500ms trailing debounce; the first call (mount / workspace open) runs
    // immediately so panels never wait.
    const now = Date.now();
    if (now - dnaLastLoad < 500) {
      if (dnaReloadTimer) clearTimeout(dnaReloadTimer);
      dnaReloadTimer = setTimeout(() => {
        dnaReloadTimer = null;
        dnaLastLoad = 0;
        void get().loadDna();
      }, 500);
      return;
    }
    dnaLastLoad = now;
    if (typeof api.dnaGet !== 'function') return; // browser dev / older preload
    set({ dnaLoading: true });
    const ws = get().wsPath || undefined;
    try {
      const [dna, stats] = await Promise.all([
        api.dnaGet(ws).catch(() => null),
        typeof api.dnaStats === 'function' ? api.dnaStats(ws).catch(() => null) : Promise.resolve(null),
      ]);
      set({ dna: dna ?? null, dnaStats: stats ?? null, dnaLoading: false });
    } catch {
      set({ dnaLoading: false });
    }
  },

  clearDnaSuggestion: () => {
    const sug = get().dnaSuggestion;
    set({ dnaSuggestion: null });
    // tell the engine so this pattern is not re-suggested (best effort)
    if (sug?.patternId && typeof api.dnaDismissSuggestion === 'function') {
      api.dnaDismissSuggestion(sug.patternId).catch(() => undefined);
    }
  },

  // ---------------- v11.12 Living Playbook + Subagent dashboard ----------------
  loadPlaybook: async () => {
    if (typeof api.playbookGet !== 'function') return; // older preload / browser dev
    const ws = get().wsPath || undefined;
    set({ playbookLoading: true });
    try {
      const [data, history] = await Promise.all([
        api.playbookGet(ws).catch(() => null),
        typeof api.playbookHistory === 'function' ? api.playbookHistory(ws).catch(() => []) : Promise.resolve([]),
      ]);
      set({ playbook: data ?? null, playbookHistory: history ?? [], playbookLoading: false });
    } catch {
      set({ playbookLoading: false });
    }
  },

  clearPlaybook: async () => {
    const ar = get().settings.language === 'ar';
    if (!window.confirm(ar ? 'حذف دليل التعلم لهذا المشروع؟' : 'Delete this workspace\'s learning playbook?')) return;
    try {
      await api.playbookClear?.(get().wsPath || undefined);
      set({ playbook: null, playbookHistory: [], lastPlaybookLearning: null });
      get().notify(ar ? 'تم حذف دليل التعلّم' : 'Learning playbook cleared');
    } catch {
      /* older preload — no-op */
    }
  },

  loadSubagents: async () => {
    if (typeof api.subagentsList !== 'function') return;
    set({ subagentsLoading: true });
    try {
      const rows = (await api.subagentsList(get().wsPath || undefined).catch(() => [])) ?? [];
      // v11.36 — hydrate child-session transcripts from the persisted ledger;
      // live `toolcall` events merge on top of these after load.
      set((s) => {
        const out = { ...s.subagentToolCalls };
        for (const r of rows) out[r.id] = mergeSubagentToolCalls(out[r.id], r.toolCalls ?? []);
        return { subagents: rows, subagentsLoading: false, subagentToolCalls: out };
      });
    } catch {
      set({ subagentsLoading: false });
    }
  },

  retrySubagent: async (id) => {
    const ar = get().settings.language === 'ar';
    try {
      const res = await api.subagentsRetry?.(id);
      if (!res?.ok) {
        get().notify(res?.error === 'NOT_FOUND' ? (ar ? 'وكيل فرعي غير موجود' : 'Subagent not found') : (ar ? 'تعذّرت إعادة التشغيل' : 'Retry failed'));
        return;
      }
      void get().loadSubagents();
      get().notify(ar ? 'جارٍ إعادة تشغيل الوكيل الفرعي…' : 'Re-running the subagent…');
    } catch {
      get().notify(ar ? 'تعذّرت إعادة التشغيل' : 'Retry failed');
    }
  },

  clearSubagents: async () => {
    try {
      await api.subagentsClear?.();
      set({ subagents: [], subagentSteps: {}, subagentToolCalls: {}, subagentDetailId: null });
    } catch {
      /* older preload */
    }
  },

  openSubagentDetail: (id) => {
    if (!id) return;
    // Seed the timeline from the record we already have so an in-flight
    // subagent never opens onto an empty step list.
    const rec = get().subagents.find((r) => r.id === id);
    set((s) => ({
      subagentDetailId: id,
      ...(rec && !s.subagentSteps[id]
        ? { subagentSteps: { ...s.subagentSteps, [id]: [{ at: rec.startedAt, done: rec.done, total: rec.total }] } }
        : {}),
    }));
  },
  closeSubagentDetail: () => set({ subagentDetailId: null }),

  // ---------------- v2.4 flows ----------------
  setFlowSuggest: (s) => set({ flowSuggest: s }),
  dismissFlowSuggest: () => set({ flowSuggest: null }),

  // ---------------- v6 artifact comments ----------------
  addArtifactComment: (text) => {
    const t = text.trim().slice(0, 500);
    if (!t) return;
    set({ artifactComments: [...get().artifactComments, t] });
  },
  removeArtifactComment: (index) => {
    set({ artifactComments: get().artifactComments.filter((_, i) => i !== index) });
  },
  clearArtifactComments: () => set({ artifactComments: [] }),

  trustWorkspaceSkills: async () => {
    const ws = get().wsPath;
    set({ skillsTrustNeeded: false });
    if (!ws || typeof api.skillsTrust !== 'function') return;
    try {
      await api.skillsTrust(ws);
      const ar = get().settings.language === 'ar';
      get().notify(ar ? 'وُثقت مهارات مساحة العمل' : 'Workspace skills trusted');
      void get().loadSkills();
    } catch {
      /* trust write failed — chip stays dismissed for this session */
    }
  },

  setChatWidth: (w) => {
    const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(w)));
    set({ chatWidth: next });
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  },

  abortAgent: async () => {
    // v11.31 — a user stop is a TERMINAL path even when the abort bridge is
    // gone (window closing / dead main process). Settle EVERY live surface in
    // `finally` so a rejected IPC can never strand `running:true`, a ghost
    // liveness strip, a steer flag, or a stale resume chip on the next launch.
    try {
      await api.agentAbort();
    } catch {
      const ar = get().settings.language === 'ar';
      get().notify(
        ar
          ? 'تعذّر تأكيد الإيقاف من المحرك — أُوقفت الواجهة محلياً.'
          : 'The engine did not confirm the stop — the UI was stopped locally.',
      );
    } finally {
      stopRunWatchdog();
      clearResumeMarker();
      liveStreamChars = 0;
      // Lock out any late event from the run the user just stopped: the engine
      // may still emit aborted/turn_end, and they must not reopen a bubble.
      runClosed = true;
      closedSession = get().session;
      runFailed = false;
      runAborted = true;
      set({
        running: false,
        steerPending: false,
        runRecovery: null,
        resumableRun: null,
        liveStreamChars: 0,
        ...clearedRunActivity(),
      });
      // v11.28 — one honest written report for the stop; the per-run latch
      // keeps this from doubling with a real aborted/task_report/toast.
      if (!runReport.toastShown) {
        const ar = get().settings.language === 'ar';
        rrPublish(rrSynthesize('aborted', ar), ar, true);
      }
    }
  },

  setModel: (provider, model) => get().updateSettings({ model: { provider, model } }),

  refreshLicense: async () => {
    try {
      const license = await api.licenseGet();
      set({ license: license || { plan: 'free', mode: 'local' } });
    } catch {
      /* keep current */
    }
  },

  // ---------------- terminal ----------------
  toggleTerminal: async () => {
    const open = !get().terminalOpen;
    // Open the strip on the SAME tick as the click. Waiting on the PTY create
    // IPC first made the rail button look dead whenever the bridge was slow or
    // unavailable (the old code set terminalOpen only AFTER the await).
    set({ terminalOpen: open });
    if (open) await ensureTerminalSession();
  },
  setTermHeight: (h) => set({ termHeight: Math.max(120, Math.min(600, h)) }),

  // ---------------- live preview ----------------
  setPreviewOpen: (o) => {
    // v11.26 — an explicit close is the user's verdict: auto-open must never
    // override it. An explicit open re-arms auto-open for the next task.
    previewUserClosed = !o;
    set({ previewOpen: o });
    if (!o) return;
    // Opening the surface must ALWAYS land a real status: poll the backend and
    // surface the one honest error we can determine without starting a server
    // (no workspace yet). A later start attempt overwrites this with its own
    // concrete reason (noPackage/noDevScript/startFailed).
    if (!get().wsPath) set({ previewError: { reason: 'noWorkspace' } });
    void get().refreshPreviewStatus();
  },
  togglePreview: () => get().setPreviewOpen(!get().previewOpen),
  navigatePreview: (url) => {
    const clean = url.trim();
    if (!clean) return;
    const normalized = /^https?:\/\//i.test(clean)
      ? clean
      : clean.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(clean)
        ? `http://${clean}`
        : clean;
    set({ previewUrl: normalized, previewSource: 'user', previewError: null });
  },
  refreshPreviewStatus: async () => {
    try {
      const rawStatus = await api.previewStatus();
      // v11.23 (C6/P0) — a failed dev server's raw stdout/stderr must never be
      // printed verbatim in a toast or popover. Keep only a bounded, ANSI/JSON-
      // stripped tail; the honest "what to do" copy lives in preview.err.*.
      const st: PreviewStatusResult = rawStatus
        ? {
            ...rawStatus,
            dev: {
              ...rawStatus.dev,
              lines: (Array.isArray(rawStatus.dev?.lines) ? rawStatus.dev.lines : [])
                .slice(-4)
                .map(sanitizeLogLine)
                .filter(Boolean),
            },
          }
        : rawStatus;
      set({ previewStatus: st });
      // v8 — workspace-aware default URL. If the currently shown URL belongs to
      // ANOTHER workspace (previewWs ≠ wsPath), replace it with this
      // workspace's own server: static → dev → agent-started (cwd-matched).
      const ws = get().wsPath;
      const ownedWs = get().previewWs;
      const stale = !!get().previewUrl && ownedWs !== ws;
      // v11.10 — dev-server adoption: when OUR dev source is live and its URL
      // changed (restart → new port, or the first ready event), follow it.
      // The old logic kept showing a stale/dead URL forever because it only
      // adopted when previewUrl was EMPTY — the panel "never updates" symptom.
      const src = get().previewSource;
      const devFollow =
        st.dev?.running && st.dev.url && ownedWs === ws && (src === '' || src === 'dev');
      if (!get().previewUrl || stale || (devFollow && get().previewUrl !== st.dev.url)) {
        const norm = (p?: string) => (p ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '');
        const nws = norm(ws);
        const agentMatch = (st.dev.agentSources ?? []).find((s) => {
          const cwd = norm(s.cwd);
          return !!nws && (cwd === nws || cwd.startsWith(nws + '/') || nws.startsWith(cwd + '/'));
        });
        const url = devFollow ? st.dev.url : (st.static.url ?? st.dev.url ?? agentMatch?.url);
        if (url) {
          set({ previewUrl: url, previewWs: ws, ...(devFollow ? { previewSource: 'dev' as const } : {}) });
        } else if (stale) set({ previewUrl: '', previewWs: '' });
      }
    } catch {
      /* preview backend unavailable */
    }
  },
  // v11.23 (C6/P0) — PREVIEW FAILURES HAVE EXACTLY ONE SURFACE: the localized
  // error card inside the preview panel. FIXED raw-EN / raw-payload toasts:
  //   get().notify('Open a workspace first')   → localized card (noWorkspace)
  //   get().notify(res.error ?? 'Preview failed') / get().notify(detail)
  //                                            → removed; no raw bridge text,
  //   no second wording, no JSON in a toast. Historical anchors above are kept
  //   only for the v1123 error-audit inventory (v1123-error-audit.test.mjs).
  startStaticPreview: async (dir) => {
    const target = dir || get().wsPath;
    if (!target) {
      set({ previewOpen: true, previewError: { reason: 'noWorkspace' } });
      return;
    }
    try {
      const res = await api.previewStaticStart(target);
      if (res.ok && res.url) {
        set({ previewOpen: true, previewUrl: res.url, previewWs: get().wsPath, previewSource: 'static', previewError: null });
        void get().refreshPreviewStatus();
      } else {
        set({
          previewOpen: true,
          previewError: { reason: 'startFailed', detail: localizePreviewError(res.error, get().settings.language === 'ar') },
        });
      }
    } catch (err) {
      set({
        previewOpen: true,
        previewError: { reason: 'startFailed', detail: localizePreviewError(err, get().settings.language === 'ar') },
      });
    }
  },
  startDevPreview: async (runtime?: 'npm' | 'python' | 'custom' | 'go') => {
    const ws = get().wsPath;
    if (!ws) {
      set({ previewOpen: true, previewError: { reason: 'noWorkspace' } });
      return;
    }
    set({ previewOpen: true, previewWs: get().wsPath, previewError: null });
    try {
      const res = await api.previewDevStart(ws, runtime ?? 'npm');
      if (res.ok) {
        // v11.10 — track the source so the first ready event (and later port
        // changes after a restart) adopt the REAL dev URL into the webview.
        // v11.23 — no "Starting: <raw script>" toast: the panel + status strip
        // are the live, single surface for a run's progress.
        set({ previewSource: 'dev' });
        void get().refreshPreviewStatus();
      } else {
        set({
          previewError: {
            reason: mapDevStartError(res.error),
            detail: localizePreviewError(res.error, get().settings.language === 'ar'),
          },
        });
      }
    } catch (err) {
      set({
        previewError: { reason: 'startFailed', detail: localizePreviewError(err, get().settings.language === 'ar') },
      });
    }
  },
  stopDevPreview: async () => {
    try {
      await api.previewDevStop();
    } finally {
      void get().refreshPreviewStatus();
    }
  },

  dismissPreviewError: () => set({ previewError: null }),

  // ---------------- git ----------------
  loadGit: async () => {
    const { wsPath } = get();
    if (!wsPath) return set({ git: null });
    try {
      const st = await api.gitStatus(wsPath);
      set({ git: st });
    } catch {
      set({ git: null });
    }
  },

  gitStage: async (paths) => {
    if (!paths.length) return;
    await api.gitStage(get().wsPath, paths);
    await get().loadGit();
  },

  gitCommit: async (message) => {
    const hash = await api.gitCommit(get().wsPath, message);
    await get().loadGit();
    return hash;
  },

  // ---------------- ui ----------------
  setRail: (v) => set({ rail: v, sidebarOpen: get().rail === v ? !get().sidebarOpen : true }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  // v7.2 — focus mode toggle (persisted to localStorage so a reload keeps it)
  setFocusMode: (on) => {
    set({ focusMode: on });
    try {
      localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  },
  setPalette: (o) => set({ paletteOpen: o }),
  setModelPicker: (o) => set({ modelPickerOpen: o }),
  clearPlan: () => set({ planProposal: null }),
  setSettings: (o, section) => set({ settingsOpen: o, ...(section ? { settingsSection: section } : {}) }),
  setPlans: (o) => set({ plansOpen: o }),
  setShortcuts: (o) => set({ shortcutsOpen: o }),
  setDiffView: (d) => set({ diffView: d }),
  // ---------------- A1 slash: /rewind checkpoint chooser ----------------
  setRewindPicker: (cps) => set({ rewindPicker: cps }),
  openRewindPicker: async () => {
    const st = get();
    if (!st.wsPath) {
      st.notify(st.settings.language === 'ar' ? 'افتح مجلداً أولاً' : 'Open a folder first');
      return;
    }
    const ar = st.settings.language === 'ar';
    try {
      const cps = await api.cpList(st.wsPath);
      if (!cps.length) {
        st.notify(ar ? 'لا توجد نقاط تحقق بعد' : 'No checkpoints yet — they are created before edits');
        return;
      }
      set({ rewindPicker: cps });
    } catch {
      st.notify(ar ? 'تعذّر تحميل نقاط التحقق' : 'Could not load checkpoints');
    }
  },
  restoreCheckpoint: async (id) => {
    const st = get();
    const tt = slashT(st.settings.language === 'ar');
    const target = (st.rewindPicker ?? []).find((c) => c.id === id);
    set({ rewindPicker: null });
    if (!st.wsPath || !target) return;
    try {
      await api.cpRestore(st.wsPath, target.id);
      void get().refreshTree();
      void get().loadGit();
      const line = tt('slash.rewind.restored', 'Checkpoint restored: {label}', { label: target.label });
      get().notify('⏪ ' + line);
      appendAssistantRow(get, '⏪ ' + line);
    } catch {
      get().notify(tt('slash.rewind.failed', 'Restore failed'));
    }
  },

  // ---------------- v11.12 CHAT CAPABILITIES ----------------
  switchModel: async (arg) => {
    const s = get();
    const tt = slashT(s.settings.language === 'ar');
    const query = String(arg ?? '').trim();
    if (!query) {
      // No argument is NOT a fake switch: open the real picker and say so.
      set({ modelPickerOpen: true });
      get().notify(tt('slash.model.hint', 'Open the model picker, or type /model followed by a model name.'));
      return;
    }
    const hit = resolveModelRef(s.settings, query);
    if (!hit) {
      get().notify(tt('slash.model.notFound', 'No installed model matches "{q}".', { q: query }));
      return;
    }
    get().setModel(hit.provider, hit.model);
    const cur = get().session;
    if (cur) {
      set({ session: { ...cur, model: `${hit.provider}/${hit.model}` } });
      void get().persistSession();
    }
    const line = tt('slash.model.switched', 'Model switched to {provider}/{model} — the next run uses it.', hit);
    appendAssistantRow(get, line, 'system-status');
    get().notify(line);
  },

  switchToolProfile: async (profile) => {
    const s = get();
    const tt = slashT(s.settings.language === 'ar');
    const p = String(profile ?? '').trim().toLowerCase();
    const allowed: ToolProfile[] = ['essential', 'balanced', 'full'];
    const current = s.settings.agent?.toolProfile ?? 'balanced';
    if (!p) {
      appendAssistantRow(get, tt('slash.profile.current', 'Tool profile: {p} — choose essential, balanced or full.', { p: current }), 'system-status');
      return;
    }
    if (!allowed.includes(p as ToolProfile)) {
      get().notify(tt('slash.profile.bad', 'Unknown tool profile "{p}" — use essential, balanced or full.', { p }));
      return;
    }
    if (p === current) {
      appendAssistantRow(get, tt('slash.profile.same', 'Tool profile is already {p}.', { p }), 'system-status');
      return;
    }
    // updateSettings persists to the main-process settings store; the engine's
    // agentTuning() reads it at the start of EVERY run, so the switch is live
    // for the next turn without touching the tool registry (no tools removed).
    get().updateSettings({ agent: { ...(s.settings.agent ?? {}), toolProfile: p as ToolProfile } });
    const line = tt('slash.profile.switched', 'Tool profile set to {p} — the next run advertises the matching tool set.', { p });
    appendAssistantRow(get, line, 'system-status');
    get().notify(line);
  },

  undoLastCheckpoint: async () => {
    const s = get();
    const tt = slashT(s.settings.language === 'ar');
    if (!s.wsPath) {
      s.notify(tt('slash.undo.noWorkspace', 'Open a folder first'));
      return;
    }
    if (typeof api.cpList !== 'function' || typeof api.cpRestore !== 'function') {
      s.notify(tt('slash.undo.bridge', 'Checkpoint restore is unavailable in this build.'));
      return;
    }
    let cps;
    try {
      cps = await api.cpList(s.wsPath);
    } catch {
      s.notify(tt('slash.undo.failedList', 'Could not list checkpoints'));
      return;
    }
    if (!Array.isArray(cps) || cps.length === 0) {
      appendAssistantRow(get, tt('slash.undo.empty', 'No checkpoints to undo — they are created before edits.'), 'system-status');
      return;
    }
    // cpList is newest-first (same contract /rewind relies on).
    const cp = cps[0];
    if (
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      !window.confirm(tt('slash.undo.confirm', 'Restore checkpoint "{label}"? Files go back; the conversation stays.', { label: cp.label }))
    ) {
      return; // the user declined — no restore, no fake success
    }
    appendAssistantRow(
      get,
      tt('slash.undo.restoring', 'Undo — restoring "{label}" ({n} files)…', { label: cp.label, n: cp.fileCount }),
      'system-status',
    );
    try {
      await api.cpRestore(s.wsPath, cp.id);
      void get().refreshTree();
      void get().loadGit();
      const line = tt('slash.undo.done', 'Undo complete — restored "{label}". The conversation is unchanged.', { label: cp.label });
      appendAssistantRow(get, '⏪ ' + line, 'system-status');
      get().notify('⏪ ' + line);
    } catch {
      get().notify(tt('slash.undo.restoreFailed', 'Could not restore the checkpoint'));
    }
  },

  continueTask: async () => {
    const s = get();
    const tt = slashT(s.settings.language === 'ar');
    if (!s.session) {
      s.notify(tt('slash.continue.noSession', 'Open a session first'));
      return;
    }
    if (s.running) {
      s.notify(tt('slash.continue.busy', 'The agent is busy — wait for the current run'));
      return;
    }
    const task = s.continueHint?.task || lastUserTask(s.session.messages);
    if (!task) {
      s.notify(tt('slash.continue.noTask', 'No previous task to continue'));
      return;
    }
    const ar = s.settings.language === 'ar';
    const instruction = ar
      ? '[متابعة] أكمل المهمة السابقة من حيث توقفت — العمل المنجز محفوظ، لا تُعد ما تم. أنِهِ الخطوات المتبقية وتحقق منها.'
      : '[CONTINUE] Continue the previous task from where it stopped — completed work is saved, do not redo it. Finish the remaining steps and verify them.';
    set({ continueHint: null });
    // The FULL directive must be the message content: runAgent sends transcript
    // rows to the model, and only main-process SLASH templates get expanded on
    // the way in. A displayAs short-code here would starve the model of the
    // task, so the transcript honestly shows the continue instruction + task.
    await get().sendMessage(`${instruction}\n\n${task}`);
  },

  // ---------------- v11.13 — REAL composer capabilities ----------------
  showCapabilityPanel: (panel) =>
    set({ capabilityPanel: { ...panel, seq: (get().capabilityPanel?.seq ?? 0) + 1, at: Date.now() } }),
  dismissCapabilityPanel: () => set({ capabilityPanel: null }),

  showDiff: async (arg) => {
    const s = get();
    const ar = s.settings.language === 'ar';
    const tt = slashT(ar);
    if (!s.wsPath) return s.notify(tt('slash.test.noWorkspace', 'Open a folder first.'));
    if (typeof api.gitStatus !== 'function' || typeof api.gitDiff !== 'function') {
      return s.notify(tt('slash.diff.bridge', 'The git diff bridge is unavailable in this build.'));
    }
    let isRepo = false;
    try {
      const st = await api.gitStatus(s.wsPath);
      isRepo = !!st && (st as { isRepo?: boolean }).isRepo === true;
    } catch {
      /* treated as "not a repo" below */
    }
    if (!isRepo) {
      s.notify(tt('slash.diff.noRepo', 'No git repository is open in this workspace.'));
      return;
    }
    const target = String(arg ?? '').trim().replace(/^["']|["']$/g, '');
    try {
      const diffs = await api.gitDiff(s.wsPath, target || undefined);
      const withPatch = diffs.filter((d) => d?.patch?.trim());
      if (withPatch.length === 0) {
        const clean = tt('slash.diff.clean', 'No uncommitted changes — the working tree is clean.');
        appendAssistantRow(get, clean, 'system-status');
        s.notify(clean);
        return;
      }
      const patch = withPatch.map((d) => d.patch).join('\n');
      const title = target
        ? tt('slash.diff.title', 'Unified diff for {path}', { path: target })
        : tt('slash.diff.allTitle', 'Unified diff — uncommitted changes');
      // transcript panel (with a fenced diff block) + composer output card (copy button)
      appendAssistantRow(get, `${title}\n\`\`\`diff\n${clipMd(patch, 8000)}\n\`\`\``, 'system-status');
      get().showCapabilityPanel({ title, kind: 'diff', text: patch });
      // keep the established diff-viewer behavior intact for compatibility
      set({
        diffView: {
          title: `${tt('slash.diff.title', 'Unified diff for {path}', { path: target || '(working tree)' })} · ${withPatch.length}`,
          path: target,
          oldText: '',
          newText: '',
          patch,
        },
      });
      s.notify(
        tt('slash.diff.summary', 'Unified diff: {n} file(s), {lines} lines — shown in the output panel.', {
          n: withPatch.length,
          lines: patch.split('\n').length,
        }),
      );
    } catch {
      s.notify(tt('slash.diff.failed', 'Could not read the git diff.'));
    }
  },

  runTests: async (arg) => {
    const s = get();
    const ar = s.settings.language === 'ar';
    const tt = slashT(ar);
    if (!s.wsPath) return s.notify(tt('slash.test.noWorkspace', 'Open a folder first.'));
    if (typeof api.cmdRun !== 'function') {
      return s.notify(tt('slash.test.bridge', 'The command runner is unavailable in this build.'));
    }
    let cmd = String(arg ?? '').trim();
    if (!cmd) {
      let pkg = '';
      try {
        pkg = await api.readFile(wsJoin(s.wsPath, 'package.json'));
      } catch {
        /* no package.json — try Python below */
      }
      cmd = detectTestCommand(pkg);
      if (!cmd && hasPythonTests(s.fileTree)) cmd = 'python -m pytest -q';
    }
    if (!cmd) {
      const none = tt('slash.test.noScript', 'No test command found — add a test script to package.json or pass one after /test');
      appendAssistantRow(get, none, 'system-status');
      s.notify(none);
      return;
    }
    appendAssistantRow(get, tt('slash.test.running', 'Running test command: {cmd}', { cmd }), 'system-status');
    let res: CommandRunResult;
    try {
      res = await api.cmdRun(cmd, s.wsPath, 120_000);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const line = tt('slash.test.error', 'Could not run the test command: {error}', { error });
      appendAssistantRow(get, line, 'error');
      s.notify(line);
      return;
    }
    const body = [
      `$ ${res.cmd}`,
      res.stdout?.trim() || '',
      res.stderr?.trim() ? `[stderr]\n${res.stderr.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const verdict = res.timedOut
      ? tt('slash.test.timeout', 'TIMEOUT — the test command exceeded its deadline.')
      : res.ok
        ? tt('slash.test.pass', 'PASS — exit code 0 in {ms} ms.', { ms: res.ms })
        : tt('slash.test.fail', 'FAIL — exit code {code} in {ms} ms.', { code: res.code ?? '?', ms: res.ms });
    appendAssistantRow(get, `${verdict}\n\`\`\`\n${clipMd(body, 8000)}\n\`\`\``, res.ok ? 'system-status' : 'error');
    get().showCapabilityPanel({ title: cmd, kind: 'test', text: `${verdict}\n\n${body}` });
    s.notify(verdict);
  },

  explainFile: async (arg) => {
    const s = get();
    const ar = s.settings.language === 'ar';
    const tt = slashT(ar);
    const target = resolveExplainPath(s.wsPath ?? '', String(arg ?? ''));
    if (!target) return s.notify(tt('slash.explain.usage', 'Usage: /explain <path>'));
    if (typeof api.readFile !== 'function' || typeof api.aiComplete !== 'function') {
      return s.notify(tt('slash.explain.bridge', 'File reading or one-shot completion is unavailable in this build.'));
    }
    appendAssistantRow(get, tt('slash.explain.reading', 'Reading the file and explaining it in your language…'), 'system-status');
    let raw = '';
    try {
      raw = await api.readFile(target);
    } catch (err) {
      const line = tt('slash.explain.failed', 'Explanation failed: {error}', {
        error: err instanceof Error ? err.message : String(err),
      });
      appendAssistantRow(get, line, 'error');
      s.notify(line);
      return;
    }
    if (!raw || !raw.trim()) {
      const empty = tt('slash.explain.empty', 'The file is empty — nothing to explain.');
      appendAssistantRow(get, empty, 'system-status');
      s.notify(empty);
      return;
    }
    const system = ar
      ? 'اشرح هذا الملف باللغة العربية بوضوح وإيجاز: ماذا يفعل، أهم أجزائه، وكيف يرتبط بالمشروع.'
      : 'Explain this file clearly and concisely in English: what it does, its key parts, and how it fits into the project.';
    try {
      // api.aiComplete(prompt, opts) is the REAL one-shot provider turn (main
      // process injects the configured key/model). No fake explanation.
      const res = await api.aiComplete(
        `Explain this file (${target}).\n\n${clipMd(raw, 24_000)}`,
        { system, maxTokens: 1200 },
      );
      const text = (typeof res === 'string' ? res : String((res as { text?: string } | null)?.text ?? '')).trim();
      if (!text) {
        const noProvider = tt('err.setup.noModel', 'No model is selected. Open Settings → AI providers and choose a model, then send your message again.');
        appendAssistantRow(get, noProvider, 'system-status');
        s.notify(noProvider);
        return;
      }
      const title = tt('slash.explain.title', 'Explanation of {path}', { path: target });
      appendAssistantRow(get, `${title}\n\n${clipMd(text, 12_000)}`, undefined);
      get().showCapabilityPanel({ title, kind: 'explain', text });
      s.notify(title);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const line = /no_api_key|no_model|no provider|not configured/i.test(msg)
        ? tt('err.setup.noModel', 'No model is selected. Open Settings → AI providers and choose a model, then send your message again.')
        : tt('slash.explain.failed', 'Explanation failed: {error}', { error: msg });
      appendAssistantRow(get, line, 'error');
      s.notify(line);
    }
  },

  skillsCommand: async (arg) => {
    const s = get();
    const ar = s.settings.language === 'ar';
    const tt = slashT(ar);
    const mode = String(arg ?? '').trim().toLowerCase();
    const current = s.settings.trustWorkspaceSkills ?? 'ask';
    const label =
      current === 'always'
        ? tt('slash.skills.state.on', 'on')
        : current === 'never'
          ? tt('slash.skills.state.off', 'off')
          : tt('slash.skills.state.ask', 'ask on use');
    const report = (line: string, title: string) => {
      appendAssistantRow(get, line, 'system-status');
      get().showCapabilityPanel({ title, kind: 'skills', text: line });
      s.notify(title);
    };
    if (mode === 'on' || mode === 'off') {
      // The engine reads `trustWorkspaceSkills` at the start of EVERY run
      // (engine.ts skill-injection gate) — this is a real, live switch.
      get().updateSettings({ trustWorkspaceSkills: mode === 'on' ? 'always' : 'never' });
      if (mode === 'on' && s.wsPath && typeof api.skillsTrust === 'function') {
        try {
          await api.skillsTrust(s.wsPath);
        } catch {
          /* trust marker best-effort; the global gate already changed */
        }
      }
      const line = mode === 'on'
        ? tt('slash.skills.on', 'Skill injection ON — trusted workspace skills are injected from the next run.')
        : tt('slash.skills.off', 'Skill injection OFF — workspace skills are skipped from the next run.');
      return report(line, '/skills');
    }
    if (mode === 'list') {
      if (!s.wsPath) return s.notify(tt('slash.test.noWorkspace', 'Open a folder first.'));
      if (typeof api.skillsList !== 'function') {
        return s.notify(tt('slash.skills.listEmpty', 'No skills are configured for this workspace.'));
      }
      let skills: { name?: string; slug?: string; description?: string }[] = [];
      try {
        skills = ((await api.skillsList(s.wsPath)) ?? []) as typeof skills;
      } catch {
        skills = [];
      }
      const title = tt('slash.skills.listTitle', 'Workspace skills ({n})', { n: skills.length });
      const rows = skills.length
        ? skills.map((k) => `• ${k.name ?? k.slug ?? '?'} (${k.slug ?? '?'}) — ${k.description ?? ''}`)
        : [tt('slash.skills.listEmpty', 'No skills are configured for this workspace.')];
      return report([title, ...rows].join('\n'), title);
    }
    if (!mode) {
      return report(tt('slash.skills.status', 'Skill injection: {state} — based on the real workspace trust gate.', { state: label }), '/skills');
    }
    s.notify(tt('slash.skills.bad', 'Usage: /skills on | off | list'));
  },

  mcpCommand: async (arg) => {
    const s = get();
    const ar = s.settings.language === 'ar';
    const tt = slashT(ar);
    if (typeof api.mcpServersGet !== 'function') {
      return s.notify(tt('slash.mcp.bridge', 'The MCP bridge is unavailable in this build.'));
    }
    const raw = String(arg ?? '').trim();
    const first = raw.split(/\s+/)[0].toLowerCase();
    const id = raw.slice(raw.split(/\s+/)[0].length).trim();
    let res: { servers?: Array<{ id: string; name?: string; state?: string; toolCount?: number; error?: string }> };
    try {
      res = (await api.mcpServersGet()) as typeof res;
    } catch {
      return s.notify(tt('slash.mcp.bridge', 'The MCP bridge is unavailable in this build.'));
    }
    const servers = Array.isArray(res?.servers) ? res.servers : [];
    const report = (text: string, title: string) => {
      appendAssistantRow(get, text, 'system-status');
      get().showCapabilityPanel({ title, kind: 'mcp', text });
      s.notify(title);
    };
    if (first === 'test') {
      if (!id) return s.notify(tt('slash.mcp.testUsage', 'Usage: /mcp test <server-id>'));
      if (typeof api.mcpHealthCheck !== 'function' && typeof api.mcpConnect !== 'function') {
        return s.notify(tt('slash.mcp.bridge', 'The MCP bridge is unavailable in this build.'));
      }
      const server = servers.find((x) => x?.id === id || x?.name === id);
      if (!server) return s.notify(tt('slash.mcp.notFound', 'No MCP server matches {id}.', { id }));
      appendAssistantRow(get, tt('slash.mcp.testing', 'Testing MCP server {id}…', { id }), 'system-status');
      try {
        if (typeof api.mcpHealthCheck === 'function') {
          const h = await api.mcpHealthCheck(server.id ?? id);
          if (h?.state === 'connected') {
            report(
              tt('slash.mcp.connected', '{id} is connected — {n} tool(s), {ms} ms.', {
                id: server.id ?? id, n: h.toolCount ?? 0, ms: h.latencyMs ?? 0,
              }),
              '/mcp test',
            );
          } else {
            report(
              tt('slash.mcp.failed', '{id} failed: {error}', {
                id: server.id ?? id, error: h?.error || h?.state || 'unknown',
              }),
              '/mcp test',
            );
          }
        } else {
          const st = await api.mcpConnect(server.id ?? id);
          const ok = st?.state === 'connected';
          report(
            ok
              ? tt('slash.mcp.connected', '{id} is connected — {n} tool(s), {ms} ms.', {
                  id: server.id ?? id, n: st?.toolCount ?? 0, ms: st?.latencyMs ?? 0,
                })
              : tt('slash.mcp.failed', '{id} failed: {error}', {
                  id: server.id ?? id, error: st?.error || st?.state || 'unknown',
                }),
            '/mcp test',
          );
        }
      } catch (err) {
        report(
          tt('slash.mcp.failed', '{id} failed: {error}', {
            id: server.id ?? id, error: err instanceof Error ? err.message : String(err),
          }),
          '/mcp test',
        );
      }
      return;
    }
    if (first === 'list' || !first) {
      if (servers.length === 0) {
        return report(tt('slash.mcp.empty', 'No MCP servers are configured.'), '/mcp');
      }
      const title = tt('slash.mcp.listTitle', 'MCP servers ({n})', { n: servers.length });
      const rows = servers.map(
        (x) => `• ${x.id} — ${x.state ?? 'unknown'} · ${x.toolCount ?? 0} tools${x.error ? ` · ${x.error}` : ''}`,
      );
      return report([title, ...rows].join('\n'), title);
    }
    s.notify(tt('slash.mcp.bad', 'Usage: /mcp list | test <server-id>'));
  },

  budgetCommand: async () => {
    const s = get();
    const tt = slashT(s.settings.language === 'ar');
    const u = s.sessionUsage;
    const last = s.lastTurnUsage;
    const cap = s.settings.agent?.taskBudgetUsd;
    const lines: string[] = [
      tt('slash.budget.title', 'Session budget — real usage'),
      '• ' + tt('slash.budget.tokens', 'Tokens: {i} in / {o} out', {
        i: u.inputTokens.toLocaleString(), o: u.outputTokens.toLocaleString(),
      }),
      '• ' + tt('slash.budget.cost', 'Estimated cost: {c}', { c: `$${u.costUsd.toFixed(4)}` }),
      '• ' + tt('slash.budget.lastTurn', 'Last turn: {t} tokens (estimated marked with approx)', {
        t: `${last ? (last.inputTokens + last.outputTokens).toLocaleString() : '0'}${last?.estimated ? ' ≈' : ''}`,
      }),
      '• ' + tt('slash.budget.taskCap', 'Task spend cap: {v}', {
        v: cap && cap > 0 ? `$${cap.toFixed(2)}` : tt('slash.budget.noCap', 'unlimited'),
      }),
    ];
    if (s.verificationBudgetLabel) {
      lines.push('• ' + tt('slash.budget.verification', 'Verification budget: {v}', { v: s.verificationBudgetLabel }));
    }
    const text = lines.join('\n');
    appendAssistantRow(get, text, 'system-status');
    get().showCapabilityPanel({ title: tt('slash.budget.title', 'Session budget — real usage'), kind: 'budget', text });
    s.notify(tt('slash.budget.title', 'Session budget — real usage'));
  },

  toggleChat: () => set({ chatOpen: !get().chatOpen }),
  // editor AI actions push selection/code here; Composer appends it to the input
  insertIntoComposer: (text) => {
    set({
      chatOpen: true,
      composerInsert: { text, seq: (get().composerInsert?.seq ?? 0) + 1 },
    });
  },
  notify: (msg) => {
    // v11.23 — the same failure can be reported by BOTH the bridge rejection
    // and its error AgentEvent. Show ONE notice, not a stacked duplicate.
    if (get().notice === msg) return;
    set({ notice: msg });
    setTimeout(() => {
      if (get().notice === msg) set({ notice: null });
    }, 3500);
  },
  clearNotice: () => set({ notice: null }),

  // ---------------- auth + project creation ----------------
  signOut: async () => {
    try {
      await api.authLogout();
    } catch {
      /* ignore */
    }
    set({ account: null });
  },
  setAccount: (a) => set({ account: a }),
  setNewProject: (o) => set({ newProjectOpen: o }),
  setCloneOpen: (o) => set({ cloneOpen: o }),
  cloneRepo: async (opts) => {
    const res = await api.gitClone(opts);
    if (res.ok && res.projectPath) await get().openWorkspace(res.projectPath);
    return res;
  },
}));

/**
 * Ensure exactly ONE main-process PTY exists for the visible terminal. Shared
 * by toggleTerminal() and TerminalView's mount effect so a slow bridge can
 * never open two sessions (and so the UI never waits on the bridge to appear).
 * The terminal renders xterm locally even when the bridge is unavailable.
 */
let termCreateInflight: Promise<void> | null = null;
export function ensureTerminalSession(): Promise<void> {
  if (useStore.getState().terminalId) return Promise.resolve();
  if (termCreateInflight) return termCreateInflight;
  termCreateInflight = (async () => {
    try {
      const id = await api.termCreate(useStore.getState().wsPath || '');
      if (id) useStore.setState({ terminalId: id });
    } catch {
      /* main process unavailable — xterm still renders, commands stay local */
    } finally {
      termCreateInflight = null;
    }
  })();
  return termCreateInflight;
}

// QA/screenshot harness handle (read-mostly): lets the KODEX_SHOT driver set
// language / open sections / seed a streaming message deterministically in
// Xvfb runs. Never used for product logic.
if (typeof window !== 'undefined') {
  (window as unknown as { __sadeemStore?: typeof useStore }).__sadeemStore = useStore;
}
