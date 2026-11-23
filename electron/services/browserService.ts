// ============================================================
// Surnia v7.2 — REAL BROWSER CONTROL for the agent.
// The one capability every competitor has that Surnia lacked (the
// owner's audit: "القدرة على الذكاء الاصطناعي بالتحكم بالبراوزر").
//
// Mechanism: a hidden Electron BrowserWindow + webContents.debugger
// (the Chrome DevTools Protocol, v1.3) — ZERO new dependencies. The
// agent gets first-class tools: navigate, snapshot (numbered
// interactive elements), click by ref, type into fields, read page
// text, screenshot (vision), evaluate JS (approval-gated), close.
//
// Safety model (honest walls, not vibes):
//   • Page content is UNTRUSTED — every page that loads marks the
//     run's taint ledger ('web'), so afterwards the existing taint
//     wall escalates dangerous commands to explicit approval even
//     in fullAccess. Reading a malicious page cannot silently lead
//     to `curl|sh`.
//   • http/https only by default (file:// and custom schemes need
//     fullAccess + explicit approval).
//   • browser_eval ALWAYS asks (it is arbitrary code in a page).
//   • Output caps everywhere; timeouts on every CDP command.
//   • One browser per agent session; close() reclaims the window.
//   • CLI/headless: unavailable — honest tool error, never a fake.
// ============================================================
import { BrowserWindow } from 'electron';

// ---------- v8 renderer visibility: the user must SEE the agent browse ----------
// Every navigate/screenshot/close pushes a live event to the UI (Browser
// panel), and the last screenshot is cached so the panel can render it
// without re-shooting the page. Silent capability = nonexistent capability.
export interface BrowserUiEvent {
  kind: 'navigated' | 'shot' | 'closed';
  sessionId: string;
  url?: string;
  title?: string;
}
let emitBrowserUi: ((e: BrowserUiEvent) => void) | null = null;
export function setBrowserEventEmitter(cb: ((e: BrowserUiEvent) => void) | null): void {
  emitBrowserUi = cb;
}
function emitUi(e: BrowserUiEvent): void {
  try {
    emitBrowserUi?.(e);
  } catch { /* window closing — visibility is best-effort */ }
}
const lastShots = new Map<string, string>(); // cache key → dataUrl (one per tab)

/** Cache the last shot under the active tab's key so tabs cannot overwrite each other. */
function shotCacheKey(sessionId: string): string {
  const active = activeTabId(sessionId);
  return active ? tabKey(sessionId, active) : sessionId;
}

export interface BrowserState {
  open: boolean;
  url: string;
  title: string;
  lastShot?: string;
}

// Test-tunable (default unchanged) so a hung-page timeout can be exercised in
// milliseconds instead of holding the suite for 25 seconds.
const NAV_TIMEOUT_MS = Math.max(100, Number(process.env.SURNIA_BROWSER_NAV_TIMEOUT_MS) || 25_000);
const EVAL_TIMEOUT_MS = 8_000;
const SHOT_TIMEOUT_MS = 10_000;
const READ_CAP = 14_000;
const SNAPSHOT_CAP = 120;
const MAX_WINDOWS = 4; // hard ceiling across all sessions

/**
 * v11.32 (WEB-TRUTH) — a real browser UA for the hidden CDP browser. Without
 * it, sites protected by Cloudflare/Fastly answer 403 and "open this page in
 * the agent browser" silently fails. Kept in sync with tools.ts WEB_HTTP_UA.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Turn a CDP navigation error (net::ERR_*) into an honest, actionable reason.
 * Page.navigate returns these on the CDP result for main-frame failures; the
 * old code ignored the field and reported a fabricated clean navigation.
 */
function explainNavError(errorText: string, url: string): string {
  const e = (errorText || '').toUpperCase();
  let what: string;
  let fix: string;
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_DNS/.test(e)) {
    what = 'DNS resolution failed — the hostname does not exist or DNS is down';
    fix = 'Check the URL spelling and your connection, or use web_fetch with a known URL.';
  } else if (/ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/.test(e)) {
    what = 'the connection timed out — the server did not respond in time';
    fix = 'Check the site is up and retry, or use web_fetch with a known URL.';
  } else if (/ERR_CERT|ERR_SSL|ERR_BAD_SSL/.test(e)) {
    what = 'TLS certificate verification failed — the site presents an invalid or self-signed certificate';
    fix = 'Use the official https URL; do not disable TLS verification.';
  } else if (/ERR_CONNECTION_REFUSED/.test(e)) {
    what = 'connection refused — no service is listening on that host/port';
    fix = 'Check the scheme/port and that the server is running, then retry.';
  } else if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK/.test(e)) {
    what = 'the network is unreachable from this machine';
    fix = 'Check connectivity/VPN, then retry.';
  } else if (/ERR_BLOCKED_BY|ERR_UNSAFE|ERR_ACCESS_DENIED/.test(e)) {
    what = 'the navigation was blocked by a security policy';
    fix = 'Use a public http(s) URL, or read it with web_fetch instead.';
  } else {
    what = `the browser could not load the page (${errorText || 'unknown browser error'})`;
    fix = 'Verify the URL, then retry or use web_fetch with a known URL.';
  }
  return `Navigation to ${url} failed: ${what}. Fix: ${fix}`;
}

