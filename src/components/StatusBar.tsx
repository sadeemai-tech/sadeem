// SADEEM — status strip, SADEEM DESIGN SYSTEM v10: a flat matte strip (30px).
// Every chip from the SURVEYOR strip survives — state LED + session name, git
// branch + changed-count, task-mode & permission pills, subagent/todo
// progress, queue, DNA, transient notice, context-ring popover
// (model/context/segments/cost/compact), free-season chip, MCP tools, preview
// toggle, honest False-Done chip, live perf, terminal toggle, language chip.
// Chips render as compact pills (local .sbx-pill, defined in this file)
// separated by hairline dots; the @container statusbar overflow contract
// (.glass-strip + .sb-secondary) is preserved untouched. Logical layout only
// (gap/flex) — RTL-safe.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IcWarn, IcPreview, IcBranchMini, IcGlobe, IcMcp, IcShield, IcSpark, IcZap, IcDna } from './icons';
import { TerminalSquare, Timer } from 'lucide-react';
import { useStore, PROVIDER_PRESETS } from '../store';
import { api } from '../lib/api';
import { PERMISSION_MODES, TASK_MODES, TASK_MODE_DESC, nextIn } from '../lib/modes';
import { useT, useDigits } from '../i18n';
import type { PermissionMode, TaskMode } from '../../shared/types';
import './workspace.css';

const MODE_LABEL_KEY: Record<PermissionMode, string> = {
  plan: 'tb.mode.plan',
  default: 'tb.mode.default',
  autoEdit: 'tb.mode.autoEdit',
  fullAccess: 'tb.mode.fullAccess',
};
const MODE_LABEL_FB: Record<PermissionMode, string> = {
  plan: 'Plan',
  default: 'Ask',
  autoEdit: 'Auto-edit',
  fullAccess: 'Full access',
};
const MODE_DESC_KEY: Record<PermissionMode, string> = {
  plan: 'tb.mode.plan.desc',
  default: 'tb.mode.default.desc',
  autoEdit: 'tb.mode.autoEdit.desc',
  fullAccess: 'tb.mode.fullAccess.desc',
};
const MODE_DESC_FB: Record<PermissionMode, string> = {
  plan: 'Read-only research, then proposes a plan',
  default: 'Ask before every write or command',
  autoEdit: 'Auto-approve file edits, ask for commands',
  fullAccess: 'Approve everything automatically',
};
// v7.2 — task-mode stamps use the shared i18n keys (BUILD/PLAN/DEBUG/REVIEW
// in EN, natural Arabic in AR) instead of raw `taskMode.toUpperCase()`.
const TASK_MODE_KEY: Record<TaskMode, string> = {
  build: 'comp.mode.build',
  plan: 'comp.mode.plan',
  debug: 'comp.mode.debug',
  review: 'comp.mode.review',
};
const TASK_MODE_DESC_KEY: Record<TaskMode, string> = {
  build: 'comp.mode.build.desc',
  plan: 'comp.mode.plan.desc',
  debug: 'comp.mode.debug.desc',
  review: 'comp.mode.review.desc',
};

/** "Anthropic (Claude)" -> "Anthropic" for compact status-bar display. */
const shortProvider = (label: string): string => label.replace(/\s*\(.*\)$/, '').trim();

