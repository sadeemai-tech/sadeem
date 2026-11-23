// ============================================================
// Surnia v7.1 — EVIDENCE-GATED SKILL PROMOTION.
// v5's create_skill planted a skill and documented it immediately —
// a skill could be WRONG and still be offered to every future run.
// This gate closes that loop:
//
//   • Agent-created skills start as CANDIDATES. They are listed in
//     the index (with an honest badge) and usable — nothing is
//     hidden — but they carry "unverified".
//   • PROMOTION requires recorded-run evidence: the traces ledger
//     (traces.ts, JSONL per run) must show the skill's slug used via
//     `use_skill` in ≥ minUses runs whose trace finished OK. Only
//     then does the skill become VERIFIED.
//   • If a run that USED the skill finished with a recorded failure,
//     the tally decays: 2 failed runs = back to candidate (the skill
//     did not help).
//   • Poison scan: every imported skill file is swept with the same
//     repo-injection rules as READMEs — findings quarantine the
//     candidate (never activated, shown to the user with the reason).
// The ledger lives in userData/skill-promotions.json. No IO throws.
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

export type SkillGateStatus = 'builtin' | 'candidate' | 'verified' | 'quarantined';

export interface SkillGateEntry {
  slug: string;
  status: SkillGateStatus;
  okRuns: number;
  failedRuns: number;
  poisonFindings: string[];
  updatedAt: number;
}

interface GateLedger {
  [slug: string]: SkillGateEntry;
}

const MIN_OK_RUNS = 1; // one recorded run that finished OK promotes
const FAIL_DECAY = 2; // two failed runs demote back to candidate

let cache: GateLedger | null = null;
/**
 * v11.31 — the cache used to be a single unkeyed object, so a SECOND
 * userDataDir in the same process (multi-profile CLI, tests, or an IPC call
 * after an electron stub swap) silently read the FIRST dir's ledger. Key the
 * cache by the exact ledger path so a different dir re-reads from disk.
 */
let cacheKey = '';

function ledgerFile(userDataDir: string): string {
  return path.join(userDataDir, 'skill-promotions.json');
}

function loadLedger(userDataDir: string): GateLedger {
  const key = ledgerFile(userDataDir);
  if (cache && cacheKey === key) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(key, 'utf8')) as GateLedger;
    cache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    cache = {};
  }
  cacheKey = key;
  return cache!;
}

function saveLedger(userDataDir: string, ledger: GateLedger): void {
  cache = ledger;
  cacheKey = ledgerFile(userDataDir);
  try {
    fs.mkdirSync(path.dirname(ledgerFile(userDataDir)), { recursive: true });
    fs.writeFileSync(ledgerFile(userDataDir), JSON.stringify(ledger, null, 2), 'utf8');
  } catch {
    /* best-effort */
  }
}

/** Test/diagnostic: forget the in-memory gate cache (ledger files untouched). */
export function clearSkillGateCache(): void {
  cache = null;
  cacheKey = '';
}

/** Current status of one skill (builtin skills are always 'builtin'). */
export function skillGateStatus(userDataDir: string, slug: string, isBuiltin: boolean): SkillGateStatus {
  if (isBuiltin) return 'builtin';
  const ledger = loadLedger(userDataDir);
  return ledger[slug]?.status ?? 'candidate';
}

/** v11.31 — the full ledger entry, so the index can render HONEST badges
 *  (evidence counts, poison reason) instead of a status word with no proof.
 *  Null when the skill has no recorded entry (still a candidate). */
export function skillGateEntry(userDataDir: string, slug: string, isBuiltin: boolean): SkillGateEntry | null {
  if (isBuiltin) return null;
  return loadLedger(userDataDir)[slug] ?? null;
}

/** Quarantine a candidate (poison findings). Reason is stored for the UI. */
export function skillGateQuarantine(userDataDir: string, slug: string, findings: string[]): void {
  const ledger = loadLedger(userDataDir);
  const entry: SkillGateEntry = ledger[slug] ?? { slug, status: 'candidate', okRuns: 0, failedRuns: 0, poisonFindings: [], updatedAt: Date.now() };
  entry.status = 'quarantined';
  entry.poisonFindings = findings.slice(0, 6);
  entry.updatedAt = Date.now();
  ledger[slug] = entry;
  saveLedger(userDataDir, ledger);
}

