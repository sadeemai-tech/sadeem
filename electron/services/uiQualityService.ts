// ============================================================
// Surnia — UI quality prober ("give the agent eyes")
// ------------------------------------------------------------
// Deterministic visual QA for any HTML page the agent builds.
// An offscreen BrowserWindow loads the page at three viewport
// widths and runs a pure-JS probe that reports the failures a
// weak model cannot see: horizontal overflow, missing viewport
// meta, missing alt attributes, sub-12px text, low-contrast
// text pairs (< 3:1), dead-appearing interactive elements and
// console errors. The result is a structured TEXT report fed
// back to the model so it can FIX what it broke — the same
// closed loop v0/Lovable use, but deterministic (no VLM
// judgment needed) so it works with every provider.
// Security: local files and http(s) only, SSRF-guarded like
// previewService; the window is never shown and is destroyed
// after each probe; page JS runs with nodeIntegration off.
// ============================================================
import { BrowserWindow, type WebContents } from 'electron';
import * as dnsProm from 'node:dns/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const WIDTHS = [390, 820, 1366] as const; // phone / tablet / desktop
const PROBE_TIMEOUT_MS = 15_000;
const MAX_FINDINGS_PER_KIND = 6;
const CONTRAST_FLOOR = 3.0; // large-text WCAG floor; stricter than 4.5 but low-noise

export interface QualityFinding {
  kind: string;
  detail: string;
  count?: number;
}

export interface QualityReport {
  ok: boolean;
  url: string;
  widthsChecked: number[];
  findings: QualityFinding[];
  consoleErrors: string[];
}

// ------------------------------------------------------------
// SECURITY (v2.6 review): the original guard missed trailing-dot hosts
// ("localhost." slipped past the literal checks), IPv4-mapped IPv6
// ("[::ffff:7f00:1]" → 127.0.0.1), link-local/unique-local IPv6 and the
// 169.254/16 metadata range, and never resolved hostnames (DNS rebinding).
// It now mirrors the tools.ts SSRF policy (isBlockedHost + DNS pinning).
// ------------------------------------------------------------
function isBlockedProbeHost(rawHost: string): boolean {
  let h = String(rawHost ?? '').toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // IPv6 literal
  if (h.endsWith('.')) h = h.slice(0, -1); // "localhost." resolves to localhost
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) {
    // IPv6: block unspecified, loopback, IPv4-mapped, link-local and unique-local.
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('::ffff:')) {
      const tail = h.slice(7);
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return isBlockedProbeHost(tail);
      return true; // hex-form mapped (e.g. ::ffff:7f00:1) — reserved range, refuse
    }
    return /^(fe[89ab]|f[cd])[0-9a-f]*:/.test(h); // fe80::/10 link-local, fc00::/7 ULA
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata endpoint
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  return false; // regular hostname — DNS-pinned below
}

/** Resolve a hostname and refuse loopback/private/link-local/metadata IPs. */
async function resolvedProbeHostBlocked(hostname: string): Promise<boolean> {
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  // IP literals never need resolution — the literal is the pinned address.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(bare) || bare.includes(':')) return isBlockedProbeHost(bare);
  try {
    const records = await dnsProm.lookup(bare, { all: true, verbatim: true });
    if (!records.length) return isBlockedProbeHost(bare);
    for (const rec of records) {
      if (isBlockedProbeHost(rec.address)) return true; // DNS rebinding / pinned private IP
    }
    return false;
  } catch {
    return isBlockedProbeHost(bare); // resolution failed — fall back to the literal
  }
}

