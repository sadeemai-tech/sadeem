// ============================================================
// BrowserDock — v11.9: the agent's HIDDEN browser becomes visible.
// The agent drives a real Chrome DevTools Protocol browser
// (electron/services/browserService.ts) through its browser_* tools;
// until now the user could not see any of it. This dock shows:
//   • live state — current URL + page title (kdx:browser:state)
//   • the cached live screenshot (pushed via kdx:browser:event)
//   • a status dot (running / idle) for the CURRENT session
//   • Close browser (kdx:browser:close) + Refresh + open externally
// READ-ONLY BY DESIGN: browserService exposes no UI-navigate path
// (navigation happens through the agent's browser_navigate tool, which
// also wires the taint wall), so this dock never fakes one — it shows
// honest state and a hint that the agent drives the browser.
// Every string here is EN/AR paired inline (Composer/PreviewArea pattern).
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ExternalLink, Globe, Plus, RefreshCw, Square, X } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { IconBtn } from './ui';

/** Mirrors browserService.BrowserState (kdx:browser:state). */
interface BrowserStateInfo {
  open: boolean;
  url: string;
  title: string;
  lastShot?: string;
}

/** Mirrors browserService.BrowserUiEvent (kdx:browser:event push). */
interface BrowserEvt {
  kind: 'navigated' | 'shot' | 'closed';
  sessionId: string;
  url?: string;
  title?: string;
}

/** Safety-net poll; kdx:browser:event pushes are the primary channel. */
const POLL_MS = 5000;

