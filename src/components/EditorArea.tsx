// SADEEM — tabbed Monaco editor area: breadcrumb strip, tab strip (middle-click
// close, close-others context menu, dirty indicator) and a rich empty state
// (workspace stats, recent files, shortcut cheat-sheet, quick actions).
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Map,
  MessageSquare,
  MessageSquarePlus,
  Save,
  X,
  XSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Braces, Database, FileCode, FileCode2, FileCog, FileImage, FileText, Palette } from 'lucide-react';
import { Editor, loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { monaco, monacoThemeFor, languageForPath } from '../lib/monaco';
import { registerGhostText } from '../lib/ghostText';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Btn, Empty, IconBtn, Kbd, MOD_KEY, Spinner } from './ui';
import { Logo } from './Logo';
import { InlineEditWidget } from './InlineEditWidget';
import type { InlineEditPreset, InlineEditRequest } from './InlineEditWidget';
import { REVEAL_FILE_EVENT } from './ProjectFiles';
import type { FileNode } from '../../shared/types';
import './files.css';

// Bundle Monaco locally (offline-safe) instead of loading it from a CDN.
loader.config({ monaco });

/* ============================================================
   SADEEM Monaco theme override (A3).
   The stock themes live in src/lib/monaco.ts (read-only for this
   agent — Flexoki/SADEEM leftovers: sage keywords, cream editor
   well #1A2126). They are re-defined here under the SAME theme
   keys so every consumer (EditorArea + DiffModal) picks the
   SADEEM identity without touching the forbidden lib:
     · editor well = #141413 dark / #FAF9F6 light (editor bg tokens)
     · syntax hues from the SADEEM family: lemon keyword, taupe type,
       lemon strings, taupe numbers, gray functions
     · violet is intentionally NOT used — no agent-semantic token
       exists inside code syntax, so none may claim it
   Values are plain hex (Monaco themes cannot read CSS vars);
   they mirror the theme blocks in styles.css.
   ============================================================ */
