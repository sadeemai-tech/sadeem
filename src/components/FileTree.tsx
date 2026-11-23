// SADEEM — workspace file tree: recursive nodes, inline rename/create/delete.
// A3 visual contract: lucide filetype icons, git letter badges (M/A/D/U) so
// status is never color-only, hairline indent guides, --bg5 selected row with
// a teal start-edge indicator, dir=ltr on every path, title tooltips.
//
// v11.12 "PROJECT FILES" contract — the tree now also supports:
//   · filter        — a name/extension filter that keeps matching ancestors
//   · onActiveDirChange — reports the browsed folder for a breadcrumb
//   · revealPath    — expands ancestors + scrolls/highlights a row
//   · row actions   — open · reveal in tree · copy path (in addition to the
//                     existing create / rename / delete actions).
// All new props are OPTIONAL: every legacy <FileTree root=… /> call is unchanged.
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  ChevronRight,
  Copy,
  Crosshair,
  Database,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileCode,
  FileCode2,
  FileCog,
  FileImage,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Palette,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FileNode } from '../../shared/types';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Btn } from './ui';
import './workspace.css';

// row action buttons (rename/create/delete) — quiet until hover
const ACT =
  'pf-act p-0.5 rounded-[6px] text-faint hover:text-[var(--ink)] hover:bg-[var(--hover-2)] transition-colors shrink-0';

// keyboard focus ring for tree rows (divs, not buttons — global rule covers buttons)
const ROW_FOCUS = 'row-focus focus:outline-none';

interface IconSpec {
  Icon: LucideIcon;
  cls: string;
}

/**
 * File-type icon by extension. Shape carries the family, the token class
 * carries the family colour — status still reads through the M/A/D badge,
 * never through colour alone. Kept deliberately flat (no per-file chrome).
 */
function fileIconFor(name: string): IconSpec {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const lower = name.toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return { Icon: FileCode2, cls: 'text-acc' };
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return { Icon: FileCode, cls: 'text-acc2' };
  if (ext === 'json' || ext === 'jsonc') return { Icon: Braces, cls: 'text-warn' };
  if (ext === 'html' || ext === 'htm' || ext === 'xml') return { Icon: FileType2, cls: 'text-warn' };
  if (ext === 'css' || ext === 'scss' || ext === 'less' || ext === 'sass' || ext === 'styl')
    return { Icon: Palette, cls: 'text-acc2' };
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return { Icon: FileText, cls: 'text-dim' };
  if (ext === 'sql' || ext === 'db' || ext === 'sqlite' || ext === 'sqlite3') return { Icon: Database, cls: 'text-acc2' };
  if (ext === 'py') return { Icon: FileCode, cls: 'text-ok' };
  if (ext === 'rb' || ext === 'php' || ext === 'swift' || ext === 'dart' || ext === 'lua' || ext === 'pl' || ext === 'r')
    return { Icon: FileCode, cls: 'text-ok' };
  if (ext === 'rs' || ext === 'go' || ext === 'java' || ext === 'kt' || ext === 'c' || ext === 'cpp' || ext === 'cc' || ext === 'h' || ext === 'hpp')
    return { Icon: FileCode2, cls: 'text-ok' };
  if (
    lower.startsWith('.env') ||
    ext === 'yml' ||
    ext === 'yaml' ||
    ext === 'toml' ||
    ext === 'ini' ||
    ext === 'conf' ||
    lower === 'dockerfile' ||
    lower === 'makefile' ||
    lower === '.gitignore' ||
    lower === '.editorconfig'
  )
    return { Icon: FileCog, cls: 'text-dim' };
  // SVG is a vector image (matches the editor tab icon) — not a markup file.
  if (
    ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' ||
    ext === 'svg' || ext === 'webp' || ext === 'ico' || ext === 'bmp' || ext === 'avif'
  )
    return { Icon: FileImage, cls: 'text-ok' };
  // shell / batch scripts get the cog family, with a warn tone so they read as
  // executable rather than as configuration data.
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || ext === 'fish' || ext === 'ps1' || ext === 'bat' || ext === 'cmd')
    return { Icon: FileCog, cls: 'text-warn' };
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'flac') return { Icon: FileAudio, cls: 'text-ok' };
  if (ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'mkv') return { Icon: FileVideo, cls: 'text-ok' };
  if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === '7z' || ext === 'rar') return { Icon: FileArchive, cls: 'text-warn' };
  if (ext === 'csv' || ext === 'xls' || ext === 'xlsx') return { Icon: FileSpreadsheet, cls: 'text-ok' };
  if (ext === 'pdf') return { Icon: FileText, cls: 'text-warn' };
  if (ext === 'lock' || ext === 'log' || ext === 'env') return { Icon: FileCog, cls: 'text-faint' };
  return { Icon: FileText, cls: 'text-faint' };
}

