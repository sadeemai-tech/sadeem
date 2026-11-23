// MCPPanel — MCP manager (v2): server health cards (connect/test/edit/
// delete/enable, live health dot + latency), per-tool list with annotation
// chips (RO/DANGER/IDEM/OPEN) + anti-poisoning scanner badges + per-tool
// enable/disable, quarantine banner/release, one-click preset gallery,
// OFFICIAL registry search & add flow, full add/edit form (stdio/http/sse),
// resources & prompts browser and a session call-log drawer (Activity tab).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  Globe,
  LayoutGrid,
  MessagesSquare,
  Package,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import {
  MCP_CATALOG,
  MCP_CATEGORIES,
  catalogEntryHasPlaceholders,
  catalogEntryToConfig,
  catalogLogoFor,
  type McpCatalogEntry,
} from '../../data/mcpCatalog';
import type {
  MCPServerConfig,
  MCPServerStatus,
  MCPResourceInfo,
  MCPPromptInfo,
  MCPResourceContent,
  MCPServersResult,
  MCPRegistryPreset,
  MCPTransport,
} from '../../../shared/types';
import { Btn, Chip, Empty, IconBtn, Modal, SectionTitle, Spinner, TextInput, Toggle } from '../ui';
import { PageHead } from '../pages';
import '../../mcp.css';
import '../pages.css';
import './mcp-art.css';
import './panel-craft.css';

