// ============================================================
// SADEEM v11.10 — approval policy service ("who is pre-allowed?")
// ------------------------------------------------------------
// The ENGINE (electron/agent/engine.ts) owns the approval GATE and
// persists "always allow" / "always reject" decisions per workspace:
//
//   <userData>/approval-rules.json       { <wsHash>: { <ruleKey>: { command, ts } } }
//   <userData>/approval-deny-rules.json  same shape (DENY beats ALLOW)
//
// This service is the management surface over the SAME files (same
// hash function, same shape — no second source of truth, engine.ts is
// NOT modified):
//   • list(workspace?)    — every granted/rejected rule for the
//     settings UI (per-rule Revoke buttons, EN+AR).
//   • revoke(workspace|*, key) — remove ONE rule key (allow or deny
//     side) and rewrite the store (0600).
//   • clearAll()          — wipe both stores (Privacy already had this
//     via kdx:sec:clearApprovals → engine.clear*; here for the section's
//     button we reuse the engine function through the same lazy require).
// Non-Electron (CLI/tests): falls back to SADEEM_TEST_USERDATA or a
// temp dir so nothing crashes outside the app.
// ============================================================
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { PermissionDecision } from '../../shared/types';

export interface ApprovalRuleEntry {
  /** ruleKey — 'cmd:npm install' | 'write' | 'mcp:toolName' | 'delete' … */
  key: string;
  /** The command (or tool/title) the decision was made on. */
  command: string;
  ts: number;
  /** true = always-allow rule, false = always-reject (deny) rule. */
  allow: boolean;
}

export interface ApprovalRuleGroup {
  /** Resolved workspace path when known, else the hash. */
  workspace: string;
  workspaceHash: string;
  rules: ApprovalRuleEntry[];
}

export interface ApprovalsListResult {
  groups: ApprovalRuleGroup[];
  total: number;
  file: string;
}

interface RulesFile {
  [wsHash: string]: { [ruleKey: string]: { command: string; ts: number } };
}

function userDataDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = (require('electron') as { app?: { getPath?: (k: string) => string } }).app;
    const dir = app?.getPath?.('userData');
    if (dir) return dir;
  } catch {
    /* non-electron — fall through */
  }
  // tests / CLI: SADEEM_TEST_USERDATA matches the electron-stub contract,
  // then a per-process temp dir (never the real user data).
  if (process.env.SADEEM_TEST_USERDATA) return process.env.SADEEM_TEST_USERDATA;
  return path.join(os.tmpdir(), `sadeem-approvals-${process.pid}`);
}

function allowPath(): string {
  return path.join(userDataDir(), 'approval-rules.json');
}

function denyPath(): string {
  return path.join(userDataDir(), 'approval-deny-rules.json');
}

/** Same hash discipline as engine.workspaceHashKey — MUST stay identical. */
export function workspaceHashKey(workspace: string): string {
  try {
    return createHash('sha1')
      .update(path.resolve(workspace || process.cwd()))
      .digest('hex')
      .slice(0, 16);
  } catch {
    return 'unknown';
  }
}

function readRules(file: string): RulesFile {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8')) as RulesFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRules(file: string, data: RulesFile): void {
  // v11.31 — NO silent failure: if a decision cannot be persisted, callers
  // must know (fail closed) instead of reporting a false "always allowed".
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  // v11.38 — `mode` only applies at CREATION time. A pre-existing rules file
  // created by an older build (or copied from another machine) can still be
  // 0644/0666 — i.e. world-readable. Re-assert 0600 on EVERY write. chmod is
  // a no-op/best-effort on Windows ACLs, so a failure there is not fatal; on
  // POSIX a failed chmod is surfaced (fail closed) rather than ignored.
  try {
    fsSync.chmodSync(file, 0o600);
  } catch (err) {
    if (process.platform !== 'win32') throw err;
  }
}

