// ============================================================
// SADEEM (E4) — Security panel.
// Centered protection-status instrument: terminal guard, log
// redaction counter, FS symlink guards, audit trail (live via
// kdx:sec:event) and data-control quick actions.
//
// INTEGRATION: this component is EXPORTED for mounting by the
// shell (Rail/SettingsModal) — it deliberately does NOT register
// itself anywhere. "Open privacy settings" dispatches a
// window CustomEvent `surnia:open-settings` {detail:{section}} —
// wire that event (or navigate directly) in the owning shell.
//
// DEFENSIVE: every bridge call goes through secInvoke/secOn; a
// preload bundle missing the new security channels degrades to
// "unavailable" rows instead of crashing the panel.
//
// v11.12 FINAL POLISH — editorial head + gate/envelope plate with
// a hairline comb and a REAL verdict tally. Behaviour untouched.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, Eraser, FolderLock, ScrollText, Settings2, ShieldCheck, TerminalSquare } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, Chip } from '../ui';
import './security-art.css';
import './panel-craft.css';

// ---------------- defensive bridge ----------------
type AnyBridge = Record<string, unknown> | undefined;

function bridge(): AnyBridge {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { surnia?: AnyBridge; kodex?: AnyBridge };
  return w.surnia ?? w.kodex;
}

/** Invoke a preload API defensively — null when bridge/method missing or it rejects. */
export async function secInvoke<T>(method: string, ...args: unknown[]): Promise<T | null> {
  try {
    const fn = bridge()?.[method];
    if (typeof fn !== 'function') return null;
    return await (fn as (...a: unknown[]) => Promise<T>)(...args);
  } catch {
    return null;
  }
}

/** Subscribe via a preload event method (onSecurityEvent / onTermBlocked / …). */
export function secOn(method: string, cb: (payload: unknown) => void): () => void {
  try {
    const fn = bridge()?.[method];
    if (typeof fn !== 'function') return () => undefined;
    const off = (fn as (cb: (p: unknown) => void) => unknown)(cb);
    return typeof off === 'function' ? (off as () => void) : () => undefined;
  } catch {
    return () => undefined;
  }
}

// ---------------- shared security types ----------------
export type GuardModeValue = 'on' | 'warn-only' | 'off';

/** Renderer view of the `kdx:sec:status` payload. */
export interface SecurityStatus {
  terminalGuard: GuardModeValue;
  fsConfinement: boolean;
  allowedRoots: string[];
  redactionsThisSession: number;
  blockedCommands: number;
  auditCount: number;
  secretsStored: number;
  safeStorage: { available: boolean; backend: string | null };
}

/** One line of audit.jsonl (kdx:sec:auditRecent / kdx:sec:event). */
export interface AuditEntry {
  ts: string;
  kind: string;
  detail?: unknown;
}

const AUDIT_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'acc' | 'default'> = {
  term_blocked: 'bad',
  fs_block: 'bad',
  secret_redacted: 'warn',
  term_allow: 'ok',
  permission: 'acc',
  mcp_approval: 'acc',
};

/**
 * v11.38 — the audit trail is redacted at the main-process boundary, but the
 * renderer must NOT trust that as its only line of defence: a stale audit file
 * written by an older build (or a hand-edited one) could still hold a key.
 * Scrub common credential shapes before ANY audit text reaches the DOM.
 */
