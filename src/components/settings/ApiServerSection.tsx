// ============================================================
// SADEEM settings — API server section (agent C)
// Local loopback HTTP control API: status, enable toggle, port,
// bearer token management, endpoint reference and a curl example.
// Polls the main-process service every 3s while mounted.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Minus, Plus, RefreshCw } from 'lucide-react';
import { api, type ApiServerStatus } from '../../lib/api';
import { useT, useDigits } from '../../i18n';
import { useStore } from '../../store';
import { Chip, Field, IconBtn, SectionTitle, Spinner, TextInput, Toggle } from '../ui';
import './s3-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

const DEFAULT_PORT = 47777;

const ENDPOINTS: { method: 'GET' | 'POST'; path: string; key: string; fallback: string }[] = [
  { method: 'GET', path: '/health', key: 'apiserver.ep.health', fallback: 'Liveness, version, workspace, request count' },
  { method: 'GET', path: '/models', key: 'apiserver.ep.models', fallback: 'Configured models (static, from settings)' },
  { method: 'GET', path: '/sessions', key: 'apiserver.ep.sessions', fallback: 'List sessions (newest first)' },
  { method: 'POST', path: '/sessions', key: 'apiserver.ep.sessionsNew', fallback: 'Create an empty session {title?}' },
  { method: 'POST', path: '/run', key: 'apiserver.ep.run', fallback: 'Run the agent {prompt, workspace?} → runId' },
  { method: 'POST', path: '/abort', key: 'apiserver.ep.abort', fallback: 'Abort a running agent {runId?}' },
  { method: 'GET', path: '/events', key: 'apiserver.ep.events', fallback: 'SSE stream of agent events (?runId, ?token)' },
  { method: 'POST', path: '/ai', key: 'apiserver.ep.ai', fallback: 'One-shot completion {prompt, system?, maxTokens?, temperature?}' },
];

