// SADEEM — Live Preview: a full main-area canvas that shows the website/app
// the agent is building (Codex/Claude-Code-class artifacts view).
// Sources: a running dev server (auto-detected), a static serve of the
// workspace (or any single HTML file), or any URL the user types.
// Extras: source selector, URL history, guest-page console drawer,
// device frame, auto-refresh on file changes, 50–150% zoom.
// Muted matte surfaces, no gradients.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  FlaskConical,
  History,
  Link2,
  Minus,
  Monitor,
  Play,
  Braces,
  Plus,
  Radar,
  RefreshCw,
  Smartphone,
  Square,
  Tablet,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { Btn, IconBtn } from './ui';
import { BrowserDock } from './BrowserDock';
import type { AppSettings } from '../../shared/types';
import './chat-final.css';
// v11.26 (A3) — the auto-open polish layer. Additive: hairlines + whitespace,
// token colors only, no glow/gradient/blur. Owns the .pv2-* contract so it
// never rewrites the launch-polish sheet (chat-final.css) it sits on top of.
import './preview.css';

// Electron <webview> tag — enabled via webviewTag: true in main.ts.
// React's types already declare the element; we only need a small method surface.
type WebviewMethods = {
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  /** v11.38 — focus the guest so a freshly opened preview is interactive at once. */
  focus?(): void;
  // guest page JS (used by the blank-page diagnose check; may reject when the
  // guest is sandboxed — callers must treat a rejection as “unknown”)
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
};

type PreviewTarget = {
  kind: 'dev' | 'static' | 'file' | 'artifact';
  label: string;
  dir?: string;
  /** v10.3 — which runtime launches this dev target (v11.11 adds 'go' from detectTargets). */
  runtime?: 'python' | 'custom' | 'go';
};

type ConsoleLevel = 'log' | 'warn' | 'error';
type ConsoleLine = { id: number; level: ConsoleLevel; text: string; ts: number };

const DEVICES = [
  { id: 'full', icon: Monitor, width: 0 },
  { id: 'tablet', icon: Tablet, width: 820 },
  { id: 'mobile', icon: Smartphone, width: 400 },
] as const;
type DeviceId = (typeof DEVICES)[number]['id'];

const MAX_CONSOLE_LINES = 300;
const ZOOM_MIN = 50;
const ZOOM_MAX = 150;
const ZOOM_STEP = 10;

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: 'text-dim',
  warn: 'text-warn',
  error: 'text-bad',
};

const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z)));

const normLevel = (raw: unknown): ConsoleLevel => {
  if (raw === 'error' || raw === 3 || raw === '3') return 'error';
  if (raw === 'warning' || raw === 'warn' || raw === 2 || raw === '2') return 'warn';
  return 'log';
};

const fmtTime = (ts: number): string => new Date(ts).toLocaleTimeString('en-GB', { hour12: false });

/**
 * detectTargets() lives in the main process behind `kdx:preview:targets`.
 * The handler + preload method are wired by the orchestrator; until then this
 * typed cast degrades gracefully (undefined call → empty target list).
 */
type TargetsBridge = { previewTargets?: (workspace: string) => Promise<unknown[]> };
const targetsApi: TargetsBridge = typeof window !== 'undefined' ? (window.surnia as unknown as TargetsBridge) : {};

/**
 * Normalize one raw detectTargets() row from the main process. Exported for the
 * preview test harness (v1111-preview-universal) — pure, no React/DOM access.
 * BUG FIXED v11.11 (A3): `runtime: 'go'` used to be dropped here, so a Go
 * workspace's dev target was launched as npm ("No package.json" error) — both
 * from the source menu and from the engine-driven auto-open request.
 */
export function parseTarget(raw: unknown): PreviewTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'dev' && o.kind !== 'static' && o.kind !== 'file' && o.kind !== 'artifact') return null;
  if (typeof o.label !== 'string' || !o.label) return null;
  return {
    kind: o.kind,
    label: o.label,
    dir: typeof o.dir === 'string' ? o.dir : undefined,
    runtime: o.runtime === 'python' || o.runtime === 'custom' || o.runtime === 'go' ? o.runtime : undefined,
  };
}

/* Inline globe icon (16px) to keep the toolbar visually consistent. */
function GlobeIcon(): React.ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function kindIcon(kind: PreviewTarget['kind'], runtime?: PreviewTarget['runtime']): React.ReactElement {
  if (kind === 'dev') {
    if (runtime === 'python') return <Terminal size={11} className="text-acc shrink-0" />;
    if (runtime === 'custom') return <Braces size={11} className="text-acc shrink-0" />;
    return <Play size={11} className="text-acc shrink-0" />;
  }
  if (kind === 'file') return <Link2 size={11} className="text-acc2 shrink-0" />;
  if (kind === 'artifact') return <FileText size={11} className="text-acc2 shrink-0" />; // pdf/img/md/… viewer entry
  return <GlobeIcon />;
}

/**
 * FINAL POLISH — original, license-clean empty-state ornament: a framed
 * viewport with a folded top-right corner and hairline dimension marks.
 * currentColor + existing tokens only; no gradients, no glows, no raster.
 */
function PreviewOrnament(): React.ReactElement {
  return (
    <svg className="pv-ornament" viewBox="0 0 240 148" role="img" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1" strokeLinejoin="miter" strokeLinecap="square">
      {/* top dimension mark */}
      <path d="M28 12 H212 M28 8 V16 M212 8 V16" opacity="0.55" />
      {/* framed viewport with a folded top-right corner */}
      <path d="M28 26 H196 L212 42 V134 H28 Z" />
      <path d="M196 26 V42 H212" opacity="0.75" />
      <path d="M196 26 L212 42 L196 42 Z" fill="var(--bg1)" />
      {/* inner hairline + chrome rule */}
      <rect x="34" y="32" width="172" height="96" strokeWidth="0.5" opacity="0.35" />
      <path d="M28 42 H196" opacity="0.6" />
      {/* quiet page glyphs (real geometry, no invented data) */}
      <path d="M44 58 H126 M44 68 H96 M44 84 H150 M44 94 H118 M44 110 H134" opacity="0.3" />
      {/* right dimension mark */}
      <path d="M226 26 V134 M222 26 H230 M222 134 H230" opacity="0.55" />
    </svg>
  );
}

/* Floating menu shared by the source selector and the history dropdown. */
function Popover({
  align = 'start',
  onClose,
  children,
}: {
  align?: 'start' | 'end';
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        className={`absolute top-full mt-1.5 z-40 min-w-[230px] max-w-[380px] aurora-panel p-1.5 anim-in shadow-card ${align === 'end' ? 'end-0' : 'start-0'}`}
      >
        {children}
      </div>
    </>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[8px] text-[12px] text-dim hover:text-ink hover:bg-[var(--hover)] transition-colors text-start focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--acc)_45%,transparent)]"
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      <span className="flex-1 min-w-0 truncate font-code" dir="ltr">
        {label}
      </span>
      {hint && <span className="text-[10px] text-faint shrink-0 uppercase tracking-wide">{hint}</span>}
    </button>
  );
}