function relPath(p: string, root?: string): string {
  if (root && p.startsWith(root)) {
    const rel = p.slice(root.length).replace(/^[\\/]+/, '');
    if (rel) return rel;
  }
  return p;
}

/** Parent path (slash-separated) of an absolute node path. */
function parentOf(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

/** Keep nodes whose name matches, plus every ancestor of a match. */
function pruneTree(node: FileNode, q: string): FileNode | null {
  if (node.type === 'file') return node.name.toLowerCase().includes(q) ? node : null;
  const children = (node.children ?? [])
    .map((c) => pruneTree(c, q))
    .filter((x): x is FileNode => x !== null);
  if (children.length > 0) return { ...node, children };
  return node.name.toLowerCase().includes(q) ? { ...node, children: [] } : null;
}

/** All directory paths below a node (used to reveal filtered matches).
 *  FIX v11.31: the original walker recursed but never recorded `n.path`, so
 *  filtering returned an EMPTY expansion set — every nested match stayed
 *  collapsed and the filter looked dead. Record each dir before descending. */
function allDirPaths(node: FileNode, out: string[] = []): string[] {
  if (node.type === 'dir') {
    out.push(node.path);
    for (const c of node.children ?? []) allDirPaths(c, out);
  }
  return out;
}

// ---------- git letter badges (status is letter + tone, never color-only) ----------
/** Working-tree status → tree badge (letter, tone class, label). */
function gitBadgeFor(status: string, t: (k: string, fb: string) => string): { letter: string; cls: string; label: string } {
  if (status.startsWith('M')) return { letter: 'M', cls: 'ft-badge-warn', label: t('ws.stModified', 'Modified') };
  if (status.startsWith('A')) return { letter: 'A', cls: 'ft-badge-ok', label: t('ws.stAdded', 'Added') };
  if (status.startsWith('D')) return { letter: 'D', cls: 'ft-badge-bad', label: t('ws.stDeleted', 'Deleted') };
  if (status.startsWith('R')) return { letter: 'R', cls: 'ft-badge-info', label: t('ws.stRenamed', 'Renamed') };
  return { letter: 'U', cls: 'ft-badge-info', label: t('ws.stUntracked', 'Untracked') };
}

// ---------- architectural empty state ----------
// A quiet framed plate with corner ticks + a faint drafting grid: it reads as
// an intentional empty instrument, not a decorative "sad" illustration.
function TreeEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ft-empty" role="status">
      <div className="ft-empty-art" aria-hidden>
        <i className="ft-empty-corner ft-empty-corner-a" />
        <i className="ft-empty-corner ft-empty-corner-b" />
        <i className="ft-empty-corner ft-empty-corner-c" />
        <i className="ft-empty-corner ft-empty-corner-d" />
        <span className="ft-empty-grid" />
        <span className="ft-empty-glyph">{icon}</span>
      </div>
      <div className="ft-empty-title">{title}</div>
      <div className="ft-empty-hint">{hint}</div>
      {action && <div className="ft-empty-action">{action}</div>}
    </div>
  );
}