/** Record the outcome of a run that used `slug` (trace-driven). */
export function skillGateRecordUse(userDataDir: string, slug: string, runOk: boolean): SkillGateStatus {
  const ledger = loadLedger(userDataDir);
  const entry: SkillGateEntry = ledger[slug] ?? { slug, status: 'candidate', okRuns: 0, failedRuns: 0, poisonFindings: [], updatedAt: Date.now() };
  if (entry.status === 'quarantined') return entry.status;
  if (runOk) entry.okRuns++;
  else entry.failedRuns++;
  // v11.31 FIX — the old demotion branch was
  //   `failedRuns >= FAIL_DECAY && okRuns < MIN_OK_RUNS`
  // but okRuns is cumulative and never decreases, so once ANY run succeeded a
  // verified skill could NEVER be demoted no matter how many later runs
  // failed. That made "evidence-verified" a permanent, dishonest badge. Now
  // repeated failed uses demote back to candidate and CLEAR the tally, so
  // verification must be re-earned by fresh successful evidence.
  if (entry.failedRuns >= FAIL_DECAY) {
    entry.status = 'candidate';
    entry.okRuns = 0;
    entry.failedRuns = 0;
  } else if (entry.okRuns >= MIN_OK_RUNS) {
    entry.status = 'verified';
  }
  entry.updatedAt = Date.now();
  ledger[slug] = entry;
  saveLedger(userDataDir, ledger);
  return entry.status;
}

// ------------------------------------------------------------
// Trace scan: use_skill + run outcome → the promotion tally
// ------------------------------------------------------------

export interface TraceScanResult {
  scanned: number;
  skillUses: Map<string, boolean>; // slug → last-run-ok (per trace)
  promotions: string[]; // slugs whose status changed this scan
}

/**
 * Scan the last days of trace files for use_skill tool calls and the run's
 * finish outcome. Each trace contributes one (slug, ok) observation.
 * Called fire-and-forget at run end (and at boot for catch-up).
 */
export function promoteSkillsFromTraces(userDataDir: string, days = 7): TraceScanResult {
  const out: TraceScanResult = { scanned: 0, skillUses: new Map(), promotions: [] };
  try {
    const tracesRoot = path.join(userDataDir, 'traces');
    if (!fs.existsSync(tracesRoot)) return out;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const ledger = loadLedger(userDataDir);
    const dayDirs = fs
      .readdirSync(tracesRoot)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    for (const day of dayDirs) {
      const dayDir = path.join(tracesRoot, day);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dayDir).filter((f) => f.startsWith('trace-') && f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const full = path.join(dayDir, f);
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs < cutoff) continue;
          const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
          out.scanned++;
          const slugs = new Set<string>();
          let runOk = false;
          for (const line of lines) {
            try {
              // v11.10 (A7 FIX) — parse the REAL TraceRecorder record shapes
              // (traces.ts): tool calls are `{t, kind:'tool_call', name,
              // argsPreview:'{"slug":…}'}` and the run outcome is a footer
              // `{type:'footer', ok, failure}`. The old parser looked for
              // `{type:'tool', name, args:{slug}}` + `{type:'finish'}` —
              // shapes no trace ever carried, so trace-driven skill
              // promotion silently never fired. Both shapes accepted here.
              const rec = JSON.parse(line) as {
                type?: string; kind?: string; name?: string; args?: { slug?: string }; argsPreview?: string;
                ok?: boolean; failure?: string;
              };
              const slugFromPreview = (): string | null => {
                if (typeof rec.argsPreview !== 'string') return null;
                try {
                  const p = JSON.parse(rec.argsPreview) as { slug?: unknown };
                  return typeof p?.slug === 'string' && p.slug.trim() ? p.slug.trim() : null;
                } catch {
                  return null;
                }
              };
              const isUseSkillCall = rec.name === 'use_skill' && (rec.kind === 'tool_call' || rec.type === 'tool');
              if (isUseSkillCall) {
                const slug = slugFromPreview() ?? (typeof rec.args?.slug === 'string' ? rec.args.slug.trim() : '');
                if (slug) slugs.add(slug);
              }
              if (rec.type === 'finish' || rec.type === 'footer') {
                runOk = rec.ok === true && !rec.failure;
              }
            } catch {
              /* malformed line — skip */
            }
          }
          for (const slug of slugs) {
            out.skillUses.set(slug, runOk);
            const before = ledger[slug]?.status ?? 'candidate';
            const after = skillGateRecordUse(userDataDir, slug, runOk);
            if (before !== after) out.promotions.push(`${slug}: ${before} → ${after}`);
          }
        } catch {
          /* unreadable trace — skip */
        }
      }
    }
  } catch {
    /* scan is best-effort */
  }
  // v11.9 — the old `out.promotions.length || out.scanned ? out : out` was a
  // dead ternary (both branches returned the same object).
  return out;
}