/** 32-char token built from window.crypto.randomUUID (hex, dashes stripped). */
function generateToken(): string {
  const c = typeof window !== 'undefined' ? window.crypto : undefined;
  try {
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
    if (c?.getRandomValues) {
      const buf = new Uint8Array(16);
      c.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2).padEnd(32, '0').slice(0, 32);
}

export function ApiServerSection() {
  const t = useT();
  const n = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  const notify = useStore((s) => s.notify);
  const settingsEnabled = useStore((s) => s.settings?.apiServer?.enabled === true);

  const [status, setStatus] = useState<ApiServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabledOpt, setEnabledOpt] = useState<boolean | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [portText, setPortText] = useState('');
  const [copied, setCopied] = useState<'token' | 'curl' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabled = enabledOpt ?? settingsEnabled;

  // ---- poll status every 3s while mounted ----
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .apiServerGet()
        .then((st) => {
          if (alive) setStatus(st);
        })
        .catch(() => {
          /* bridge not ready yet — retried on the next tick */
        });
    };
    load();
    const iv = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  // keep the port input in sync with the live status
  useEffect(() => {
    if (status) setPortText(String(status.port));
  }, [status?.port]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback(
    async (patch: { enabled?: boolean; port?: number; token?: string }) => {
      setBusy(true);
      try {
        const st = await api.apiServerSet(patch);
        setStatus(st);
        setPortText(String(st.port));
      } catch (err) {
        notify(`${t('apiserver.error', 'API server error')}: ${String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [notify, t],
  );

  const running = status?.running === true;
  const token = status?.token ?? '';
  const baseUrl = status?.baseUrl ?? `http://127.0.0.1:${DEFAULT_PORT}`;

  const portNum = parseInt(portText, 10);
  const portValid = Number.isFinite(portNum) && portNum >= 1024 && portNum <= 65535;

  const commitPort = () => {
    if (busy) return;
    if (portValid && status && portNum !== status.port) void apply({ port: portNum });
    else setPortText(String(status?.port ?? DEFAULT_PORT));
  };

  const stepPort = (d: number) => {
    if (busy) return;
    const base = portValid ? portNum : status?.port ?? DEFAULT_PORT;
    const v = Math.min(65535, Math.max(1024, base + d));
    setPortText(String(v));
    void apply({ port: v });
  };

  const copy = async (text: string, which: 'token' | 'curl') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const curlExample = `curl -s ${baseUrl}/health -H "Authorization: Bearer <token>"`;

  return (
    <section className="set-section s3-page">
      {/* ---------- refined page head · 06 / API SERVER ---------- */}
      <header className="s3-head">
        <div className="s3-glyph-wrap">
          {/* socket: body, three pins, one contact slot */}
          <svg className="s3-glyph" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M8 16h24v18H8z" />
            <path d="M14 16V9M20 16V6M26 16V9" />
            <path className="quiet" d="M13 25h14M20 28v3" />
            <circle className="dot" cx="20" cy="31" r="1.3" />
          </svg>
        </div>
        <div className="s3-head-copy">
          <div className="s3-eyebrow">
            <span className="no">{n('06')}</span>
            <span className="slash">/</span>
            {t('set.group.apiServer', tx('API SERVER', 'خادم API'))}
          </div>
          <h2 className="s3-display">{t('set.group.apiServer', tx('API server', 'خادم API'))}</h2>
          <p className="s3-desc">
            {t(
              'apiserver.desc',
              'Programmatic control API for scripts and CI — loopback only, bearer-token protected.',
            )}
          </p>
        </div>
        <span className="s3-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · request/response sequence ---------- */}
      <div className="s3-plate s3-plate--api" aria-hidden="true">
        <svg viewBox="0 0 320 128">
          {/* two lifelines, aligned at x 56 / 264 */}
          <line className="quiet" x1="56" y1="18" x2="56" y2="112" strokeDasharray="3 5" />
          <line className="quiet" x1="264" y1="18" x2="264" y2="112" strokeDasharray="3 5" />
          <circle className="dot" cx="56" cy="16" r="2.3" />
          <circle className="dot" cx="264" cy="16" r="2.3" />
          <text className="num" x="56" y="9" textAnchor="middle">CLIENT</text>
          <text className="num" x="264" y="9" textAnchor="middle">API</text>
          {/* request → */}
          <line x1="56" y1="38" x2="258" y2="38" />
          <path d="M253 35l5 3-5 3" />
          <circle className="dot accent" cx="56" cy="38" r="1.8" />
          <text className="num" x="157" y="33" textAnchor="middle">GET /health</text>
          {/* ← response, aligned */}
          <line className="mid" x1="264" y1="66" x2="62" y2="66" />
          <path className="mid" d="M67 63l-5 3 5 3" />
          <text className="num" x="157" y="61" textAnchor="middle">200 OK</text>
          {/* request →, aligned */}
          <line x1="56" y1="94" x2="258" y2="94" />
          <path d="M253 91l5 3-5 3" />
          <text className="num" x="157" y="89" textAnchor="middle">POST /run</text>
          {/* baseline */}
          <line className="quiet" x1="56" y1="112" x2="264" y2="112" />
        </svg>
      </div>

      <div className="s3-groups">
      {/* ---- status row ---- */}
      <div className="card p-3 mb-3 flex items-center gap-2.5 flex-wrap">
        <span
          aria-hidden
          className="shrink-0 inline-block"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: running ? 'var(--ok)' : 'var(--bad)',
          }}
        />
        <Chip tone={running ? 'ok' : 'default'}>
          {running ? t('apiserver.running', 'Running') : t('apiserver.stopped', 'Stopped')}
        </Chip>
        <span className="font-code text-[12px]" dir="ltr">
          {baseUrl}
        </span>
        <span className="text-[11px] text-dim ms-auto">
          {t('apiserver.requests', 'Requests')}: {status?.requests ?? 0}
        </span>
        {status?.error && (
          <Chip tone="bad" className="w-full">
            {status.error}
          </Chip>
        )}
      </div>

      {/* ---- enable toggle ---- */}
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0">
          <div className="text-[12.5px]">{t('apiserver.enable', 'Enable API server')}</div>
          <div className="text-[10.5px] text-[var(--faint)] mt-0.5">
            {t(
              'apiserver.enableHint',
              'Loopback HTTP server: list sessions, run the agent, stream events, one-shot AI',
            )}
          </div>
        </div>
        <Toggle
          checked={enabled}
          onChange={(v) => {
            setEnabledOpt(v);
            void apply({ enabled: v });
          }}
        />
      </div>

      {/* ---- port ---- */}
      <Field label={t('apiserver.port', 'Port')} hint={t('apiserver.portHint', '1024–65535 — changing it restarts the server')}>
        <div className="flex items-center gap-1.5">
          <IconBtn onClick={() => stepPort(-1)} disabled={busy} aria-label="-">
            <Minus size={13} />
          </IconBtn>
          <TextInput
            className="font-code w-24 text-center"
            dir="ltr"
            inputMode="numeric"
            value={portText}
            onChange={(e) => setPortText(e.target.value.replace(/\D/g, ''))}
            onBlur={commitPort}
            onKeyDown={(e) => e.key === 'Enter' && commitPort()}
          />
          <IconBtn onClick={() => stepPort(1)} disabled={busy} aria-label="+">
            <Plus size={13} />
          </IconBtn>
          {busy && <Spinner size={12} />}
        </div>
      </Field>

      {/* ---- token ---- */}
      <Field label={t('apiserver.token', 'Bearer token')} hint={t('apiserver.tokenHint', 'Sent as “Authorization: Bearer <token>” (or ?token= for EventSource)')}>
        <div className="flex items-center gap-1.5">
          <TextInput
            className="font-code flex-1"
            dir="ltr"
            type={showToken ? 'text' : 'password'}
            value={token}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            autoComplete="off"
          />
          <IconBtn
            onClick={() => setShowToken((v) => !v)}
            title={showToken ? t('apiserver.hide', 'Hide token') : t('apiserver.show', 'Show token')}
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconBtn>
          <IconBtn onClick={() => void copy(token, 'token')} title={t('apiserver.copy', 'Copy')}>
            {copied === 'token' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          </IconBtn>
          <IconBtn onClick={() => void apply({ token: generateToken() })} title={t('apiserver.regenerate', 'Regenerate token')} disabled={busy}>
            <RefreshCw size={14} />
          </IconBtn>
        </div>
      </Field>

      <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--faint)] mb-4">
        <span className="inline-block w-1.5 h-1.5 rounded-[1px] shrink-0" style={{ background: 'var(--acc2)' }} />
        {t('apiserver.security', 'Bound to 127.0.0.1 only — never exposed to the network.')}
      </div>

      {/* ---- endpoint reference ---- */}
      <SectionTitle>{t('apiserver.endpoints', 'Endpoints')}</SectionTitle>
      <div className="card overflow-hidden mb-4">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--faint)] border-b border-[var(--line)]">
              <th className="text-start px-3 py-1.5 font-semibold">{t('apiserver.method', 'Method')}</th>
              <th className="text-start px-3 py-1.5 font-semibold">{t('apiserver.path', 'Path')}</th>
              <th className="text-start px-3 py-1.5 font-semibold">{t('apiserver.purpose', 'Purpose')}</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={`${e.method} ${e.path}`} className="border-b border-[var(--line-soft)] last:border-0">
                <td className="px-3 py-1.5 align-top">
                  <Chip tone="acc" className="font-code">
                    {e.method}
                  </Chip>
                </td>
                <td className="px-3 py-1.5 align-top font-code whitespace-nowrap" dir="ltr">
                  {e.path}
                </td>
                <td className="px-3 py-1.5 align-top text-dim">{t(e.key, e.fallback)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- curl example ---- */}
      <SectionTitle>{t('apiserver.curlTitle', 'Try it')}</SectionTitle>
      <div className="card p-3 flex items-start gap-2" dir="ltr">
        <code className="flex-1 font-code text-[11px] leading-relaxed break-all whitespace-pre-wrap text-dim">
          {curlExample}
        </code>
        <IconBtn onClick={() => void copy(curlExample, 'curl')} title={t('apiserver.copy', 'Copy')}>
          {copied === 'curl' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
        </IconBtn>
      </div>
      </div>
    </section>
  );
}

export default ApiServerSection;
