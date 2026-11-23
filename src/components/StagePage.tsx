// ============================================================
// SADEEM v11 — STAGE PAGE
// Feature panels are full center-stage pages (Codex/OpenCode-style),
// not 320px docks. This wrapper gives every stage rail the same
// page contract: numbered contract header, generous padding, a
// centered max-width content column (no dead gutters), and its own
// scroll container. RTL mirrors automatically via logical layout.
// ============================================================
import React from 'react';
import { useStore } from '../store';
import type { RailView } from '../store';
import { useT } from '../i18n';
import { PANELS, RAIL_NO, RAIL_TITLE } from './panels/registry';

export function StagePage({ rail }: { rail: RailView }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const title = t(RAIL_TITLE[rail].key, RAIL_TITLE[rail].fb);
  // Defensive: 'home' has no stage panel and 'editor' is rendered by App's
  // work area. Never let a stale rail value crash this wrapper.
  const ActivePanel = PANELS[rail] ?? (() => null);

  return (
    <div className="stage-page flex-1 min-w-0 min-h-0 flex flex-col">
      {/* page header — same numbered contract as the old dock header */}
      <div className="stage-head shrink-0 flex items-center gap-2.5" style={{ paddingInline: 22, paddingTop: 14, paddingBottom: 10 }}>
        <div className="sec-titled flex-1 min-w-0" style={{ marginBottom: 0 }}>
          <span className="sec-no">{RAIL_NO[rail]}</span>
          <span className="sec-tt truncate" dir="auto">{title}</span>
          <span className="sec-rule" />
        </div>
      </div>
      {/* centered content column — panels stretch, no dead whitespace */}
      <div className="flex-1 min-h-0 overflow-y-auto stage-scroll">
        <div className="stage-col" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <ActivePanel />
        </div>
      </div>
    </div>
  );
}

export default StagePage;