export interface BrowserPageSummary {
  url: string;
  title: string;
  /** Honest signal: the load event never fired within NAV_TIMEOUT_MS. */
  loadTimedOut?: boolean;
}

interface InteractiveRef {
  i: number;
  tag: string;
  kind: string;
  text: string;
  value: string;
  href: string | null;
}

class BrowserSession {
  readonly win: BrowserWindow;
  readonly id: string;
  /** LRU timestamp — the MAX_WINDOWS reaper must evict the idlest tab, not the oldest-created one. */
  lastUsed = Date.now();
  currentUrl = 'about:blank';
  currentTitle = '';
  // v11.10 — console capture ring buffer (browser_console / browser_console_eval).
  // Lines are appended from CDP Runtime.consoleAPICalled + Log.entryAdded.
  readonly consoleLog: string[] = [];
  private consoleDomainsEnabled = false;
  // v12 — CDP Network-domain request log (browser_network tool).
  readonly networkLog: Array<{
    requestId: string; method: string; url: string; type?: string;
    status?: number; statusText?: string; mimeType?: string;
    errorText?: string; startTime: number; endTime?: number; encodedDataLength?: number;
  }> = [];
  private networkDomainsEnabled = false;
  private cmdSeq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private loadWaiters: Array<() => void> = [];

