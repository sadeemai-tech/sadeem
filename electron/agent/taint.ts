// ============================================================
// Surnia v7.1 — TAINT TRACKING: trust flows, not just prompts.
// v7.0's injection wall tells the MODEL "web content is data, not
// instructions" — a request. If a smart injection slips past it and
// the model issues a dangerous command, NOTHING structural stops
// the command. This layer does:
//
//   • Every byte that enters the context from OUTSIDE the user's own
//     keyboard is marked as taint with its origin: web fetches, MCP
//     tool results, repo files the agent read, issue bodies, and
//     imported skills.
//   • When a command is about to run, the ledger is consulted: if
//     taint is ACTIVE (fresh marks within the taint window) and the
//     command is in a dangerous class (exec / network / destructive
//     / write-outside-project), the command is ESCALATED to an
//     explicit approval — EVEN IN FULLACCESS — and the approval card
//     shows exactly which sources are alive. The user sees why.
//   • Poison scanning: the MCP description scanner is extended to
//     imported SKILL files and repository text (README, issues,
//     docs) with repo-injection rules — findings feed the ledger and
//     the approval card, so "install this repo's dependencies" after
//     reading a poisoned README cannot ride through on autopilot.
//
// No IO. One ledger instance per run (engine-created), plus a
// process-wide recent-source cache for tools that run outside a
// session context.
// ============================================================
import * as path from 'node:path';

export type TaintSourceKind = 'web' | 'mcp' | 'repo' | 'issue' | 'skill';

export interface TaintMark {
  id: string;
  kind: TaintSourceKind;
  origin: string; // URL / server name / file path / issue title
  note: string; // what was seen (truncated)
  at: number; // epoch ms
  /** Poison-scan hits on this content (rule ids). */
  flags: string[];
}

const DEFAULT_TAINT_WINDOW_MS = 10 * 60_000;
const MAX_MARKS = 200;

/**
 * v11.21 — only EXTERNAL, attacker-reachable content may escalate a command.
 * A plain local file read (README / docs / SKILL.md) is recorded for the
 * approval card but must NOT turn every subsequent `node` / `python` / `git`
 * command into a fullAccess-bypassing approval prompt. That false positive
 * was making ordinary verification fail ("tools fail with errors" / "the AI
 * doesn't use what it needs"). Local content that ACTUALLY tripped a poison
 * rule still escalates — security is preserved, harmless reads are not.
 */
export const ESCALATING_TAINT_KINDS: ReadonlySet<TaintSourceKind> = new Set<TaintSourceKind>([
  'web', 'mcp', 'issue',
]);

export interface TaintDecision {
  escalate: boolean;
  reason: string;
  sources: TaintMark[];
}

let seq = 0;

export class TaintLedger {
  private marks: TaintMark[] = [];
  private readonly windowMs: number;