/** Human-resolvable workspace path for a hash: ask the session/fs layers? —
 * keep it honest: we show the hash when the path is unknown (rules created
 * by another machine / cleaned sessions). The renderer passes the ACTIVE
 * workspace so its own group resolves to a real path. */
function resolveWsPath(hash: string, knownWorkspaces: string[]): string {
  const hit = knownWorkspaces.find((w) => workspaceHashKey(w) === hash);
  return hit ?? hash;
}

export function list(workspace?: string): ApprovalsListResult {
  const groups: ApprovalRuleGroup[] = [];
  let total = 0;
  const known = workspace && workspace.trim() ? [workspace.trim()] : [];
  const collect = (file: string, allow: boolean): void => {
    const data = readRules(file);
    for (const [hash, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== 'object') continue;
      let group = groups.find((g) => g.workspaceHash === hash);
      if (!group) {
        group = { workspace: resolveWsPath(hash, known), workspaceHash: hash, rules: [] };
        groups.push(group);
      }
      for (const [key, v] of Object.entries(entry)) {
        if (!v || typeof v !== 'object') continue;
        group.rules.push({ key, command: String(v.command ?? ''), ts: Number(v.ts ?? 0), allow });
        total++;
      }
    }
  };
  collect(allowPath(), true);
  collect(denyPath(), false);
  for (const g of groups) g.rules.sort((a, b) => b.ts - a.ts);
  groups.sort((a, b) => (a.workspace === workspace ? -1 : b.workspace === workspace ? 1 : 0));
  return { groups, total, file: allowPath() };
}

/**
 * Revoke ONE rule (allow or deny side) for one workspace — or every
 * workspace when workspace is '*' / empty. Returns how many were removed.
 */
export function revoke(workspace: string | undefined, key: string): number {
  const k = String(key ?? '').trim();
  if (!k) return 0;
  let n = 0;
  for (const file of [allowPath(), denyPath()]) {
    const data = readRules(file);
    const hashKeys = workspace && workspace !== '*' && workspace.trim()
      ? [workspaceHashKey(workspace)]
      : Object.keys(data);
    for (const hash of hashKeys) {
      const entry = data[hash];
      if (entry && typeof entry === 'object' && entry[k]) {
        delete entry[k];
        n++;
        if (Object.keys(entry).length === 0) delete data[hash];
      }
    }
    writeRules(file, data);
  }
  return n;
}

/** Revoke every rule for one workspace (allow + deny). */
export function revokeWorkspace(workspace: string): number {
  const hash = workspaceHashKey(workspace);
  let n = 0;
  for (const file of [allowPath(), denyPath()]) {
    const data = readRules(file);
    const entry = data[hash];
    if (entry && typeof entry === 'object') {
      n += Object.keys(entry).length;
      delete data[hash];
      writeRules(file, data);
    }
  }
  return n;
}

// ============================================================
// v11.31 — EXPLICIT DECISION MODEL (allow-once / always / deny)
// ------------------------------------------------------------
// The engine owns the live gate; this service is the honest management +
// persistence surface used by headless/remote callers. Every decision maps
// to ONE canonical engine action. Unknown actions are REJECTED (fail closed)
// — never silently coerced into "allow once". 'once' and 'deny' are one-shot
// (no persistence); 'always' persists an allow rule; 'never' persists a deny
// rule (deny wins over allow on the next read, matching engine precedence).
// ============================================================

export type ApprovalPolicyAction = 'once' | 'always' | 'deny' | 'never';

export interface ApprovalDecisionInput {
  requestId: string;
  workspace: string;
  /** Engine rule key (see ruleKeyFor) — the exact thing being approved. */
  key: string;
  /** Human-readable command/tool for the persisted rule record. */
  command: string;
  action: ApprovalPolicyAction;
  /** Who decided (desktop user / paired device) — recorded in the audit log. */
  actor?: string;
}