  constructor(id: string) {
    this.id = id;
    this.win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        // The browser page is maximally untrusted: full sandbox, no node.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
      },
    });
    this.win.setMenuBarVisibility(false);
    const dbg = this.win.webContents.debugger;
    dbg.on('message', (_e, method, params) => {
      if (typeof method === 'string' && method.startsWith('Page.')) {
        const p = params as { url?: string; title?: string };
        if (method === 'Page.navigatedWithinDocument' && p.url) this.currentUrl = p.url;
        if (p?.url && (method === 'Page.frameNavigated' || method === 'Page.frameStartedLoading')) {
          if (!String(p.url).startsWith('about:')) this.currentUrl = p.url;
        }
      }
      // v11.10 — collect console + log-domain output for browser_console.
      if (method === 'Runtime.consoleAPICalled') {
        const p = params as { type?: string; args?: Array<{ type?: string; value?: unknown; description?: string }> };
        const parts = (p.args ?? []).map((a) =>
          a.description ?? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value) ?? String(a.value)),
        );
        const text = parts.join(' ').slice(0, 500);
        if (text) this.pushConsole(`[${p.type || 'log'}] ${text}`);
      }
      if (method === 'Log.entryAdded') {
        const p = params as { entry?: { level?: string; source?: string; text?: string } };
        const e = p.entry;
        if (e?.text) this.pushConsole(`[${e.level || 'info'}:${e.source || 'log'}] ${String(e.text).slice(0, 500)}`);
      }
      // v12 — Network request lifecycle (enabled on navigate + browser_network).
      if (method === 'Network.requestWillBeSent') {
        const p = params as { requestId?: string; request?: { method?: string; url?: string }; type?: string };
        if (p.requestId) this.networkLog.push({
          requestId: p.requestId, method: p.request?.method ?? '?', url: p.request?.url ?? '',
          type: p.type, startTime: Date.now(),
        });
        if (this.networkLog.length > 300) this.networkLog.splice(0, this.networkLog.length - 300);
      } else if (method === 'Network.responseReceived' || method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        const p = params as { requestId?: string; response?: { status?: number; statusText?: string; mimeType?: string }; type?: string; encodedDataLength?: number; errorText?: string; blockedReason?: string };
        const entry = [...this.networkLog].reverse().find((e) => e.requestId === p.requestId);
        if (entry) {
          if (method === 'Network.responseReceived') {
            Object.assign(entry, { status: p.response?.status, statusText: p.response?.statusText, mimeType: p.response?.mimeType, type: p.type ?? entry.type });
          } else if (method === 'Network.loadingFinished') {
            entry.endTime = Date.now();
            entry.encodedDataLength = p.encodedDataLength ?? 0;
          } else {
            entry.endTime = Date.now();
            entry.errorText = p.errorText ?? p.blockedReason ?? 'failed';
          }
        }
      }
      const msgId = (params as { requestId?: number } | undefined)?.requestId;
      if (msgId !== undefined && this.pending.has(msgId)) {
        // CDP responses carry no requestId on events — only sendCommand
        // callbacks resolve below; this branch is defensive only.
      }
    });
    dbg.on('detach', () => {
      /* a user opening devtools detaches us; commands will fail with clear errors */
    });
  }

  get debugger(): BrowserWindow['webContents']['debugger'] {
    return this.win.webContents.debugger;
  }

  attached(): boolean {
    try {
      return this.debugger.isAttached();
    } catch {
      return false;
    }
  }

  // ---------- v11.10 console capture ----------
  private pushConsole(line: string): void {
    this.consoleLog.push(line);
    if (this.consoleLog.length > 500) this.consoleLog.splice(0, this.consoleLog.length - 500);
  }

  /** Enable the CDP domains console output flows through (idempotent, best-effort). */
  async ensureConsoleDomains(): Promise<void> {
    if (this.consoleDomainsEnabled) return;
    if (!this.attached()) this.debugger.attach('1.3');
    await this.cdp('Runtime.enable', {}, 5_000);
    try {
      await this.cdp('Log.enable', {}, 5_000);
    } catch {
      /* Log domain is unavailable on some targets — consoleAPICalled still works */
    }
    this.consoleDomainsEnabled = true;
  }

  /** Tail of captured console output (browser_console). */
  consoleTail(tail = 60): string {
    return this.consoleLog.slice(-tail).join('\n');
  }

  /** Enable the CDP Network domain (idempotent, best-effort). */
  async ensureNetworkDomains(): Promise<void> {
    if (this.networkDomainsEnabled) return;
    if (!this.attached()) this.debugger.attach('1.3');
    await this.cdp('Network.enable', {}, 5_000);
    this.networkDomainsEnabled = true;
  }

  /** Formatted request log for browser_network. */
  networkTail(opts: { urlContains?: string; limit?: number } = {}): string {
    let rows = this.networkLog;
    if (opts.urlContains) rows = rows.filter((e) => e.url.includes(opts.urlContains!));
    rows = rows.slice(-Math.min(300, Math.max(1, opts.limit ?? 80)));
    if (!rows.length) return 'No network requests logged yet (Network domain enables on navigation).';
    return rows.map((e) => {
      const ms = e.endTime ? ` ${e.endTime - e.startTime}ms` : '';
      const kb = e.encodedDataLength ? ` ${Math.round(e.encodedDataLength / 1024)}KB` : '';
      const status = e.status ?? (e.errorText ? 'ERR' : '…');
      return `${e.method} ${status} ${e.type ?? ''}${ms}${kb}  ${e.url.slice(0, 200)}` + (e.errorText ? ` [${e.errorText}]` : '');
    }).join('\n');
  }

  /** Raw CDP command with a timeout (Electron's Promise-based sendCommand). */
  async cdp<T>(method: string, params?: Record<string, unknown>, timeoutMs = EVAL_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raced = await Promise.race([
        this.debugger.sendCommand(method, (params ?? {}) as Record<string, unknown>) as Promise<T>,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`CDP ${method} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
        }),
      ]);
      return raced;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      throw new Error(m.startsWith('CDP ') ? m : `CDP ${method}: ${m}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Navigate + wait for the load event (or timeout). */
  async navigate(url: string, userAgent?: string): Promise<BrowserPageSummary> {
    if (!this.attached()) this.debugger.attach('1.3');
    await this.cdp('Page.enable', {}, 5_000);
    // v12 — enable Network capture BEFORE navigating so first-page requests land.
    try { await this.ensureNetworkDomains(); } catch { /* non-fatal */ }
    // v11.32 — ALWAYS set a real browser UA (a caller may still override it).
    // The old code skipped this unless the caller passed one, so every agent
    // navigation advertised the default CDP UA and got 403'd by CDN-protected
    // pages.
    await this.cdp('Emulation.setUserAgentOverride', { userAgent: userAgent || BROWSER_UA }, 5_000);
    // Holder object (not a bare variable): TS control-flow would otherwise
    // narrow a `let x: (() => void) | null = null` to `null` forever because
    // the assignment happens inside the Promise executor callback.
    const loadCtl: { cancel: (() => void) | null } = { cancel: null };
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`page load timed out after ${Math.round(NAV_TIMEOUT_MS / 1000)}s (navigation may still be in progress — snapshot anyway)`));
      }, NAV_TIMEOUT_MS);
      const onMsg = (_e: unknown, method: string): void => {
        if (method === 'Page.loadEventFired' || method === 'Page.frameStoppedLoading') {
          cleanup();
          resolve();
        }
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.debugger.removeListener('message', onMsg as never);
        loadCtl.cancel = null;
      };
      loadCtl.cancel = (): void => { cleanup(); reject(new Error('navigation cancelled')); };
      this.debugger.on('message', onMsg as never);
    });
    try {
      // CDP reports main-frame failures (DNS refused, cert error, ...) on the
      // RESULT of Page.navigate. The old code ignored it and lied "Loaded".
      const nav = await this.cdp<{ errorText?: string }>('Page.navigate', { url }, NAV_TIMEOUT_MS);
      if (nav?.errorText) {
        loadCtl.cancel?.();
        void loaded.catch(() => { /* prevent unhandled rejection on the cancel path */ });
        throw new Error(explainNavError(nav.errorText, url));
      }
    } catch (err) {
      // A failed/spawnless navigation must not leave a 25 s timer + CDP
      // listener behind (dangling handles + misleading "load timed out").
      loadCtl.cancel?.();
      void loaded.catch(() => { /* swallow the cancel rejection */ });
      throw err;
    }
    let loadTimedOut = false;
    await loaded.catch((e: Error) => {
      if (!String(e.message).includes('timed out')) throw e;
      // NOT fatal, but never hidden: the tool output must say the page never
      // finished loading instead of reporting a fabricated clean "Loaded".
      loadTimedOut = true;
    });
    const summary = await this.summarize();
    return loadTimedOut ? { ...summary, loadTimedOut: true } : summary;
  }

  async summarize(): Promise<BrowserPageSummary> {
    try {
      const r = await this.evalJs('JSON.stringify({url: location.href, title: document.title})', 4_000);
      const parsed = JSON.parse(String(r)) as { url: string; title: string };
      this.currentUrl = parsed.url || this.currentUrl;
      this.currentTitle = parsed.title || '';
    } catch {
      /* keep last known */
    }
    return { url: this.currentUrl, title: this.currentTitle };
  }

  /** Evaluate an expression in the page, returning the `result.value`. */
  async evalJs(expression: string, timeoutMs = EVAL_TIMEOUT_MS): Promise<unknown> {
    if (!this.attached()) this.debugger.attach('1.3');
    await this.cdp('Runtime.enable', {}, 5_000);
    const r = await this.cdp<{ result?: { value?: unknown; type?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      timeoutMs,
    );
    if (r?.exceptionDetails) {
      throw new Error(`page JS error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'unknown'}`);
    }
    return r?.result?.value;
  }

  snapshotSelector(): string {
    return "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[onclick],summary,iframe";
  }

  async snapshot(): Promise<InteractiveRef[]> {
    const sel = this.snapshotSelector();
    const expr = `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
      return JSON.stringify(els.map((el, i) => ({
        i,
        tag: el.tagName.toLowerCase(),
        kind: el.getAttribute('type') || el.getAttribute('role') || '',
        text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('name') || '').toString().trim().slice(0, 90),
        value: (el.value || '').toString().slice(0, 60),
        href: el.href ? String(el.href).slice(0, 200) : null,
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      })).filter(x => x.visible).slice(0, ${SNAPSHOT_CAP}));
    })()`;
    const raw = await this.evalJs(expr);
    return JSON.parse(String(raw ?? '[]')) as InteractiveRef[];
  }

  async clickRef(ref: number): Promise<string> {
    const expr = `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = els[${ref}];
      if (!el) return JSON.stringify({ ok: false, error: 'ref out of range — take a fresh browser_snapshot' });
      el.scrollIntoView({ block: 'center' });
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).toString().trim().slice(0, 80);
      el.click();
      return JSON.stringify({ ok: true, clicked: el.tagName.toLowerCase(), label });
    })()`;
    const raw = await this.evalJs(expr);
    const parsed = JSON.parse(String(raw ?? '{}')) as { ok: boolean; clicked?: string; label?: string; error?: string };
    if (!parsed.ok) throw new Error(parsed.error ?? 'click failed');
    return `${parsed.clicked} "${parsed.label ?? ''}"`.trim();
  }

  async typeInto(ref: number, text: string, submit: boolean): Promise<string> {
    const expr = `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = els[${ref}];
      if (!el) return JSON.stringify({ ok: false, error: 'ref out of range — take a fresh browser_snapshot' });
      el.scrollIntoView({ block: 'center' });
      el.focus();
      return JSON.stringify({ ok: true, tag: el.tagName.toLowerCase(), editable: !!(el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') });
    })()`;
    const raw = await this.evalJs(expr);
    const parsed = JSON.parse(String(raw ?? '{}')) as { ok: boolean; tag?: string; editable?: boolean; error?: string };
    if (!parsed.ok) throw new Error(parsed.error ?? 'focus failed');
    if (parsed.tag === 'select') {
      await this.evalJs(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el=>el.offsetWidth||el.offsetHeight); const el=els[${ref}]; el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
    } else {
      const ins = await this.cdp<{ count?: number }>('Input.insertText', { text }, 6_000);
      if (!ins?.count && text.length) {
        // insertText can no-op on exotic fields — fall back to value assignment
        await this.evalJs(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el=>el.offsetWidth||el.offsetHeight); const el=els[${ref}]; el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
      }
      if (submit) await this.evalJs(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el=>el.offsetWidth||el.offsetHeight); const el=els[${ref}]; if (el.form) { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); } else { el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true})); } return 'ok'; })()`);
    }
    return parsed.tag ?? 'element';
  }

  async readText(): Promise<string> {
    const raw = await this.evalJs(`document.body ? document.body.innerText.slice(0, ${READ_CAP}) : ''`);
    return String(raw ?? '');
  }

  async screenshot(maxChars = 5_000_000): Promise<string> {
    if (!this.attached()) this.debugger.attach('1.3');
    const r = await this.cdp<{ data?: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, SHOT_TIMEOUT_MS);
    if (!r?.data) throw new Error('screenshot returned no data');
    let data = r.data;
    // Track the ACTUAL encoding: the downscaled retry below is JPEG, but the
    // data URL used to keep the "image/png" prefix — consumers sniffed the
    // header and rejected the image as corrupt.
    let mime = 'png';
    if (data.length > maxChars) {
      // progressively downscale via the page's own canvas pipeline
      const small = await this.cdp<{ data?: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 55 }, SHOT_TIMEOUT_MS);
      if (small?.data) {
        data = small.data;
        mime = 'jpeg';
      }
      if (data.length > maxChars) throw new Error(`screenshot too large even after re-encode (${Math.round(data.length / 1024)}KB)`);
    }
    return `data:image/${mime};base64,${data}`;
  }

  close(): void {
    try {
      if (this.attached()) this.debugger.detach();
    } catch { /* already detached */ }
    try {
      if (!this.win.isDestroyed()) this.win.destroy();
    } catch { /* already gone */ }
  }
}

// ---------- session registry ----------

const sessions = new Map<string, BrowserSession>();

export function browserAvailable(): boolean {
  return typeof BrowserWindow === 'function' && !process.env.SURNIA_NO_BROWSER;
}

function sessionFor(sessionId: string): BrowserSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (existing.win.isDestroyed()) {
      sessions.delete(sessionId);
    } else {
      existing.lastUsed = Date.now();
      return existing;
    }
  }
  if (sessions.size >= MAX_WINDOWS) {
    // Reap the LEAST-RECENTLY-USED session — Map insertion order is creation
    // order, so the old code could destroy the tab the user is working in.
    let oldestId: string | undefined;
    let oldestAt = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastUsed < oldestAt) {
        oldestAt = s.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) closeBrowser(oldestId);
  }
  const s = new BrowserSession(sessionId);
  sessions.set(sessionId, s);
  return s;
}

export function closeBrowser(sessionId: string): void {
  // v12 — close any tabs belonging to this session first.
  closeAllTabs(sessionId);
  const s = sessions.get(sessionId);
  if (s) {
    const url = s.currentUrl;
    const title = s.currentTitle;
    s.close();
    sessions.delete(sessionId);
    lastShots.delete(sessionId);
    emitUi({ kind: 'closed', sessionId, url, title });
  }
}

/** Live state for the renderer's Browser panel (cached shot included). */
export function browserStateFor(sessionId: string): BrowserState {
  const s = sessions.get(sessionId);
  if (!s || s.win.isDestroyed()) return { open: false, url: '', title: '', lastShot: lastShots.get(shotCacheKey(sessionId)) };
  return { open: true, url: s.currentUrl, title: s.currentTitle, lastShot: lastShots.get(shotCacheKey(sessionId)) };
}

/** Ids of every live browser session (panel status strip). */
export function activeBrowserSessions(): string[] {
  return [...sessions.entries()].filter(([, s]) => !s.win.isDestroyed()).map(([id]) => id);
}

export function closeAllBrowsers(): void {
  for (const id of [...sessions.keys()]) closeBrowser(id);
}

function schemeAllowed(url: string, fullAccess: boolean): { ok: boolean; why?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, why: 'invalid URL' };
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return { ok: true };
  if (fullAccess) return { ok: true, why: `scheme ${u.protocol} allowed by fullAccess — be careful` };
  return { ok: false, why: `scheme ${u.protocol} blocked (http/https only; fullAccess unlocks others)` };
}

// ---------- exported tool handlers (called from tools.ts) ----------

export interface BrowserToolCtx {
  sessionId: string;
  fullAccess?: boolean;
  /** v12 — optional tab id (from browser_tabs). Absent = default/active tab. */
  tabId?: string;
  onTaint(origin: string, note: string): void;
}

/** Map a (session, tab) pair to the synthetic session key used for that tab's window. */
function sessionKey(ctx: BrowserToolCtx): string {
  return ctx.tabId ? `${ctx.sessionId}::tab::${ctx.tabId}` : ctx.sessionId;
}

export async function browserNavigate(ctx: BrowserToolCtx, url: string): Promise<{ summary: string; screenshotHint: string }> {
  const scheme = schemeAllowed(url, !!ctx.fullAccess);
  if (!scheme.ok) throw new Error(scheme.why ?? 'URL scheme blocked');
  const s = sessionFor(sessionKey(ctx));
  const sum = await s.navigate(url);
  emitUi({ kind: 'navigated', sessionId: ctx.sessionId, url: sum.url, title: sum.title });
  // Page content just entered the session — mark the taint ledger so the
  // existing approval wall protects subsequent dangerous commands.
  try {
    ctx.onTaint(url, `browser page: ${sum.title || url}`);
  } catch { /* taint is best-effort */ }
  const text = await s.readText().catch(() => '');
  const warning = sum.loadTimedOut
    ? `Warning: the page did not finish loading within ${Math.round(NAV_TIMEOUT_MS / 1000)}s — the text below may be partial. ` +
      'Take a fresh browser_snapshot after it settles.\n'
    : '';
  return {
    summary:
      `${warning}Loaded ${sum.url}\nTitle: ${sum.title || '(untitled)'}\n\n` +
      `Page text (first ${READ_CAP} chars):\n${text.slice(0, READ_CAP) || '(empty page)'}`,
    screenshotHint: 'Use browser_screenshot if the model needs the visual layout, or browser_snapshot for clickable element refs.',
  };
}

export async function browserSnapshot(ctx: BrowserToolCtx): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  const refs = await s.snapshot();
  if (!refs.length) return `${(await s.summarize()).url}\n\nNo interactive elements found. Use browser_read for the page text.`;
  const lines = refs.map((r) => {
    const label = r.text || r.value || r.href || '';
    return `[${r.i}] <${r.tag}${r.kind ? ` type=${r.kind}` : ''}> ${label}${r.href ? ` → ${r.href}` : ''}`;
  });
  return `${(await s.summarize()).url}\n\n${lines.length} interactive element(s):\n${lines.join('\n')}\n\nClick/type with browser_click/browser_type using the [i] ref.`;
}

export async function browserClick(ctx: BrowserToolCtx, ref: number): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  const clicked = await s.clickRef(ref);
  await new Promise((r) => setTimeout(r, 700)); // let SPA/loads settle
  const sum = await s.summarize();
  try {
    ctx.onTaint(sum.url, `browser interaction on ${sum.title || sum.url}`);
  } catch { /* best-effort */ }
  return `Clicked ${clicked}.\nNow at: ${sum.url}\nTitle: ${sum.title || '(untitled)'}\nTake browser_snapshot to see the new state.`;
}

export async function browserType(ctx: BrowserToolCtx, ref: number, text: string, submit: boolean): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  const tag = await s.typeInto(ref, text, submit);
  await new Promise((r) => setTimeout(r, 500));
  const sum = await s.summarize();
  return `Typed ${text.length} char(s) into <${tag}>${submit ? ' and submitted' : ''}.\nNow at: ${sum.url}\nTake browser_snapshot to see the result.`;
}

export async function browserRead(ctx: BrowserToolCtx): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  const sum = await s.summarize();
  const text = await s.readText();
  try {
    ctx.onTaint(sum.url, `browser read: ${sum.title || sum.url}`);
  } catch { /* best-effort */ }
  return `${sum.url}\nTitle: ${sum.title || '(untitled)'}\n\n${text || '(empty page)'}`;
}

export async function browserScreenshot(ctx: BrowserToolCtx): Promise<{ dataUrl: string; note: string }> {
  const s = sessionFor(sessionKey(ctx));
  const dataUrl = await s.screenshot();
  // cache (a dataUrl can be ~200KB — keep only the latest per TAB) + push to UI
  lastShots.set(shotCacheKey(ctx.sessionId), dataUrl);
  const sum = await s.summarize();
  emitUi({ kind: 'shot', sessionId: ctx.sessionId, url: sum.url, title: sum.title });
  return { dataUrl, note: sum.url };
}

export async function browserEval(ctx: BrowserToolCtx, expression: string): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  const out = await s.evalJs(expression);
  const rendered = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
  return `Result: ${String(rendered ?? 'undefined').slice(0, 8_000)}`;
}

// ---------- v11.10 — console + print-to-PDF (real CDP powers) ----------

/** Read recent console messages from the open page (browser_console). */
export async function browserConsoleLogs(ctx: BrowserToolCtx): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  await s.ensureConsoleDomains();
  const sum = await s.summarize();
  const tail = s.consoleTail(60);
  return `${sum.url}\nTitle: ${sum.title || '(untitled)'}\n\n` +
    (tail ? `Console (last ${Math.min(60, s.consoleLog.length)} message(s)):\n${tail}` : 'No console messages captured yet.') +
    '\nTip: browser_console_eval runs JS and shows BOTH the value and any console output it produced.';
}

/**
 * Evaluate JS in the page AND report console output produced during evaluation
 * (browser_console_eval — approval-gated by the caller like browser_eval).
 */
export async function browserConsoleEval(ctx: BrowserToolCtx, expression: string): Promise<string> {
  const s = sessionFor(sessionKey(ctx));
  await s.ensureConsoleDomains();
  const before = s.consoleLog.length;
  const out = await s.evalJs(expression);
  await new Promise((r) => setTimeout(r, 250)); // let console events drain
  const rendered = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
  const fresh = s.consoleLog.slice(before).join('\n');
  return `Result: ${String(rendered ?? 'undefined').slice(0, 8_000)}` +
    (fresh ? `\n\nConsole output during evaluation:\n${fresh.slice(0, 4_000)}` : '\n(no console output during evaluation)');
}

/**
 * Print the current page to PDF via CDP Page.printToPDF (browser_pdf).
 * Returns raw PDF bytes; the caller enforces the workspace write-wall.
 */
export async function browserPrintToPdf(
  ctx: BrowserToolCtx,
  opts?: { landscape?: boolean; background?: boolean },
): Promise<Buffer> {
  const s = sessionFor(sessionKey(ctx));
  if (!s.attached()) s.debugger.attach('1.3');
  await s.cdp('Page.enable', {}, 5_000);
  const r = await s.cdp<{ data?: string }>(
    'Page.printToPDF',
    {
      printBackground: opts?.background !== false,
      landscape: opts?.landscape === true,
      preferCSSPageSize: true,
    },
    20_000,
  );
  if (!r?.data) throw new Error('Page.printToPDF returned no data (some pages — e.g. chrome:// — refuse printing).');
  return Buffer.from(r.data, 'base64');
}

export function browserStatus(sessionId: string): string {
  const s = sessions.get(sessionId);
  if (!s || s.win.isDestroyed()) return 'no browser open for this session';
  return `browser open at ${s.currentUrl} (title: ${s.currentTitle || '—'})`;
}

// ============================================================
// v12 — TABS. Each tab is an independent hidden BrowserWindow whose
// synthetic session key is `${sessionId}::tab::${tabId}`. The default
// tab uses the original session key so all pre-v12 tools are unchanged.
// One key registry tracks ids + the active tab per real session.
// ============================================================
interface TabRegistry { tabs: string[]; active: string }
const tabRegistry = new Map<string, TabRegistry>();
const MAX_TABS = 8;

function registryFor(sessionId: string): TabRegistry {
  let r = tabRegistry.get(sessionId);
  if (!r) { r = { tabs: [], active: '' }; tabRegistry.set(sessionId, r); }
  return r;
}

function tabKey(sessionId: string, tabId: string): string { return `${sessionId}::tab::${tabId}`; }

/** Manage tabs: list | new | close | select. */
export async function browserTabs(
  ctx: BrowserToolCtx,
  args: { action: 'list' | 'new' | 'close' | 'select'; tab_id?: string; url?: string },
): Promise<string> {
  const reg = registryFor(ctx.sessionId);
  const action = args.action;
  if (action === 'list') {
    if (!reg.tabs.length) return 'No extra tabs open (the default tab is always available).';
    const lines = reg.tabs.map((id) => {
      const s = sessions.get(tabKey(ctx.sessionId, id));
      return `${id === reg.active ? '*' : ' '} ${id}  ${s?.currentUrl ?? 'about:blank'}  (${s?.currentTitle || 'untitled'})`;
    });
    return `Default tab: ${sessions.get(ctx.sessionId)?.currentUrl ?? 'not open'}\n${lines.join('\n')}`;
  }
  if (action === 'new') {
    if (reg.tabs.length >= MAX_TABS) throw new Error(`tab limit reached (${MAX_TABS})`);
    const id = `t${Date.now().toString(36).slice(-5)}${reg.tabs.length}`;
    reg.tabs.push(id);
    reg.active = id;
    if (args.url) {
      const scheme = schemeAllowed(args.url, !!ctx.fullAccess);
      if (!scheme.ok) throw new Error(scheme.why ?? 'URL scheme blocked');
      // Open the tab window under its synthetic key.
      let tab = sessions.get(tabKey(ctx.sessionId, id));
      if (!tab) { tab = new BrowserSession(tabKey(ctx.sessionId, id)); sessions.set(tabKey(ctx.sessionId, id), tab); }
      const sum = await tab.navigate(args.url);
      try { ctx.onTaint(args.url, `browser tab: ${sum.title || args.url}`); } catch { /* best-effort */ }
      emitUi({ kind: 'navigated', sessionId: tabKey(ctx.sessionId, id), url: sum.url, title: sum.title });
      return `Opened tab ${id} at ${sum.url}. Active tab is now ${id}.`;
    }
    // create the window lazily on first use; register it now for listing
    return `Opened tab ${id} (about:blank). Use browser_navigate with tab_id "${id}".`;
  }
  if (action === 'close') {
    const id = args.tab_id ?? reg.active;
    if (!id) throw new Error('no tab to close');
    const key = tabKey(ctx.sessionId, id);
    const s = sessions.get(key);
    if (s) { s.close(); sessions.delete(key); }
    lastShots.delete(key);
    reg.tabs = reg.tabs.filter((t) => t !== id);
    if (reg.active === id) reg.active = reg.tabs[reg.tabs.length - 1] ?? '';
    emitUi({ kind: 'closed', sessionId: key, url: s?.currentUrl ?? '', title: s?.currentTitle ?? '' });
    return `Closed tab ${id}. Active tab is now ${reg.active || 'default'}.`;
  }
  if (action === 'select') {
    const id = args.tab_id;
    if (!id) throw new Error('tab_id required for select');
    if (id !== 'default' && !reg.tabs.includes(id)) throw new Error(`unknown tab_id ${id}`);
    reg.active = id === 'default' ? '' : id;
    return `Selected tab ${id}. Browser tools without tab_id now target it.`;
  }
  throw new Error(`unknown action ${action}`);
}

/** Read/clear the CDP Network request log of a tab. */
export async function browserNetwork(
  ctx: BrowserToolCtx,
  opts: { url_contains?: string; limit?: number; clear?: boolean } = {},
): Promise<string> {
  let tab = sessions.get(sessionKey(ctx));
  if (!tab) tab = sessionFor(sessionKey(ctx));
  if (opts.clear) { tab.networkLog.length = 0; return 'Network log cleared.'; }
  await tab.ensureNetworkDomains();
  return `${tab.currentUrl}\n${tab.networkLog.length ? `${tab.networkLog.length} request(s) recorded:\n` : ''}${tab.networkTail({ urlContains: opts.url_contains, limit: opts.limit })}`;
}

/** Effective tab id for the active tab — tools pass this to browserCtxOf. */
export function activeTabId(sessionId: string): string | undefined {
  return registryFor(sessionId).active || undefined;
}

/** UI-facing tab list for the Browser panel (default + extra tabs). */
export function browserTabsInfo(sessionId: string): Array<{ id: string; url: string; title: string; active: boolean }> {
  const reg = registryFor(sessionId);
  const out: Array<{ id: string; url: string; title: string; active: boolean }> = [];
  const main = sessions.get(sessionId);
  if (main && !main.win.isDestroyed()) {
    out.push({ id: 'default', url: main.currentUrl, title: main.currentTitle, active: !reg.active });
  }
  for (const id of reg.tabs) {
    const s = sessions.get(tabKey(sessionId, id));
    if (s && !s.win.isDestroyed()) out.push({ id, url: s.currentUrl, title: s.currentTitle, active: id === reg.active });
  }
  return out;
}

/** UI-facing network log for the active tab. */
export function browserNetworkInfo(sessionId: string, opts: { url_contains?: string; limit?: number; clear?: boolean } = {}): { url: string; entries: Array<{ method: string; status: string; type?: string; ms?: number; kb?: number; url: string; errorText?: string }> } {
  const active = activeTabId(sessionId);
  let tab = sessions.get(sessionKey({ sessionId, tabId: active, onTaint: () => {} }));
  if (!tab) tab = sessionFor(sessionKey({ sessionId, tabId: active, onTaint: () => {} }));
  if (opts.clear) tab.networkLog.length = 0;
  const rows = tab.networkLog.filter((e) => !opts.url_contains || e.url.includes(opts.url_contains!))
    .slice(-Math.min(300, Math.max(1, opts.limit ?? 80)));
  return {
    url: tab.currentUrl,
    entries: rows.map((e) => ({
      method: e.method, status: String(e.status ?? (e.errorText ? 'ERR' : '…')), type: e.type,
      ms: e.endTime ? e.endTime - e.startTime : undefined,
      kb: e.encodedDataLength ? Math.round(e.encodedDataLength / 1024) : undefined,
      url: e.url, errorText: e.errorText,
    })),
  };
}

/** UI-facing tab actions (no taint needed for select/close/new-without-url). */
export function browserTabAction(sessionId: string, action: 'select' | 'close' | 'new', tabId?: string, url?: string): Promise<string> {
  return browserTabs({ sessionId, onTaint: () => {} }, { action, tab_id: tabId, url });
}

/** Close every tab of a session (used by closeBrowser / app quit). */
export function closeAllTabs(sessionId: string): void {
  const reg = registryFor(sessionId);
  for (const id of reg.tabs) {
    const key = tabKey(sessionId, id);
    sessions.get(key)?.close();
    sessions.delete(key);
    lastShots.delete(key);
  }
  reg.tabs = [];
  reg.active = '';
  tabRegistry.delete(sessionId);
}

/** Detach every CDP debugger before the process goes away (CLI / app quit). */
process.once('exit', () => {
  for (const s of sessions.values()) {
    try {
      s.close();
    } catch {
      /* best effort */
    }
  }
  sessions.clear();
  lastShots.clear();
});
