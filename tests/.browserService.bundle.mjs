// tests/electron-stub.mjs
var FakeBrowserWindow = class {
};
var BrowserWindow = FakeBrowserWindow;

// electron/services/browserService.ts
var emitBrowserUi = null;
function setBrowserEventEmitter(cb) {
  emitBrowserUi = cb;
}
function emitUi(e) {
  try {
    emitBrowserUi?.(e);
  } catch {
  }
}
var lastShots = /* @__PURE__ */ new Map();
var NAV_TIMEOUT_MS = 25e3;
var EVAL_TIMEOUT_MS = 8e3;
var SHOT_TIMEOUT_MS = 1e4;
var READ_CAP = 14e3;
var SNAPSHOT_CAP = 120;
var MAX_WINDOWS = 4;
var BrowserSession = class {
  win;
  id;
  currentUrl = "about:blank";
  currentTitle = "";
  cmdSeq = 0;
  pending = /* @__PURE__ */ new Map();
  loadWaiters = [];
  constructor(id) {
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
        spellcheck: false
      }
    });
    this.win.setMenuBarVisibility(false);
    const dbg = this.win.webContents.debugger;
    dbg.on("message", (_e, method, params) => {
      if (typeof method === "string" && method.startsWith("Page.")) {
        const p = params;
        if (method === "Page.navigatedWithinDocument" && p.url) this.currentUrl = p.url;
        if (p?.url && (method === "Page.frameNavigated" || method === "Page.frameStartedLoading")) {
          if (!String(p.url).startsWith("about:")) this.currentUrl = p.url;
        }
      }
      const msgId = params?.requestId;
      if (msgId !== void 0 && this.pending.has(msgId)) {
      }
    });
    dbg.on("detach", () => {
    });
  }
  get debugger() {
    return this.win.webContents.debugger;
  }
  attached() {
    try {
      return this.debugger.isAttached();
    } catch {
      return false;
    }
  }
  /** Raw CDP command with a timeout (Electron's Promise-based sendCommand). */
  async cdp(method, params, timeoutMs = EVAL_TIMEOUT_MS) {
    let timer;
    try {
      const raced = await Promise.race([
        this.debugger.sendCommand(method, params ?? {}),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`CDP ${method} timed out after ${Math.round(timeoutMs / 1e3)}s`)), timeoutMs);
        })
      ]);
      return raced;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      throw new Error(m.startsWith("CDP ") ? m : `CDP ${method}: ${m}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /** Navigate + wait for the load event (or timeout). */
  async navigate(url, userAgent) {
    if (!this.attached()) this.debugger.attach("1.3");
    await this.cdp("Page.enable", {}, 5e3);
    if (userAgent) await this.cdp("Emulation.setUserAgentOverride", { userAgent }, 5e3);
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`page load timed out after ${Math.round(NAV_TIMEOUT_MS / 1e3)}s (navigation may still be in progress \u2014 snapshot anyway)`));
      }, NAV_TIMEOUT_MS);
      const onMsg = (_e, method) => {
        if (method === "Page.loadEventFired" || method === "Page.frameStoppedLoading") {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.debugger.removeListener("message", onMsg);
      };
      this.debugger.on("message", onMsg);
    });
    await this.cdp("Page.navigate", { url }, NAV_TIMEOUT_MS);
    await loaded.catch((e) => {
      if (!String(e.message).includes("timed out")) throw e;
    });
    return this.summarize();
  }
  async summarize() {
    try {
      const r = await this.evalJs("JSON.stringify({url: location.href, title: document.title})", 4e3);
      const parsed = JSON.parse(String(r));
      this.currentUrl = parsed.url || this.currentUrl;
      this.currentTitle = parsed.title || "";
    } catch {
    }
    return { url: this.currentUrl, title: this.currentTitle };
  }
  /** Evaluate an expression in the page, returning the `result.value`. */
  async evalJs(expression, timeoutMs = EVAL_TIMEOUT_MS) {
    if (!this.attached()) this.debugger.attach("1.3");
    await this.cdp("Runtime.enable", {}, 5e3);
    const r = await this.cdp(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      timeoutMs
    );
    if (r?.exceptionDetails) {
      throw new Error(`page JS error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "unknown"}`);
    }
    return r?.result?.value;
  }
  snapshotSelector() {
    return "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[onclick],summary,iframe";
  }
  async snapshot() {
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
    return JSON.parse(String(raw ?? "[]"));
  }
  async clickRef(ref) {
    const expr = `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = els[${ref}];
      if (!el) return JSON.stringify({ ok: false, error: 'ref out of range \u2014 take a fresh browser_snapshot' });
      el.scrollIntoView({ block: 'center' });
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).toString().trim().slice(0, 80);
      el.click();
      return JSON.stringify({ ok: true, clicked: el.tagName.toLowerCase(), label });
    })()`;
    const raw = await this.evalJs(expr);
    const parsed = JSON.parse(String(raw ?? "{}"));
    if (!parsed.ok) throw new Error(parsed.error ?? "click failed");
    return `${parsed.clicked} "${parsed.label ?? ""}"`.trim();
  }
  async typeInto(ref, text, submit) {
    const expr = `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const el = els[${ref}];
      if (!el) return JSON.stringify({ ok: false, error: 'ref out of range \u2014 take a fresh browser_snapshot' });
      el.scrollIntoView({ block: 'center' });
      el.focus();
      return JSON.stringify({ ok: true, tag: el.tagName.toLowerCase(), editable: !!(el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') });
    })()`;
    const raw = await this.evalJs(expr);
    const parsed = JSON.parse(String(raw ?? "{}"));
    if (!parsed.ok) throw new Error(parsed.error ?? "focus failed");
    if (parsed.tag === "select") {
      await this.evalJs(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el=>el.offsetWidth||el.offsetHeight); const el=els[${ref}]; el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
    } else {
      const ins = await this.cdp("Input.insertText", { text }, 6e3);
      if (!ins?.count && text.length) {
        await this.evalJs(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el=>el.offsetWidth||el.offsetHeight); const el=els[${ref}]; el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
      }
      if (submit) await this.evalJs(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(this.snapshotSelector())})].filter(el=>el.offsetWidth||el.offsetHeight); const el=els[${ref}]; if (el.form) { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); } else { el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true})); } return 'ok'; })()`);
    }
    return parsed.tag ?? "element";
  }
  async readText() {
    const raw = await this.evalJs(`document.body ? document.body.innerText.slice(0, ${READ_CAP}) : ''`);
    return String(raw ?? "");
  }
  async screenshot(maxChars = 5e6) {
    if (!this.attached()) this.debugger.attach("1.3");
    const r = await this.cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, SHOT_TIMEOUT_MS);
    if (!r?.data) throw new Error("screenshot returned no data");
    let data = r.data;
    if (data.length > maxChars) {
      const small = await this.cdp("Page.captureScreenshot", { format: "jpeg", quality: 55 }, SHOT_TIMEOUT_MS);
      if (small?.data) data = small.data;
      if (data.length > maxChars) throw new Error(`screenshot too large even after re-encode (${Math.round(data.length / 1024)}KB)`);
    }
    return `data:image/png;base64,${data}`;
  }
  close() {
    try {
      if (this.attached()) this.debugger.detach();
    } catch {
    }
    try {
      if (!this.win.isDestroyed()) this.win.destroy();
    } catch {
    }
  }
};
var sessions = /* @__PURE__ */ new Map();
function browserAvailable() {
  return typeof BrowserWindow === "function" && !process.env.SURNIA_NO_BROWSER;
}
function sessionFor(sessionId) {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (existing.win.isDestroyed()) {
      sessions.delete(sessionId);
    } else {
      return existing;
    }
  }
  if (sessions.size >= MAX_WINDOWS) {
    const oldest = sessions.keys().next().value;
    if (oldest) closeBrowser(oldest);
  }
  const s = new BrowserSession(sessionId);
  sessions.set(sessionId, s);
  return s;
}
function closeBrowser(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    const url = s.currentUrl;
    const title = s.currentTitle;
    s.close();
    sessions.delete(sessionId);
    lastShots.delete(sessionId);
    emitUi({ kind: "closed", sessionId, url, title });
  }
}
function browserStateFor(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || s.win.isDestroyed()) return { open: false, url: "", title: "", lastShot: lastShots.get(sessionId) };
  return { open: true, url: s.currentUrl, title: s.currentTitle, lastShot: lastShots.get(sessionId) };
}
function activeBrowserSessions() {
  return [...sessions.entries()].filter(([, s]) => !s.win.isDestroyed()).map(([id]) => id);
}
function closeAllBrowsers() {
  for (const id of [...sessions.keys()]) closeBrowser(id);
}
function schemeAllowed(url, fullAccess) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, why: "invalid URL" };
  }
  if (u.protocol === "http:" || u.protocol === "https:") return { ok: true };
  if (fullAccess) return { ok: true, why: `scheme ${u.protocol} allowed by fullAccess \u2014 be careful` };
  return { ok: false, why: `scheme ${u.protocol} blocked (http/https only; fullAccess unlocks others)` };
}
async function browserNavigate(ctx, url) {
  const scheme = schemeAllowed(url, !!ctx.fullAccess);
  if (!scheme.ok) throw new Error(scheme.why ?? "URL scheme blocked");
  const s = sessionFor(ctx.sessionId);
  const sum = await s.navigate(url);
  emitUi({ kind: "navigated", sessionId: ctx.sessionId, url: sum.url, title: sum.title });
  try {
    ctx.onTaint(url, `browser page: ${sum.title || url}`);
  } catch {
  }
  const text = await s.readText().catch(() => "");
  return {
    summary: `Loaded ${sum.url}
Title: ${sum.title || "(untitled)"}

Page text (first ${READ_CAP} chars):
${text.slice(0, READ_CAP) || "(empty page)"}`,
    screenshotHint: "Use browser_screenshot if the model needs the visual layout, or browser_snapshot for clickable element refs."
  };
}
async function browserSnapshot(ctx) {
  const s = sessionFor(ctx.sessionId);
  const refs = await s.snapshot();
  if (!refs.length) return `${(await s.summarize()).url}

No interactive elements found. Use browser_read for the page text.`;
  const lines = refs.map((r) => {
    const label = r.text || r.value || r.href || "";
    return `[${r.i}] <${r.tag}${r.kind ? ` type=${r.kind}` : ""}> ${label}${r.href ? ` \u2192 ${r.href}` : ""}`;
  });
  return `${(await s.summarize()).url}

${lines.length} interactive element(s):
${lines.join("\n")}

Click/type with browser_click/browser_type using the [i] ref.`;
}
async function browserClick(ctx, ref) {
  const s = sessionFor(ctx.sessionId);
  const clicked = await s.clickRef(ref);
  await new Promise((r) => setTimeout(r, 700));
  const sum = await s.summarize();
  try {
    ctx.onTaint(sum.url, `browser interaction on ${sum.title || sum.url}`);
  } catch {
  }
  return `Clicked ${clicked}.
Now at: ${sum.url}
Title: ${sum.title || "(untitled)"}
Take browser_snapshot to see the new state.`;
}
async function browserType(ctx, ref, text, submit) {
  const s = sessionFor(ctx.sessionId);
  const tag = await s.typeInto(ref, text, submit);
  await new Promise((r) => setTimeout(r, 500));
  const sum = await s.summarize();
  return `Typed ${text.length} char(s) into <${tag}>${submit ? " and submitted" : ""}.
Now at: ${sum.url}
Take browser_snapshot to see the result.`;
}
async function browserRead(ctx) {
  const s = sessionFor(ctx.sessionId);
  const sum = await s.summarize();
  const text = await s.readText();
  try {
    ctx.onTaint(sum.url, `browser read: ${sum.title || sum.url}`);
  } catch {
  }
  return `${sum.url}
Title: ${sum.title || "(untitled)"}

${text || "(empty page)"}`;
}
async function browserScreenshot(ctx) {
  const s = sessionFor(ctx.sessionId);
  const dataUrl = await s.screenshot();
  lastShots.set(ctx.sessionId, dataUrl);
  const sum = await s.summarize();
  emitUi({ kind: "shot", sessionId: ctx.sessionId, url: sum.url, title: sum.title });
  return { dataUrl, note: sum.url };
}
async function browserEval(ctx, expression) {
  const s = sessionFor(ctx.sessionId);
  const out = await s.evalJs(expression);
  const rendered = typeof out === "string" ? out : JSON.stringify(out, null, 1);
  return `Result: ${String(rendered ?? "undefined").slice(0, 8e3)}`;
}
function browserStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || s.win.isDestroyed()) return "no browser open for this session";
  return `browser open at ${s.currentUrl} (title: ${s.currentTitle || "\u2014"})`;
}
export {
  activeBrowserSessions,
  browserAvailable,
  browserClick,
  browserEval,
  browserNavigate,
  browserRead,
  browserScreenshot,
  browserSnapshot,
  browserStateFor,
  browserStatus,
  browserType,
  closeAllBrowsers,
  closeBrowser,
  setBrowserEventEmitter
};