// ---------- inline rename / create input ----------
function InlineInput({
  initial,
  selectAll,
  commitOnBlur,
  onCommit,
  onCancel,
}: {
  initial: string;
  selectAll?: boolean;
  commitOnBlur?: boolean;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const commit = () => {
    const val = v.trim();
    if (val) onCommit(val);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (commitOnBlur) commit();
        else onCancel();
      }}
      ref={(el) => {
        if (!el) return;
        el.focus();
        if (selectAll) el.select();
      }}
      className="input !h-[22px] !min-h-0 !py-0 !px-1.5 !text-[12px] font-code min-w-0 flex-1 !rounded-[6px]"
    />
  );
}

// ---------- shared tree ui-state (store actions are pulled per node) ----------
interface TreeCtxValue {
  expanded: Set<string>;
  toggleDir: (p: string) => void;
  /** v11.31 — add to the expansion set without risking a collapse. */
  expandDir: (p: string) => void;
  activeDir: string | null;
  setActiveDir: (p: string | null) => void;
  renamingPath: string | null;
  beginRename: (p: string) => void;
  endRename: () => void;
  creatingIn: string | null;
  /** v11.31 — inline create can now make a folder as well as a file. */
  createKind: 'file' | 'dir';
  beginCreate: (dir: string, kind?: 'file' | 'dir') => void;
  endCreate: () => void;
  root?: string;
  /** Working-tree status per workspace-relative path (git letter badges). */
  gitStatus: Map<string, string>;
  /** Roving-tabindex path: the one focused tree row (null → first row). */
  roving: string | null;
  setRoving: (p: string | null) => void;
  firstVisiblePath: string | null;
  /* --- PROJECT FILES additions (all optional at the public API) --- */
  onActiveDirChange?: (p: string | null) => void;
  onOpenPath?: (p: string) => void;
  reveal: (p: string) => void;
  revealHighlight: string | null;
}

const TreeCtx = createContext<TreeCtxValue | null>(null);

// ---- tree keyboard navigation helpers (roving tabindex) ----
function visibleTreeItems(row: HTMLElement): HTMLElement[] {
  const tree = row.closest('[role="tree"]');
  if (!tree) return [];
  return Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
}

function moveTreeFocus(row: HTMLElement, delta: 1 | -1, setRoving: (p: string | null) => void): void {
  const items = visibleTreeItems(row);
  const idx = items.indexOf(row);
  const next = items[idx + delta];
  if (!next) return;
  next.focus();
  setRoving(next.getAttribute('data-path'));
}

/** Collapse-on-Left on a leaf/closed row → jump to the parent directory row. */
function focusParentRow(row: HTMLElement, setRoving: (p: string | null) => void): void {
  const items = visibleTreeItems(row);
  const idx = items.indexOf(row);
  const level = Number(row.getAttribute('aria-level') ?? '1');
  for (let i = idx - 1; i >= 0; i--) {
    if (Number(items[i].getAttribute('aria-level') ?? '1') < level) {
      items[i].focus();
      setRoving(items[i].getAttribute('data-path'));
      return;
    }
  }
}

// indent guides: 1px verticals at every nesting level (SURVEYOR drafting grid)
const indentStep = 14;
const GUIDE_BASE = 8;

