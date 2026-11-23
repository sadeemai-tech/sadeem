// SADEEM — Session Timeline (v7.2 signature feature).
// A horizontal strip of restore/checkpoint points (git shadow-commit
// checkpoints via api.cpList / api.cpRestore). Each point is a teal dot +
// label + relative time; the live "Now" edge carries the agent violet dot.
// Click asks for confirmation (inline confirm bubble — no window.confirm)
// and restores. Honest fallback: when checkpoints are disabled or none exist
// the strip renders the explanatory empty state (or nothing when disabled).
//
// v11.31 — ONE ledger read per session (the old second effect double-loaded
// the same checkpoints, even while the feature was disabled), BILINGUAL
// relative labels (no "12m" Latin-unit leak into an Arabic UI) and an HONEST
// restore-failure toast (a failed restore is never silent).
import React, { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/api';
import type { CheckpointInfo } from '../../shared/types';
import { useT, useDigits } from '../i18n';

/** CheckpointInfo.at → short relative parts for per-language rendering. */
function relTimeParts(ts: number): { value: number; unit: 'now' | 'm' | 'h' | 'd' } {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return { value: 0, unit: 'now' };
  const m = Math.floor(s / 60);
  if (m < 60) return { value: m, unit: 'm' };
  const h = Math.floor(m / 60);
  if (h < 24) return { value: h, unit: 'h' };
  return { value: Math.floor(h / 24), unit: 'd' };
}

export function SessionTimeline() {
  const t = useT();
  const n = useDigits();
  const wsPath = useStore((s) => s.wsPath);
  const checkpointsEnabled = useStore((s) => s.settings.checkpointsEnabled);
  const ar = useStore((s) => s.settings?.language === 'ar');
  const notify = useStore((s) => s.notify);
  const refreshTree = useStore((s) => s.refreshTree);
  const loadGit = useStore((s) => s.loadGit);
  const sessionId = useStore((s) => s.session?.id ?? '');

  const [points, setPoints] = useState<CheckpointInfo[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ONE poll per session + workspace (cheap local read). The removed second
  // effect used to fire an identical cpList on the same deps — duplicate work
  // and a read even while checkpoints were disabled.
  useEffect(() => {
    if (!wsPath || !checkpointsEnabled || typeof api.cpList !== 'function') {
      setPoints([]);
      return;
    }
    let alive = true;
    const load = () => {
      api
        .cpList(wsPath)
        .then((list) => {
          if (alive) setPoints(Array.isArray(list) ? list : []);
        })
        .catch(() => {
          if (alive) setPoints([]);
        });
    };
    load();
    const iv = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [wsPath, checkpointsEnabled, sessionId]);

  const shown = useMemo(() => points.slice(-12), [points]);

  if (!checkpointsEnabled) return null;

  const restore = async (cp: CheckpointInfo) => {
    if (!wsPath || busy) return;
    setBusy(true);
    setConfirmId(null);
    try {
      await api.cpRestore(wsPath, cp.id);
      await Promise.all([refreshTree(), loadGit()]);
      notify(t('tl.restored', 'Checkpoint restored'));
    } catch {
      // Honest outcome: say the restore failed (never a silent no-op that
      // leaves the founder guessing whether the files rolled back).
      notify(t('tl.restoreFailed', ar ? 'تعذّرت الاستعادة — لم تتغير الملفات' : 'Restore failed — files were not changed'));
    } finally {
      setBusy(false);
    }
  };

  const relLabel = (ts: number): string => {
    const rel = relTimeParts(ts);
    if (rel.unit === 'now') return t('tl.rel.now', ar ? 'الآن' : 'now');
    const unit =
      rel.unit === 'm'
        ? t('tl.rel.m', ar ? 'د' : 'm')
        : rel.unit === 'h'
          ? t('tl.rel.h', ar ? 'س' : 'h')
          : t('tl.rel.d', ar ? 'ي' : 'd');
    return `${n(rel.value)}${unit}`;
  };

  return (
    <div className="px-3 pb-1">
      <div
        className="flex items-center gap-1.5 h-6 rounded-[4px] border border-[var(--line)] px-1.5 overflow-x-auto set-scroll"
        role="region"
        aria-label={t('tl.title', 'Session timeline')}
        style={{ background: 'var(--bg1)' }}
      >
        <History size={11} className="text-faint shrink-0" />
        <span className="micro-label shrink-0 me-1">{t('tl.title', 'Session timeline')}</span>
        {shown.length === 0 ? (
          <span className="text-[10px] text-faint truncate" dir="auto">
            {t('tl.empty', 'No checkpoints yet — SADEEM snapshots before edits')}
          </span>
        ) : (
          <>
            {shown.map((cp) => {
              const confirming = confirmId === cp.id;
              return (
                <div key={cp.id} className="relative shrink-0 flex items-center">
                  <span
                    className={`tl-dot me-1 ${confirming ? 'tl-dot-warn' : ''}`}
                    aria-hidden
                  />
                  <button
                    className={`flex items-center gap-1 h-[16px] px-1.5 rounded-[3px] border text-[9.5px] transition-colors cursor-pointer ${
                      confirming
                        ? 'border-[var(--warn)] text-[var(--warn)]'
                        : 'border-[var(--line)] text-dim hover:text-ink hover:border-acc'
                    }`}
                    disabled={busy}
                    title={`${cp.label} · ${t('tl.restore', 'Restore checkpoint')}`}
                    aria-label={`${t('tl.restore', 'Restore checkpoint')}: ${cp.label}`}
                    onClick={() => {
                      if (confirming) void restore(cp);
                      else setConfirmId(cp.id);
                    }}
                  >
                    {confirming ? <RotateCcw size={9} /> : null}
                    <span className="max-w-[16ch] truncate" dir="auto">
                      {cp.label}
                    </span>
                    <span className="bidi-num tnum opacity-70" dir="ltr">
                      {relLabel(cp.at)}
                    </span>
                  </button>
                  {confirming && (
                    <div className="absolute bottom-[calc(100%+6px)] start-0 z-40 glass-strong grain rounded-[8px] p-2 w-[240px] anim-in shadow-lg">
                      <div className="text-[10.5px] leading-snug mb-1.5" dir="auto">
                        {t('tl.restoreConfirm', 'Restore “{label}”? Files changed since then will be rolled back.').replace(
                          '{label}',
                          cp.label,
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn btn-primary !h-6 !px-2 !text-[10px] flex-1 justify-center"
                          disabled={busy}
                          onClick={() => void restore(cp)}
                        >
                          {t('tl.restore', 'Restore checkpoint')}
                        </button>
                        <button
                          className="ibtn !w-8 !h-8 shrink-0"
                          onClick={() => setConfirmId(null)}
                          aria-label={t('ui.close', 'Close')}
                          title={t('ui.close', 'Close')}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <span className="text-[9.5px] text-faint shrink-0 flex items-center gap-1">
              <span className="tl-dot tl-dot-now" aria-hidden />
              {t('tl.now', 'Now')}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default SessionTimeline;