export function BrowserDock() {
  const t = useT();
  // The agent's browser is one per agent session — the same id the engine
  // passes to its browser_* tools (ipc falls back to 'default').
  const sessionId = useStore((s) => s.session?.id ?? 'default');
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const [state, setState] = useState<BrowserStateInfo | null>(null);
  const [closing, setClosing] = useState(false);
  const aliveRef = useRef(true);
  // v12 — tab strip + network log (all guarded for legacy bridges).
  const [tabs, setTabs] = useState<Array<{ id: string; url: string; title: string; active: boolean }>>([]);
  const [netOpen, setNetOpen] = useState(false);
  const [net, setNet] = useState<{ url: string; entries: Array<{ method: string; status: string; type?: string; ms?: number; kb?: number; url: string; errorText?: string }> } | null>(null);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  const fetchTabs = useCallback(async () => {
    if (typeof api.browserTabs !== 'function') return;
    try {
      const list = await api.browserTabs(sessionId);
      if (aliveRef.current) setTabs(Array.isArray(list) ? list : []);
    } catch { /* legacy bridge — keep empty */ }
  }, [sessionId]);

  const fetchNetwork = useCallback(async () => {
    if (typeof api.browserNetwork !== 'function') return;
    try {
      const info = await api.browserNetwork(sessionId);
      if (aliveRef.current) setNet(info ?? { url: '', entries: [] });
    } catch { /* legacy bridge — keep empty */ }
  }, [sessionId]);

  const fetchState = useCallback(async () => {
    if (typeof api.browserState !== 'function') return; // legacy bridge — honest empty state
    try {
      const st = await api.browserState(sessionId);
      if (aliveRef.current) setState(st ?? { open: false, url: '', title: '' });
    } catch {
      if (aliveRef.current) setState({ open: false, url: '', title: '' });
    }
  }, [sessionId]);

  const refreshAll = useCallback(() => {
    void fetchState();
    void fetchTabs();
    if (netOpen) void fetchNetwork();
  }, [fetchState, fetchTabs, fetchNetwork, netOpen]);

  const tabAction = useCallback(async (action: 'select' | 'close' | 'new', tabId?: string) => {
    if (typeof api.browserTabAction !== 'function') return;
    try {
      await api.browserTabAction(sessionId, action, tabId);
      refreshAll();
    } catch { /* best-effort */ }
  }, [sessionId, refreshAll]);

  // initial fetch + refetch when the watched session changes
  useEffect(() => {
    setState(null);
    refreshAll();
  }, [refreshAll]);

  // push events: navigated / shot / closed for THIS session → refetch
  // (browserState carries url/title and the cached last screenshot)
  useEffect(() => {
    if (typeof api.onBrowserEvent !== 'function') return;
    const off = api.onBrowserEvent((e: BrowserEvt) => {
      if (!e || typeof e.sessionId !== 'string' || e.sessionId === sessionId) refreshAll();
    });
    return off;
  }, [refreshAll, sessionId]);

  // light poll as a safety net (covers a missed push / external close)
  useEffect(() => {
    const iv = window.setInterval(() => refreshAll(), POLL_MS);
    return () => window.clearInterval(iv);
  }, [refreshAll]);

  const open = state?.open === true;
  const url = typeof state?.url === 'string' ? state.url : '';
  const title = typeof state?.title === 'string' ? state.title : '';
  const shot = typeof state?.lastShot === 'string' && state.lastShot ? state.lastShot : '';

  /** REAL channel: kdx:browser:close — reclaims the agent's browser window. */
  const closeBrowser = async (): Promise<void> => {
    setClosing(true);
    try {
      await api.browserClose(sessionId);
    } catch {
      /* already gone / legacy bridge */
    }
    setClosing(false);
    void fetchState();
  };

  const ar = lang === 'ar';

  return (
    <div className="flex-1 min-h-0 flex flex-col min-w-0 anim-in">
      {/* ---- status strip ---- */}
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-line min-w-0">
        {/* status dot — running (ok) vs idle (faint) */}
        <span className={`w-2 h-2 rounded-full shrink-0 ${open ? 'bg-ok' : 'bg-faint'}`} aria-hidden />
        <span className="text-[11px] font-semibold shrink-0 text-[var(--ink)]" dir="auto">
          {t('bdock.title', ar ? 'متصفح الوكيل' : 'Agent browser')}
        </span>
        <span
          className={`stamp !h-[16px] !text-[9px] shrink-0 ${open ? 'stamp-acc' : ''}`}
          title={open ? t('bdock.running', ar ? 'المتصفح يعمل لهذه الجلسة' : 'The browser is running for this session') : t('bdock.idle', ar ? 'لا يوجد متصفح يعمل' : 'No browser is running')}
          dir="auto"
        >
          {open ? t('bdock.state.running', ar ? 'يعمل' : 'Running') : t('bdock.state.idle', ar ? 'متوقف' : 'Idle')}
        </span>
        <span className="chip font-code tnum !h-[16px] !px-1.5 !text-[9px] shrink-0 max-w-[20ch]" title={sessionId} dir="ltr">
          {sessionId}
        </span>

        <div className="flex-1" />

        <IconBtn
          title={t('bdock.refresh', ar ? 'تحديث الحالة' : 'Refresh state')}
          aria-label={t('bdock.refresh', ar ? 'تحديث الحالة' : 'Refresh state')}
          onClick={() => void fetchState()}
        >
          <RefreshCw size={13} />
        </IconBtn>
        {typeof api.browserNetwork === 'function' && (
          <IconBtn
            title={t('bdock.network', ar ? 'سجل الشبكة' : 'Network log')}
            aria-label={t('bdock.network', ar ? 'سجل الشبكة' : 'Network log')}
            className={netOpen ? 'text-acc' : ''}
            onClick={() => {
              const next = !netOpen;
              setNetOpen(next);
              if (next) void fetchNetwork();
            }}
          >
            <Activity size={13} />
          </IconBtn>
        )}
        {open && url && /^https?:\/\//i.test(url) && (
          <IconBtn
            title={t('bdock.openExternal', ar ? 'افتح العنوان الحالي في متصفحك' : 'Open the current URL in your browser')}
            aria-label={t('bdock.openExternal', ar ? 'افتح العنوان الحالي في متصفحك' : 'Open the current URL in your browser')}
            onClick={() => void api.openExternal(url)}
          >
            <ExternalLink size={13} />
          </IconBtn>
        )}
        {/* Close browser — the one write action: a real kdx:browser:close */}
        {open && (
          <button
            className="glass-pill cursor-pointer !h-[24px] shrink-0 text-bad"
            style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--bad) 40%, transparent)' }}
            title={t('bdock.close', ar ? 'إغلاق متصفح الوكيل وتحرير موارده' : 'Close the agent browser and free its resources')}
            onClick={() => void closeBrowser()}
            disabled={closing}
            aria-busy={closing}
          >
            <Square size={11} className="shrink-0" />
            <span className="whitespace-nowrap">{t('bdock.close', ar ? 'إغلاق المتصفح' : 'Close browser')}</span>
          </button>
        )}
      </div>

      {/* ---- URL / title row ---- */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-line bg-[color-mix(in_srgb,var(--panel)_65%,transparent)] min-w-0">
        <Globe size={12} className={`shrink-0 ${open ? 'text-acc' : 'text-faint'}`} aria-hidden />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="font-code tnum text-[11px] text-ink truncate min-w-0" dir="ltr" title={url || undefined}>
            {url || '—'}
          </span>
          {open && title && (
            <span className="text-[10.5px] text-dim truncate min-w-0" dir="auto" title={title}>
              {title}
            </span>
          )}
        </div>
      </div>

      {/* ---- v12 tab strip (select / close / new) ---- */}
      {tabs.length > 0 && (
        <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-line overflow-x-auto min-w-0">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.active}
              tabIndex={0}
              className={`flex items-center gap-1 h-[22px] px-2 rounded-[6px] border shrink-0 cursor-pointer ${tab.active ? 'border-acc text-acc' : 'border-line text-dim hover:text-ink'}`}
              title={`${tab.url}\n${tab.title}`}
              onClick={() => void tabAction('select', tab.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return; // inner close button owns its keys
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void tabAction('select', tab.id);
                }
              }}
            >
              <Globe size={10} className="shrink-0" />
              <span className="text-[10.5px] max-w-[14ch] truncate">{tab.title || tab.id}</span>
              <button
                className="shrink-0 opacity-60 hover:opacity-100"
                title={t('bdock.tab.close', ar ? 'إغلاق التبويب' : 'Close tab')}
                onClick={(e) => { e.stopPropagation(); void tabAction('close', tab.id); }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {typeof api.browserTabAction === 'function' && (
            <IconBtn title={t('bdock.tab.new', ar ? 'تبويب جديد' : 'New tab')} onClick={() => void tabAction('new')}>
              <Plus size={11} />
            </IconBtn>
          )}
        </div>
      )}

      {/* ---- v12 network log (active tab, CDP Network domain) ---- */}
      {netOpen && (
        <div className="shrink-0 max-h-[30%] overflow-auto px-3 py-1.5 border-b border-line bg-[color-mix(in_srgb,var(--panel)_65%,transparent)] font-code tnum text-[10px]">
          <div className="text-faint mb-1" dir="ltr">{net?.url || '—'}</div>
          {!net || net.entries.length === 0 ? (
            <div className="text-faint">{t('bdock.net.empty', ar ? 'لا طلبات مسجلة بعد' : 'No requests logged yet')}</div>
          ) : net.entries.map((e, i) => (
            <div key={i} className="flex gap-1.5 truncate" dir="ltr" title={e.errorText ? `${e.url}\n${e.errorText}` : e.url}>
              <span className="text-acc shrink-0">{e.method}</span>
              <span className={String(e.status).startsWith('2') ? 'text-ok' : 'text-dim'} shrink-0>{e.status}</span>
              {e.ms !== undefined && <span className="text-faint shrink-0">{e.ms}ms</span>}
              <span className="text-faint truncate">{e.url}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- live screenshot area ---- */}
      <div className="flex-1 min-h-0 relative bg-panel2/40 flex items-stretch justify-center overflow-hidden">
        {shot ? (
          <img
            src={shot}
            alt={t('bdock.shotAlt', ar ? 'لقطة شاشة حية لصفحة الوكيل' : 'Live screenshot of the agent page')}
            className="max-w-full max-h-full object-contain select-text"
            draggable={false}
          />
        ) : open ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-10 anim-in">
            <div className="w-12 h-12 aurora-panel-lg !p-0 flex items-center justify-center shrink-0" style={{ width: 48, height: 48 }}>
              <Globe size={22} className="text-acc" />
            </div>
            <div className="max-w-[60ch]">
              <div className="text-[13px] font-semibold text-ink">{t('bdock.noShot.title', ar ? 'المتصفح يعمل — لا لقطة بعد' : 'Browser is running — no screenshot yet')}</div>
              <div className="text-[11.5px] text-dim leading-relaxed mt-1.5">
                {t('bdock.noShot.hint', ar
                  ? 'لا يلتقط هذا الإطار تلقائياً؛ عندما يجري الوكيل أداة browser_screenshot تظهر اللقطة هنا فورًا.'
                  : 'This view does not capture frames on its own; the moment the agent runs browser_screenshot the shot appears here.')}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-10 anim-in">
            <div className="w-12 h-12 aurora-panel-lg !p-0 flex items-center justify-center shrink-0" style={{ width: 48, height: 48 }}>
              <Globe size={22} className="text-faint" />
            </div>
            <div className="max-w-[60ch]">
              <div className="text-[13px] font-semibold text-ink">{t('bdock.idle.title', ar ? 'متصفح الوكيل متوقف' : 'The agent browser is not running')}</div>
              <div className="text-[11.5px] text-dim leading-relaxed mt-1.5">
                {t('bdock.idle.hint', ar
                  ? 'اطلب من الوكيل تصفح صفحة (متصفح مخفي مدفوع بـ CDP) وسيظهر كل ما يراه هنا حيًا.'
                  : 'Ask the agent to open a page (a hidden CDP-driven browser) and everything it sees appears here live.')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- honest read-only hint ---- */}
      <div className="shrink-0 px-3 py-2 border-t border-line text-[10.5px] text-faint leading-relaxed" dir="auto">
        {t('bdock.readOnly', ar
          ? 'عرض للقراءة فقط — الوكيل يقود هذا المتصفح بأدوات browser_* (تنقّل، لقطة، نقر، كتابة، قراءة). أدرجه في مهمتك مثل: «افتح {url} واقرأ العنوان».'
          : 'Read-only view — the agent drives this browser with its browser_* tools (navigate, screenshot, click, type, read). Include it in a task, e.g. “open {url} and read the title”.').replace('{url}', url || 'example.com')}
      </div>
    </div>
  );
}

export default BrowserDock;