monaco.editor.defineTheme('surnia-dark', {
  base: 'vs-dark',
  inherit: true,
    rules: [
    { token: 'comment', foreground: '8F8A80', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C6D86A' },
    { token: 'string', foreground: 'B7CF45' },
    { token: 'number', foreground: 'CBB684' },
    { token: 'constant', foreground: 'CBB684' },
    { token: 'regexp', foreground: 'C4A97C' },
    { token: 'type', foreground: 'C4A97C' },
    { token: 'function', foreground: 'A8A8A5' },
    { token: 'variable', foreground: 'F2F0EA' },
    { token: 'delimiter', foreground: 'A9A49A' },
    { token: 'tag', foreground: 'C6D86A' },
    { token: 'attribute.name', foreground: 'C4A97C' },
    { token: 'attribute.value', foreground: 'B7CF45' },
  ],
    colors: {
    'editor.background': '#141413',
    'editor.foreground': '#F2F0EA',
    'editorGutter.background': '#141413',
    'editor.lineHighlightBackground': '#201f1d',
    'editorLineNumber.foreground': '#6c675e',
    'editorLineNumber.activeForeground': '#a9be56',
    'editorCursor.foreground': '#a9be56',
    'editor.selectionBackground': '#a9be5640',
    'editor.inactiveSelectionBackground': '#a9be561f',
    'editorIndentGuide.background1': '#33322e73',
    'editorIndentGuide.activeBackground1': '#45443fb0',
    'editorWhitespace.foreground': '#33322e80',
    'editorRuler.foreground': '#33322e55',
    'editorBracketMatch.background': '#c4a97c26',
    'editorBracketMatch.border': '#c4a97c66',
    'editorWidget.background': '#1d1c1a',
    'editorWidget.border': '#33322e',
    'editorSuggestWidget.background': '#1d1c1a',
    'editorSuggestWidget.border': '#33322e',
    'editorSuggestWidget.selectedBackground': '#272623',
    'editorHoverWidget.background': '#1d1c1a',
    'editorHoverWidget.border': '#33322e',
    'editorError.foreground': '#e8e4d8',
    'editorWarning.foreground': '#cbb684',
    'editorInfo.foreground': '#a8a8a5',
    'editorInlayHint.foreground': '#a9a49a',
    'scrollbarSlider.background': '#F2F0EA1F',
    'scrollbarSlider.hoverBackground': '#F2F0EA33',
    'scrollbarSlider.activeBackground': '#F2F0EA4D',
    'minimap.background': '#0d0d0c',
    'diffEditor.insertedTextBackground': '#A9BE561F',
    'diffEditor.removedTextBackground': '#E8E4D81F',
    'input.background': '#1d1c1a',
    'input.border': '#363633',
    'dropdown.background': '#1d1c1a',
    'focusBorder': '#a9be5666',
  },
});

monaco.editor.defineTheme('surnia-light', {
  base: 'vs',
  inherit: true,
    rules: [
    { token: 'comment', foreground: '8F8A80', fontStyle: 'italic' },
    { token: 'keyword', foreground: '637F1F' },
    { token: 'string', foreground: '637F1F' },
    { token: 'number', foreground: '9A7B3F' },
    { token: 'constant', foreground: '9A7B3F' },
    { token: 'regexp', foreground: '8A6C42' },
    { token: 'type', foreground: '8A6C42' },
    { token: 'function', foreground: '6C675E' },
    { token: 'variable', foreground: '1D1B17' },
    { token: 'delimiter', foreground: '6C675E' },
    { token: 'tag', foreground: '637F1F' },
    { token: 'attribute.name', foreground: '8A6C42' },
    { token: 'attribute.value', foreground: '637F1F' },
  ],
  colors: {
    'editor.background': '#FAF9F6',
    'editor.foreground': '#1D1B17',
    'editorGutter.background': '#faf9f6',
    'editor.lineHighlightBackground': '#E8EEF499',
    'editorLineNumber.foreground': '#A29C91',
    'editorLineNumber.activeForeground': '#637F1F',
    'editorCursor.foreground': '#637F1F',
    'editor.selectionBackground': '#637F1F29',
    'editor.inactiveSelectionBackground': '#637F1F1A',
    'editorIndentGuide.background1': '#22221f14',
    'editorIndentGuide.activeBackground1': '#c5c2ba',
    'editorWhitespace.foreground': '#1D1B1726',
    'editorRuler.foreground': '#1D1B171A',
    'editorBracketMatch.background': '#c4a97c1F',
    'editorBracketMatch.border': '#c4a97c66',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#dbd7cd',
    'editorSuggestWidget.background': '#FFFFFF',
    'editorSuggestWidget.border': '#dbd7cd',
    'editorSuggestWidget.selectedBackground': '#dbd7cd',
    'editorHoverWidget.background': '#FFFFFF',
    'editorHoverWidget.border': '#dbd7cd',
    'editorError.foreground': '#26241f',
    'editorWarning.foreground': '#8a6c42',
    'editorInfo.foreground': '#6c675e',
    'editorGutter.foldingControlForeground': '#888885',
    'scrollbarSlider.background': '#22221f1F',
    'scrollbarSlider.hoverBackground': '#22221f33',
    'scrollbarSlider.activeBackground': '#22221f4D',
    'minimap.background': '#faf9f6',
    'diffEditor.insertedTextBackground': '#637f1f1F',
    'diffEditor.removedTextBackground': '#26241f1F',
    'input.background': '#FFFFFF',
    'input.border': '#dbd7cd',
    'dropdown.background': '#FFFFFF',
    'focusBorder': '#637F1F66',
  },
});

// SADEEM Deep ([data-theme=midnight]) — near-black well, high-contrast teal.
monaco.editor.defineTheme('surnia-midnight', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '7F93A8', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C6D86A' },
    { token: 'string', foreground: 'A9BE56' },
    { token: 'number', foreground: 'C9A488' },
    { token: 'constant', foreground: 'C9A488' },
    { token: 'regexp', foreground: 'C9A488' },
    { token: 'type', foreground: 'C4A97C' },
    { token: 'function', foreground: 'A8A8A5' },
    { token: 'variable', foreground: 'F2F0EA' },
    { token: 'delimiter', foreground: 'A8A8A5' },
    { token: 'tag', foreground: 'C6D86A' },
    { token: 'attribute.name', foreground: 'C4A97C' },
    { token: 'attribute.value', foreground: 'A9BE56' },
  ],
  colors: {
    'editor.background': '#141413',
    'editor.foreground': '#F2F0EA',
    'editorGutter.background': '#141413',
    'editor.lineHighlightBackground': '#1f1f1c99',
    'editorLineNumber.foreground': '#7c7c79',
    'editorLineNumber.activeForeground': '#C6D86A',
    'editorCursor.foreground': '#C6D86A',
    'editor.selectionBackground': '#C6D86A4D',
    'editor.inactiveSelectionBackground': '#C6D86A26',
    'editorIndentGuide.background1': '#3f3f3c80',
    'editorIndentGuide.activeBackground1': '#4d4d4a',
    'editorWhitespace.foreground': '#3f3f3c80',
    'editorRuler.foreground': '#3f3f3c55',
    'editorBracketMatch.background': '#C4A97C26',
    'editorBracketMatch.border': '#C4A97C66',
    'editorWidget.background': '#191916',
    'editorWidget.border': '#3f3f3c',
    'editorSuggestWidget.background': '#191916',
    'editorSuggestWidget.border': '#3f3f3c',
    'editorSuggestWidget.selectedBackground': '#2b2b28',
    'editorHoverWidget.background': '#191916',
    'editorHoverWidget.border': '#3f3f3c',
    'editorError.foreground': '#f2f0ea',
    'editorWarning.foreground': '#8a6c42',
    'editorInfo.foreground': '#a6a198',
    'editorGutter.foldingControlForeground': '#90908d',
    'scrollbarSlider.background': '#F2F0EA1F',
    'scrollbarSlider.hoverBackground': '#F2F0EA33',
    'scrollbarSlider.activeBackground': '#F2F0EA4D',
    'minimap.background': '#141413',
    'diffEditor.insertedTextBackground': '#a9be561F',
    'diffEditor.removedTextBackground': '#f2f0ea1F',
    'input.background': '#191916',
    'input.border': '#3f3f3c',
    'dropdown.background': '#191916',
    'focusBorder': '#C6D86A66',
  },
});