// ---------- small helpers ----------

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** t() + {var} interpolation (the dictionary stores raw placeholders). */
function tf(t: (k: string, f?: string) => string, key: string, fallback: string, vars: Record<string, string | number>): string {
  let s = t(key, fallback);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Shell-ish arg splitting: whitespace separated, double quotes respected. */
function parseArgs(text: string): string[] {
  return (text.match(/"[^"]*"|\S+/g) ?? []).map((a) => (a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a));
}

const TRANSPORTS: MCPTransport[] = ['stdio', 'http', 'sse'];

function endpointOf(cfg: MCPServerConfig | undefined): string {
  if (!cfg) return '';
  if ((cfg.transport ?? 'stdio') === 'stdio') return `${cfg.command} ${(cfg.args ?? []).join(' ')}`.trim();
  return cfg.url ?? '';
}

// ============================================================
// v2 types + defensive IPC access
// (preload may not expose the new channels yet — every call is
// guarded so the panel keeps working before integration)
// ============================================================

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
  /** v3.1 — last stderr bytes for stdio servers (diagnostics expander). */
  stderrTail?: string;
}

/** Mirrors agent/mcp.ts MCPToolAnnotations. */
interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Mirrors agent/mcp.ts MCPToolInfoEx. */
interface McpToolX {
  name: string;
  description?: string;
  serverId?: string;
  annotations?: McpToolAnnotations;
  suspicious?: string[];
  destructive?: boolean;
  enabled?: boolean;
  /** v7.3 — true when excluded by the server's allow/deny lists (agent loop). */
  denied?: boolean;
}

/** Mirrors agent/mcp.ts McpToolCallEntry. */
interface McpToolCallEntry {
  serverId: string;
  server: string;
  tool: string;
  ok: boolean;
  ms: number;
  at: number;
  error?: string;
}

interface McpV2Settings {
  autoQuarantine: boolean;
  quarantined: string[];
  approvals: Record<string, 'always' | 'deny'>;
  disabledTools: Record<string, string[]>;
}

/** Mirrors mcpRegistryService MCPRegistrySearchResult. */
interface McpRegistryHit {
  id: string;
  name: string;
  title?: string;
  description: string;
  version?: string;
  status?: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  docsUrl?: string;
}

interface McpRegistryPage {
  ok: boolean;
  results?: McpRegistryHit[];
  nextCursor?: string;
  error?: string;
  offline?: boolean;
}

const SCAN_LABELS: Record<string, string> = {
  ignore_previous: 'Prompt injection: "ignore previous…"',
  disregard: 'Prompt injection: "disregard…"',
  exfiltrate: 'Exfiltration language',
  base64_blob: 'Embedded base64 blob (>200 chars)',
  credential_files: 'References credential files (.env, id_rsa, ~/.ssh, keychain…)',
  secret_harvest: 'Instruction to read secrets/credentials',
  send_data: 'Instruction to send data to a destination',
  upload: 'Mentions uploading data',
  embedded_url: 'Embedded URL in description',
};
const HIGH_RISK_CODES = new Set(['ignore_previous', 'disregard', 'exfiltrate', 'base64_blob', 'credential_files', 'secret_harvest']);

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

/** Same bridge guard, but distinguishes "method missing/errored" from a real
 *  (possibly empty) result. Health snapshots MUST be allowed to be empty —
 *  otherwise a deleted server's dot/quarantine survives until reload. */
async function safeCall<T>(method: string, ...args: unknown[]): Promise<{ called: boolean; value?: T }> {
  try {
    const f = (api as unknown as Record<string, unknown>)[method];
    if (typeof f !== 'function') return { called: false };
    return { called: true, value: (await (f as (...a: unknown[]) => Promise<unknown>)(...args)) as T };
  } catch {
    return { called: false };
  }
}

function flagTooltip(codes: string[] | undefined): string {
  if (!codes?.length) return '';
  return codes.map((c) => SCAN_LABELS[c] ?? c).join('\n');
}

// ---------- local view state ----------

interface CapsState {
  loading: boolean;
  resources?: MCPResourceInfo[];
  prompts?: MCPPromptInfo[];
  error?: string;
}

interface ResourcePreviewState {
  serverId: string;
  uri: string;
  loading: boolean;
  content?: MCPResourceContent;
  error?: string;
}

interface TestState {
  testing: boolean;
  ok?: boolean;
  error?: string;
}

/** v3.1 — prompt runner modal state (prompts/get, rendered text). */
interface PromptRunState {
  serverId: string;
  serverName: string;
  prompt: MCPPromptInfo;
  values: Record<string, string>;
  loading: boolean;
  text?: string;
  error?: string;
  copied?: boolean;
}

interface ToolsXState {
  loading: boolean;
  tools?: McpToolX[];
  error?: string;
}

interface RegState {
  query: string;
  loading: boolean;
  results: McpRegistryHit[];
  nextCursor?: string;
  error?: string;
  offline?: boolean;
  searched: boolean;
  confirmAdd: McpRegistryHit | null;
}

interface FormState {
  id: string | null; // null = adding
  name: string;
  transport: MCPTransport;
  command: string;
  args: string;
  url: string;
  headers: string;
  envRows: { key: string; value: string }[];
  timeout: string;
  autoReconnect: boolean;
  /** v3.1 — stdio working directory (`${workspace}` resolves at spawn time). */
  cwd: string;
  docsUrl?: string;
  fromPreset?: string;
  /** Curated catalog origin — preserved across edits for logo lookup. */
  catalogId?: string;
  error?: string;
  busy?: boolean;
}

type PanelTab = 'servers' | 'catalog' | 'registry' | 'activity';

function emptyForm(): FormState {
  return {
    id: null,
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    headers: '',
    envRows: [],
    timeout: '',
    autoReconnect: false,
    cwd: '',
  };
}

function formFromConfig(cfg: MCPServerConfig): FormState {
  return {
    id: cfg.id,
    name: cfg.name,
    transport: cfg.transport ?? 'stdio',
    command: cfg.command ?? '',
    args: (cfg.args ?? []).join(' '),
    url: cfg.url ?? '',
    headers: cfg.headers && Object.keys(cfg.headers).length > 0 ? JSON.stringify(cfg.headers) : '',
    envRows: Object.entries(cfg.env ?? {}).map(([key, value]) => ({ key, value })),
    timeout: cfg.timeoutMs ? String(cfg.timeoutMs) : '',
    autoReconnect: !!cfg.autoReconnect,
    cwd: cfg.cwd ?? '',
    catalogId: cfg.catalogId,
  };
}

/** Pre-fill the existing add/edit form from a curated catalog entry. */
function formFromCatalogEntry(e: McpCatalogEntry): FormState {
  return {
    ...emptyForm(),
    name: e.name,
    transport: e.transport,
    command: e.command ?? '',
    args: (e.args ?? []).join(' '),
    url: e.url ?? '',
    headers: e.headers ? JSON.stringify(e.headers, null, 2) : '',
    envRows: Object.entries(e.env ?? {}).map(([key, value]) => ({ key, value })),
    cwd: e.cwd ?? '',
    docsUrl: e.docsUrl,
    fromPreset: e.id,
    catalogId: e.id,
  };
}

function formFromPreset(p: MCPRegistryPreset): FormState {
  return {
    ...emptyForm(),
    name: p.name,
    transport: p.transport,
    command: p.command ?? '',
    args: (p.args ?? []).join(' '),
    url: p.url ?? '',
    envRows: Object.keys(p.env ?? {}).map((key) => ({ key, value: '' })),
    // v3.1 — presets may carry a `${workspace}` cwd hint (registry service
    // PresetEx extension; shared/types MCPRegistryPreset stays untouched).
    cwd: (p as { cwd?: string }).cwd ?? '',
    docsUrl: p.docsUrl,
    fromPreset: p.id,
  };
}

function formFromRegistryHit(h: McpRegistryHit): FormState {
  return {
    ...emptyForm(),
    name: h.title || h.name,
    transport: h.transport,
    command: h.command ?? '',
    args: (h.args ?? []).join(' '),
    url: h.url ?? '',
    envRows: Object.keys(h.env ?? {}).map((key) => ({ key, value: '' })),
    docsUrl: h.docsUrl,
  };
}

// ---------- panel ----------

/* ============================================================
   EDITORIAL ART — presentation only. These helpers DRAW; they do
   not call api, write the store or bind any state. The plate is
   derived from the server/health values the panel already holds.
   Motion guarded by prefers-reduced-motion + html.reduce-motion.
   ============================================================ */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    if (
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      root.classList.contains('reduce-motion') ||
      typeof IntersectionObserver === 'undefined'
    ) {
      el.setAttribute('data-in', 'true');
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        el.setAttribute('data-in', 'true');
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Original 1px glyph — a connector joining two terminal nodes. */
function McpGlyph() {
  return (
    <span className="mc-glyph" aria-hidden="true">
      <svg viewBox="0 0 72 34" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 17h14M48 17h14" />
        <rect x="24" y="10" width="24" height="14" rx="1" />
        <path d="M30 17h12M36 10v3M36 21v3" />
        <circle className="mc-g-dot" cx="10" cy="17" r="1.7" />
        <circle className="mc-g-dot" cx="62" cy="17" r="1.7" />
      </svg>
    </span>
  );
}

/** A server connection plate: an EXACT 6-spoke hub — 360°/6 = 60° apart,
 *  first spoke at 12 o'clock. Terminal dots sit on every spoke end and
 *  concentric rings no longer collide with the status arc (the old r=78
 *  arc sat on top of an r=78 ring — an off-by-pixel the new radii fix).
 *  The accent arc is the honest connected/total fraction from live health. */
function McpPlate({ total, connected, tools, ar }: { total: number; connected: number; tools: number; ar: boolean }) {
  const ref = useInView<HTMLDivElement>();
  const cx = 100, cy = 100;
  const SPOKES = 6, STEP_DEG = 60;              // exact 360 / 6
  const R = 78, C = 2 * Math.PI * R;            // status arc circumference
  const inner = 26, outer = 64;
  const frac = total > 0 ? Math.min(1, connected / total) : 0;
  const point = (i: number, r: number) => {
    const a = ((i * STEP_DEG - 90) * Math.PI) / 180; // -90° = 12 o'clock
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const ends = Array.from({ length: SPOKES }, (_, i) => point(i, outer));
  return (
    <div ref={ref} className="mc-plate mc-reveal">
      <div className="mc-plate-art" aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <circle className="mc-ring mc-ring--dash" cx={cx} cy={cy} r="92" />
          <circle className="mc-ring craft-draw" pathLength={1} cx={cx} cy={cy} r="70" style={{ animationDelay: '0ms' }} />
          <circle className="mc-ring mc-ring--inner craft-draw" pathLength={1} cx={cx} cy={cy} r="44" style={{ animationDelay: '60ms' }} />
          <circle className="mc-status" cx={cx} cy={cy} r={R}
            strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`} />
          {Array.from({ length: SPOKES }, (_, i) => {
            const a = point(i, inner), b = point(i, outer);
            return <line key={i} className="mc-spoke craft-draw" pathLength={1}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ animationDelay: `${i * 60}ms` }} />;
          })}
          {ends.map((e, i) => <circle key={i} className="mc-dot--terminal" cx={e.x} cy={e.y} r="2.6" />)}
          <circle className="mc-hub craft-draw" pathLength={1} cx={cx} cy={cy} r={inner} style={{ animationDelay: '120ms' }} />
          <circle className="mc-center" cx={cx} cy={cy} r="3.4" />
          <circle className="mc-dot" cx={cx} cy="8" r="1.4" />
          <circle className="mc-dot" cx={cx} cy="192" r="1.4" />
        </svg>
      </div>
      <div className="mc-plate-copy">
        <span className="mc-plate-fig">{ar ? 'اللوحة ٠١ / لوحة الاتصال' : 'PLATE 01 / CONNECTION PLATE'}</span>
        <span className="mc-plate-num">
          {connected}<span style={{ fontSize: '0.46em', color: 'var(--faint)' }}> / {total}</span>
        </span>
        <span className="mc-term" aria-hidden="true"><i /><i /><i /></span>
        <div className="mc-plate-legend">
          <div className="mc-plate-legend-row">
            <span className="mc-plate-legend-k">{ar ? 'متصل' : 'connected'}</span>
            <span className="mc-plate-legend-v">{connected}</span>
          </div>
          <div className="mc-plate-legend-row">
            <span className="mc-plate-legend-k">{ar ? 'الخوادم' : 'servers'}</span>
            <span className="mc-plate-legend-v">{total}</span>
          </div>
          <div className="mc-plate-legend-row">
            <span className="mc-plate-legend-k">{ar ? 'الأدوات' : 'tools'}</span>
            <span className="mc-plate-legend-v">{tools}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MCPPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const mcpAr = useStore((s) => s.settings?.language ?? 'en') === 'ar';
  const mcpServers = useStore((s) => s.settings.mcpServers);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);

  const [result, setResult] = useState<MCPServersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectBusy, setConnectBusy] = useState<Record<string, boolean>>({});
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [caps, setCaps] = useState<Record<string, CapsState>>({});
  const [preview, setPreview] = useState<ResourcePreviewState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // v2 state
  const [tab, setTab] = useState<PanelTab>('servers');
  const [health, setHealth] = useState<Record<string, McpHealthSnapshot>>({});
  const [toolsX, setToolsX] = useState<Record<string, ToolsXState>>({});
  const [v2, setV2] = useState<McpV2Settings | null>(null);
  const [callLog, setCallLog] = useState<McpToolCallEntry[] | null>(null);
  const [promptRun, setPromptRun] = useState<PromptRunState | null>(null);
  const copiedTimer = useRef<number | null>(null); // 'Copied!' flash reset
  const [reg, setReg] = useState<RegState>({
    query: '',
    loading: false,
    results: [],
    searched: false,
    confirmAdd: null,
  });
  // curated catalog browsing state
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCategory, setCatalogCategory] = useState<string>('All');
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined);

  const cfgOf = useCallback((id: string): MCPServerConfig | undefined => mcpServers.find((s) => s.id === id), [mcpServers]);

  const statusOf = useCallback(
    (id: string): MCPServerStatus | undefined => result?.servers.find((s) => s.id === id),
    [result],
  );

  const healthOf = useCallback((id: string): McpHealthSnapshot | undefined => health[id], [health]);

  // ---------- data loading ----------
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = await api.mcpServersGet();
      setResult(r);
    } catch {
      /* main process unreachable — keep previous state */
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHealth = useCallback(async (): Promise<void> => {
    const call = await safeCall<McpHealthSnapshot[]>('mcpHealthGet');
    // Bridge absent → keep the snapshots delivered by onMcpHealth; a real
    // empty snapshot → clear stale dots for servers that were just removed.
    if (!call.called) return;
    const list = Array.isArray(call.value) ? call.value : [];
    setHealth(Object.fromEntries(list.map((h) => [h.id, h])));
  }, []);

  useEffect(() => {
    void refresh();
    void refreshHealth();
    void safeInvoke<McpV2Settings | null>('mcpV2SettingsGet', null).then((s) => setV2(s));
    // live health events (defensive: preload may not ship onMcpHealth yet)
    let unsub: (() => void) | undefined;
    try {
      const fn = (api as unknown as Record<string, unknown>).onMcpHealth;
      if (typeof fn === 'function') {
        unsub = (fn as (cb: (e: McpHealthSnapshot) => void) => () => void)((e: McpHealthSnapshot) => {
          if (e && typeof e.id === 'string') setHealth((prev) => ({ ...prev, [e.id]: e }));
        });
      }
    } catch {
      /* preload not updated — 60s polling below still works */
    }
    const poll = window.setInterval(() => void refreshHealth(), 60_000);
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      window.clearInterval(poll);
    };
  }, [refresh, refreshHealth]);

  const loadCaps = useCallback(async (id: string): Promise<void> => {
    setCaps((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const [resources, prompts] = await Promise.all([api.mcpResources(id), api.mcpPrompts(id)]);
      setCaps((prev) => ({ ...prev, [id]: { loading: false, resources, prompts } }));
    } catch (err) {
      setCaps((prev) => ({ ...prev, [id]: { loading: false, error: err instanceof Error ? err.message : String(err) } }));
    }
  }, []);

  const loadTools = useCallback(async (id: string): Promise<void> => {
    setToolsX((prev) => ({ ...prev, [id]: { loading: true } }));
    const res = await safeInvoke<{ ok: boolean; tools?: McpToolX[]; error?: string; quarantined?: boolean }>(
      'mcpToolsExtended',
      { ok: false, error: 'Tool inspector unavailable (preload not updated yet).' },
      id,
    );
    setToolsX((prev) => ({
      ...prev,
      [id]: res.ok ? { loading: false, tools: res.tools ?? [] } : { loading: false, error: res.error },
    }));
  }, []);

  const loadCallLog = useCallback(async (): Promise<void> => {
    const log = await safeInvoke<McpToolCallEntry[]>('mcpCallLog', []);
    setCallLog(log);
  }, []);

  const clearCallLog = useCallback(async (): Promise<void> => {
    const res = await safeInvoke<{ ok: boolean; error?: string }>(
      'mcpCallLogClear',
      { ok: false, error: 'Call-log clearing is unavailable in this build.' },
    );
    if (!res.ok) {
      notify(res.error || t('mcp.activity.clearFailed', 'Could not clear the call log.'));
      return;
    }
    setCallLog([]);
  }, [notify, t]);

  const checkHealth = useCallback(
    async (id: string): Promise<void> => {
      const call = await safeCall('mcpHealthCheck', id);
      if (!call.called) {
        notify(t('mcp.healthCheckUnavailable', 'Health check is unavailable in this build.'));
        return;
      }
      await refreshHealth();
    },
    [notify, refreshHealth, t],
  );

  useEffect(() => {
    if (tab === 'activity') void loadCallLog();
  }, [tab, loadCallLog]);

  const applyStatus = useCallback((st: MCPServerStatus): void => {
    setResult((prev) => {
      if (!prev) return prev;
      const servers = prev.servers.map((x) => (x.id === st.id ? st : x));
      return { ...prev, servers, totalTools: servers.reduce((n, x) => n + x.toolCount, 0) };
    });
  }, []);

  // ---------- actions ----------
  const connectOne = useCallback(
    async (id: string): Promise<void> => {
      setConnectBusy((prev) => ({ ...prev, [id]: true }));
      try {
        const st = await api.mcpConnect(id);
        applyStatus(st);
        if (st.state === 'connected') void loadCaps(id);
      } catch (err) {
        // A thrown connect (bridge down) never reaches applyStatus — say so
        // instead of leaving the card silently stuck on "Disconnected".
        notify(err instanceof Error ? err.message : String(err));
      } finally {
        setConnectBusy((prev) => ({ ...prev, [id]: false }));
      }
    },
    [applyStatus, loadCaps, notify],
  );

  const testOne = useCallback(
    async (id: string): Promise<void> => {
      const cfg = cfgOf(id);
      if (!cfg) return;
      setTests((prev) => ({ ...prev, [id]: { testing: true } }));
      try {
        const res = await api.mcpTest(cfg);
        setTests((prev) => ({ ...prev, [id]: { testing: false, ok: !!res.ok, error: res.error } }));
      } catch (err) {
        setTests((prev) => ({ ...prev, [id]: { testing: false, ok: false, error: err instanceof Error ? err.message : String(err) } }));
      }
    },
    [cfgOf],
  );

  const setEnabled = (id: string, enabled: boolean): void => {
    updateSettings({ mcpServers: mcpServers.map((s) => (s.id === id ? { ...s, enabled } : s)) });
    // reflect immediately: disabling greys the card out, enabling shows "disconnected"
    setResult((prev) =>
      prev
        ? {
            ...prev,
            servers: prev.servers.map((s) =>
              s.id === id ? { ...s, state: enabled ? (s.state === 'disabled' ? 'disconnected' : s.state) : 'disabled' } : s,
            ),
          }
        : prev,
    );
  };

  const toggleTool = useCallback(async (serverId: string, tool: string, enabled: boolean): Promise<void> => {
    // optimistic
    setToolsX((prev) => {
      const st = prev[serverId];
      if (!st?.tools) return prev;
      return { ...prev, [serverId]: { ...st, tools: st.tools.map((x) => (x.name === tool ? { ...x, enabled } : x)) } };
    });
    const res = await safeInvoke<{ ok: boolean; error?: string }>(
      'mcpToolEnable',
      { ok: false, error: 'Tool switch is unavailable in this build.' },
      serverId,
      tool,
      enabled,
    );
    if (!res.ok) {
      // roll back if main didn't accept (preload missing) — and say so,
      // instead of leaving the user believing the toggle took effect.
      setToolsX((prev) => {
        const st = prev[serverId];
        if (!st?.tools) return prev;
        return { ...prev, [serverId]: { ...st, tools: st.tools.map((x) => (x.name === tool ? { ...x, enabled: !enabled } : x)) } };
      });
      notify(res.error || t('mcp.toolToggleFailed', 'Could not change this tool — the change was reverted.'));
    }
  }, [notify, t]);

  const releaseQuarantine = useCallback(async (serverId: string): Promise<void> => {
    const res = await safeInvoke<{ ok: boolean; error?: string }>(
      'mcpQuarantineSet',
      { ok: false, error: 'Quarantine release is unavailable in this build.' },
      serverId,
      false,
    );
    if (!res.ok) {
      notify(res.error || t('mcp.releaseFailed', 'Could not release this server from quarantine.'));
      return;
    }
    setV2((prev) => (prev ? { ...prev, quarantined: prev.quarantined.filter((q) => q !== serverId) } : prev));
    setHealth((prev) =>
      prev[serverId] ? { ...prev, [serverId]: { ...prev[serverId], status: 'starting', lastError: undefined } } : prev,
    );
    notify(t('mcp.released', 'Released from quarantine.'));
    void refreshHealth();
  }, [notify, refreshHealth, t]);

  // ---------- prompt runner (v3.1 prompts/get) ----------
  const fetchPrompt = useCallback(
    async (serverId: string, serverName: string, prompt: MCPPromptInfo, values: Record<string, string>): Promise<void> => {
      setPromptRun({ serverId, serverName, prompt, values, loading: true });
      // Defensive: the preload may not expose mcpPromptGet yet — the fallback
      // keeps the panel alive (the main-side channel is registered already).
      const res = await safeInvoke<{ ok: boolean; text?: string; error?: string }>(
        'mcpPromptGet',
        { ok: false, error: 'Prompt runner unavailable (preload not updated yet).' },
        serverId,
        prompt.name,
        values,
      );
      setPromptRun((prev) =>
        prev && prev.serverId === serverId && prev.prompt.name === prompt.name
          ? {
              ...prev,
              loading: false,
              text: res.ok ? res.text : undefined,
              error: res.ok ? undefined : res.error || 'Failed to get the prompt.',
            }
          : prev,
      );
    },
    [],
  );

  const openPrompt = useCallback(
    (s: MCPServerStatus, p: MCPPromptInfo): void => {
      const args = p.arguments ?? [];
      // No declared args → fetch right away; otherwise open the key=value form.
      if (args.length === 0) {
        void fetchPrompt(s.id, s.name, p, {});
        return;
      }
      setPromptRun({
        serverId: s.id,
        serverName: s.name,
        prompt: p,
        values: Object.fromEntries(args.map((a) => [a.name, ''])),
        loading: false,
      });
    },
    [fetchPrompt],
  );

  const copyPromptText = useCallback((): void => {
    const text = promptRun?.text;
    if (!text) return;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setPromptRun((prev) => (prev ? { ...prev, copied: true } : prev));
        if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => {
          setPromptRun((prev) => (prev ? { ...prev, copied: false } : prev));
        }, 1600);
      })
      .catch(() => {
        notify(t('mcp.copyFailed', 'Clipboard unavailable — copy the text manually.'));
      });
  }, [notify, promptRun?.text, t]);

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const setAutoQuarantine = useCallback(
    async (value: boolean): Promise<void> => {
      setV2((prev) => (prev ? { ...prev, autoQuarantine: value } : prev));
      const next = await safeInvoke<McpV2Settings | null>('mcpV2SettingsSet', null, { autoQuarantine: value });
      if (!next) {
        // Optimistic toggle must not lie when the settings bridge is absent.
        setV2((prev) => (prev ? { ...prev, autoQuarantine: !value } : prev));
        notify(t('mcp.autoQuarantineFailed', 'Could not save the auto-quarantine setting.'));
        return;
      }
      setV2(next);
    },
    [notify, t],
  );

  const resetApproval = useCallback(
    async (serverId: string, tool: string): Promise<void> => {
      const res = await safeInvoke<{ ok: boolean; error?: string }>(
        'mcpApprovalSet',
        { ok: false, error: 'Approval reset is unavailable in this build.' },
        serverId,
        tool,
        null,
      );
      if (!res.ok) {
        notify(res.error || t('mcp.approvalResetFailed', 'Could not reset the remembered approval.'));
        return;
      }
      setV2((prev) => {
        if (!prev) return prev;
        const approvals = { ...prev.approvals };
        delete approvals[`${serverId}::${tool}`];
        return { ...prev, approvals };
      });
    },
    [notify, t],
  );

  // ---------- v7.3 — per-server tool allow/deny (card-level editing) ----------
  // Two small comma-separated inputs per server card (exact names or globs;
  // deny wins). Persistence follows the panel's existing per-server settings
  // flow — the same updateSettings({ mcpServers }) path setEnabled uses —
  // with a short debounce so typing never spams the settings file.
  interface ToolListDraft {
    allow: string;
    deny: string;
  }
  const [listDrafts, setListDrafts] = useState<Record<string, ToolListDraft>>({});
  const listDraftsRef = useRef<Record<string, ToolListDraft>>({}); // mirror for the debounced flush
  const listTimers = useRef<Record<string, number>>({});

  /** Draft value (user edits win) or the saved config rendered as text. */
  const toolListDraftOf = (id: string): ToolListDraft => {
    const draft = listDrafts[id];
    if (draft) return draft;
    const cfg = cfgOf(id);
    return {
      allow: (cfg?.toolAllow ?? []).join(', '),
      deny: (cfg?.toolDeny ?? []).join(', '),
    };
  };

  const splitToolList = (text: string): string[] => {
    const out: string[] = [];
    for (const raw of text.split(',')) {
      const s = raw.trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  };

  const persistToolLists = (id: string): void => {
    const draft = listDraftsRef.current[id];
    if (!draft) return;
    const cfg = cfgOf(id);
    if (!cfg) return;
    const toolAllow = splitToolList(draft.allow);
    const toolDeny = splitToolList(draft.deny);
    const same = (a: string[] | undefined, b: string[]): boolean =>
      (a ?? []).length === b.length && (a ?? []).every((x, i) => x === b[i]);
    if (same(cfg.toolAllow, toolAllow) && same(cfg.toolDeny, toolDeny)) return;
    updateSettings({
      mcpServers: mcpServers.map((s) =>
        s.id === id
          ? {
              ...s,
              // undefined (JSON-dropped) when empty — that is how a list is cleared
              toolAllow: toolAllow.length ? toolAllow : undefined,
              toolDeny: toolDeny.length ? toolDeny : undefined,
            }
          : s,
      ),
    });
  };
  const persistToolListsRef = useRef(persistToolLists); // latest closure for the unmount flush
  persistToolListsRef.current = persistToolLists;

  const setToolListDraft = (id: string, patch: Partial<ToolListDraft>): void => {
    const next: ToolListDraft = { ...toolListDraftOf(id), ...patch };
    listDraftsRef.current = { ...listDraftsRef.current, [id]: next };
    setListDrafts(listDraftsRef.current);
    window.clearTimeout(listTimers.current[id]);
    listTimers.current[id] = window.setTimeout(() => {
      delete listTimers.current[id];
      persistToolListsRef.current(id);
      // drop the draft so the inputs re-sync from the saved config
      const cleared = { ...listDraftsRef.current };
      delete cleared[id];
      listDraftsRef.current = cleared;
      setListDrafts(cleared);
    }, 700);
  };

  // flush pending card-list edits when the panel unmounts
  useEffect(
    () => () => {
      const timers = listTimers.current;
      for (const id of Object.keys(timers)) {
        window.clearTimeout(timers[id]);
        persistToolListsRef.current(id);
      }
    },
    [],
  );

  // ---------- registry search ----------
  const runRegistrySearch = useCallback(
    async (query: string, cursor?: string): Promise<void> => {
      setReg((prev) => ({ ...prev, loading: true, error: undefined }));
      const page = await safeInvoke<McpRegistryPage>(
        'mcpRegistrySearch',
        { ok: false, offline: true, error: 'Registry search unavailable (preload not updated yet).' },
        query,
        cursor,
      );
      setReg((prev) => ({
        ...prev,
        loading: false,
        searched: true,
        results: cursor ? [...prev.results, ...(page.results ?? [])] : page.results ?? [],
        nextCursor: page.nextCursor,
        error: page.error,
        offline: page.offline,
      }));
    },
    [],
  );

  const confirmAdd = useCallback(
    async (hit: McpRegistryHit): Promise<void> => {
      const res = await safeInvoke<{ ok: boolean; config?: MCPServerConfig; error?: string }>(
        'mcpRegistryAdd',
        { ok: false, error: 'Add-from-registry unavailable (preload not updated yet).' },
        hit,
      );
      setReg((prev) => ({ ...prev, confirmAdd: null }));
      if (!res.ok) {
        setReg((prev) => ({ ...prev, error: res.error || t('mcp.registry.addFailed', 'Could not add this server.') }));
        return;
      }
      // A successful result without a config is a broken bridge — never
      // switch tabs pretending the server was added.
      if (!res.config) {
        setReg((prev) => ({ ...prev, error: t('mcp.registry.noConfig', 'The registry returned no server configuration.') }));
        return;
      }
      const cfg = res.config;
      const exists = mcpServers.some((s) => s.id === cfg.id);
      updateSettings({
        mcpServers: exists ? mcpServers.map((s) => (s.id === cfg.id ? { ...s, ...cfg } : s)) : [...mcpServers, cfg],
      });
      setTab('servers');
      notify(t('mcp.registry.added', 'Added "{name}" from the registry.', { name: cfg.name }));
      void refresh();
    },
    [mcpServers, notify, refresh, t, updateSettings],
  );

  /** One-click add from the curated catalog. The config is persisted through
   *  the same mcpServerSave + settings path as every other server; entries
   *  with credentials open the edit form right after so the placeholders
   *  can be filled in. */
  const addFromCatalog = useCallback(
    async (entry: McpCatalogEntry): Promise<void> => {
      if (entry.manual) {
        setTab('servers');
        setForm(formFromCatalogEntry(entry));
        return;
      }
      setCatalogError(undefined);
      const cfg = catalogEntryToConfig(entry, uid());
      try {
        const res = await api.mcpServerSave(cfg);
        if (!res.ok) {
          setCatalogError(res.error || t('mcp.err.save', 'Could not save the server.'));
          return;
        }
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : String(err));
        return;
      }
      updateSettings({
        mcpServers: [...mcpServers.filter((s) => s.id !== cfg.id), cfg],
      });
      setTab('servers');
      void refresh();
      notify(t('mcp.catalog.addedToast', 'Added "{name}" to MCP servers.', { name: entry.name }));
      if (catalogEntryHasPlaceholders(entry)) setForm(formFromConfig(cfg));
    },
    [mcpServers, notify, refresh, t, updateSettings],
  );

  const toggleExpand = (id: string): void => {
    if (expandedId === id) {
      setExpandedId(null);
      setPreview(null);
      return;
    }
    setExpandedId(id);
    setPreview(null);
    // Health monitor can see a live server even when the registry probe
    // hasn't caught up — inspect in either case (the chevron uses the same
    // rule, so the two can't disagree).
    if (statusOf(id)?.state === 'connected' || healthOf(id)?.status === 'up') {
      void loadCaps(id);
      void loadTools(id);
    }
  };

  const readOne = async (serverId: string, uri: string): Promise<void> => {
    setPreview({ serverId, uri, loading: true });
    try {
      const content = await api.mcpReadResource(serverId, uri);
      setPreview({ serverId, uri, loading: false, content });
    } catch (err) {
      setPreview({ serverId, uri, loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const removeConfirmed = async (id: string): Promise<void> => {
    setConfirmDeleteId(null);
    try {
      const res = (await api.mcpServerDelete(id)) as { ok: boolean; error?: string };
      if (res && res.ok === false) {
        notify(res.error || t('mcp.deleteFailed', 'Could not delete the server on disk — removed from the list only.'));
      }
    } catch {
      notify(t('mcp.deleteFailed', 'Could not delete the server on disk — removed from the list only.'));
    }
    updateSettings({ mcpServers: mcpServers.filter((s) => s.id !== id) });
    // Drop every per-server cache with the server — stale health dots and
    // quarantined/test badges used to survive a deletion until full reload.
    setHealth((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setToolsX((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setCaps((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTests((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setConnectBusy((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setV2((prev) => (prev ? { ...prev, quarantined: prev.quarantined.filter((q) => q !== id) } : prev));
    if (expandedId === id) {
      setExpandedId(null);
      setPreview(null);
    }
    void refresh();
  };

  const patchForm = (patch: Partial<FormState>): void => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const submitForm = async (): Promise<void> => {
    if (!form || form.busy) return;
    const name = form.name.trim();
    const transport = form.transport;
    let headers: Record<string, string> | undefined;
    if (transport !== 'stdio' && form.headers.trim()) {
      try {
        const parsed: unknown = JSON.parse(form.headers);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
        );
      } catch {
        patchForm({ error: t('mcp.err.headers', 'Headers must be valid JSON — e.g. {"Authorization": "Bearer …"}') });
        return;
      }
    }
    const timeout = form.timeout.trim();
    if (timeout && (!/^\d+$/.test(timeout) || Number(timeout) < 1000)) {
      patchForm({ error: t('mcp.err.timeout', 'Timeout must be a whole number of milliseconds (≥ 1000).') });
      return;
    }
    if (!name) {
      patchForm({ error: t('mcp.err.name', 'Name is required.') });
      return;
    }
    if (transport === 'stdio' && !form.command.trim()) {
      patchForm({ error: t('mcp.err.command', 'A command is required for stdio servers.') });
      return;
    }
    if (transport !== 'stdio' && !/^https?:\/\//i.test(form.url.trim())) {
      patchForm({ error: t('mcp.err.url', 'The URL must start with http:// or https://.') });
      return;
    }

    const cfg: MCPServerConfig = {
      id: form.id ?? uid(),
      name,
      command: transport === 'stdio' ? form.command.trim() : '',
      args: transport === 'stdio' ? parseArgs(form.args) : undefined,
      env: Object.fromEntries(form.envRows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])),
      enabled: true,
      transport,
      url: transport === 'stdio' ? undefined : form.url.trim(),
      headers,
      timeoutMs: timeout ? Number(timeout) : undefined,
      autoReconnect: form.autoReconnect || undefined,
      // v3.1 — optional stdio working directory; `${workspace}` resolves in the
      // main process at spawn time. Empty string clears a previous value.
      cwd: transport === 'stdio' ? form.cwd.trim() || undefined : undefined,
      catalogId: form.catalogId,
    };
    patchForm({ busy: true, error: undefined });
    try {
      const res = await api.mcpServerSave(cfg);
      if (!res.ok) {
        patchForm({ busy: false, error: res.error || t('mcp.err.save', 'Could not save the server.') });
        return;
      }
    } catch (err) {
      patchForm({ busy: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    // keep the renderer store in sync (Test/Edit read configs from it)
    const exists = mcpServers.some((s) => s.id === cfg.id);
    updateSettings({
      mcpServers: exists
        ? mcpServers.map((s) => (s.id === cfg.id ? { ...s, ...cfg, enabled: s.enabled } : s))
        : [...mcpServers, cfg],
    });
    setForm(null);
    void refresh();
  };

  // ---------- render helpers ----------
  const totalLine =
    result && result.servers.length > 0
      ? tf(t, 'mcp.total', '{n} tools from {s} servers', { n: result.totalTools, s: result.servers.length })
      : '';

  const quarantinedIds = new Set(v2?.quarantined ?? []);

  const renderHealthDot = (id: string): React.ReactNode => {
    const h = healthOf(id);
    const state = h?.status === 'up' ? 'ok' : h?.status === 'down' ? 'error' : h?.status === 'quarantined' ? 'quarantined' : h?.status === 'disabled' ? 'off' : 'pending';
    const title =
      h?.status === 'quarantined'
        ? t('mcp.healthQuarantine', 'Quarantined — tool calls are blocked')
        : h?.lastError
          ? `${h.status} · ${h.lastError}`
          : `${h?.status ?? 'starting'}${h?.latencyMs != null ? ` · ${h.latencyMs} ms` : ''}${
              h && h.restarts > 0 ? ` · ${tf(t, 'mcp.restarts', '{n} auto-restarts', { n: h.restarts })}` : ''
            }`;
    return <span className={`mcp-dot shrink-0`} data-state={state} title={title} />;
  };

  const renderForm = (editing: boolean): React.ReactNode => {
    if (!form) return null;
    return (
      <div className="aurora-panel p-2.5 flex flex-col gap-1.5 shrink-0 anim-in">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-semibold flex-1 min-w-0 truncate">{editing ? form.name || t('mcp.add') : t('mcp.add')}</span>
          {form.docsUrl && (
            <button
              className="text-[10px] text-acc2 hover:underline inline-flex items-center gap-1 shrink-0"
              onClick={() => void api.openExternal(form.docsUrl as string)}
              dir="ltr"
            >
              <BookOpen size={10} />
              {t('mcp.docs')}
            </button>
          )}
          <IconBtn className="!w-6 !h-6" title={t('ws.cancel')} onClick={() => setForm(null)}>
            <X size={12} />
          </IconBtn>
        </div>
        {form.fromPreset && form.envRows.length > 0 && (
          <div className="text-[10px] text-warn leading-snug">{t('mcp.envHint')}</div>
        )}

        <TextInput
          placeholder={t('settings.mcp.name')}
          value={form.name}
          onChange={(e) => patchForm({ name: e.target.value })}
        />
        <label className="flex items-center gap-2 text-[10.5px] text-faint">
          <span className="shrink-0">{t('mcp.transport')}</span>
          <select
            className="input !h-7 !text-[11.5px] flex-1 min-w-0"
            value={form.transport}
            onChange={(e) => patchForm({ transport: e.target.value as MCPTransport })}
          >
            {TRANSPORTS.map((tr) => (
              <option key={tr} value={tr}>
                {t(`mcp.transport.${tr}`)}
              </option>
            ))}
          </select>
        </label>

        {form.transport === 'stdio' ? (
          <>
            <TextInput
              placeholder={t('settings.mcp.command')}
              className="font-code"
              dir="ltr"
              value={form.command}
              onChange={(e) => patchForm({ command: e.target.value })}
            />
            <TextInput
              placeholder={t('settings.mcp.args')}
              className="font-code"
              dir="ltr"
              value={form.args}
              onChange={(e) => patchForm({ args: e.target.value })}
            />
            <TextInput
              placeholder={t('mcp.cwdPlaceholder', 'Working directory (cwd) — optional, ${workspace} = current workspace')}
              className="font-code"
              dir="ltr"
              value={form.cwd}
              onChange={(e) => patchForm({ cwd: e.target.value })}
            />
          </>
        ) : (
          <>
            <TextInput
              placeholder={t('mcp.url')}
              className="font-code"
              dir="ltr"
              value={form.url}
              onChange={(e) => patchForm({ url: e.target.value })}
            />
            <textarea
              placeholder={t('mcp.headers')}
              rows={2}
              className="input font-code !h-auto py-1.5 !text-[11px] resize-y"
              dir="ltr"
              value={form.headers}
              onChange={(e) => patchForm({ headers: e.target.value })}
            />
          </>
        )}

        {/* environment variables */}
        <div className="flex flex-col gap-1">
          {form.envRows.map((row, i) => (
            <div key={`${row.key}-${i}`} className="flex items-center gap-1">
              <TextInput
                className="!h-7 !text-[11px] font-code"
                dir="ltr"
                placeholder="KEY"
                value={row.key}
                onChange={(e) =>
                  patchForm({ envRows: form.envRows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)) })
                }
              />
              <TextInput
                className="!h-7 !text-[11px] font-code"
                dir="ltr"
                placeholder="value"
                value={row.value}
                onChange={(e) =>
                  patchForm({ envRows: form.envRows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) })
                }
              />
              <IconBtn
                className="!w-6 !h-6 shrink-0"
                title={t('ws.delete')}
                onClick={() => patchForm({ envRows: form.envRows.filter((_, j) => j !== i) })}
              >
                <X size={11} />
              </IconBtn>
            </div>
          ))}
          <Btn
            variant="ghost"
            className="!h-6 !text-[10.5px] w-fit !px-1.5"
            onClick={() => patchForm({ envRows: [...form.envRows, { key: '', value: '' }] })}
          >
            <Plus size={10} />
            {t('mcp.env', 'Environment variable')}
          </Btn>
        </div>

        <div className="flex items-center gap-2">
          <TextInput
            className="!h-7 !text-[11px] font-code flex-1 min-w-0"
            dir="ltr"
            placeholder={t('mcp.timeout')}
            value={form.timeout}
            onChange={(e) => patchForm({ timeout: e.target.value })}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <Toggle checked={form.autoReconnect} onChange={(v) => patchForm({ autoReconnect: v })} />
            <span
              className="text-[10.5px] text-faint cursor-pointer select-none"
              onClick={() => patchForm({ autoReconnect: !form.autoReconnect })}
            >
              {t('mcp.autoReconnect')}
            </span>
          </div>
        </div>

        {form.error && <div className="text-[10.5px] text-bad leading-snug">{form.error}</div>}
        <Btn variant="primary" className="!h-7 !text-[11.5px]" disabled={form.busy} onClick={() => void submitForm()}>
          {form.busy ? <Spinner size={12} /> : <Check size={12} />}
          {t('misc.save')}
        </Btn>
      </div>
    );
  };

  /** annotation chips: RO / DANGER / IDEM / OPEN */
  const renderAnnChips = (tool: McpToolX): React.ReactNode => {
    const a = tool.annotations;
    const chips: React.ReactNode[] = [];
    if (tool.destructive) {
      chips.push(
        <Chip key="danger" tone="bad" className="!h-[15px] !text-[9px] !px-1.5">
          DANGER
        </Chip>,
      );
    } else if (a?.readOnlyHint === true) {
      chips.push(
        <Chip key="ro" tone="ok" className="!h-[15px] !text-[9px] !px-1.5" title={t('mcp.ann.ro', 'readOnlyHint — read-only tool')}>
          RO
        </Chip>,
      );
    }
    if (a?.idempotentHint === true) {
      chips.push(
        <Chip key="idem" tone="acc" className="!h-[15px] !text-[9px] !px-1.5" title={t('mcp.ann.idem', 'idempotentHint — repeat-safe')}>
          IDEM
        </Chip>,
      );
    }
    if (a?.openWorldHint === true) {
      chips.push(
        <Chip key="open" className="!h-[15px] !text-[9px] !px-1.5" title={t('mcp.ann.open', 'openWorldHint — accesses external systems')}>
          OPEN
        </Chip>,
      );
    }
    return chips.length ? <span className="inline-flex items-center gap-1 shrink-0">{chips}</span> : null;
  };

  /** anti-poisoning scanner badge with full tooltip */
  const renderFlags = (tool: McpToolX): React.ReactNode => {
    const codes = tool.suspicious ?? [];
    if (!codes.length) return null;
    const high = codes.some((c) => HIGH_RISK_CODES.has(c));
    return (
      <span
        className={`mcp-flag ${high ? 'high' : ''}`}
        title={`${t('mcp.scanner', 'Description scanner')}\n${flagTooltip(codes)}`}
      >
        <AlertTriangle size={9} />
        {codes.length}
      </span>
    );
  };

  const renderTools = (s: MCPServerStatus): React.ReactNode => {
    const st = toolsX[s.id];
    const approval = v2?.approvals ?? {};
    return (
      <div>
        <SectionTitle>
          {t('mcp.toolsList', 'Tools')} · {st?.tools?.length ?? s.toolCount ?? 0}
        </SectionTitle>
        {!st || st.loading ? (
          <div className="flex justify-center py-2">
            <Spinner size={13} />
          </div>
        ) : st.error ? (
          <div className="text-[10px] text-bad leading-snug" dir="ltr">
            {st.error}
          </div>
        ) : (st.tools ?? []).length === 0 ? (
          <div className="text-[10px] text-faint px-0.5">—</div>
        ) : (
          <div className="mcp-caps-scroll flex flex-col">
            {(st.tools ?? []).map((tool) => {
              const enabled = tool.enabled !== false;
              const remembered = approval[`${s.id}::${tool.name}`];
              return (
                <div key={tool.name} className={`mcp-tool-row ${enabled ? '' : 'off'}`}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium font-code truncate min-w-0" dir="ltr" title={tool.annotations?.title || tool.name}>
                      {tool.name}
                    </span>
                    {renderAnnChips(tool)}
                    {renderFlags(tool)}
                    {remembered === 'always' && (
                      <Chip tone="ok" className="!h-[15px] !text-[9px] !px-1.5 shrink-0" title={t('mcp.approvalAlways', 'You approved this tool ("Always allow")')}>
                        ALWAYS
                      </Chip>
                    )}
                    {remembered === 'deny' && (
                      <Chip tone="bad" className="!h-[15px] !text-[9px] !px-1.5 shrink-0" title={t('mcp.approvalDeny', 'You denied this tool — calls are blocked. Reset to allow again.')}>
                        DENIED
                      </Chip>
                    )}
                    {tool.denied === true && (
                      <Chip
                        tone="warn"
                        className="!h-[15px] !text-[9px] !px-1.5 shrink-0"
                        title={t('mcp.toolDeniedTip', 'Excluded by this server\'s allow/deny lists — never offered to the model, calls refused. Edit the lists on the server card.')}
                      >
                        DENIED
                      </Chip>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {remembered && (
                      <IconBtn
                        className="!w-5 !h-5"
                        title={t('mcp.approvalReset', 'Reset remembered approval')}
                        onClick={() => void resetApproval(s.id, tool.name)}
                      >
                        <RefreshCw size={10} />
                      </IconBtn>
                    )}
                    <Toggle
                      checked={enabled}
                      onChange={(v) => void toggleTool(s.id, tool.name, v)}
                    />
                  </div>
                  {tool.description && (
                    <div className="text-[10px] text-faint leading-snug line-clamp-1 col-span-2" dir="auto" title={tool.description}>
                      {tool.description}
                    </div>
                  )}
                  {!enabled && (
                    <div className="text-[9.5px] text-faint col-span-2">{t('mcp.toolHidden', 'Disabled — hidden from the model until re-enabled.')}</div>
                  )}
                  {tool.denied === true && (
                    <div className="text-[9.5px] text-warn col-span-2">{t('mcp.toolDeniedNote', 'Excluded by the allow/deny lists on this card — the agent never sees this tool.')}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="text-[9.5px] text-faint leading-snug mt-1">
          {t('mcp.destructiveNote', 'DANGER tools (readOnlyHint=false or destructiveHint=true) go through the agent approval gate on every call — a remembered "Deny" from the MCP panel blocks them outright.')}
        </div>
      </div>
    );
  };

  const renderCaps = (s: MCPServerStatus): React.ReactNode => {
    const c = caps[s.id];
    return (
      <div className="border-t border-line pt-2 mt-0.5 flex flex-col gap-2">
        {/* tools + annotations + scanner + per-tool switches */}
        {renderTools(s)}

        {!c || c.loading ? (
          <div className="flex justify-center py-2">
            <Spinner size={14} />
          </div>
        ) : c.error ? (
          <div className="text-[10px] text-bad leading-snug" dir="ltr">
            {c.error}
          </div>
        ) : (
          <div className="mcp-caps-scroll flex flex-col gap-2">
            {/* resources */}
            <div>
              <SectionTitle>
                {t('mcp.resources')} · {c.resources?.length ?? 0}
              </SectionTitle>
              {(c.resources ?? []).length === 0 ? (
                <div className="text-[10px] text-faint px-0.5">—</div>
              ) : (
                <div className="flex flex-col">
                  {(c.resources ?? []).map((r) => (
                    <button
                      key={r.uri}
                      className="row-hover text-start rounded-lg px-2 py-1.5 flex flex-col gap-0.5 min-w-0"
                      onClick={() => void readOne(s.id, r.uri)}
                      title={r.uri}
                    >
                      <span className="text-[11px] font-medium truncate" dir="ltr">
                        {r.name || r.uri}
                      </span>
                      {r.description && <span className="text-[10px] text-faint truncate">{r.description}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* prompts (v3.1: rows run prompts/get → rendered text in a modal) */}
            <div>
              <SectionTitle>
                {t('mcp.prompts')} · {c.prompts?.length ?? 0}
              </SectionTitle>
              {(c.prompts ?? []).length === 0 ? (
                <div className="text-[10px] text-faint px-0.5">—</div>
              ) : (
                <div className="flex flex-col">
                  {(c.prompts ?? []).map((p) => (
                    <button
                      key={p.name}
                      className="row-hover text-start rounded-lg px-2 py-1.5 flex items-center gap-1.5 min-w-0"
                      onClick={() => openPrompt(s, p)}
                      title={p.description || p.name}
                    >
                      <Play size={11} className="text-acc2 shrink-0" />
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[11px] font-medium truncate" dir="ltr">
                          {p.name}
                        </span>
                        {p.description && <span className="text-[10px] text-faint truncate">{p.description}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* resource preview */}
        {preview && preview.serverId === s.id && (
          <div className="rounded-[10px] border border-line bg-[var(--bg1)] p-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-code text-dim truncate flex-1 min-w-0" dir="ltr" title={preview.uri}>
                {preview.uri}
              </span>
              <IconBtn className="!w-5 !h-5" title={t('ws.cancel')} onClick={() => setPreview(null)}>
                <X size={11} />
              </IconBtn>
            </div>
            {preview.loading ? (
              <div className="flex justify-center py-2">
                <Spinner size={13} />
              </div>
            ) : preview.error ? (
              <div className="text-[10px] text-bad leading-snug" dir="ltr">
                {preview.error}
              </div>
            ) : preview.content?.blob !== undefined ? (
              <div className="text-[10px] text-faint" dir="ltr">
                {t('mcp.binary', 'Binary content')}
                {preview.content.mimeType ? ` · ${preview.content.mimeType}` : ''} · ~
                {Math.max(1, Math.round((preview.content.blob.length * 3) / 4)).toLocaleString('en-US')} bytes
              </div>
            ) : (
              <pre className="mcp-resource-pre">{preview.content?.text || t('mcp.emptyResource', '(empty)')}</pre>
            )}
          </div>
        )}

        {/* v3.1 — stderr tail (stdio diagnostics, last 8 KB from the pooled client) */}
        {(cfgOf(s.id)?.transport ?? 'stdio') === 'stdio' && (
          <div className="flex flex-col gap-1">
            <SectionTitle>{t('mcp.stderr', 'stderr (last 8 KB)')}</SectionTitle>
            <pre className="mcp-resource-pre !max-h-40" dir="ltr">
              {healthOf(s.id)?.stderrTail?.trim() || t('mcp.stderrEmpty', 'No stderr output captured.')}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderServerCard = (s: MCPServerStatus): React.ReactNode => {
    const cfg = cfgOf(s.id);
    const enabled = cfg?.enabled ?? s.state !== 'disabled';
    const busy = !!connectBusy[s.id];
    const test = tests[s.id];
    const transport = cfg?.transport ?? 'stdio';
    const expanded = expandedId === s.id;
    const stateKey = busy ? 'connecting' : s.state;
    const chipTone: 'ok' | 'warn' | 'bad' | 'default' =
      stateKey === 'connected' ? 'ok' : stateKey === 'connecting' ? 'warn' : stateKey === 'error' ? 'bad' : 'default';
    const h = healthOf(s.id);
    const isQ = quarantinedIds.has(s.id) || h?.status === 'quarantined';
    // The live monitor can be ahead of the registry probe. Both the chevron
    // and toggleExpand use this one predicate — no "disabled but actually up".
    const canInspect = s.state === 'connected' || h?.status === 'up';
    // A green "Connected" chip must not hide a down/quarantined health verdict.
    const healthWarn = h?.status === 'down' && stateKey === 'connected';
    const latency = s.latencyMs ?? h?.latencyMs;
    // v7.3 — last-connection status: the health monitor's snapshot when it
    // has observed this server, else the registry probe state, else "never".
    const hs = h?.status;
    const lastAt = Math.max(h?.lastCheckedAt ?? 0, s.lastCheckedAt ?? 0);
    const statusKey = hs
      ? `mcp.hstatus.${hs}`
      : s.lastCheckedAt
        ? s.state === 'connected'
          ? 'mcp.hstatus.up'
          : s.state === 'error'
            ? 'mcp.hstatus.down'
            : s.state === 'disabled'
              ? 'mcp.hstatus.disabled'
              : 'mcp.hstatus.starting'
        : 'mcp.hstatus.never';
    const statusLabel = t(statusKey, 'unknown');
    const lastConnTitle = `${statusLabel}${lastAt ? ` · ${new Date(lastAt).toLocaleString()}` : ''}${
      h?.lastError ? `\n${h.lastError}` : ''
    }`;
    return (
      <div key={s.id} className={`aurora-panel p-3 flex flex-col gap-1.5 ${!enabled ? 'opacity-60' : ''} ${isQ ? 'mcp-quarantined-card' : ''}`}>
        {/* title row */}
        <div className="flex items-center gap-1.5">
          <button
            className="icon-btn !w-5 !h-5 shrink-0"
            onClick={() => toggleExpand(s.id)}
            disabled={!canInspect}
            title={canInspect ? t('mcp.health') : t('mcp.connect')}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {renderHealthDot(s.id)}
          {(() => {
            const logo = catalogLogoFor(cfg);
            return logo ? (
              <img src={logo} alt="" className="w-4 h-4 object-contain shrink-0" draggable={false} />
            ) : (
              <Server size={13} className="text-acc2 shrink-0" />
            );
          })()}
          <span className="font-medium text-[12px] truncate flex-1 min-w-0" title={s.name}>
            {s.name}
          </span>
          <Chip tone={chipTone} className="!h-[18px] !text-[10px] !px-2 shrink-0" title={lastConnTitle}>
            {busy && <span className="pulse-dot">●</span>}
            {t(`mcp.state.${stateKey}`)}
          </Chip>
          {(isQ || healthWarn) && (
            <Chip
              tone="bad"
              className="!h-[18px] !text-[10px] !px-2 shrink-0"
              title={h?.lastError || t('mcp.healthQuarantine', 'Quarantined — tool calls are blocked')}
            >
              {isQ ? t('mcp.hstatus.quarantined', 'Quarantined') : t('mcp.hstatus.down', 'Unreachable')}
            </Chip>
          )}
          <Toggle checked={enabled} onChange={(v) => setEnabled(s.id, v)} />
        </div>

        {/* endpoint + transport */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9.5px] font-code text-faint border border-line rounded px-1 py-px uppercase shrink-0" dir="ltr">
            {transport}
          </span>
          <span className="text-[10px] font-code text-faint truncate flex-1 min-w-0" dir="ltr" title={endpointOf(cfg)}>
            {endpointOf(cfg) || '—'}
          </span>
        </div>

        {/* capability stats */}
        <div className="flex items-center gap-2.5 text-[10.5px] text-faint flex-wrap">
          <span className="inline-flex items-center gap-1" title={t('mcp.tools', '{n} tools')}>
            <Wrench size={11} className="text-acc2" />
            {tf(t, 'mcp.tools', '{n} tools', { n: h?.status === 'up' ? (h.toolCount ?? s.toolCount) : s.toolCount })}
          </span>
          <span className="inline-flex items-center gap-1" title={t('mcp.resources')}>
            <FolderOpen size={11} className="text-acc2" />
            {s.resourceCount}
          </span>
          <span className="inline-flex items-center gap-1" title={t('mcp.prompts')}>
            <MessagesSquare size={11} className="text-acc2" />
            {s.promptCount}
          </span>
          {latency != null && (
            <span className="ms-auto inline-flex items-center gap-1" title={t('mcp.latency', '{ms} ms')}>
              <Timer size={11} />
              {tf(t, 'mcp.latency', '{ms} ms', { ms: latency })}
            </span>
          )}
        </div>

        {/* v7.3 — last-connection row (registry probe + health-monitor state) */}
        <div className="flex items-center gap-1.5 text-[10px] text-faint min-w-0" title={lastConnTitle}>
          <Activity size={11} className="shrink-0" />
          <span className="truncate min-w-0">
            {tf(t, 'mcp.lastConn', 'Last connection: {status} · {when}', {
              status: statusLabel,
              when: lastAt ? new Date(lastAt).toLocaleTimeString() : '—',
            })}
          </span>
        </div>

        {/* v7.3 — per-server tool allow/deny lists (comma-separated, exact
            names or globs; deny wins). Persisted through the same
            updateSettings({ mcpServers }) flow the enable toggle uses. */}
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-[var(--bg1)] px-2 py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-[9.5px] text-faint w-10 shrink-0 uppercase"
              title={t('mcp.allowHint', 'Allow-list: exact tool names or globs (*, ?). Empty = every tool is allowed.')}
            >
              {t('mcp.allow', 'Allow')}
            </span>
            <TextInput
              className="!h-6 !text-[10px] font-code flex-1 min-w-0"
              dir="ltr"
              placeholder={t('mcp.allowPlaceholder', 'e.g. search_*, get_file — empty = all tools')}
              value={toolListDraftOf(s.id).allow}
              onChange={(e) => setToolListDraft(s.id, { allow: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-[9.5px] text-faint w-10 shrink-0 uppercase"
              title={t('mcp.denyHint', 'Deny-list: denied tools are hidden from the model and their calls are refused. DENY WINS over the allow-list.')}
            >
              {t('mcp.deny', 'Deny')}
            </span>
            <TextInput
              className="!h-6 !text-[10px] font-code flex-1 min-w-0"
              dir="ltr"
              placeholder={t('mcp.denyPlaceholder', 'e.g. delete_*, run_cmd — deny wins')}
              value={toolListDraftOf(s.id).deny}
              onChange={(e) => setToolListDraft(s.id, { deny: e.target.value })}
            />
          </div>
        </div>

        {/* quarantine banner */}
        {isQ && (
          <div className="mcp-quarantine">
            <ShieldAlert size={12} className="shrink-0" />
            <span className="flex-1 min-w-0 leading-snug">
              {t('mcp.quarantined', 'Quarantined — tool execution is blocked for this server.')}
            </span>
            <Btn variant="ghost" className="!h-6 !text-[10.5px] !px-2 shrink-0" onClick={() => void releaseQuarantine(s.id)}>
              <ShieldCheck size={11} />
              {t('mcp.release', 'Release')}
            </Btn>
          </div>
        )}

        {/* error / test-result lines */}
        {s.state === 'error' && s.error && (
          <div className="text-[10px] text-bad leading-snug line-clamp-2" title={s.error} dir="ltr">
            {s.error}
          </div>
        )}
        {h?.status === 'starting' && h.restarts > 0 && (
          <div className="text-[10px] text-warn leading-snug" title={h.lastError}>
            {tf(t, 'mcp.restarting', 'Crashed — auto-restart {n}/3 (backoff)…', { n: h.restarts })}
          </div>
        )}
        {test && !test.testing && test.ok === false && test.error && (
          <div className="text-[10px] text-bad leading-snug line-clamp-2" title={test.error} dir="ltr">
            {test.error}
          </div>
        )}

        {/* actions */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <Btn
            className="!h-7 !text-[11px] !px-2.5"
            disabled={busy || !enabled}
            onClick={() => void connectOne(s.id)}
            title={t('mcp.connect')}
          >
            {busy ? <Spinner size={11} /> : <PlugZap size={11} />}
            {t('mcp.connect')}
          </Btn>
          <Btn
            className="!h-7 !text-[11px] !px-2.5"
            disabled={!!test?.testing || !enabled}
            onClick={() => void testOne(s.id)}
            title={t('mcp.test')}
          >
            {test?.testing ? <Spinner size={11} /> : <Zap size={11} />}
            {t('mcp.test')}
          </Btn>
          {test && !test.testing && test.ok === true && (
            <Chip tone="ok" className="!h-[18px] !text-[10px] !px-2 shrink-0">
              {t('mcp.ok')}
            </Chip>
          )}
          <span className="ms-auto flex items-center gap-0.5 shrink-0">
            <IconBtn
              className="!w-6 !h-6"
              title={t('mcp.healthCheckNow', 'Health-check now')}
              onClick={() => void checkHealth(s.id)}
            >
              <Activity size={12} />
            </IconBtn>
            <IconBtn
              className="!w-6 !h-6"
              title={t('ws.rename')}
              onClick={() => {
                setForm(formFromConfig(cfg ?? ({ id: s.id, name: s.name, command: '', enabled } as MCPServerConfig)));
                setConfirmDeleteId(null);
              }}
            >
              <Pencil size={12} />
            </IconBtn>
            <IconBtn className="!w-6 !h-6" title={t('ws.delete')} onClick={() => setConfirmDeleteId(s.id)}>
              <Trash2 size={12} />
            </IconBtn>
          </span>
        </div>

        {/* delete confirmation */}
        {confirmDeleteId === s.id && (
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-[var(--bg1)] px-2 py-1.5">
            <span className="text-[10.5px] text-dim flex-1 min-w-0 truncate">{t('mcp.confirmDelete', 'Delete this server?')}</span>
            <Btn variant="danger" className="!h-6 !text-[10.5px] !px-2" onClick={() => void removeConfirmed(s.id)}>
              {t('ws.delete')}
            </Btn>
            <IconBtn className="!w-6 !h-6" title={t('ws.cancel')} onClick={() => setConfirmDeleteId(null)}>
              <X size={11} />
            </IconBtn>
          </div>
        )}

        {/* capabilities browser */}
        {expanded && (s.state === 'connected' || (caps[s.id]?.resources?.length ?? 0) > 0) && renderCaps(s)}

        {/* inline edit form */}
        {form?.id === s.id && <div className="border-t border-line pt-2">{renderForm(true)}</div>}
      </div>
    );
  };

  const renderPreset = (p: MCPRegistryPreset): React.ReactNode => (
    <div key={p.id} className="aurora-panel p-2.5 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Package size={12} className="text-acc2 shrink-0" />
        <span className="text-[11.5px] font-medium truncate flex-1 min-w-0" title={p.name}>
          {p.name}
        </span>
        <Chip className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0">{p.category}</Chip>
        <Btn className="!h-6 !px-2 !text-[10.5px] shrink-0" onClick={() => setForm(formFromPreset(p))} title={t('mcp.addFromPreset')}>
          <Plus size={11} />
          {t('mcp.addFromPreset')}
        </Btn>
      </div>
      <div className="text-[10px] text-faint leading-snug line-clamp-2">{p.description}</div>
      {p.docsUrl && (
        <button
          className="text-[10px] text-acc2 hover:underline inline-flex items-center gap-1 w-fit"
          onClick={() => void api.openExternal(p.docsUrl as string)}
          dir="ltr"
        >
          <BookOpen size={10} />
          {t('mcp.docs')}
        </button>
      )}
    </div>
  );

  // ---------- curated catalog tab ----------
  const renderCatalog = (): React.ReactNode => {
    const q = catalogQuery.trim().toLowerCase();
    const entries = MCP_CATALOG.filter((e) => {
      const inCategory = catalogCategory === 'All' || e.category === catalogCategory;
      const inQuery =
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q);
      return inCategory && inQuery;
    });
    const added = new Set(
      (mcpServers ?? []).map((s) => s.catalogId ?? s.name.trim().toLowerCase()),
    );
    return (
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <TextInput
            className="!h-7 !text-[11.5px] flex-1 min-w-0"
            dir="ltr"
            placeholder={t('mcp.catalog.search', 'Search curated servers…')}
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap shrink-0">
          {MCP_CATEGORIES.map((c) => (
            <button
              key={c}
              className={`mcp-tab !h-6 !px-2 !text-[10px] ${catalogCategory === c ? 'active' : ''}`}
              onClick={() => setCatalogCategory(c)}
            >
              {c === 'All' ? t('mcp.catalog.all', 'All') : c}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-faint leading-snug shrink-0">
          {t(
            'mcp.catalog.hint',
            'Hand-picked servers with verified install commands. Adding one writes a normal MCP server entry; fill in any credentials in the edit form that opens.',
          )}
        </div>
        {catalogError && (
          <div className="text-[10.5px] text-bad leading-snug" dir="ltr">
            {catalogError}
          </div>
        )}
        {entries.length === 0 ? (
          <Empty icon={<LayoutGrid size={22} />} title={t('mcp.catalog.empty', 'No curated server matches.')} />
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {entries.map((entry) => {
              const isAdded =
                added.has(entry.id) || added.has(entry.name.toLowerCase());
              return (
                <div key={entry.id} className="aurora-panel p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-[#15151b] border border-line shrink-0 inline-flex items-center justify-center overflow-hidden">
                      <img
                        src={entry.logo}
                        alt=""
                        className="w-6 h-6 object-contain"
                        draggable={false}
                      />
                    </span>
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-[11.5px] font-semibold truncate" title={entry.name}>
                        {entry.name}
                      </span>
                      <span className="text-[9.5px] text-faint truncate" title={entry.publisher}>
                        {entry.publisher}
                      </span>
                    </span>
                    <Chip className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0">{entry.category}</Chip>
                    <Chip className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0 uppercase">{entry.transport}</Chip>
                    {entry.manual && (
                      <Chip tone="warn" className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0">
                        {t('mcp.catalog.manual', 'Manual setup')}
                      </Chip>
                    )}
                    {isAdded && (
                      <Chip tone="ok" className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0">
                        {t('mcp.catalog.added', 'Added')}
                      </Chip>
                    )}
                  </div>
                  <div className="text-[10px] text-faint leading-snug">{entry.description}</div>
                  <div
                    className="text-[9.5px] font-code text-dim truncate"
                    dir="ltr"
                    title={entry.transport === 'stdio' ? `${entry.command ?? ''} ${(entry.args ?? []).join(' ')}` : entry.url}
                  >
                    {entry.transport === 'stdio'
                      ? `${entry.command ?? ''} ${(entry.args ?? []).join(' ')}`
                      : entry.url}
                  </div>
                  {entry.envHints?.map((hint) => (
                    <div key={hint} className="text-[9.5px] text-warn leading-snug" dir="auto">
                      • {hint}
                    </div>
                  ))}
                  {entry.note && (
                    <div className="text-[9.5px] text-faint leading-snug" dir="auto">
                      {entry.note}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Btn
                      variant="primary"
                      className="!h-6 !px-2 !text-[10.5px] shrink-0"
                      disabled={isAdded}
                      onClick={() => void addFromCatalog(entry)}
                      title={entry.manual ? t('mcp.catalog.setup', 'Open setup form') : t('mcp.catalog.addOneClick', 'Add to MCP servers')}
                    >
                      <Plus size={11} />
                      {entry.manual ? t('mcp.catalog.setup', 'Set up…') : t('mcp.catalog.addOneClick', 'Add server')}
                    </Btn>
                    <Btn
                      variant="ghost"
                      className="!h-6 !px-2 !text-[10.5px] shrink-0"
                      onClick={() => {
                        setTab('servers');
                        setForm(formFromCatalogEntry(entry));
                      }}
                    >
                      <Pencil size={11} />
                      {t('mcp.registry.customize', 'Customize…')}
                    </Btn>
                    <button
                      className="text-[10px] text-acc2 hover:underline inline-flex items-center gap-1 ms-auto"
                      onClick={() => void api.openExternal(entry.docsUrl)}
                      dir="ltr"
                    >
                      <BookOpen size={10} />
                      {t('mcp.docs')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ---------- registry tab ----------
  const renderRegistry = (): React.ReactNode => (
    <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-1.5 shrink-0">
        <TextInput
          className="!h-7 !text-[11.5px] flex-1 min-w-0"
          dir="ltr"
          placeholder={t('mcp.registry.placeholder', 'Search the official MCP registry…')}
          value={reg.query}
          onChange={(e) => setReg((prev) => ({ ...prev, query: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runRegistrySearch(reg.query.trim());
          }}
        />
        <Btn variant="primary" className="!h-7 !text-[11.5px] !px-2.5 shrink-0" disabled={reg.loading} onClick={() => void runRegistrySearch(reg.query.trim())}>
          {reg.loading ? <Spinner size={11} /> : <Search size={11} />}
          {t('mcp.registry.search', 'Search')}
        </Btn>
      </div>
      <div className="text-[10px] text-faint leading-snug shrink-0">
        {t('mcp.registry.hint', 'registry.modelcontextprotocol.io — 30k+ community servers. Review the install command before adding.')}
      </div>

      {reg.error && (
        <div className={`text-[10.5px] leading-snug ${reg.offline ? 'text-warn' : 'text-bad'}`}>{reg.error}</div>
      )}

      {reg.loading && !reg.searched ? (
        <div className="flex justify-center py-6">
          <Spinner size={16} />
        </div>
      ) : reg.searched && reg.results.length === 0 ? (
        <Empty icon={<Globe size={22} />} title={t('mcp.registry.empty', 'No registry matches. Try another query.')} />
      ) : (
        reg.results.map((hit) => (
          <div key={hit.id} className="aurora-panel p-2.5 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Globe size={12} className="text-acc2 shrink-0" />
              <span className="text-[11.5px] font-medium truncate flex-1 min-w-0" title={hit.id}>
                {hit.title || hit.name}
              </span>
              <Chip className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0 uppercase">{hit.transport}</Chip>
              {hit.version && <Chip className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0">v{hit.version}</Chip>}
              {hit.status && hit.status !== 'active' && (
                <Chip tone="warn" className="!h-[16px] !text-[9.5px] !px-1.5 shrink-0">
                  {hit.status}
                </Chip>
              )}
            </div>
            {hit.description && <div className="text-[10px] text-faint leading-snug line-clamp-2">{hit.description}</div>}
            <div className="text-[9.5px] font-code text-faint truncate" dir="ltr" title={hit.transport === 'stdio' ? `${hit.command ?? ''} ${(hit.args ?? []).join(' ')}` : hit.url ?? ''}>
              {hit.transport === 'stdio' ? `${hit.command ?? ''} ${(hit.args ?? []).join(' ')}` : hit.url}
            </div>
            {reg.confirmAdd?.id === hit.id ? (
              <div className="flex items-center gap-2 rounded-[10px] border border-line bg-[var(--bg1)] px-2 py-1.5">
                <span className="text-[10.5px] text-dim flex-1 min-w-0 truncate">
                  {t('mcp.registry.confirmAdd', 'Add this server to your MCP config?')}
                </span>
                <Btn variant="primary" className="!h-6 !text-[10.5px] !px-2 shrink-0" onClick={() => void confirmAdd(hit)}>
                  <Check size={11} />
                  {t('mcp.registry.add', 'Add server')}
                </Btn>
                <IconBtn className="!w-6 !h-6" title={t('ws.cancel')} onClick={() => setReg((prev) => ({ ...prev, confirmAdd: null }))}>
                  <X size={11} />
                </IconBtn>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Btn
                  className="!h-6 !px-2 !text-[10.5px] w-fit"
                  onClick={() => setReg((prev) => ({ ...prev, confirmAdd: hit }))}
                  title={t('mcp.registry.add', 'Add server')}
                >
                  <Plus size={11} />
                  {t('mcp.registry.add', 'Add server')}
                </Btn>
                <Btn
                  variant="ghost"
                  className="!h-6 !px-2 !text-[10.5px] w-fit"
                  onClick={() => {
                    setTab('servers'); // the add/edit form lives on the servers tab
                    setForm(formFromRegistryHit(hit));
                  }}
                >
                  <Pencil size={11} />
                  {t('mcp.registry.customize', 'Customize…')}
                </Btn>
                {hit.docsUrl && (
                  <button
                    className="text-[10px] text-acc2 hover:underline inline-flex items-center gap-1 ms-auto"
                    onClick={() => void api.openExternal(hit.docsUrl as string)}
                    dir="ltr"
                  >
                    <BookOpen size={10} />
                    {t('mcp.docs')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {reg.nextCursor && !reg.loading && (
        <Btn variant="ghost" className="!h-7 !text-[11px]" onClick={() => void runRegistrySearch(reg.query.trim(), reg.nextCursor)}>
          <ChevronDown size={12} />
          {t('mcp.registry.more', 'Load more')}
        </Btn>
      )}
    </div>
  );

  // ---------- activity tab (call log drawer) ----------
  const renderActivity = (): React.ReactNode => {
    const log = callLog ?? [];
    return (
      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10.5px] text-faint flex-1 min-w-0 truncate">
            {t('mcp.activity.hint', 'Last 100 MCP tool calls this session (cleared on restart).')}
          </span>
          <IconBtn title={t('mcp.refresh')} onClick={() => void loadCallLog()}>
            <RefreshCw size={12} />
          </IconBtn>
          <Btn
            variant="ghost"
            className="!h-6 !text-[10.5px] !px-2"
            disabled={!log.length}
            onClick={() => void clearCallLog()}
          >
            <Trash2 size={11} />
            {t('mcp.activity.clear', 'Clear')}
          </Btn>
        </div>
        {callLog === null ? (
          <div className="flex justify-center py-4">
            <Spinner size={14} />
          </div>
        ) : log.length === 0 ? (
          <Empty icon={<Activity size={22} />} title={t('mcp.activity.empty', 'No tool calls yet this session.')} />
        ) : (
          [...log].reverse().map((e, i) => (
            <div key={`${e.at}-${i}`} className="aurora-panel px-2 py-1.5 flex items-center gap-1.5 min-w-0">
              <span className="text-[9.5px] font-code text-faint shrink-0 tabular-nums" title={new Date(e.at).toLocaleString()}>
                {new Date(e.at).toLocaleTimeString()}
              </span>
              <span className="text-[10.5px] font-medium truncate max-w-[30%] shrink-0" title={e.server}>
                {e.server || e.serverId}
              </span>
              <span className="text-[10.5px] font-code text-dim truncate flex-1 min-w-0" dir="ltr" title={e.tool}>
                {e.tool}
              </span>
              <Chip tone={e.ok ? 'ok' : 'bad'} className="!h-[16px] !text-[9px] !px-1.5 shrink-0">
                {e.ok ? 'OK' : 'FAIL'}
              </Chip>
              <span className="text-[9.5px] font-code text-faint shrink-0 tabular-nums w-12 text-end">{e.ms} ms</span>
              {e.error && (
                <span className="text-[9.5px] text-bad truncate max-w-[30%]" dir="ltr" title={e.error}>
                  {e.error}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    );
  };

  // ---------- main render ----------
  const tabs: Array<{ id: PanelTab; label: string; icon: React.ReactNode }> = [
    { id: 'servers', label: t('mcp.tab.servers', 'Servers'), icon: <Server size={11} /> },
    { id: 'catalog', label: t('mcp.tab.catalog', 'Catalog'), icon: <LayoutGrid size={11} /> },
    { id: 'registry', label: t('mcp.tab.registry', 'Registry'), icon: <Globe size={11} /> },
    { id: 'activity', label: t('mcp.tab.activity', 'Activity'), icon: <Activity size={11} /> },
  ];
  // Honest figures for the connection plate — derived from live state only.
  const plateServers = result?.servers ?? [];
  const plateTotal = plateServers.length;
  const plateConnected = plateServers.filter(
    (s) => s.state === 'connected' || health[s.id]?.status === 'up',
  ).length;
  const plateTools = result?.totalTools ?? 0;

  return (
    <div className={`page-v14 art-mcp p-2 flex flex-col gap-2 min-h-0 ${embedded ? 'flex-1' : 'h-full'}`}>
      {/* page header */}
      <PageHead
        eyebrow={mcpAr ? '٠١ / خوادم MCP' : '01 / MCP SERVERS'}
        title={t('mcp.title', 'MCP connections')}
        description={t('mcp.desc', 'Connect external tools, inspect their capabilities and review every call.')}
        toolbar={<McpGlyph />}
        actions={
          <>
            <IconBtn className="!w-7 !h-7" title={t('mcp.refresh')} onClick={() => void refresh()}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </IconBtn>
            <Btn variant="primary" onClick={() => { setTab('servers'); setForm(emptyForm()); }}>
              <Plus size={13} />
              {t('mcp.add')}
            </Btn>
          </>
        }
      />

      {/* the instrument: exact 6-spoke connection plate from live health */}
      <McpPlate total={plateTotal} connected={plateConnected} tools={plateTools} ar={mcpAr} />

      {/* tabs */}
      <div className="mcp-tabs shrink-0">
        {tabs.map((tb) => (
          <button key={tb.id} className={`mcp-tab ${tab === tb.id ? 'active' : ''}`} onClick={() => setTab(tb.id)}>
            {tb.icon}
            {tb.label}
            {tb.id === 'servers' && result && result.servers.length > 0 && (
              <span className="mcp-tab-count">{result.servers.length}</span>
            )}
            {tb.id === 'activity' && callLog && callLog.length > 0 && <span className="mcp-tab-count">{callLog.length}</span>}
          </button>
        ))}
      </div>

      {/* add form (servers tab, when adding) */}
      {tab === 'servers' && form && form.id === null && renderForm(false)}

      {tab === 'servers' && (
        <>
          {/* auto-quarantine switch */}
          <div className="flex items-center gap-2 shrink-0 px-0.5">
            <ShieldCheck size={11} className="text-acc2 shrink-0" />
            <span className="text-[10.5px] text-faint flex-1 min-w-0 leading-snug">
              {t('mcp.autoQuarantine', 'Auto-quarantine servers whose tool descriptions look poisoned')}
            </span>
            <Toggle checked={!!v2?.autoQuarantine} onChange={(v) => void setAutoQuarantine(v)} />
          </div>
          {totalLine && <div className="text-[10.5px] text-faint shrink-0 -mt-1 px-0.5">{totalLine}</div>}

          {/* server cards */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0">
            {loading && !result ? (
              <div className="flex justify-center py-6">
                <Spinner size={16} />
              </div>
            ) : result && result.servers.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-8 px-6 anim-in">
                <Plug size={20} className="text-[var(--faint)]" strokeWidth={1.5} aria-hidden />
                <div className="text-[13px] font-semibold mt-2.5 mb-1">{t('mcp.empty')}</div>
                <Btn
                  variant="primary"
                  className="!h-7 !text-[11px] mt-2"
                  onClick={() => {
                    setTab('servers');
                    setForm(emptyForm());
                  }}
                >
                  <Plus size={12} />
                  {t('mcp.add')}
                </Btn>
              </div>
            ) : (
              result?.servers.map((s) => renderServerCard(s))
            )}
          </div>

          {/* presets gallery */}
          {result && result.presets.length > 0 && (
            <div className="shrink-0 flex flex-col gap-1.5">
              <SectionTitle>{t('mcp.presets')}</SectionTitle>
              <div className="max-h-56 overflow-y-auto flex flex-col gap-1.5 pe-0.5">
                {result.presets.map((p) => renderPreset(p))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'catalog' && renderCatalog()}
      {tab === 'registry' && renderRegistry()}
      {tab === 'activity' && renderActivity()}

      {/* v3.1 — prompt runner: optional key=value args → prompts/get → rendered text */}
      <Modal
        open={!!promptRun}
        onClose={() => setPromptRun(null)}
        title={
          promptRun ? `${promptRun.prompt.name} · ${promptRun.serverName}` : t('mcp.prompts')
        }
        width={640}
        footer={
          <div className="flex items-center gap-1.5 justify-end">
            {promptRun?.text !== undefined && (
              <Btn variant="ghost" className="!h-7 !text-[11px]" onClick={copyPromptText}>
                <Copy size={11} />
                {promptRun.copied ? t('mcp.copied', 'Copied!') : t('mcp.copy', 'Copy')}
              </Btn>
            )}
            <Btn variant="ghost" className="!h-7 !text-[11px]" onClick={() => setPromptRun(null)}>
              {t('ws.cancel')}
            </Btn>
          </div>
        }
      >
        {promptRun?.loading ? (
          <div className="flex justify-center py-6">
            <Spinner size={16} />
          </div>
        ) : promptRun && promptRun.text === undefined ? (
          <div className="flex flex-col gap-2">
            {promptRun.error && (
              <div className="text-[10.5px] text-bad leading-snug" dir="ltr">
                {promptRun.error}
              </div>
            )}
            <div className="text-[10.5px] text-faint leading-snug">
              {promptRun.prompt.description || t('mcp.promptArgsHint', 'Fill the prompt arguments (key=value), then get the rendered text.')}
            </div>
            {(promptRun.prompt.arguments ?? []).map((a) => (
              <label key={a.name} className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-code text-dim w-28 shrink-0 truncate" dir="ltr" title={a.description || a.name}>
                  {a.name}
                  {a.required && <span className="text-bad"> *</span>}
                </span>
                <TextInput
                  className="!h-7 !text-[11px] font-code flex-1 min-w-0"
                  dir="ltr"
                  value={promptRun.values[a.name] ?? ''}
                  onChange={(e) =>
                    setPromptRun((prev) =>
                      prev ? { ...prev, values: { ...prev.values, [a.name]: e.target.value } } : prev,
                    )
                  }
                />
              </label>
            ))}
            <Btn
              variant="primary"
              className="!h-7 !text-[11.5px] w-fit"
              disabled={promptRun.loading}
              onClick={() =>
                void fetchPrompt(promptRun.serverId, promptRun.serverName, promptRun.prompt, promptRun.values)
              }
            >
              <Play size={11} />
              {t('mcp.promptGet', 'Get prompt')}
            </Btn>
          </div>
        ) : (
          promptRun && (
            <pre className="mcp-resource-pre" dir="auto">
              {promptRun.text || t('mcp.emptyResource', '(empty)')}
            </pre>
          )
        )}
      </Modal>
    </div>
  );
}

export default MCPPanel;
