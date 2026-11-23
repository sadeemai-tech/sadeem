// ============================================================
// Surnia — rotating file logger (main + renderer diagnostics).
// Everything that can go wrong at boot lands here, so a bug is
// always diagnosable from %APPDATA%/Surnia/logs/main.log instead
// of a silent white screen.
// E4 SECURITY: every line is REDACTED before it is written — API
// keys (sk-…), Bearer tokens, AWS access keys (AKIA…), GitHub
// tokens (ghp_/github_pat_…), password=/api_key=… assignments and
// Authorization/x-api-key headers are replaced with «redacted».
// Redactions are counted per session (sessionRedactions) and
// audited (audit.jsonl 'secret_redacted').
//
// v11.31 audit fixes:
//   · rotation uses SYNCHRONOUS append + pre-flight size check, so a
//     WriteStream flush can no longer race the rename and lose logs;
//   · the TAG is redacted too (it used to bypass redaction entirely);
//   · extra providers (Slack/Stripe/private keys/AWS secret key) are
//     redacted;
//   · getLogExport() drops a partial first line so a secret split by
//     the tail boundary cannot leak as a fragment;
//   · I/O failures are reported once to stderr instead of vanishing.
// ============================================================
import fs from 'fs';
import path from 'path';

export const MAX_FILE_BYTES = 512 * 1024; // rotate at 512 KB
export const MAX_FILES = 4; // keep main.log + 3 rotations

let logDir: string | null = null;
let ioWarned = false;

function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err ?? '').slice(0, 240);
}

/** One-time stderr notice for a disk failure — never crash because of logging. */
function reportIoFailure(where: string, err: unknown): void {
  if (ioWarned) return;
  ioWarned = true;
  try {
    process.stderr.write(`[surnia][logService] ${where}: ${errText(err)}\n`);
  } catch {
    /* nothing left to write to */
  }
}

function rotate(file: string): void {
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    const to = `${file}.${i}`;
    try {
      if (!fs.existsSync(from)) continue;
      // Windows refuses rename-onto-existing in some environments.
      if (fs.existsSync(to)) fs.rmSync(to, { force: true });
      fs.renameSync(from, to);
    } catch (err) {
      reportIoFailure('rotate', err);
    }
  }
}

/** Append one already-formatted line, rotating BEFORE a write would overflow. */
function appendLine(line: string): void {
  if (!logDir) return; // init() not called yet — stdout only
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, 'main.log');
    const bytes = Buffer.byteLength(line, 'utf8');
    let size = 0;
    try {
      size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    } catch {
      /* size probe is best-effort */
    }
    if (size > 0 && size + bytes > MAX_FILE_BYTES) rotate(file);
    fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    reportIoFailure('append', err);
  }
}

export function initLog(userDataDir: string): void {
  try {
    logDir = path.join(userDataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    reportIoFailure('init', err);
    logDir = null;
  }
}

// ---------- E4 secret redaction ----------
const REDACTED = '«redacted»';

/** Order matters little; each pattern is independent. Kept tight to avoid false positives. */
const REDACT_PATTERNS: RegExp[] = [
  /\bsk-(?!learn)[A-Za-z0-9_-]{10,}/g, // OpenAI/Anthropic-style sk- keys (sk-proj-, sk-ant-, sk-…)
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Bearer tokens
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, // AWS access key IDs
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub classic tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PATs
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API keys (AIza…)
  /\bsk-or-v1-[A-Za-z0-9]{16,}\b/g, // OpenRouter keys (belt & braces under sk-)
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe live/test keys
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\b(?:aws_)?secret[_-]access[_-]key\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s&;"']+)/gi, // AWS secret access key
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, // PEM private keys
  /\bauthorization\s*:\s*\S+(?:\s+[A-Za-z0-9._~+/=-]{8,})?/gi, // Authorization headers (scheme + credential)
  /\bx-api-key\s*:\s*\S+(?:\s+[A-Za-z0-9._~+/=-]{8,})?/gi, // x-api-key headers
  /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s&;"']+)/gi, // password=… / api_key: …
];

/** E4: replace credential-looking substrings with «redacted». Returns hit count. */
export function redactText(input: string): { text: string; hits: number } {
  let text = String(input ?? '');
  let hits = 0;
  for (const re of REDACT_PATTERNS) {
    text = text.replace(re, () => {
      hits++;
      return REDACTED;
    });
  }
  return { text, hits };
}

let sessionRedactionCount = 0;

/** E4: how many secrets this session's logger has kept out of the log file. */
export function sessionRedactions(): number {
  return sessionRedactionCount;
}

/** Best-effort audit of redactions (lazy require → cycle- and CLI-safe). */
function auditSecretRedaction(count: number, tag: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tg = require('./terminalGuard') as { auditAppend?: (k: string, d?: unknown) => void };
    tg.auditAppend?.('secret_redacted', { count, tag });
  } catch {
    /* auditing must never break logging */
  }
}

