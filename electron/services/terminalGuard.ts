// ============================================================
// Surnia (E4 security) — terminalGuard.ts: the security hub.
//
// Owns four things:
//   1. TERMINAL GUARD — interactive shell input is classified
//      (classifyCommand from ../agent/risk when the ENGINE agent
//      has landed it, otherwise a local fallback classifier)
//      BEFORE it reaches a shell. 'danger' in mode 'on' blocks
//      the command until the user confirms via kdx:term:allowOnce
//      (a ONE-SHOT override keyed on the exact command string).
//   2. AUDIT TRAIL — append-only JSONL at <userData>/audit.jsonl
//      { ts, kind, detail } with kinds permission | term_blocked |
//      term_allow | mcp_approval | fs_block | secret_redacted.
//   3. SECURITY IPC — kdx:sec:* handlers + kdx:term:allowOnce,
//      registered by initTerminalGuard() (called from
//      terminalService at boot — ipc.ts itself is NOT edited).
//   4. DATA CONTROLS — clear sessions / auto-memory / MCP
//      approval rules, and "export my data" as a real ZIP
//      (store-method, CRC32) written under <userData>/exports.
//
// ELECTRON-SAFETY: electron is loaded lazily via require() and
// every consumer is guarded — bundling this module outside
// Electron (the surnia CLI bundle) stays inert instead of
// crashing. agent/tools.ts → terminalService → here.
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import type { GuardMode, RiskVerdict } from '../agent/riskTypes';
import { normalizeGuardMode } from '../agent/riskTypes';

// ============================================================
// Lazy electron access (CLI-safe)
// ============================================================
type ElectronApi = typeof import('electron');
let electronApi: ElectronApi | null | undefined;

/** Resolved electron API, or null outside Electron (surnia CLI bundle). */
function electron(): ElectronApi | null {
  if (electronApi !== undefined) return electronApi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron') as unknown;
    // Plain node gets the electron npm package → a path STRING, not the API.
    if (mod && typeof mod === 'object' && 'ipcMain' in (mod as Record<string, unknown>)) {
      electronApi = mod as ElectronApi;
    } else {
      electronApi = null;
    }
  } catch {
    electronApi = null;
  }
  return electronApi;
}

let userDataDir: string | null | undefined;
function appDataDir(): string | null {
  if (userDataDir !== undefined) return userDataDir;
  try {
    const app = electron()?.app;
    if (!app) return (userDataDir = null);
    userDataDir = app.getPath('userData');
  } catch {
    userDataDir = null; // app not ready yet (or CLI context)
  }
  return userDataDir;
}

// ============================================================
// Classifier — ../agent/risk when present, local fallback otherwise
// ============================================================
type ClassifyFn = (cmd: string) => RiskVerdict;

/**
 * Fallback classifier — SAFETY NET. electron/agent/risk.ts (ENGINE agent)
 * exports the real classifyCommand and is preferred automatically via the
 * runtime loader below; this local list only stays active if that module
 * is missing or malformed (fresh checkouts mid-integration).
 */