export function redactForDisplay(s: string): string {
  let out = String(s ?? '');
  out = out.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, (m) => `sk-…${m.slice(-4)}`);
  out = out.replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{12,}\b/g, '«redacted»');
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '«redacted»');
  out = out.replace(/AIza[A-Za-z0-9_-]{10,}/g, '«redacted»');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer «redacted»');
  out = out.replace(
    /\b((?:api[-_]?key|apikey|password|passwd|pwd|secret|token)["']?\s*[:=]\s*)(["']?)[A-Za-z0-9._~+/=-]{6,}\2/gi,
    '$1«redacted»',
  );
  return out;
}

function detailText(d: unknown): string {
  if (d == null) return '';
  if (typeof d === 'string') return redactForDisplay(d);
  try {
    return redactForDisplay(
      Object.entries(d as Record<string, unknown>)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v)?.slice(0, 40) ?? ''}`)
        .join('  '),
    );
  } catch {
    return redactForDisplay(String(d));
  }
}

function timeOf(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

/* ------------------------------------------------------------------ *
 * ORIGINAL 1px GLYPH — a gate with two teeth and a seal dot.
 * ------------------------------------------------------------------ */
function SecurityGlyph() {
  return (
    <svg className="ed-glyph" viewBox="0 0 72 34" fill="none" stroke="currentColor"
      strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 29V13a16 16 0 0 1 32 0v16" />
      <path d="M14 29h44M27 29V17l9-6 9 6v12" />
      <path d="M24 7v4M36 4v4M48 7v4" />
      <circle cx="36" cy="23" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * THE GATE / ENVELOPE — a classified letter passing a hairline comb
 * of teeth, with a real verdict tally on the right. Every number is
 * read from the live kdx:sec:status payload (or '—' if unavailable).
 * ------------------------------------------------------------------ */
function SecurityGate({ status, auditCount, t, lang }: {
  status: SecurityStatus | null;
  auditCount: number;
  t: (k: string, fb?: string) => string;
  lang: string;
}) {
  const L = (en: string, ar: string) => t(en, lang === 'ar' ? ar : en);
  const verdicts: { label: string; value: string; n: number | null }[] = [
    { label: L('security.verdict.events', 'EVENTS'), value: String(auditCount), n: auditCount },
    {
      label: L('security.verdict.blocked', 'BLOCKED'),
      value: status ? String(status.blockedCommands) : '—',
      n: status?.blockedCommands ?? null,
    },
    {
      label: L('security.verdict.redacted', 'REDACTED'),
      value: status ? String(status.redactionsThisSession) : '—',
      n: status?.redactionsThisSession ?? null,
    },
  ];

  return (
    <figure className="sec-gate">
      <div className="sec-gate-head">
        <span className="ed-mono">{L('security.gate.label', 'بوابة التصنيف / CLASSIFIER GATE')}</span>
        <span className="ed-mono sec-gate-mode" dir="ltr">
          {status ? status.terminalGuard.toUpperCase() : L('security.gate.offline', 'OFFLINE')}
        </span>
      </div>
      <svg viewBox="0 0 600 190" preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={L('security.gate.a11y', 'Gate diagram with a real verdict tally')}>
        <g className="sec-gate-ink" fill="none" stroke="currentColor" strokeWidth="1">
          {/* envelope body */}
          <rect className="sec-draw" pathLength={1} x="18" y="30" width="278" height="128" />
          {/* the comb: EVENLY spaced hairline classification teeth.
              Envelope spans x=18..296 (width 278); 24 teeth at the exact
              cell centres (i+½)·278/24 leave equal side margins — the old
              28 + i·12.4 left a 7.6px sliver on the right. */}
          <g className="sec-teeth">
            {Array.from({ length: 24 }, (_, i) => {
              const x = 18 + ((i + 0.5) * 278) / 24;
              const major = i % 4 === 0;
              return <line key={i} className="craft-draw" pathLength={1}
                style={{ animationDelay: `${(i % 6) * 60}ms` }}
                x1={x} y1="30" x2={x} y2={major ? 46 : 39} opacity={major ? 1 : .55} />;
            })}
          </g>
          {/* flap + back folds */}
          <path className="sec-draw" pathLength={1} d="M18 30 157 110 296 30" style={{ animationDelay: '160ms' }} />
          <path d="M18 158 96 110M296 158 218 110" opacity=".45" />
          <circle className="sec-seal" cx="157" cy="110" r="13" />
          <path d="M151 110l4 4 8-9" stroke="var(--acc)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* verdict tally */}
        <g className="sec-tally">
          <text className="sec-tally-title" x="330" y="40">{L('security.verdict.title', 'VERDICT TALLY')}</text>
          {verdicts.map((v, i) => {
            const y = 72 + i * 40;
            return (
              <g key={v.label} style={{ animationDelay: `${180 + i * 110}ms` }} className="sec-tally-row">
                <text className="sec-tally-label" x="330" y={y + 4}>{v.label}</text>
                <line className="sec-draw" pathLength={1} x1="438" y1={y} x2="540" y2={y} />
                <g className="sec-marks">
                  {Array.from({ length: v.n === null ? 0 : Math.min(v.n, 8) }, (_, k) => (
                    <line key={k} x1={446 + k * 7} y1={y - 6} x2={446 + k * 7} y2={y + 6} />
                  ))}
                </g>
                <text className="sec-tally-value" x="588" y={y + 4} textAnchor="end">{v.value}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption className="ed-mono sec-gate-cap">
        {L('security.gate.hint', 'every shell line is classified before it runs · counts are live')}
      </figcaption>
    </figure>
  );
}

// ---------------- status row ----------------
function StatusRow({ icon, label, value, tone, title }: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'acc' | 'default';
  title?: string;
}) {
  return (
    <div className="sec-row" title={title}>
      <span className="sec-row-icon">{icon}</span>
      <span className="sec-row-label">{label}</span>
      <Chip tone={tone}>{value}</Chip>
    </div>
  );
}

// ---------------- panel ----------------
export function SecurityPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const L = (en: string, ar: string): string => t(en, lang === 'ar' ? ar : en);
  const notify = useStore((s) => s.notify);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [events, setEvents] = useState<AuditEntry[]>([]);

  const refresh = useCallback(async () => {
    const st = await secInvoke<SecurityStatus>('secStatus');
    if (st) setStatus(st);
    const ev = await secInvoke<AuditEntry[]>('secAuditRecent', 30);
    if (ev) setEvents(ev);
  }, []);

  useEffect(() => {
    void refresh();
    const iv = window.setInterval(() => void refresh(), 6000); // poll — preload channels may be absent
    const offSec = secOn('onSecurityEvent', (p) => {
      const e = p as AuditEntry;
      if (e && typeof e.ts === 'string') setEvents((prev) => [e, ...prev].slice(0, 30));
    });
    const offBlocked = secOn('onTermBlocked', (p) => {
      const e = p as { cmd?: string; reasons?: string[] } | null;
      const why = (e?.reasons ?? []).join(', ') || t('security.blockedReason', 'dangerous command');
      notify(`${t('security.blockedToast', 'Terminal guard blocked')}: ${redactForDisplay((e?.cmd ?? '').slice(0, 64))} — ${why}`);
      void refresh();
    });
    return () => {
      window.clearInterval(iv);
      offSec();
      offBlocked();
    };
  }, [refresh, notify, t]);

  const guardMode = status?.terminalGuard ?? 'on';
  const auditCount = status?.auditCount ?? events.length;

  const clearAudit = async () => {
    if (!window.confirm(t('security.audit.clearConfirm', 'Clear the security audit trail? This cannot be undone.'))) return;
    const res = await secInvoke<{ cleared?: number }>('secAuditClear');
    notify(
      res
        ? t('security.audit.cleared', 'Audit trail cleared ({{n}} entries)').replace('{{n}}', String(res.cleared ?? 0))
        : t('security.unavailable', 'Security bridge unavailable in this build'),
    );
    void refresh();
  };

  const exportData = async () => {
    const res = await secInvoke<{ ok?: boolean; path?: string; error?: string }>('secExportData');
    notify(res?.path ? `${t('security.export.done', 'Data exported to')} ${res.path}` : res?.error || t('security.unavailable', 'Security bridge unavailable in this build'));
  };

  const openPrivacy = () => {
    // Integration hook: the shell listens for `surnia:open-settings`.
    try {
      window.dispatchEvent(new CustomEvent('surnia:open-settings', { detail: { section: 'privacy' } }));
    } catch {
      /* no listener mounted — harmless */
    }
  };

  return (
    <div className={`sec-art page-v14${embedded ? ' is-embedded' : ''}`}>
      {/* ---------- editorial head ---------- */}
      <header className="ed-head">
        <div className="ed-head-main">
          <div className="ed-head-top">
            <span className="ed-eyebrow" dir="ltr">07 / SECURITY</span>
            <SecurityGlyph />
          </div>
          <h2 className="ed-head-title" dir="auto">{t('security.title', 'Security')}</h2>
          <p className="ed-head-desc" dir="auto">
            {lang === 'ar'
              ? 'حماية محلية صامتة: بوابة أوامر وتنقيط سجلات وسجل تدقيق لا يُمحى.'
              : 'Quiet local protection: a command gate, log redaction and an append-only audit trail.'}
          </p>
        </div>
      </header>

      {/* ---- gate / verdict centerpiece ---- */}
      <SecurityGate status={status} auditCount={auditCount} t={t} lang={lang} />

      <div className="sec-body-wrap">
        {/* ---- protection status ---- */}
        <section className="sec-block">
          <div className="ed-micro">{t('security.status', 'Protection status')}</div>
          <StatusRow
            icon={<TerminalSquare size={15} />}
            label={t('security.terminalGuard', 'Terminal guard')}
            tone={guardMode === 'on' ? 'ok' : guardMode === 'warn-only' ? 'warn' : 'bad'}
            value={guardMode === 'on' ? t('security.mode.on', 'ON') : guardMode === 'warn-only' ? t('security.mode.warnOnly', 'WARN-ONLY') : t('security.mode.off', 'OFF')}
            title={t('security.terminalGuard.hint', 'Classifies every shell line before it runs; dangerous commands are held for approval.')}
          />
          <StatusRow
            icon={<ShieldCheck size={15} />}
            label={t('security.logRedaction', 'Log redaction')}
            tone={status && status.redactionsThisSession > 0 ? 'ok' : 'default'}
            value={`${status?.redactionsThisSession ?? '—'} ${t('security.redactedThisSession', 'blocked this session')}`}
            title={t('security.logRedaction.hint', 'API keys, tokens and passwords are replaced with «redacted» before anything is written to the log.')}
          />
          <StatusRow
            icon={<FolderLock size={15} />}
            label={t('security.fsGuards', 'FS symlink guards')}
            tone={status === null ? 'default' : status.fsConfinement ? 'ok' : 'warn'}
            value={status === null ? '—' : status.fsConfinement ? t('security.fsGuards.on', 'ON') : t('security.fsGuards.standby', 'STANDBY')}
            title={
              status?.allowedRoots?.length
                ? `${t('security.allowedRoots', 'Allowed roots')}: ${status.allowedRoots.join(', ')}`
                : t('security.fsGuards.hint', 'Writes are realpath-verified to stay inside the workspace and app data dir.')
            }
          />
          <StatusRow
            icon={<ScrollText size={15} />}
            label={t('security.audit.label', 'Audit trail')}
            tone={auditCount > 0 ? 'acc' : 'default'}
            value={`${auditCount} ${t('security.audit.events', 'events')}`}
            title={t('security.audit.hint', 'Append-only log at appData/audit.jsonl — blocks, approvals and redactions.')}
          />
        </section>

        {/* ---- recent audit events (live) ---- */}
        <section className="sec-block">
          <div className="ed-micro">{t('security.audit.recent', 'Recent audit events')}</div>
          {events.length === 0 ? (
            <div className="sec-empty">
              <ScrollText size={18} strokeWidth={1.4} aria-hidden />
              <span>{t('security.audit.empty', 'Nothing recorded yet — this session has been quiet.')}</span>
            </div>
          ) : (
            <div className="sec-events">
              {events.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="sec-event">
                  <span className="ed-mono sec-event-time" dir="ltr">{timeOf(e.ts)}</span>
                  <Chip tone={AUDIT_TONE[e.kind] ?? 'default'}>{e.kind}</Chip>
                  <span className="ed-mono sec-event-detail" dir="ltr" title={detailText(e.detail)}>
                    {detailText(e.detail)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- quick actions ---- */}
        <section className="sec-block">
          <div className="ed-micro">{t('security.actions', 'Quick actions')}</div>
          <div className="sec-actions">
            <Btn onClick={openPrivacy}>
              <Settings2 size={12} className="inline-block me-1" />
              {t('security.actions.privacy', 'Privacy settings')}
            </Btn>
            <Btn onClick={() => void exportData()}>
              <Download size={12} className="inline-block me-1" />
              {t('security.actions.export', 'Export my data')}
            </Btn>
            <Btn variant="ghost" onClick={() => void clearAudit()}>
              <Eraser size={12} className="inline-block me-1" />
              {t('security.actions.clearAudit', 'Clear audit trail')}
            </Btn>
          </div>
          <p className="sec-hint">
            {t('security.actions.hint', 'Guard mode, data controls and secret storage live in Settings → Privacy.')}
          </p>
        </section>

        {/* ---- v11.38 HONEST LIMITS — no fake "secure" claim ---- */}
        <section className="sec-block" data-testid="security-local-limits">
          <div className="ed-micro">
            {L('security.limits.title', 'الحدود / WHAT THIS DOES NOT DO')}
          </div>
          <p className="sec-hint">
            {lang === 'ar'
              ? 'هذه حماية محلية لتقليل الأخطاء على هذا الجهاز فقط. هي ليست برنامج أمان، ولا تعزل التطبيق عن النظام، ولا توقف البرمجيات الخبيثة، ولا تتحقق من محتوى الويب. لا يوجد خادم: كل شيء يعمل على جهازك، ومراجعة أوامر الموافقة مسؤوليتك. عالج محتوى المواقع والأدوات الخارجية كبيانات غير موثوقة، وراجع كل طلب موافقة قبل الموافقة.'
              : 'LOCAL-ONLY. These controls reduce accidents on this device; they are not a security product. They do not sandbox the app, stop malware, or verify web content. There is no server — everything runs on your machine, and every approval you grant is your own decision. Treat web pages and external tool output as untrusted DATA, and read each approval prompt before you accept.'}
          </p>
        </section>
      </div>
    </div>
  );
}

export default SecurityPanel;
