// ============================================================
// Surnia v2.1 — Agent Review (Quick Review class)
// `reviewWorkingDiff()` captures the working-tree diff
// (`git diff HEAD` + `git status --porcelain`), sends it to the
// model as a read-only REVIEW subagent with a structured prompt,
// and parses the reply into findings:
//   [{ severity: critical|major|minor|nit, file, line?, note }]
// Used by (a) the `review_diff` engine tool (main-agent
// self-review) and (b) the kdx:agent:review-run IPC.
// Node builtins only; the model call reuses providers.streamTurn.
// ============================================================
import { execFile } from 'node:child_process';
import type { ModelConfig, ReviewFinding } from '../../shared/types';
import { streamTurn, type ProviderMsg } from './providers';

const GIT_TIMEOUT_MS = 30_000;
const DIFF_CAP_CHARS = 60_000;
const STATUS_CAP_CHARS = 4_000;
const REVIEW_OUTPUT_CAP = 16_000;
const MAX_FINDINGS = 40;
const SEVERITIES = new Set(['critical', 'major', 'minor', 'nit']);

export interface ReviewProvider {
  model: ModelConfig;
  apiKey?: string;
  baseUrl?: string;
}

export interface ReviewResult {
  ok: boolean;
  findings: ReviewFinding[];
  summary?: string;
  /** Human-readable failure reason when ok is false. */
  error?: string;
  /** True when the working tree was clean (nothing to review). */
  clean?: boolean;
}

/** execFile git (no shell → nothing to inject); resolves {code, stdout, stderr}, never throws. */
function gitRun(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ code: -1, stdout: '', stderr: 'git is not installed' });
          return;
        }
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

/** Working-diff capture: `git diff HEAD` (tracked) + `git status --porcelain` (untracked map). */
export async function captureWorkingDiff(wsPath: string): Promise<{ diff: string; status: string; isRepo: boolean }> {
  // v11.21 (A4-HONESTY) — the old isRepo test only distinguished "git missing"
  // (code -1) from "git ran". In a plain NON-repo directory both `git diff HEAD`
  // and `git status --porcelain` exit 128 with "not a git repository", so the
  // old code reported `isRepo: true` with an empty diff → reviewWorkingDiff
  // returned ok:true/clean and REVIEW mode happily persisted a fake "working
  // tree is clean" report for a folder that was never a repo. Ask git directly
  // (`rev-parse --is-inside-work-tree`) so the verdict is truthful. We do NOT
  // require `git diff HEAD` to succeed: an unborn HEAD (no commits yet) still
  // has real untracked files in porcelain, and those must remain reviewable.
  const [revParse, diffRes, statusRes] = await Promise.all([
    gitRun(['rev-parse', '--is-inside-work-tree'], wsPath),
    gitRun(['diff', 'HEAD'], wsPath),
    gitRun(['status', '--porcelain'], wsPath),
  ]);
  const isRepo = revParse.code === 0 && /\btrue\b/i.test(revParse.stdout) && statusRes.code === 0;
  let diff = diffRes.stdout.slice(0, DIFF_CAP_CHARS);
  if (diffRes.stdout.length > DIFF_CAP_CHARS) diff += '\n… [diff truncated]';
  // Untracked files: git diff HEAD does not show them — summarize from porcelain.
  const untracked = statusRes.stdout
    .split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
  if (untracked.length) {
    diff += `\n\n[untracked files not in the diff above]\n${untracked.map((f) => `- ${f}`).join('\n').slice(0, STATUS_CAP_CHARS)}`;
  }
  return { diff: diff.trim(), status: statusRes.stdout.slice(0, STATUS_CAP_CHARS), isRepo };
}

const REVIEW_SYSTEM =
  'You are a senior code reviewer (Surnia-Review). You receive the working-tree diff of the current repository. ' +
  'Review ONLY what changed. Respond with a JSON array — no prose before or after — of findings:\n' +
  '[{"severity":"critical|major|minor|nit","file":"path/relative.ts","line":123,"note":"one-sentence issue and the concrete fix"}]\n' +
  'Order findings by severity (critical first). Cite real files from the diff with an approximate line when possible. ' +
  'Cover: correctness bugs, security issues, performance traps, broken tests/builds, and style drift the repo clearly avoids. ' +
  'If the diff is clean, respond with []. Never invent files or problems.';

/**
 * Review the working diff of `wsPath` with the given provider.
 * Never throws — failures come back as { ok:false, error }.
 */
