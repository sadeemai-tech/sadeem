// SADEEM — integrated terminal (xterm.js) bound to a main-process PTY session.
// Header: mono label + workspace (cwd) chip + interrupt/clear. The xterm
// palette is derived from the live CSS variables so every SADEEM theme
// renders correctly: accent cursor, functional ANSI roles (ok/warn/bad),
// agent violet in the magenta slot only, ink foreground, transparent
// background over the recessed --bg1 well.
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Eraser, OctagonX, ShieldAlert, Terminal as TerminalIcon, X } from 'lucide-react';
import { api } from '../lib/api';
import { ensureTerminalSession, useStore } from '../store';
import { makeT, useT } from '../i18n';
import { pushToast } from './Toasts';
import { IconBtn } from './ui';
import './chat-final.css';

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Theme-coherent xterm palette built from the live SADEEM tokens.
 *  Classic ANSI roles keep their semantics, tinted with the family:
 *  red→--bad green→--ok yellow→--warn blue→--acc2 magenta→--agent
 *  cyan→--acc, neutrals from the ink ramp. */
function buildXtermTheme(): Record<string, string> {
  return {
    background: '#00000000', // the container paints the recessed --bg1 well
    foreground: cssVar('--ink', '#F2F2F2'),
    cursor: cssVar('--acc', '#A3E635'),
    cursorAccent: cssVar('--acc-ink', '#0B0D02'), // text under the block cursor
    selectionBackground: cssVar('--sel', 'rgba(163, 230, 53, 0.24)'),
    // classic ANSI slots — SADEEM hues, readable roles
    black: cssVar('--bg1', '#1A1A1A'),
    red: cssVar('--bad', '#FFFFFF'),
    green: cssVar('--ok', '#A3E635'),
    yellow: cssVar('--warn', '#BFBFBF'),
    blue: cssVar('--acc2', '#A8A8A8'),
    magenta: cssVar('--agent', '#8F8F8F'),
    cyan: cssVar('--acc', '#A3E635'),
    white: cssVar('--dim', '#A9A9A9'),
    brightBlack: cssVar('--faint', '#787878'),
    brightRed: cssVar('--bad', '#FFFFFF'),
    brightGreen: cssVar('--ok', '#A3E635'),
    brightYellow: cssVar('--warn', '#BFBFBF'),
    brightBlue: cssVar('--acc2', '#A8A8A8'),
    brightMagenta: cssVar('--agent', '#8F8F8F'),
    brightCyan: cssVar('--acc', '#A3E635'),
    brightWhite: cssVar('--ink', '#F2F2F2'),
  };
}

/** Lime prompt arrow, tinted live from --acc. */
function termPrompt(): string {
  const acc = truecolor(cssVar('--acc', '#A3E635'));
  return `\x1b[38;2;${acc ?? '163;230;53'}m❯\x1b[0m `;
}