const FALLBACK_RULES: { re: RegExp; level: 'warn' | 'danger'; reason: string }[] = [
  // --- danger: irreversible / system-wide destruction ---
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-{1,2}(?:[\w-]*r[\w-]*f|[\w-]*f[\w-]*r)/i, level: 'danger', reason: 'recursive force delete (rm -rf)' },
  // v11.31 — split flag order (rm -r -f) and root/home targets must not slip
  // through the combined-flag rule (the ENGINE classifier already covers these;
  // this is the safety net used when that module is unavailable).
  { re: /\brm\s+-[a-z]*r[a-z]*(?:\s+-[a-z]*f[a-z]*)+\s+(?:["']?(?:\/|\/\*|~|\$HOME|\$\{HOME\})(?:["']|\/(?:\*|\.\.)?)?)/i, level: 'danger', reason: 'recursive+force rm targeting /, ~ or $HOME' },
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\s+["']?(?:\/|\/\*|~|\$HOME|\$\{HOME\})(?:["']|\/)/i, level: 'danger', reason: 'recursive force delete of a root/home path' },
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\s+\/(?:bin|boot|dev|etc|home|lib|proc|root|srv|sys|usr|var)\b/i, level: 'danger', reason: 'recursive force delete of a system directory' },
  // PowerShell's destructive cmdlet (case-insensitive, abbreviated flags are
  // not matched on purpose — full -Recurse/-Force is the common dangerous form).
  { re: /\bRemove-Item\b[^\n|;&]*(?:-Recurse\b[^\n|;&]*-Force\b|-Force\b[^\n|;&]*-Recurse\b)/i, level: 'danger', reason: 'PowerShell Remove-Item -Recurse -Force' },
  { re: /\b(?:ri|rm|del)\s+-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*\s+['"]?[a-z]:\\/i, level: 'danger', reason: 'PowerShell recursive force delete of a drive root' },
  { re: /\bsudo\s+(?:-\w+\s+)*rm\b/i, level: 'danger', reason: 'sudo rm' },
  { re: /\bmkfs(?:\.\w+)?\b/i, level: 'danger', reason: 'filesystem format (mkfs)' },
  { re: /\bdd\b[^;&|]*\bof=\s*\/dev\//i, level: 'danger', reason: 'raw device write (dd of=/dev/...)' },
  { re: />\s*\/dev\/(?:sd|nvme|hd|disk)/i, level: 'danger', reason: 'raw device overwrite redirect' },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, level: 'danger', reason: 'fork bomb' },
  // v11.11 (A9) — environment dumping (the fallback safety net mirrors the
  // ENGINE classifier: env/printenv paired with a network sink, and raw
  // process-environment reads, are exfiltration primitives).
  { re: /\b(?:env|printenv|set)\b[^;&|]*\|\s*(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|ftp|telnet)\b/i, level: 'danger', reason: 'environment dump piped into a network tool (exfiltration)' },
  { re: /\b(?:curl|wget|nc|ncat|netcat)\b[^;&|]*\|\s*(?:sudo\s+)?(?:ba|z|fi|da)?sh\b/i, level: 'danger', reason: 'remote script piped into a shell' },
  { re: /\b(?:cat|type)\s+\/proc\/\d+\/environ\b/i, level: 'danger', reason: 'reading another process environment (credential dumping)' },
  { re: /\benv\s+(?:HTTP_PROXY|https?_proxy)=/i, level: 'warn', reason: 'environment override in a command (proxy interception)' },
  { re: /\b(?:shutdown|poweroff|halt|reboot)\b/i, level: 'danger', reason: 'power state change' },
  { re: /\bchmod\s+(?:-\w+\s+)*[0-7]{0,3}777\s+\//, level: 'danger', reason: 'world-writable chmod at filesystem root' },
  { re: /\bchown\s+(?:-\w+\s+)+[\w.]+:\s*[\w.]+\s+\/\s*$/, level: 'danger', reason: 'recursive chown at filesystem root' },
  { re: /\bdiskutil\s+erase/i, level: 'danger', reason: 'disk erase (diskutil)' },
  { re: /\bformat\b[^;&|]*\b[a-zA-Z]:/i, level: 'danger', reason: 'drive format (Windows)' },
  { re: /\b(?:rd|rmdir|del)\s+(?:\/s\b[^;&|]*\/q\b|\/q\b[^;&|]*\/s\b)/i, level: 'danger', reason: 'silent recursive delete (Windows)' },
  { re: /\breg\s+(?:delete|add)\s+HK/i, level: 'danger', reason: 'Windows registry edit' },
  { re: /\b(?:curl|wget)\b[^;&|]*\|\s*(?:sudo\s+)?(?:ba|z|fi|da)?sh\b/i, level: 'danger', reason: 'remote script piped into a shell' },
  { re: /\bmv\b[^;&|]*\/dev\/null/, level: 'danger', reason: 'move into /dev/null' },
  { re: /\bkill(?:all)?\s+(?:-{1,2}\w+\s+)*-?9\s+(?:1|-1)\b/, level: 'danger', reason: 'SIGKILL PID 1' },
  // v11.31 — more credential-exfiltration shapes (mirror of risk.ts).
  { re: /\b(?:cat|type|get-content|base64)\b[^\n|;&]*(?:\.ssh[/\\]|id_rsa|\.env\b|\.netrc|\.npmrc|\.aws[/\\]|credentials)[^\n|;&]*\|\s*(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|ssh|scp|python3?|node)\b/i, level: 'danger', reason: 'credential file piped into a network/interpreter tool' },
  { re: /\b(?:curl|wget)\b[^\n|;&]*(?:--data(?:-binary|-raw)?|-d|-T|--upload-file)\b[^\n|;&]*@[^\n|;&]*(?:\.ssh[/\\]|id_rsa|\.env\b|\.netrc|\.npmrc|\.aws[/\\]|credentials)/i, level: 'danger', reason: 'credential file uploaded to a network endpoint' },
  { re: /\bbase64\s+(?:-[a-z]+\s+)*-d[^\n|;&]*\|\s*(?:ba|z|da)?sh\b/i, level: 'danger', reason: 'base64-decoded payload piped into a shell' },
  { re: /\beval\b[^\n|;&]*\$/i, level: 'danger', reason: 'eval of an expanded variable (obfuscation)' },
  // --- warn: risky but sometimes legitimate ---
  { re: /\brm\b[^;&|]*(?:-{1,2}f\b|-\w*f\w*)/i, level: 'warn', reason: 'force delete (rm -f)' },
  { re: /\bchmod\s+(?:-\w+\s+)*777\b/i, level: 'warn', reason: 'world-writable chmod 777' },
  { re: /\bgit\s+push\b[^;&|]*(?:--force(?!-with-lease)|\s+-f\b)/, level: 'warn', reason: 'force push (history rewrite)' },
  { re: /\bgit\s+reset\s+--hard\b/, level: 'warn', reason: 'git reset --hard (discards changes)' },
  { re: /\b(?:npm|yarn|pnpm)\s+publish\b/, level: 'warn', reason: 'package publish' },
  { re: /\bdrop\s+(?:table|database)\b|\btruncate\s+table\b/i, level: 'warn', reason: 'destructive SQL' },
  { re: /\bkillall\b/i, level: 'warn', reason: 'killall' },
  { re: /\b(?:cat|less|more|head|tail|nano|vi|vim)\b[^;&|]*(?:id_rsa|\.ssh\/|\.aws\/credentials|\.env\b)/, level: 'warn', reason: 'reads a credentials file' },
  { re: /\b(?:curl|wget)\b/, level: 'warn', reason: 'network fetch' },
];

function fallbackClassify(cmd: string): RiskVerdict {
  const line = String(cmd ?? '');
  for (const rule of FALLBACK_RULES) {
    if (rule.re.test(line)) return { level: rule.level, reasons: [rule.reason] };
  }
  return { level: 'safe', reasons: [] };
}
/** v11.11 — exported for the unit tests of the safety-net rule list. */
export { fallbackClassify };

let classifyFn: ClassifyFn | null = null;
let classifyRetryAt = 0;

/** Runtime lookup of the ENGINE classifier; retries for 30s windows until it lands. */
function classifier(): ClassifyFn {
  if (classifyFn) return classifyFn;
  const now = Date.now();
  if (now < classifyRetryAt) return fallbackClassify;
  classifyRetryAt = now + 30_000;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../agent/risk') as { classifyCommand?: unknown };
    const fn = mod?.classifyCommand;
    if (typeof fn === 'function') {
      const wrapped: ClassifyFn = (cmd) => {
        try {
          const v = fn(cmd) as RiskVerdict;
          if (v && (v.level === 'safe' || v.level === 'warn' || v.level === 'danger') && Array.isArray(v.reasons)) {
            return v;
          }
        } catch {
          /* classifier threw — fail SAFE below */
        }
        return { level: 'danger', reasons: ['classifier error — command held for review'] };
      };
      classifyFn = wrapped;
      return wrapped;
    }
  } catch {
    /* ../agent/risk not landed yet — fallback stays active */
  }
  return fallbackClassify;
}

/** v11.31 — the active verdict for one raw command line (ENGINE classifier or net). */
export function classifyForGuard(cmd: string): RiskVerdict {
  return classifier()(String(cmd ?? ''));
}

// ------------------------------------------------------------
// v11.31 — HARD DENY (service-level floor)
// ------------------------------------------------------------
// The interactive guard blocks every 'danger' verdict, and the agent tool
// layer asks for approval. This smaller set is refused by the SERVICES
// themselves (processService.start / terminalService.runCaptured / exec)
// EVEN when a caller is approved or the guard is in 'off' mode: these
// commands destroy the host or dump credentials and have no legitimate
// agent use case. Errors are explicit — never a silent no-op.
const HARD_DENY: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\s+["']?(?:\/|\/\*|~|\$HOME|\$\{HOME\})(?:["']|\/|\s|$)/i, reason: 'recursive force delete of / or the home directory' },
  { re: /\brm\s+-[a-z]*r[a-z]*(?:\s+-[a-z]*f[a-z]*)+\s+(?:["']?(?:\/|~|\$HOME))/i, reason: 'recursive+force delete of / or the home directory' },
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\s+\/(?:bin|boot|dev|etc|home|lib|proc|root|srv|sys|usr|var)\b/i, reason: 'recursive force delete of a system directory' },
  { re: /\bRemove-Item\b[^\n|;&]*(?:-Recurse\b[^\n|;&]*-Force\b|-Force\b[^\n|;&]*-Recurse\b)[^\n|;&]*\b(?:[a-z]:\\(?:\s|$)|\/|~)/i, reason: 'PowerShell recursive force delete of a root path' },
  { re: /\bmkfs(?:\.\w+)?\b/i, reason: 'filesystem format' },
  { re: /\bdd\b[^\n|;&]*\bof=\s*(?:["']?)(\/dev\/|[a-z]:\\|\/dev\/null)/i, reason: 'raw device/block write' },
  { re: />\s*\/dev\/(?:sd|nvme|hd|vd|disk)/i, reason: 'raw block device overwrite' },
  { re: /\bformat\s+[a-z]:/i, reason: 'drive format' },
  { re: /\bdiskpart\b/i, reason: 'disk partitioning' },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
  { re: /\b(?:shutdown|poweroff|halt|reboot)\b/i, reason: 'host power control' },
  { re: /\b(?:curl|wget)[^\n|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da|fi|sh)?sh\b/i, reason: 'remote script piped into a shell' },
  { re: /\bbase64\s+(?:-[a-z]+\s+)*-d[^\n|;&]*\|\s*(?:ba|z|da)?sh\b/i, reason: 'encoded payload piped into a shell' },
  { re: /\b(?:env|printenv)\b[^\n|;&]*\|\s*(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|ftp|telnet)\b/i, reason: 'environment dump piped into a network tool' },
  { re: /\bcat\s+\/proc\/\d+\/environ\b/i, reason: 'process credential dump' },
  { re: /\breg\s+(?:delete|add)\s+HK/i, reason: 'Windows registry edit' },
];

/** Throw `BLOCKED_DANGEROUS_COMMAND: <reason>` for host-destroying commands. */
export function assertHardCommandSafe(cmd: string): void {
  const line = String(cmd ?? '');
  for (const { re, reason } of HARD_DENY) {
    if (re.test(line)) {
      const msg = `BLOCKED_DANGEROUS_COMMAND: ${reason} — refused by the SADEEM service guard before any process was started.`;
      auditAppend('term_blocked', { cmd: redactForAudit(line.slice(0, 200)), reason, source: 'hard-deny' });
      sendSecurityEvent('kdx:term:blocked', { cmd: redactForAudit(line.slice(0, 200)), reasons: [reason] });
      throw new Error(msg);
    }
  }
}

/**
 * v11.31 — spawn environment redaction. A shell inherits the app process env
 * today, which hands every provider key / token / DB credential to arbitrary
 * child code. Drop sensitive names (and high-confidence secret VALUES) while
 * keeping the ordinary developer vars a build/dev server needs. `extra` is
 * injected by OUR code and is intentionally allowed to override.
 */
const SENSITIVE_ENV_NAME =
  /(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET|TOKEN|PASS(?:WORD|WD)|CREDENTIAL|AUTH(?:ORIZATION)?|COOKIE|PRIVATE[_-]?KEY|SESSION[_-]?KEY|CLIENT[_-]?SECRET|DSN|CONNECTION[_-]?STRING|WEBHOOK|DATABASE_URL|REDIS_URL|NPM[_-]?TOKEN|GH[_-]?TOKEN|GITHUB[_-]?TOKEN|STRIPE|OPENAI|ANTHROPIC|GOOGLE_API|AZURE_|AWS_|CLOUDFLARE|CF_[A-Z])/i;
const SECRET_ENV_VALUE = /^\s*(?:sk-|ghp_|gho_|github_pat_|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-|Bearer\s+\S+|postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@|mysql:\/\/[^\s:@]+:[^\s@]+@)/;

export function sanitizeSpawnEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue;
    if (SENSITIVE_ENV_NAME.test(key) || SECRET_ENV_VALUE.test(value)) continue;
    out[key] = value;
  }
  // Our own additions are trusted; they also cover any variable we filtered
  // above that a caller explicitly needs (e.g. a proxied PORT for a preview).
  return { ...out, ...extra };
}

// ============================================================
// Guard mode (settings.terminalGuard — default 'on')
// ============================================================
let modeCache: { v: GuardMode; at: number } | null = null;

function guardMode(): GuardMode {
  const now = Date.now();
  if (modeCache && now - modeCache.at < 3000) return modeCache.v;
  let v: GuardMode = 'on';
  try {
    // Lazy + guarded: storeService statically imports electron.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('./storeService') as { getSettings?: () => unknown };
    const s = store.getSettings?.() as { terminalGuard?: unknown } | undefined;
    v = normalizeGuardMode(s?.terminalGuard);
  } catch {
    v = 'on'; // fail CLOSED — protection stays enabled
  }
  modeCache = { v, at: now };
  return v;
}

/** Re-read the mode on the next guard decision (settings just saved). */
export function invalidateGuardModeCache(): void {
  modeCache = null;
}

// ============================================================
// One-shot overrides ("allow once" — exact command string)
// ============================================================
const ALLOW_ONCE_TTL_MS = 10 * 60_000;
const allowOnce = new Map<string, number>();

function consumeAllowOnce(cmd: string): boolean {
  const key = String(cmd ?? '').trim();
  const exp = allowOnce.get(key);
  if (exp === undefined) return false;
  allowOnce.delete(key); // ONE-SHOT: consumed whether or not still valid
  return exp > Date.now();
}

function pruneAllowOnce(): void {
  const now = Date.now();
  for (const [k, exp] of allowOnce) if (exp <= now) allowOnce.delete(k);
}

/**
 * v11.31 — programmatic/arming counterpart of kdx:term:allowOnce (used by the
 * IPC handler and by host-side tests). The renderer-facing IPC path remains
 * sender-checked; this export is a main-process-only API.
 */
export function armAllowOnce(cmd: unknown): boolean {
  const raw = String(cmd ?? '').trim();
  if (!raw) return false;
  allowOnce.set(raw, Date.now() + ALLOW_ONCE_TTL_MS);
  return true;
}

// ============================================================
// Renderer events (all main windows — no ipc.ts/main.ts edits)
// ============================================================
export function sendSecurityEvent(channel: string, payload: unknown): void {
  try {
    const win = electron()?.BrowserWindow;
    if (!win) return;
    for (const w of win.getAllWindows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send(channel, payload);
      } catch {
        /* window closing */
      }
    }
  } catch {
    /* never let notifications break the guarded operation */
  }
}

// ============================================================
// Audit trail — <userData>/audit.jsonl (append-only)
// ============================================================
export type AuditKind =
  | 'permission'
  | 'term_blocked'
  | 'term_allow'
  | 'mcp_approval'
  | 'fs_block'
  | 'secret_redacted';

export interface AuditEntry {
  ts: string;
  kind: AuditKind;
  detail?: unknown;
}

const AUDIT_MAX_BYTES = 2 * 1024 * 1024;

function auditFile(): string | null {
  const dir = appDataDir();
  return dir ? path.join(dir, 'audit.jsonl') : null;
}

/**
 * Best-effort redaction of audit payload strings (commands can carry secrets).
 * Exported (v11.31) so terminalService's audit line and the audit writer itself
 * use the SAME redaction engine — a command containing `sk-…` must never reach
 * a log file, an IPC event or an exported ZIP.
 */
export function redactForAudit(s: string): string {
  try {
    // Lazy: logService owns the redaction engine; cycle-safe (function-level).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const log = require('./logService') as { redactText?: (s: string) => { text: string } };
    if (typeof log.redactText === 'function') return log.redactText(s).text;
  } catch {
    /* fall through to truncation-only */
  }
  return s;
}

export function auditAppend(kind: AuditKind, detail?: unknown): AuditEntry | null {
  const file = auditFile();
  if (!file) return null;
  const entry: AuditEntry = { ts: new Date().toISOString(), kind };
  if (detail !== undefined) {
    // Cap the payload without ever corrupting it: strings are truncated,
    // objects are kept whole when small and summarized when large.
    if (typeof detail === 'string') {
      entry.detail = redactForAudit(detail).slice(0, 300);
    } else {
      try {
        // v11.31 — redact BEFORE capping/truncating: a secret in an object
        // field (e.g. { cmd: 'curl -H "Authorization: Bearer sk-…"' }) has to
        // be scrubbed even when the object is kept whole.
        const json = redactForAudit(JSON.stringify(detail) ?? '');
        entry.detail = json.length <= 600 ? JSON.parse(json) : `${json.slice(0, 120)}… (${json.length}B)`;
      } catch {
        entry.detail = undefined;
      }
    }
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Size cap: rotate to audit.jsonl.1 (single generation — it's a trail, not an archive).
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > AUDIT_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
      /* rotation is best-effort */
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    return null; // auditing must never break the caller
  }
  sendSecurityEvent('kdx:sec:event', entry); // live feed for SecurityPanel
  return entry;
}

function readAuditFile(limit: number): { entries: AuditEntry[]; total: number; blocked: number } {
  const file = auditFile();
  if (!file || !fs.existsSync(file)) return { entries: [], total: 0, blocked: 0 };
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { entries: [], total: 0, blocked: 0 };
  }
  const lines = raw.split('\n').filter((l) => l.trim());
  let blocked = 0;
  const parsed: AuditEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && parsed.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]) as AuditEntry;
      if (e && e.kind === 'term_blocked') blocked++;
      parsed.push(e);
    } catch {
      /* skip torn/corrupt line */
    }
  }
  return { entries: parsed, total: lines.length, blocked };
}

/** Recent audit entries, NEWEST FIRST (default limit 200 — spec `audit_recent`). */
export function auditRecent(limit = 200): AuditEntry[] {
  const n = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 200)));
  return readAuditFile(n).entries;
}

