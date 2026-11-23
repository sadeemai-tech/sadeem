// ============================================================
// SADEEM settings — MCP section (v2).
// Readout: configured servers, live health (dot + latency from
// the 60s health monitor), connected count, total tools, auto-
// quarantine switch + quarantine warnings (via defensive v2 IPC),
// plus a jump to the full MCP rail panel.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Package, Plug, Plus, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import { api, type MCPServersResult, type RivalMcpSource } from '../../lib/api';
import { catalogLogoFor } from '../../data/mcpCatalog';
import type { MCPServerConfig } from '../../../shared/types';
import { Btn, Chip, Spinner } from '../ui';
import { Toggle } from './controls';
import './s2-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

/** six spokes, evenly distributed at 60° — one geometry for glyph and plate. */
const SPOKES = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return {
    gx: +(22 + Math.cos(a) * 16).toFixed(2),
    gy: +(22 + Math.sin(a) * 16).toFixed(2),
    px: +(160 + Math.cos(a) * 120).toFixed(2),
    py: +(64 + Math.sin(a) * 46).toFixed(2),
    tx: +(160 + Math.cos(a) * 132).toFixed(2),
    ty: +(64 + Math.sin(a) * 53).toFixed(2),
  };
});

/** Mirrors agent/mcp.ts McpHealthSnapshot. */
interface McpHealthSnapshot {
  id: string;
  name: string;
  status: 'up' | 'down' | 'starting' | 'disabled' | 'quarantined';
  latencyMs?: number;
  toolCount: number;
  lastError?: string;
  lastCheckedAt?: number;
  restarts: number;
  nextRetryAt?: number;
}

/** Mirrors agent/mcp.ts v2PublicState(). */
interface McpV2Settings {
  autoQuarantine: boolean;
  quarantined: string[];
  approvals: Record<string, 'always' | 'deny'>;
  disabledTools: Record<string, string[]>;
}

/** Invoke a possibly-missing preload method; resolve to `fallback` when absent/failing. */
async function safeInvoke<T>(method: string, fallback: T, ...args: unknown[]): Promise<T> {
  try {
    const f = (api as unknown as Record<string, unknown>)[method];
    if (typeof f !== 'function') return fallback;
    return (await (f as (...a: unknown[]) => Promise<unknown>)(...args)) as T;
  } catch {
    return fallback;
  }
}