export interface ApprovalDecisionResult {
  ok: boolean;
  error?: string;
  /**
   * v11.38 — a CLARIFYING, bilingual reason for the outcome. A deny is never
   * silent and never coerced: callers can show exactly why a decision failed
   * (EN + AR) instead of a generic "rejected".
   */
  hint?: { en: string; ar: string };
  /** Canonical action handed to the engine gate. */
  action: PermissionDecision['action'];
  /** Which store (if any) was written. */
  persisted: 'allow' | 'deny' | null;
}

const APPROVAL_ACTIONS: ReadonlySet<string> = new Set(['once', 'always', 'deny', 'never']);

/**
 * v11.38 — explicit, bilingual hints. These are the ONLY canonical reasons a
 * decision can fail; every failure path returns one so a remote/desktop caller
 * never has to guess whether "no" meant "denied", "malformed" or "too weak".
 */
export function decisionHint(code: string): { en: string; ar: string } {
  switch (code) {
    case 'UNKNOWN_APPROVAL_ACTION':
      return {
        en: 'Unknown approval choice — nothing was granted. Choose once, always, deny or never.',
        ar: 'خيار الموافقة غير معروف — لم يُمنح أي إذن. اختر مرة واحدة، دائماً، رفض، أو لا أبداً.',
      };
    case 'INVALID_APPROVAL_REQUEST':
      return {
        en: 'The approval request is incomplete (missing request id or rule key) — nothing was granted.',
        ar: 'طلب الموافقة ناقص (لا يوجد معرّف طلب أو مفتاح قاعدة) — لم يُمنح أي إذن.',
      };
    case 'INVALID_APPROVAL_WORKSPACE':
      return {
        en: 'A persisted rule needs the active workspace — nothing was granted.',
        ar: 'القاعدة الدائمة تحتاج مساحة العمل النشطة — لم يُمنح أي إذن.',
      };
    case 'allow':
      return { en: 'Allowed once. No standing rule was saved.', ar: 'مسموح مرة واحدة. لم تُحفظ قاعدة دائمة.' };
    case 'always':
      return { en: 'Allowed and remembered for this workspace. Revoke it in Privacy.', ar: 'مسموح ومحفوظ لمساحة العمل هذه. يمكنك إلغاؤه في الخصوصية.' };
    case 'deny':
      return { en: 'Denied for this request. Nothing was saved.', ar: 'مرفوض لهذا الطلب. لم يُحفظ شيء.' };
    case 'never':
      return { en: 'Denied permanently for this workspace. Revoke it in Privacy.', ar: 'مرفوض نهائياً لمساحة العمل هذه. يمكنك إلغاؤه في الخصوصية.' };
    default:
      return {
        en: 'The request was refused. No permission was granted.',
        ar: 'تم رفض الطلب. لم يُمنح أي إذن.',
      };
  }
}