export function auditClear(): { cleared: number } {
  const file = auditFile();
  if (!file) return { cleared: 0 };
  let cleared = 0;
  try {
    if (fs.existsSync(file)) {
      cleared = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length;
      fs.rmSync(file, { force: true });
    }
    fs.rmSync(`${file}.1`, { force: true });
  } catch {
    /* best effort */
  }
  return { cleared };
}

// ============================================================
// Interactive-command guard (called from terminalService.exec)
// ============================================================
export interface GuardDecision {
  blocked: boolean;
  /** Populated when blocked (or when warning) — display reasons. */
  reasons: string[];
  /** True when at least one line produced a 'warn' verdict. */
  warned: boolean;
}

/**
 * Classify user shell input BEFORE it reaches the shell. Multiline
 * paste → each non-empty line is classified individually; the whole
 * submission is held to the WORST verdict. 'danger' in mode 'on'
 * blocks (unless a one-shot override for this exact command exists,
 * which is consumed). Emits kdx:term:blocked / kdx:term:warn.
 */
export function guardInteractive(terminalId: string, cmd: string): GuardDecision {
  const mode = guardMode();
  if (mode === 'off') return { blocked: false, reasons: [], warned: false };

  const lines = String(cmd ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return { blocked: false, reasons: [], warned: false };

  const classify = classifier();
  let danger = false;
  let warned = false;
  const reasons: string[] = [];
  for (const line of lines) {
    const v = classify(line);
    if (v.level === 'danger') {
      danger = true;
      for (const r of v.reasons) if (!reasons.includes(r)) reasons.push(r);
    } else if (v.level === 'warn') {
      warned = true;
      for (const r of v.reasons) if (!reasons.includes(r)) reasons.push(r);
    }
  }

  if (danger && mode === 'on') {
    // One-shot override remembers the EXACT command string.
    if (consumeAllowOnce(cmd)) {
      auditAppend('term_allow', { cmd: redactForAudit(String(cmd).slice(0, 200)), terminalId });
      return { blocked: false, reasons: [], warned: true };
    }
    pruneAllowOnce();
    const redacted = redactForAudit(String(cmd).slice(0, 200));
    auditAppend('term_blocked', { cmd: redacted, terminalId, reasons });
    sendSecurityEvent('kdx:term:blocked', { terminalId, cmd: redacted, reasons });
    return { blocked: true, reasons, warned: false };
  }

  if (danger || warned) {
    // 'warn-only' mode danger, or plain 'warn' in any non-off mode.
    sendSecurityEvent('kdx:term:warn', { terminalId, cmd: redactForAudit(String(cmd).slice(0, 200)), reasons });
  }
  return { blocked: false, reasons: [], warned };
}

// ============================================================
// Minimal STORE-method zip writer (no dependencies) — data export
// ============================================================
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | Math.floor(d.getSeconds() / 2),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f),
  };
}

