// WikiPanel — Rail view 10 (v6) · ويكي المستودع / Repo Wiki.
// A generated architecture guide for THIS workspace, stored OUTSIDE the repo
// (userData/wiki/<hash>) so it never pollutes the tree. Two-column reader:
// catalog list + page body. ZCode parity: secret-hygiene scan, auto-refresh
// detection (stale badge when code changed since generation), language
// follows the UI. Generation is one-at-a-time with visible pipeline stages.
//
// v11.12 FINAL POLISH — editorial head + an INDEXED PAGE SPREAD with aligned
// ruled lines and anchor dots.
// v11.36 (REPO WIKI DOES NOT WORK) — the panel now shows an HONEST source
// stamp. The service reads the repo's REAL Markdown docs (README/docs/*.md)
// even when no AI wiki has been generated, so the panel is never a blank
// "nothing here" while the repository already has documentation. Generation
// still upgrades to an architecture guide, and every failure is surfaced.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, TriangleAlert, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { Btn } from '../ui';
import '../workspace.css';
import './wiki-art.css';

type Stage = 'idle' | 'scan' | 'catalog' | 'pages' | 'save';

interface WikiState {
  catalog: { slug: string; title: string }[];
  pages: { slug: string; title: string; body: string }[];
  generatedAt: number;
  stale: boolean;
  /** v11.36 — where the content came from, shown honestly in the reader. */
  source?: 'generated' | 'repo-docs';
}

const STAGE_LABEL: Record<Stage, { en: string; ar: string }> = {
  idle: { en: '', ar: '' },
  scan: { en: 'Analyzing the codebase…', ar: 'تحليل الكود…' },
  catalog: { en: 'Designing the catalog…', ar: 'تصميم الفهرس…' },
  pages: { en: 'Writing the pages…', ar: 'كتابة الصفحات…' },
  save: { en: 'Saving…', ar: 'الحفظ…' },
};

/* ------------------------------------------------------------------ *
 * ORIGINAL 1px GLYPH — an open page spread with two anchor dots.
 * ------------------------------------------------------------------ */