/**
 * One-line badge for the skills index / UI. v11.31 — when the ledger entry is
 * supplied, show the ACTUAL evidence (ok/failed run counts, poison reason) so
 * the badge is verifiable instead of a bare status word. The base labels are
 * preserved verbatim for callers/tests that only pass a status.
 */
export function skillBadge(status: SkillGateStatus, entry?: SkillGateEntry | null): string {
  switch (status) {
    case 'builtin':
      return 'builtin';
    case 'verified':
      return entry && entry.okRuns > MIN_OK_RUNS
        ? `evidence-verified (${entry.okRuns} ok runs)`
        : 'evidence-verified';
    case 'quarantined':
      return entry?.poisonFindings?.length
        ? `quarantined (poison scan: ${entry.poisonFindings[0]})`
        : 'quarantined (poison scan)';
    default:
      return 'candidate — not yet evidence-verified';
  }
}

// ============================================================
// v11.19 (A6) — skillUsage LEDGER (use_skill → task → outcome).
// The old promotion gate only counted "a trace used this slug" and had no
// idea WHAT task it was used on or whether that task succeeded. This ledger
// records one honest observation per use_skill call:
//   { slug, task, outcome, reason?, sessionId?, at }
// The engine calls recordSkillUsage() at the use_skill dispatch site; the
// playbook/DNA call summarizeSkillUsage() / skillUsageForReinforcement()
// to decide which skills to reinforce or refine. Stored at
// userData/skill-usage.json (JSON, capped, cache-per-file). No IO throws.
// ============================================================

export type SkillUsageOutcome = 'ok' | 'failed' | 'unknown';

export interface SkillUsageEntry {
  slug: string;
  /** The user's task text (truncated) that triggered the use_skill call. */
  task: string;
  outcome: SkillUsageOutcome;
  reason?: string;
  sessionId?: string;
  at: number;
}

export interface SkillUsageSummary {
  slug: string;
  uses: number;
  ok: number;
  failed: number;
  unknown: number;
  lastTask: string;
  lastOutcome: SkillUsageOutcome;
  lastAt: number;
  tasks: string[];
}

interface SkillUsageLedger {
  version: 1;
  entries: SkillUsageEntry[];
}

const SKILL_USAGE_CAP = 500;
const usageCache = new Map<string, SkillUsageLedger>();

/** Path of the skillUsage ledger (exported for diagnostics/tests). */
export function skillUsageLedgerPath(userDataDir: string): string {
  return path.join(userDataDir, 'skill-usage.json');
}

function isUsageEntry(v: unknown): v is SkillUsageEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<SkillUsageEntry>;
  return (
    typeof e.slug === 'string' &&
    typeof e.task === 'string' &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at) &&
    (e.outcome === 'ok' || e.outcome === 'failed' || e.outcome === 'unknown')
  );
}

function loadUsageLedger(userDataDir: string): SkillUsageLedger {
  const file = skillUsageLedgerPath(userDataDir);
  const cached = usageCache.get(file);
  if (cached) return cached;
  let ledger: SkillUsageLedger = { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SkillUsageLedger>;
    if (parsed && Array.isArray(parsed.entries)) {
      ledger = { version: 1, entries: parsed.entries.filter(isUsageEntry).slice(-SKILL_USAGE_CAP) };
    }
  } catch {
    /* missing/corrupt ledger → fresh (never throws into the agent loop) */
  }
  usageCache.set(file, ledger);
  return ledger;
}

function saveUsageLedger(userDataDir: string, ledger: SkillUsageLedger): void {
  usageCache.set(skillUsageLedgerPath(userDataDir), ledger);
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(skillUsageLedgerPath(userDataDir), JSON.stringify(ledger, null, 2), 'utf8');
  } catch {
    /* best-effort — an unwritable ledger must never break a run */
  }
}

function normalizeOutcome(v: unknown): SkillUsageOutcome {
  return v === 'ok' || v === 'failed' ? v : 'unknown';
}

/**
 * Record ONE use_skill observation. Called by the engine when use_skill is
 * dispatched (task + session id + outcome). Traversal-shaped slugs are
 * refused. Best-effort: returns the stored entry, or null when refused.
 */
