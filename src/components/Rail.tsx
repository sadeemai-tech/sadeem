// SADEEM — FULL-WIDTH HORIZONTAL icon bar, pinned directly under the TitleBar
// and above the workspace (Claude Code / Codex style). Physical position is
// language-independent: the bar forces an LTR main axis so the primary group
// sits at the physical left and the utility group at the physical right in
// BOTH EN and AR. Tooltips are kept (native `title` + a fixed-position chip
// that survives horizontal overflow scrolling). Handlers are unchanged:
// setRail / togglePreview / toggleTerminal / setSettings / setShortcuts /
// setPlans / OPEN_SEARCH_EVENT. ('workspace' is a full section page now, so
// the old sidebar-dock toggle is no longer a rail affordance.)
import React, { useEffect, useRef, useState } from 'react';
import {
  Workflow, House, Quote, LayoutGrid, MoreHorizontal,
  Keyboard, CalendarDays, ShieldCheck, FolderOpen, Files, Settings2,
  UsersRound,
} from 'lucide-react';
import { useStore } from '../store';
import { BadgeCheck, Blocks } from 'lucide-react';
import type { RailView } from '../store';
import { useT } from '../i18n';
import {
  IcWorkspace,
  IcSessions,
  IcGit,
  IcMcp,
  IcUsage,
  IcDna,
  IcSearch,
  IcPreview,
  IcTerminal,
  type IconProps,
} from './icons';
import { OPEN_SEARCH_EVENT } from './SearchPanel';
import { OPEN_FILES_EVENT } from './ProjectFiles';
import './shell.css';

/** Store union gains 'flows' in the next store drop — widened locally. */
type RailViewEx = RailView;

type KIcon = (p: IconProps) => React.ReactElement;