/** Build a valid (uncompressed) .zip from in-memory entries. Exported for the data-export flow + tests. */
export function makeZip(entries: { name: string; data: Buffer }[]): Buffer {
  const { time, date } = dosDateTime(new Date());
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const size = e.data.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    lh.writeUInt16LE(0, 8); // method: store
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18); // compressed
    lh.writeUInt32LE(size, 22); // uncompressed
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28); // extra len
    local.push(lh, name, e.data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10); // method
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42); // local header offset
    central.push(ch, name);

    offset += 30 + name.length + size;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...local, cd, eocd]);
}

// ============================================================
// Data controls (lazy-reach into services — never edited by us)
// ============================================================
function settingsForExport(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('./storeService') as { getSettings?: () => Record<string, unknown> };
    const s = store.getSettings?.();
    if (!s || typeof s !== 'object') return {};
    // Sanitize: never export provider credentials.
    const providers = { ...((s.providers as Record<string, unknown>) ?? {}) };
    for (const id of Object.keys(providers)) {
      const entry = { ...(providers[id] as Record<string, unknown>) };
      if (entry.apiKey) entry.apiKey = '«redacted»';
      providers[id] = entry;
    }
    return { ...s, providers, billing: { ...((s.billing as object) ?? {}) }, apiServer: { enabled: false, port: undefined, token: '«redacted»' } };
  } catch {
    return {};
  }
}