export async function reviewWorkingDiff(
  wsPath: string,
  provider: ReviewProvider,
  opts?: { signal?: AbortSignal; maxRetries?: number },
): Promise<ReviewResult> {
  try {
    const { diff, isRepo } = await captureWorkingDiff(wsPath);
    if (!isRepo) return { ok: false, findings: [], error: 'Not a git repository (or git missing) — nothing to review.' };
    if (!diff.trim()) return { ok: true, findings: [], clean: true, summary: 'Working tree is clean — nothing to review.' };

    const messages: ProviderMsg[] = [
      { role: 'user', text: `Review this working diff.\n\n\`\`\`diff\n${diff}\n\`\`\`` },
    ];
    let out = '';
    const res = await streamTurn({
      model: provider.model,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      system: REVIEW_SYSTEM,
      messages,
      tools: [],
      signal: opts?.signal ?? AbortSignal.timeout(120_000),
      promptCaching: false,
      maxRetries: opts?.maxRetries,
      onText: (t) => {
        if (out.length < REVIEW_OUTPUT_CAP) out += t;
      },
      onToolUse: () => {
        /* no tools in play */
      },
    });
    if (res.stopReason === 'error' || !out.trim()) {
      return { ok: false, findings: [], error: 'Review model call failed — try again.' };
    }
    const findings = parseReviewFindings(out);
    const summary = buildReviewSummary(findings);
    return { ok: true, findings, summary };
  } catch (err) {
    return { ok: false, findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parse a review reply. Preferred: a JSON array (possibly fenced in ```json).
 * Fallback: markdown lines like `- [major] src/app.ts:42 — note` or
 * `- **major** file.ts — note`. Unknown severities map to 'minor'.
 */
export function parseReviewFindings(raw: string): ReviewFinding[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  // 1) JSON array (strip markdown fences)
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const jsonStart = candidate.indexOf('[');
  const jsonEnd = candidate.lastIndexOf(']');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed: unknown = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed)) {
        const findings: ReviewFinding[] = [];
        for (const item of parsed) {
          const f = normalizeFinding(item);
          if (f) findings.push(f);
          if (findings.length >= MAX_FINDINGS) break;
        }
        if (findings.length) return findings;
      }
    } catch {
      /* fall through to line parsing */
    }
  }

  // 2) Line fallback: "- [major] file:12 — note" / "- **major** file — note"
  const findings: ReviewFinding[] = [];
  for (const m of text.matchAll(/^\s*(?:[-*•]|\d+\.)\s+\[?(critical|major|minor|nit)\]?\s*\*?\*?\s*(.+)$/gim)) {
    const severity = m[1].toLowerCase();
    let rest = m[2].trim();
    const fileM = /^\\*?([\w./@\\-]+\.[A-Za-z0-9]{1,8})\\*?(?::(\d+))?/.exec(rest);
    if (!fileM) continue;
    const file = fileM[1];
    const line = fileM[2] ? Number(fileM[2]) : undefined;
    rest = rest.slice(fileM[0].length).replace(/^[\s—–-]+/, '');
    findings.push({ severity: severity as ReviewFinding['severity'], file, line, note: rest.slice(0, 400) || '(no note)' });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}

function normalizeFinding(item: unknown): ReviewFinding | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const file = typeof rec.file === 'string' ? rec.file.trim() : '';
  const note = typeof rec.note === 'string' ? rec.note.trim() : typeof rec.note === 'number' ? String(rec.note) : '';
  if (!file || !note) return null;
  const sev = String(rec.severity ?? 'minor').toLowerCase();
  const lineNum = typeof rec.line === 'number' ? rec.line : Number(rec.line);
  return {
    severity: (SEVERITIES.has(sev) ? sev : 'minor') as ReviewFinding['severity'],
    file,
    line: Number.isFinite(lineNum) && lineNum > 0 ? Math.floor(lineNum) : undefined,
    note: note.slice(0, 400),
  };
}

/** One-line human summary ("2 critical, 1 major, 3 minor, 4 nit"). */
export function buildReviewSummary(findings: ReviewFinding[]): string {
  if (!findings.length) return 'No issues found — the diff looks clean.';
  const counts = { critical: 0, major: 0, minor: 0, nit: 0 } as Record<ReviewFinding['severity'], number>;
  for (const f of findings) counts[f.severity]++;
  const parts: string[] = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.major) parts.push(`${counts.major} major`);
  if (counts.minor) parts.push(`${counts.minor} minor`);
  if (counts.nit) parts.push(`${counts.nit} nit`);
  return `${findings.length} finding${findings.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

/**
 * v11.26 — the mandatory structural contract of a PERSISTED review report.
 * ONE source of truth shared by the renderer below and the all-slash proof
 * test (tests/v1126-slash-all.test.mjs): the test validates the physical
 * .surnia/reviews/review-*.md the engine writes against exactly these markers,
 * so a cosmetic "report" can never satisfy it.
 */
export const REVIEW_REPORT_CONTRACT: readonly string[] = [
  '# Review report',
  '**Summary:**',
  '| Severity | File | Line | Note |',
];

/** Validate that a markdown string is a REAL rendered review report. */
export function validateReviewReport(md: string): { ok: boolean; missing: string[] } {
  const text = String(md ?? '');
  const missing = REVIEW_REPORT_CONTRACT.filter((marker) => !text.includes(marker));
  return { ok: missing.length === 0, missing: [...missing] };
}

/**
 * v11.10 (A4) — render a ReviewResult as the persisted markdown report that
 * REVIEW task mode writes to .surnia/reviews/review-<stamp>.md at the end of
 * a run (the verdict becomes a real artifact, not chat decoration).
 */
export function renderReviewReportMarkdown(rep: ReviewResult): string {
  const lines: string[] = [];
  lines.push(`# Review report — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    `**Summary:** ${rep.summary ?? (rep.findings.length ? `${rep.findings.length} findings` : 'clean')}`,
  );
  if (!rep.ok && rep.error) lines.push(`**Error:** ${rep.error}`);
  lines.push('');
  if (rep.findings.length === 0) {
    lines.push('No findings — the working diff looks clean.');
  } else {
    lines.push('| Severity | File | Line | Note |');
    lines.push('| --- | --- | --- | --- |');
    for (const f of rep.findings) {
      const note = f.note.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${f.severity} | ${f.file} | ${f.line ?? ''} | ${note} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