/** Local unique-id helper (same shape as MCPPanel's uid). */
function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function McpSection() {
  const t = useT();
  const n = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  const settings = useStore((s) => s.settings);
  const setRail = useStore((s) => s.setRail);
  const setSettings = useStore((s) => s.setSettings);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const [status, setStatus] = useState<MCPServersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Record<string, McpHealthSnapshot>>({});
  const [v2, setV2] = useState<McpV2Settings | null>(null);
  // v6.1 — MCP servers found in rival agent tools installed on this machine
  const [rivalsOpen, setRivalsOpen] = useState(false);
  const [rivals, setRivals] = useState<RivalMcpSource[] | null>(null);
  const [rivalsLoading, setRivalsLoading] = useState(false);
  const [rivalBusyId, setRivalBusyId] = useState<string | null>(null);
  const [rivalAdded, setRivalAdded] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    api
      .mcpServersGet()
      .then((r) => setStatus(r))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
    void safeInvoke<McpHealthSnapshot[]>('mcpHealthGet', []).then((list) => {
      if (list.length) setHealth(Object.fromEntries(list.map((h) => [h.id, h])));
    });
    void safeInvoke<McpV2Settings | null>('mcpV2SettingsGet', null).then((s) => setV2(s));
  }, []);

  useEffect(load, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // live health events (defensive: preload may not ship onMcpHealth yet)
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      const fn = (api as unknown as Record<string, unknown>).onMcpHealth;
      if (typeof fn === 'function') {
        unsub = (fn as (cb: (e: McpHealthSnapshot) => void) => () => void)((e: McpHealthSnapshot) => {
          if (e && typeof e.id === 'string') setHealth((prev) => ({ ...prev, [e.id]: e }));
        });
      }
    } catch {
      /* preload not updated — refresh button still works */
    }
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const setAutoQuarantine = (value: boolean): void => {
    setV2((prev) => (prev ? { ...prev, autoQuarantine: value } : prev));
    void safeInvoke<McpV2Settings | null>('mcpV2SettingsSet', null, { autoQuarantine: value }).then((next) => {
      if (next) setV2(next);
    });
  };

  const releaseQuarantine = (id: string): void => {
    setV2((prev) => (prev ? { ...prev, quarantined: prev.quarantined.filter((q) => q !== id) } : prev));
    void safeInvoke<{ ok: boolean }>('mcpQuarantineSet', { ok: false }, id, false);
  };

  const configured = settings.mcpServers?.length ?? 0;
  const servers = status?.servers ?? [];
  const quarantined = v2?.quarantined ?? [];
  const upCount = Object.values(health).filter((h) => h.status === 'up').length;
  const connected = Math.max(
    servers.filter((s) => s.state === 'connected').length,
    upCount,
  );
  const totalTools = status?.totalTools ?? servers.reduce((n, s) => n + (s.toolCount || 0), 0);

  const openPanel = () => {
    setRail('mcp'); // RailView includes 'mcp'
    setSettings(false);
  };

  // ---------- v6.1 — import from installed rival agents ----------
  const toggleRivals = () => {
    const next = !rivalsOpen;
    setRivalsOpen(next);
    if (next && rivals === null) {
      setRivalsLoading(true);
      void safeInvoke<RivalMcpSource[]>('rivalsMcp', [])
        .then((list) => setRivals(Array.isArray(list) ? list : []))
        .catch(() => setRivals([]))
        .finally(() => setRivalsLoading(false));
    }
  };

  const addRivalServer = async (src: RivalMcpSource, cfg: MCPServerConfig): Promise<void> => {
    if (rivalBusyId) return;
    setRivalBusyId(cfg.id);
    try {
      const withId: MCPServerConfig = { ...cfg, id: cfg.id || uid() };
      // the SAME save path the one-click presets use (kdx:mcp:save)
      const res = await api.mcpServerSave(withId);
      if (!res?.ok) {
        notify(res?.error || t('settings.mcp.rivalAddFailed', 'Could not add this server.'));
        return;
      }
      // keep the renderer store in sync (same flow as the MCP panel's save)
      const list = settings.mcpServers ?? [];
      const exists = list.some((s) => s.id === withId.id);
      updateSettings({
        mcpServers: exists
          ? list.map((s) => (s.id === withId.id ? { ...s, ...withId, enabled: s.enabled } : s))
          : [...list, withId],
      });
      setRivalAdded((prev) => ({ ...prev, [withId.id]: true }));
      notify(
        t('settings.mcp.rivalAdded', 'Added "{name}" from {src} · تمت إضافة "{name}" من {src}', {
          name: withId.name,
          src: src.source,
        }),
      );
      load();
    } catch (err) {
      notify(String((err as Error)?.message ?? err));
    } finally {
      setRivalBusyId(null);
    }
  };

  const dotState = (id: string): string => {
    const h = health[id];
    if (!h) return 'pending';
    return h.status === 'up' ? 'ok' : h.status === 'down' ? 'error' : h.status === 'quarantined' ? 'quarantined' : h.status === 'disabled' ? 'off' : 'pending';
  };

  return (
    <section className="set-section s2-page" dir={lang === 'ar' ? 'rtl' : undefined}>
      {/* ---------- refined page head · 04 / MCP ---------- */}
      <header className="s2-head">
        <div className="s2-glyph-wrap">
          <svg className="s2-glyph" viewBox="0 0 44 44" aria-hidden="true">
            {/* hub with six spokes */}
            {SPOKES.map((s, i) => (
              <line key={i} className="quiet" x1="22" y1="22" x2={s.gx} y2={s.gy} />
            ))}
            <circle cx="22" cy="22" r="6" />
            <circle className="dot" cx="22" cy="22" r="1.6" />
            {SPOKES.map((s, i) => (
              <circle key={i} className="dot" cx={s.gx} cy={s.gy} r="1.5" />
            ))}
          </svg>
        </div>
        <div className="s2-head-copy">
          <div className="s2-eyebrow">
            <span className="no">{n('04')}</span>
            <span className="slash">/</span>
            {t('settings.nav.mcp', 'MCP servers')}
          </div>
          <h2 className="s2-display">{t('settings.nav.mcp', 'MCP servers')}</h2>
          <p className="s2-desc">
            {tx(
              'Model Context Protocol servers plug external tools into the agent — status and safety live here.',
              'خوادم بروتوكول سياق النماذج تضيف أدوات خارجية للوكيل — الحالة والأمان هنا.',
            )}
          </p>
        </div>
        <span className="s2-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · connection plate ---------- */}
      <div className="s2-plate s2-plate--mcp" aria-hidden="true">
        <svg viewBox="0 0 320 128">
          <rect className="quiet" x="8" y="8" width="304" height="112" />
          <circle className="quiet" cx="160" cy="64" r="30" strokeDasharray="1 6" />
          {SPOKES.map((s, i) => (
            <line key={i} className="quiet" x1="160" y1="64" x2={s.px} y2={s.py} />
          ))}
          <circle cx="160" cy="64" r="14" />
          <circle cx="160" cy="64" r="6" />
          <circle className="dot accent" cx="160" cy="64" r="1.8" />
          {SPOKES.map((s, i) => (
            <g key={i}>
              <circle className="dot" cx={s.px} cy={s.py} r="2.6" />
              <text className="num" x={s.tx} y={s.ty} textAnchor="middle">{n(String(i + 1).padStart(2, '0'))}</text>
            </g>
          ))}
        </svg>
      </div>

      <div className="s2-groups">
      {/* ---- summary readout ---- */}
      <div className="card p-4 mb-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="set-stat">
            <div className="set-stat-v tnum">{configured}</div>
            <div className="set-stat-k">
              {t('settings.mcp.configured', 'Configured')}
            </div>
          </div>
          <div className="set-stat">
            <div className="set-stat-v tnum" style={{ color: 'var(--ok)' }}>{connected}</div>
            <div className="set-stat-k">
              {t('settings.mcp.connected', 'Connected')}
            </div>
          </div>
          <div className="set-stat">
            <div className="set-stat-v tnum" style={{ color: 'var(--acc2)' }}>{totalTools}</div>
            <div className="set-stat-k">
              {t('settings.mcp.totalTools', 'Tools available')}
            </div>
          </div>
        </div>

        {/* per-server chips with live health dot + latency */}
        {servers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {servers.map((s) => {
              const h = health[s.id];
              const isQ = quarantined.includes(s.id) || h?.status === 'quarantined';
              const title =
                isQ
                  ? t('settings.mcp.quarantineTip', 'Quarantined — tool execution blocked')
                  : h?.lastError
                    ? `${h.status} · ${h.lastError}`
                    : `${h?.status ?? s.state}${h?.latencyMs != null ? ` · ${h.latencyMs} ms` : ''}`;
              return (
                <Chip
                  key={s.id}
                  tone={isQ ? 'warn' : s.state === 'connected' || h?.status === 'up' ? 'ok' : s.state === 'error' || h?.status === 'down' ? 'bad' : 'default'}
                  title={title}
                >
                  {(() => {
                    const logo = catalogLogoFor((settings.mcpServers ?? []).find((c) => c.id === s.id));
                    return logo ? (
                      <img src={logo} alt="" className="w-3.5 h-3.5 object-contain shrink-0" draggable={false} />
                    ) : null;
                  })()}
                  <span className="mcp-dot" data-state={isQ ? 'quarantined' : dotState(s.id)} />
                  {s.name} · {isQ ? t('settings.mcp.quarantinedShort', 'quarantined') : (h?.status ?? s.state)}
                  {h?.latencyMs != null && h.status === 'up' ? ` · ${h.latencyMs} ms` : ''}
                </Chip>
              );
            })}
          </div>
        )}

        {/* quarantine warnings */}
        {quarantined.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {quarantined.map((id) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-[8px] border border-[color-mix(in_srgb,var(--amber)_35%,transparent)] bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] px-2.5 py-1.5"
              >
                <ShieldAlert size={13} className="shrink-0" />
                <span className="text-[11px] flex-1 min-w-0 truncate">
                  {t('settings.mcp.quarantinedServer', '{name} was auto-quarantined by the tool-poisoning scanner.').replace(
                    '{name}',
                    health[id]?.name ?? id,
                  )}
                </span>
                <Btn variant="ghost" className="!h-6 !text-[10.5px] !px-2 shrink-0" onClick={() => releaseQuarantine(id)}>
                  <ShieldCheck size={11} />
                  {t('mcp.release', 'Release')}
                </Btn>
              </div>
            ))}
          </div>
        )}

        {/* auto-quarantine switch */}
        <div className="flex items-center gap-2 mt-3">
          <ShieldCheck size={12} className="text-[var(--acc2)] shrink-0" />
          <span className="text-[11px] text-[var(--dim)] flex-1 min-w-0">
            {t('mcp.autoQuarantine', 'Auto-quarantine servers whose tool descriptions look poisoned')}
          </span>
          <Toggle checked={!!v2?.autoQuarantine} onChange={setAutoQuarantine} />
        </div>

        {configured === 0 && (
          <p className="text-[11.5px] text-dim mt-3">
            {t(
              'settings.mcp.noServers',
              'No MCP servers configured. Add stdio servers to extend SADEEM with external tools.',
            )}
          </p>
        )}

        <div className="flex items-center gap-2 mt-3.5 flex-wrap">
          <Btn variant="primary" onClick={openPanel}>
            <Plug size={12} className="inline-block me-1.5" />
            {t('settings.mcp.open', 'Open MCP panel')}
            <ExternalLink size={11} className="inline-block ms-1.5 -mt-0.5" />
          </Btn>
          <Btn variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Spinner size={12} /> : <RefreshCw size={12} className="inline-block me-1.5" />}
            {t('settings.mcp.refresh', 'Refresh status')}
          </Btn>
          <Btn variant="ghost" onClick={toggleRivals} disabled={rivalsLoading}>
            {rivalsLoading ? <Spinner size={12} /> : <Download size={12} className="inline-block me-1.5" />}
            {t('settings.mcp.importRivals', 'Import from installed agents · استيراد من الوكلاء المثبتين')}
          </Btn>
        </div>

        {/* v6.1 — MCP servers found in other agent tools on this machine */}
        {rivalsOpen && (
          <div className="mt-3 flex flex-col gap-2">
            {rivals === null ? (
              <div className="flex items-center gap-2 text-[11.5px] text-dim">
                <Spinner size={12} />
                {t('settings.mcp.rivalScan', 'Scanning installed agent configs… · جارٍ فحص إعدادات الوكلاء المثبتين…')}
              </div>
            ) : rivals.length === 0 ? (
              <p className="text-[11.5px] text-dim">
                {t(
                  'settings.mcp.rivalNone',
                  'No MCP servers found in other agent tools on this machine · لم يُعثر على سيرفرات MCP في الأدوات الأخرى',
                )}
              </p>
            ) : (
              rivals.map((src) => (
                <div
                  key={src.source}
                  className="rounded-[8px] border border-[var(--line-soft)] bg-[var(--bg1)] p-2.5 flex flex-col gap-1"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                    <Package size={11} className="text-[var(--acc2)] shrink-0" />
                    <span className="truncate">{src.source}</span>
                    <span className="text-[10px] text-[var(--faint)] tnum">{src.servers.length}</span>
                  </div>
                  {src.servers.map((cfg) => {
                    const added =
                      rivalAdded[cfg.id] || (settings.mcpServers ?? []).some((s) => s.id === cfg.id);
                    // v6 audit H-1 — the FULL command line is visible in the row
                    // body (not a tooltip): the user always sees what will spawn.
                    const cmdline = [cfg.command, ...(cfg.args ?? [])].join(' ') || cfg.url || '';
                    return (
                      <div key={cfg.id} className="flex flex-col gap-0.5 py-0.5">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="flex-1 min-w-0 truncate" dir="auto">
                            {cfg.name}
                          </span>
                          <span className="text-[9.5px] text-[var(--faint)] shrink-0">{cfg.transport ?? 'stdio'}</span>
                          {added ? (
                            <Chip tone="ok" className="!h-[16px] !text-[9px] !px-1.5 shrink-0">
                              {t('settings.mcp.rivalAddedShort', 'Added · مُضيف')}
                            </Chip>
                          ) : (
                            <Btn
                              variant="ghost"
                              className="!h-6 !text-[10px] !px-2 shrink-0"
                              disabled={rivalBusyId === cfg.id}
                              onClick={() => void addRivalServer(src, cfg)}
                            >
                              <Plus size={10} className="inline-block me-1" />
                              {t('settings.mcp.rivalAdd', 'Add · إضافة')}
                            </Btn>
                          )}
                        </div>
                        {cmdline && (
                          <span className="font-code text-[9.5px] text-[var(--faint)] truncate ps-3" dir="ltr" title={cmdline}>
                            {cmdline}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-dim">
        {t(
          'settings.mcp.note',
          'Servers are probed every 60s; crashed stdio servers restart automatically (3 attempts with backoff). Destructive tools require per-call approval; per-tool switches hide tools from the model.',
        )}
      </p>
      </div>
    </section>
  );
}

export default McpSection;