function extIcon(name: string): { Icon: LucideIcon; cls: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const lower = name.toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return { Icon: FileCode2, cls: 'text-acc' };
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return { Icon: FileCode, cls: 'text-acc2' };
  // v11.31 — match the FileTree icon families so the same file reads the same
  // in the tree, on the tab and in the recent-files list.
  if (ext === 'vue' || ext === 'svelte' || ext === 'py' || ext === 'rb' || ext === 'php' || ext === 'rs' || ext === 'go')
    return { Icon: FileCode, cls: 'text-ok' };
  if (ext === 'json' || ext === 'jsonc') return { Icon: Braces, cls: 'text-warn' };
  if (ext === 'sql' || ext === 'db' || ext === 'sqlite' || ext === 'sqlite3') return { Icon: Database, cls: 'text-acc2' };
  if (ext === 'css' || ext === 'scss' || ext === 'less' || ext === 'sass' || ext === 'styl') return { Icon: Palette, cls: 'text-acc2' };
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg' || ext === 'webp' || ext === 'ico')
    return { Icon: FileImage, cls: 'text-ok' };
  if (
    lower.startsWith('.env') ||
    ext === 'yml' ||
    ext === 'yaml' ||
    ext === 'toml' ||
    ext === 'ini' ||
    lower === 'dockerfile' ||
    lower === 'makefile'
  )
    return { Icon: FileCog, cls: 'text-dim' };
  return { Icon: FileText, cls: ext === 'md' ? 'text-dim' : ext === 'pdf' ? 'text-warn' : 'text-faint' };
}

const base = (p: string) => p.split(/[\\/]/).pop() || p;

/** Relative path of an absolute workspace file ('' safe when no workspace). */
function relPath(path: string, wsPath: string): string {
  if (!path) return '';
  return wsPath && path.startsWith(`${wsPath}/`) ? path.slice(wsPath.length + 1) : path;
}

/**
 * The ONE navigation contract out of the editor.
 * `openFile` / `setActiveTab` in the store switch `rail` to 'editor'
 * (store.ts:2146, 2152, 2165) — this is the exact inverse: land on the
 * Workspace stage AND reveal the sidebar rail, so the file tree the user came
 * from is right in front of them again. Every back control in this file
 * (tab strip, breadcrumb, empty state) funnels through here — there is no
 * second code path that can leave the user stranded in the editor.
 */
function goWorkspace(): void {
  const st = useStore.getState();
  st.setRail('workspace');
  if (!st.sidebarOpen) st.toggleSidebar();
}

/** v11.31 — a breadcrumb folder click returns to the Workspace stage AND
 *  asks PROJECT FILES to reveal that folder, so the file tree is waiting at
 *  the exact place the user navigated from (no lost navigation). */
function goWorkspaceTo(folderPath: string): void {
  goWorkspace();
  window.dispatchEvent(new CustomEvent(REVEAL_FILE_EVENT, { detail: { path: folderPath } }));
}

// Session-scoped open order of tabs — powers "recent files" in the empty state
// even after every tab has been closed. Module-level on purpose (not persisted).
const tabHistory: string[] = [];

interface TreeCounts {
  files: number;
  dirs: number;
}

/** Recursive file/folder counter for the loaded tree (capped defensively). */
function countTree(node: FileNode | null): TreeCounts {
  const out: TreeCounts = { files: 0, dirs: 0 };
  if (!node) return out;
  const walk = (n: FileNode): void => {
    if (out.files + out.dirs > 4000) return;
    if (n.type === 'dir') {
      out.dirs++;
      for (const c of n.children ?? []) walk(c);
    } else {
      out.files++;
    }
  };
  for (const c of node.children ?? []) walk(c);
  return out;
}

