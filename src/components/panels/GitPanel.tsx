// GitPanel — SURVEYOR v4 instrument toolbar (.fhdr: branch mono + ahead/
// behind .tnum stamps), working-tree keyrows, review-findings contract list,
// commit history (.keyrow + hash .tnum), AI commit (.ibtn wand) with the
// style-match toggle, and "Review working diff" via the agent bridge.
// Flat matte styling; the per-file diff viewer logic is unchanged.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Eye, GitBranch, GitBranchPlus, Minus, Plus, RefreshCw, ScanSearch, Sparkles, Wand2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { GitBranchInfo, GitIdentityInfo } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import type { GitChange, GitLogEntry, ReviewFinding as SharedReviewFinding } from '../../../shared/types';
import { Btn, Empty, IconBtn, MOD_KEY, Spinner, TextInput } from '../ui';
import { PageHead } from '../pages';
import '../pages.css';
// FINAL LAUNCH POLISH — editorial art layer (loaded last so it wins ties).
import './hgs-art.css';

const STYLE_MATCH_KEY = 'surnia.gitStyleMatch';

/* Original 1px branch glyph — one trunk forks into two lines that converge
   back into a single merged spine with an arrow. */
function GitGlyph() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 43V22" />
      <path d="M7 22c12 0 11-11 29-11" />
      <path d="M7 22c12 0 11 11 29 11" />
      <circle cx="7" cy="22" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="36" cy="11" r="1.7" />
      <circle cx="36" cy="33" r="1.7" />
      <path d="M36 22h7" />
      <path d="M39 18 43 22 39 26" />
    </svg>
  );
}

/* A branch graph driven by the real branch name + ahead/behind readout:
   a forked trunk, correctly spaced commit nodes on each lane, and a merge
   arrow where the local lane rejoins upstream. Clamped so it never overflows. */
function BranchGraph({ branch, ahead, behind, known, lang }: { branch: string; ahead: number; behind: number; known: boolean; lang: 'ar' | 'en' }) {
  const t = useT();
  const local = t('hgs.git.local', lang === 'ar' ? 'محلي' : 'LOCAL');
  const upstream = t('hgs.git.upstream', lang === 'ar' ? 'منبع' : 'UPSTREAM');
  // HONESTY: no gitAheadBehind bridge exists in this build. When the real
  // readout is absent, draw the real branch head on a single spine and SAY the
  // upstream distance is unavailable — never invent a fork/merge topology.
  if (!known) {
    return (
      <div className="hgs-branchgraph" aria-label={t('hgs.git.graph', lang === 'ar' ? 'رسم الفروع' : 'Branch graph')}>
        <div className="hgs-branchgraph-head">
          <span className="hgs-mono" dir="ltr">{branch || t('hgs.git.branch', lang === 'ar' ? 'فرع' : 'branch')}</span>
          <span className="hgs-chart-rule" aria-hidden />
          <span className="hgs-mono" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {t('hgs.git.unknown', lang === 'ar' ? 'المسافة من المنبع غير متاحة في هذا الإصدار' : 'upstream distance unavailable in this build')}
          </span>
        </div>
        <svg viewBox="0 0 320 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <path className="hgs-line" d="M10 32 H312" opacity=".55" />
          <circle className="hgs-node-fork" cx="24" cy="32" r="3.4" />
          <text className="hgs-label" x="10" y="13">{local}</text>
          <text className="hgs-label" x="10" y="58">{upstream} —</text>
        </svg>
      </div>
    );
  }
  const bN = Math.min(behind, 4);
  const aN = Math.min(ahead, 5);
  const step = Math.min(32, 250 / Math.max(1, bN + aN));
  const x0 = 16;
  const forkX = x0 + bN * step;
  const localEnd = forkX + (aN + 1) * step;
  const mergeX = localEnd + 7;
  const wy = 44, ly = 17;
  const behindNodes = Array.from({ length: bN }, (_, i) => ({ x: x0 + i * step, y: wy }));
  const aheadNodes = Array.from({ length: aN }, (_, i) => ({ x: forkX + (i + 1) * step, y: ly }));
  return (
    <div className="hgs-branchgraph" aria-label={t('hgs.git.graph', lang === 'ar' ? 'رسم الفروع' : 'Branch graph')}>
      <div className="hgs-branchgraph-head">
        <span className="hgs-mono" dir="ltr">{branch || t('hgs.git.branch', lang === 'ar' ? 'فرع' : 'branch')}</span>
        <span className="hgs-chart-rule" aria-hidden />
        {behind > 0 && <span className="hgs-mono tnum" dir="ltr">↓{behind}</span>}
        {ahead > 0 && <span className="hgs-mono tnum" dir="ltr">↑{ahead}</span>}
      </div>
      <svg viewBox="0 0 320 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path className="hgs-line" d={`M10 ${wy} H312`} opacity=".55" />
        {behindNodes.map((n, i) => <circle key={`b${i}`} className="hgs-node" cx={n.x} cy={n.y} r="3" />)}
        <path className="hgs-line hgs-line-local hgs-graph-draw" pathLength={1} d={`M${forkX} ${wy} L${forkX} ${ly} L${localEnd} ${ly}`} />
        {aheadNodes.map((n, i) => <circle key={`a${i}`} className="hgs-node" cx={n.x} cy={n.y} r="3" />)}
        <path className="hgs-line hgs-line-local hgs-graph-draw" pathLength={1} d={`M${localEnd} ${ly} Q${mergeX} ${ly} ${mergeX} ${ly + 9} L${mergeX} ${wy}`} />
        <path className="hgs-arrow" d={`M${mergeX - 4} ${wy - 4} L${mergeX} ${wy} L${mergeX + 4} ${wy - 4}`} />
        <circle className="hgs-node-fork" cx={forkX} cy={wy} r="3.4" />
        <text className="hgs-label" x="10" y="12">{local}</text>
        <text className="hgs-label" x="10" y="60">{upstream}</text>
      </svg>
    </div>
  );
}

