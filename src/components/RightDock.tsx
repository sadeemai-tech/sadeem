// ============================================================
// SADEEM v13 — UNIFIED RIGHT DOCK
// ONE coherent, full-height surface for every section. Replaces the old
// two-surface model (a floating `m-2` sidebar card + a centered "stage
// page") that made sections appear to pop up awkwardly in the middle.
//
// Layout contract (v14/v11.31 — chat LEFT, rail TOP):
//   TitleBar → full-width horizontal Rail (TOP)
//   app-main-row → [ chat LEFT ] [ work area: this dock (RIGHT) + editor ]
// The rail is NOT a far-right column any more. This dock lives inside the
// work area to the right of the chat slot; it never owns the window chrome.
// No floating card margins, no dead gutters, one header, one scroll area.
// ============================================================
import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useStore } from '../store';
import type { RailView } from '../store';
import { useT } from '../i18n';
import { PANELS, RAIL_NO, RAIL_TITLE } from './panels/registry';
import { IconBtn } from './ui';
import './sections.css';

export function RightDock({ rail }: { rail: RailView }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const setRail = useStore((s) => s.setRail);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  // The live-preview overlay is painted above every stage rail. Leaving it
  // open made both dock navigation controls look dead. Clear it on navigate.
  const closeSection = () => {
    setPreviewOpen(false);
    setRail('home');
  };
  const goWorkspace = () => {
    setPreviewOpen(false);
    setRail('workspace');
  };
  const title = t(RAIL_TITLE[rail].key, RAIL_TITLE[rail].fb);
  const ActivePanel = PANELS[rail] ?? (() => null);
  const rtl = lang === 'ar';
  const CollapseIcon = rtl ? (ChevronRight) : (ChevronLeft);

  return (
    <section
      className="right-dock-v13 flex flex-col min-w-0 min-h-0 flex-1"
      dir={rtl ? 'rtl' : 'ltr'}
      aria-label={title}
    >
      {/* single, consistent section header */}
      <header className="rd-head shrink-0 flex items-center gap-3">
        <span className="rd-no" aria-hidden>{RAIL_NO[rail]}</span>
        <div className="rd-title-wrap min-w-0 flex-1">
          <h2 className="rd-title truncate" dir="auto">{title}</h2>
        </div>
        <IconBtn
          className="rd-head-btn"
          data-testid="dock-close"
          // 'palette.toggleSidebar' actually says "Toggle sidebar" in both
          // languages — using it here mislabelled this control. The shared
          // 'shortcuts.close' key gives an honest, bilingual "Close".
          title={t('shortcuts.close', 'Close section')}
          aria-label={t('shortcuts.close', 'Close section')}
          onClick={closeSection}
        >
          <X size={15} />
        </IconBtn>
      </header>

      {/* content: one scroll container, flush, generous but not centred-away */}
      <div className="rd-body flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="rd-content rd-page-v13">
          <ActivePanel />
        </div>
      </div>

      {/* back-to-workspace affordance when viewing a non-workspace section */}
      {rail !== 'workspace' && (
        <button
          className="rd-back shrink-0"
          onClick={goWorkspace}
          title={t('rail.workspace', 'Workspace')}
        >
          <CollapseIcon size={13} />
          <span>{t('rail.workspace', 'Workspace')}</span>
        </button>
      )}
    </section>
  );
}

export default RightDock;