/** lucide adapter — matches the in-house icon contract (returns ReactElement). */
const IcFlows: KIcon = (p) => (
  <Workflow size={p.size} className={p.className} strokeWidth={p.strokeWidth} style={p.style} />
);
const IcSkills: KIcon = (p) => (
  <Blocks size={p.size} className={p.className} strokeWidth={p.strokeWidth} style={p.style} />
);
const IcLibrary: KIcon = (p) => (
  <svg viewBox="0 0 24 24" width={p?.size ?? 16} height={p?.size ?? 16} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IcArtifacts: KIcon = (p) => (
  <BadgeCheck size={p.size} className={p.className} strokeWidth={p.strokeWidth} style={p.style} />
);
// v10 — Home (first rail item)
const IcHome: KIcon = (p) => (
  <House size={p.size} className={p.className} strokeWidth={p.strokeWidth} style={p.style} />
);
// v11.6 — Prompt Library (13)
const IcPrompts: KIcon = (p) => (
  <Quote size={p.size} className={p.className} strokeWidth={p.strokeWidth} style={p.style} />
);
// v11.31 — Subagents (15) is its OWN view. The old More-menu entry borrowed
// the terminal glyph, which read as "open terminal" — a wrong icon/target.
const IcSubagents: KIcon = (p) => (
  <UsersRound size={p.size} className={p.className} strokeWidth={p.strokeWidth} style={p.style} />
);
// v1142 — Repo Wiki is NOT a separate rail item any more. It was only ever
// LibraryPanel with initialTab="wiki"; the visible home is the "Repo Wiki" tab
// inside the Library rail. Removing it from MORE keeps the flyout honest.

interface RailItem {
  view: RailViewEx;
  icon: KIcon;
  no: string;
  labelKey: string;
  labelFallback: string;
}

// primary views (left cluster)
const PRIMARY: RailItem[] = [
  { view: 'home', icon: IcHome, no: '00', labelKey: 'rail.home', labelFallback: 'Home' },
  { view: 'workspace', icon: IcWorkspace, no: '01', labelKey: 'rail.workspace', labelFallback: 'Workspace' },
  { view: 'sessions', icon: IcSessions, no: '02', labelKey: 'rail.sessions', labelFallback: 'Sessions' },
  { view: 'git', icon: IcGit, no: '03', labelKey: 'rail.git', labelFallback: 'Source control' },
];

// everything else lives in the "More" flyout
const MORE: RailItem[] = [
  { view: 'mcp', icon: IcMcp, no: '04', labelKey: 'rail.mcp', labelFallback: 'MCP tools' },
  { view: 'usage', icon: IcUsage, no: '05', labelKey: 'rail.usage', labelFallback: 'Usage' },
  { view: 'dna', icon: IcDna, no: '06', labelKey: 'rail.dna', labelFallback: 'DNA' },
  { view: 'flows', icon: IcFlows, no: '07', labelKey: 'rail.flows', labelFallback: 'Flows' },
  { view: 'skills', icon: IcSkills, no: '08', labelKey: 'rail.skills', labelFallback: 'Skills' },
  { view: 'artifacts', icon: IcArtifacts, no: '09', labelKey: 'rail.artifacts', labelFallback: 'Artifacts' },
  { view: 'library', icon: IcLibrary, no: '10', labelKey: 'rail.library', labelFallback: 'Library' },
  { view: 'prompts', icon: IcPrompts, no: '13', labelKey: 'rail.prompts', labelFallback: 'Prompts' },
  { view: 'subagents', icon: IcSubagents, no: '15', labelKey: 'rail.subagents', labelFallback: 'Subagents' },
  { view: 'signature', icon: IcDna, no: '16', labelKey: 'rail.signature', labelFallback: 'Signature' },
  { view: 'proof', icon: IcPreview, no: '17', labelKey: 'rail.proof', labelFallback: 'Proof Center' },
];

/** Event the settings modal listens to for a deep link (section: 'security'). */
export const OPEN_SETTINGS_EVENT = 'surnia:open-settings';

interface RailButtonProps {
  label: string;
  no?: string | null;
  active?: boolean;
  ariaCurrent?: 'page';
  ariaExpanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

/** One flat icon button. Keeps both tooltip forms: native `title` (always
 *  available, even while the bar scrolls) and a fixed-position chip that is
 *  not clipped by the scroll container's overflow. */
function RailButton({
  label,
  no,
  active,
  ariaCurrent,
  ariaExpanded,
  onClick,
  children,
  badge,
}: RailButtonProps) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const showTip = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  return (
    <button
      type="button"
      className={`rail-bar-btn group relative h-8 w-9 shrink-0 flex items-center justify-center rounded-md cursor-pointer transition-colors duration-150 ${
        active ? 'text-acc' : 'text-dim hover:text-ink hover:bg-[var(--hover)]'
      }`}
      title={label}
      aria-label={label}
      aria-current={ariaCurrent}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      onMouseEnter={(e) => showTip(e.currentTarget)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => showTip(e.currentTarget)}
      onBlur={() => setTip(null)}
    >
      {children}
      {badge}
      {tip && (
        <span
          aria-hidden
          className="rail-bar-tip pointer-events-none fixed z-[90] flex items-center gap-1.5 whitespace-nowrap caps text-[11px] tracking-[0.08em]"
          style={{
            left: tip.x,
            top: tip.y,
            transform: 'translateX(-50%)',
            background: 'var(--bg3)',
            color: 'var(--ink)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line-strong)',
            boxShadow: 'var(--sh-float)',
          }}
        >
          {no && (
            <span className="tnum" style={{ color: 'var(--clay)', fontSize: 9 }}>
              {no}
            </span>
          )}
          {label}
        </span>
      )}
    </button>
  );
}

export function Rail() {
  const t = useT();
  const rail = useStore((s) => s.rail) as RailViewEx;
  const terminalOpen = useStore((s) => s.terminalOpen);
  const previewOpen = useStore((s) => s.previewOpen);
  const gitDirty = useStore((s) => (s.git ? s.git.changed.length > 0 : false));
  const setRail = setRailOf(useStore((s) => s.setRail));
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const togglePreview = useStore((s) => s.togglePreview);
  const setSettings = useStore((s) => s.setSettings);
  const setPlans = useStore((s) => s.setPlans);
  const setShortcuts = useStore((s) => s.setShortcuts);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);

  /**
   * A rail click must ALWAYS reveal the clicked section. Live preview is a
   * transient overlay that App renders on top of every stage rail; leaving it
   * open made every item in the More menu look dead. Clear it on navigate.
   */
  const navigate = (view: RailViewEx) => {
    setPreviewOpen(false);
    setRail(view);
  };

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [morePos, setMorePos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Every non-Home rail is a STAGE rail: App renders its RightDock page
  // regardless of `sidebarOpen`. Highlighting by `rail === view` alone keeps
  // the active mark honest when Ctrl+B (sidebar) is toggled — previously the
  // mark vanished while the section was still on screen.
  const moreActive = MORE.some((m) => m.view === rail);

  // The rail is a horizontal scroll container (overflow-x:auto / overflow-y:hidden),
  // which CLIPS any absolutely-positioned child that extends below the 44px bar.
  // That is why the flyout never appeared. Anchor it to the viewport instead,
  // using the button's live rect, so it always sits below the top bar in EN + AR.
  const toggleMore = () => {
    if (moreOpen) {
      setMoreOpen(false);
      return;
    }
    const r = moreRef.current?.getBoundingClientRect();
    if (r) {
      setMorePos({
        top: r.bottom + 8,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 268)),
      });
    }
    setMoreOpen(true);
  };

  // Esc dismisses the flyout too (outside click + selection are handled below).
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <nav
      className="app-rail-bar-v13"
      style={{ background: 'var(--bg1)' }}
      aria-label={t('app.name', 'SADEEM')}
    >
      <div className="rail-bar-scroll">
        {/* LEFT group — primary views + More */}
        <div className="rail-bar-group">
          {PRIMARY.map(({ view, icon: Icon, no, labelKey, labelFallback }) => {
            // 'home' lives on the stage (no sidebar) — active whenever selected.
            // 'workspace' stays highlighted while a file is open in the editor:
            // the editor is an extension of the workspace, not a separate place.
            const active =
              view === 'home'
                ? rail === 'home'
                : view === 'workspace'
                  ? rail === 'workspace' || rail === 'editor'
                  : rail === view;
            const label = t(labelKey, labelFallback);
            return (
              <RailButton
                key={view}
                no={no}
                label={label}
                active={active}
                ariaCurrent={active ? 'page' : undefined}
                onClick={() => navigate(view)}
                badge={
                  view === 'git' && gitDirty ? (
                    <span className="rail-bar-dot" aria-hidden />
                  ) : null
                }
              >
                <Icon size={18} strokeWidth={active ? 2 : 1.7} />
              </RailButton>
            );
          })}

          {/* SECOND ACCESS POINT — a compact project-files drawer. Opens the
              same tree directly from any surface, including the editor, without
              duplicating a second full files page. */}
          <RailButton
            label={t('rail.files', 'Files · project files')}
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FILES_EVENT))}
          >
            <Files size={18} strokeWidth={1.7} />
          </RailButton>

          {/* "More" opens the full section flyout */}
          <div className="rail-bar-more relative" ref={moreRef}>
            <RailButton
              label={t('rail.more', 'More views')}
              active={moreActive}
              ariaExpanded={moreOpen}
              onClick={toggleMore}
            >
              <MoreHorizontal size={18} />
            </RailButton>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-[79]" onClick={() => setMoreOpen(false)} aria-hidden />
                <div
                  className="rail-flyout-v12 anim-glass-pop"
                  role="menu"
                  style={{
                    position: 'fixed',
                    top: morePos.top,
                    left: morePos.left,
                    insetInlineStart: 'auto',
                  }}
                >
                  <div className="rail-fly-head">
                    <LayoutGrid size={13} className="text-acc" />
                    <span className="text-[12px] font-semibold text-ink">
                      {t('rail.more.title', 'All views · كل الأقسام')}
                    </span>
                  </div>
                  <div className="rail-fly-grid">
                    {MORE.map(({ view, icon: Icon, no, labelKey, labelFallback }) => {
                      const active = rail === view;
                      const label = t(labelKey, labelFallback);
                      return (
                        <button
                          key={view}
                          type="button"
                          role="menuitem"
                          data-testid={`rail-more-${view}`}
                          className={`rail-fly-item ${active ? 'is-active' : ''}`}
                          onClick={() => {
                            navigate(view);
                            setMoreOpen(false);
                          }}
                        >
                          <Icon size={14} />
                          <span className="flex-1 min-w-0 truncate">{label}</span>
                          <span className="rail-fly-no">{no}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="rail-fly-utils">
                    <span className="rail-fly-label caps">{t('rail.more.utilities', 'Utilities')}</span>
                    <div className="rail-fly-grid rail-fly-utils-grid">
                      <button
                        type="button"
                        role="menuitem"
                        className="rail-fly-util"
                        onClick={() => {
                          setShortcuts(true);
                          setMoreOpen(false);
                        }}
                      >
                        <Keyboard size={13} aria-hidden />
                        <span className="truncate">{t('rail.shortcuts', 'Shortcuts')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rail-fly-util"
                        onClick={() => {
                          setPlans(true);
                          setMoreOpen(false);
                        }}
                      >
                        <CalendarDays size={13} aria-hidden />
                        <span className="truncate">{t('rail.plans', 'Plans')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rail-fly-util"
                        onClick={() => {
                          setSettings(true, 'security');
                          setMoreOpen(false);
                        }}
                      >
                        <ShieldCheck size={13} aria-hidden />
                        <span className="truncate">{t('set.group.privacy', 'Security')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rail-fly-util"
                        onClick={() => {
                          // v14 — the file tree is a full section page now, so
                          // "Files" navigates to it instead of toggling a dock.
                          navigate('workspace');
                          setMoreOpen(false);
                        }}
                      >
                        <FolderOpen size={13} aria-hidden />
                        <span className="truncate">{t('rail.workspace', 'Workspace')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rail-bar-spacer" />

        {/* RIGHT group — utilities */}
        <div className="rail-bar-group rail-bar-right">
          <RailButton
            label={t('rail.search', 'Search in files')}
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))}
          >
            <IcSearch size={18} />
          </RailButton>
          <RailButton
            label={t('rail.preview', 'Live preview')}
            active={previewOpen}
            onClick={togglePreview}
            badge={previewOpen ? <RailActiveDot /> : null}
          >
            <IcPreview size={18} strokeWidth={previewOpen ? 2 : 1.7} />
          </RailButton>
          <RailButton
            label={t('rail.terminal', 'Toggle terminal')}
            active={terminalOpen}
            onClick={() => void toggleTerminal()}
            badge={terminalOpen ? <RailActiveDot /> : null}
          >
            <IcTerminal size={18} strokeWidth={terminalOpen ? 2 : 1.7} />
          </RailButton>
          <RailButton label={t('rail.settings', 'Settings')} onClick={() => setSettings(true)}>
            {/* BUG FIX — the hand-drawn gear read as a malformed shape at 21px.
                Settings2 (sliders-in-gear) is the recognizable settings icon. */}
            <Settings2 size={18} strokeWidth={1.8} aria-hidden />
          </RailButton>
        </div>
      </div>
    </nav>
  );
}

/** Tiny accent dot at the button's top-right edge: "this surface is open". */
function RailActiveDot() {
  return <span className="rail-bar-dot" aria-hidden />;
}

/** Widen setRail for the local 'flows' placeholder until the store union
 *  includes it (RailViewEx ⊃ RailView keeps the cast legal both ways). */
function setRailOf(fn: (v: RailView) => void): (v: RailViewEx) => void {
  return fn as (v: RailViewEx) => void;
}

export default Rail;
