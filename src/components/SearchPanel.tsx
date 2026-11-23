// SADEEM — global workspace text search (VS Code-class).
// v14 — SEARCH IS A FULL SECTION PAGE. The Rail icon / Ctrl+Shift+F /
// palette / native menu all dispatch `surnia:open-search`; App.tsx turns
// that into rail='search', and this panel renders through RightDock as a
// full-width section (like Home) — no floating 400px overlay that
// covered the editor. The section header + close live in RightDock; here
// we keep the query/filter bar (sticky), grouped results (.fhdr + .keyrow
// grammar, active row accent wash + 2px marker) and the keyboard model.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, FileCode2, FolderOpen, Search, SearchX, X } from 'lucide-react';
import type { SearchHit } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Btn, Empty, Kbd, Spinner } from './ui';
import './workspace.css';

/** Event name used by Rail / CommandPalette to summon the search panel. */
export const OPEN_SEARCH_EVENT = 'surnia:open-search';

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const dirOf = (p: string) => {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
};

interface FileGroup {
  path: string;
  hits: SearchHit[];
}

/** Group hits by file, preserving first-seen order. */
function groupByFile(hits: SearchHit[]): FileGroup[] {
  const map = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const arr = map.get(h.path);
    if (arr) arr.push(h);
    else map.set(h.path, [h]);
  }
  return [...map.entries()].map(([path, hs]) => ({ path, hits: hs }));
}

/** One line row with the matched substring wrapped in a flat accent mark.
 *  Rendered as React nodes (never dangerouslySetInnerHTML) so the text is
 *  escaped by construction. */