/** One agent review finding (severity · file · note). */
export interface ReviewFinding {
  severity: 'high' | 'medium' | 'low' | 'info';
  file?: string;
  note: string;
}

/** The store carries the canonical critical/major/minor/nit severities;
 *  map them onto this panel's tone scale once instead of showing a raw
 *  severity the CSS has no stamp for. */
function normalizeFindings(list: SharedReviewFinding[] | undefined): ReviewFinding[] | null {
  if (!Array.isArray(list)) return null;
  return list.map((f) => ({
    severity: f.severity === 'critical' ? 'high' : f.severity === 'major' ? 'medium' : f.severity === 'minor' ? 'low' : 'info',
    file: f.file,
    note: f.note,
  }));
}

function severityClass(sev: ReviewFinding['severity']): string {
  if (sev === 'high') return 'text-[var(--bad)]';
  if (sev === 'medium') return 'text-[var(--warn)]';
  if (sev === 'low') return 'text-[var(--acc2)]';
  return 'text-[var(--faint)]';
}

/**
 * v11.38 — honest unmerged-code detection, mirroring gitService.isConflictStatus.
 * Porcelain UU / AA / DD / AU / UA / DU / UD mean CONFLICT, never "staged".
 * Exported so a source-level test can pin the contract without a DOM.
 */
export function isConflictStatus(status: string): boolean {
  const s = String(status ?? '').trim();
  return s.includes('U') || s === 'AA' || s === 'DD';
}

function statusTone(status: string): 'warn' | 'ok' | 'bad' | 'acc' | 'default' {
  if (isConflictStatus(status)) return 'bad';
  if (status === 'M' || status.startsWith('M')) return 'warn';
  if (status === 'A' || status.startsWith('A')) return 'ok';
  if (status === 'D' || status.startsWith('D')) return 'bad';
  if (status === '??') return 'acc';
  return 'default';
}

function stampClass(tone: string): string {
  // 'ok' maps to the sage accent in SURVEYOR (no separate stamp-ok exists)
  if (tone === 'default') return 'stamp-clay';
  if (tone === 'ok') return 'stamp-acc';
  return `stamp-${tone}`;
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

/**
 * Pure commit-result contract. gitService.commit returns an EMPTY string for
 * "nothing to commit" — a successful-looking "Committed" toast in that case
 * was a lie, and it also wiped the user's message. Kept pure so it can be
 * verified without a DOM renderer.
 */
export function commitOutcome(hash: string, t: (key: string, fallback?: string) => string, lang: 'ar' | 'en'): { message: string; clear: boolean } {
  if (!hash) {
    return {
      message: t('git.nothingToCommit', lang === 'ar' ? 'لا شيء للإيداع — جهّز التغييرات أولاً' : 'Nothing to commit — stage your changes first'),
      clear: false,
    };
  }
  return { message: `${t('git.commitDone')} · ${hash.slice(0, 7)}`, clear: true };
}

// ---------------- commit-message style matching ----------------
/** Derive the dominant subject style from recent commit subjects. */
function dominantStyle(subjects: string[]): { conventional: boolean; lowercase: boolean } {
  let conv = 0;
  let lower = 0;
  const n = subjects.filter(Boolean).length || 1;
  for (const s of subjects) {
    if (!s) continue;
    if (/^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]*\))?!?:\s/i.test(s)) conv++;
    const first = s.trim()[0];
    if (first && first === first.toLowerCase() && first !== first.toUpperCase()) lower++;
  }
  return { conventional: conv / n > 0.5, lowercase: lower / n > 0.6 };
}

/** Reformat a generated message to match the repo's dominant style. */
function styleMatch(message: string, subjects: string[]): string {
  const style = dominantStyle(subjects);
  let out = message.trim().replace(/^["'`]+|["'`]+$/g, '');
  const hasPrefix = /^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]*\))?!?:\s/i.test(out);
  if (style.conventional && !hasPrefix) {
    // crude classification by keywords — the repo speaks conventional, so fit in
    const kind = /fix|bug|crash|error/i.test(out)
      ? 'fix'
      : /doc|readme/i.test(out)
        ? 'docs'
        : /test/i.test(out)
          ? 'test'
          : /refactor|clean|rename|move/i.test(out)
            ? 'refactor'
            : 'feat';
    out = `${kind}: ${out[0].toLowerCase()}${out.slice(1)}`;
  } else if (!style.conventional && hasPrefix) {
    out = out.replace(/^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]*\))?!?:\s*/i, '');
  }
  if (style.lowercase) out = out[0].toLowerCase() + out.slice(1);
  return out;
}