function WikiGlyph() {
  return (
    <svg className="ed-glyph" viewBox="0 0 72 34" fill="none" stroke="currentColor"
      strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M36 7c-6-4-14-4-22-2v22c8-2 16-2 22 2 6-4 14-4 22-2V5c-8-2-16-2-22 2Z" />
      <path d="M36 7v22M20 13h10M20 18h10M42 13h10M42 18h10" opacity=".55" />
      <circle cx="25" cy="24" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="47" cy="24" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * THE INDEXED PAGE SPREAD — a catalogue leaf and the open page, with
 * aligned ruled lines, anchor dots and real catalog/page counts.
 * ------------------------------------------------------------------ */
function WikiSpread({ catalog, page, count, t, lang }: {
  catalog: { slug: string; title: string }[];
  page: { title: string; body: string } | null;
  count: number;
  t: (k: string, fb?: string) => string;
  lang: string;
}) {
  const L = (en: string, ar: string) => t(en, lang === 'ar' ? ar : en);
  const leftRows = Math.min(Math.max(catalog.length, 3), 6);
  const bodyLines = page ? page.body.split('\n').filter((l) => l.trim()).length : 0;
  const rightRows = Math.min(Math.max(bodyLines, 3), 6);
  const widths = [118, 96, 132, 84, 110, 124];

  return (
    <figure className="wiki-spread">
      <div className="wiki-spread-head">
        <span className="ed-mono">{L('wiki.spread.label', 'INDEX / PAGE SPREAD')}</span>
        <span className="ed-mono wiki-spread-count" dir="ltr">
          {String(catalog.length).padStart(2, '0')} — {String(count).padStart(2, '0')}
        </span>
      </div>
      <svg viewBox="0 0 600 196" preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={L('wiki.spread.a11y', 'Indexed page spread with aligned ruled lines')}>
        <g className="wiki-ink" fill="none" stroke="currentColor" strokeWidth="1">
          {/* two leaves + centre gutter */}
          <path className="wiki-draw" pathLength={1} d="M20 16h130v164H20z" />
          <path className="wiki-draw" pathLength={1} d="M450 16h130v164H450z" style={{ animationDelay: '120ms' }} />
          <line className="wiki-draw" pathLength={1} x1="300" y1="16" x2="300" y2="180" style={{ animationDelay: '200ms' }} />
          <path d="M294 16h12M294 180h12" opacity=".7" />
          {/* corner registration marks */}
          <path d="M12 10h16M20 8v16M572 10h16M580 8v16" opacity=".5" />
        </g>

        <g className="wiki-left">
          <text className="wiki-leaf-label" x="32" y="34">{L('wiki.spread.index', 'INDEX')}</text>
          <text className="wiki-leaf-num" x="138" y="34" textAnchor="end">{String(catalog.length).padStart(2, '0')}</text>
          {Array.from({ length: leftRows }, (_, i) => {
            const y = 56 + i * 20;
            return (
              <g key={i} className="wiki-rule-row" style={{ animationDelay: `${160 + i * 70}ms` }}>
                <text className="wiki-row-num" x="32" y={y + 3}>{String(i + 1).padStart(2, '0')}</text>
                <circle className="wiki-anchor" cx="52" cy={y} r={i === 0 ? 2.2 : 1.5} fill={i === 0 ? 'var(--acc)' : 'var(--faint)'} stroke="none" />
                <line className="wiki-ruled" x1="62" y1={y} x2={62 + widths[i % widths.length]} y2={y} />
              </g>
            );
          })}
        </g>

        <g className="wiki-right">
          <text className="wiki-leaf-label" x="462" y="34">{L('wiki.spread.page', 'PAGE')}</text>
          <text className="wiki-leaf-num" x="568" y="34" textAnchor="end">
            {page ? page.title.slice(0, 16) : '—'}
          </text>
          {Array.from({ length: rightRows }, (_, i) => {
            const y = 56 + i * 20;
            return (
              <g key={i} className="wiki-rule-row" style={{ animationDelay: `${220 + i * 70}ms` }}>
                <circle className="wiki-anchor" cx="462" cy={y} r="1.5" fill="var(--faint)" stroke="none" />
                <line className="wiki-ruled" x1="472" y1={y} x2={472 + widths[(i + 2) % widths.length]} y2={y} opacity={i === 0 ? 1 : .72} />
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption className="ed-mono wiki-spread-cap">
        {L('wiki.spread.hint', 'catalogue left · open page right · stored outside the repo')}
      </figcaption>
    </figure>
  );
}

export function WikiPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const wsPath = useStore((s) => s.wsPath);
  const notify = useStore((s) => s.notify);
  const [wiki, setWiki] = useState<WikiState | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [stageDetail, setStageDetail] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  // Real `wiki_stage` agent events drive the pipeline readout. A ref guards
  // against late events from a previous run repainting a finished panel.
  const generatingRef = useRef(false);
  useEffect(() => {
    const off = api.onAgentEvent?.((e) => {
      if (e?.type === 'wiki_stage' && generatingRef.current) {
        setStage(e.stage);
        setStageDetail(e.detail ?? '');
      }
    });
    return () => {
      try {
        off?.();
      } catch {
        /* bridge may be absent in this build */
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!wsPath) return;
    try {
      const res = await api.wikiGet(wsPath);
      const detail = (res as { error?: string }).error;
      const source = (res as { source?: 'generated' | 'repo-docs' }).source;
      if (res.wiki) {
        setWiki({
          catalog: res.wiki.catalog,
          pages: res.wiki.pages,
          generatedAt: res.wiki.generatedAt,
          stale: res.stale,
          source,
        });
        setActive((a) => a ?? res.wiki?.pages[0]?.slug ?? null);
        setLoadError('');
      } else {
        setWiki(null);
        // "No wiki yet" and "could not read the wiki" are different truths.
        setLoadError(detail ?? '');
      }
    } catch (err) {
      setWiki(null);
      setLoadError(String((err as Error)?.message ?? err));
    }
  }, [wsPath]);

  useEffect(() => {
    setWiki(null);
    setActive(null);
    setError('');
    void refresh();
  }, [refresh]);

  const generate = async () => {
    if (!wsPath) {
      notify(t('wiki.needWs', 'Open a folder first — the wiki describes THIS workspace.'));
      return;
    }
    setError('');
    setLoadError('');
    setStageDetail('');
    setStage('scan');
    generatingRef.current = true;
    try {
      const res = await api.wikiGenerate(wsPath, lang);
      if (res.ok) {
        await refresh();
        notify(
          t('wiki.generated', lang === 'ar' ? 'اكتملت الويكي — ' : 'Wiki generated — ') +
            `${res.pages ?? 0} ` + (lang === 'ar' ? 'صفحة' : 'pages'),
        );
      } else {
        const raw = res.error ?? t('wiki.genFailed', lang === 'ar' ? 'تعذّر التوليد' : 'Generation failed.');
        // Honest next step: the repo's own Markdown docs are already readable
        // without a model key, so a failed AI run is not a dead end.
        setError(
          /api[_ -]?key/i.test(raw)
            ? raw + (lang === 'ar'
              ? ' — يمكنك قراءة صفحات المستودع من ملفات Markdown مباشرة في الوقت الحالي.'
              : ' — your repo\'s Markdown docs are still readable below in the meantime.')
            : raw,
        );
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      generatingRef.current = false;
      setStage('idle');
      setStageDetail('');
    }
  };

  const page = wiki?.pages.find((p) => p.slug === active) ?? wiki?.pages[0] ?? null;
  const generating = stage !== 'idle';

  return (
    <div className={`wiki-art page-v14${embedded ? ' is-embedded' : ''}`}>
      {/* ---------- editorial head ---------- */}
      <header className="ed-head">
        <div className="ed-head-main">
          <div className="ed-head-top">
            <span className="ed-eyebrow" dir="ltr">08 / WIKI</span>
            <WikiGlyph />
          </div>
          <h2 className="ed-head-title" dir="auto">{t('rail.wiki', lang === 'ar' ? 'ويكي المستودع' : 'Repo Wiki')}</h2>
          <p className="ed-head-desc" dir="auto">
            {lang === 'ar'
              ? 'دليل معماري لمساحة العمل هذه، يُولَّد من ملفاتك الحقيقية ويُحفظ خارج المستودع.'
              : 'An architecture guide to this workspace, written from your real files and kept outside the repo.'}
          </p>
        </div>
      </header>

      {wiki && <WikiSpread catalog={wiki.catalog} page={page} count={wiki.pages.length} t={t} lang={lang} />}

      {/* Errors must be visible in EVERY state. Previously a failed first
          generation set `error` but the message rendered only in the reader
          branch, which does not exist until a wiki exists. */}
      {(error || loadError) && !generating && (
        <div className="wiki-error" dir="auto" role="alert">
          {error || loadError}
        </div>
      )}

      {!wsPath ? (
        <Empty text={t('wiki.needWs', 'Open a folder first — the wiki describes THIS workspace.')} />
      ) : generating ? (
        <div className="wiki-loading">
          <Loader2 size={24} className="wiki-spin" aria-hidden />
          <div className="wiki-title-lg" dir="auto">
            {t(`wiki.stage.${stage}`, STAGE_LABEL[stage][lang])}
          </div>
          <div className="wiki-sub" dir="auto">
            {stageDetail || t('wiki.stageHint', 'The wiki is written from your real files and stored outside the repo.')}
          </div>
        </div>
      ) : !wiki ? (
        <Empty
          text={
            loadError
              ? t('wiki.loadFailed', lang === 'ar' ? 'تعذّر قراءة الويكي لهذه المساحة' : 'Could not read the wiki for this workspace.')
              : t(
                  'wiki.empty',
                  lang === 'ar'
                    ? 'لا توجد ملفات مقروءة في هذا المجلد بعد. أضف README.md أو ملفات داخل docs/ أو ملفات كود أو package.json — ستُبنى الويكي تلقائياً منها بدون مفتاح، ويمكن للذكاء الاصطناعي تحسينها لاحقاً.'
                    : 'No readable files in this folder yet. Add a README.md, files under docs/, source code or a package.json — the wiki is built from them offline, and AI can enhance it later.',
                )
          }
        >
          <Btn variant="primary" className="!h-8 !px-3 !text-[12px]" onClick={() => void generate()}>
            <BookOpen size={13} className="shrink-0" />
            {t('wiki.generate', 'Generate the wiki')}
          </Btn>
          {loadError && (
            <Btn className="!h-8 !px-3 !text-[12px]" onClick={() => void refresh()}>
              <RefreshCw size={12} className="shrink-0" />
              {t('ws.refresh', 'Refresh')}
            </Btn>
          )}
        </Empty>
      ) : (
        <div className="wiki-reader">
          {/* toolbar */}
          <div className="wiki-toolbar">
            <span className="wiki-stamp" dir="auto">
              {new Date(wiki.generatedAt).toLocaleString(lang === 'ar' ? 'ar' : 'en-US')} · {wiki.pages.length}{' '}
              {lang === 'ar' ? 'صفحة' : 'pages'}
              {wiki.source === 'repo-docs' ? (
                <span title={t('wiki.source.docs.title', lang === 'ar' ? 'مبنية من ملفات المستودع الحقيقية — README و docs والبنية والأوامر، بدون مفتاح ذكاء اصطناعي' : 'Built from this repo\'s real README, docs, source structure and scripts — no AI key needed')}>
                  {' · '}
                  {t('wiki.source.docs', lang === 'ar' ? 'من ملفات المستودع · بدون ذكاء اصطناعي' : 'from repo docs · offline')}
                </span>
              ) : (
                <span title={t('wiki.source.generated.title', lang === 'ar' ? 'مولّدة بمساعدة النموذج من ملفات المستودع' : 'Written by the model from this repo\'s real files')}>
                  {' · '}
                  {t('wiki.source.generated', lang === 'ar' ? 'مولّدة بالذكاء الاصطناعي' : 'AI-generated')}
                </span>
              )}
            </span>
            {wiki.stale && (
              <span
                className="wiki-stale"
                title={t('wiki.staleTitle', 'Code changed since this wiki was generated')}
              >
                <TriangleAlert size={10} className="shrink-0" />
                {t('wiki.stale', 'CODE CHANGED')}
              </span>
            )}
            <Btn className="!h-7 !px-2 !text-[11px] shrink-0" onClick={() => void generate()}>
              <RefreshCw size={11} className="shrink-0" />
              {t('wiki.regenerate', 'Regenerate')}
            </Btn>
          </div>

          {/* two-column reader */}
          <div className="wiki-columns" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <nav className="wiki-catalog" aria-label={t('wiki.spread.index', 'Index')}>
              {wiki.catalog.map((c, i) => (
                <button
                  key={c.slug}
                  className={`wiki-cat-item${page?.slug === c.slug ? ' is-active' : ''}`}
                  onClick={() => setActive(c.slug)}
                  title={c.title}
                >
                  <span className="ed-mono wiki-cat-num" dir="ltr">{String(i + 1).padStart(2, '0')}</span>
                  <FileText size={12} className="shrink-0" aria-hidden />
                  <span className="wiki-cat-title">{c.title}</span>
                </button>
              ))}
            </nav>
            <div className="wiki-page-wrap" dir="auto">
              {page && (
                <div className="wiki-page md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.body}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="wiki-empty">
      <BookOpen size={24} strokeWidth={1.3} aria-hidden />
      <p dir="auto">{text}</p>
      {children}
    </div>
  );
}

export default WikiPanel;