function IndentGuides({ depth, branch = false }: { depth: number; branch?: boolean }) {
  if (depth <= 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <i
          key={i}
          className="ft-guide"
          style={{
            insetInlineStart: GUIDE_BASE + i * indentStep,
            // v11.31 — precision inline CSS (no stylesheet edits): the guide
            // at an expanded folder's own indent becomes a half-height branch
            // elbow that visually connects the folder to its children.
            ...(branch && i === depth - 1
              ? { top: '50%', bottom: 'auto', height: 'calc(50% - 4px)' }
              : {}),
          }}
          aria-hidden
        />
      ))}
    </>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const t = useT();
  const c = React.useContext(TreeCtx);
  const activeTab = useStore((s) => s.activeTab);
  const openFile = useStore((s) => s.openFile);
  const createEntry = useStore((s) => s.createEntry);
  const deleteEntry = useStore((s) => s.deleteEntry);
  const renameEntry = useStore((s) => s.renameEntry);
  const notify = useStore((s) => s.notify);
  if (!c) return null;

  const isDir = node.type === 'dir';
  const isExpanded = isDir && c.expanded.has(node.path);
  const isActiveFile = !isDir && activeTab === node.path;
  const isRenaming = c.renamingPath === node.path;
  const display = relPath(node.path, c.root);
  const fi = fileIconFor(node.name);
  // git letter badge: workspace-relative path → M / A / D / U stamp
  const badge = !isDir && !isRenaming && c.gitStatus.size > 0 && c.gitStatus.has(display)
    ? gitBadgeFor(c.gitStatus.get(display) as string, t)
    : null;
  // roving tabindex: exactly one row is tabbable
  const rowTabIndex = c.roving === node.path || (c.roving === null && node.path === c.firstVisiblePath) ? 0 : -1;

  const onRowFocus = () => c.setRoving(node.path);

  const openPath = (p: string) => {
    if (c.onOpenPath) c.onOpenPath(p);
    else void openFile(p);
  };

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    const done = () => notify(t('pf.copied', 'Path copied to clipboard'));
    const fail = () => notify(node.path);
    try {
      const p = navigator.clipboard?.writeText(node.path);
      if (p) void p.then(done).catch(fail);
      else fail();
    } catch {
      fail();
    }
  };

  const onTreeNav = (e: React.KeyboardEvent<HTMLElement>) => {
    if (isRenaming) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveTreeFocus(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1, c.setRoving);
    } else if (e.key === 'ArrowRight' && isDir) {
      e.preventDefault();
      if (!isExpanded) {
        c.toggleDir(node.path);
        c.setActiveDir(node.path);
        c.onActiveDirChange?.(node.path);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isDir && isExpanded) {
        c.toggleDir(node.path);
      } else {
        focusParentRow(e.currentTarget, c.setRoving);
      }
    }
  };

  const onDelete = () => {
    if (window.confirm(t('ws.confirmDelete'))) void deleteEntry(node.path);
  };

  const rowBase =
    'tree-row group flex items-center gap-1.5 row-hover cursor-pointer w-full text-start';

  const revealed = c.revealHighlight === node.path ? ' is-revealed' : '';

  const commitRename = (v: string) => {
    void renameEntry(node.path, v);
    // v11.31 — expansion is keyed by path; after a rename the old key is dead.
    // Pre-seed the new path so a renamed folder stays open instead of
    // snapping shut (lost navigation).
    const parent = node.path.split(/[\\/]/).slice(0, -1).join('/');
    if (parent) c.expandDir(`${parent}/${v}`);
    c.endRename();
  };

  if (isDir) {
    return (
      <div>
        <div
          className={`${rowBase} ${ROW_FOCUS}${revealed} ${
            c.activeDir === node.path && !isRenaming ? 'is-active' : ''
          }`}
          style={{ paddingInlineStart: depth * indentStep + GUIDE_BASE }}
          role="treeitem"
          aria-expanded={isExpanded}
          aria-level={depth + 1}
          aria-selected={c.activeDir === node.path}
          data-path={node.path}
          tabIndex={rowTabIndex}
          title={node.path}
          onFocus={onRowFocus}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (isRenaming) return;
              e.preventDefault();
              c.toggleDir(node.path);
              c.setActiveDir(node.path);
              c.onActiveDirChange?.(node.path);
              return;
            }
            onTreeNav(e);
          }}
          onClick={() => {
            if (isRenaming) return;
            c.toggleDir(node.path);
            c.setActiveDir(node.path);
            c.onActiveDirChange?.(node.path);
          }}
        >
          <IndentGuides depth={depth} branch={isExpanded} />
          <ChevronRight
            size={13}
            className={`chev shrink-0 text-faint ${isExpanded ? 'is-open' : ''}`}
          />
          {isExpanded ? (
            <FolderOpen size={13} className="shrink-0 text-acc2" />
          ) : (
            <Folder size={13} className="shrink-0 text-acc2" />
          )}
          {isRenaming ? (
            <InlineInput initial={node.name} selectAll commitOnBlur onCommit={commitRename} onCancel={c.endRename} />
          ) : (
            <span className="text-[13px] truncate flex-1 min-w-0" dir="ltr">{display}</span>
          )}
          {!isRenaming && (
            <div className="pf-acts opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pe-1">
              <button
                title={t('pf.copyPath', 'Copy path')}
                aria-label={t('pf.copyPath', 'Copy path')}
                className={ACT}
                onClick={copyPath}
              >
                <Copy size={13} />
              </button>
              <button
                title={t('pf.reveal', 'Reveal in tree')}
                aria-label={t('pf.reveal', 'Reveal in tree')}
                className={ACT}
                onClick={(e) => {
                  e.stopPropagation();
                  c.reveal(node.path);
                }}
              >
                <Crosshair size={13} />
              </button>
              <button
                title={t('ws.newFile')}
                aria-label={t('ws.newFile', 'New file')}
                className={ACT}
                onClick={(e) => {
                  e.stopPropagation();
                  c.beginCreate(node.path, 'file');
                }}
              >
                <FilePlus size={13} />
              </button>
              <button
                title={t('ws.newFolder')}
                aria-label={t('ws.newFolder', 'New folder')}
                className={ACT}
                onClick={(e) => {
                  e.stopPropagation();
                  c.beginCreate(node.path, 'dir');
                }}
              >
                <FolderPlus size={13} />
              </button>
              <button
                title={t('ws.rename')}
                aria-label={t('ws.rename', 'Rename')}
                className={ACT}
                onClick={(e) => {
                  e.stopPropagation();
                  c.beginRename(node.path);
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                title={t('ws.delete')}
                aria-label={t('ws.delete', 'Delete')}
                className={ACT}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        {c.creatingIn === node.path && (
          <div
            className="h-[28px] flex items-center gap-1.5 pe-1"
            style={{ paddingInlineStart: (depth + 1) * indentStep + GUIDE_BASE }}
          >
            {c.createKind === 'dir' ? (
              <FolderPlus size={13} className="shrink-0 text-faint" />
            ) : (
              <FilePlus size={13} className="shrink-0 text-faint" />
            )}
            <InlineInput
              initial=""
              onCommit={(v) => {
                // v11.31 — honour the chosen kind AND ensure a fresh dir is
                // expanded so its contents appear instead of looking empty.
                if (c.createKind === 'dir') c.expandDir(node.path);
                void createEntry(c.createKind, node.path, v);
                c.endCreate();
              }}
              onCancel={c.endCreate}
            />
          </div>
        )}
        {isExpanded && (
          /* an explicit ARIA group keeps child rows attached to their folder
             for screen readers without changing the flat keyboard order */
          <div role="group">
            {(node.children ?? []).map((ch) => <TreeNode key={ch.path} node={ch} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${rowBase} ${ROW_FOCUS}${revealed} ${
        isActiveFile && !isRenaming ? 'is-active' : ''
      }`}
      style={{ paddingInlineStart: depth * indentStep + GUIDE_BASE }}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isActiveFile}
      data-path={node.path}
      tabIndex={rowTabIndex}
      title={node.path}
      onFocus={onRowFocus}
      onKeyDown={(e) => {
        if (isRenaming) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          c.endCreate();
          c.onActiveDirChange?.(parentOf(node.path));
          openPath(node.path);
          return;
        }
        onTreeNav(e);
      }}
      onClick={() => {
        if (isRenaming) return;
        c.endCreate();
        c.onActiveDirChange?.(parentOf(node.path));
        openPath(node.path);
      }}
    >
      <IndentGuides depth={depth} />
      <fi.Icon size={13} className={`shrink-0 ${fi.cls}`} />
      {isRenaming ? (
        <InlineInput initial={node.name} selectAll commitOnBlur onCommit={commitRename} onCancel={c.endRename} />
      ) : (
        <span
          className={`text-[13px] truncate flex-1 min-w-0 ${isActiveFile ? 'text-acc font-medium' : ''}`}
          dir="ltr"
        >
          {display}
        </span>
      )}
      {badge && (
        <span className={`ft-badge shrink-0 ${badge.cls}`} title={badge.label} aria-label={badge.label}>
          {badge.letter}
        </span>
      )}
      {!isRenaming && (
        <div className="pf-acts opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pe-1">
          <button
            title={t('pf.open', 'Open file')}
            aria-label={t('pf.open', 'Open file')}
            className={ACT}
            onClick={(e) => {
              e.stopPropagation();
              openPath(node.path);
            }}
          >
            <ExternalLink size={13} />
          </button>
          <button
            title={t('pf.copyPath', 'Copy path')}
            aria-label={t('pf.copyPath', 'Copy path')}
            className={ACT}
            onClick={copyPath}
          >
            <Copy size={13} />
          </button>
          <button
            title={t('pf.reveal', 'Reveal in tree')}
            aria-label={t('pf.reveal', 'Reveal in tree')}
            className={ACT}
            onClick={(e) => {
              e.stopPropagation();
              c.reveal(node.path);
            }}
          >
            <Crosshair size={13} />
          </button>
          <button
            title={t('ws.rename')}
            aria-label={t('ws.rename', 'Rename')}
            className={ACT}
            onClick={(e) => {
              e.stopPropagation();
              c.beginRename(node.path);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            title={t('ws.delete')}
            aria-label={t('ws.delete', 'Delete')}
            className={ACT}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- public component ----------
export interface FileTreeProps {
  root?: string;
  /** Optional name filter — matches keep their ancestors visible. */
  filter?: string;
  /** Called whenever the browsed (expanded/clicked) folder changes. */
  onActiveDirChange?: (p: string | null) => void;
  /** When changed, expands ancestors + scrolls/highlights the row. */
  revealPath?: string | null;
  /** Override the default openFile(path) behaviour. */
  onOpenPath?: (p: string) => void;
}

export function FileTree({ root, filter = '', onActiveDirChange, revealPath, onOpenPath }: FileTreeProps) {
  const t = useT();
  const fileTree = useStore((s) => s.fileTree);
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const git = useStore((s) => s.git);
  // workspace-relative path → working-tree status (drives the M/A/D badges)
  const gitStatus = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of git?.changed ?? []) m.set(c.path, c.status);
    return m;
  }, [git]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<'file' | 'dir'>('file');
  const [roving, setRoving] = useState<string | null>(null);
  const [localReveal, setLocalReveal] = useState<string | null>(null);
  const seededFor = useRef<string | null>(null);

  const q = filter.trim().toLowerCase();

  // filtered view — keeping ancestors of matches means the hierarchy stays
  // legible instead of flattening into an unreadable result list.
  const visibleTree = useMemo<FileNode | null>(() => {
    if (!fileTree) return null;
    if (!q) return fileTree;
    const pruned = pruneTree(fileTree, q);
    return pruned ?? { ...fileTree, children: [] };
  }, [fileTree, q]);

  // expand depth-0 directories by default (re-seed per workspace root / filter)
  useEffect(() => {
    if (!visibleTree) return;
    const key = `${visibleTree.path}|${q}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    if (q) {
      setExpanded(new Set(allDirPaths(visibleTree)));
    } else {
      setExpanded(new Set((visibleTree.children ?? []).filter((n) => n.type === 'dir').map((n) => n.path)));
    }
  }, [visibleTree, q]);

  // v11.31 — a Crosshair "reveal" sets localReveal; the previous
  // `localReveal ?? revealPath` meant that sticky local value shadowed every
  // LATER external reveal (breadcrumb click, editor breadcrumb, open-session
  // jump). Mirror the prop into the local slot so external navigation always
  // wins the moment it changes — navigation is never silently lost.
  useEffect(() => {
    if (revealPath) setLocalReveal(revealPath);
  }, [revealPath]);

  // reveal: expand path ancestors, update breadcrumb target, scroll into view
  const target = localReveal ?? revealPath ?? null;
  useEffect(() => {
    if (!target || !visibleTree) return;
    const ancestors = new Set<string>();
    let targetIsDir = false;
    const walk = (n: FileNode): void => {
      if (n.type === 'dir' && n.path !== visibleTree.path) {
        if (n.path === target) targetIsDir = true;
        if (target.startsWith(`${n.path}/`) || n.path === target) ancestors.add(n.path);
        for (const c of n.children ?? []) walk(c);
      }
    };
    for (const c of visibleTree.children ?? []) walk(c);
    if (ancestors.size) setExpanded((prev) => new Set([...prev, ...ancestors]));
    // Revealing a FOLDER means "browse into it"; revealing a FILE means
    // "browse its parent". The old code always used the parent, so clicking a
    // breadcrumb/crumb for a directory snapped the breadcrumb back one level.
    onActiveDirChange?.(targetIsDir ? target : parentOf(target) || root || null);
    setRoving(target);
    const id = requestAnimationFrame(() => {
      const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target) : target.replace(/["\\]/g, '\\$&');
      const el = document.querySelector<HTMLElement>(`[data-path="${sel}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [target, visibleTree, root, onActiveDirChange]);

  const toggleDir = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const expandDir = useCallback((p: string) => {
    setExpanded((prev) => (prev.has(p) ? prev : new Set([...prev, p])));
  }, []);

  const beginCreate = useCallback((dir: string, kind: 'file' | 'dir' = 'file') => {
    setCreateKind(kind);
    setCreatingIn(dir);
  }, []);

  const reveal = useCallback((p: string) => setLocalReveal(p), []);

  // honest empty states: no workspace → open one (real action, existing
  // wiring); workspace with no visible entries → say so instead of rendering
  // a silent blank panel
  if (!fileTree) {
    return (
      <TreeEmpty
        icon={<FolderOpen size={22} />}
        title={t('ws.noWorkspace')}
        hint={t('ws.emptyHint', 'Open a folder to browse and edit its files')}
        action={
          <Btn className="!h-7 !px-3 !text-[11.5px]" onClick={() => void openFolderDialog()}>
            {t('ws.open', 'Open')}
          </Btn>
        }
      />
    );
  }

  const roots = visibleTree?.children ?? [];
  if (roots.length === 0) {
    return (
      <TreeEmpty
        icon={q ? <Search size={22} /> : <FolderOpen size={22} />}
        title={q ? t('pf.noMatches', 'No matching files') : t('ws.emptyFolder', 'Empty folder')}
        hint={
          q
            ? t('pf.noMatchesHint', 'Try a different name or extension')
            : t('ws.emptyFolderHint', 'This workspace has no files yet — ask the agent or create one')
        }
      />
    );
  }

  const ctx: TreeCtxValue = {
    expanded,
    toggleDir,
    expandDir,
    activeDir,
    setActiveDir,
    renamingPath,
    beginRename: setRenamingPath,
    endRename: () => setRenamingPath(null),
    creatingIn,
    createKind,
    beginCreate,
    endCreate: () => setCreatingIn(null),
    root,
    gitStatus,
    roving,
    setRoving,
    firstVisiblePath: roots[0]?.path ?? null,
    onActiveDirChange,
    onOpenPath,
    reveal,
    revealHighlight: target,
  };

  return (
    <TreeCtx.Provider value={ctx}>
      <div className="pf-tree py-1" role="tree" aria-label={t('pf.tree', 'Project files')}>
        {roots.map((n) => (
          <TreeNode key={n.path} node={n} depth={0} />
        ))}
      </div>
    </TreeCtx.Provider>
  );
}

export default FileTree;
