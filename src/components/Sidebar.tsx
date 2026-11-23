// SADEEM — legacy resizable side drawer (kept as a safe fallback surface).
// v11.31 layout contract: chat LEFT, rail TOP. Every non-Home rail is a
// STAGE rail (panels/registry.tsx STAGE_RAILS), so App renders its full-page
// RightDock in the work area and NOT this drawer. This component therefore
// has no live rail today; it stays mounted in the bundle because App still
// imports it as a fallback. Do not add new rails here — add them to the
// stage registry. The drag-resize/persistence logic below is preserved
// intact for that fallback role (240-520px, RTL-aware, double-click reset).
import React, { useEffect, useRef, useState } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { useStore } from '../store';
import type { RailView } from '../store';
import { useT } from '../i18n';
import { IconBtn } from './ui';
import { PANELS, RAIL_NO, RAIL_TITLE } from './panels/registry';
import './sections.css';

/** Width contract (px) — per-rail defaults + drag clamps. 'home' never docks. */
const MIN_W = 300; // v12 — wider, calmer sections dock
const MAX_W = 640;
const DEFAULT_W: Record<RailView, number> = {
  home: 380,
  signature: 460, // v11.38 (G7) — original SADEEM signature features page
  proof: 520, // v11.43 — Proof Center ledger
  workspace: 460,
  sessions: 400,
  git: 420,
  mcp: 400,
  usage: 420,
  dna: 400,
  flows: 420,
  skills: 400,
  artifacts: 420,
  library: 460,
  wiki: 500,
  prompts: 460,
  search: 460,
  subagents: 460,
  editor: 460,
};

export function Sidebar() {
  const t = useT();
  const rail = useStore((s) => s.rail) as RailView;
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const asideRef = useRef<HTMLElement | null>(null);

  // persisted width — one shared value that overrides the current rail default
  const persistedW = useStore((s) => s.settings.ui?.sidebarWidth);

  // drag state: live width while dragging + the pointer session bookkeeping
  const [dragW, setDragW] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const lastWRef = useRef<number>(0);

  const width = dragW ?? persistedW ?? DEFAULT_W[rail];
  const clampW = (w: number): number => Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));

  const persistWidth = (w: number | undefined): void => {
    // updateSettings shallow-merges — spread the existing ui object
    // (same contract as AppearanceSection.patchUi)
    const ui = useStore.getState().settings.ui ?? {};
    useStore.getState().updateSettings({ ui: { ...ui, sidebarWidth: w } });
  };

  // ---- resize handle: pointer capture, RTL-aware inline-end drag ----
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const rect = asideRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startW: width,
    };
    lastWRef.current = width;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    // v12 — the dock sits on the physical RIGHT; its handle is the LEFT edge
    // so dragging left (toward the editor) widens, in every language.
    const delta = d.startX - e.clientX;
    const w = clampW(d.startW + delta);
    lastWRef.current = w;
    setDragW(w);
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    setDragW(null);
    persistWidth(lastWRef.current);
  };

  // double-click: drop the persisted width → per-rail default resumes
  const onResizeReset = (): void => persistWidth(undefined);

  // while dragging: pin the cursor and stop text selections leaking mid-gesture
  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  const title = t(RAIL_TITLE[rail].key, RAIL_TITLE[rail].fb);
  const ActivePanel = PANELS[rail];

  return (
    // AURORA — the dock reads as a floating panel: 10px radius, hairline
    // border, top-light fill, soft card shadow. The resize strip keeps its
    // inline-end anchor (it sits in the gap outside the rounded panel).
    <aside
      ref={asideRef}
      className={`sidebar-overlay-v13 flex flex-col min-h-0 min-w-0 ${
        dragging ? 'transition-none' : 'transition-[width,transform] duration-200'
      }`}
      style={{ width }}
      aria-label={title}
    >
      <div className="rd-head shrink-0 flex items-center gap-3">
        <div className="sec-titled flex-1 min-w-0" style={{ marginBottom: 0 }} title={title}>
          {/* the number chip yields first when the dock gets tight.
              v2.6 RTL: dir=auto on the localized title — Arabic rail names
              render RTL and Latin ones LTR regardless of the dock's base dir. */}
          {width >= 280 && <span className="sec-no">{RAIL_NO[rail]}</span>}
          <span className="sec-tt truncate" dir="auto">{title}</span>
          <span className="sec-rule" />
        </div>
        <IconBtn
          className="shrink-0"
          title={t('palette.toggleSidebar', 'Toggle sidebar')}
          aria-label={t('palette.toggleSidebar', 'Toggle sidebar')}
          onClick={toggleSidebar}
        >
          <PanelLeftClose size={15} />
        </IconBtn>
      </div>

      <div className="rd-body flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="rd-content rd-page-v13">
          <ActivePanel />
        </div>
      </div>

      {/* v12 — resize hit-strip on the PHYSICAL LEFT edge (the dock is on the
          right, beside the editor). Sits above content, below tooltips. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resizeHint', 'Drag to resize')}
        aria-valuenow={width}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        title={t('sidebar.resizeHint', 'Drag to resize')}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={onResizeReset}
        className="group absolute top-0 bottom-0 z-30 cursor-col-resize select-none touch-none"
        style={{ left: -6, width: 9 }}
      >
        <span
          aria-hidden
          className={`absolute top-3 bottom-3 w-px transition-colors duration-150 rounded-full ${
            dragging ? 'bg-[var(--acc)]' : 'bg-transparent group-hover:bg-[var(--line-strong)]'
          }`}
          style={{ left: 4 }}
        />
      </div>
    </aside>
  );
}

export default Sidebar;
