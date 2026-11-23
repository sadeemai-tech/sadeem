// SADEEM — shared section-page header (v14).
// Every section page opens with the SAME rhythm: an eyebrow, a clear
// title, one honest description line and a right-aligned actions row.
// Purely presentational — it owns no store state, so it is safe to drop
// into any panel. Visuals live in pages.css under the `.pv14-head` hook.
import React from 'react';

export function PageHead({
  eyebrow,
  title,
  description,
  actions,
  meta,
  toolbar,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Optional second row of quiet metadata (paths, counts, status). */
  meta?: React.ReactNode;
  /** Optional toolbar rendered inside the header's actions row. */
  toolbar?: React.ReactNode;
}) {
  return (
    <header className="pv14-head">
      <div className="pv14-head-copy">
        <span className="pv14-eyebrow" dir="auto">{eyebrow}</span>
        <h2 className="pv14-title" dir="auto">{title}</h2>
        {description && <p className="pv14-desc" dir="auto">{description}</p>}
        {meta && <div className="pv14-head-meta">{meta}</div>}
      </div>
      {(actions || toolbar) && (
        <div className="pv14-head-actions">
          {toolbar}
          {actions}
        </div>
      )}
    </header>
  );
}

export default PageHead;
