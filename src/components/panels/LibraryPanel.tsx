// ============================================================
// LibraryPanel — v10.2 Rail view: cross-session artifact gallery.
// Everything SADEEM produces lands here: generated images, PDFs/
// DOCX/XLSX documents, downloaded files, session exports. Grid of
// kind-tinted cards (no emoji, flat monochrome + quiet-lime),
// filter by kind, open/reveal in the OS, forget entries.
//
// v11.12 FINAL POLISH — editorial presentation only. The behaviour
// (IPC, state, tabs, filters, open/forget/clear) is untouched; the
// artwork is authored in ./library-art.css + the SVG below.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, FileText, Image as ImageIcon, Download, ExternalLink, RefreshCw, Trash2, Search, TriangleAlert,
  FileSpreadsheet, FolderOpen, Share2, Film,
} from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import type { LibraryItem, LibraryKind } from '../../../shared/types';
import { WikiPanel } from './WikiPanel';
import { LottieBox } from '../LottieBox';
import greetingAnim from '../../assets/lottie/greeting.json';
import '../workspace.css';
import '../pages.css';
import './library-art.css';

const KIND_ORDER: (LibraryKind | 'all')[] = ['all', 'image', 'document', 'download', 'export', 'file'];
/** The five real shelf bays (no synthetic "all" bay). */
const SHELF_KINDS: LibraryKind[] = ['image', 'document', 'download', 'export', 'file'];
/** These lib.kind.* keys are not in the dictionary yet — pass a REAL bilingual
 *  fallback to t() so Arabic never falls back to uppercase English labels. */
const KIND_LABEL: Record<LibraryKind | 'all', [string, string]> = {
  all: ['All', 'الكل'],
  image: ['Image', 'صورة'],
  document: ['Document', 'مستند'],
  download: ['Download', 'تنزيل'],
  export: ['Export', 'تصدير'],
  file: ['File', 'ملف'],
};
function kindLabel(k: LibraryKind | 'all', ar: boolean): string {
  const [en, arabic] = KIND_LABEL[k] ?? KIND_LABEL.file;
  return ar ? arabic : en;
}

/** v11.38 — one DISTINCT glyph per kind. document/export/file used to share
 *  the same FileText icon, so a populated gallery read as "nothing in it". */
function kindIcon(k: LibraryKind) {
  switch (k) {
    case 'image': return ImageIcon;
    case 'document': return FileSpreadsheet;
    case 'download': return Download;
    case 'export': return Share2;
    case 'file':
    default: return FolderOpen;
  }
}

/** A CSP-safe "thumbnail": an inline SVG tile, never an <img src="file:…">.
 *  The renderer CSP allows 'self' data: blob: https: — NOT file: — so a real
 *  filesystem path in an <img> would be blocked and render as an empty card.
 *  This glyph is always visible and unmistakably describes the kind. */
function KindThumb({ kind }: { kind: LibraryKind }) {
  const common = { size: 26, strokeWidth: 1.25, 'aria-hidden': true as const };
  let glyph: React.ReactNode;
  switch (kind) {
    case 'image': glyph = <ImageIcon {...common} />; break;
    case 'document': glyph = <FileText {...common} />; break;
    case 'download': glyph = <Download {...common} />; break;
    case 'export': glyph = <Film {...common} />; break;
    case 'file':
    default: glyph = <FolderOpen {...common} />; break;
  }
  return (
    <span
      className={`lib-thumb lib-thumb-${kind} is-${kind}`}
      aria-hidden="true"
      data-kind={kind}
      style={{
        display: 'inline-grid', placeItems: 'center', width: 44, height: 44,
        border: '1px solid var(--line)', color: 'var(--acc, currentColor)',
        background: 'var(--hover, transparent)', marginBlock: 6,
      }}
    >
      {glyph}
    </span>
  );
}

