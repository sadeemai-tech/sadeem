'use client';
import type { ReactNode } from 'react';

export function Eyebrow({ children }: { children: ReactNode }) { return <span className="eyebrow">{children}</span>; }
export function SectionHead({ eyebrow, title, lead, action }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="row" style={{ alignItems:'flex-end', justifyContent:'space-between', marginBottom:32 }}>
      <div style={{ maxWidth:760 }}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="h2">{title}</h2>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {action}
    </div>
  );
}
export function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return <div className="card card-flat" style={{ padding:'20px 22px' }}>
    <div className="mono" style={{ fontSize:30, color:'var(--acc)', lineHeight:1.1 }}>{value}</div>
    <div style={{ fontWeight:600, marginTop:8 }}>{label}</div>
    {hint && <div className="faint" style={{ fontSize:13, marginTop:4 }}>{hint}</div>}
  </div>;
}
export function FeatureCard({ icon, title, body, tag }: { icon: ReactNode; title: string; body: string; tag?: string }) {
  return <article className="card card-accent">
    <div className="row" style={{ justifyContent:'space-between' }}>
      <div style={{ width:42, height:42, display:'grid', placeItems:'center', borderRadius:10, background:'var(--acc-soft)', color:'var(--acc)' }}>{icon}</div>
      {tag && <span className="pill">{tag}</span>}
    </div>
    <h3 className="h3" style={{ marginTop:18 }}>{title}</h3>
    <p className="muted" style={{ margin:'8px 0 0', fontSize:15 }}>{body}</p>
  </article>;
}