export function recordSkillUsage(
  userDataDir: string,
  input: {
    slug: string;
    task?: string;
    outcome?: SkillUsageOutcome;
    reason?: string;
    sessionId?: string;
    at?: number;
  },
): SkillUsageEntry | null {
  const slug = String(input?.slug ?? '').trim().slice(0, 120);
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\')) return null;
  const entry: SkillUsageEntry = {
    slug,
    task: String(input.task ?? '').slice(0, 500),
    outcome: normalizeOutcome(input.outcome),
    at: typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : Date.now(),
  };
  if (typeof input.reason === 'string' && input.reason.trim()) entry.reason = input.reason.trim().slice(0, 300);
  if (typeof input.sessionId === 'string' && input.sessionId.trim()) entry.sessionId = input.sessionId.trim().slice(0, 120);
  const ledger = loadUsageLedger(userDataDir);
  ledger.entries.push(entry);
  if (ledger.entries.length > SKILL_USAGE_CAP) ledger.entries = ledger.entries.slice(-SKILL_USAGE_CAP);
  saveUsageLedger(userDataDir, ledger);
  return entry;
}

/** Read recorded uses, newest first (optionally scoped to one slug). */
export function loadSkillUsage(
  userDataDir: string,
  opts: { slug?: string; limit?: number } = {},
): SkillUsageEntry[] {
  const entries = loadUsageLedger(userDataDir).entries.slice();
  const slug = String(opts.slug ?? '').trim();
  const filtered = slug ? entries.filter((e) => e.slug === slug) : entries;
  filtered.sort((a, b) => b.at - a.at);
  const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit as number)) : SKILL_USAGE_CAP;
  return filtered.slice(0, limit);
}

/** Aggregate the ledger per skill — the playbook/DNA reinforcement input. */
export function summarizeSkillUsage(userDataDir: string, slug?: string): SkillUsageSummary[] {
  const only = String(slug ?? '').trim();
  const grouped = new Map<string, SkillUsageSummary>();
  for (const e of loadUsageLedger(userDataDir).entries) {
    if (only && e.slug !== only) continue;
    let s = grouped.get(e.slug);
    if (!s) {
      s = {
        slug: e.slug, uses: 0, ok: 0, failed: 0, unknown: 0,
        lastTask: '', lastOutcome: 'unknown', lastAt: 0, tasks: [],
      };
      grouped.set(e.slug, s);
    }
    s.uses++;
    if (e.outcome === 'ok') s.ok++;
    else if (e.outcome === 'failed') s.failed++;
    else s.unknown++;
    if (e.at >= s.lastAt) {
      s.lastAt = e.at;
      s.lastTask = e.task;
      s.lastOutcome = e.outcome;
    }
    if (e.task && !s.tasks.includes(e.task)) s.tasks.push(e.task);
    if (s.tasks.length > 12) s.tasks.shift();
  }
  return [...grouped.values()].sort((a, b) => b.uses - a.uses || a.slug.localeCompare(b.slug));
}

/**
 * Engine-facing helper: reinforcement signal for ONE skill. The playbook /
 * DNA layer can call this after a run to decide whether to reinforce (many
 * successful uses) or refine (failed uses) the workflow. Never throws.
 */
export function skillUsageForReinforcement(userDataDir: string, slug: string): SkillUsageSummary & { hint: string } {
  const empty: SkillUsageSummary = {
    slug: String(slug ?? '').trim(), uses: 0, ok: 0, failed: 0, unknown: 0,
    lastTask: '', lastOutcome: 'unknown', lastAt: 0, tasks: [],
  };
  const found = summarizeSkillUsage(userDataDir, empty.slug)[0] ?? empty;
  let hint: string;
  if (found.failed > found.ok) {
    hint = `Skill "${found.slug}" has ${found.failed} failed use(s) — refine it before reinforcing.`;
  } else if (found.uses >= 2 && found.ok >= 2) {
    hint = `Skill "${found.slug}" succeeded in ${found.ok} recorded task(s) — reinforce this workflow in the playbook/DNA.`;
  } else {
    hint = `Not enough evidence yet for "${found.slug}" (${found.uses} use(s)) — keep observing.`;
  }
  return { ...found, hint };
}

/** Test/diagnostic: forget the in-memory usage cache (file is untouched). */
export function clearSkillUsageCache(): void {
  usageCache.clear();
}
