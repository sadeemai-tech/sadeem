// ============================================================
// DiffView — v10.2 Codex/Claude-Code-class before/after code block
// for the chat stream. Mounted inside edit/write tool cards:
//   · header — file tail, +N −M chips, Unified | Split toggle
//   · unified — hunk headers, old/new gutters, add/del tints,
//     word-level highlight inside replaced pairs
//   · split — "Before | After" two-column alignment
// Colors ride the monochrome palette: additions use the quiet-lime
// accent family, deletions a muted rust — flat tints, no gradients.
// ============================================================
import React, { useMemo, useState } from 'react';
import { Columns2, Rows3, ChevronDown } from 'lucide-react';
import { lineDiff, type DiffRow, type WordSeg } from '../lib/linediff';
import { useT } from '../i18n';
import { useStore } from '../store';

const MAX_TEXT_CHARS = 200_000; // per-text guard before diffing
const COLLAPSE_ROWS = 14; // rows visible when a hunk block is collapsed

function WordSegs({ segs }: { segs: WordSeg[] }) {
  return (
    <>
      {segs.map((sg, i) =>
        sg.k === 'ctx' ? (
          <span key={i}>{sg.s}</span>
        ) : (
          <span key={i} className={sg.k === 'del' ? 'diffv-wdel' : 'diffv-wadd'}>
            {sg.s}
          </span>
        ),
      )}
    </>
  );
}

function RowText({ row }: { row: DiffRow }) {
  if (row.segs) return <WordSegs segs={row.segs} />;
  return <>{row.text}</>;
}

function DiffRows({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className={`diffv-line diffv-${r.kind}`} dir="ltr">
          <span className="diffv-no" aria-hidden>
            {r.oldNo ?? ''}
          </span>
          <span className="diffv-no" aria-hidden>
            {r.newNo ?? ''}
          </span>
          <span className="diffv-sign" aria-hidden>
            {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}
          </span>
          <span className="diffv-code">
            <RowText row={r} />
          </span>
        </div>
      ))}
    </>
  );
}

/** Split view: before (dels + ctx) left, after (adds + ctx) right. */
function SplitHunk({ rows }: { rows: DiffRow[] }) {
  const left: DiffRow[] = [];
  const right: DiffRow[] = [];
  for (const r of rows) {
    if (r.kind === 'ctx') {
      left.push(r);
      right.push(r);
    } else if (r.kind === 'del') {
      left.push(r);
    } else {
      right.push(r);
    }
  }
  const h = Math.max(left.length, right.length);
  const pad = (arr: DiffRow[]) => {
    const out: (DiffRow | null)[] = [...arr];
    while (out.length < h) out.push(null);
    return out;
  };
  const L = pad(left);
  const R = pad(right);
  return (
    <>
      {L.map((l, i) => (
        <div key={i} className="diffv-split-row" dir="ltr">
          <div className={`diffv-half ${l ? `diffv-${l.kind}` : 'diffv-void'}`}>
            {l ? (
              <>
                <span className="diffv-no" aria-hidden>
                  {l.oldNo ?? ''}
                </span>
                <span className="diffv-sign" aria-hidden>
                  {l.kind === 'del' ? '−' : ' '}
                </span>
                <span className="diffv-code">
                  <RowText row={l} />
                </span>
              </>
            ) : null}
          </div>
          <div className={`diffv-half ${R[i] ? `diffv-${R[i].kind}` : 'diffv-void'}`}>
            {R[i] ? (
              <>
                <span className="diffv-no" aria-hidden>
                  {R[i].newNo ?? ''}
                </span>
                <span className="diffv-sign" aria-hidden>
                  {R[i].kind === 'add' ? '+' : ' '}
                </span>
                <span className="diffv-code">
                  <RowText row={R[i]} />
                </span>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}

export interface DiffViewProps {
  path?: string;
  oldText: string;
  newText: string;
  /** Start in the two-column view (default false → unified). */
  defaultSplit?: boolean;
  /** Compact mode inside already-collapsed drawers. */
  compact?: boolean;
}

export function DiffView({ path, oldText, newText, defaultSplit = false, compact = false }: DiffViewProps) {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const [split, setSplit] = useState(defaultSplit);
  const [showAll, setShowAll] = useState(false);

  const diff = useMemo(() => {
    const o = oldText.length > MAX_TEXT_CHARS ? oldText.slice(0, MAX_TEXT_CHARS) : oldText;
    const n = newText.length > MAX_TEXT_CHARS ? newText.slice(0, MAX_TEXT_CHARS) : newText;
    return lineDiff(o, n, { context: compact ? 2 : 3, maxRows: showAll ? 4000 : 120 });
  }, [oldText, newText, showAll, compact]);

  if (!oldText && !newText) return null;
  if (diff.hunks.length === 0) return null;

  const tail = path ? (path.split(/[\\/]/).pop() ?? path) : '';
  const created = !oldText.trim();

  return (
    <div className={`diffv ${compact ? 'is-compact' : ''}`} dir="ltr">
      <div className="diffv-head">
        <span className="diffv-file" title={path || ''} dir="auto">
          {created
            ? t('diff.created', ar ? 'ملف جديد' : 'New file')
            : tail
              ? tail
              : t('diff.change', ar ? 'تغيير' : 'Change')}
        </span>
        <span className="diffv-stat tnum" dir="ltr" title={`+${diff.add} −${diff.del}`}>
          <b className="diffv-stat-add">+{diff.add}</b>
          <b className="diffv-stat-del">−{diff.del}</b>
        </span>
        <span className="diffv-grow" aria-hidden />
        <div className="diffv-toggle" role="tablist" aria-label={t('diff.view', ar ? 'طريقة العرض' : 'Diff view')}>
          <button
            role="tab"
            aria-selected={!split}
            className={`diffv-toggle-btn${!split ? ' is-on' : ''}`}
            onClick={() => setSplit(false)}
            title={t('diff.unified', ar ? 'موحّد' : 'Unified')}
          >
            <Rows3 size={11} aria-hidden />
          </button>
          <button
            role="tab"
            aria-selected={split}
            className={`diffv-toggle-btn${split ? ' is-on' : ''}`}
            onClick={() => setSplit(true)}
            title={t('diff.split', ar ? 'قبل / بعد' : 'Before / After')}
          >
            <Columns2 size={11} aria-hidden />
          </button>
        </div>
      </div>

      <div className="diffv-body">
        {split ? (
          <div className="diffv-split-cols">
            <span dir="auto">{t('diff.before', ar ? 'قبل' : 'Before')}</span>
            <span dir="auto">{t('diff.after', ar ? 'بعد' : 'After')}</span>
          </div>
        ) : null}
        {diff.hunks.map((hk, hi) => (
          <div key={hi} className="diffv-hunk">
            <div className="diffv-hunkhead tnum" dir="ltr">
              {hk.header}
            </div>
            {split ? <SplitHunk rows={hk.rows} /> : <DiffRows rows={hk.rows} />}
          </div>
        ))}
        {diff.truncated && (
          <button className="diffv-more" dir="auto" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? t('diff.less', ar ? 'عرض أقل' : 'Show less')
              : t('diff.more', ar ? 'عرض كل التغييرات' : 'Show all changes')}
            <ChevronDown size={11} className={showAll ? 'is-open' : ''} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

// diffInputsFromToolArgs lives in lib/linediff.ts (pure) — re-exported here
// for the MessageView import surface.
export { diffInputsFromToolArgs } from '../lib/linediff';