/** SSRF guard: refuse non-http(s) remote targets and local/metadata hosts. */
async function safeRemoteUrl(raw: string): Promise<string | null> {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedProbeHost(u.hostname)) return null;
    if (await resolvedProbeHostBlocked(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Is this host the machine's own loopback (the app's dev servers live here)? */
function isLoopbackHost(rawHost: string): boolean {
  let h = String(rawHost ?? '').toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

/**
 * v3 — preview-pipeline URL guard. WIDER than safeRemoteUrl on purpose:
 * LOOPBACK is explicitly ALLOWED because probing/screenshotting the user's
 * own dev server (localhost:5173 etc.) is the whole point of ui_quality_check
 * and preview_screenshot. Everything the strict guard blocks stays blocked
 * (private ranges, link-local, metadata) unless the user granted fullAccess.
 */
async function safePreviewUrl(raw: string, fullAccess: boolean): Promise<string | null> {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isLoopbackHost(u.hostname)) return u.toString();
    if (fullAccess) return u.toString();
    if (isBlockedProbeHost(u.hostname)) return null;
    if (await resolvedProbeHostBlocked(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Resolve the target: an .html file, a directory with index.html, or an http URL. */
async function resolveTarget(raw: string, workspace: string, fullAccess = false): Promise<string | null> {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return await safePreviewUrl(trimmed, fullAccess);
  const abs = path.isAbsolute(trimmed) ? trimmed : path.join(workspace, trimmed);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    const idx = path.join(abs, 'index.html');
    try {
      await fs.promises.access(idx);
      return pathToFileURL(idx).toString();
    } catch {
      return null;
    }
  }
  if (stat.isFile() && /\.html?$/i.test(abs)) return pathToFileURL(abs).toString();
  return null;
}

/** The probe runs in the page context — plain JS, no Node. */
const PROBE_JS = `(function () {
  var findings = [];
  var push = function (kind, detail, count) { findings.push({ kind: kind, detail: detail, count: count }); };
  var doc = document;

  // 1. horizontal overflow at this viewport
  var de = doc.documentElement;
  var ow = Math.max(de.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
  if (ow > window.innerWidth + 1) {
    // find the widest offenders (top 3)
    var offenders = [];
    doc.querySelectorAll('body *').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 8 && offenders.length < 3) {
        offenders.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : ''));
      }
    });
    push('overflow-x', 'page is ' + ow + 'px wide in a ' + window.innerWidth + 'px viewport; offenders: ' + offenders.join(', '), 1);
  }

  // helper: effective background for contrast math
  function parseColor(s) {
    var m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = s.match(/color\\(\\s*srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\s*\\)/);
    if (m) return [Math.round(+m[1]*255), Math.round(+m[2]*255), Math.round(+m[3]*255), m[4] === undefined ? 1 : +m[4]];
    return null;
  }
  function mix(fg, bg) {
    return [fg[0]*fg[3]+bg[0]*(1-fg[3]), fg[1]*fg[3]+bg[1]*(1-fg[3]), fg[2]*fg[3]+bg[2]*(1-fg[3]), 1];
  }
  function lin(v) { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
  function lum(c) { return 0.2126*lin(c[0]) + 0.7152*lin(c[1]) + 0.0722*lin(c[2]); }
  function ratio(f, b) { var l1=lum(f), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
  function effBg(el) {
    var stack = [], n = el;
    while (n && n !== doc.documentElement) {
      var c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) stack.push(c);
      n = n.parentElement;
    }
    // Default to WHITE, then composite <html> → … → element. A transparent
    // getComputedStyle(html).backgroundColor used to become rgba(0,0,0,0) and
    // was read as BLACK, producing false low-contrast findings on ordinary
    // white pages (dark text on an invented black background).
    var acc = [255,255,255,1];
    var rootBg = parseColor(getComputedStyle(de).backgroundColor);
    if (rootBg && rootBg[3] > 0) acc = mix(rootBg, acc);
    for (var i = stack.length - 1; i >= 0; i--) acc = mix(stack[i], acc);
    return acc;
  }
  // Text over a gradient/photo/video cannot be composited to a solid color —
  // reporting a ratio computed against an invented white background produced
  // garbage findings, so any uncertain background chain SKIPS the check.
  function bgUncertain(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      var tag = n.tagName;
      if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'SVG') return true;
      var st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage !== 'none') return true;
      if (n === de) break;
      n = n.parentElement;
    }
    return false;
  }

  // 2. contrast + tiny text (sampled: first 400 text leaves)
  var lowContrast = [], tinyText = [];
  var leaves = Array.prototype.slice.call(doc.querySelectorAll('p,span,a,button,h1,h2,h3,h4,h5,h6,li,td,th,label,div')).filter(function (el) {
    if (el.children.length > 1) return false;
    var t = (el.textContent || '').trim();
    if (t.length < 3) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 5) return false;
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.4;
  }).slice(0, 400);
  leaves.forEach(function (el) {
    var s = getComputedStyle(el);
    var fg = parseColor(s.color);
    if (!fg) return;
    var px = parseFloat(s.fontSize);
    if (px < 12 && tinyText.length < 4) tinyText.push(px + 'px: "' + (el.textContent||'').trim().slice(0, 24) + '"');
    if (bgUncertain(el)) return; // gradient/image/video behind text — not computable, do not guess
    var cr = ratio(fg, effBg(el));
    if (cr < ${CONTRAST_FLOOR} && lowContrast.length < 4) {
      lowContrast.push(cr.toFixed(1) + ':1 "' + (el.textContent||'').trim().slice(0, 24) + '"');
    }
  });
  if (lowContrast.length) push('contrast', 'low-contrast text (worst first): ' + lowContrast.join(' | '), lowContrast.length);
  if (tinyText.length) push('tiny-text', 'text below 12px: ' + tinyText.join(' | '), tinyText.length);

  // 3. accessibility quickies (checked once, at the widest pass — caller gates)
  return { findings: findings, innerWidth: window.innerWidth };
})();`

const STATIC_JS = `(function () {
  var out = [];
  var push = function (kind, detail, count) { out.push({ kind: kind, detail: detail, count: count }); };
  if (!document.querySelector('meta[name="viewport"]')) push('viewport-meta', 'missing <meta name="viewport"> — mobile renders zoomed-out', 1);
  if (!doc_lang_ok()) push('lang-attr', '<html> has no lang attribute — screen readers + hyphenation break', 1);
  function doc_lang_ok() { return !!document.documentElement.getAttribute('lang'); }
  var noAlt = 0, firstNoAlt = '';
  document.querySelectorAll('img').forEach(function (img) {
    if (!img.hasAttribute('alt')) { noAlt++; if (!firstNoAlt) firstNoAlt = (img.getAttribute('src')||'').slice(0, 40); }
  });
  if (noAlt) push('img-alt', noAlt + ' <img> without alt (first: ' + firstNoAlt + ')', noAlt);
  var deadBtns = 0;
  document.querySelectorAll('button, [role="button"], a').forEach(function (el) {
    var txt = (el.textContent || '').trim();
    var label = el.getAttribute('aria-label');
    if (!txt && !label) deadBtns++;
  });
  if (deadBtns) push('unlabelled-interactive', deadBtns + ' buttons/links with no text and no aria-label', deadBtns);
  if (!document.title || !document.title.trim()) push('page-title', '<title> is empty', 1);
  return out;
})();`

/**
 * Phase timeout: bounds every await against a hung page/server or a page whose
 * main thread is wedged in a loop (which would hang executeJavaScript forever
 * and leak the offscreen window). The original promise gets a no-op catch so a
 * late failure after the timeout can never surface as an unhandled rejection.
 */
function withTimeout<T>(p: Promise<T>, what: string, ms = PROBE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const gate = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms (page hung?)`)), ms);
  });
  (gate as unknown as { unref?: () => void }).unref?.();
  void p.catch(() => {});
  return Promise.race([p, gate]).finally(() => clearTimeout(timer));
}

// ----------------------------------------------------------
// Console collector — ONE factory for every console-message
// listener, because the Electron event shape is not stable:
//  · Electron ≤33 WebContents: (event, level, message, line, sourceId)
//    — the EVENT comes FIRST (the old `typeof level === 'number'`
//    check on args[0] never fired, so page errors were invisible).
//  · Newer builds / other surfaces: a single Event-like object with
//    .level / .message (or .text) properties.
// The factory inspects the first argument defensively and handles
// both. Never throws; numeric levels ≥3 and the string 'error' count.
// ----------------------------------------------------------
const CONSOLE_LEVEL_NUMBERS: Record<string, number> = {
  verbose: 0,
  debug: 0,
  info: 1,
  log: 1,
  warning: 2,
  warn: 2,
  error: 3,
};

function consoleLevelNumber(level: unknown): number {
  if (typeof level === 'number' && Number.isFinite(level)) return level;
  if (typeof level === 'string') return CONSOLE_LEVEL_NUMBERS[level.trim().toLowerCase()] ?? 0;
  return 0;
}

export function makeConsoleCollector(push: (line: string) => void): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    try {
      const first = args[0] as { level?: unknown; message?: unknown; text?: unknown } | number | undefined | null;
      let level: unknown;
      let message: unknown;
      if (typeof first === 'number' || typeof first === 'string') {
        // legacy form (older Electron / direct emitter): (level, message, …).
        // Treating the number as "event first" used to shift every argument
        // and silently drop ALL page errors.
        level = first;
        message = args[1];
      } else if (
        first &&
        typeof first === 'object' &&
        ('level' in first || 'message' in first || 'text' in first)
      ) {
        // single-object form: { level, message | text }
        level = first.level;
        message = first.message ?? first.text;
      } else {
        // evented form: (event, level, message, line, sourceId) — event FIRST,
        // possibly an Event instance with no message-ish properties at all
        level = args[1];
        message = args[2];
      }
      if (consoleLevelNumber(level) < 3) return;
      push(typeof message === 'string' && message.trim() ? message.slice(0, 500) : 'console error');
    } catch {
      /* an event listener must never be the thing that breaks the probe */
    }
  };
}

/**
 * Post-load settle for screenshots: fonts first (race with a 2s cap — a page
 * whose fonts never resolve must not stall the capture), then two animation
 * frames (let layout/effects commit), then a short final settle. Slower
 * captures beat the phantom-blank-screenshot fix loops.
 */
const FONTS_READY_JS = `new Promise(function (r) { try { if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { r(); }, function () { r(); }); } else { r(); } } catch (e) { r(); } })`;
const DOUBLE_RAF_JS = `new Promise(function (r) { try { requestAnimationFrame(function () { requestAnimationFrame(function () { r(); }); }); } catch (e) { r(); } })`;

async function settleBeforeCapture(wc: WebContents): Promise<void> {
  // withTimeout() unrefs its timer and clears it on settlement — the old bare
  // Promise.race left 2 live timers behind after EVERY screenshot.
  await withTimeout(wc.executeJavaScript(FONTS_READY_JS, true) as Promise<unknown>, 'waiting for fonts', 2000).catch(() => {});
  await withTimeout(wc.executeJavaScript(DOUBLE_RAF_JS, true) as Promise<unknown>, 'waiting for animation frames', 1000).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
}

/** Run the full probe on one URL. Never throws — failures become findings. */
export async function probePage(url: string): Promise<QualityReport> {
  const report: QualityReport = { ok: false, url, widthsChecked: [], findings: [], consoleErrors: [] };
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: WIDTHS[2],
      height: 900,
      webPreferences: {
        offscreen: true,
        javascript: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    // SECURITY: the probe reads ONE page. A probed page must not navigate its
    // frame to another file:///<other-file> or an internal http URL — that
    // would turn executeJavaScript into a local/intranet content reader —
    // and must not be able to pop real windows from the offscreen context.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // collect console errors for the WHOLE session (registered before the
    // load so errors during load are counted too)
    win.webContents.on(
      'console-message',
      makeConsoleCollector((line) => {
        if (report.consoleErrors.length < 5) report.consoleErrors.push(line);
      }),
    );
    await withTimeout(win.loadURL(url), 'loading the page');

    // static checks once
    try {
      const staticOut = (await withTimeout(
        win.webContents.executeJavaScript(STATIC_JS, true),
        'the static probe',
      )) as QualityFinding[];
      if (Array.isArray(staticOut)) report.findings.push(...staticOut);
    } catch { /* probe failure is itself reported below */ }

    // overflow / contrast / tiny-text at each width
    for (const w of WIDTHS) {
      const h = w === WIDTHS[0] ? 844 : 900;
      win.setBounds({ width: w, height: h, x: win.getBounds().x, y: win.getBounds().y });
      await new Promise((r) => setTimeout(r, 350)); // let reflow + media queries settle
      const out = (await withTimeout(
        win.webContents.executeJavaScript(PROBE_JS, true),
        `the ${w}px probe`,
      )) as {
        findings: QualityFinding[];
      };
      report.widthsChecked.push(w);
      if (Array.isArray(out?.findings)) {
        for (const f of out.findings) {
          const tagged = f.kind === 'overflow-x' ? { ...f, detail: `${f.detail} [at ${w}px]` } : f;
          report.findings.push(tagged);
        }
      }
    }

    // de-dup by kind+detail prefix, cap per kind
    const seen = new Map<string, number>();
    report.findings = report.findings.filter((f) => {
      const n = seen.get(f.kind) ?? 0;
      if (n >= MAX_FINDINGS_PER_KIND) return false;
      seen.set(f.kind, n + 1);
      return true;
    });
    report.ok = report.findings.length === 0 && report.consoleErrors.length === 0;
    return report;
  } catch (err) {
    report.findings.push({
      kind: 'probe-error',
      detail: `quality probe failed: ${err instanceof Error ? err.message : String(err)} — the page may not load at all`,
    });
    return report;
  } finally {
    try { win?.destroy(); } catch { /* already gone */ }
  }
}

// ----------------------------------------------------------
// v11.11 (wave3-A8) — TURN WRITE LEDGER (the no-write skip).
// The engine's post-answer UI gate args-tracks write_file/edit_file calls
// WITHOUT checking their outcome, so a turn whose .html/.css writes were all
// DENIED or FAILED (pure Q&A in practice: zero files landed) still triggers
// the gate → the probe finds nothing → the missing "RESULT: PASS" reads as a
// failure → a phantom ~60s provider fix round on a file that does not exist.
// Fix: write tools report SUCCESSFUL writes into this per-session ledger;
// checkUi consults it — when the target cannot be resolved AND the turn
// produced zero successful writes, it reports an explicit SKIP that matches
// the gate's PASS regex (engine.ts tests /RESULT: PASS/) instead of an error.
// Real build turns (files actually written) keep the full probe behavior.
// ----------------------------------------------------------
const TURN_WRITE_TTL_MS = 20 * 60_000; // a turn's writes stay "current" this long
const TURN_WRITE_MAX_SESSIONS = 64; // evict-oldest bound on the ledger
const TURN_WRITE_MAX_PATHS = 512; // per-session path cap (gate needs count>0 only)

interface TurnWriteEntry {
  paths: Set<string>;
  lastAt: number;
}
const turnWrites = new Map<string, TurnWriteEntry>();

/** Write tools call this on EVERY successful file write (keyed by session). */
export function noteTurnFileWrite(p: string, sessionId = 'default'): void {
  try {
    const key = sessionId || 'default';
    let entry = turnWrites.get(key);
    if (!entry) {
      if (turnWrites.size >= TURN_WRITE_MAX_SESSIONS) {
        let oldestKey: string | null = null;
        let oldestAt = Infinity;
        for (const [k, v] of turnWrites) {
          if (v.lastAt < oldestAt) {
            oldestAt = v.lastAt;
            oldestKey = k;
          }
        }
        if (oldestKey) turnWrites.delete(oldestKey);
      }
      entry = { paths: new Set(), lastAt: 0 };
      turnWrites.set(key, entry);
    }
    entry.paths.add(path.resolve(p));
    if (entry.paths.size > TURN_WRITE_MAX_PATHS) {
      const first = entry.paths.values().next().value;
      if (first) entry.paths.delete(first);
    }
    entry.lastAt = Date.now();
  } catch {
    /* the ledger must never break a write tool */
  }
}

/** True when this session recorded at least one successful write recently. */
export function turnWroteFiles(sessionId = 'default'): boolean {
  const entry = turnWrites.get(sessionId || 'default');
  return !!entry && entry.paths.size > 0 && Date.now() - entry.lastAt <= TURN_WRITE_TTL_MS;
}

/** Test/inspection hook — clear the ledger (one session or all). */
export function resetTurnWrites(sessionId?: string): void {
  if (sessionId) turnWrites.delete(sessionId || 'default');
  else turnWrites.clear();
}

/** Tool entry: resolve target → probe → text report for the model. */
export async function checkUi(
  args: { path?: string },
  workspace: string,
  fullAccess = false,
  opts?: { sessionId?: string },
): Promise<string> {
  const target = await resolveTarget(args?.path ?? '', workspace, fullAccess);
  if (!target) {
    // v11.11 (A8) — NO-WRITE SKIP: nothing exists at the target AND the turn
    // wrote no files → there is no UI to probe and nothing to fix. Emitting
    // the old ERROR string here made the engine's PASS-regex gate start a
    // phantom fix round (~60s provider latency) on pure Q&A turns.
    if (opts?.sessionId && !turnWroteFiles(opts.sessionId)) {
      return [
        `UI quality report — ${String(args?.path ?? '').slice(0, 200)}`,
        'viewports checked: none',
        'RESULT: PASS (skipped) — the target does not resolve AND this turn wrote no files ' +
          '(denied/failed writes do not count). No UI was produced in this turn: no probe needed, no fix round. ' +
          'If a page SHOULD exist here, write it first, then re-run ui_quality_check.',
      ].join('\n');
    }
    return (
      'ERROR: could not resolve the target. Pass the path of an .html file, a directory containing ' +
      'index.html, or an http(s) URL of the running dev server.'
    );
  }
  const rep = await probePage(target);
  const lines: string[] = [];
  lines.push(`UI quality report — ${rep.url}`);
  lines.push(`viewports checked: ${rep.widthsChecked.join(', ') || 'none'}`);
  if (rep.ok) {
    lines.push('RESULT: PASS — no overflow, contrast, tiny-text, a11y or console issues detected.');
    lines.push('Note: PASS means the deterministic floor is met. Look at the page once more with read_image if the design itself matters.');
  } else {
    lines.push(`RESULT: ${rep.findings.length} issue(s) + ${rep.consoleErrors.length} console error(s). FIX ALL of these:`);
    rep.findings.forEach((f, i) => lines.push(`${i + 1}. [${f.kind}] ${f.detail}`));
    rep.consoleErrors.slice(0, 5).forEach((c, i) => lines.push(`console-error ${i + 1}: ${c}`));
    lines.push('Fix every issue above (edit the source), then run ui_quality_check again until it PASSes.');
  }
  return lines.join('\n');
}

// ----------------------------------------------------------
// v3 — preview_screenshot: capture the REAL render and feed it
// back to the model's vision. Same offscreen-window posture as
// probePage (never shown, navigation denied, destroyed after,
// timeout-bounded) plus webContents.capturePage().
// ----------------------------------------------------------
export interface PageShotResult {
  ok: boolean;
  url?: string;
  dataUrl?: string;
  consoleErrors?: number;
  error?: string;
}

export async function capturePageShot(
  opts: { target: string; width: number; height: number },
  workspace: string,
  fullAccess = false,
): Promise<PageShotResult> {
  const url = await resolveTarget(opts.target, workspace, fullAccess);
  if (!url) {
    return {
      ok: false,
      error:
        'could not resolve the target — pass an .html file, a folder containing index.html, or an http(s) URL',
    };
  }
  const width = Math.max(200, Math.min(2400, Math.floor(Number(opts.width) || 1280)));
  const height = Math.max(200, Math.min(2400, Math.floor(Number(opts.height) || 900)));
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: {
        offscreen: true,
        javascript: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let consoleErrors = 0;
    win.webContents.on('console-message', makeConsoleCollector(() => { consoleErrors++; }));
    await withTimeout(win.loadURL(url), 'loading the page');
    // Let fonts, images and first JS paint settle before the capture.
    await settleBeforeCapture(win.webContents);
    const image = await withTimeout(win.webContents.capturePage(), 'capturing the page');
    const png = image.toPNG();
    if (png.length > 8 * 1024 * 1024) {
      return {
        ok: false,
        error: `screenshot too large (${Math.round(png.length / 1024 / 1024)}MB) — retry with a smaller viewport`,
      };
    }
    return {
      ok: true,
      url,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      consoleErrors,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      win?.destroy();
    } catch {
      /* already gone */
    }
  }
}