/* Phone/tablet bezel with matte notch + home indicator (palette vars only). */
function DeviceFrame({
  width,
  children,
}: {
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 flex items-stretch justify-center overflow-hidden py-4">
      <div
        className="relative flex flex-col rounded-[2.2rem] border border-line bg-[var(--panel)] p-2 shadow-card"
        style={{ width: `min(${width}px, 100%)`, borderRadius: '2.2rem' }}
      >
        {/* top bezel — speaker/notch */}
        <div className="relative h-6 shrink-0 flex items-center justify-center">
          <div className="h-3.5 w-20 rounded-full bg-[var(--panel2)] border border-line" />
        </div>
        {/* screen */}
        <div className="relative flex-1 min-h-0 rounded-[1.5rem] border border-line overflow-hidden bg-white">{children}</div>
        {/* bottom bezel — home indicator */}
        <div className="h-6 shrink-0 flex items-center justify-center">
          <div className="h-1 w-20 rounded-full bg-[var(--panel2)]" />
        </div>
      </div>
    </div>
  );
}

export function PreviewArea() {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const previewUrl = useStore((s) => s.previewUrl);
  const status = useStore((s) => s.previewStatus);
  const wsPath = useStore((s) => s.wsPath);
  const settingsPreview = useStore((s) => s.settings.preview);
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  const navigatePreview = useStore((s) => s.navigatePreview);
  const refreshPreviewStatus = useStore((s) => s.refreshPreviewStatus);
  const startStaticPreview = useStore((s) => s.startStaticPreview);
  const startDevPreview = useStore((s) => s.startDevPreview);
  const stopDevPreview = useStore((s) => s.stopDevPreview);
  const previewError = useStore((s) => s.previewError);
  const dismissPreviewError = useStore((s) => s.dismissPreviewError);
  const updateSettings = useStore((s) => s.updateSettings);
  // v11.11 (A3) — engine-driven auto-open request (completion hook → store)
  const previewAuto = useStore((s) => s.previewAuto);

  const [draft, setDraft] = useState(previewUrl);
  // v11.9 — view tabs: the live preview canvas + the agent's hidden browser
  // (BrowserDock — kdx:browser:state/event/close finally have UI).
  const [viewTab, setViewTab] = useState<'preview' | 'browser'>('preview');
  const [device, setDevice] = useState<DeviceId>('full');
  const [loading, setLoading] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // v11.26 — the machine errorDescription from webview `did-fail-load` stays
  // behind a localized disclosure; the prose above it is always dir="auto".
  const [failedLogOpen, setFailedLogOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [blankHint, setBlankHint] = useState(false);
  const [openMenu, setOpenMenu] = useState<'none' | 'source' | 'history'>('none');
  const [history, setHistory] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(() => settingsPreview?.console === true);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [targets, setTargets] = useState<PreviewTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  // webview node in state so effects re-wire whenever it mounts/unmounts
  const wvRef = useRef<WebviewMethods | null>(null);
  const [wvNode, setWvNode] = useState<WebviewMethods | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);
  const reloadTimer = useRef<number | null>(null);
  const consoleSeq = useRef(0);

  useEffect(() => setDraft(previewUrl), [previewUrl]);

  // ---- persisted preview settings (settings.preview.* are all optional) ----
  const deviceFrame = settingsPreview?.deviceFrame === true;
  const autoRefresh = settingsPreview?.autoRefresh !== false;
  const zoom = clampZoom(settingsPreview?.zoom ?? 100);
  const autoDetect = settingsPreview?.autoDetect !== false;

  const persistPreview = useCallback(
    (patch: Partial<NonNullable<AppSettings['preview']>>) => {
      updateSettings({ preview: { ...(settingsPreview ?? {}), ...patch } });
    },
    [settingsPreview, updateSettings],
  );

  // refs mirroring settings for stable event-callback deps
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  // v11.38 — when a preview_open arrives, the panel must come forward AND be
  // focused (not sit behind the chat asking for a click). Focus the guest
  // webview first so scrolling/clicking works immediately; the panel container
  // is the fallback when the guest has no focus() yet.
  const focusPreview = useCallback((): void => {
    setViewTab('preview');
    window.setTimeout(() => {
      try {
        wvRef.current?.focus?.();
      } catch {
        /* guest not ready — container focus below still applies */
      }
      try {
        panelRef.current?.focus({ preventScroll: true });
      } catch {
        /* no focus options support */
      }
    }, 30);
  }, []);

  // ---- URL history (max 8, deduped) ----
  useEffect(() => {
    if (!previewUrl) return;
    setHistory((h) => [previewUrl, ...h.filter((u) => u !== previewUrl)].slice(0, 8));
  }, [previewUrl]);

  // ---- poll server/port status while the panel is visible (5s) ----
  useEffect(() => {
    void refreshPreviewStatus();
    const iv = setInterval(() => void refreshPreviewStatus(), 5000);
    return () => clearInterval(iv);
  }, [refreshPreviewStatus]);

  // ---- detect preview targets (once per workspace, unless disabled) ----
  const detect = useCallback(async (): Promise<void> => {
    if (!wsPath) return;
    setTargetsLoading(true);
    try {
      const res = await targetsApi.previewTargets?.(wsPath);
      const list = (Array.isArray(res) ? res : []).map(parseTarget).filter((x): x is PreviewTarget => x !== null);
      setTargets(list);
    } catch {
      setTargets([]);
    } finally {
      setTargetsLoading(false);
    }
  }, [wsPath]);

  const autoDetectRef = useRef(autoDetect);
  autoDetectRef.current = autoDetect;
  useEffect(() => {
    if (wsPath && autoDetectRef.current) void detect();
  }, [wsPath, detect]);

  // ---- console drawer helpers ----
  const pushConsole = useCallback((level: ConsoleLevel, text: string) => {
    if (!text.trim()) return;
    setConsoleLines((prev) => {
      const next = prev.length >= MAX_CONSOLE_LINES ? prev.slice(prev.length - MAX_CONSOLE_LINES + 1) : prev.slice();
      next.push({ id: ++consoleSeq.current, level, text: text.slice(0, 500), ts: Date.now() });
      return next;
    });
  }, []);

  // auto-scroll the console drawer
  useEffect(() => {
    const el = consoleBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines, consoleOpen]);

  // debounced auto-refresh reload (preview event {kind:'watch'})
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      try {
        wvRef.current?.reload();
      } catch {
        /* webview not mounted */
      }
    }, 300);
  }, []);

  useEffect(
    () => () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    },
    [],
  );

  // ---- preview push events: watch → reload, log → console drawer,
  //      static/dev READY → adopt the REAL verified loopback URL ----
  // v11.38 — the service emits `ready` only AFTER a real HTTP answer. The
  // panel used to ignore that event entirely, so a server started by a tool
  // (or by auto-open) could be running while the UI still showed "IDLE".
  // Adopting the URL here makes every real server start visible, regardless
  // of which code path launched it. No fake "ready" is ever synthesized.
  useEffect(() => {
    if (typeof api.onPreviewEvent !== 'function') return;
    const off = api.onPreviewEvent((e) => {
      if (e.kind === 'watch') {
        if (autoRefreshRef.current) scheduleReload();
      } else if (e.kind === 'log') {
        pushConsole(normLevel(e.level ?? 'log'), e.text ?? '');
      } else if ((e.kind === 'static' || e.kind === 'dev') && e.state === 'ready' && e.url) {
        setFailed(null);
        setBlankHint(false);
        setPreviewOpen(true);
        navigatePreview(e.url); // real address from the verified server
        focusPreview();
      }
    });
    return off;
  }, [scheduleReload, pushConsole, setPreviewOpen, navigatePreview, focusPreview]);

  // ---- webview event wiring (imperative — DOM events, not JSX props) ----
  useEffect(() => {
    const wv = wvNode as unknown as EventTarget | null;
    if (!wv) return;
    const onStart = (): void => {
      setLoading(true);
      setFailed(null);
      setFailedLogOpen(false);
      setBlankHint(false); // new navigation — give the page a fresh chance
    };
    const onStop = (): void => setLoading(false);
    const onFail = (e: Event): void => {
      const detail = ((e as CustomEvent).detail ?? e) as {
        isMainFrame?: boolean;
        errorCode: number;
        errorDescription?: string;
      };
      if (detail.isMainFrame !== false && detail.errorCode !== -3) {
        setLoading(false);
        setFailed(detail.errorDescription || `error ${detail.errorCode}`);
      }
    };
    const onConsole = (e: Event): void => {
      const anyEv = e as CustomEvent<{
        level?: unknown;
        message?: string;
        text?: string;
      }> & { level?: unknown; message?: string; text?: string };
      const d = anyEv.detail ?? anyEv;
      const text = d?.message ?? d?.text ?? '';
      if (!text) return;
      pushConsole(normLevel(d?.level), text);
    };
    wv.addEventListener('dom-ready', onStop);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('console-message', onConsole);
    return () => {
      wv.removeEventListener('dom-ready', onStop);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('console-message', onConsole);
    };
  }, [wvNode, pushConsole]);

  const attachWv = useCallback((node: unknown) => {
    const wv = (node as WebviewMethods) ?? null;
    wvRef.current = wv;
    setWvNode(wv);
  }, []);

  // ---- blank-page diagnose: 5s after navigation, ask the guest whether any
  // content painted. executeJavaScript may reject (sandboxed guest, crashed
  // renderer, PDF plug-in frame) — a rejection is “unknown”, never a hint.
  // Only a definitive `0` (empty <body>) raises the overlay.
  useEffect(() => {
    setBlankHint(false);
    if (!previewUrl || !wvNode) return;
    const timer = window.setTimeout(() => {
      try {
        void wvNode
          .executeJavaScript('document.body ? document.body.innerHTML.length : -1')
          .then((len: unknown) => {
            if (len === 0) setBlankHint(true); // loaded, but nothing painted
          })
          .catch(() => {
            /* guest refused — unknown, don't nag */
          });
      } catch {
        /* webview detached between timer and call */
      }
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [previewUrl, wvNode]);

  // ---- actions ----
  const closeMenus = useCallback(() => setOpenMenu('none'), []);

  // A popover is click-outside-dismissed; add the keyboard path too so an
  // open source/history menu never becomes a focus trap (Esc is universal).
  useEffect(() => {
    if (openMenu === 'none') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openMenu]);

  const submitUrl = (): void => {
    if (draft.trim()) {
      setFailed(null);
      setBlankHint(false);
      closeMenus();
      navigatePreview(draft);
    }
  };

  const openExternal = (): void => {
    const url = wvRef.current?.getURL?.() || previewUrl;
    if (url) void api.openExternal(url);
  };

  // Copy the REAL current address (webview URL first, then store URL).
  const copyUrl = async (): Promise<void> => {
    const url = wvRef.current?.getURL?.() || previewUrl || draft.trim();
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1400);
    } catch {
      /* clipboard unavailable — leave the field untouched */
    }
  };

  const reload = (): void => {
    setFailed(null);
    setFailedLogOpen(false);
    setBlankHint(false);
    try {
      wvRef.current?.reload();
    } catch {
      /* not mounted yet */
    }
  };

  const focusUrlInput = (): void => {
    window.setTimeout(() => urlInputRef.current?.focus(), 0);
  };

  const setZoom = (z: number): void => persistPreview({ zoom: clampZoom(z) });

  const toggleConsole = (): void => {
    const next = !consoleOpen;
    setConsoleOpen(next);
    persistPreview({ console: next });
  };

  const launchTarget = (tg: PreviewTarget): void => {
    closeMenus();
    if (tg.kind === 'dev') void startDevPreview(tg.runtime);
    // 'static' → dir with index.html · 'file' → single html · 'artifact' →
    // any single file (pdf/image/media/md/text/code) — the service serves its
    // generated viewer page for it
    else if (tg.dir) void startStaticPreview(tg.dir);
  };

  const stopStatic = async (): Promise<void> => {
    try {
      await api.previewStaticStop();
    } catch {
      /* backend unavailable */
    }
    void refreshPreviewStatus();
  };

  // v11.11 (A3) — AUTO-OPEN (the founder's #1 demand: anything the agent builds
  // shows itself). The engine's completion hook emitted preview_open +
  // previewHint; the store turned it into `previewAuto`. Here we: switch the
  // panel to the PREVIEW view, resolve the best target FRESH (the run just
  // wrote files), and launch it — dev runtime match → artifact file → static
  // entry → first target → static serve of the workspace as the last resort.
  // Fires once per request (seq guard); requests from other workspaces are
  // ignored; never auto-starts on its own without a request.
  const lastAutoSeq = useRef(0);
  useEffect(() => {
    if (!previewAuto || previewAuto.seq === lastAutoSeq.current) return;
    if (previewAuto.ws && wsPath && previewAuto.ws !== wsPath) return;
    lastAutoSeq.current = previewAuto.seq;
    setViewTab('preview');
    focusPreview();
    // v11.38 — a tool-driven preview_open already carries the REAL, verified
    // URL (the store adopted it into previewUrl). If it matches the live
    // server, do NOT launch a second server on top of it — just focus.
    const liveUrl = status?.static?.url || status?.dev?.url;
    if (previewUrl && liveUrl && previewUrl === liveUrl) return;
    let cancelled = false;
    void (async () => {
      let list: PreviewTarget[] = [];
      try {
        const res = await targetsApi.previewTargets?.(wsPath);
        list = (Array.isArray(res) ? res : []).map(parseTarget).filter((x): x is PreviewTarget => x !== null);
      } catch {
        /* detection failed — fall through to the static fallback */
      }
      if (cancelled) return;
      const runtimeWanted = previewAuto.runtime ?? 'npm';
      const pick:
        | PreviewTarget
        | undefined
        | null =
        (previewAuto.kind === 'dev'
          ? list.find((tg) => tg.kind === 'dev' && (tg.runtime ?? 'npm') === runtimeWanted)
          : undefined) ||
        (previewAuto.kind === 'artifact' && previewAuto.dir
          ? list.find((tg) => tg.dir === previewAuto.dir)
          : undefined) ||
        (previewAuto.kind === 'static'
          ? list.find((tg) => tg.kind === 'file') ?? list.find((tg) => tg.kind === 'static')
          : undefined) ||
        list[0];
      if (pick) launchTarget(pick);
      else void startStaticPreview(previewAuto.dir);
    })();
    return () => {
      cancelled = true;
    };
    // seq-guarded — the launch helpers are intentionally not listed (stable actions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAuto, wsPath, previewUrl, status, focusPreview]);

  // v11.26 — the built/preview-ready cue is quiet and temporary: each new
  // auto-open request shows it once, then it retires on its own. The X button
  // below is a real handler for "dismiss now".
  useEffect(() => {
    if (!previewAuto) return;
    const seq = previewAuto.seq;
    const id = window.setTimeout(() => setBuiltDismissedSeq(seq), 7000);
    return () => window.clearTimeout(id);
  }, [previewAuto]);

  // ---- derived ----
  const dev = status?.dev;
  const ports = status?.ports ?? [];
  const staticRunning = status?.static?.running === true;
  const devLines = dev?.lines?.slice(-14) ?? [];
  const busyState = dev?.state === 'starting' || (dev?.running && !dev.url);
  const frameWidth = DEVICES.find((d) => d.id === device)?.width ?? 0;
  const frameBoxWidth = frameWidth || 420; // 'full' + frame → phone-sized bezel

  // Agent-started servers: previewService.devStatus() carries up to 6
  // localhost URLs harvested from background processes (extra field on the
  // composed status object, surfaced here through a narrow local view).
  const agentUrls = (((status as unknown as { dev?: { agentUrls?: string[] } } | null)?.dev?.agentUrls) ?? [])
    .filter((u) => typeof u === 'string' && u && u !== dev?.url)
    .slice(0, 6);

  const sourceLabel = dev?.running
    ? t('preview.dev', 'Dev server')
    : staticRunning
      ? t('preview.static', 'Static')
      : t('preview.targets', 'Detected targets');

  // BUG FIX — a real, always-visible status. The panel used to show only the
  // source label, so a dead dev server or a never-started preview looked simply
  // "empty". One of: error · loading · ready · idle, driven by the SAME store
  // status that refreshPreviewStatus() polls (and by the webview load flags).
  const previewState: 'error' | 'loading' | 'ready' | 'idle' =
    dev?.state === 'error' || !!previewError || !!failed
      ? 'error'
      : dev?.state === 'starting' || busyState || loading
        ? 'loading'
        : !!previewUrl || staticRunning || dev?.running
          ? 'ready'
          : 'idle';
  const stateText = {
    error: t('preview.state.error', lang === 'ar' ? 'خطأ' : 'ERROR'),
    loading: t('preview.state.loading', lang === 'ar' ? 'جارٍ التحميل' : 'LOADING'),
    ready: t('preview.state.ready', lang === 'ar' ? 'جاهز' : 'READY'),
    idle: t('preview.state.idle', lang === 'ar' ? 'خامل' : 'IDLE'),
  }[previewState];
  // These keys have no dictionary entry yet — always pass an inline bilingual
  // fallback so the Arabic UI never falls back to bare English tokens.
  const statusLabel = t('preview.status', lang === 'ar' ? 'حالة المعاينة' : 'Preview status');
  const copyLabel = t(
    'preview.copyUrl',
    lang === 'ar' ? (copiedUrl ? 'تم النسخ' : 'نسخ الرابط') : copiedUrl ? 'Copied' : 'Copy URL',
  );

  // A dev server that failed on its own (event/status poll) has no previewError
  // record but DOES have a state + log lines. Show that in the same error card.
  const [devErrorDismissed, setDevErrorDismissed] = useState(false);
  // v11.23 — raw server output is machine text (English). Keep it behind a
  // localized disclosure so an Arabic user never sees it inline by default.
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  // v11.26 — the "built / preview ready" cue follows the auto-open request.
  // It is a transient hairline band (not a card); each seq is shown once until
  // dismissed (X) or timed out. SSR renders it whenever previewAuto is set.
  const [builtDismissedSeq, setBuiltDismissedSeq] = useState(0);
  useEffect(() => setDevErrorDismissed(false), [dev?.startedAt, dev?.state]);
  const shownError =
    previewError ??
    (!devErrorDismissed && dev?.state === 'error'
      // v11.26 — raw dev stdout is MACHINE text. Never inject it into the
      // localized prose (dir="auto") field — it lives only in the disclosure.
      ? { reason: 'startFailed' as const }
      : null);
  // v11.26 — one obvious cue after an auto-open: "built / preview ready".
  // Not a boxed card — a hairline band with whitespace (see preview.css).
  const showBuiltCue =
    !!previewAuto &&
    previewAuto.seq !== builtDismissedSeq &&
    !shownError &&
    previewState !== 'error' &&
    previewState !== 'loading';

  const zoomWrapStyle = zoom !== 100 ? ({ zoom: zoom / 100 } as React.CSSProperties) : undefined;

  const webview = (
    <webview
      ref={attachWv}
      src={previewUrl}
      partition="persist:preview"
      className="w-full h-full bg-white"
    />
  );

  return (
    <div ref={panelRef} tabIndex={-1} className="flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--bg)] outline-none">
      {/* ---- FINAL POLISH · editorial toolbar: mono eyebrow + serif title,
          the view switcher, then URL/status + aligned actions on one baseline ---- */}
      <div className="pv-toolbar pv2-bar" data-testid="pv-toolbar">
        <div className="pv-editorial">
          <span className="pv-eyebrow">
            <FlaskConical size={11} className="text-acc shrink-0 me-1" style={{ verticalAlign: '-1px' }} aria-hidden />
            {t('preview.eyebrow', lang === 'ar' ? 'معاينة حية' : 'LIVE PREVIEW')}
          </span>
          <span className="pv-title">{t('preview.title', 'Preview')}</span>
        </div>
        {/* v11.9 — view switcher: Preview | Agent browser */}
        <div className="stamp-seg is-plain shrink-0" role="tablist" aria-label={t('preview.viewTabs', lang === 'ar' ? 'العرض' : 'View')}>
          <button role="tab" aria-selected={viewTab === 'preview'} className={viewTab === 'preview' ? 'is-active' : ''} onClick={() => setViewTab('preview')}>
            {t('preview.title', 'Preview')}
          </button>
          <button
            role="tab"
            aria-selected={viewTab === 'browser'}
            className={viewTab === 'browser' ? 'is-active' : ''}
            title={t('preview.browserTabTip', lang === 'ar' ? 'العرض الحي لمتصفح الوكيل المخفي (أدوات browser_)' : 'Live view of the agent\u2019s hidden CDP browser (browser_* tools)')}
            onClick={() => setViewTab('browser')}
          >
            <GlobeIcon />
            <span className="ms-1">{t('preview.browserTab', lang === 'ar' ? 'متصفح الوكيل' : 'Agent browser')}</span>
          </button>
        </div>

        {viewTab === 'preview' && (
          <>
            {/* v11.42 — OVERLAP FIX: the source label used to be rendered TWICE
                (this static pill + the source-selector button below). It now
                lives only in the selector, which owns the real onClick. */}
            {/* live status — loading / ready / error / idle, real store state
                only (role=status for a11y). No fabricated "server ready" text.
                This is the SINGLE status chip/LED; the URL field no longer
                repeats the same LED (that was the "two ready chips" overlap). */}
            <span
              role="status"
              aria-label={statusLabel + ': ' + stateText}
              className="pv-status"
              title={statusLabel + ': ' + stateText}
            >
              <span className={`pv-led is-${previewState}`} aria-hidden />
              <span>{stateText}</span>
            </span>

            {/* source selector — auto-detected targets from kdx:preview:targets */}
            <div className="relative shrink-0">
          <button
            className="glass-pill cursor-pointer !h-[26px] max-w-[24ch]"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'source'}
            title={t('preview.targets', 'Detected targets')}
            onClick={() => setOpenMenu(openMenu === 'source' ? 'none' : 'source')}
          >
            <Radar size={11} className="text-acc shrink-0" />
            <span className="truncate min-w-0">{sourceLabel}</span>
            <ChevronDown size={11} className={`shrink-0 transition-transform ${openMenu === 'source' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'source' && (
            <Popover onClose={closeMenus}>
              <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-faint">
                {t('preview.targets', 'Detected targets')}
              </div>
              {targetsLoading && (
                <div className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-dim">
                  <div className="w-3 h-3 rounded-full border-2 border-line border-t-acc spin" />
                  <span>{t('preview.autoDetected', 'Detected: {script}').replace('{script}', '…')}</span>
                </div>
              )}
              {!targetsLoading && targets.length === 0 && (
                <div className="px-3 py-2 text-[11.5px] text-faint max-w-[40ch] leading-relaxed">
                  {t('preview.noTargets', 'No targets found — build the project, add an index.html, or open a URL.')}
                </div>
              )}
              {targets.map((tg, i) => (
                <MenuRow
                  key={`${tg.kind}-${tg.label}-${i}`}
                  icon={kindIcon(tg.kind, tg.runtime)}
                  label={tg.label}
                  hint={
                    tg.kind === 'dev'
                      ? tg.runtime === 'python'
                        ? t('preview.runtimePython', lang === 'ar' ? 'خادم بايثون' : 'Python server')
                        : tg.runtime === 'custom'
                          ? t('preview.runtimeCustom', lang === 'ar' ? 'أمر مخصص' : 'Custom command')
                          : tg.runtime === 'go'
                            ? t('preview.runtimeGo', lang === 'ar' ? 'تشغيل Go' : 'Go run')
                            : t('preview.dev', 'Dev server')
                      : undefined
                  }
                  onClick={() => launchTarget(tg)}
                />
              ))}
              <div className="h-px bg-[var(--line-soft)] my-1" />
              <MenuRow icon={<Radar size={11} />} label={t('preview.redetect', 'Re-detect')} onClick={() => void detect()} />
            </Popover>
          )}
        </div>

        {/* URL field — address + actions on ONE baseline. v11.42: the duplicate
            status LED was removed from here; the one authoritative status
            chip lives above, so a "ready" is announced exactly once. */}
        <div className="pv-urlfield pv2-url mx-1" data-testid="pv-url-field">
          <input
            ref={urlInputRef}
            data-testid="pv-url"
            dir="ltr"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitUrl();
            }}
            placeholder={t('preview.urlPlaceholder', 'http://127.0.0.1:5173')}
            spellCheck={false}
            className="pv-urlinput"
          />
          <button
            className="pv-urlact pv2-urlact"
            data-testid="pv-copy-url"
            onClick={() => void copyUrl()}
            title={copyLabel}
            aria-label={copyLabel}
          >
            {copiedUrl ? <Check size={13} className="text-ok" aria-hidden /> : <Link2 size={13} aria-hidden />}
          </button>
          {/* history dropdown */}
          <div className="relative shrink-0">
            <IconBtn
              title={t('preview.history', 'History')}
              aria-label={t('preview.history', 'History')}
              active={openMenu === 'history'}
              onClick={() => setOpenMenu(openMenu === 'history' ? 'none' : 'history')}
            >
              <History size={14} />
            </IconBtn>
            {openMenu === 'history' && (
              <Popover align="end" onClose={closeMenus}>
                <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-faint">
                  {t('preview.history', 'History')}
                </div>
                {history.length === 0 ? (
                  <div className="px-3 py-2 text-[11.5px] text-faint">—</div>
                ) : (
                  history.map((u) => (
                    <MenuRow
                      key={u}
                      icon={<History size={11} className="text-faint shrink-0" />}
                      label={u}
                      onClick={() => {
                        setFailed(null);
                        closeMenus();
                        navigatePreview(u);
                      }}
                    />
                  ))
                )}
              </Popover>
            )}
          </div>
          <IconBtn data-testid="pv-reload" title={t('preview.reload', 'Reload')} aria-label={t('preview.reload', 'Reload')} onClick={reload}>
            <RefreshCw size={14} />
          </IconBtn>
          <IconBtn data-testid="pv-open-external" title={t('preview.openExternal', 'Open in browser')} aria-label={t('preview.openExternal', 'Open in browser')} onClick={openExternal}>
            <ExternalLink size={14} />
          </IconBtn>
          <IconBtn title={t('preview.console', 'Console')} aria-label={t('preview.console', 'Console')} active={consoleOpen} onClick={toggleConsole}>
            <Terminal size={14} />
          </IconBtn>
          </div>
            </>
        )}

        {/* v11.9 — browser tab: the preview controls do not apply here */}
        {viewTab === 'browser' && <div className="flex-1" />}

        <IconBtn data-testid="pv-close" title={t('common.close', 'Close')} aria-label={t('common.close', 'Close')} onClick={() => setPreviewOpen(false)}>
          <X size={15} />
        </IconBtn>
      </div>

      {/* v11.26 — "built / preview ready" cue. A hairline band, NOT a boxed
          card: whitespace + a 1px rule + a localized dir="auto" sentence. */}
      {showBuiltCue && (
        <div className="pv2-built" role="status" data-testid="pv-built-cue">
          <Check size={12} className="text-ok shrink-0" aria-hidden />
          <span className="pv2-built-text" dir="auto">
            {t('preview.built', lang === 'ar' ? 'تم البناء — المعاينة جاهزة' : 'Built — preview ready')}
          </span>
          <button
            type="button"
            className="pv2-built-dismiss"
            data-testid="pv-built-dismiss"
            aria-label={t('common.close', 'Close')}
            title={t('common.close', 'Close')}
            onClick={() => setBuiltDismissedSeq(previewAuto?.seq ?? 0)}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}

      {/* v11.9 — preview content stays MOUNTED (display:contents keeps the
          children as flex items of this column; the webview survives tab
          switches without reloading) — hidden while the BrowserDock shows. */}
      <div style={{ display: viewTab === 'browser' ? 'none' : 'contents' }}>
      {/* ---- server controls (glass pill row) ---- */}
      <div className="h-10 shrink-0 flex items-center gap-1.5 px-3 border-b border-line overflow-x-auto scroll-x-thin min-w-0">
        {staticRunning ? (
          <button className="glass-pill cursor-pointer !h-[24px] shrink-0 text-bad" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--bad) 40%, transparent)' }} title={t('preview.stop', 'Stop')} onClick={() => void stopStatic()}>
            <Square size={11} className="shrink-0" />
            <span className="whitespace-nowrap">{t('preview.stop', 'Stop')}</span>
          </button>
        ) : (
          <button
            className="glass-pill cursor-pointer !h-[24px] shrink-0"
            title={t('preview.staticHint', 'Serve the workspace as a static site (index.html or dist/)')}
            onClick={() => void startStaticPreview()}
          >
            <GlobeIcon />
            <span className="whitespace-nowrap">{t('preview.serveStatic', 'Serve static')}</span>
          </button>
        )}
        {dev?.running ? (
          <button className="glass-pill cursor-pointer !h-[24px] shrink-0 text-warn" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent)' }} title={t('preview.stopDev', 'Stop the dev server')} onClick={() => void stopDevPreview()}>
            <Square size={11} className="shrink-0" />
            <span className="whitespace-nowrap">{t('preview.stopDev', 'Stop dev')}</span>
          </button>
        ) : (
          <button
            className="glass-pill cursor-pointer !h-[24px] shrink-0"
            title={t('preview.devHint', 'Run the project dev script and auto-detect its URL')}
            onClick={() => void startDevPreview()}
          >
            <Play size={11} className="shrink-0" />
            <span className="whitespace-nowrap">{t('preview.runDev', 'Run dev server')}</span>
          </button>
        )}

        {/* detected ports */}
        {ports.map((p) => (
          <button
            key={p}
            dir="ltr"
            className="glass-pill cursor-pointer !h-[24px] shrink-0"
            title={t('preview.openPort', 'Preview this local server')}
            onClick={() => {
              setFailed(null);
              navigatePreview(`http://127.0.0.1:${p}`);
            }}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${busyState ? 'bg-warn' : 'bg-ok'}`} />
            <span className="whitespace-nowrap">:{p}</span>
          </button>
        ))}

        {/* servers the AGENT started (run_background) — jump straight to them */}
        {agentUrls.map((u) => (
          <button
            key={u}
            dir="ltr"
            className="glass-pill cursor-pointer !h-[24px] shrink-0 max-w-[34ch]"
            title={t('preview.agentServer', 'Server started by the agent — open it')}
            onClick={() => {
              setFailed(null);
              navigatePreview(u);
            }}
          >
            <Terminal size={11} className="text-acc shrink-0" />
            <span className="truncate min-w-0 font-code">{t('preview.agent', 'Agent')}: {u.replace(/^https?:\/\//, '')}</span>
          </button>
        ))}

        <div className="flex-1" />

        {/* device presets — stamp-seg instrument (square, mono) */}
        <div className="stamp-seg is-plain shrink-0">
          {DEVICES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              title={t(`preview.device.${id}`, id)}
              aria-label={t(`preview.device.${id}`, id)}
              aria-pressed={device === id}
              onClick={() => setDevice(id)}
              className={`w-7 inline-flex items-center justify-center ${device === id ? 'is-active' : ''}`}
            >
              <Icon size={12} />
            </button>
          ))}
        </div>

        {/* device frame toggle */}
        <IconBtn
          title={t('preview.deviceFrame', 'Device frame')}
          aria-label={t('preview.deviceFrame', 'Device frame')}
          aria-pressed={deviceFrame}
          active={deviceFrame}
          onClick={() => persistPreview({ deviceFrame: !deviceFrame })}
        >
          <AppWindow size={14} />
        </IconBtn>

        {/* auto-refresh toggle — glass pill with pressed state */}
        <button
          className={`glass-pill cursor-pointer !h-[24px] shrink-0 ${autoRefresh ? 'text-acc' : ''}`}
          style={autoRefresh ? { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--acc) 45%, transparent)' } : undefined}
          title={t('preview.autoRefresh', 'Auto-refresh on save')}
          aria-pressed={autoRefresh}
          onClick={() => persistPreview({ autoRefresh: !autoRefresh })}
        >
          <Zap size={11} className="shrink-0" />
          <span className="whitespace-nowrap">{t('preview.autoRefresh', 'Auto-refresh on save')}</span>
        </button>

        {/* zoom control (50–150%, persisted) — glass pill, tnum readout */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--bg1)] border border-line shrink-0" title={t('preview.zoom', 'Zoom')}>
          <button
            aria-label={`−${ZOOM_STEP}%`}
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoom(zoom - ZOOM_STEP)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-dim hover:text-ink disabled:opacity-40 disabled:hover:text-dim transition-colors"
          >
            <Minus size={12} />
          </button>
          <button
            dir="ltr"
            title={`${ZOOM_MIN}–${ZOOM_MAX}%`}
            onClick={() => setZoom(100)}
            className="tnum text-[10.5px] w-9 text-center text-ink hover:text-acc transition-colors"
          >
            {zoom}%
          </button>
          <button
            aria-label={`+${ZOOM_STEP}%`}
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom(zoom + ZOOM_STEP)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-dim hover:text-ink disabled:opacity-40 disabled:hover:text-dim transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* status text */}
        {dev?.running && (
          <button className="glass-pill cursor-pointer !h-[24px] shrink-0 max-w-[40ch]" title={t('preview.devLog', 'Dev server output')} onClick={() => setLogOpen(!logOpen)}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dev.url ? 'bg-ok' : 'bg-warn'}`} />
            <span className="truncate min-w-0" dir="ltr">
              {dev.url ?? `${t('preview.starting', 'starting')} — npm run ${dev.script ?? 'dev'}`}
            </span>
          </button>
        )}
      </div>

      {/* ---- dev-server log drawer ---- */}
      {logOpen && devLines.length > 0 && (
        <div className="shrink-0 max-h-40 overflow-y-auto border-b border-line bg-panel px-3 py-2 font-code text-[11px] leading-relaxed text-dim" dir="ltr">
          {devLines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {l}
            </div>
          ))}
        </div>
      )}

      {/* v11.42 — loading is its OWN flex row (see .pv2-loading in preview.css),
          not an absolute ribbon painted over the canvas/toolbar. It keeps the
          calm 1px hairline + localized prose and sits between the server row
          and the canvas, inside the display:contents wrapper so it hides with
          the preview when the Agent-browser tab is selected. */}
      {previewUrl && loading && (
        <div className="pv2-loading" role="status" data-testid="pv-loading">
          <span className="pv2-loading-track" aria-hidden><i /></span>
          <span dir="auto">{t('preview.loading', lang === 'ar' ? 'جارٍ تحميل المعاينة…' : 'Loading preview…')}</span>
        </div>
      )}

      {/* ---- canvas ---- */}
      <div className="flex-1 min-h-0 relative bg-panel2/40 flex items-stretch justify-center overflow-hidden">
        {previewUrl ? (
          deviceFrame ? (
            <DeviceFrame width={frameBoxWidth}>
              <div className="w-full h-full bg-white" style={zoomWrapStyle}>
                {webview}
              </div>
            </DeviceFrame>
          ) : (
            <div
              className="flex-1 min-h-0 flex justify-center overflow-hidden"
              style={frameWidth ? { maxWidth: frameWidth, borderInline: '1px solid var(--line)' } : undefined}
            >
              <div className="relative w-full h-full bg-white" style={zoomWrapStyle}>
                {webview}
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-10 anim-in">
            {/* FINAL POLISH — precise original SVG ornament: framed viewport,
                corner fold + hairline dimension marks (currentColor only). */}
            <PreviewOrnament />
            <div className="max-w-[60ch]">
              <div className="pv-empty-title" dir="auto">{t('preview.empty.title', 'Nothing to preview yet')}</div>
              <div className="pv-empty-hint mt-1.5" dir="auto">
                {t('preview.empty.hint', 'Build an app with the agent, or serve any folder / open any URL.')}
              </div>
            </div>

            {/* v11.10 — HONEST error card: WHY the last start attempt failed,
                with the concrete next step (EN+AR). No more silent blanks. */}
            {shownError && (
              <div
                role="alert"
                data-testid="pv-error-card"
                className="w-full max-w-md aurora-panel pv2-error px-3 py-2.5 text-start anim-in"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Radar size={12} className="text-warn shrink-0" aria-hidden />
                  <span className="text-[11.5px] font-semibold text-ink" dir="auto">
                    {t('preview.err.title', 'Preview could not start')}
                  </span>
                </div>
                {/* v11.26 — localized prose, never LTR monospace. The machine
                    log is NOT here; it lives behind the disclosure below. */}
                <div className="text-[11.5px] text-dim leading-relaxed" dir="auto" data-testid="pv-error-reason">
                  {shownError.reason === 'noWorkspace'
                    ? t('preview.err.noWorkspace', 'Open a workspace folder first — the preview serves YOUR project.')
                    : shownError.reason === 'noPackage'
                      ? t('preview.err.noPackage', 'No package.json here — this is not a Node project. Use “Serve folder” for plain HTML, or add a dev script.')
                      : shownError.reason === 'noDevScript'
                        ? t('preview.err.noDevScript', 'package.json has no dev/start/serve script — add one, or use “Serve folder” for static output.')
                        : shownError.reason === 'noPython'
                          ? t('preview.err.noPython', 'No Python entry found (manage.py / app.py / main.py / server.py) — use “Serve folder” for plain HTML.')
                          : shownError.reason === 'noCustom'
                            ? t('preview.err.noCustom', 'No custom preview command set — add one in Settings → Live Preview.')
                            : t('preview.err.startFailed', 'The dev server failed to start — check its output above/why, fix the error, and try again.')}
                </div>
                {shownError.detail && (
                  // v11.23/26 — a LOCALIZED sentence (maybe with a machine
                  // token like "(402)"), not a code dump: never render Arabic
                  // prose inside an LTR monospace block.
                  <div className="pv2-error-detail text-[10.5px] text-faint mt-1.5 break-words" dir="auto" data-testid="pv-error-detail">
                    {shownError.detail}
                  </div>
                )}
                {/* REAL last log lines from the failed server — never a
                    fabricated "server ready" sentence. Machine text stays
                    behind a localized disclosure (founder: one language only). */}
                {devLines.length > 0 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="pv2-disclosure"
                      data-testid="pv-error-log-toggle"
                      aria-expanded={errorLogOpen}
                      onClick={() => setErrorLogOpen((v) => !v)}
                    >
                      {errorLogOpen
                        ? t('preview.hideDevLog', lang === 'ar' ? 'إخفاء سجل الخادم' : 'Hide server log')
                        : t('preview.devLog', 'Dev server output')}
                    </button>
                    {errorLogOpen && (
                      <div className="pv-error-log pv2-error-log mt-1" dir="ltr" title={t('preview.devLog', 'Dev server output')} data-testid="pv-error-log">
                        {devLines.slice(-4).map((line, i) => (
                          <div key={i} className="whitespace-pre-wrap break-words">{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="ibtn pv2-error-dismiss !w-6 !h-6 !-my-1 shrink-0 float-end"
                  data-testid="pv-error-dismiss"
                  onClick={() => {
                    dismissPreviewError();
                    setDevErrorDismissed(true);
                  }}
                  aria-label={t('common.close', 'Close')}
                  title={t('common.close', 'Close')}
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* auto-detected targets */}
            {(targetsLoading || targets.length > 0) && (
              <div className="w-full max-w-md flex flex-col items-center gap-2">
                <div className="text-[10.5px] font-semibold uppercase tracking-widest text-faint">
                  {targetsLoading
                    ? t('preview.autoDetected', 'Detected: {script}').replace('{script}', '…')
                    : t('preview.autoDetected', 'Detected: {script}').replace('{script}', String(targets.length))}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {targets.map((tg, i) => (
                    <button
                      key={`${tg.kind}-${tg.label}-${i}`}
                      className="glass-pill cursor-pointer !h-[26px]"
                      title={
                        tg.kind === 'dev'
                          ? t('preview.start', 'Start')
                          : tg.kind === 'artifact'
                            ? t('preview.openFile', 'Open file')
                            : t('preview.dir', 'Serve folder')
                      }
                      onClick={() => launchTarget(tg)}
                    >
                      {kindIcon(tg.kind)}
                      <span className="font-code" dir="ltr">
                        {tg.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap justify-center">
              <Btn variant="primary" onClick={() => void startDevPreview()}>
                <Play size={13} />
                <span>{t('preview.runDev', 'Run dev server')}</span>
              </Btn>
              <Btn variant="ghost" onClick={() => void startStaticPreview()}>
                <GlobeIcon />
                <span>{t('preview.dir', 'Serve folder')}</span>
              </Btn>
              <Btn variant="ghost" onClick={focusUrlInput}>
                <Link2 size={13} />
                <span>{t('preview.openUrl', 'Open a URL')}</span>
              </Btn>
            </div>
          </div>
        )}

        {/* v11.42 — the failed card is the ONLY full-canvas layer: an
            intentional z-layer above a DEAD guest page. The loading cue was
            moved into normal flow above; nothing here covers the URL bar. */}
        {previewUrl && failed && (
          <div className="pv2-failed absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center px-8" data-testid="pv-failed">
            <div className="text-[13px] font-semibold text-ink" dir="auto">{t('preview.failed', 'This page could not be loaded')}</div>
            {/* v11.26 — localized prose with dir="auto", never LTR monospace.
                The raw webview errorDescription is machine text: disclosure. */}
            <div className="text-[12px] text-dim max-w-[52ch] leading-relaxed" dir="auto">
              {t('preview.failed.hint', lang === 'ar' ? 'تعذّر الوصول إلى الصفحة. تحقّق من الأسباب أدناه ثم أعد المحاولة.' : 'The page did not respond. Check the causes below, then try again.')}
            </div>
            <div className="max-w-[52ch] text-start">
              <button
                type="button"
                className="pv2-disclosure"
                data-testid="pv-failed-log-toggle"
                aria-expanded={failedLogOpen}
                onClick={() => setFailedLogOpen((v) => !v)}
              >
                {failedLogOpen
                  ? t('preview.hideErrorDetails', lang === 'ar' ? 'إخفاء تفاصيل الخطأ' : 'Hide error details')
                  : t('preview.showErrorDetails', lang === 'ar' ? 'تفاصيل الخطأ' : 'Error details')}
              </button>
              {failedLogOpen && (
                <div className="pv-error-log pv2-error-log mt-1" dir="ltr" data-testid="pv-failed-log">{failed}</div>
              )}
            </div>
            {/* diagnose: the common causes, same list as the blank-page hint */}
            <ul className="text-[11.5px] text-dim text-start max-w-[52ch] leading-relaxed list-disc ps-5">
              <li>{t('preview.diag.build', 'Project not built yet — run its build, then serve the output folder.')}</li>
              <li>{t('preview.diag.starting', 'Dev server still starting — wait a few seconds and reload.')}</li>
              <li>{t('preview.diag.server', 'Page requires a server (API routes, SSR) — use the dev preview instead of static.')}</li>
            </ul>
            <div className="flex items-center gap-2">
              <Btn variant="primary" data-testid="pv-failed-reload" onClick={reload}>
                {t('preview.reload', 'Reload')}
              </Btn>
              <Btn variant="ghost" data-testid="pv-failed-back" onClick={() => { setFailed(null); setFailedLogOpen(false); }}>
                {t('preview.back', 'Back')}
              </Btn>
            </div>
          </div>
        )}

        {/* blank-page diagnose hint — only when the page truly painted nothing */}
        {previewUrl && blankHint && !failed && !loading && (
          <div className="absolute inset-x-0 top-3 z-10 flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-start gap-2 max-w-[60ch] aurora-panel px-3 py-2 anim-in">
              <Radar size={13} className="text-warn shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[11.5px] font-semibold text-ink">{t('preview.blank.title', 'Page loaded but painted nothing')}</div>
                <ul className="text-[11px] text-dim leading-relaxed mt-1 list-disc ps-4">
                  <li>{t('preview.diag.build', 'Project not built yet — run its build, then serve the output folder.')}</li>
                  <li>{t('preview.diag.starting', 'Dev server still starting — wait a few seconds and reload.')}</li>
                  <li>{t('preview.diag.server', 'Page requires a server (API routes, SSR) — use the dev preview instead of static.')}</li>
                </ul>
              </div>
              <IconBtn
                title={t('common.close', 'Close')}
                aria-label={t('common.close', 'Close')}
                onClick={() => setBlankHint(false)}
              >
                <X size={12} />
              </IconBtn>
            </div>
          </div>
        )}
      </div>

      {/* ---- guest-page console drawer ---- */}
      {consoleOpen && (
        <div className="shrink-0 border-t border-line bg-[var(--panel)] flex flex-col h-52">
          <div className="h-8 shrink-0 flex items-center gap-2 px-3">
            <Terminal size={12} className="text-acc shrink-0" />
            <span className="text-[11px] font-semibold text-ink">{t('preview.console', 'Console')}</span>
            <span className="chip !h-[18px] !px-1.5 !text-[10px]" dir="ltr">
              {consoleLines.length}
            </span>
            <div className="flex-1" />
            <IconBtn title={t('preview.clear', 'Clear')} aria-label={t('preview.clear', 'Clear')} onClick={() => setConsoleLines([])}>
              <Trash2 size={13} />
            </IconBtn>
            <IconBtn title={t('common.close', 'Close')} aria-label={t('common.close', 'Close')} onClick={() => setConsoleOpen(false)}>
              <X size={13} />
            </IconBtn>
          </div>
          <div ref={consoleBodyRef} className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 font-code text-[11px] leading-relaxed" dir="ltr">
            {consoleLines.length === 0 ? (
              <div className="text-faint py-1">{t('preview.console.empty', 'Console output appears here')}</div>
            ) : (
              consoleLines.map((l) => (
                <div key={l.id} className="flex gap-2 items-baseline whitespace-pre-wrap break-all">
                  <span className="text-faint shrink-0 tnum">{fmtTime(l.ts)}</span>
                  <span className={LEVEL_CLASS[l.level]}>{l.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      </div>

      {/* v11.9 — the agent's live browser (W2): read-only dock + Close */}
      {viewTab === 'browser' && <BrowserDock />}
    </div>
  );
}

export default PreviewArea;
