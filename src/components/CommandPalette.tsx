// SADEEM — command palette (Ctrl+K / Ctrl+Shift+P). AURORA v8: a 14px-radius
// float panel (.glass-strong) on the single sanctioned .scrim-glass scrim,
// opening on the shared anim-glass-pop curve; rows keep the accent color-mix
// fills (8% hover / 12% active) with the 2px inline-start marker, group
// headers use the .micro-label voice. Commands are grouped (Workspace /
// Modes / Model / Theme / View / Settings) with substring search and full
// keyboard navigation — fuzzy behavior unchanged.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Bot,
  Dna,
  Eraser,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  Gauge,
  History,
  Keyboard,
  Languages,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  Palette,
  PanelLeft,
  Plug,
  Puzzle,
  Save,
  ScrollText,
  Search,
  SearchX,
  Settings2,
  Shield,
  Shrink,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '../store';
import type { RailView } from '../store';
import { PERMISSION_MODES } from '../lib/modes';
import { useT } from '../i18n';
import { api } from '../lib/api';
import type { JournalSummary } from '../lib/api';
import { Kbd, MOD_KEY } from './ui';
import { OPEN_SEARCH_EVENT } from './SearchPanel';
import { OPEN_GUIDE_EVENT } from './CapabilityGuide';
import type { AppSettings, PermissionMode } from '../../shared/types';

type GroupId = 'workspace' | 'modes' | 'model' | 'theme' | 'view' | 'settings' | 'journals';

/** Store union gains 'flows' in the next store drop — widened locally. */
type RailViewEx = RailView | 'flows';
const toStoreRail = (v: RailViewEx): RailView => v as RailView;

interface Command {
  id: string;
  icon: LucideIcon;
  label: string;
  run: () => void;
  shortcut?: string;
  /** keepOpen commands navigate INSIDE the palette (journal submenu) — the
   *  Enter/click handlers skip onClose() for them. */
  keepOpen?: boolean;
}

const GROUPS: { id: GroupId; key: string; fb: string }[] = [
  { id: 'workspace', key: 'pal.sec.workspace', fb: 'Workspace' },
  { id: 'modes', key: 'pal.sec.modes', fb: 'Modes' },
  { id: 'model', key: 'pal.sec.model', fb: 'Model' },
  { id: 'theme', key: 'pal.sec.theme', fb: 'Theme' },
  { id: 'view', key: 'pal.sec.view', fb: 'View' },
  { id: 'settings', key: 'pal.sec.settings', fb: 'Settings' },
  // v8.1 — journal submenu group (rendered only while the submenu is active)
  { id: 'journals', key: 'pal.sec.journals', fb: 'Journals' },
];

const THEMES: AppSettings['theme'][] = ['obsidian', 'midnight', 'light'];

/** Empty-query voice — a short list of REAL suggested commands (ids must
 *  exist in the sections below; typing any query reveals the full set). */
const SUGGESTED_IDS = new Set([
  'openFolder',
  'newSession',
  'changeModel',
  'toggleTerminal',
  'togglePreview',
  'openSettings',
  'openGuide',
]);

const MODE_LABEL_KEY: Record<PermissionMode, string> = {
  plan: 'tb.mode.plan',
  default: 'tb.mode.default',
  autoEdit: 'tb.mode.autoEdit',
  fullAccess: 'tb.mode.fullAccess',
};
const MODE_LABEL_FB: Record<PermissionMode, string> = {
  plan: 'Plan',
  default: 'Ask',
  autoEdit: 'Auto-edit',
  fullAccess: 'Full access',
};
const THEME_LABEL_KEY: Record<AppSettings['theme'], string> = {
  soft: 'palette.theme.soft',
  obsidian: 'palette.theme.obsidian',
  midnight: 'palette.theme.midnight',
  light: 'palette.theme.light',
  follow: 'settings.theme.follow',
  high: 'settings.theme.high',
};
const THEME_LABEL_FB: Record<AppSettings['theme'], string> = {
  soft: 'Theme: Soft',
  obsidian: 'Theme: Obsidian',
  midnight: 'Theme: Midnight',
  light: 'Theme: Light',
  follow: 'Theme: Follow system',
  high: 'Theme: High contrast',
};