// ---------------- v2.4 — AI generation from the diff (api.aiComplete) ----------------
const AI_DIFF_CAP = 8000;
const AI_SYSTEM =
  'You write concise conventional-commit messages / PR descriptions from diffs. Output ONLY the message text, no commentary.';

/** api.aiComplete — tolerate both the legacy object-params signature and the
 *  v2.4 (prompt, opts) contract; always resolves to plain text. Guarded so an
 *  absent bridge surfaces the panel's own failure toast, not a crash. */
async function aiCompleteText(prompt: string, system: string, maxTokens: number): Promise<string> {
  const fn = (api as unknown as { aiComplete?: (...args: unknown[]) => unknown }).aiComplete;
  if (typeof fn !== 'function') throw new Error('aiComplete unavailable');
  const res = await (fn.length >= 2 ? fn(prompt, { maxTokens, system }) : fn({ prompt, system, maxTokens }));
  if (typeof res === 'string') return res;
  const r = res as { ok?: boolean; text?: string; error?: string } | null;
  if (r && r.ok === false) throw new Error(r.error || 'aiComplete failed');
  return r?.text ?? '';
}

// ============================================================
export function GitPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const wsPath = useStore((s) => s.wsPath);
  const git = useStore((s) => s.git);
  const loadGit = useStore((s) => s.loadGit);
  const gitStage = useStore((s) => s.gitStage);
  const gitCommit = useStore((s) => s.gitCommit);
  const setDiffView = useStore((s) => s.setDiffView);
  const notify = useStore((s) => s.notify);
  // The review contract lives in the store (agent `review_findings` event and
  // the store's own runReview action). Reading it there removes the dead
  // window-event bridge that never fired in this build.
  const lastReview = useStore((s) => s.lastReview);
  const runReviewAction = useStore((s) => s.runReview);
  const clearReview = useStore((s) => s.clearReview);

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // per-file diff loading: shows an inline spinner in the eye button until the
  // DiffModal actually opens (the fetch can take a moment on big repos)
  const [diffLoading, setDiffLoading] = useState<string | null>(null);

  // commit history (02) + ahead/behind readouts
  const [log, setLog] = useState<GitLogEntry[] | null>(null);
  const [aheadBehind, setAheadBehind] = useState<{ ahead: number; behind: number } | null>(null);

  // ---- v11.38 — branches, author identity, honest checkout ----
  const [branches, setBranches] = useState<GitBranchInfo[] | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [branchSwitchOnCreate, setBranchSwitchOnCreate] = useState(false);
  const [identity, setIdentity] = useState<GitIdentityInfo | null>(null);
  const openFile = useStore((s) => s.openFile);

  // style-match toggle (lightweight: localStorage — no settings schema churn)
  const [styleMatchOn, setStyleMatchOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STYLE_MATCH_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleStyleMatch = () => {
    setStyleMatchOn((v) => {
      try {
        localStorage.setItem(STYLE_MATCH_KEY, v ? '0' : '1');
      } catch {
        /* storage unavailable — session-only */
      }
      return !v;
    });
  };

  // review findings (01) — the REAL contract is store.lastReview, populated by
  // the agent's `review_findings` event and by the store's runReview action.
  // The old duplicate window listeners never fired in this build (dead code).
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const findings: ReviewFinding[] | null = reviewDismissed ? null : normalizeFindings(lastReview?.findings);
  const [reviewBusy, setReviewBusy] = useState(false);
  useEffect(() => {
    if (lastReview) setReviewDismissed(false);
  }, [lastReview]);

  const loadHistory = useCallback(async () => {
    if (!wsPath) return;
    try {
      const entries = await api.gitLog(wsPath, 8);
      setLog(Array.isArray(entries) ? entries : []);
    } catch {
      setLog(null);
    }
  }, [wsPath]);

  const loadAheadBehind = useCallback(async () => {
    if (!wsPath) return;
    try {
      // Defensive: gitAheadBehind is a brand-new channel — absent preloads
      // simply leave the stamps unrendered.
      const w = window as unknown as { surnia?: Record<string, unknown>; kodex?: Record<string, unknown> };
      const fn = (w.surnia ?? w.kodex)?.gitAheadBehind;
      if (typeof fn !== 'function') return;
      const res = (await (fn as (root: string) => Promise<{ ahead?: number; behind?: number }>)(wsPath)) as {
        ahead?: number;
        behind?: number;
      } | null;
      if (res && (Number.isFinite(res.ahead) || Number.isFinite(res.behind))) {
        setAheadBehind({ ahead: res.ahead ?? 0, behind: res.behind ?? 0 });
      }
    } catch {
      /* defensive: no upstream configured or bridge absent */
    }
  }, [wsPath]);

  /** v11.38 — real local branches from gitService. Defensive: an older build
   *  without the new bridge leaves the section honestly empty, never invented. */
  const loadBranches = useCallback(async () => {
    if (!wsPath || typeof api.gitBranchList !== 'function') return;
    try {
      const list = await api.gitBranchList(wsPath);
      setBranches(Array.isArray(list) ? list : []);
    } catch {
      setBranches(null);
    }
  }, [wsPath]);

  /** v11.38 — effective author identity, so a missing identity is stated. */
  const loadIdentity = useCallback(async () => {
    if (!wsPath || typeof api.gitIdentity !== 'function') return;
    try {
      setIdentity(await api.gitIdentity(wsPath));
    } catch {
      setIdentity(null);
    }
  }, [wsPath]);

  useEffect(() => {
    void loadHistory();
    void loadAheadBehind();
    void loadBranches();
    void loadIdentity();
  }, [loadHistory, loadAheadBehind, loadBranches, loadIdentity, git]);

  /** Refresh really reflects in-flight work (the old spinner watched `busy`,
   *  which stage/commit set — so refreshing spun nothing). */
  const refreshGit = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadGit();
      await loadHistory();
      await loadAheadBehind();
      await loadBranches();
      await loadIdentity();
    } finally {
      setRefreshing(false);
    }
  };

  /** "Review working diff" → the store's real review action. The findings
   *  arrive through lastReview (return value OR agent event), so the spinner
   *  always terminates — no endless busy state when a bridge keeps quiet. */
  const runReview = async () => {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewDismissed(false);
    try {
      await runReviewAction();
    } catch {
      notify(t('git.review.failed', 'Review failed'));
    } finally {
      setReviewBusy(false);
    }
  };

  // /commit bridge: the store fills this in when the agent suggests a message
  const commitSuggestion = useStore((s) => s.commitSuggestion);
  const lastSuggestionSeq = useRef(0);
  useEffect(() => {
    if (!commitSuggestion || commitSuggestion.seq === lastSuggestionSeq.current) return;
    lastSuggestionSeq.current = commitSuggestion.seq;
    setMessage(commitSuggestion.text);
    notify(t('git.suggested', 'AI suggestion filled in — review and commit'));
  }, [commitSuggestion, notify, t]);

  // AI commit message: wand → api.gitCommitMessage → (style-match) → input
  const generateMessage = async () => {
    if (!wsPath || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await api.gitCommitMessage(wsPath);
      if (res.ok && res.message) {
        setMessage(styleMatchOn ? styleMatch(res.message, (log ?? []).map((e) => e.message)) : res.message);
      } else {
        notify(`${t('git.aiCommitFailed', 'Could not generate a message')}: ${String(res.error)}`);
      }
    } catch {
      notify(t('git.aiCommitFailed', 'Could not generate a message'));
    } finally {
      setAiBusy(false);
    }
  };

  // v2.4 — one-shot AI generation straight from the diff (api.aiComplete):
  // 'commit' → conventional-commit message, 'pr' → PR title + description.
  // The result is INSERTED into the commit box — never auto-committed.
  const [genBusy, setGenBusy] = useState<null | 'commit' | 'pr'>(null);
  const collectDiff = async (): Promise<string> => {
    // one call covers staged + unstaged (staged wins conceptually: the index
    // diff leads the payload); empty tree → the caller shows git.noChanges
    const diffs = await api.gitDiff(wsPath);
    return ((diffs ?? []).map((d) => d.patch).filter(Boolean).join('\n') || '').slice(0, AI_DIFF_CAP);
  };
  const generateWithAi = async (kind: 'commit' | 'pr') => {
    if (!wsPath || genBusy) return;
    setGenBusy(kind);
    try {
      const diffText = await collectDiff();
      if (!diffText.trim()) {
        notify(t('git.noChanges'));
        return;
      }
      const prompt =
        kind === 'commit'
          ? 'Write ONE conventional-commit message (type(scope): subject) plus one short body line for this diff. No backticks.\n\n' + diffText
          : 'Write a pull-request title + description for this diff. Sections: Title, Summary, Changes (bullets), Testing notes.\n\n' + diffText;
      const text = (await aiCompleteText(prompt, AI_SYSTEM, 350)).trim();
      if (!text) {
        notify(t('git.aiFailed', 'Could not generate — is a model configured?'));
        return;
      }
      setMessage(text);
    } catch (err) {
      notify(`${t('git.aiFailed', 'Could not generate — is a model configured?')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setGenBusy(null);
    }
  };

  if (!git) {
    return (
      <div className={`page-v14 hgs-page p-2 flex flex-col min-h-0 ${embedded ? 'flex-1' : 'h-full'}`}>
        <div className="hgs-head">
          <PageHead
            eyebrow="03 / SOURCE CONTROL"
            title={t('rail.git', 'Source control')}
            description={t('git.desc', 'Review working-tree changes, inspect history and commit with AI assistance.')}
            toolbar={<span className="hgs-glyph" aria-hidden><GitGlyph /></span>}
          />
        </div>
        <div className="blank-state hero-grid aurora-panel flex-1">
          <GitBranch size={24} className="text-faint" aria-hidden />
          <div className="bs-title">{t('git.notRepo', 'Not a git repo')}</div>
          <div className="bs-sub">{wsPath ? undefined : t('misc.notify.noWorkspace', 'Open a workspace first')}</div>
          <div className="bs-hint">
            <kbd className="kbd">{MOD_KEY}</kbd>
            <span>`</span>
            <span aria-hidden>·</span>
            <span>{t('git.terminalHint', 'terminal for git commands')}</span>
          </div>
          <Btn
            className="btn"
            disabled={!wsPath}
            onClick={() => {
              if (!wsPath) return;
              void api
                .gitInit(wsPath)
                .then(() => loadGit())
                .catch(() => notify(t('misc.error')));
            }}
          >
            {t('git.init', 'Init repo')}
          </Btn>
        </div>
      </div>
    );
  }

  const staged = git.changed.filter((c) => c.staged);
  const unstaged = git.changed.filter((c) => !c.staged);
  // v11.38 — honest blocking states, derived from REAL git status.
  const conflicts = git.changed.filter((c) => isConflictStatus(c.status));
  const detached = git.branch === '(detached)';

  /** Switch branch via the real git checkout bridge. A dirty tree gets a
   *  confirmation first — checkout can carry or overwrite local work. */
  const switchBranch = async (name: string) => {
    if (!wsPath || branchBusy || name === git.branch) return;
    if (
      git.changed.length > 0 &&
      !window.confirm(t('git.branchSwitchConfirm', 'You have uncommitted changes. Switch branch anyway?'))
    )
      return;
    setBranchBusy(true);
    try {
      await api.gitCheckout(wsPath, name);
      notify(`${t('git.branchSwitched', 'Switched to branch')} ${name}`);
      await loadGit();
      await loadBranches();
      await loadHistory();
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBranchBusy(false);
    }
  };

  /** Create a local branch via gitService (optionally switching to it). */
  const createBranchNow = async () => {
    const name = newBranch.trim();
    if (!wsPath || !name || branchBusy || typeof api.gitBranchCreate !== 'function') return;
    if (
      branchSwitchOnCreate &&
      git.changed.length > 0 &&
      !window.confirm(t('git.branchSwitchConfirm', 'You have uncommitted changes. Switch branch anyway?'))
    )
      return;
    setBranchBusy(true);
    try {
      const created = await api.gitBranchCreate(wsPath, name, { checkout: branchSwitchOnCreate });
      setNewBranch('');
      notify(`${t('git.branchCreated', 'Branch created')} ${created.name}`);
      await loadGit();
      await loadBranches();
      await loadHistory();
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBranchBusy(false);
    }
  };

  const viewDiff = async (c: GitChange) => {
    if (diffLoading) return;
    setDiffLoading(c.path);
    try {
      const diffs = await api.gitDiff(wsPath, c.path);
      setDiffView({
        title: t('git.diffTitle'),
        path: c.path,
        oldText: '',
        newText: '',
        // A file can have BOTH staged and unstaged patches — show the full
        // picture instead of silently dropping the second diff.
        patch: diffs.map((d) => d.patch).filter(Boolean).join('\n'),
        readOnly: true,
      });
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setDiffLoading(null);
    }
  };

  const toggleStage = async (c: GitChange) => {
    try {
      if (c.staged) {
        // Contract (electron gitService.stage): a '!'-prefixed path unstages it
        // (`git reset HEAD -- <path>`); plain paths are staged via `git add`.
        await api.gitStage(wsPath, [`!${c.path}`]);
        await loadGit();
      } else {
        await gitStage([c.path]);
      }
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    }
  };

  const stageAll = async () => {
    if (unstaged.length === 0 || busy) return;
    setBusy(true);
    try {
      await gitStage(unstaged.map((c) => c.path));
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  };

  const unstageAll = async () => {
    if (staged.length === 0 || busy) return;
    setBusy(true);
    try {
      await api.gitStage(wsPath, staged.map((c) => `!${c.path}`));
      await loadGit();
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      // gitService.commit returns an EMPTY hash for "nothing to commit".
      // Reporting "Committed" there was a flat-out lie; keep the message so
      // the user can stage changes and retry instead of losing their words.
      const hash = await gitCommit(message.trim());
      const outcome = commitOutcome(hash, t, lang);
      notify(outcome.message);
      if (!outcome.clear) return;
      setMessage('');
      void loadHistory();
    } catch (err) {
      notify(`${t('misc.error')}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  };

  const changeRow = (c: GitChange) => (
    <div
      key={`${c.status}:${c.path}`}
      className="keyrow group cursor-default"
      title={c.path}
    >
      {/* letter + tone stamp — the M/A/D letter is the non-color cue */}
      <span
        className={`stamp shrink-0 !h-[15px] !px-1 !text-[9px] ${stampClass(statusTone(c.status))}`}
        title={statusTone(c.status) === 'acc' ? t('git.untracked', 'Untracked') : c.staged ? t('git.staged', 'Staged') : t('git.changes', 'Changes')}
        aria-label={c.status}
      >
        {c.status}
      </span>
      <span className="key-main">
        <span className="key-title !text-[11.5px] !font-normal tnum" dir="ltr">
          {basename(c.path)}
        </span>
        <span className="key-sub" dir="ltr">
          {c.path}
        </span>
      </span>
      <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <IconBtn
          className="!w-6 !h-6"
          title={diffLoading === c.path ? t('misc.loading', 'Loading…') : t('git.viewDiff')}
          disabled={diffLoading === c.path}
          onClick={() => void viewDiff(c)}
        >
          {diffLoading === c.path ? <Spinner size={12} /> : <Eye size={12} />}
        </IconBtn>
        <IconBtn
          className="!w-6 !h-6"
          title={c.staged ? t('git.unstage') : t('git.stage')}
          onClick={() => void toggleStage(c)}
        >
          {c.staged ? <Minus size={12} /> : <Plus size={12} />}
        </IconBtn>
      </span>
    </div>
  );

  return (
    <div className={`page-v14 hgs-page flex flex-col min-h-0 ${embedded ? 'flex-1' : 'h-full'}`}>
      {/* ---- editorial masthead: branch · ahead/behind · delta ---- */}
      <div className="hgs-head">
        <PageHead
          eyebrow="03 / SOURCE CONTROL"
          title={t('rail.git', 'Source control')}
          description={t('git.desc', 'Review working-tree changes, inspect history and commit with AI assistance.')}
          toolbar={<span className="hgs-glyph" aria-hidden><GitGlyph /></span>}
          actions={
            <IconBtn className="!w-7 !h-7" title={t('ws.refresh')} disabled={refreshing} onClick={() => void refreshGit()}>
              <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
            </IconBtn>
          }
          meta={
            <>
              <span className="glass-pill max-w-[26ch]" title={`${t('sb.branch', 'branch')}: ${git.branch}`}>
                <GitBranch size={11} className="text-acc shrink-0" aria-hidden />
                <span className="truncate min-w-0" dir="ltr">{git.branch}</span>
              </span>
              {detached && (
                <span className="glass-pill text-warn" title={t('git.detached', 'Detached HEAD — you are not on a branch')}>
                  <AlertTriangle size={11} className="shrink-0" aria-hidden />
                  {t('git.detachedShort', 'detached')}
                </span>
              )}
              {aheadBehind && aheadBehind.ahead > 0 && (
                <span className="glass-pill tnum text-acc" title={t('git.ahead', 'commits ahead of upstream')}>
                  ↑{aheadBehind.ahead}
                </span>
              )}
              {aheadBehind && aheadBehind.behind > 0 && (
                <span className="glass-pill tnum text-warn" title={t('git.behind', 'commits behind upstream')}>
                  ↓{aheadBehind.behind}
                </span>
              )}
              <span className="glass-pill tnum" title={t('git.changes')}>
                {git.changed.length} Δ
              </span>
            </>
          }
        />
      </div>

      {/* ---- v11.38 — HONEST blocking states straight from real git ---- */}
      {conflicts.length > 0 && (
        <div className="px-2 pt-2 shrink-0" role="alert">
          <div className="aurora-panel border-[color-mix(in_srgb,var(--bad)_45%,transparent)]">
            <div className="flex items-start gap-2 p-2.5">
              <AlertTriangle size={15} className="text-[var(--bad)] shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-semibold text-[var(--bad)]">
                  {t('git.conflict.title', 'Merge conflict — resolve before committing')}
                </div>
                <div className="text-[10.5px] text-dim mt-0.5">
                  {t('git.conflict.detail', '{n} unmerged file(s). Open each one, fix the conflict markers, then stage it.').replace('{n}', String(conflicts.length))}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {conflicts.map((c) => (
                    <button
                      key={c.path}
                      type="button"
                      className="stamp stamp-warn cursor-pointer !h-[18px] !px-1.5 !text-[9px]"
                      title={c.path}
                      dir="ltr"
                      onClick={() => {
                        if (!wsPath) return;
                        void openFile(`${wsPath}/${c.path}`.replace(/\/+/g, '/'));
                      }}
                    >
                      {basename(c.path)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {detached && (
        <div className="px-2 pt-2 shrink-0" role="status">
          <div className="text-[10.5px] text-warn flex items-center gap-1.5">
            <GitBranch size={12} className="shrink-0" aria-hidden />
            {t('git.detached', 'Detached HEAD — you are not on a branch. Create a branch before committing to keep your work.')}
          </div>
        </div>
      )}
      {identity && !identity.configured && (
        <div className="px-2 pt-2 shrink-0" role="status">
          <div className="text-[10.5px] text-faint flex items-center gap-1.5">
            <GitBranch size={12} className="shrink-0" aria-hidden />
            {t('git.identityMissing', 'No git identity is configured — the first commit will use a local "Surnia" identity. Set user.name/user.email to use your own.')}
          </div>
        </div>
      )}

      {/* ---- branch graph (real branch / ahead / behind data) ---- */}
      <BranchGraph
        branch={git.branch}
        ahead={aheadBehind?.ahead ?? 0}
        behind={aheadBehind?.behind ?? 0}
        known={aheadBehind !== null}
        lang={lang}
      />

      {/* ---- review findings (contract list, panel top) ---- */}
      {(findings !== null || reviewBusy) && (
        <div className="px-2 pt-2 shrink-0">
          <div className="sec-titled">
            <span className="sec-no">00</span>
            <span className="sec-tt">{t('git.review.title', 'Review')}</span>
            <span className="sec-rule" />
            {reviewBusy && <Spinner size={11} />}
            {findings && findings.length > 0 && (
              <IconBtn
                className="!w-5 !h-5 -me-1"
                title={t('common.close', 'Close')}
                aria-label={t('common.close', 'Close')}
                onClick={() => {
                  setReviewDismissed(true);
                  clearReview();
                }}
              >
                <X size={11} />
              </IconBtn>
            )}
          </div>
          {findings && findings.length > 0 ? (
            <div className="aurora-panel overflow-hidden">
              {findings.slice(0, 20).map((f, i) => (
                <div key={`${i}-${f.note.slice(0, 12)}`} className="finding">
                  <span className={`f-sev ${severityClass(f.severity)}`}>{f.severity.toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    {f.file && (
                      <span className="f-file block truncate" dir="ltr" title={f.file}>
                        {f.file}
                      </span>
                    )}
                    <span className="f-note">{f.note}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            !reviewBusy && (
              <div className="text-[10.5px] text-faint">{t('git.review.clean', 'No findings — the working diff looks clean.')}</div>
            )
          )}
        </div>
      )}

      {/* ---- changes (01) ---- */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-2">
        <div className="px-2 pt-2">
          <div className="sec-titled">
            <span className="sec-no">01</span>
            <span className="sec-tt">{t('git.changes', 'Working tree')}</span>
            <span className="sec-rule" />
            <IconBtn className="!w-5 !h-5 -me-1" title={t('git.review.run', 'Review working diff')} disabled={reviewBusy} onClick={() => void runReview()}>
              {reviewBusy ? <Spinner size={11} /> : <ScanSearch size={12} />}
            </IconBtn>
          </div>
        </div>
        <div className="px-2">
          {git.changed.length === 0 ? (
            <div className="ft-empty" role="status">
              <Check size={18} aria-hidden />
              <div className="text-[11.5px] text-faint">{t('git.noChanges')}</div>
              <div className="text-[10.5px] text-ghost">{t('git.cleanTree', 'Working tree clean — nothing to commit')}</div>
            </div>
          ) : (
            <>
              {staged.length > 0 && (
                <div className="mb-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="glass-pill !h-[20px] !px-2 !text-[9.5px] text-acc" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--acc) 40%, transparent)' }}>{t('git.staged')}</span>
                    <span className="tnum text-[9.5px] text-faint">{staged.length}</span>
                    <span className="flex-1" />
                    <IconBtn className="!w-5 !h-5" title={t('git.unstageAll', 'Unstage all')} aria-label={t('git.unstageAll', 'Unstage all')} disabled={busy} onClick={() => void unstageAll()}>
                      <ChevronDown size={12} />
                    </IconBtn>
                  </div>
                  <div className="aurora-panel overflow-hidden">{staged.map(changeRow)}</div>
                </div>
              )}
              {unstaged.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="glass-pill !h-[20px] !px-2 !text-[9.5px]">{t('git.changes')}</span>
                    <span className="tnum text-[9.5px] text-faint">{unstaged.length}</span>
                    <span className="flex-1" />
                    <IconBtn className="!w-5 !h-5" title={t('git.stageAll', 'Stage all')} aria-label={t('git.stageAll', 'Stage all')} disabled={busy} onClick={() => void stageAll()}>
                      <ChevronUp size={12} />
                    </IconBtn>
                  </div>
                  <div className="aurora-panel overflow-hidden">{unstaged.map(changeRow)}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ---- v11.38 — branches (02): real git, create + switch ---- */}
        <div className="px-2 pt-3">
          <div className="sec-titled">
            <span className="sec-no">02</span>
            <span className="sec-tt">{t('git.branches', 'Branches')}</span>
            <span className="sec-rule" />
            <IconBtn className="!w-5 !h-5 -me-1" title={t('ws.refresh')} disabled={branchBusy} onClick={() => void loadBranches()}>
              <RefreshCw size={11} />
            </IconBtn>
          </div>
          {branches === null ? null : branches.length === 0 ? (
            <div className="text-[10.5px] text-faint py-2">{t('git.branchesEmpty', 'No branches yet — make your first commit.')}</div>
          ) : (
            <div className="aurora-panel overflow-hidden">
              {branches.map((b) => (
                <div key={b.name} className="keyrow group" title={`${b.name} · ${b.hash}`}>
                  {b.current ? (
                    <span className="stamp stamp-acc !h-[15px] !px-1 !text-[9px] shrink-0" title={t('git.branchCurrent', 'Current branch')}>
                      <GitBranch size={10} className="shrink-0" aria-hidden />
                    </span>
                  ) : (
                    <span className="stamp !h-[15px] !px-1 !text-[9px] shrink-0" aria-hidden>·</span>
                  )}
                  <span className="key-main">
                    <span className="key-title !text-[11.5px] !font-normal truncate" dir="ltr">{b.name}</span>
                    <span className="key-sub tnum" dir="ltr">{b.hash}</span>
                  </span>
                  {!b.current && (
                    <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <IconBtn
                        className="!w-6 !h-6"
                        title={`${t('git.branchSwitch', 'Switch to branch')} ${b.name}`}
                        disabled={branchBusy}
                        onClick={() => void switchBranch(b.name)}
                      >
                        <GitBranch size={12} />
                      </IconBtn>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <TextInput
              value={newBranch}
              placeholder={t('git.branchNew', 'New branch name')}
              className="h-7 !text-[11.5px] flex-1 min-w-0"
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void createBranchNow();
                }
              }}
            />
            <IconBtn
              className={`!w-7 !h-7 shrink-0 ${branchSwitchOnCreate ? 'is-on' : ''}`}
              title={t('git.branchSwitchOnCreate', 'Also switch to the new branch after creating it')}
              aria-label={t('git.branchSwitchOnCreate', 'Also switch to the new branch after creating it')}
              aria-pressed={branchSwitchOnCreate}
              disabled={branchBusy}
              onClick={() => setBranchSwitchOnCreate((v) => !v)}
            >
              <GitBranchPlus size={14} />
            </IconBtn>
            <Btn className="!h-7 !px-2.5 shrink-0" disabled={!newBranch.trim() || branchBusy} onClick={() => void createBranchNow()}>
              <Plus size={12} />
              {t('git.branchCreate', 'Create')}
            </Btn>
          </div>
        </div>

        {/* ---- history (03) ---- */}
        <div className="px-2 pt-3">
          <div className="sec-titled">
            <span className="sec-no">03</span>
            <span className="sec-tt">{t('git.history', 'History')}</span>
            <span className="sec-rule" />
            <IconBtn className="!w-5 !h-5 -me-1" title={t('ws.refresh')} onClick={() => void loadHistory()}>
              <RefreshCw size={11} />
            </IconBtn>
          </div>
          {log === null ? null : log.length === 0 ? (
            <div className="text-[10.5px] text-faint py-2">{t('git.historyEmpty', 'No commits yet')}</div>
          ) : (
            <div className="aurora-panel overflow-hidden">
              {log.map((e) => (
                <div key={e.hash} className="keyrow" title={`${e.hash} · ${e.author} · ${e.date}`}>
                  <span className="tnum text-[9.5px] text-[var(--acc2)] shrink-0" dir="ltr">
                    {e.hash.slice(0, 7)}
                  </span>
                  <span className="key-main">
                    <span className="key-title !text-[11.5px] !font-normal truncate">{e.message.split('\n')[0]}</span>
                    <span className="key-sub" dir="ltr">
                      {e.author}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- commit box ---- */}
      <div className="p-2.5 border-t border-line shrink-0 bg-[color-mix(in_srgb,var(--panel)_65%,transparent)]">
        <div className="flex items-center gap-1">
          <TextInput
            placeholder={t('git.commitMsg')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit();
            }}
          />
          {/* AI commit: .ibtn wand + style-match instrument toggle */}
          <div className="flex items-center gap-0.5 shrink-0">
            <IconBtn
              className="!w-7 !h-7 text-[var(--acc2)]"
              title={aiBusy ? t('chat.thinking', 'Thinking…') : t('git.aiCommit', 'Generate commit message with AI')}
              aria-label={t('git.aiCommit', 'Generate commit message with AI')}
              disabled={aiBusy}
              onClick={() => void generateMessage()}
            >
              {aiBusy ? <Spinner size={13} /> : <Wand2 size={14} />}
            </IconBtn>
            <IconBtn
              className={`!w-7 !h-7 ${styleMatchOn ? 'is-on' : ''}`}
              title={
                styleMatchOn
                  ? t('git.styleMatch.on', 'Style-match commit message: ON — follows your recent commit style')
                  : t('git.styleMatch.off', 'Style-match commit message: OFF')
              }
              aria-pressed={styleMatchOn}
              aria-label={t('git.styleMatch', 'Style-match commit message')}
              onClick={toggleStyleMatch}
            >
              <span className="tnum text-[9px] font-semibold leading-none">Aa</span>
            </IconBtn>
          </div>
        </div>
        {/* v2.4 — AI generation straight from the diff: inserts into the box,
            never auto-commits. No dedicated PR UI exists in this build, so the
            PR description lands in the same box for review/copy. */}
        <div className="flex items-center gap-1.5 mt-2">
          <button
            type="button"
            className="glass grain press focus-glass flex-1 h-7 inline-flex items-center justify-center gap-1.5 rounded-full border border-line text-[10.5px] font-semibold text-[var(--dim)] hover:text-[var(--ink)] disabled:opacity-50 disabled:cursor-default"
            disabled={genBusy !== null}
            title={t('git.aiCommit', 'AI commit message')}
            aria-label={t('git.aiCommit', 'AI commit message')}
            onClick={() => void generateWithAi('commit')}
          >
            {genBusy === 'commit' ? <Spinner size={11} /> : <Sparkles size={12} className="text-[var(--acc2)] shrink-0" />}
            <span className="truncate">
              {genBusy === 'commit' ? t('git.aiWorking', 'Writing…') : t('git.aiCommit', 'AI commit message')}
            </span>
          </button>
          <button
            type="button"
            className="glass grain press focus-glass flex-1 h-7 inline-flex items-center justify-center gap-1.5 rounded-full border border-line text-[10.5px] font-semibold text-[var(--dim)] hover:text-[var(--ink)] disabled:opacity-50 disabled:cursor-default"
            disabled={genBusy !== null}
            title={t('git.aiPR', 'AI PR description')}
            aria-label={t('git.aiPR', 'AI PR description')}
            onClick={() => void generateWithAi('pr')}
          >
            {genBusy === 'pr' ? <Spinner size={11} /> : <Sparkles size={12} className="text-[var(--acc2)] shrink-0" />}
            <span className="truncate">
              {genBusy === 'pr' ? t('git.aiWorking', 'Writing…') : t('git.aiPR', 'AI PR description')}
            </span>
          </button>
        </div>
        <Btn
          variant="primary"
          className="w-full mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!message.trim() || conflicts.length > 0 || busy}
          title={conflicts.length > 0 ? t('git.conflict.title', 'Merge conflict — resolve before committing') : undefined}
          onClick={() => void commit()}
        >
          <Check size={13} />
          {t('git.commit')}
        </Btn>
      </div>
    </div>
  );
}

export default GitPanel;