export function logLine(level: 'debug' | 'info' | 'warn' | 'error', tag: string, msg: string): void {
  // v11.4 — settings.logs.level threshold: lines below it never touch stdout or disk.
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const ts = new Date().toISOString();
  // E4: redact BEFORE formatting/writing — the log file never sees secrets.
  // Both the MESSAGE and the TAG are redacted (the tag used to leak).
  const redMsg = redactText(String(msg));
  const redTag = redactText(String(tag));
  const hits = redMsg.hits + redTag.hits;
  if (hits > 0) {
    sessionRedactionCount += hits;
    auditSecretRedaction(hits, redTag.text);
  }
  const cleanTag = redTag.text.replace(/\s+/g, ' ').slice(0, 80);
  const line = `[${ts}] [${level.toUpperCase()}] [${cleanTag}] ${redMsg.text.replace(/\s+/g, ' ').slice(0, 2000)}\n`;
  process.stdout.write(line); // always visible in terminal / CI
  appendLine(line);
}

export function logPath(): string | null {
  return logDir ? path.join(logDir, 'main.log') : null;
}

/** v11.4 — the logs directory itself (Settings → Logs → Open folder). */
export function logsDirPath(): string | null {
  return logDir;
}

// ---------- v11.4 — level filter (settings.logs.level) ----------
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = 'info';

/** Apply a level threshold ('debug'|'info'|'warn'|'error'); anything invalid keeps the current one. */
export function setLogLevel(level: unknown): void {
  const l = String(level ?? '');
  if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error') minLevel = l;
}

/** Current threshold (for the settings pane readout). */
export function getLogLevel(): LogLevel {
  return minLevel;
}

/**
 * v11.4 — clear the diagnostics log: truncate main.log and drop the rotations.
 * Best-effort; the next line simply appends to the fresh file.
 */
export function clearLog(): { ok: boolean; path?: string; error?: string } {
  const file = logPath();
  if (!file) return { ok: false, error: 'LOG_NOT_INITIALIZED' };
  try {
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      try {
        fs.rmSync(`${file}.${i}`, { force: true });
      } catch {
        /* rotation may not exist */
      }
    }
    fs.writeFileSync(file, '', { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/**
 * E4: sanitized log tail for any export/feedback flow. Reads at most the
 * last `maxBytes` of main.log, DROPS the partial first line (so a secret
 * split across the byte boundary cannot leak as a fragment), and re-applies
 * redaction (defense in depth — older lines were written pre-E4).
 * Always reports `sanitized: true`.
 */
export function getLogExport(maxBytes = 256 * 1024): {
  path: string | null;
  content: string | null;
  sanitized: true;
  sessionRedactions: number;
} {
  const file = logPath();
  if (!file || !fs.existsSync(file)) {
    return { path: file, content: null, sanitized: true, sessionRedactions: sessionRedactionCount };
  }
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const len = size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      let text = buf.toString('utf8');
      if (start > 0) {
        // A tail slice begins mid-line; keep only complete lines.
        const nl = text.indexOf('\n');
        text = nl >= 0 ? text.slice(nl + 1) : '';
      }
      const red = redactText(text);
      return { path: file, content: red.text, sanitized: true, sessionRedactions: sessionRedactionCount };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    reportIoFailure('export', err);
    return { path: file, content: null, sanitized: true, sessionRedactions: sessionRedactionCount };
  }
}