// ---------------- empty editor state ----------------
function EmptyEditorState({ recentFiles }: { recentFiles: string[] }) {
  const t = useT();
  const wsPath = useStore((s) => s.wsPath);
  const fileTree = useStore((s) => s.fileTree);
  const openFile = useStore((s) => s.openFile);
  const newSession = useStore((s) => s.newSession);
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const toggleChat = useStore((s) => s.toggleChat);

  const counts = useMemo(() => countTree(fileTree), [fileTree]);
  const recent = recentFiles.slice(0, 5);

  const shortcuts: { k: string; labelKey: string; fb: string }[] = [
    { k: `${MOD_KEY}+K`, labelKey: 'ed.empty.kPalette', fb: 'Command palette' },
    { k: `${MOD_KEY}+\``, labelKey: 'ed.empty.kTerminal', fb: 'Terminal' },
    { k: `${MOD_KEY}+B`, labelKey: 'ed.empty.kSidebar', fb: 'Toggle sidebar' },
    { k: `${MOD_KEY}+M`, labelKey: 'ed.empty.kModel', fb: 'Choose model' },
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="min-h-full flex items-center justify-center">
        <div className="w-full max-w-[660px] px-8 py-10 anim-in flex flex-col gap-6">
          {/* header */}
          <div className="flex items-center gap-4">
            <Logo size={40} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[19px] font-semibold leading-tight truncate" title={wsPath}>
                {wsPath ? base(wsPath) : t('rail.workspace', 'Workspace')}
              </h2>
              <p className="text-[11.5px] text-dim mt-0.5 truncate">{t('ed.empty.sub', 'Open a file from the tree, or ask the agent to start')}</p>
              <div className="flex items-center gap-1.5 mt-1.5 text-[10.5px] text-faint tnum">
                <span>
                  {counts.files} {t('ed.empty.files', 'files')}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {counts.dirs} {t('ed.empty.folders', 'folders')}
                </span>
              </div>
            </div>
            {/* Escape hatch in the empty state too — closing the last tab must
                never trap the user on the implicit 'editor' rail. */}
            <button
              className="ed-back-btn shrink-0"
              onClick={goWorkspace}
              title={t('ed.back', 'Back to Workspace')}
              aria-label={t('ed.back', 'Back to Workspace')}
            >
              <ArrowLeft size={13} className="flip-rtl" aria-hidden />
              <span>{t('ed.back', 'Back to Workspace')}</span>
            </button>
          </div>

          {/* recent files + shortcuts */}
          <div className="grid md:grid-cols-[1fr_250px] gap-4">
            {/* recent files */}
            <div className="aurora-panel p-1.5 min-w-0">
              <div className="micro-label px-2.5 pt-2 pb-1.5">
                {t('ed.empty.recent', 'Recent files')}
              </div>
              {recent.length === 0 ? (
                <div className="px-2.5 pb-2.5 text-[11.5px] text-faint">{t('ed.empty.noRecent', 'Files you open will appear here')}</div>
              ) : (
                recent.map((p) => {
                  const ic = extIcon(base(p));
                  const dir = relPath(p, wsPath).split('/').slice(0, -1).join('/');
                  return (
                    <button
                      key={p}
                      className="w-full flex items-center gap-2 px-2.5 h-[32px] rounded-[8px] row-hover cursor-pointer text-start min-w-0"
                      title={p}
                      onClick={() => void openFile(p)}
                    >
                      <ic.Icon size={13} className={`shrink-0 ${ic.cls}`} />
                      <span className="text-[12px] font-medium truncate shrink-0 max-w-[45%]">{base(p)}</span>
                      {dir && (
                        <span className="text-[10.5px] text-faint truncate min-w-0 flex-1 font-code" dir="ltr">
                          {dir}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* shortcut cheat-sheet */}
            <div className="aurora-panel p-1.5">
              <div className="micro-label px-2.5 pt-2 pb-1.5">
                {t('ed.empty.shortcuts', 'Shortcuts')}
              </div>
              {shortcuts.map(({ k, labelKey, fb }) => (
                <div key={k} className="flex items-center gap-2 px-2.5 h-[32px]">
                  <Kbd>{k}</Kbd>
                  <span className="text-[11.5px] text-dim truncate min-w-0">{t(labelKey, fb)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* quick actions */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Btn variant="primary" onClick={() => void newSession()}>
              <MessageSquarePlus size={14} />
              {t('chat.new', 'New session')}
            </Btn>
            <Btn onClick={() => void openFolderDialog()}>
              <FolderOpen size={14} />
              {t('welcome.open', 'Open folder')}
            </Btn>
            <Btn variant="ghost" onClick={() => toggleChat()}>
              <MessageSquare size={14} />
              {t('palette.toggleChat', 'Toggle chat panel')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- editor area ----------------
export function EditorArea() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const wsPath = useStore((s) => s.wsPath);
  const fileTree = useStore((s) => s.fileTree);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const settings = useStore((s) => s.settings);
  // v11.4 — persisted editor preferences (Settings → Editor); the selector
  // returns the STABLE settings.editor object (React #185 guard).
  const editorCfg = useStore((s) => s.settings.editor);
  const updateSettings = useStore((s) => s.updateSettings);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const setTabContent = useStore((s) => s.setTabContent);
  const saveTab = useStore((s) => s.saveTab);

  const tab = activeTab ? tabs.find((x) => x.path === activeTab) ?? null : null;
  const lineCount = tab ? tab.content.split('\n').length : 0;
  const fi = tab ? extIcon(base(tab.path)) : null;
  const lang = settings.language;

  // v7.2 — theme 'follow': resolve the OS light/dark preference (live) so the
  // Monaco theme matches data-theme, which App.tsx keeps in sync.
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
    settings.theme === 'follow'
      ? systemLight
        ? 'surnia-light'
        : 'surnia-dark'
      : monacoThemeFor(settings.theme);

  // tab-context menu (close / close others)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // editor AI state — the live editor instance + the open inline-edit request
  const [editorInst, setEditorInst] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditRequest | null>(null);
  const inlineSeq = useRef(0);

  // editor toolbar state — v11.4: minimap persists in settings.editor and the
  // toolbar button drives the SAME field (replaces the old in-memory toggle)
  const editorMinimap = editorCfg?.minimap === true;
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);

  const activePath = tab?.path ?? null;

  // record open order for the empty-state "recent files" list
  useEffect(() => {
    for (const tb of tabs) {
      if (!tabHistory.includes(tb.path)) tabHistory.push(tb.path);
    }
    if (tabHistory.length > 24) tabHistory.splice(0, tabHistory.length - 24);
  }, [tabs]);

  // dismiss the tab context menu
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctxMenu]);

  // Tab switched / closed → drop stale editor handle and close the widget.
  useEffect(() => {
    if (!activePath) setEditorInst(null);
    setInlineEdit(null);
  }, [activePath]);

  // Cursor position for the status line (listener disposed with the editor).
  useEffect(() => {
    if (!editorInst) {
      setCursor(null);
      return;
    }
    const update = () => {
      const p = editorInst.getPosition();
      if (p) setCursor({ line: p.lineNumber, col: p.column });
    };
    update();
    const d = editorInst.onDidChangeCursorPosition(update);
    return () => d.dispose();
  }, [editorInst]);

  // ---- tab strip overflow state (chevron scroll buttons) ----
  const stripRef = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState({ overflow: false, atStart: true, atEnd: true });
  const isRtl = useCallback(() => {
    const el = stripRef.current;
    return !!el && getComputedStyle(el).direction === 'rtl';
  }, []);
  const updateStrip = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 4;
    const rtl = isRtl();
    const sl = el.scrollLeft;
    // Chromium RTL: scrollLeft runs 0 → negative toward the visual end
    const atStart = overflow ? (rtl ? sl > -4 : sl < 4) : true;
    const atEnd = overflow ? (rtl ? sl < -max + 4 : sl > max - 4) : true;
    setStrip((prev) =>
      prev.overflow === overflow && prev.atStart === atStart && prev.atEnd === atEnd
        ? prev
        : { overflow, atStart, atEnd },
    );
  }, [isRtl]);
  useEffect(() => {
    updateStrip();
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateStrip);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateStrip, tabs.length]);

  const nudgeStrip = (towardEnd: boolean) => {
    const el = stripRef.current;
    if (!el) return;
    const dir = isRtl() ? -1 : 1;
    el.scrollBy({ left: towardEnd ? 240 * dir : -240 * dir, behavior: 'smooth' });
  };

  // Ghost-text inline completions, gated by the user setting (default on).
  useEffect(() => {
    if (!editorInst) return;
    const d = registerGhostText(monaco, editorInst, () => useStore.getState().settings.inlineSuggestions !== false);
    return () => d.dispose();
  }, [editorInst]);

  // recent files for the empty state: session open history inside this
  // workspace, falling back to the top-level files of the tree
  const recentFiles = useMemo(() => {
    const prefix = wsPath ? `${wsPath}/` : '';
    const hist: string[] = [];
    for (let i = tabHistory.length - 1; i >= 0 && hist.length < 5; i--) {
      const p = tabHistory[i];
      if (prefix && !p.startsWith(prefix)) continue;
      if (!hist.includes(p)) hist.push(p);
    }
    if (hist.length > 0) return hist;
    const kids = fileTree?.children ?? [];
    return kids
      .filter((k) => k.type === 'file')
      .slice(0, 5)
      .map((k) => k.path);
  }, [tabs, wsPath, fileTree]);

  const openInlineEdit = (ed: Monaco.editor.ICodeEditor, preset?: InlineEditPreset) => {
    const model = ed.getModel();
    if (!model) return;
    const st = useStore.getState();
    const path = st.activeTab ?? '';
    const sel = ed.getSelection();
    let range: Monaco.IRange;
    let selection: string;
    if (sel && !sel.isEmpty()) {
      range = sel;
      selection = model.getValueInRange(sel);
    } else {
      // no selection → operate on the line at the cursor
      const pos = ed.getPosition();
      if (!pos) return;
      range = {
        startLineNumber: pos.lineNumber,
        startColumn: 1,
        endLineNumber: pos.lineNumber,
        endColumn: model.getLineMaxColumn(pos.lineNumber),
      };
      selection = model.getValueInRange(range);
    }
    inlineSeq.current += 1;
    setInlineEdit({
      seq: inlineSeq.current,
      range,
      selection,
      language: languageForPath(path),
      path,
      ...(preset ? { preset } : {}),
    });
  };

  const sendSelectionToChat = (ed: Monaco.editor.ICodeEditor) => {
    const model = ed.getModel();
    if (!model) return;
    const sel = ed.getSelection();
    if (!sel || sel.isEmpty()) return;
    const st = useStore.getState();
    const path = st.activeTab ?? '';
    const lang = languageForPath(path);
    const fenceTag = lang === 'plaintext' ? '' : lang;
    st.insertIntoComposer(
      `\`\`\`${fenceTag}\n${model.getValueInRange(sel)}\n\`\`\`\n\n${relPath(path, st.wsPath)}:`,
    );
  };

  // v2.3 — "Explain in Arabic": read-only editor action that hands the
  // selection (or the cursor's line when nothing is selected) to the composer
  // via insertIntoComposer (the same bridge "send to chat" uses). The composer
  // effect focuses the input with the caret at the end — the user reviews and
  // hits Enter themselves; the document is never touched.
  const explainSelectionToChat = (ed: Monaco.editor.ICodeEditor) => {
    const model = ed.getModel();
    if (!model) return;
    const sel = ed.getSelection();
    let code = '';
    if (sel && !sel.isEmpty()) {
      code = model.getValueInRange(sel);
    } else {
      // empty selection → the line at the cursor (never throw)
      const pos = ed.getPosition();
      if (!pos) return;
      code = model.getValueInRange({
        startLineNumber: pos.lineNumber,
        startColumn: 1,
        endLineNumber: pos.lineNumber,
        endColumn: model.getLineMaxColumn(pos.lineNumber),
      });
    }
    if (!code.trim()) return;
    const st = useStore.getState();
    const prompt =
      st.settings.language === 'ar'
        ? `اشرح هذا الكود بالعربية ببساطة:\n\n${code}`
        : `Explain this code:\n\n${code}`;
    st.insertIntoComposer(prompt);
  };

  // Editor actions: inline edit (Ctrl/Cmd+I) + context-menu AI actions.
  useEffect(() => {
    if (!editorInst) return;
    const ed = editorInst;
    const disposables: Monaco.IDisposable[] = [];
    disposables.push(
      ed.addAction({
        id: 'surnia.inlineEdit',
        label: t('editor.inlineEdit'),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        keybindingContext: 'editorTextFocus',
        contextMenuGroupId: 'surnia',
        contextMenuOrder: 1,
        run: (target) => openInlineEdit(target),
      }),
    );
    const ctxActions: [string, string, InlineEditPreset, number][] = [
      ['surnia.explain', t('editor.action.explain'), 'explain', 2],
      ['surnia.fix', t('editor.action.fix'), 'fix', 3],
      ['surnia.addTests', t('editor.action.addTests'), 'addTests', 4],
      ['surnia.refactor', t('editor.action.refactor'), 'refactor', 5],
    ];
    for (const [id, label, preset, order] of ctxActions) {
      disposables.push(
        ed.addAction({
          id,
          label,
          contextMenuGroupId: 'surnia',
          contextMenuOrder: order,
          run: (target) => openInlineEdit(target, preset),
        }),
      );
    }
    disposables.push(
      ed.addAction({
        id: 'surnia.sendToChat',
        label: t('editor.action.sendToChat'),
        contextMenuGroupId: 'surnia',
        contextMenuOrder: 6,
        run: (target) => sendSelectionToChat(target),
      }),
    );
    // v2.3 — SADEEM signature action: bilingual label follows the UI language.
    disposables.push(
      ed.addAction({
        id: 'surnia.explain',
        label: lang === 'ar' ? 'سديم: اشرح المحدد' : 'SADEEM: Explain selection',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
        keybindingContext: 'editorTextFocus',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1,
        run: (target) => explainSelectionToChat(target),
      }),
    );
    return () => {
      for (const d of disposables) d.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInst, t, lang]);

  // breadcrumb segments: folders between workspace root and the active file.
  // v11.31 — carry the FULL folder path with each crumb so it can navigate the
  // tree back on the Workspace stage instead of being inert text.
  const crumbs = useMemo(() => {
    if (!tab) return [];
    const rel = relPath(tab.path, wsPath || '');
    const parts = rel.split('/').filter(Boolean);
    parts.pop(); // the file name is rendered separately
    return parts.map((seg, i) => {
      const prefix = parts.slice(0, i + 1).join('/');
      return { seg, path: wsPath ? `${wsPath}/${prefix}` : prefix };
    });
  }, [tab, wsPath]);

  const closeOthers = (keepPath: string) => {
    for (const tb of tabs) {
      if (tb.path !== keepPath) closeTab(tb.path);
    }
  };

  return (
    <div className="pf-editor flex-1 flex flex-col min-h-0 min-w-0">
      {/* tab strip (chevrons appear when the tabs overflow).
          The back control lives here so the escape route out of the editor is
          ALWAYS visible — navigation is never lost after opening a file. */}
      {tabs.length > 0 && (
        <div className="etab-strip relative h-[38px] shrink-0 border-b border-line flex items-center">
          <button
            className="ed-back-btn"
            onClick={goWorkspace}
            title={t('ed.back', 'Back to Workspace')}
            aria-label={t('ed.back', 'Back to Workspace')}
          >
            <ArrowLeft size={13} className="flip-rtl" aria-hidden />
            <span>{t('ed.back', 'Back to Workspace')}</span>
          </button>
          {strip.overflow && !strip.atStart && (
            <button
              className="absolute top-0 bottom-0 z-10 w-6 flex items-center justify-center text-dim hover:text-[var(--ink)] bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] border-e border-line cursor-pointer"
              style={{ insetInlineStart: 0 }}
              aria-label={t('ed.scrollStart', 'Scroll tabs backward')}
              title={t('ed.scrollStart', 'Scroll tabs backward')}
              onClick={() => nudgeStrip(false)}
            >
              <ChevronLeft size={13} className="flip-rtl" />
            </button>
          )}
          <div
            ref={stripRef}
            onScroll={updateStrip}
            className="h-full flex-1 min-w-0 flex items-center gap-0.5 px-1.5 overflow-x-auto scroll-x-thin"
            role="tablist"
            aria-label={t('ed.tabs', 'Open editors')}
            onKeyDown={(e) => {
              // roving focus between tabs with ArrowLeft/ArrowRight (RTL flips)
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              const idx = tabs.findIndex((x) => x.path === activeTab);
              if (idx < 0) return;
              e.preventDefault();
              const stripEl = e.currentTarget; // captured — React nulls it after the handler
              const rtl = getComputedStyle(stripEl).direction === 'rtl';
              const fwd = rtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
              const next = (idx + (fwd ? 1 : -1) + tabs.length) % tabs.length;
              const nextPath = tabs[next].path;
              setActiveTab(nextPath);
              // move focus to the freshly active tab button
              requestAnimationFrame(() => {
                (stripEl.querySelector(`[data-tab="${CSS.escape(nextPath)}"]`) as HTMLElement | null)?.focus();
              });
            }}
          >
          {tabs.map((tb) => {
            const active = tb.path === activeTab;
            const icon = extIcon(base(tb.path));
            return (
              <div
                key={tb.path}
                data-tab={tb.path}
                title={tb.path}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tb.path)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tb.path);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, path: tb.path });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab(tb.path);
                  }
                  if (e.key === 'Delete') {
                    e.preventDefault();
                    closeTab(tb.path);
                  }
                }}
                className={`etab group ${active ? 'is-active' : ''}`}
              >
                <icon.Icon size={12} className={`shrink-0 ${icon.cls}`} />
                <span className="etab-name" title={tb.path}>
                  {base(tb.path)}
                </span>
                {tb.dirty && (
                  <span
                    className="etab-dirty"
                    title={t('ed.dirty', 'Unsaved changes')}
                  />
                )}
                <button
                  title={t('diff.close', 'Close')}
                  aria-label={`${t('diff.close', 'Close')} ${base(tb.path)}`}
                  className="etab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tb.path);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          </div>
          {strip.overflow && !strip.atEnd && (
            <button
              className="absolute top-0 bottom-0 z-10 w-6 flex items-center justify-center text-dim hover:text-[var(--ink)] bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] border-s border-line cursor-pointer"
              style={{ insetInlineEnd: 0 }}
              aria-label={t('ed.scrollEnd', 'Scroll tabs forward')}
              title={t('ed.scrollEnd', 'Scroll tabs forward')}
              onClick={() => nudgeStrip(true)}
            >
              <ChevronRight size={13} className="flip-rtl" />
            </button>
          )}
        </div>
      )}

      {/* breadcrumb strip + editor status chips (active file only) */}
      {tab && (
        <div className="ed-crumb-bar h-[34px] shrink-0 flex items-center gap-1 px-3 border-b border-line bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] min-w-0 overflow-hidden">
          {wsPath && (
            <>
              <button
                className="ed-crumb-btn"
                title={`${t('ed.back', 'Back to Workspace')} · ${wsPath}`}
                onClick={goWorkspace}
              >
                <ArrowLeft size={11} className="flip-rtl shrink-0" aria-hidden />
                <span className="truncate max-w-[18ch]">{base(wsPath)}</span>
              </button>
              <ChevronRight size={11} className="text-faint shrink-0 flip-rtl" />
            </>
          )}
          {crumbs.map((seg, i) => (
            <React.Fragment key={`${seg.path}:${i}`}>
              {i > 0 && <ChevronRight size={11} className="text-faint shrink-0 flip-rtl" />}
              <button
                className="ed-crumb-seg text-faint truncate max-w-[16ch] row-hover cursor-pointer"
                title={seg.path}
                dir="ltr"
                onClick={() => goWorkspaceTo(seg.path)}
              >
                {seg.seg}
              </button>
              <ChevronRight size={11} className="text-faint shrink-0 flip-rtl" />
            </React.Fragment>
          ))}
          <span className="ed-crumb-file text-[var(--ink)] truncate min-w-0" dir="ltr">{tab ? base(tab.path) : ''}</span>
          {/* editor status chips — language · cursor · dirty (glass pills) */}
          <div className="ms-auto flex items-center gap-1 shrink-0 ps-2">
            <span className="glass-pill !h-[20px] !px-2 !text-[9.5px] font-code" title={t('ed.lang', 'Language')} dir="ltr">
              {languageForPath(tab.path)}
            </span>
            <span className="glass-pill !h-[20px] !px-2 !text-[9.5px] tnum" dir="ltr">
              {t('ed.lines', '{n} lines', { n: lineCount })}
            </span>
            {cursor && (
              <span
                className="glass-pill !h-[20px] !px-2 !text-[9.5px] tnum"
                title={t('ln-col', 'Ln {n}, Col {c}', { n: cursor.line, c: cursor.col })}
                dir="ltr"
              >
                {t('ln-col', 'Ln {n}, Col {c}', { n: cursor.line, c: cursor.col })}
              </span>
            )}
            {tab.dirty && (
              <span
                className="glass-pill !h-[20px] !px-2 !text-[9.5px] text-warn"
                style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent)' }}
                title={t('ed.dirty', 'Unsaved changes')}
              >
                ● {t('ed.dirty', 'Unsaved changes')}
              </span>
            )}
            {/* v11.31 — the dirty state had no visible resolution in the
                editor chrome: Ctrl+S worked globally but there was no Save
                control. This saves the ACTIVE tab (saveAll stays on Ctrl+S). */}
            <IconBtn
              className="!w-6 !h-6"
              active={tab.dirty}
              title={t('misc.save', 'Save')}
              aria-label={t('misc.save', 'Save')}
              onClick={() => void saveTab(tab.path)}
            >
              <Save size={12} />
            </IconBtn>
            <IconBtn
              className="!w-6 !h-6"
              active={editorMinimap}
              title={t('editor.minimap', 'Toggle minimap')}
              aria-pressed={editorMinimap}
              onClick={() =>
                updateSettings({ editor: { ...(editorCfg ?? {}), minimap: !editorMinimap } })
              }
            >
              <Map size={12} />
            </IconBtn>
          </div>
        </div>
      )}

      {/* editor / welcome */}
      <div className="flex-1 relative bg-[var(--bg0)] min-h-0">
        {tab && fi ? (
          <>
            {/* v2.6 Monaco LTR isolation — Monaco has NO RTL support and its
                absolutely-positioned view layers render BLANK when any
                ancestor carries dir="rtl" (monaco-editor#4869/#4141). The
                hard-LTR wrapper is the Monaco team's own accepted fix; the
                editor chrome stays LTR even in the Arabic UI. */}
            <div dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate', position: 'absolute', inset: 0 }}>
              <Editor
                key={tab.path}
                language={languageForPath(tab.path)}
                theme={monacoTheme}
                value={tab.content}
                onChange={(v) => setTabContent(tab.path, v ?? '')}
                onMount={(editor) => {
                  setEditorInst(editor);
                  editor.layout();
                  editor.focus();
                }}
                loading={<Spinner size={18} />}
                options={{
                  // v11.4 — wired to settings.editor (was hardcoded off / 2).
                  // v11.12 — calm readability floor: code stays legible even
                  // when the legacy 13px default is still persisted.
                  fontSize: Math.max(14, editorCfg?.fontSize ?? settings.fontSize ?? 13),
                  lineHeight: 23,
                  letterSpacing: 0.2,
                  fontFamily: 'IBM Plex Mono',
                  minimap: { enabled: editorMinimap },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: 'phase',
                  renderLineHighlight: 'all',
                  padding: { top: 14, bottom: 14 },
                  fontLigatures: true,
                  automaticLayout: true,
                  tabSize: editorCfg?.tabSize ?? 2,
                  wordWrap: editorCfg?.wordWrap === 'on' ? 'on' : 'off',
                  guides: { indentation: editorCfg?.indentGuides !== false },
                  lineNumbersMinChars: 4,
                  renderLineHighlightOnlyWhenFocus: false,
                  overviewRulerBorder: false,
                  inlineSuggest: { enabled: true },
                }}
              />
            </div>
          </>
        ) : tabs.length === 0 && wsPath ? (
          <EmptyEditorState recentFiles={recentFiles} />
        ) : tabs.length === 0 && !wsPath ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Empty icon={<Logo size={46} />} title={t('welcome.title')} sub={t('welcome.sub')} />
          </div>
        ) : null}

        {/* inline AI edit overlay (prompt → loading → preview) */}
        {inlineEdit && editorInst && (
          <InlineEditWidget editor={editorInst} request={inlineEdit} onClose={() => setInlineEdit(null)} />
        )}
      </div>

      {/* tab context menu (close / close others) */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[70]"
            onMouseDown={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="glass-menu fixed z-[71] py-1 min-w-[170px] anim-in"
            style={{
              left: Math.max(4, Math.min(ctxMenu.x, window.innerWidth - 190)),
              top: Math.max(4, Math.min(ctxMenu.y, window.innerHeight - 110)),
            }}
          >
            <button
              className="w-full text-start px-3 h-7 text-[12px] row-hover cursor-pointer flex items-center gap-2 text-[var(--dim)] hover:text-[var(--ink)]"
              onClick={() => {
                closeTab(ctxMenu.path);
                setCtxMenu(null);
              }}
            >
              <X size={12} />
              {t('palette.closeTab', 'Close tab')}
            </button>
            <button
              className="w-full text-start px-3 h-7 text-[12px] row-hover cursor-pointer flex items-center gap-2 text-[var(--dim)] hover:text-[var(--ink)]"
              onClick={() => {
                closeOthers(ctxMenu.path);
                setCtxMenu(null);
              }}
            >
              <XSquare size={12} />
              {t('tab.closeOthers', 'Close others')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default EditorArea;