/** Same command-key discipline as engine.commandRuleKey (engine untouched). */
const MULTI_TOKEN_CMDS = new Set([
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'docker', 'kubectl', 'cargo', 'python', 'pip',
]);
export function commandRuleKey(command: string): string {
  const toks = String(command ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return 'cmd:';
  const [head, sub] = toks;
  return MULTI_TOKEN_CMDS.has(head) && sub ? `cmd:${head} ${sub}` : `cmd:${head}`;
}

/** Build the engine-compatible rule key for an approval kind + subject. */
export function ruleKeyFor(kind: string, subject: string): string {
  if (kind === 'command') return commandRuleKey(subject);
  if (kind === 'mcp') return `mcp:${String(subject ?? '')}`;
  return kind || 'unknown';
}

/** Token-boundary prefix matching, identical to engine.ruleAllows. */
function ruleMatches(stored: ReadonlySet<string>, key: string): boolean {
  if (stored.has(key)) return true;
  if (key.startsWith('cmd:')) {
    for (const s of stored) {
      if (s.startsWith('cmd:') && key.startsWith(`${s} `)) return true;
    }
  }
  return false;
}

/**
 * Read the persisted policy for a workspace. DENY beats ALLOW — there is no
 * path where a stale allow rule can override an explicit standing reject.
 */
export function ruleDecision(workspace: string, key: string): 'allow' | 'deny' | null {
  const hash = workspaceHashKey(workspace);
  const denyEntry = readRules(denyPath())[hash];
  if (denyEntry && ruleMatches(new Set(Object.keys(denyEntry)), key)) return 'deny';
  const allowEntry = readRules(allowPath())[hash];
  if (allowEntry && ruleMatches(new Set(Object.keys(allowEntry)), key)) return 'allow';
  return null;
}

/**
 * Validate + apply an approval decision. Throws on I/O failure (no silent
 * success); returns ok:false for malformed/unknown actions so callers cannot
 * accidentally grant access through a typo or a stale UI payload.
 */
export function decideApproval(input: ApprovalDecisionInput): ApprovalDecisionResult {
  const action = String(input?.action ?? '');
  if (!APPROVAL_ACTIONS.has(action)) {
    console.warn(`[surnia-approval] rejected unknown action ${JSON.stringify(action)} — failing closed`);
    return {
      ok: false, error: 'UNKNOWN_APPROVAL_ACTION', hint: decisionHint('UNKNOWN_APPROVAL_ACTION'),
      action: 'deny', persisted: null,
    };
  }
  // v11.38 — bound every untrusted field BEFORE it reaches a store key or a
  // log line (a huge key can DoS the rules file; a newline can forge a log).
  const requestId = String(input?.requestId ?? '').trim().slice(0, 120).replace(/[\r\n]/g, '');
  const key = String(input?.key ?? '').trim().slice(0, 200).replace(/[\r\n]/g, '');
  if (!requestId || !key) {
    return {
      ok: false, error: 'INVALID_APPROVAL_REQUEST', hint: decisionHint('INVALID_APPROVAL_REQUEST'),
      action: 'deny', persisted: null,
    };
  }
  const workspace = String(input?.workspace ?? '').trim();
  // v11.38 — a standing rule is scoped to a workspace. An empty/unknown
  // workspace would hash to process.cwd(), silently granting the rule to the
  // wrong project (or to every caller that omits the field). Refuse it.
  if ((action === 'always' || action === 'never') && !workspace) {
    return {
      ok: false, error: 'INVALID_APPROVAL_WORKSPACE', hint: decisionHint('INVALID_APPROVAL_WORKSPACE'),
      action: 'deny', persisted: null,
    };
  }
  const command = String(input?.command ?? '').slice(0, 300).replace(/[\r\n]/g, ' ');
  const hash = workspaceHashKey(workspace);
  let persisted: 'allow' | 'deny' | null = null;
  if (action === 'always' || action === 'never') {
    const file = action === 'always' ? allowPath() : denyPath();
    const data = readRules(file);
    const entry = data[hash] && typeof data[hash] === 'object' ? data[hash] : {};
    entry[key] = { command, ts: Date.now() };
    data[hash] = entry;
    writeRules(file, data); // throws on failure — honest result to caller
    persisted = action === 'always' ? 'allow' : 'deny';
  }
  const canonical: PermissionDecision['action'] =
    action === 'once' ? 'allow' : action === 'always' ? 'always' : action === 'deny' ? 'deny' : 'never';
  const actor = String(input?.actor ?? 'local').slice(0, 80);
  console.log(
    `[surnia-approval] ${requestId.slice(0, 8)} action=${canonical} key=${key.slice(0, 48)} ` +
      `persisted=${persisted ?? 'none'} actor=${actor}`,
  );
  return { ok: true, action: canonical, persisted, hint: decisionHint(canonical) };
}

/** Wipe every rule in both stores (Privacy → clear approvals). */
export function clearAll(): number {
  let n = 0;
  for (const file of [allowPath(), denyPath()]) {
    n += Object.values(readRules(file)).reduce((sum, entry) => sum + Object.keys(entry ?? {}).length, 0);
    writeRules(file, {});
  }
  return n;
}