function fmtWhen(ms: number, ar: boolean): string {
  const d = new Date(ms);
  return d.toLocaleDateString(ar ? 'ar' : 'en', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(ar ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' });
}

function fmtSize(n?: number): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ *
 * ORIGINAL 1px GLYPH — a filing box seen end-on: one open contour,
 * a tab and a registration dot. Nothing is imported or fill-heavy.
 * ------------------------------------------------------------------ */
function LibraryGlyph() {
  return (
    <svg className="ed-glyph" viewBox="0 0 72 34" fill="none" stroke="currentColor"
      strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 9h44v20H14z" />
      <path d="M14 15h44M28 9V5h16v4" />
      <path d="M20 24h14" opacity=".5" />
      <circle cx="50" cy="24" r="1.6" fill="currentColor" stroke="none" />
      <path d="M6 19h4M62 19h4" opacity=".55" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * THE SHELF — a measured diagram. Five bays, evenly spaced vertical
 * dividers, one real filing-box glyph per bay and the EXACT count
 * read from the live library (never a decorative placeholder).
 * ------------------------------------------------------------------ */
function FilingBox({ x, y, w, h, filled }: { x: number; y: number; w: number; h: number; filled: boolean }) {
  return (
    <g className={`lib-box${filled ? ' is-filled' : ''}`}>
      <rect x={x} y={y} width={w} height={h} rx="1" />
      <path d={`M${x} ${y + 6}h${w}`} />
      <path d={`M${x + w / 2 - 5} ${y}h10`} />
      <circle cx={x + w / 2} cy={y + h - 6} r="1.5" fill="currentColor" stroke="none" />
    </g>
  );
}

function LibraryShelf({ counts, total, t, lang }: {
  counts: Record<LibraryKind, number>;
  total: number;
  t: (k: string, fb?: string) => string;
  lang: string;
}) {
  const W = 624;
  const H = 176;
  const left = 24;
  const right = W - 24;
  const bayW = (right - left) / SHELF_KINDS.length;
  const railTop = 32;
  const railBottom = 126;

  return (
    <figure className="lib-shelf">
      <div className="lib-shelf-head">
        <span className="ed-mono">{t('lib.shelf.label', lang === 'ar' ? 'مخطط الرف' : 'SHELF / INDEX')}</span>
        <span className="ed-mono lib-shelf-total" dir="ltr">
          {t('lib.shelf.total', lang === 'ar' ? 'المجموع' : 'TOTAL')} {total}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={t('lib.shelf.a11y', lang === 'ar' ? 'رف المكتبة مع عدادات حقيقية لكل نوع' : 'Library shelf with real per-kind counts')}>
        <g className="lib-shelf-ink" fill="none" stroke="currentColor" strokeWidth="1">
          {/* the two shelf rails, drawn on mount */}
          <line className="lib-draw" pathLength={1} x1={left} y1={railTop} x2={right} y2={railTop} />
          <line className="lib-draw" pathLength={1} x1={left} y1={railBottom} x2={right} y2={railBottom} style={{ animationDelay: '120ms' }} />
          {SHELF_KINDS.map((kind, i) => {
            const bx = left + i * bayW;
            const count = counts[kind] ?? 0;
            const boxW = Math.min(48, bayW - 30);
            const boxX = bx + (bayW - boxW) / 2;
            return (
              <g key={kind} className="lib-bay" style={{ animationDelay: `${100 + i * 90}ms` }}>
                <line className="lib-draw" pathLength={1} x1={bx} y1={railTop} x2={bx} y2={railBottom} />
                <FilingBox x={boxX} y={railTop + 20} w={boxW} h={52} filled={count > 0} />
                {/* a quiet stack of ticks — one per item, capped for rhythm */}
                <g className="lib-stack" opacity={count ? 1 : 0.28}>
                  {Array.from({ length: Math.min(count, 8) }, (_, k) => (
                    <line key={k} x1={boxX + 8 + k * 4} y1={railBottom - 9} x2={boxX + 8 + k * 4} y2={railBottom - 4} />
                  ))}
                </g>
                <text className="lib-bay-count" x={bx + bayW / 2} y={railBottom + 22} textAnchor="middle">
                  {String(count).padStart(2, '0')}
                </text>
                <text className="lib-bay-kind" x={bx + bayW / 2} y={railBottom + 40} textAnchor="middle">
                  {t(`lib.kind.${kind}`, kindLabel(kind, lang === 'ar'))}
                </text>
              </g>
            );
          })}
          <line className="lib-draw" pathLength={1} x1={right} y1={railTop} x2={right} y2={railBottom} style={{ animationDelay: '560ms' }} />
        </g>
      </svg>
      <figcaption className="ed-mono lib-shelf-cap">
        {t('lib.shelf.hint', lang === 'ar' ? 'خانة لكل نوع · الأعداد من السجل المباشر' : 'one bay per kind · counts from the live registry')}
      </figcaption>
    </figure>
  );
}

/** One language per string — never mix Arabic and English in a single notice.
 *  v11.38 — DISTINCT causes get DISTINCT messages: a dead bridge, a malformed
 *  reply and a main-process scan failure are not the same "empty" library. */
export function libraryLoadError(err: unknown, lang: 'ar' | 'en'): string {
  const detail = String((err as Error)?.message ?? err ?? '');
  let base: string;
  if (/bridge|surnia|kdx:library|UNTRUSTED_SENDER/i.test(detail)) {
    base = lang === 'ar'
      ? 'تعذّر قراءة المكتبة — جسر التطبيق غير جاهز. أعد المحاولة.'
      : 'Could not read the library — the app bridge is not ready. Retry.';
  } else if (/invalid library response|listLibraryItems/i.test(detail)) {
    base = lang === 'ar'
      ? 'تعذّر قراءة المكتبة — ردّ غير متوقع من الخلفية. أعد المحاولة.'
      : 'Could not read the library — unexpected reply from the background. Retry.';
  } else {
    base = lang === 'ar'
      ? 'تعذّر قراءة المكتبة. تحقّق من اتصال التطبيق بالخلفية ثم أعد المحاولة.'
      : 'Could not read the library. Check the app bridge, then retry.';
  }
  return detail ? `${base} (${detail})` : base;
}

/** The IPC bridge types these as `true`, but the main process actually
 *  returns { ok, error }. Never report success on a refused mutation. */
function mutationError(res: unknown): string {
  if (res && typeof res === 'object' && (res as { ok?: unknown }).ok === false) {
    const detail = (res as { error?: unknown }).error;
    return typeof detail === 'string' && detail.trim() ? detail : 'The library refused the change.';
  }
  return '';
}

export function LibraryPanel({ embedded, initialTab }: { embedded?: boolean; initialTab?: 'files' | 'wiki' }) {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const notify = useStore((s) => s.notify);
  // v10.3 — Library is the knowledge home: generated files + the Repo Wiki
  // (one panel instead of two look-alike rails).
  const [tab, setTab] = useState<'files' | 'wiki'>(initialTab ?? 'files');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [kind, setKind] = useState<LibraryKind | 'all'>('all');
  const [q, setQ] = useState('');
  // v11.36 — a failed list is an ERROR, not a silently empty gallery.
  const [loadError, setLoadError] = useState('');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useT() is a fresh closure each render — never put it in a callback's deps
  // or the mount effect re-runs forever. Read the language through a ref.
  const langRef = useRef(lang);
  langRef.current = lang;

  const reload = useCallback(async () => {
    try {
      const l = await api.libraryList();
      if (!Array.isArray(l)) throw new Error('invalid library response');
      setItems(l);
      setLoadError('');
    } catch (err) {
      // Keep the last known list when one is present; only a first-load
      // failure leaves the panel without data. Never pretend it is empty.
      setItems((prev) => prev ?? []);
      setLoadError(libraryLoadError(err, langRef.current === 'ar' ? 'ar' : 'en'));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // v11.36 — the agent writes/downloads artifacts DURING a turn. The board
  // used to reload only on mount, so files produced after opening the rail
  // were invisible until a manual refresh. Coalesce tool/turn events into one
  // refresh so a note-less producer (browser_download) is picked up by the
  // service's real filesystem rescan right after the write lands.
  useEffect(() => {
    if (typeof api.onAgentEvent !== 'function') return;
    const schedule = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void reload(), 400);
    };
    let off: (() => void) | undefined;
    try {
      off = api.onAgentEvent((e) => {
        if (e?.type === 'tool_result' || e?.type === 'turn_end') schedule();
      });
    } catch {
      /* bridge absent — manual Refresh still works */
    }
    return () => {
      try { off?.(); } catch { /* bridge may be gone */ }
      if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null; }
    };
  }, [reload]);

  // v11.38 — rescan on EVERY open of the Files view, not just on mount. The
  // panel can be mounted on the Wiki tab (registry.tsx passes initialTab=wiki);
  // switching to Files used to show a stale/empty grid with no fresh disk scan.
  useEffect(() => {
    if (tab === 'files') void reload();
    // `reload` is a stable useCallback; only the tab transition matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const query = q.trim().toLowerCase();
    return list.filter((x) => {
      if (kind !== 'all' && x.kind !== kind) return false;
      if (query && !x.title.toLowerCase().includes(query) && !x.path.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [items, kind, q]);

  /** Real per-kind counts for the shelf centerpiece (full registry, not filtered). */
  const shelfCounts = useMemo(() => {
    const c: Record<LibraryKind, number> = { image: 0, document: 0, download: 0, export: 0, file: 0 };
    for (const x of items ?? []) {
      if (x.kind in c) c[x.kind] += 1;
    }
    return c;
  }, [items]);

  const open = async (x: LibraryItem) => {
    try {
      const ok = await api.libraryOpen(x.id);
      if (ok === false) notify(t('lib.openFailed', lang === 'ar' ? 'تعذر فتح العنصر' : 'Could not open the item'));
    } catch (err) {
      notify(`${t('lib.openFailed', lang === 'ar' ? 'تعذر فتح العنصر' : 'Could not open the item')}: ${String((err as Error)?.message ?? err)}`);
    }
  };

  /** Forget = remove the registry entry only; the file stays on disk. That
   *  distinction is stated in the confirm + success notice (honest wording). */
  const forget = async (x: LibraryItem) => {
    const label = t('lib.forget', lang === 'ar' ? 'إزالة من المكتبة' : 'Remove from library');
    if (!window.confirm(t('lib.forget.confirm', lang === 'ar'
      ? 'إزالة هذا العنصر من المكتبة؟ الملف نفسه يبقى على القرص.'
      : 'Remove this entry from the library? The file itself stays on disk.'))) return;
    try {
      const res: unknown = await api.libraryForget(x.id);
      const failure = mutationError(res);
      if (failure) throw new Error(failure);
      notify(t('lib.forget.done', lang === 'ar' ? 'أُزيل من المكتبة — الملف باقٍ على القرص' : 'Removed from the library — the file stays on disk'));
      await reload();
    } catch (err) {
      notify(`${label}: ${String((err as Error)?.message ?? err)}`);
    }
  };

  // v11.9 — Clear all (kdx:library:clear was registered but had no UI).
  // Honest confirm: this empties the library registry; the files themselves
  // stay on disk. The list refreshes right after.
  const clearAll = async () => {
    if (!items || items.length === 0) return;
    if (!window.confirm(t('lib.clearAll.confirm', lang === 'ar'
      ? 'حذف كل العناصر من المكتبة؟ الملفات نفسها تبقى على القرص ولا يمكن التراجع.'
      : 'Remove ALL entries from the library? The files themselves stay on disk. This cannot be undone.'))) return;
    try {
      const res: unknown = await api.libraryClear();
      const failure = mutationError(res);
      if (failure) throw new Error(failure);
      notify(t('lib.clearAll.done', lang === 'ar' ? 'تم تفريغ المكتبة' : 'Library cleared'));
    } catch (err) {
      notify(String((err as Error)?.message ?? err));
    }
    void reload();
  };

  return (
    <div className={`lib-art page-v14 ${embedded ? 'w-full' : 'rail-page'}`}>
      {/* ---------- editorial head (files tab; wiki brings its own) ---------- */}
      {tab === 'files' && (
      <header className="ed-head">
        <div className="ed-head-main">
          <div className="ed-head-top">
            <span className="ed-eyebrow" dir="ltr">05 / LIBRARY</span>
            <LibraryGlyph />
          </div>
          <h2 className="ed-head-title" dir="auto">
            {t('lib.title', lang === 'ar' ? 'المكتبة' : 'Library')}
          </h2>
          <p className="ed-head-desc" dir="auto">
            {lang === 'ar'
              ? 'كل صورة أو مستند أو ملف أنتجه سديم عبر الجلسات.'
              : 'Every image, document and file SADEEM has produced, across sessions.'}
          </p>
        </div>
        <div className="ed-head-actions">
          <span className="ed-mono ed-head-count" dir="ltr">
            {items ? String(filtered.length).padStart(2, '0') : '••'}
          </span>
          <button
            className="ed-icon"
            title={t('lib.clearAll', lang === 'ar' ? 'حذف الكل' : 'Clear all')}
            aria-label={t('lib.clearAll', lang === 'ar' ? 'حذف الكل' : 'Clear all')}
            disabled={!items || items.length === 0}
            onClick={() => void clearAll()}
          >
            <Trash2 size={14} aria-hidden />
          </button>
          <button
            className="ed-icon"
            title={t('lib.refresh', lang === 'ar' ? 'تحديث' : 'Refresh')}
            aria-label={t('lib.refresh', lang === 'ar' ? 'تحديث' : 'Refresh')}
            onClick={() => void reload()}
          >
            <RefreshCw size={14} aria-hidden />
          </button>
        </div>
      </header>
      )}

      {tab === 'files' && <LibraryShelf counts={shelfCounts} total={items?.length ?? 0} t={t} lang={lang} />}

      {/* v10.3 — two tabs: generated files + the Repo Wiki (merged rail) */}
      <div className="ed-seg" role="tablist" aria-label={t('lib.tabs', lang === 'ar' ? 'تبويبات المكتبة' : 'Library tabs')}>
        <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'is-active' : ''} onClick={() => setTab('files')}>
          <FileText size={12} className="inline-block align-[-2px] me-1.5" aria-hidden />
          {t('lib.tab.files', lang === 'ar' ? 'الملفات' : 'Files')}
        </button>
        <button role="tab" aria-selected={tab === 'wiki'} className={tab === 'wiki' ? 'is-active' : ''} onClick={() => setTab('wiki')}>
          <BookOpen size={12} className="inline-block align-[-2px] me-1.5" aria-hidden />
          {t('rail.wiki', lang === 'ar' ? 'ويكي المستودع' : 'Repo Wiki')}
        </button>
      </div>

      {tab === 'wiki' ? (
        <WikiPanel embedded />
      ) : (
        <>
          <div className="lib-tools">
            <div className="ed-seg ed-seg--quiet" role="tablist" aria-label={t('lib.filter', lang === 'ar' ? 'تصفية' : 'Filter')}>
              {KIND_ORDER.map((k) => (
                <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)}>
                  {t(`lib.kind.${k}`, kindLabel(k, lang === 'ar'))}
                </button>
              ))}
            </div>
            <div className="lib-search">
              <Search size={13} className="lib-search-icon" aria-hidden />
              <input
                className="ed-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('lib.search', lang === 'ar' ? 'ابحث في المكتبة…' : 'Search the library…')}
              />
            </div>
          </div>

          {loadError && (
            <div className="lib-error" role="alert" dir="auto" style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderTop: '1px solid var(--line)', color: 'var(--dim)', fontSize: 12,
            }}>
              <TriangleAlert size={13} className="shrink-0" aria-hidden />
              <span className="flex-1">{loadError}</span>
              <button className="ed-icon" title={t('lib.refresh', lang === 'ar' ? 'تحديث' : 'Refresh')}
                aria-label={t('lib.refresh', lang === 'ar' ? 'تحديث' : 'Refresh')} onClick={() => void reload()}>
                <RefreshCw size={13} aria-hidden />
              </button>
            </div>
          )}

          {items === null ? (
            <div className="ed-muted ed-body">{t('lib.loading', 'Loading…')}</div>
          ) : items.length === 0 ? (
            <div className="lib-empty">
              <LottieBox data={greetingAnim} size={92} ariaLabel="greeting" />
              <span dir="auto">
                {t(
                  'lib.empty',
                  lang === 'ar'
                    ? 'فارغة حتى الآن — كل صورة أو مستند أو ملف ينتجه سديم (أو تحمّله الوكيل) يظهر هنا تلقائيًا عبر الجلسات.'
                    : 'Empty for now — every image, document or file SADEEM produces (or the agent downloads) shows up here automatically, across sessions.',
                )}
              </span>
              <button className="ed-icon" title={t('lib.refresh', lang === 'ar' ? 'تحديث' : 'Refresh')}
                aria-label={t('lib.refresh', lang === 'ar' ? 'تحديث' : 'Refresh')} onClick={() => void reload()}>
                <RefreshCw size={13} aria-hidden />
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="lib-empty" dir="auto">
              <span>
                {t('lib.noMatch', lang === 'ar'
                  ? 'لا عناصر مطابقة لهذه التصفية أو البحث.'
                  : 'No items match this filter or search.')}
              </span>
              <button className="ed-icon" title={t('lib.filter.clear', lang === 'ar' ? 'إزالة التصفية' : 'Clear filter')}
                aria-label={t('lib.filter.clear', lang === 'ar' ? 'إزالة التصفية' : 'Clear filter')}
                onClick={() => { setKind('all'); setQ(''); }}>
                <RefreshCw size={13} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="lib-grid">
              {filtered.map((x, idx) => {
                const Icon = kindIcon(x.kind);
                return (
                  <article
                    key={x.id}
                    className={`lib-card is-${x.kind}`}
                    data-library-kind={x.kind}
                    // inline opacity guarantees a real card is visible even if
                    // the CSS mount animation never runs (hidden tab / reduced
                    // motion / static render). No file: URL — CSP-safe glyph.
                    style={{ opacity: 1, animationDelay: `${Math.min(idx, 8) * 55}ms` }}
                  >
                    <div className="lib-card-top">
                      <Icon size={15} aria-hidden />
                      <span className="ed-mono lib-kind">{t(`lib.kind.${x.kind}`, kindLabel(x.kind, lang === 'ar'))}</span>
                      <span className="flex-1" />
                      {x.size !== undefined && <span className="ed-mono lib-size" dir="ltr">{fmtSize(x.size)}</span>}
                    </div>
                    <KindThumb kind={x.kind} />
                    <div className="lib-title" dir="auto" title={x.path}>
                      {x.title}
                    </div>
                    <div className="ed-mono lib-meta" dir="ltr">
                      {fmtWhen(x.createdAt, lang === 'ar')}
                      {x.origin ? ` · ${x.origin}` : ''}
                    </div>
                    <div className="lib-actions">
                      <button className="ed-icon" title={t('lib.open', 'Open')} aria-label={t('lib.open', 'Open')} onClick={() => void open(x)}>
                        <ExternalLink size={13} aria-hidden />
                      </button>
                      <button
                        className="ed-icon"
                        title={t('lib.forget', 'Remove from library')}
                        aria-label={t('lib.forget', 'Remove from library')}
                        onClick={() => void forget(x)}
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default LibraryPanel;
