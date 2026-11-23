// SADEEM — "PROJECT FILES" section (stable, v11.12).
// A calm, roomy home for the real file tree: a proper section header, a
// name/extension filter, a breadcrumb of the folder being browsed, and the
// tree itself (expandable folders · file icons by extension · open / reveal /
// copy-path row actions). Rendered full-width on the Workspace page and in a
// compact drawer opened from the rail — one tree, two ways in.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  FilePlus2,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { FileNode } from '../../shared/types';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Btn, IconBtn, TextInput } from './ui';
import { FileTree } from './FileTree';
import './files.css';
import './panels/hgs-art.css';

/** Rail "Files" button → App toggles the compact project-files drawer. */
export const OPEN_FILES_EVENT = 'surnia:toggle-files';
/** ProjectFiles → Workspace page: set the (controlled) create form mode. */
export const FILES_CREATE_EVENT = 'surnia:files-create';
/** Editor breadcrumb → ProjectFiles: reveal a folder/file in the tree so a
 *  "back to workspace" navigation never loses the user's place. */
export const REVEAL_FILE_EVENT = 'surnia:files-reveal';

interface ProjectFilesProps {
  /** Compact form used inside the rail drawer (tighter head, no card chrome). */
  compact?: boolean;
  /** Controlled create form (driven by the Workspace page header actions). */
  createMode?: 'file' | 'dir' | null;
  createName?: string;
  setCreateName?: (v: string) => void;
  commitCreate?: () => void;
  resetCreate?: () => void;
  /** Called after a file is opened (lets the drawer close itself). */
  onOpened?: () => void;
}

