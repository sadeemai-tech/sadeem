// SADEEM — diff review modal: unified patch viewer or side-by-side Monaco diff.
// Header carries the file path (one-click copy), new-file marker and +/- line
// count chips (exact from the patch, or LCS-counted for text diffs).
// A3: unified rows gain a real gutter (old/new line numbers, .tnum, never
// color-only), +/- rows use low-alpha --ok/--bad fills with readable ink and
// the sign carrying the tone; the text-diff path gains a unified/split toggle.
// TRUST MAP: the patch viewer carries a colored left margin per hunk —
// the color is the RUN-WIDE gate verdict from the Proof Ribbon state
// (green = gates passed · amber = partial · red = failed · gray = unknown).
// No per-hunk gate data exists yet, so the margin is honest run-wide (never
// faked per-hunk). "Review the top 3" scrolls to the 3 largest hunks.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Ban, Check, Copy, FileDiff, ShieldCheck } from 'lucide-react';
import { DiffEditor, loader } from '@monaco-editor/react';
import { monaco, monacoThemeFor, languageForPath } from '../lib/monaco';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Btn, Chip, Kbd, Modal, Spinner } from './ui';
// A1 — the /rewind checkpoint chooser rides on this always-mounted modal root
// (App.tsx renders <DiffModal /> unconditionally; A1 may not edit App.tsx, so
// this is the one compliant mount point for new root-level store-driven UI).
import { RewindChooser } from './RewindChooser';

// Bundle Monaco locally (offline-safe) instead of loading it from a CDN.
loader.config({ monaco });

function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

/** One patch hunk: the @@ header line index + changed-line count (size). */
interface PatchHunk {
  startLine: number; // index into the patch lines
  lineCount: number; // total rendered lines in the hunk
  changed: number; // + and − lines (the "size" used for top-3 ranking)
  oldStart: number; // first old-file line number from the @@ header
  newStart: number; // first new-file line number from the @@ header
}

/** Split a unified patch into hunks with sizes + start line numbers
 *  (trust map, top-3 and the gutter line numbering all read this). */
function splitHunks(patch: string): PatchHunk[] {
  const lines = patch.split('\n');
  const hunks: PatchHunk[] = [];
  let cur: PatchHunk | null = null;
  lines.forEach((line, i) => {
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur);
      const m = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      cur = {
        startLine: i,
        lineCount: 1,
        changed: 0,
        oldStart: m ? parseInt(m[1], 10) : 1,
        newStart: m ? parseInt(m[3], 10) : 1,
      };
    } else if (cur) {
      cur.lineCount++;
      if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) {
        cur.changed++;
      }
    }
  });
  if (cur) hunks.push(cur);
  return hunks;
}

const LCS_CAP = 600; // lines per side — keep the O(n·m) table tiny

/** Added/removed line counts for a plain old→new text diff (null when too large). */
function countTextDiff(oldText: string, newText: string): { added: number; removed: number } | null {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length > LCS_CAP || b.length > LCS_CAP) return null;
  const n = b.length;
  let prev = new Uint32Array(n + 1);
  let cur = new Uint32Array(n + 1);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      cur[j] = a[i] === b[j] ? prev[j + 1] + 1 : Math.max(prev[j], cur[j + 1]);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
    cur.fill(0);
  }
  const lcs = prev[0];
  return { added: n - lcs, removed: a.length - lcs };
}

function CopyBtn({ text, label, title }: { text: string; label?: string; title: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded-md border border-line text-faint hover:text-[var(--ink)] hover:border-acc transition-colors cursor-pointer shrink-0"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
      {(label || copied) && (
        <span className="text-[10px]">{copied ? t('chat.copied', 'Copied') : label}</span>
      )}
    </button>
  );
}