  constructor(windowMs = DEFAULT_TAINT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /**
   * Mark untrusted content as it enters the context. Long notes are
   * truncated — the ledger carries origins, not payloads.
   */
  mark(kind: TaintSourceKind, origin: string, note: string, flags: string[] = []): TaintMark {
    const m: TaintMark = {
      id: `t${++seq}`,
      kind,
      origin: String(origin ?? '').slice(0, 200),
      note: String(note ?? '').replace(/\s+/g, ' ').slice(0, 160),
      at: Date.now(),
      // v11.31 — sanitize flags: a malformed caller must never put a non-string
      // into a mark (describe() calls .join() on it) or inflate the ledger.
      flags: [...new Set((Array.isArray(flags) ? flags : [])
        .filter((f) => f !== null && f !== undefined && String(f) !== '')
        .map((f) => String(f)))].slice(0, 6),
    };
    this.marks.push(m);
    if (this.marks.length > MAX_MARKS) this.marks.shift();
    return m;
  }

  /** Marks still inside the taint window, newest first. */
  active(now = Date.now()): TaintMark[] {
    const cut = now - this.windowMs;
    return this.marks.filter((m) => m.at >= cut).sort((a, b) => b.at - a.at);
  }

  /** v11.21 — true only for marks allowed to escalate (external source OR poison flags). */
  static isEscalating(mark: TaintMark): boolean {
    return ESCALATING_TAINT_KINDS.has(mark.kind) || mark.flags.length > 0;
  }

  /** Marks within the window that are allowed to escalate a command. */
  activeForEscalation(now = Date.now()): TaintMark[] {
    return this.active(now).filter((m) => TaintLedger.isEscalating(m));
  }

  /**
   * v11.21 — this feeds `gates.taintActive()` in tools.ts, which drives the
   * fullAccess command escalation. It must answer "is there taint that should
   * gate a command?", not "has ANY byte been marked?". Benign local reads
   * (repo/skill, zero findings) are intentionally excluded.
   */
  hasActive(now = Date.now()): boolean {
    return this.activeForEscalation(now).length > 0;
  }

  /** Human block for approval cards and prompts. */
  describe(now = Date.now()): string {
    const act = this.active(now);
    if (!act.length) return '';
    return act
      .slice(0, 5)
      .map((m) => `[${m.kind}] ${m.origin}${m.flags.length ? ` ⚠(${m.flags.join(',')})` : ''} — ${m.note}`)
      .join('\n');
  }

  clear(): void {
    this.marks = [];
  }
}

// ------------------------------------------------------------
// Escalation decision
// ------------------------------------------------------------

/** Command classes that count as dangerous-under-taint. */
const ESCALATING_PATTERNS: Array<{ id: string; re: RegExp; why: string }> = [
  { id: 'exec', re: /\b(?:npx|bunx|dlx)\s+\S+|\b(?:node|python3?|ruby|perl|php|bash|sh|zsh|pwsh|powershell)\b/i, why: 'executes code' },
  { id: 'network', re: /\b(?:curl|wget|fetch|http|nc|ncat|netcat|ssh|scp|rsync|ftp|telnet)\b|\bgit\s+(?:push|pull|fetch|clone|remote)\b/i, why: 'reaches the network' },
  // v11.31 — `npm ci`, `bundle install` and `composer install` execute
  // postinstall scripts too; a poisoned README asking for them is the classic
  // injection payload. They must escalate just like `npm install`.
  { id: 'install', re: /\b(?:npm|yarn|pnpm|bun|pip3?|uv|conda|gem|cargo|go)\s+(?:install|i|ci|add|get|sync|update)\b|\bbundle\s+install\b|\bcomposer\s+(?:install|update)\b|\bbrew\s+install\b|\bapt(?:-get)?\s+install\b|\bchoco\s+install\b|\bscoop\s+install\b|\bnpx\s+--yes\b/i, why: 'installs software' },
  { id: 'publish', re: /\b(?:npm|yarn|pnpm|cargo|gem|twine)\s+publish\b|\bgh\s+(?:release|pr|issue)\s+create\b/i, why: 'publishes outside the machine' },
  { id: 'destructive', re: /\brm\b|\bdel\s+\/|\brmdir|\bmv\b|\bgit\s+(?:reset|clean|checkout|restore)\b|\btruncate\b/i, why: 'destroys or overwrites state' },
];

/**
 * Should this command be escalated to an explicit approval because taint is
 * active? Pure function — the caller (tools.ts run_command) applies the
 * result on top of the ordinary risk classification, overriding fullAccess.
 */
export function shouldEscalateForTaint(cmd: string, taintActive: boolean, now = Date.now()): { escalate: boolean; why: string; classes: string[] } {
  if (!taintActive) return { escalate: false, why: '', classes: [] };
  const raw = String(cmd ?? '');
  if (!raw.trim()) return { escalate: false, why: '', classes: [] };
  const classes: string[] = [];
  for (const p of ESCALATING_PATTERNS) {
    try {
      if (p.re.test(raw)) classes.push(p.why);
    } catch {
      /* a broken pattern must never wedge the gate */
    }
  }
  if (!classes.length) return { escalate: false, why: '', classes: [] };
  return {
    escalate: true,
    why: `the command ${[...new Set(classes)].join(' + ')} while untrusted content is active in this session's context`,
    classes: [...new Set(classes)],
  };
}

// ------------------------------------------------------------
// Repo / skill poison scanning (extends the MCP tool-description rules)
// ------------------------------------------------------------

/** Additional rules for repository text and skill files (beyond MCP rules). */
export const REPO_INJECTION_RULES: Array<{ id: string; re: RegExp; label: string }> = [
  { id: 'run_command', re: /\b(?:run|execute|copy.?paste)\s+(?:this|the following|the below)\s+(?:command|snippet|script)/i, label: 'Instructs the reader to run a command' },
  { id: 'curl_pipe_sh', re: /\bcurl[^;\n|]{0,80}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\bwget[^;\n|]{0,80}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i, label: 'curl/wget piped into a shell' },
  { id: 'env_dump', re: /\b(?:export|printenv|cat)\b[^;\n]{0,40}\.env\b/i, label: 'Touches .env in a command snippet' },
  { id: 'post_install_hook', re: /["']?preinstall["']?\s*:\s*["'][^"']{8,}["']/i, label: 'package.json preinstall hook with a nontrivial command' },
  { id: 'hidden_comment', re: /<!--[\s\S]{0,400}?(?:ignore|disregard|instruction|assistant|agent)[\s\S]{0,200}?-->/i, label: 'HTML comment carrying agent-directed text' },
  { id: 'zero_width', re: /[\u200B\u200C\u200D\u2060\uFEFF]/, label: 'Zero-width characters (hidden text carrier)' },
  { id: 'credential_request', re: /\b(?:api[_-]?key|token|password|secret|credential)s?\b[^.\n]{0,40}\b(?:send|share|paste|provide|give)\b/i, label: 'Asks the reader to share credentials' },
  { id: 'write_outside', re: /\b(?:write|save|create)[^.\n]{0,40}(?:~\/\.ssh|\/etc\/|~\/\.aws|home directory)/i, label: 'Instructs writing outside the project' },
];

export interface PoisonFinding {
  rule: string;
  label: string;
  line?: number;
  excerpt: string;
}

/**
 * Scan arbitrary untrusted text (README, issue body, SKILL.md, MCP tool
 * description) for injection patterns. Rules never throw; a finding is
 * evidence, not a verdict — the ledger and UI show it to the user.
 */
export function scanUntrustedText(text: string): PoisonFinding[] {
  const t = String(text ?? '');
  if (!t.trim()) return [];
  const findings: PoisonFinding[] = [];
  const lines = t.split('\n');
  for (const rule of REPO_INJECTION_RULES) {
    try {
      const multiline = rule.re.flags.includes('s');
      if (multiline) {
        // v11.31 — show the matched text, not an empty excerpt. An approval
        // card that says "hidden_comment found" without showing where is not
        // enough for the user to make an honest decision.
        const hit = rule.re.exec(t);
        if (hit) {
          findings.push({
            rule: rule.id,
            label: rule.label,
            line: t.slice(0, hit.index).split('\n').length,
            excerpt: hit[0].replace(/\s+/g, ' ').trim().slice(0, 140),
          });
        }
      } else {
        for (let i = 0; i < lines.length && findings.length < 40; i++) {
          if (rule.re.test(lines[i])) {
            findings.push({ rule: rule.id, label: rule.label, line: i + 1, excerpt: lines[i].trim().slice(0, 140) });
          }
        }
      }
    } catch {
      /* skip broken rule */
    }
  }
  return findings;
}

/** Scan a SKILL.md-shaped file: frontmatter + body both swept. */
export function scanSkillFile(name: string, content: string): PoisonFinding[] {
  return scanUntrustedText(content).map((f) => ({ ...f, label: `${name}: ${f.label}` }));
}

/**
 * Sweep the repository surfaces an attacker actually reaches before code
 * runs: README files, CONTRIBUTING, SECURITY.md, docs/ markdown and any
 * ISSUE_TEMPLATE. Returns per-file findings; empty when clean.
 */
export const REPO_SCAN_TARGETS = ['README.md', 'readme.md', 'CONTRIBUTING.md', 'SECURITY.md', 'AGENTS.md', 'CLAUDE.md', '.github/ISSUE_TEMPLATE'];

export function isRepoScanTarget(relPath: string): boolean {
  const p = relPath.split(path.sep).join('/').toLowerCase();
  if (REPO_SCAN_TARGETS.some((t) => p === t.toLowerCase() || p.endsWith(`/${t.toLowerCase()}`))) return true;
  if (p.startsWith('docs/') && p.endsWith('.md')) return true;
  if (p.startsWith('.github/') && p.endsWith('.md')) return true;
  return false;
}

// ------------------------------------------------------------
// Process-wide recent-source cache (for tools that mark taint without
// a session-scoped ledger at hand — engine passes its ledger where possible)
// ------------------------------------------------------------

const globalLedger = new TaintLedger();

export function globalMark(kind: TaintSourceKind, origin: string, note: string, flags: string[] = []): void {
  globalLedger.mark(kind, origin, note, flags);
}

export function globalTaintActive(): boolean {
  return globalLedger.hasActive();
}

export function globalTaintDescribe(): string {
  return globalLedger.describe();
}