async function buildExportEntries(): Promise<{ name: string; data: Buffer }[]> {
  const entries: { name: string; data: Buffer }[] = [];
  const j = (v: unknown): Buffer => Buffer.from(JSON.stringify(v, null, 2), 'utf8');

  let settings: Record<string, unknown> = {};
  try {
    settings = settingsForExport() as Record<string, unknown>;
  } catch {
    /* empty */
  }
  entries.push({ name: 'manifest.json', data: j({ app: 'Surnia', exportedAt: new Date().toISOString(), format: 'surnia-data-export/1' }) });
  entries.push({ name: 'settings.json', data: j(settings) });
  entries.push({ name: 'memory.json', data: j({ global: settings.memory ?? '' }) });
  entries.push({ name: 'usage-log.json', data: j(settings.usageLog ?? []) });

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sessions = require('./sessionService') as { list?: () => Promise<unknown[]> };
    if (typeof sessions.list === 'function') {
      entries.push({ name: 'sessions.json', data: j(await sessions.list()) });
    }
  } catch {
    /* sessions stay out of the export */
  }

  // v2.2 — Surnia DNA (the learned user model) is part of a data export.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dnaMod = require('../agent/dna') as { loadDNA?: () => unknown };
    if (typeof dnaMod.loadDNA === 'function') {
      entries.push({ name: 'dna.json', data: j(dnaMod.loadDNA()) });
    }
  } catch {
    /* DNA stays out of the export */
  }

  try {
    const file = auditFile();
    if (file && fs.existsSync(file)) {
      entries.push({ name: 'audit.jsonl', data: Buffer.from(fs.readFileSync(file, 'utf8'), 'utf8') });
    }
  } catch {
    /* audit stays out of the export */
  }
  return entries;
}