export function DiffModal() {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const diffView = useStore((s) => s.diffView);
  const settings = useStore((s) => s.settings);
  const setDiffView = useStore((s) => s.setDiffView);
  const decideApproval = useStore((s) => s.decideApproval);
  // theme 'follow': resolve the OS light/dark preference (live) so the diff
  // editor matches data-theme — mirrors EditorArea's existing wiring.
  const systemLight = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-color-scheme: light)').matches,
    () => false,
  );
  const monacoTheme =
    settings.theme === 'follow' ? (systemLight ? 'surnia-light' : 'surnia-dark') : monacoThemeFor(settings.theme);
  // v7.2 — run-wide gate verdict (drives the trust-map margin color)
  const proofGates = useStore((s) => s.proof.gates);

  // Closing an APPROVAL diff is a real decision, not a silent dismissal: the
  // engine's approval promise stays pending until decideApproval() runs, so
  // X / backdrop / Esc must all route through DENY (never leave the run hung).
  // A plain git diff has no approval — just close the surface.
  const close = () => {
    if (diffView?.approvalRequestId) {
      void decideApproval('deny')
        .catch(() => { /* bridge unavailable — still clear the surface */ })
        .finally(() => setDiffView(null));
    } else {
      setDiffView(null);
    }
  };
  // text-diff view mode (Monaco path): split side-by-side by default,
  // switchable to unified inline — the patch path is unified by nature.
  const [splitView, setSplitView] = useState(true);
  // A fresh diff request starts at the default toggle instead of inheriting
  // the previous request's choice (stale UI state across approvals).
  useEffect(() => setSplitView(true), [diffView]);

  // ---- approval keyboard shortcuts (only while this modal carries an
  // approval): ↵ approve once · ⌫ deny · A always. Skipped when a text input
  // (including the Monaco textarea) has focus so editing is never hijacked.
  const isApproval = !!diffView?.approvalRequestId;
  useEffect(() => {
    if (!isApproval) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' ||
          tgt.tagName === 'TEXTAREA' ||
          tgt.tagName === 'SELECT' ||
          tgt.isContentEditable ||
          tgt.closest?.('.monaco-editor'))
      )
        return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void decideApproval('allow');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        void decideApproval('deny');
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void decideApproval('always');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isApproval, decideApproval]);

  // +/- line counts: exact for patch mode; LCS-counted for text diffs (capped).
  const counts = useMemo(() => {
    if (!diffView) return null;
    if (diffView.patch) return countPatch(diffView.patch);
    return countTextDiff(diffView.oldText, diffView.newText);
  }, [diffView]);

  // ---- v7.2 trust map: run-wide verdict tone + hunk geometry ----
  const trustTone: 'ok' | 'partial' | 'bad' | 'unknown' = useMemo(() => {
    if (proofGates.length === 0) return 'unknown';
    if (proofGates.some((g) => g.tone === 'bad')) return 'bad';
    if (proofGates.some((g) => g.tone === 'warn')) return 'partial';
    return 'ok';
  }, [proofGates]);
  const trustColor =
    trustTone === 'ok'
      ? 'var(--ok)'
      : trustTone === 'partial'
        ? 'var(--warn)'
        : trustTone === 'bad'
          ? 'var(--bad)'
          : 'var(--ghost)';
  const trustLabelKey =
    trustTone === 'ok'
      ? 'trust.passed'
      : trustTone === 'partial'
        ? 'trust.partial'
        : trustTone === 'bad'
          ? 'trust.failed'
          : 'trust.unknown';
  const trustLabelFb =
    trustTone === 'ok'
      ? 'Gates passed'
      : trustTone === 'partial'
        ? 'Partially verified'
        : trustTone === 'bad'
          ? 'Gates failed'
          : 'No run verdict yet';

  const hunks = useMemo(() => (diffView?.patch ? splitHunks(diffView.patch) : []), [diffView?.patch]);
  const top3 = useMemo(
    () => [...hunks].sort((a, b) => b.changed - a.changed).slice(0, 3).map((h) => h.startLine),
    [hunks],
  );
  const patchWrapRef = useRef<HTMLDivElement>(null);
  const scrollToHunk = (startLine: number) => {
    const el = patchWrapRef.current?.querySelector<HTMLElement>(`[data-hunk="${startLine}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const titleNode = diffView ? (
    <div className="flex items-center gap-2 min-w-0 w-full pe-2">
      <FileDiff size={14} className="text-acc2 shrink-0" />
      <span className="truncate min-w-0">{diffView.title}</span>
      {diffView.path && (
        <span className="flex items-center gap-1 min-w-0 shrink-0">
          <Chip className="max-w-[220px] min-w-0">
            <span className="font-code text-faint truncate min-w-0" dir="ltr">
              {diffView.path}
            </span>
          </Chip>
          <CopyBtn text={diffView.path} title={t('diff.copyPath', 'Copy file path')} />
        </span>
      )}
      {diffView.newText && !diffView.oldText && (
        <span className="stamp stamp-acc shrink-0">{t('diff.newFile')}</span>
      )}
      {counts && (counts.added > 0 || counts.removed > 0) && (
        <span
          className="sc-diffstats shrink-0"
          dir="ltr"
          title={t('diff.statTitle', lang === 'ar' ? '{a} مضاف · {r} محذوف' : '{a} added · {r} removed').replace('{a}', String(counts.added)).replace('{r}', String(counts.removed))}
        >
          <span style={{ color: 'var(--ok)' }}>{`+${counts.added}`}</span>
          <span className="text-faint"> / </span>
          <span style={{ color: 'var(--bad)' }}>{`−${counts.removed}`}</span>
        </span>
      )}
      {diffView.patch && (
        <span className="ms-auto shrink-0">
          <CopyBtn text={diffView.patch} label={t('diff.copyPatch', 'Copy patch')} title={t('diff.copyPatch', 'Copy patch')} />
        </span>
      )}
    </div>
  ) : (
    ''
  );

  const footerNode = diffView?.approvalRequestId ? (
    <div className="flex items-center gap-2 justify-end">
      <span className="me-auto text-[10.5px] text-faint hidden sm:flex items-center gap-1.5">
        <Kbd>↵</Kbd> {t('diff.approve')}
        <Kbd>⌫</Kbd> {t('diff.deny')}
        <Kbd>A</Kbd> {t('chat.approveAlways')}
      </span>
      <Btn variant="ghost" onClick={() => void decideApproval('always')}>
        <ShieldCheck size={14} />
        {t('chat.approveAlways')}
      </Btn>
      <Btn onClick={() => void decideApproval('deny')}>
        <Ban size={14} />
        {t('diff.deny')}
      </Btn>
      <Btn variant="primary" onClick={() => void decideApproval('allow')}>
        <Check size={14} />
        {t('diff.approve')}
      </Btn>
    </div>
  ) : (
    <div className="flex items-center justify-end">
      <Btn onClick={close}>{t('diff.close')}</Btn>
    </div>
  );

  // A1 — /rewind chooser is independent of the diff (own store state),
  // rendered as a sibling so its open state never affects the diff modal.
  return (
    <>
      <RewindChooser />
      <Modal
      open={!!diffView}
      onClose={close}
      width={860}
      title={titleNode}
      footer={footerNode}
      // z=85: sits above PlansScreen (z-[70] today, being raised to z-[80]) so
      // an approval diff opened over plans stays visible and interactive —
      // the modalStack in ui.tsx expects DiffModal > PlansScreen ordering.
      z={85}
      ariaLabel={t('git.diffTitle', 'View diff')}
    >
      {/* v7.2 — trust-map verdict chip: what the margin color means */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 h-[18px] px-1.5 rounded-[3px] border text-[10px] shrink-0"
          style={{ borderColor: 'var(--line)', color: trustColor }}
          title={t('trust.label', 'Run verdict')}
        >
          <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: trustColor }} aria-hidden />
          {t(trustLabelKey, trustLabelFb)}
        </span>
        {diffView?.patch && hunks.length >= 3 && (
          <button
            className="text-[10.5px] text-acc hover:underline cursor-pointer"
            title={t('trust.top3Hint', 'Scroll to the 3 largest hunks in this diff')}
            // The three largest hunks are tinted by the gutter (isTop); smooth
            // scrolling to each in a forEach only landed on the SMALLEST one.
            // Land on the largest and let the tints mark the other two.
            onClick={() => { if (top3.length) scrollToHunk(top3[0]); }}
          >
            {t('trust.top3', 'Review the top 3')}
          </button>
        )}
      </div>
      {diffView?.patch ? (
        <div className="card overflow-hidden" dir="ltr" ref={patchWrapRef}>
          {/* .fhdr file header — mono path + stats strip */}
          <div className="fhdr">
            <FileDiff size={11} className="shrink-0" />
            <span className="truncate min-w-0" title={diffView.path}>
              {diffView.path || diffView.title}
            </span>
            {counts && (
              <span
                className="ms-auto sc-diffstats shrink-0"
                title={t('diff.statTitle', lang === 'ar' ? '{a} مضاف · {r} محذوف' : '{a} added · {r} removed').replace('{a}', String(counts.added)).replace('{r}', String(counts.removed))}
              >
                <span style={{ color: 'var(--ok)' }}>{`+${counts.added}`}</span>
                <span className="text-faint"> / </span>
                <span style={{ color: 'var(--bad)' }}>{`−${counts.removed}`}</span>
              </span>
            )}
          </div>
          {/* v7.2 — TRUST MAP: each hunk block gets the run-wide verdict as a
              colored left margin (borderInlineStart). Honest scope: the color
              is the run-wide gate verdict — no per-hunk gate data exists.
              A3: rows carry a real gutter — old/new line numbers from the
              @@ headers, tabular, user-select: none — and the +/- tone is
              carried by the sign column plus a low-alpha functional fill. */}
          <pre className="sc-diff-pre">
            {(() => {
              const lines = diffView.patch.split('\n');
              const hunkStarts = new Set(hunks.map((h) => h.startLine));
              /** One gutter row. tone: 'add' | 'del' | 'ctx' | 'meta' | 'hunk'. */
              const row = (
                line: string,
                tone: 'add' | 'del' | 'ctx' | 'meta' | 'hunk',
                oldNo: number | null,
                newNo: number | null,
                key: React.Key,
              ): React.ReactNode => {
                const cls =
                  tone === 'add'
                    ? 'dline dline-add'
                    : tone === 'del'
                      ? 'dline dline-del'
                      : tone === 'meta'
                        ? 'dline dline-meta'
                        : tone === 'hunk'
                          ? 'dline dline-hunk'
                          : 'dline';
                const sign = tone === 'add' ? '+' : tone === 'del' ? '−' : ' ';
                const body =
                  tone === 'add' || tone === 'del' ? line.slice(1) : line;
                return (
                  <div key={key} className={cls}>
                    <span className="dl-no">{oldNo ?? ''}</span>
                    <span className="dl-no">{newNo ?? ''}</span>
                    <span className="dl-sign">{sign}</span>
                    <span className="dl-text">{body === '' ? ' ' : body}</span>
                  </div>
                );
              };
              return lines.map((line, i) => {
                if (!hunkStarts.has(i)) {
                  // file meta before the first hunk (diff --git / index / --- / +++)
                  return row(line, 'meta', null, null, i);
                }
                const hunk = hunks.find((h) => h.startLine === i);
                const body = [line];
                let j = i + 1;
                while (j < lines.length && !lines[j].startsWith('@@')) {
                  body.push(lines[j]);
                  j++;
                }
                const isTop = top3.includes(i);
                const rows: React.ReactNode[] = [row(line, 'hunk', null, null, `${i}-h`)];
                let oldNo = hunk?.oldStart ?? 1;
                let newNo = hunk?.newStart ?? 1;
                for (let k = 1; k < body.length; k++) {
                  const l = body[k];
                  if (l.startsWith('+') && !l.startsWith('+++')) {
                    rows.push(row(l, 'add', null, newNo, `${i}-${k}`));
                    newNo++;
                  } else if (l.startsWith('-') && !l.startsWith('---')) {
                    rows.push(row(l, 'del', oldNo, null, `${i}-${k}`));
                    oldNo++;
                  } else {
                    rows.push(row(l, 'ctx', oldNo, newNo, `${i}-${k}`));
                    oldNo++;
                    newNo++;
                  }
                }
                return (
                  <div
                    key={i}
                    data-hunk={i}
                    className="diff-hunk"
                    style={{
                      borderInlineStart: `3px solid ${trustColor}`,
                      paddingInlineStart: 6,
                      background: isTop
                        ? 'color-mix(in srgb, var(--acc) 4%, transparent)'
                        : undefined,
                    }}
                    title={t(trustLabelKey, trustLabelFb) + (isTop ? ` · ${t('trust.top3', 'Review the top 3')}` : '')}
                  >
                    {rows}
                  </div>
                );
              });
            })()}
          </pre>
        </div>
      ) : diffView ? (
        <div
          className="h-[56vh] rounded-xl overflow-hidden border border-line bg-[var(--bg1)]"
          dir="ltr"
          style={{ direction: 'ltr', unicodeBidi: 'isolate', borderInlineStart: `3px solid ${trustColor}` }}
        >
          {/* unified / split toggle (Monaco path only — a raw unified patch has
              no old/new buffers to split, so it stays unified by nature) */}
          <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-line">
            <div className="stamp-seg is-plain">
              <button
                type="button"
                className={!splitView ? 'is-active' : ''}
                aria-pressed={!splitView}
                title={t('diff.viewUnified', lang === 'ar' ? 'عرض موحّد' : 'Unified view')}
                onClick={() => setSplitView(false)}
              >
                {t('diff.viewUnified', lang === 'ar' ? 'موحّد' : 'Unified')}
              </button>
              <button
                type="button"
                className={splitView ? 'is-active' : ''}
                aria-pressed={splitView}
                title={t('diff.viewSplit', lang === 'ar' ? 'عرض جنباً إلى جنب' : 'Side-by-side view')}
                onClick={() => setSplitView(true)}
              >
                {t('diff.viewSplit', lang === 'ar' ? 'منفصل' : 'Split')}
              </button>
            </div>
          </div>
          <div className="h-[calc(56vh-36px)]">
            <DiffEditor
              original={diffView.oldText}
              modified={diffView.newText}
              language={languageForPath(diffView.path)}
              theme={monacoTheme}
              loading={<Spinner size={18} />}
              options={{
                readOnly: true,
                renderSideBySide: splitView,
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 12,
              }}
            />
          </div>
        </div>
      ) : null}
      </Modal>
    </>
  );
}

export default DiffModal;
