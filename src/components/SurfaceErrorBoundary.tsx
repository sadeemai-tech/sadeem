// v11.12 (C5-CONTAIN) — PER-SURFACE ErrorBoundary.
//
// The root BootErrorBoundary (main.tsx) catches a crash by unmounting the
// ENTIRE app into the full-screen recovery card — one bad panel (a malformed
// diff, a broken SVG, a Monaco edge case) used to take the whole IDE down,
// which the founder experienced as "the app stops everything suddenly".
// This boundary CONTAINS the blast radius: only the crashed surface shows a
// small inline fallback and every other surface keeps working.
import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Which surface is guarded (shown in the fallback + the log line). */
  surface: string;
  /** Compact fallback height for panels vs full panes. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

export class SurfaceErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      void window.surnia?.log(3, `surface-crash[${this.props.surface}]: ${error.stack ?? error.message}`);
    } catch {
      /* preload not ready — window.onerror still forwards it */
    }
    void info;
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const ar = true; // bilingual text below — AR first, EN second
    return (
      <div
        role="alert"
        style={{
          width: '100%',
          height: this.props.compact ? 'auto' : '100%',
          minHeight: this.props.compact ? 0 : 120,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 16,
          background: 'var(--panel, #232A2E)',
          color: 'var(--dim, #979794)',
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--warn, #c9a488)' }}>
          {ar ? `تعذّر عرض هذا القسم (${this.props.surface}) — بقية التطبيق تعمل` : `This surface crashed (${this.props.surface}) — the rest of the app keeps running`}
        </div>
        <div style={{ fontSize: 10.5, opacity: 0.7, maxWidth: 560, wordBreak: 'break-all', fontFamily: 'monospace' }}>
          {this.state.error.message}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: '4px 14px',
            borderRadius: 7,
            border: '1px solid var(--line, #3A454B)',
            background: 'var(--panel2, #2E383D)',
            color: 'var(--ink, #D5DEE2)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {ar ? 'أعد المحاولة' : 'Retry'}
        </button>
      </div>
    );
  }
}