function countTree(node: FileNode | null): { files: number; dirs: number } {
  const out = { files: 0, dirs: 0 };
  if (!node) return out;
  const walk = (n: FileNode): void => {
    if (out.files + out.dirs > 4000) return;
    if (n.type === 'dir') {
      out.dirs++;
      for (const c of n.children ?? []) walk(c);
    } else out.files++;
  };
  for (const c of node.children ?? []) walk(c);
  return out;
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

/**
 * An original engraving-style folder/document mark for the section header —
 * ink hairlines drawn with strokes, a pair of hatch marks and a registration
 * dot. Not an icon-font glyph; it belongs to the drafting-table identity.
 */
function EngravedFolderGlyph() {
  return (
    <svg className="pf-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 6.5h6l1.7 2h11.3v10.6H2.5z" />
      <path d="M2.5 9.4h19" />
      {/* hatched spine — the drafting-table register along the folder's binding */}
      <g className="hgs-pf-spine"><path d="M3.2 13 5.4 10.8M3.2 16 6 13.2M3.2 19 6 16.2" /></g>
      <path d="M5.4 13.2h7.2M5.4 15.8h5.1" opacity=".55" />
      <circle cx="18" cy="15.2" r="1.35" opacity=".85" />
    </svg>
  );
}

export function ProjectFiles({
  compact = false,
  createMode = null,
  createName = '',
  setCreateName,
  commitCreate,
  resetCreate,
  onOpened,
}: ProjectFilesProps) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const wsPath = useStore((s) => s.wsPath);
  const fileTree = useStore((s) => s.fileTree);
  const treeLoading = useStore((s) => s.treeLoading);
  const refreshTree = useStore((s) => s.refreshTree);
  const openFile = useStore((s) => s.openFile);
  const createEntry = useStore((s) => s.createEntry);

  const [filter, setFilter] = useState('');
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  const filterRef = useRef<HTMLDivElement>(null);

  // The "/" key hint shown inside the filter is now a real shortcut: focus the
  // name filter when the user is not already typing. Guarded so it can never
  // steal a keystroke from the composer, an inline rename, or any other input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      )
        return;
      const input = filterRef.current?.querySelector('input');
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The create form is controlled on the Workspace page and self-contained
  // in the rail drawer. Uncontrolled state keeps the drawer useful on its own.
  const controlled = typeof setCreateName === 'function';
  const [localMode, setLocalMode] = useState<'file' | 'dir' | null>(null);
  const [localName, setLocalName] = useState('');
  const mode = controlled ? createMode : localMode;
  const name = controlled ? createName : localName;
  const setName = controlled ? setCreateName! : setLocalName;

  // Reset the browsed folder whenever the workspace changes.
  useEffect(() => {
    setCurrentDir(null);
    setRevealPath(null);
    setFilter('');
    setTreeKey((k) => k + 1);
  }, [wsPath]);

  const counts = useMemo(() => countTree(fileTree), [fileTree]);

  // Breadcrumb segments between the workspace root and the browsed folder.
  const crumbs = useMemo(() => {
    if (!currentDir || !wsPath || !currentDir.startsWith(wsPath)) return [];
    const rel = currentDir.slice(wsPath.length).replace(/^[\\/]+/, '');
    return rel
      .split(/[\\/]/)
      .filter(Boolean)
      .map((seg, i, arr) => ({
        seg,
        path: `${wsPath}/${arr.slice(0, i + 1).join('/')}`,
      }));
  }, [currentDir, wsPath]);

  const handleActiveDir = useCallback((p: string | null) => setCurrentDir(p), []);

  const handleOpenPath = useCallback((p: string) => {
    void openFile(p);
    onOpened?.();
  }, [openFile, onOpened]);

  const gotoCrumb = (p: string) => {
    setCurrentDir(p);
    // Force a fresh reveal even when the same crumb is clicked twice.
    setRevealPath('');
    requestAnimationFrame(() => setRevealPath(p));
  };

  const gotoRoot = () => {
    setCurrentDir(null);
    setRevealPath(null);
    setTreeKey((k) => k + 1); // back to the default (top-level) expansion
  };

  // v11.31 — the editor breadcrumb (and any other surface) can ask us to
  // reveal a path. Fold it through the same reveal machinery as a crumb click
  // so the browsed folder, the highlight and the scroll target stay in sync.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const p = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!p || typeof p !== 'string') return;
      setCurrentDir(p);
      setRevealPath('');
      requestAnimationFrame(() => setRevealPath(p));
    };
    window.addEventListener(REVEAL_FILE_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_FILE_EVENT, onReveal);
  }, []);

  const beginCreate = (m: 'file' | 'dir') => {
    if (controlled) {
      // v11.31 — carry the BROWSED folder with the request. Without `dir` the
      // Workspace page always created at the workspace root even when the
      // user had navigated into a subfolder (a real wrong-path bug).
      window.dispatchEvent(new CustomEvent(FILES_CREATE_EVENT, { detail: { mode: m, dir: currentDir ?? wsPath } }));
    } else {
      setLocalMode(m);
      setLocalName('');
    }
  };

  const commit = () => {
    // Clear the name filter so a freshly created entry can never be hidden by
    // a stale filter (it would look like the Create button did nothing).
    setFilter('');
    if (controlled) {
      commitCreate?.();
      return;
    }
    const trimmed = name.trim();
    if (!mode || !trimmed || !wsPath) return;
    void createEntry(mode, currentDir ?? wsPath, trimmed);
    setLocalMode(null);
    setLocalName('');
  };

  const reset = () => {
    if (controlled) resetCreate?.();
    else {
      setLocalMode(null);
      setLocalName('');
    }
  };

  return (
    <div className={`pf-root pf-stagger${compact ? ' is-compact' : ' aurora-panel'}`}>
      {/* ONE editorial row: engraved mark + title + count + name filter + actions.
          The count/filter/actions share a single row so nothing stacks into the
          stat strip above. Every group can shrink; the icon actions never do. */}
      <div className="pf-head">
        <div className="pf-heading">
          <span className="pf-head-icon" aria-hidden>
            <EngravedFolderGlyph />
          </span>
          <span className="pf-head-copy">
            <span className="pf-title">{lang === 'ar' ? 'ملفات المشروع' : t('pf.title', 'Project files')}</span>
          </span>
          <span className="pf-count tnum" dir="ltr">
            {lang === 'ar'
              ? `${counts.files} ملف · ${counts.dirs} مجلد`
              : `${counts.files} files · ${counts.dirs} folders`}
          </span>
        </div>

        <div className="pf-filter pf-head-filter" ref={filterRef}>
          <Search size={13} className="pf-filter-icon" aria-hidden />
          <TextInput
            value={filter}
            placeholder={t('pf.filter', 'Filter files by name…')}
            className="pf-filter-input"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('');
            }}
          />
          {filter ? (
            <button className="pf-filter-clear" title={t('search.clear', 'Clear')} aria-label={t('search.clear', 'Clear')} onClick={() => setFilter('')}>
              <X size={12} />
            </button>
          ) : (
            <span className="pf-filter-hint" aria-hidden>
              /
            </span>
          )}
        </div>

        <div className="pf-actions ws-actions-cluster">
          <IconBtn
            className="!w-6 !h-6"
            title={t('ws.newFile', 'New file')}
            aria-label={t('ws.newFile', 'New file')}
            onClick={() => beginCreate('file')}
          >
            <FilePlus2 size={13} />
          </IconBtn>
          <IconBtn
            className="!w-6 !h-6"
            title={t('ws.newFolder', 'New folder')}
            aria-label={t('ws.newFolder', 'New folder')}
            onClick={() => beginCreate('dir')}
          >
            <FolderPlus size={13} />
          </IconBtn>
          <IconBtn
            className="!w-6 !h-6"
            title={t('ws.refresh', 'Refresh')}
            aria-label={t('ws.refresh', 'Refresh')}
            onClick={() => void refreshTree()}
          >
            <RefreshCw size={13} className={treeLoading ? 'spin' : undefined} />
          </IconBtn>
        </div>
      </div>

      {/* a hairline that draws itself on mount — a quiet drafting gesture */}
      <span className="pf-draw-rule" aria-hidden />

      {/* breadcrumb of the folder currently being browsed */}
      <div className="pf-breadcrumb" role="navigation" aria-label={t('pf.breadcrumb', 'Current folder')}>
        <button
          className="pf-crumb pf-crumb-root"
          onClick={gotoRoot}
          title={wsPath ?? ''}
          aria-current={crumbs.length === 0 ? 'page' : undefined}
        >
          <Folder size={12} aria-hidden />
          <span className="truncate max-w-[20ch]">{wsPath ? base(wsPath) : t('ws.noWorkspace', 'No folder open')}</span>
        </button>
        {crumbs.map((c, i) => (
          <span key={c.path} className="pf-crumb-sep">
            <ChevronRight size={11} className="flip-rtl" aria-hidden />
            <button
              className="pf-crumb"
              onClick={() => gotoCrumb(c.path)}
              title={c.path}
              dir="ltr"
              aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              style={{ maxWidth: '22ch' }}
            >
              {c.seg}
            </button>
          </span>
        ))}
      </div>

      {/* inline create form (page-controlled or drawer-local) */}
      {mode && (
        <div className="pf-create">
          <TextInput
            autoFocus
            value={name}
            placeholder={t('ws.name', 'Name')}
            className="pf-create-input"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                reset();
              }
            }}
          />
          <Btn variant="primary" className="pf-create-btn" onClick={commit}>
            {t('ws.create', 'Create')}
          </Btn>
          <IconBtn className="!w-6 !h-6" title={t('ws.cancel', 'Cancel')} onClick={reset}>
            <X size={12} />
          </IconBtn>
        </div>
      )}

      {/* the tree */}
      <div className="pf-tree-wrap">
        {treeLoading && !fileTree ? (
          <div className="pf-skel" aria-label={t('misc.loading', 'Loading…')}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="pf-skel-row skeleton-shimmer" />
            ))}
          </div>
        ) : (
          <FileTree
            key={treeKey}
            root={wsPath}
            filter={filter}
            onActiveDirChange={handleActiveDir}
            revealPath={revealPath}
            onOpenPath={handleOpenPath}
          />
        )}
      </div>

      {/* quiet footer hint — a calm caption, never a floating tooltip */}
      <div className="pf-foot">
        <span className="pf-foot-note">
          <i className="pf-foot-dot" aria-hidden />
          {t('pf.hint', 'Click a file to open it in the editor — you can always return here.')}
        </span>
        {lang === 'ar' && <span className="pf-rtl-note" aria-hidden>{'المجلد الحالي'}</span>}
      </div>
    </div>
  );
}

export default ProjectFiles;