async function exportDataZip(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const dir = appDataDir();
  if (!dir) return { ok: false, error: 'APPDATA_UNAVAILABLE' };
  try {
    const outDir = path.join(dir, 'exports');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipPath = path.join(outDir, `surnia-data-${stamp}.zip`);
    const zip = makeZip(await buildExportEntries());
    fs.writeFileSync(zipPath, zip, { mode: 0o600 });
    try {
      electron()?.shell?.showItemInFolder(zipPath);
    } catch {
      /* revealing is optional */
    }
    return { ok: true, path: zipPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function clearAllSessions(): Promise<{ ok: boolean; removed: number; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sessions = require('./sessionService') as {
      list?: () => Promise<{ id?: string }[]>;
      remove?: (id: string) => Promise<unknown> | unknown;
    };
    if (typeof sessions.list !== 'function' || typeof sessions.remove !== 'function') {
      return { ok: false, removed: 0, error: 'SESSION_API_UNAVAILABLE' };
    }
    const all = (await sessions.list()) ?? [];
    let removed = 0;
    for (const s of all) {
      if (s && typeof s.id === 'string') {
        try {
          await sessions.remove(s.id);
          removed++;
        } catch {
          /* keep going */
        }
      }
    }
    return { ok: true, removed };
  } catch (err) {
    return { ok: false, removed: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Clear the agent's AUTO-memory ("## Learned" section of
 * <workspace>/MEMORY.md). Hand-written notes above that section survive.
 */
async function clearAutoMemory(workspace?: string): Promise<{ ok: boolean; cleared: boolean; error?: string }> {
  const ws = String(workspace ?? '').trim();
  if (!ws) return { ok: false, cleared: false, error: 'WORKSPACE_REQUIRED' };
  // v11.11 release audit — PATH JAIL (lazy require: fsService imports this
  // module, so a static import would cycle): the renderer-supplied workspace
  // must sit inside the active confine root / allowed roots like every other
  // fs channel before anything on disk is touched.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsSvc = require('./fsService') as { assertSafePath?: (p: string, label?: string) => string };
    if (typeof fsSvc.assertSafePath === 'function') fsSvc.assertSafePath(ws, 'workspace');
  } catch (err) {
    return { ok: false, cleared: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const realWs = await fs.promises.realpath(ws).catch(() => ws);
    // v11.31 — re-run the jail on the RESOLVED path: a symlinked workspace
    // passes the lexical check above but would otherwise write MEMORY.md
    // outside the allowed roots.
    try {
      const fsSvcReal = require('./fsService') as { assertSafePath?: (p: string, label?: string) => string };
      fsSvcReal.assertSafePath?.(realWs, 'workspace');
    } catch (err) {
      return { ok: false, cleared: false, error: err instanceof Error ? err.message : String(err) };
    }
    const realMem = path.join(realWs, 'MEMORY.md');
    let cleared = false;
    if (fs.existsSync(realMem)) {
      const raw = await fs.promises.readFile(realMem, 'utf8');
      const idx = raw.search(/^##\s+Learned\s*$/m);
      if (idx >= 0) {
        const kept = raw.slice(0, idx).replace(/\n+$/, '\n');
        await fs.promises.writeFile(realMem, kept, { encoding: 'utf8', mode: 0o600 });
        cleared = true;
      }
    }
    // v2.2 — privacy clear now ALSO wipes the workspace DNA layer (the
    // per-workspace extension of the Surnia user model), so a full privacy
    // reset leaves no learned traces for this workspace.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dnaMod = require('../agent/dna') as { clearDNA?: (scope: 'all' | 'workspace', ws?: string) => { cleared?: boolean } };
      if (typeof dnaMod.clearDNA === 'function') dnaMod.clearDNA('workspace', realWs);
    } catch {
      /* DNA module unavailable — memory clear still applies */
    }
    auditAppend('permission', { op: 'clear_auto_memory', workspace: realWs });
    return { ok: true, cleared };
  } catch (err) {
    return { ok: false, cleared: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function clearMcpApprovals(): { ok: boolean; cleared: number; note?: string } {
  try {
    // ENGINE-owned always-allow rules (engine.ts `alwaysRules`). When the
    // ENGINE agent exports clearApprovalRules() we call it; until then the
    // honest answer is "session-scoped, cleared on restart".
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const engine = require('../agent/engine') as Record<string, unknown>;
    const fn = engine?.clearApprovalRules;
    if (typeof fn === 'function') {
      const n = (fn as () => number | void)() ?? 0;
      return { ok: true, cleared: typeof n === 'number' ? n : 0 };
    }
    return { ok: true, cleared: 0, note: 'Approval rules are session-scoped; they clear when the app restarts.' };
  } catch {
    return { ok: true, cleared: 0, note: 'Approval rules are session-scoped; they clear when the app restarts.' };
  }
}

/**
 * v2.2 — wipe the PERSISTENT per-workspace approval rules
 * (<userData>/approval-rules.json) plus the in-memory session rules.
 */
function clearApprovalRules(): { ok: boolean; cleared: number } {
  let n = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const engine = require('../agent/engine') as Record<string, unknown>;
    const memFn = engine?.clearApprovalRules;
    if (typeof memFn === 'function') {
      const m = (memFn as () => number | void)() ?? 0;
      n += typeof m === 'number' ? m : 0;
    }
    const persistFn = engine?.clearPersistentApprovalRules;
    if (typeof persistFn === 'function') {
      const p = (persistFn as () => number | void)() ?? 0;
      n += typeof p === 'number' ? p : 0;
    }
    auditAppend('permission', { op: 'clear_persistent_approvals', count: n });
    return { ok: true, cleared: n };
  } catch {
    return { ok: true, cleared: n };
  }
}

// ============================================================
// Security status (kdx:sec:status — PrivacySection / SecurityPanel)
// ============================================================
export interface SecurityStatusResult {
  terminalGuard: GuardMode;
  fsConfinement: boolean;
  allowedRoots: string[];
  redactionsThisSession: number;
  blockedCommands: number;
  auditCount: number;
  secretsStored: number;
  safeStorage: { available: boolean; backend: string | null };
}

function securityStatus(): SecurityStatusResult {
  const audit = readAuditFile(2000);
  let redactions = 0;
  let fsConfinement = false;
  let allowedRoots: string[] = [];
  let secretsStored = 0;
  let safeStorage: SecurityStatusResult['safeStorage'] = { available: false, backend: null };

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const log = require('./logService') as { sessionRedactions?: () => number };
    redactions = typeof log.sessionRedactions === 'function' ? log.sessionRedactions() : 0;
  } catch {
    /* keep 0 */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsSvc = require('./fsService') as {
      confineActive?: () => boolean;
      listAllowedRoots?: () => string[];
    };
    fsConfinement = typeof fsSvc.confineActive === 'function' ? fsSvc.confineActive() : false;
    allowedRoots = typeof fsSvc.listAllowedRoots === 'function' ? fsSvc.listAllowedRoots() : [];
  } catch {
    /* keep defaults */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('./storeService') as { getSettings?: () => Record<string, unknown> };
    const providers = ((store.getSettings?.() as { providers?: Record<string, { apiKey?: string }> })?.providers) ?? {};
    secretsStored = Object.values(providers).filter((p) => p && typeof p.apiKey === 'string' && p.apiKey.length > 0).length;
  } catch {
    /* keep 0 */
  }
  try {
    const ss = electron()?.safeStorage;
    if (ss) {
      const available = ss.isEncryptionAvailable();
      safeStorage = { available, backend: available ? (ss.getSelectedStorageBackend?.() ?? null) : null };
    }
  } catch {
    safeStorage = { available: false, backend: null };
  }

  return {
    terminalGuard: guardMode(),
    fsConfinement,
    allowedRoots,
    redactionsThisSession: redactions,
    blockedCommands: audit.blocked,
    auditCount: audit.total,
    secretsStored,
    safeStorage,
  };
}

// ============================================================
// IPC registration (called at boot from terminalService — ipc.ts untouched)
// ============================================================
let inited = false;

export function initTerminalGuard(): void {
  if (inited) return;
  const api = electron();
  const ipcMain = api?.ipcMain;
  if (!ipcMain || typeof ipcMain.handle !== 'function') return; // CLI / non-Electron
  inited = true;

  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    try {
      ipcMain.handle(channel, async (_event: unknown, ...args: unknown[]) => {
        try {
          return await fn(...args);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
    } catch {
      /* channel already registered — never crash boot over it */
    }
  };

  // P1 (launch audit) — arming a one-shot guard bypass is a SECURITY action.
  // Only the app's own renderer (packaged surnia://bundle/ or file:, or the
  // loopback dev server) may do it; a foreign frame must not be able to
  // silently disarm the terminal gate.
  // Same origin rule as the kdx:cmd:run hardening in ipc.ts. Kept LOCAL to this
  // module on purpose: importing ipc.ts here would pull the whole IPC graph
  // (and self-registering services) into the CLI/test bundles.
  const isTrustedRenderer = (event: unknown): boolean => {
    const url = (event as { senderFrame?: { url?: string } } | null)?.senderFrame?.url ?? '';
    // PACKAGED renderer = surnia://bundle/index.html (main.ts serveRenderer/
    // loadIndex privileged scheme); file: is its fallback, loopback http(s) is
    // Vite DEV. Mirrors ipc.ts isTrustedRenderer — kept local to avoid pulling
    // the whole IPC graph into the CLI/test bundles.
    if (/^surnia:\/\/bundle\//i.test(url)) return true;
    if (/^file:/i.test(url)) return true;
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(url);
  };
  const handleChecked = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    try {
      ipcMain.handle(channel, async (event: unknown, ...args: unknown[]) => {
        try {
          if (!isTrustedRenderer(event)) return { ok: false, armed: false, error: 'UNTRUSTED_SENDER' };
          return await fn(...args);
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
    } catch {
      /* channel already registered — never crash boot over it */
    }
  };

  // one-shot terminal override — sender-checked, guard logic unchanged
  handleChecked('kdx:term:allowOnce', (cmd: unknown) => {
    if (!armAllowOnce(cmd)) return { ok: false, armed: false, error: 'CMD_REQUIRED' };
    return { ok: true, armed: guardMode() === 'on' };
  });

  // audit trail
  handle('kdx:sec:auditRecent', (limit?: unknown) => auditRecent(Number(limit) || 200));
  handle('kdx:sec:auditClear', () => auditClear());

  // status
  handle('kdx:sec:status', () => securityStatus());

  // data controls
  handle('kdx:sec:clearSessions', () => clearAllSessions());
  handle('kdx:sec:clearMemory', (workspace?: unknown) => clearAutoMemory(workspace as string | undefined));
  handle('kdx:sec:clearMcpApprovals', () => clearMcpApprovals());
  // v2.2 — persistent "always allow" rules (approval-rules.json) wipe
  handle('kdx:sec:clearApprovals', () => clearApprovalRules());
  handle('kdx:sec:exportData', () => exportDataZip());
}