function MatchLine({ text, query, caseSensitive }: { text: string; query: string; caseSensitive: boolean }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  const idx = hay.indexOf(needle);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="wsp-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function SearchPanel() {
  const t = useT();
  const wsPath = useStore((s) => s.wsPath);
  const openFile = useStore((s) => s.openFile);
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const setRail = useStore((s) => s.setRail);

  const [query, setQuery] = useState('');
  const [include, setInclude] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [raw, setRaw] = useState<SearchHit[] | null>(null); // as returned by the backend
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [lastQuery, setLastQuery] = useState('');
  const [lastInclude, setLastInclude] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0); // guards against out-of-order responses

  // Closing the section returns to the workspace page (RightDock's X and
  // the Esc handler both route through here).
  const close = useCallback(() => setRail('workspace'), [setRail]);

  // Esc: clear the query first, then close (VS Code convention). Skipped when
  // a higher-stacked overlay (palette / settings / model picker) is open so
  // Esc only dismisses the top-most surface.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const st = useStore.getState();
      if (st.paletteOpen || st.settingsOpen || st.modelPickerOpen || st.shortcutsOpen) return;
      e.preventDefault();
      if (query || raw !== null) {
        setQuery('');
        setRaw(null);
        setActive(0);
        inputRef.current?.focus();
      } else {
        close();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [query, raw, close]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !wsPath) {
      setRaw(null);
      return;
    }
    const inc = include.trim();
    setLastQuery(q);
    setLastInclude(inc);
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const hits = await api.searchFiles(wsPath, q, inc || undefined);
      if (seq !== seqRef.current) return;
      setRaw(hits);
      setActive(0);
    } catch {
      if (seq !== seqRef.current) return;
      setRaw([]);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, [query, include, wsPath]);

  // backend matches case-insensitively; "match case" refines locally so
  // toggling it never costs an extra filesystem walk
  const results = useMemo(() => {
    if (raw === null) return null;
    const q = lastQuery;
    return caseSensitive && q ? raw.filter((h) => h.text.includes(q)) : raw;
  }, [raw, caseSensitive, lastQuery]);

  // a new query / filter means Enter should re-run the search, not open a
  // stale result (VS Code convention)
  const stale =
    query.trim() !== lastQuery || include.trim() !== lastInclude || (results !== null && searching);

  const groups = useMemo(() => (results ? groupByFile(results) : []), [results]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits.map((hit) => hit)), [groups]);
  const total = results?.length ?? 0;
  const fileCount = groups.length;

  // keep the active row visible
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openHit = useCallback((path: string) => void openFile(path), [openFile]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!stale && results !== null && flat.length > 0) {
        openHit(flat[Math.min(active, flat.length - 1)].path);
      } else {
        void runSearch();
      }
    }
  };

  let flatIdx = -1;

  return (
    <section
      className="wsp-panel search-page-v13 flex flex-col min-h-0"
      role="search"
      aria-label={t('search.title', 'Search in files')}
      onKeyDown={onKeyDown}
    >
      {/* query + filters — sticky within the section's scroll body so the
          search controls stay reachable while long result lists scroll. */}
      <div
        className={`search-bar-sticky p-3 flex flex-col gap-2 shrink-0 ${searching ? 'wsp-busy' : ''}`}
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <div className="relative">
          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            value={query}
            placeholder={t('search.placeholder', 'Search text across the workspace…')}
            aria-label={t('search.placeholder', 'Search text across the workspace…')}
            className="input ps-8 pe-14 font-code !text-[12px]"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Search
            size={13}
            className="absolute top-1/2 -translate-y-1/2 text-faint pointer-events-none"
            style={{ insetInlineStart: 9 }}
          />
          <div className="absolute top-1/2 -translate-y-1/2 flex items-center gap-0.5" style={{ insetInlineEnd: 6 }}>
            {query && (
              <button
                type="button"
                className="ibtn !w-8 !h-8"
                title={t('search.clear', 'Clear')}
                aria-label={t('search.clear', 'Clear')}
                onClick={() => {
                  setQuery('');
                  setRaw(null);
                  setActive(0);
                  inputRef.current?.focus();
                }}
              >
                <X size={12} />
              </button>
            )}
            <button
              type="button"
              className={`ibtn !w-5 !h-5 ${caseSensitive ? 'is-on' : ''}`}
              title={t('search.caseSensitive', 'Match case')}
              aria-label={t('search.caseSensitive', 'Match case')}
              aria-pressed={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            >
              <CaseSensitive size={14} />
            </button>
          </div>
        </div>
        <input
          spellCheck={false}
          value={include}
          placeholder={t('search.filter', 'File filter (glob)')}
          aria-label={t('search.filter', 'File filter (glob)')}
          className="input h-7 !text-[11.5px] font-code"
          onChange={(e) => setInclude(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Btn variant="primary" className="!h-7 flex-1 !text-[11.5px]" onClick={() => void runSearch()}>
            {searching ? <Spinner size={12} /> : <Search size={12} />}
            {t('search.run', 'Search')}
          </Btn>
          {results !== null && (
            <span
              className="text-[10.5px] text-faint whitespace-nowrap tnum"
              title={t('search.results', '{n} results in {f} files')}
            >
              {t('search.results', '{n} results in {f} files')
                .replace('{n}', String(total))
                .replace('{f}', String(fileCount))}
            </span>
          )}
        </div>
      </div>

      {/* results — normal flow inside the section's scroll body (RightDock) */}
      <div ref={listRef} className="py-2" dir="ltr">
        {!wsPath ? (
          <Empty
            icon={<FolderOpen size={26} />}
            title={t('search.noWorkspace', 'No workspace open')}
            sub={t('misc.notify.noWorkspace', 'Open a folder first')}
          >
            <Btn onClick={() => void openFolderDialog()}>{t('ws.open', 'Open')}</Btn>
          </Empty>
        ) : searching ? (
          <div className="p-3 flex flex-col gap-2" aria-label={t('misc.loading', 'Loading…')}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="wsp-skel-row" />
            ))}
          </div>
        ) : results === null ? (
          <div className="px-4 py-6 text-center text-[11.5px] text-faint flex flex-col items-center gap-2">
            <SearchX size={20} />
            {t('search.hint', 'Press Enter to search · Click a result to open it')}
          </div>
        ) : total === 0 ? (
          <Empty
            icon={<SearchX size={22} />}
            title={t('search.empty', 'No results')}
            sub={t('search.hint', 'Press Enter to search · Click a result to open it')}
          />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.path}>
                <div className="fhdr h-[26px] sticky top-0 z-10">
                  <FileCode2 size={12} style={{ color: 'var(--acc2)' }} className="shrink-0" />
                  <span className="text-[11px] font-semibold truncate min-w-0" style={{ maxWidth: '45%', color: 'var(--ink)' }} title={g.path}>
                    {base(g.path)}
                  </span>
                  <span className="text-[9.5px] truncate min-w-0 flex-1 tnum" style={{ color: 'var(--faint)' }} title={dirOf(g.path)}>
                    {dirOf(g.path)}
                  </span>
                  <span className="text-[9.5px] tnum shrink-0" style={{ color: 'var(--acc2)' }} dir="ltr">
                    {String(g.hits.length).padStart(2, '0')}
                  </span>
                </div>
                {g.hits.map((hit) => {
                  flatIdx += 1;
                  const isActive = flatIdx === active;
                  return (
                    <button
                      key={`${hit.path}:${hit.line}:${flatIdx}`}
                      type="button"
                      className="keyrow relative w-full text-start !py-[3px] cursor-pointer min-w-0"
                      style={isActive ? { background: 'color-mix(in srgb, var(--acc) 10%, transparent)' } : undefined}
                      data-active={isActive || undefined}
                      title={`${hit.path}:${hit.line}`}
                      onMouseEnter={() => setActive(flatIdx)}
                      onClick={() => openHit(hit.path)}
                    >
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute inset-y-[3px]"
                          style={{ insetInlineStart: 0, width: 2, borderRadius: 1, background: 'var(--acc)' }}
                        />
                      )}
                      <Kbd className="shrink-0 tnum">{hit.line}</Kbd>
                      <span
                        className="text-[11px] tnum text-dim truncate min-w-0 font-code"
                        dir="ltr"
                        style={{ textAlign: 'left' }}
                      >
                        <MatchLine text={hit.text} query={query} caseSensitive={caseSensitive} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {total >= 500 && (
              <div className="px-3 py-2 text-[10.5px] text-warn text-center">
                {t('search.capped', 'Result limit reached — refine your query to see more')}
              </div>
            )}
          </>
        )}
      </div>

      {/* footer hint */}
      <div className="search-foot-sticky h-[30px] shrink-0 border-t border-line flex items-center gap-3 px-3 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd>
          <Kbd>↵</Kbd>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd>
        </span>
        <span className="ms-auto truncate min-w-0">
          {t('search.hint', 'Press Enter to search · Click a result to open it')}
        </span>
      </div>
    </section>
  );
}

export default SearchPanel;