export function StatusBar() {
  const t = useT();
  const n = useDigits();
  const mode = useStore((s) => s.settings.permissionMode);
  const model = useStore((s) => s.settings.model);
  const lang = useStore((s) => s.settings.language);
  const git = useStore((s) => s.git);
  const notice = useStore((s) => s.notice);
  const usage = useStore((s) => s.sessionUsage);
  const plan = useStore((s) => s.license.plan);
  // v11.6 — guest pass status pill (guest sessions show days left)
  const account = useStore((s) => s.account);
  const isGuest = account?.id === 'guest';
  const [guestDays, setGuestDays] = useState<number | null>(null);
  const setSettings = useStore((s) => s.setSettings);
  useEffect(() => {
    if (!isGuest) return;
    let alive = true;
    api
      .authGuestStatus()
      .then((g) => {
        if (alive && g?.active) setGuestDays(g.daysLeft);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isGuest]);
  const usageLog = useStore((s) => s.settings.usageLog);
  const previewOpen = useStore((s) => s.previewOpen);
  const previewStatus = useStore((s) => s.previewStatus);
  const rail = useStore((s) => s.rail);
  const running = useStore((s) => s.running);
  const session = useStore((s) => s.session);
  const taskMode = useStore((s) => s.taskMode);
  const setTaskMode = useStore((s) => s.setTaskMode);
  const subagentProgress = useStore((s) => s.subagentProgress);
  const queuedCount = useStore((s) => s.queuedCount);
  const ctxWindow = useStore((s) => s.ctxWindow);
  const setCtxWindow = useStore((s) => s.setCtxWindow);
  const setMode = useStore((s) => s.setMode);
  const setRail = useStore((s) => s.setRail);
  const setLang = useStore((s) => s.setLang);
  const setPlans = useStore((s) => s.setPlans);
  // v11.31 — every status chip that navigates to a stage rail must first
  // dismiss the transient live-preview overlay (App paints it above every
  // stage). Without this, git / DNA / MCP / usage / perf chips looked dead
  // whenever preview was open — the same class of bug the rail fixed.
  const setPreviewOpen = useStore((s) => s.setPreviewOpen);
  const goRail = (v: Parameters<typeof setRail>[0]): void => {
    setPreviewOpen(false);
    setRail(v);
  };
  const togglePreview = useStore((s) => s.togglePreview);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const clearNotice = useStore((s) => s.clearNotice);
  const dnaStats = useStore((s) => s.dnaStats);
  const dna = useStore((s) => s.dna);
  // v8.1 — todo list pushed by the engine's todo events (task progress stamp)
  const todos = useStore((s) => s.todos);

  const nextMode = nextIn(PERMISSION_MODES, mode);
  const nextTask = nextIn(TASK_MODES, taskMode);

  // ---- agent state LED: running (blink) · error (red) · idle (dim) ----
  const agentErrored = useMemo(() => {
    const msgs = session?.messages;
    if (!msgs || msgs.length === 0) return false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i].model === 'error';
    }
    return false;
  }, [session?.messages]);
  const ledCls = running ? 'led' : agentErrored ? 'led led-bad' : 'led led-idle';

  // ---- context window: fetched once per model, shared via the store ----
  useEffect(() => {
    let alive = true;
    api
      .modelInfo(model.model)
      .then((info) => {
        if (alive) {
          setCtxWindow(info.contextWindow || 0);
          // v11.10 (A5) — honesty flag: unknown model ⇒ 200k default shown "≈".
          useStore.getState().setCtxWindowEstimated(info.ctxEstimated === true);
        }
      })
      .catch(() => {
        if (alive) {
          setCtxWindow(0);
          useStore.getState().setCtxWindowEstimated(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [model.model, setCtxWindow]);

  // free-plan daily run counter (same UTC-day convention as the store)
  const todayRuns = useMemo(() => {
    if (plan !== 'free') return 0;
    const key = new Date().toISOString().slice(0, 10);
    return usageLog.find((e) => e.date === key)?.runs ?? 0;
  }, [plan, usageLog]);

  // ---- MCP tools summary: fetch once + refresh every 60s (and when the MCP
  // rail view opens, so reconnects are reflected immediately) ----
  const [mcpTools, setMcpTools] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await api.mcpServersGet();
        if (alive) setMcpTools(res.totalTools);
      } catch {
        if (alive) setMcpTools(null); // backend unavailable (e.g. browser dev)
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  useEffect(() => {
    if (rail !== 'mcp') return;
    let alive = true;
    api
      .mcpServersGet()
      .then((res) => {
        if (alive) setMcpTools(res.totalTools);
      })
      .catch(() => {
        /* keep last value */
      });
    return () => {
      alive = false;
    };
  }, [rail]);

  // ---- live app performance: CPU% + RAM MB, polled every 5s ----
  const [perf, setPerf] = useState<{ cpu: number; ram: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const m = await api.appMetrics();
        if (alive) setPerf({ cpu: m.cpuPercent, ram: m.memoryMB });
      } catch {
        if (alive) setPerf(null);
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 5_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // ---- v8.1 honest False-Done Rate: fetch once on mount + refresh every 60s.
  // Career-long persisted ledger (kdx:metrics:honesty). Rendered only when
  // there is claimed data — no invented 0% on an empty ledger.
  const [fd, setFd] = useState<{ claimed: number; falseDone: number; rate: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await api.metricsHonesty();
        if (alive && res?.falseDone) setFd(res.falseDone);
      } catch {
        if (alive) setFd(null); // backend unavailable (e.g. browser dev)
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // preview chip state
  const previewRunning = Boolean(previewStatus?.dev.running || previewStatus?.static.running);
  const previewKind = previewStatus?.dev.running
    ? 'dev'
    : previewStatus?.static.running
      ? 'static'
      : null;

  // ---- subagent aggregate (SUBAGENTS 2/5) ----
  const sg = useMemo(() => {
    const entries = Object.values(subagentProgress);
    if (entries.length === 0) return null;
    const done = entries.reduce((a, e) => a + (e.total > 0 && e.done >= e.total ? 1 : 0), 0);
    return { done, total: entries.length };
  }, [subagentProgress]);

  // ---- todo/task progress (todo events): completed count + fill percent ----
  const todosDone = useMemo(
    () => todos.reduce((a, td) => a + (td.status === 'completed' ? 1 : 0), 0),
    [todos],
  );
  const todosPct = todos.length > 0 ? Math.round((todosDone / todos.length) * 100) : 0;

  return (
    <>
      {/* AURORA pill voice — one local class shapes every chip/stamp into a
          pill; defined here because styles.css is owned by another agent.
          The .glass-strip container + .sb-secondary overflow contract below
          is untouched. */}
      <style>{`
        .sbx-pill { border-radius: var(--radius-pill); }
        .sbx-pill.stamp { padding-inline: 11px; }
      `}</style>
      <footer
        // v8 — flex-wrap: truncated pills fall to a second row instead of
        // clipping (each pill also carries a title tooltip).
        // v11.8 — quieter voice: 11.5px base, --faint meta, hairline top.
        // v11.10 (A8) de-density: px-4 + gap-3 (was px-3 + gap-2.5) — one
        // notch more air; the 30px strip height contract is untouched.
        className="glass-strip relative min-h-[30px] shrink-0 text-[11.5px] text-faint px-4 py-1 flex items-center gap-3 flex-wrap select-none min-w-0"
        style={{ borderTop: '1px solid var(--line-soft)' }}
        role="status"
      >
      {/* ---------- left: agent state LED + session ---------- */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <span
          className={`${ledCls} shrink-0`}
          aria-label={t(
            'sb.led.state',
            running
              ? lang === 'ar' ? 'الوكيل يعمل' : 'agent running'
              : agentErrored
                ? lang === 'ar' ? 'خطأ في الوكيل' : 'agent error'
                : lang === 'ar' ? 'الوكيل خامل' : 'agent idle',
          )}
        />
        <span className="sc-sb-name" title={session?.title ?? ''}>
          {session?.title ?? t('chat.new', 'no session')}
        </span>
      </div>

      <span className="sb-sep" aria-hidden />

      {/* git branch + changed count */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <button
          data-testid="status-git"
          className="chip sbx-pill !h-[20px] max-w-[18ch] overflow-hidden cursor-pointer"
          title={git ? `${t('sb.branch', 'branch')}: ${git.branch}` : t('sb.noRepo', 'no git repo')}
          onClick={() => goRail('git')}
        >
          <IcBranchMini size={11} className="shrink-0" />
          {git ? (
            <span className="truncate min-w-0">{git.branch}</span>
          ) : (
            <span className="whitespace-nowrap">{t('sb.noRepo', 'no git repo')}</span>
          )}
        </button>
        {git && git.changed.length > 0 && (
          <button
            className="chip chip-warn sbx-pill !h-[20px] cursor-pointer"
            title={t('sb.changed', '{n} changed files').replace('{n}', String(git.changed.length))}
            onClick={() => goRail('git')}
          >
            <span className="bidi-num whitespace-nowrap tnum" dir="ltr">
              {n(git.changed.length)} {t('sb.changedShort', 'changed')}
            </span>
          </button>
        )}
      </div>

      <span className="sb-sep" aria-hidden />

      {/* ---------- mid: task mode · permission · subagents · queue ---------- */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          className="stamp sbx-pill !h-[18px] !text-[9px] cursor-pointer hover:!border-[color-mix(in_srgb,var(--acc)_45%,transparent)]"
          title={t(TASK_MODE_DESC_KEY[taskMode], TASK_MODE_DESC[taskMode])}
          onClick={() => setTaskMode(nextTask)}
        >
          {t(TASK_MODE_KEY[taskMode], taskMode.toUpperCase())}
        </button>
        <button
          className="chip sbx-pill !h-[20px] cursor-pointer"
          title={t(MODE_DESC_KEY[mode], MODE_DESC_FB[mode])}
          onClick={() => setMode(nextMode)}
        >
          <IcShield size={11} className="shrink-0" />
          <span className="whitespace-nowrap">{t(MODE_LABEL_KEY[mode], MODE_LABEL_FB[mode])}</span>
        </button>
        {sg && (
          <button
            type="button"
            data-testid="status-subagents"
            className="stamp sbx-pill !h-[18px] !text-[9px] tnum cursor-pointer hover:!border-[color-mix(in_srgb,var(--acc)_45%,transparent)]"
            dir="ltr"
            title={t('rail.subagents', 'Subagents')}
            aria-label={t('rail.subagents', 'Subagents')}
            onClick={() => goRail('subagents')}
          >
            {`SUBAGENTS ${sg.done}/${sg.total}`}
          </button>
        )}
        {/* v8.1 — task progress: <done>/<total> + 40px micro bar (--acc);
            rendered only while a todo list is live (todo events) */}
        {todos.length > 0 && (
          <span
            className="stamp sbx-pill !h-[18px] !text-[9px] tnum"
            dir="ltr"
            title={t('sb.tasks.tip', 'Task progress — {d} of {t} done', { d: todosDone, t: todos.length })}
            aria-label={t('sb.tasks.tip', 'Task progress — {d} of {t} done', { d: todosDone, t: todos.length })}
          >
            {`TASKS ${n(todosDone)}/${n(todos.length)}`}
            <span
              aria-hidden
              className="shrink-0"
              style={{
                display: 'inline-block',
                width: 40,
                height: 3,
                borderRadius: 2,
                background: 'var(--line-strong, var(--line))',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${todosPct}%`,
                  height: '100%',
                  background: 'var(--acc)',
                  // v11.31 — precision easing: same shared curve the rest of
                  // the shell uses, so the fill settles without a linear drift.
                  transition: 'width .28s var(--ease-out)',
                }}
              />
            </span>
          </span>
        )}
        {queuedCount > 0 && (
          <span className="stamp stamp-acc sbx-pill !h-[18px] !text-[9px] tnum" dir="ltr" title={t('chat.queuedHint', 'Queued messages')}>
            {`QUEUE ${queuedCount}`}
          </span>
        )}
        {/* v2.2 SADEEM DNA — learned pattern count; hidden until something is learned */}
        {(dnaStats?.factsRecorded ?? dnaStats?.patterns ?? dna?.patterns.length ?? 0) > 0 && (
          <button
            className="chip chip-acc sbx-pill !h-[20px] cursor-pointer"
            title={t('sb.dnaTip', 'SADEEM DNA — {n} facts learned · {a}/{c} active · open the map')
              .replace('{n}', String(dnaStats?.factsRecorded ?? dnaStats?.patterns ?? 0))
              .replace('{a}', String(dnaStats?.patterns ?? 0))
              .replace('{c}', String(dnaStats?.patternCap ?? 60))}
            onClick={() => goRail('dna')}
          >
            <IcDna size={11} className="shrink-0" />
            <span className="whitespace-nowrap">
              {t('sb.dna', 'DNA')}{' '}
              <span className="bidi-num tnum" dir="ltr">{n(dnaStats?.factsRecorded ?? dnaStats?.patterns ?? dna?.patterns.length ?? 0)}</span>
            </span>
          </button>
        )}
      </div>

      {/* transient notice (problems area) — ellipsized, never pushes the row wide */}
      <div className="sb-mid flex-1 flex justify-center min-w-0">
        {notice && (
          <button
            className="chip chip-warn sbx-pill !h-[20px] max-w-full min-w-0 overflow-hidden cursor-pointer"
            title={notice}
            onClick={clearNotice}
          >
            <IcWarn size={11} className="shrink-0" />
            <span className="truncate min-w-0">{notice}</span>
          </button>
        )}
      </div>

      {/* ---------- right cluster ----------
          v11.21 — the context ring was MOVED to the composer, beside the mic.
          No second (or third) copy is mounted here or in the chat header. */}
      <div className="flex items-center gap-3 shrink-0 ms-auto flex-wrap justify-end">

        {/* v11.6 — guest pass countdown pill: visible only in guest mode;
            click opens Settings → Account where sign-in is one click. */}
        {account?.id === 'guest' && (
          <button
            className="chip sbx-pill !h-[20px] cursor-pointer sb-secondary"
            title={t('status.guestPass', lang === 'ar' ? 'وضع الضيف — اضغط لإدارة الحساب' : 'Guest pass — click to manage the account')}
            aria-label={t('status.guestPass', lang === 'ar' ? 'وضع الضيف' : 'Guest pass')}
            onClick={() => setSettings(true, 'account')}
          >
            <Timer size={11} className="shrink-0" />
            <span
              className="bidi-num whitespace-nowrap tnum"
              dir="ltr"
              style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
            >
              {lang === 'ar' ? `ضيف · ${guestDays ?? '…'} يوم` : `GUEST · ${guestDays ?? '…'}d`}
            </span>
          </button>
        )}

        {/* v2.4 free season — neutral informative chip (the old /15 paywall
            counter is gone): today's runs + the season badge; click opens Plans. */}
        {plan === 'free' && (
          <button
            className="chip sbx-pill !h-[20px] cursor-pointer sb-secondary"
            title={t('billing.free.badge', 'FREE SEASON')}
            aria-label={t('billing.free.badge', 'FREE SEASON')}
            onClick={() => setPlans(true)}
          >
            <IcZap size={11} className="shrink-0" />
            <span
              className="bidi-num whitespace-nowrap tnum"
              dir="ltr"
              style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
            >
              {n(todayRuns)} · {t('billing.free.badge', 'FREE SEASON')}
            </span>
          </button>
        )}

        {/* MCP tools summary */}
        {mcpTools !== null && (
          <button
            data-testid="status-mcp"
            className={`chip sbx-pill !h-[20px] cursor-pointer sb-secondary ${mcpTools > 0 ? 'chip-acc' : ''}`}
            title={t('rail.mcp', 'MCP tools')}
            onClick={() => goRail('mcp')}
          >
            <IcMcp size={11} className="shrink-0" />
            <span
              className="bidi-num whitespace-nowrap tnum"
              dir="ltr"
              style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
            >
              {t('status.mcp', 'MCP tools')} · {n(mcpTools)}
            </span>
          </button>
        )}

        {/* preview state */}
        <button
          className={`chip sbx-pill !h-[20px] cursor-pointer sb-secondary ${previewRunning ? 'chip-ok' : ''}`}
          title={
            previewRunning
              ? `${t('status.preview', 'Preview')} · ${previewKind === 'dev' ? t('preview.runDev', 'Run dev server') : t('preview.serveStatic', 'Serve static')}`
              : t('status.preview', 'Preview')
          }
          onClick={togglePreview}
        >
          <IcPreview size={11} className="shrink-0" />
          <span className="whitespace-nowrap">
            {previewRunning ? `${t('status.preview', 'Preview')} · ${previewKind}` : t('status.preview', 'Preview')}
          </span>
        </button>

        {/* v8.1 False-Done chip — the published honesty metric, honest by
            construction: nothing rendered while the persisted ledger has no
            claimed runs (no invented 0%). Warn tone when any run was
            overruled, ok tone on a clean record. Click opens the Usage panel
            where the full metric lives. */}
        {fd && fd.claimed > 0 && (
          <button
            className={`chip sbx-pill !h-[20px] cursor-pointer sb-secondary ${fd.falseDone > 0 ? 'chip-warn' : 'chip-ok'}`}
            title={t(
              'sb.fd.tip',
              'False-Done Rate — of runs claiming success, the share the proof gates overruled (career-long, persisted)',
            )}
            aria-label={t(
              'sb.fd.tip',
              'False-Done Rate — of runs claiming success, the share the proof gates overruled (career-long, persisted)',
            )}
            onClick={() => goRail('usage')}
          >
            <span className="sb-dot" style={{ background: fd.falseDone > 0 ? 'var(--warn)' : 'var(--ok)' }} />
            <span
              className="bidi-num whitespace-nowrap tnum"
              dir="ltr"
              style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
            >
              FD {n(Math.round(fd.rate * 100))}%
            </span>
          </button>
        )}

        {/* live performance */}
        {perf && (
          <button
            className={`chip sbx-pill !h-[20px] cursor-pointer sb-secondary ${perf.cpu > 60 ? 'chip-warn' : ''}`}
            title={`${t('usage.perf', 'App performance')} → ${t('rail.usage', 'Usage')}`}
            onClick={() => goRail('usage')}
          >
            <span className="sb-dot" style={{ background: perf.cpu > 60 ? 'var(--warn)' : 'var(--ok)' }} />
            <span
              className="bidi-num whitespace-nowrap tnum"
              dir="ltr"
              style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
            >
              {n(perf.cpu.toFixed(0))}% · {n(Math.round(perf.ram))} MB
            </span>
          </button>
        )}

        {/* terminal toggle — 32px hit target (negative margin keeps the 26px bar tight) */}
        <button
          className={`ibtn !w-8 !h-8 !-my-1 ${terminalOpen ? 'is-on' : ''}`}
          title={t('rail.terminal', 'Toggle terminal')}
          aria-label={t('rail.terminal', 'Toggle terminal')}
          aria-pressed={terminalOpen}
          onClick={() => void toggleTerminal()}
        >
          <TerminalSquare size={12} />
        </button>

        {/* v11.31 — the language chip used to be a dead informational <Chip>.
            It is now the second, status-bar entry point for the same AR/EN
            toggle the title bar exposes, with a real bilingual tooltip. */}
        <button
          type="button"
          data-testid="status-lang"
          className="chip sbx-pill !h-[20px] cursor-pointer sb-secondary"
          title={t('palette.lang', 'Toggle language AR/EN')}
          aria-label={t('palette.lang', 'Toggle language AR/EN')}
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
        >
          <IcGlobe size={11} className="shrink-0" />
          <span className="whitespace-nowrap">{lang === 'en' ? 'EN' : 'ع'}</span>
        </button>
      </div>
      </footer>
    </>
  );
}

export default StatusBar;