/** "#rrggbb" → "r;g;b" (for a truecolor SGR escape); null when unparsable. */
function truecolor(css: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

export function TerminalView() {
  const t = useT();
  const terminalId = useStore((s) => s.terminalId);
  const wsPath = useStore((s) => s.wsPath);
  const theme = useStore((s) => s.settings.theme);
  const termFontSize = useStore((s) => s.settings.terminalFontSize);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const bufferRef = useRef('');
  const pendingPrompt = useRef(false); // awaiting command completion → draw prompt

  // ---- E4 terminal guard: inline blocked banner + blocked-commands counter --
  const [blocked, setBlocked] = useState<{ cmd: string; reasons: string[] } | null>(null);
  const [blockedCount, setBlockedCount] = useState(0);

  const allowOnce = async () => {
    if (!blocked) return;
    const cmd = blocked.cmd;
    try {
      await api.termAllowOnce(cmd);
      pushToast({ title: t('term.allowed', 'Allowed once — re-run the command'), severity: 'success', duration: 3000 });
    } catch {
      pushToast({ title: t('term.allowFail', 'Could not whitelist the command'), severity: 'error' });
    }
    setBlocked(null);
  };

  useEffect(() => {
    if (!api.onTermBlocked) return;
    const unsub = api.onTermBlocked((e) => {
      setBlocked({ cmd: e.cmd, reasons: Array.isArray(e.reasons) ? e.reasons : [] });
      setBlockedCount((c) => c + 1);
      // mirror the block into the scrollback (red mono, then a fresh prompt)
      const bad = truecolor(cssVar('--bad', '#FFFFFF'));
      termRef.current?.write(`\r\n\x1b[38;2;${bad ?? '255;104;120'}m■ blocked: ${e.cmd}\x1b[0m\r\n`);
      pendingPrompt.current = false;
      termRef.current?.write(termPrompt());
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api.onTermWarn) return;
    const unsub = api.onTermWarn((e) => {
      pushToast({
        title: `${t('term.warn', 'Command flagged')}: ${e.cmd}`,
        severity: 'warn',
        duration: 2600,
      });
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep latest session id reachable from stable callbacks
  useEffect(() => {
    idRef.current = terminalId;
  }, [terminalId]);

  // Ensure a PTY session exists on mount. Uses the SAME de-duplicated helper
  // as toggleTerminal() — never a second termCreate while the first is still
  // in flight (the old twin creates could race and orphan a PTY session).
  useEffect(() => {
    void ensureTerminalSession();
  }, []);

  // xterm bootstrap (once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize: useStore.getState().settings.terminalFontSize,
      fontFamily: cssVar("--font-mono-x", "'IBM Plex Mono', Menlo, Consolas, monospace"),
      theme: buildXtermTheme(),
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    termRef.current = term;
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* container not measurable yet */
    }
    // xterm does not focus its textarea on open() — without this the first
    // typed command is swallowed. Never steal focus from an open overlay.
    if (!document.querySelector('[data-modal-open="true"]')) term.focus();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore transient layout errors */
      }
    });
    ro.observe(container);

    // banner + first prompt (banner tinted with the live --faint color)
    const dim = truecolor(cssVar('--faint', '#787878'));
    const banner = makeT(useStore.getState().settings.language ?? 'en')('terminal-banner', 'SADEEM terminal');
    const label = `\x1b[38;2;${dim ?? '124;141;161'}m${banner}\x1b[0m`;
    term.writeln(`${label} — ${t('term.hint')}`);
    term.write(termPrompt());

    // local line editing (append-only buffer; main echoes output raw).
    // v11.10 — while a command is RUNNING the keystrokes are forwarded to the
    // child's stdin (api.termWrite): npm init / create-* prompts and REPLs
    // become answerable. At the prompt the same keys edit the local buffer.
    const dataSub = term.onData((d) => {
      const id = idRef.current;
      if (d === '\r') {
        const cmd = bufferRef.current;
        bufferRef.current = '';
        term.write('\r\n');
        pendingPrompt.current = true; // prompt is drawn when the command completes
        if (id && cmd.trim()) void api.termExec(id, cmd);
      } else if (d === '\x7f') {
        if (pendingPrompt.current) {
          // program is reading stdin — backspace rides through as well
          if (id) void api.termWrite?.(id, '\x7f');
        } else if (bufferRef.current.length > 0) {
          bufferRef.current = bufferRef.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (d === '\x03') {
        if (id) void api.termInterrupt(id);
        bufferRef.current = '';
      } else if (d >= ' ') {
        if (pendingPrompt.current) {
          term.write(d); // echo what the program will see
          if (id) void api.termWrite?.(id, d);
        } else {
          bufferRef.current += d;
          term.write(d);
        }
      }
    });

    return () => {
      ro.disconnect();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live PTY output — the single '\r\n' emitted by main on command close
  // is the signal to draw the next prompt.
  useEffect(() => {
    if (!api.onTerminal) return;
    const unsub = api.onTerminal((e) => {
      if (e.terminalId !== idRef.current) return;
      if (e.data === '\r\n' && pendingPrompt.current) {
        pendingPrompt.current = false;
        termRef.current?.write(termPrompt());
      } else {
        termRef.current?.write(e.data);
      }
    });
    return () => {
      unsub();
    };
  }, []);

  // live font-size updates from settings
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = termFontSize;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [termFontSize]);

  // re-tint the terminal palette when the app theme changes — and when the
  // accent tint changes (v3: --acc feeds the cursor/selection colors, so a
  // theme-only dependency left stale accent colors on screen until reload).
  const accent = useStore((s) => s.settings.ui?.accent);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = buildXtermTheme();
  }, [theme, accent]);

  return (
    <div className="h-full w-full flex flex-col min-h-0" role="region" aria-label={t('term.title', 'Terminal')}>
      {/* FINAL POLISH — refined mono header strip. The connection LED is
          real: on when a PTY id exists, pending while it is still being
          created. xterm itself is completely untouched. */}
      <div className="tm-strip">
        <span className="tm-eyebrow">{t('term.stripEyebrow', 'PTY / SESSION')}</span>
        <span className={`tm-led ${terminalId ? 'is-on' : 'is-pending'}`} aria-hidden />
        <span className="tm-title" title={t('term.title')}>
          <TerminalIcon size={11} className="text-acc shrink-0 me-1" style={{ verticalAlign: '-1px' }} aria-hidden />
          {t('term.title')}
        </span>
        {wsPath && (
          <span className="tm-path" title={wsPath}>
            <span dir="ltr">{base(wsPath)}</span>
          </span>
        )}
        {/* blocked-commands counter pill (E4 terminal guard) */}
        {blockedCount > 0 && (
          <span
            className="glass-pill !h-[22px] !px-2 !text-[9.5px] text-bad shrink-0"
            style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--bad) 40%, transparent)' }}
            title={t('term.blockedCount', 'Commands blocked by the guard this session')}
          >
            {`${blockedCount} BLOCKED`}
          </span>
        )}
        <div className="flex-1" />
        <IconBtn
          className="!w-7 !h-7"
          title={t('term.interrupt')}
          aria-label={t('term.interrupt')}
          onClick={() => {
            bufferRef.current = '';
            if (terminalId) void api.termInterrupt(terminalId);
          }}
        >
          <OctagonX size={13} />
        </IconBtn>
        <IconBtn
          className="!w-7 !h-7"
          title={t('term.clear')}
          aria-label={t('term.clear')}
          onClick={() => {
            termRef.current?.clear();
            bufferRef.current = '';
          }}
        >
          <Eraser size={13} />
        </IconBtn>
      </div>
      {/* inline blocked banner (.fhdr red variant) — ALLOW ONCE whitelists */}
      {blocked && (
        <div className="sc-blocked" role="alert">
          <div className="fhdr">
            <ShieldAlert size={12} className="shrink-0" />
            <span className="uppercase tracking-widest shrink-0">{t('term.blocked', 'BLOCKED BY GUARD')}</span>
            <span className="font-code truncate min-w-0" dir="ltr" title={blocked.cmd}>
              {blocked.cmd}
            </span>
            <button
              className="btn !h-[22px] !px-2 !text-[10.5px] ms-auto shrink-0"
              onClick={() => void allowOnce()}
            >
              {t('term.allowOnce', 'ALLOW ONCE')}
            </button>
            <button
              className="ibtn !w-8 !h-8 !-my-1.5 shrink-0"
              onClick={() => setBlocked(null)}
              aria-label={t('toast.dismiss', 'Dismiss')}
              title={t('toast.dismiss', 'Dismiss')}
            >
              <X size={12} />
            </button>
          </div>
          {blocked.reasons.length > 0 && (
            <div className="sc-blocked-reasons">
              {blocked.reasons.map((r, i) => (
                <span key={i} dir="ltr">
                  · {r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden bg-[var(--bg1)]"
        dir="ltr"
        style={{ padding: '6px 8px 8px' }}
      />
    </div>
  );
}

export default TerminalView;