/** Clipboard write with a legacy fallback — the palette copies journal paths. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Settings jump-list: nav key + English fallback + icon. */
const SETTINGS_SECTIONS: { id: string; key: string; fb: string; icon: LucideIcon }[] = [
  { id: 'general', key: 'settings.nav.general', fb: 'General', icon: Settings2 },
  { id: 'appearance', key: 'settings.nav.appearance', fb: 'Appearance', icon: Palette },
  { id: 'editor', key: 'settings.nav.editor', fb: 'Editor', icon: FileCode2 },
  { id: 'terminal', key: 'settings.nav.terminal', fb: 'Terminal', icon: Terminal },
  { id: 'agent', key: 'settings.nav.agent', fb: 'Agent', icon: Bot },
  { id: 'models', key: 'settings.nav.models', fb: 'Models', icon: Gauge },
  { id: 'preview', key: 'settings.nav.preview', fb: 'Preview', icon: FlaskConical },
  { id: 'mcp', key: 'settings.nav.mcp', fb: 'MCP servers', icon: Plug },
  { id: 'notifications', key: 'settings.nav.notifications', fb: 'Notifications', icon: Bell },
  { id: 'privacy', key: 'settings.nav.privacy', fb: 'Privacy', icon: Lock },
  { id: 'advanced', key: 'settings.nav.advanced', fb: 'Advanced', icon: SlidersHorizontal },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // v8.1 journal submenu — 'main' shows the grouped commands; 'journals'
  // shows the recent run journals as an in-palette submenu (keepOpen rows).
  const [journalView, setJournalView] = useState<'main' | 'journals'>('main');
  const [journals, setJournals] = useState<JournalSummary[] | null>(null);
  const [journalsState, setJournalsState] = useState<'loading' | 'ready' | 'empty' | 'failed'>('loading');

  // values used by commands
  const lang = useStore((s) => s.settings.language);
  const activeTab = useStore((s) => s.activeTab);
  const previewUrl = useStore((s) => s.previewUrl);
  const wsPath = useStore((s) => s.wsPath);

  // actions used by commands (stable references)
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const newSession = useStore((s) => s.newSession);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const togglePreview = useStore((s) => s.togglePreview);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleChat = useStore((s) => s.toggleChat);
  const setMode = useStore((s) => s.setMode);
  const setModelPicker = useStore((s) => s.setModelPicker);
  const updateSettings = useStore((s) => s.updateSettings);
  const setLang = useStore((s) => s.setLang);
  const setSettings = useStore((s) => s.setSettings);
  const setShortcuts = useStore((s) => s.setShortcuts);
  const sendMessage = useStore((s) => s.sendMessage);
  const saveAll = useStore((s) => s.saveAll);
  const closeTab = useStore((s) => s.closeTab);
  const startStaticPreview = useStore((s) => s.startStaticPreview);
  const notify = useStore((s) => s.notify);
  const loadDna = useStore((s) => s.loadDna);

  /** Clear the transient live-preview overlay so a stage navigation is
   *  actually visible (App renders preview above every stage rail). */
  const revealRail = (st: ReturnType<typeof useStore.getState>) => {
    st.setPreviewOpen(false);
  };

  /** Rail 06 — DNA (setRail opens the sidebar when switching views). */
  const openDnaMap = () => {
    const st = useStore.getState();
    const wasDna = st.rail === 'dna';
    revealRail(st);
    st.setRail('dna');
    if (wasDna && !st.sidebarOpen) st.toggleSidebar();
  };

  /** Rail 07 — Flows. The panel is real (FlowsPanel, rail 07) — no placeholder. */
  const openFlows = () => {
    const st = useStore.getState();
    const wasFlows = (st.rail as RailViewEx) === 'flows';
    revealRail(st);
    st.setRail(toStoreRail('flows'));
    if (wasFlows && !st.sidebarOpen) st.toggleSidebar();
  };

  /** v8.1 — recent run journals (kdx:journal:list, newest first, bounded). */
  const loadJournals = useCallback(() => {
    if (typeof api.journalList !== 'function') {
      setJournals(null);
      setJournalsState('failed');
      return;
    }
    setJournalsState('loading');
    api
      .journalList(6)
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setJournals(list);
        setJournalsState(list.length ? 'ready' : 'empty');
      })
      .catch(() => {
        setJournals(null);
        setJournalsState('failed');
      });
  }, []);

  /** Rail 08 — Skills (existing rail). */
  const openSkills = () => {
    const st = useStore.getState();
    const wasSkills = st.rail === 'skills';
    revealRail(st);
    st.setRail('skills');
    if (wasSkills && !st.sidebarOpen) st.toggleSidebar();
  };

  /** Checkpoints — open the click-to-restore rewind chooser (store.rewindPicker). */
  const openRewind = () => {
    const st = useStore.getState();
    if (!st.wsPath) {
      notify(t('misc.notify.noWorkspace', 'Open a folder first'));
      return;
    }
    if (typeof api.cpList !== 'function') {
      notify(t('slash.rewind.failed', 'Restore failed'));
      return;
    }
    void api
      .cpList(st.wsPath)
      .then((cps) => {
        if (!cps?.length) {
          notify(t('slash.rewind.empty', 'No checkpoints yet — they are created automatically before edits.'));
          return;
        }
        st.setRewindPicker(cps);
      })
      .catch(() => notify(t('slash.rewind.failed', 'Restore failed')));
  };

  // Journal submenu rows — recent run journals (time · task · outcome).
  // Selecting one copies the journal path to the clipboard and toasts it:
  // the store-side transcript append (appendAssistantRow) is module-private
  // in store.ts, so there is no importable helper to print into the transcript.
  // Loading/empty/failed STATES are rendered as a non-interactive status line
  // (see the journals submenu render) — never as fake commands with a no-op
  // run(). Every command below performs a real action.
  const journalCommands = useMemo<Command[]>(() => {
    if (journalView !== 'journals') return [];
    const back: Command = {
      id: 'journalBack',
      icon: ArrowLeft,
      label: t('pal.journal.back', '← Back to commands'),
      keepOpen: true,
      run: () => setJournalView('main'),
    };
    if (journalsState !== 'ready' || !journals) return [back];
    const outcomeLabel = (o?: string): string => {
      if (!o) return '';
      if (o === 'completed') return t('pal.journal.outcome.completed', 'completed');
      if (o === 'aborted') return t('pal.journal.outcome.aborted', 'aborted');
      return o;
    };
    return [
      back,
      ...journals.map((j): Command => {
        const time = j.at ? new Date(j.at).toLocaleTimeString() : '';
        const task = String(j.task || j.sessionId || j.file).slice(0, 60);
        const outcome = outcomeLabel(j.outcome);
        const label = [time, task, outcome].filter(Boolean).join(' · ');
        return {
          id: `journal:${j.file}`,
          icon: ScrollText,
          label,
          run: () => {
            void copyToClipboard(j.file).then((ok) =>
              notify(
                ok
                  ? t('pal.journal.copied', 'Journal path copied to clipboard')
                  : t('pal.journal.copyFailed', 'Could not copy the journal path'),
              ),
            );
          },
        };
      }),
    ];
  }, [journalView, journalsState, journals, t, notify]);

  // rebuild the grouped command list whenever the palette opens (or lang changes)
  const sections = useMemo<{ id: GroupId; commands: Command[] }[]>(() => {
    if (!open) return [];
    // Journal submenu — while active, the palette shows ONLY the journals list.
    if (journalView === 'journals') return [{ id: 'journals', commands: journalCommands }];
    const workspace: Command[] = [
      {
        id: 'openFolder',
        icon: FolderOpen,
        label: t('palette.openFolder', 'Open folder…'),
        run: () => {
          void openFolderDialog();
        },
      },
      {
        id: 'newSession',
        icon: MessageSquarePlus,
        label: t('palette.newSession', 'New session'),
        run: () => {
          void newSession();
        },
      },
      {
        id: 'init',
        icon: FilePlus2,
        label: t('palette.init', '/init — generate project memory (MEMORY.md)'),
        run: () => {
          void sendMessage('/init');
        },
      },
      {
        id: 'compact',
        icon: Shrink,
        label: t('palette.compact', '/compact — summarize and compact context'),
        run: () => {
          void sendMessage('/compact');
        },
      },
      {
        id: 'saveAll',
        icon: Save,
        label: t('palette.saveAll', 'Save all files'),
        shortcut: `${MOD_KEY}+S`,
        run: () => {
          void saveAll();
        },
      },
      {
        id: 'closeTab',
        icon: X,
        label: t('palette.closeTab', 'Close tab'),
        run: () => {
          if (activeTab) closeTab(activeTab);
          else notify(t('palette.closeTab.none', lang === 'ar' ? 'لا توجد علامة تبويب مفتوحة' : 'No tab is open'));
        },
      },
      {
        id: 'servePreview',
        icon: FlaskConical,
        label: t('pal.servePreview', 'Serve workspace in preview (static)'),
        run: () => {
          void startStaticPreview();
        },
      },
      {
        id: 'openPreviewUrl',
        icon: ExternalLink,
        label: t('pal.openPreviewUrl', 'Open preview URL in browser'),
        run: () => {
          if (previewUrl) void api.openExternal(previewUrl);
          else {
            // Honest next step: reveal preview, then ask the user to run this
            // again once a URL exists (the old message blamed the workspace).
            if (!useStore.getState().previewOpen) togglePreview();
            notify(
              t(
                'pal.openPreviewUrl.hint',
                lang === 'ar'
                  ? 'ابدأ المعاينة ثم أعد الأمر لفتح الرابط'
                  : 'Preview opened — run this again to launch the URL',
              ),
            );
          }
        },
      },
      {
        id: 'dnaMap',
        icon: Dna,
        label: t('palette.dnaMap', 'Open DNA map'),
        run: openDnaMap,
      },
      {
        id: 'dnaLearned',
        icon: Sparkles,
        label: t('palette.dnaLearned', 'What has SADEEM learned?'),
        run: openDnaMap,
      },
      {
        id: 'flows',
        icon: Workflow,
        label: t('palette.flows', 'Open Flows'),
        run: openFlows,
      },
      {
        id: 'skillsOpen',
        icon: Puzzle,
        label: t('palette.skills', 'Skills: open the skills panel'),
        run: openSkills,
      },
      {
        id: 'journals',
        icon: ScrollText,
        label: t('palette.journals', 'Journals: view run journals'),
        keepOpen: true,
        run: () => {
          setJournalView('journals');
          loadJournals();
        },
      },
      {
        id: 'rewindPicker',
        icon: History,
        label: t('palette.rewindPicker', 'Checkpoints: rewind the workspace'),
        run: openRewind,
      },
      {
        id: 'dnaForget',
        icon: Eraser,
        label: t('palette.dnaForget', 'Forget DNA (workspace)'),
        run: () => {
          if (!wsPath) {
            notify(t('misc.notify.noWorkspace', 'Open a folder first'));
            return;
          }
          if (window.confirm(t('dna.forgetConfirmWs', 'Forget what SADEEM learned in this workspace?'))) {
            void api
              .dnaClear('workspace', wsPath)
              .then(() => notify(t('dna.forgotWs', 'Workspace DNA forgotten')))
              .catch(() => undefined);
            void loadDna();
          }
        },
      },
    ];
    const modes: Command[] = PERMISSION_MODES.map((m) => ({
      id: `mode:${m}`,
      icon: Shield,
      label: t(MODE_LABEL_KEY[m], MODE_LABEL_FB[m]),
      run: () => setMode(m),
    }));
    const model: Command[] = [
      {
        id: 'changeModel',
        icon: Sparkles,
        label: t('palette.changeModel', 'Change AI model…'),
        shortcut: `${MOD_KEY}+M`,
        run: () => setModelPicker(true),
      },
    ];
    const theme: Command[] = THEMES.map((th) => ({
      id: `theme:${th}`,
      icon: Palette,
      label: t(THEME_LABEL_KEY[th], THEME_LABEL_FB[th]),
      run: () => updateSettings({ theme: th }),
    }));
    const view: Command[] = [
      {
        id: 'toggleSearch',
        icon: Search,
        label: t('pal.toggleSearch', 'Toggle global search'),
        run: () => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT)),
      },
      {
        id: 'shortcuts',
        icon: Keyboard,
        label: t('pal.shortcuts', 'Keyboard shortcuts'),
        run: () => setShortcuts(true),
      },
      {
        id: 'togglePreview',
        icon: FlaskConical,
        label: t('palette.togglePreview', 'Toggle live preview'),
        shortcut: `${MOD_KEY}+Shift+V`,
        run: () => togglePreview(),
      },
      {
        id: 'toggleTerminal',
        icon: Terminal,
        label: t('palette.toggleTerminal', 'Toggle terminal'),
        shortcut: `${MOD_KEY}+\``,
        run: () => {
          void toggleTerminal();
        },
      },
      {
        id: 'toggleSidebar',
        icon: PanelLeft,
        label: t('palette.toggleSidebar', 'Toggle sidebar'),
        shortcut: `${MOD_KEY}+B`,
        run: () => toggleSidebar(),
      },
      {
        id: 'toggleChat',
        icon: MessageSquare,
        label: t('palette.toggleChat', 'Toggle chat panel'),
        run: () => toggleChat(),
      },
      {
        id: 'lang',
        icon: Languages,
        label: t('palette.lang', 'Toggle language AR/EN'),
        run: () => setLang(lang === 'en' ? 'ar' : 'en'),
      },
      {
        id: 'openSettings',
        icon: Settings2,
        label: t('palette.openSettings', 'Open settings'),
        run: () => setSettings(true),
      },
      {
        // Real wiring: dispatch the same CustomEvent the self-contained
        // <CapabilityGuide> listens for (mirrors the open-search command).
        // No store field or fake no-op — the mounted guide opens on this event.
        id: 'openGuide',
        icon: BookOpen,
        label: t('palette.openGuide', 'Open capability guide'),
        run: () => window.dispatchEvent(new CustomEvent(OPEN_GUIDE_EVENT)),
      },
    ];
    const settings: Command[] = SETTINGS_SECTIONS.map(({ id, key, fb, icon }) => ({
      id: `settings:${id}`,
      icon,
      label: t(key, fb),
      run: () => setSettings(true, id),
    }));
    const byId: Record<GroupId, Command[]> = { workspace, modes, model, theme, view, settings, journals: journalCommands };
    return GROUPS.map(({ id }) => ({ id, commands: byId[id] }));
  }, [
    open,
    t,
    lang,
    activeTab,
    previewUrl,
    wsPath,
    openFolderDialog,
    newSession,
    toggleTerminal,
    togglePreview,
    toggleSidebar,
    toggleChat,
    setMode,
    setModelPicker,
    updateSettings,
    setLang,
    setSettings,
    setShortcuts,
    loadDna,
    sendMessage,
    saveAll,
    closeTab,
    startStaticPreview,
    notify,
    journalView,
    journalCommands,
  ]);

  // filtered per section + flat list for keyboard navigation.
  // Empty query (main view) shows the curated suggested commands — every
  // id exists in the real command list; typing searches the full set.
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections
      .map((sec) => ({
        ...sec,
        commands: q
          ? sec.commands.filter((c) => c.label.toLowerCase().includes(q))
          : journalView === 'main'
            ? sec.commands.filter((c) => SUGGESTED_IDS.has(c.id))
            : sec.commands,
      }))
      .filter((sec) => sec.commands.length > 0);
  }, [sections, query, journalView]);

  const flat = useMemo(() => filteredSections.flatMap((sec) => sec.commands), [filteredSections]);

  /** Total commands available (footer honesty: “type to search all N”). */
  const totalCommands = useMemo(
    () => sections.reduce((n, sec) => n + sec.commands.length, 0),
    [sections],
  );

  // reset on open; a genuine close returns the palette to the main list
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    } else {
      setJournalView('main');
    }
  }, [open]);

  // entering/leaving the journal submenu restarts navigation at the top row
  useEffect(() => {
    setActive(0);
  }, [journalView]);

  // keep the active index inside bounds when the list shrinks
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  // keep the active row visible
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, flat.length, open]);

  // keyboard navigation
  // v3.2 — registered on the CAPTURE phase: Escape must stopPropagation here so
  // the modal system's window-level (bubble) Escape handler never fires too —
  // Ctrl+K over Settings + Esc closes ONLY the palette, never both.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // swallow before the Modal Esc handler (bubble) sees it
        // Journal submenu: Esc steps back to the main command list first.
        if (journalView === 'journals') setJournalView('main');
        else onClose();
        return;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const c = flat[active];
        if (c) {
          // keepOpen commands navigate inside the palette (journal submenu).
          if (!c.keepOpen) onClose();
          c.run();
        }
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, flat, active, onClose, journalView]);

  if (!open) return null;

  let flatIdx = -1;

  return (
    <div
      className="scrim-glass fixed inset-0 z-[60]"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* palette row fills — matte tokens (hover fill + accent-selected) */}
      <style>{`
        .pal-row { border-radius: var(--radius-sm); margin-inline: 4px; }
        .pal-row:hover { background: var(--hover-2); }
        .pal-row[data-active='true'] { background: color-mix(in srgb, var(--acc) 10%, transparent); }
      `}</style>
      <div
        className="glass-strong anim-glass-pop w-[620px] max-w-[90vw] mt-[12vh] mx-auto flex flex-col overflow-hidden"
        style={{
          borderRadius: 'var(--radius-lg, 14px)',
          boxShadow: 'var(--sh-float)',
          border: '1px solid var(--glass-border, var(--line))',
        }}
      >
        {/* input row — command voice with the bindings that exist today */}
        <div
          className="flex items-center gap-2.5 ps-4 pe-3 h-12 shrink-0"
          style={{ borderBottom: '1px solid var(--line-soft)' }}
        >
          <Search size={14} strokeWidth={1.7} aria-hidden className="shrink-0 text-[var(--acc2)]" />
          <input
            autoFocus
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('palette.placeholder', 'Type a command…')}
            aria-label={t('palette.placeholder', 'Type a command…')}
            dir="auto"
            className="flex-1 bg-transparent outline-none text-[14px] text-[var(--ink)] placeholder:text-[var(--faint)] min-w-0"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="pal-stagger overflow-y-auto max-h-[50vh] pb-1 set-scroll">
          {filteredSections.map((sec) => (
            <div key={sec.id}>
              <div className="micro-label px-4 pt-3 pb-1 select-none" dir="auto">
                {t(GROUPS.find((g) => g.id === sec.id)?.key ?? sec.id, sec.id)}
              </div>
              {sec.id === 'journals' && journalsState !== 'ready' && (
                <div className="px-4 py-2 text-[12px] text-faint" dir="auto" role="status">
                  {journalsState === 'loading'
                    ? t('pal.journal.loading', 'Loading journals…')
                    : journalsState === 'empty'
                      ? t('pal.journal.empty', 'No run journals yet')
                      : t('pal.journal.failed', 'Could not read the journals')}
                </div>
              )}
              {sec.commands.map((c) => {
                flatIdx += 1;
                const isActive = flatIdx === active;
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    data-active={isActive || undefined}
                    className="pal-row keyrow relative w-full text-start cursor-pointer !py-0 h-9"
                    onMouseEnter={() => setActive(flatIdx)}
                    onClick={() => {
                      // keepOpen commands navigate inside the palette (journal submenu).
                      if (!c.keepOpen) onClose();
                      c.run();
                    }}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute inset-y-[5px]"
                        style={{ insetInlineStart: 0, width: 2, borderRadius: 1, background: 'var(--acc)' }}
                      />
                    )}
                    <Icon size={14} strokeWidth={isActive ? 2 : 1.7} aria-hidden className={`shrink-0 ${isActive ? 'text-acc' : 'text-dim'}`} />
                    <span className="flex-1 truncate text-[12.5px]" dir="auto">{c.label}</span>
                    {c.shortcut && <Kbd className="shrink-0 tnum">{c.shortcut}</Kbd>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="blank-state !py-8">
              <SearchX size={20} strokeWidth={1.6} className="text-faint" aria-hidden />
              <div className="bs-sub" dir="auto">{t('palette.empty', 'No matching command — try “terminal”')}</div>
            </div>
          )}
        </div>

        {/* footer — only bindings that actually exist today (App.tsx) */}
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap px-4 py-2 border-t border-line text-[10.5px] text-faint shrink-0">
          <span className="flex items-center gap-1.5">
            <Kbd className="tnum">↑↓</Kbd>
            <span dir="auto">{t('pal.nav.move', 'navigate')}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            <span dir="auto">{t('pal.nav.run', 'run')}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className="tnum">{`${MOD_KEY}+Shift+P`}</Kbd>
            <span className="tnum">·</span>
            <Kbd className="tnum">{`${MOD_KEY}+K`}</Kbd>
          </span>
          <span className="ms-auto tnum text-[10px]" dir="ltr">
            {query.trim()
              ? `${String(flat.length).padStart(2, '0')} / ${String(totalCommands).padStart(2, '0')} ${t('pal.commands', 'commands')}`
              : `${String(totalCommands).padStart(2, '0')} ${t('pal.commands', 'commands')} · ${t('pal.typeToSearch', 'type to search')}`}
          </span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
