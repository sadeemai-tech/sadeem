// SADEEM — /rewind checkpoint chooser (A1).
// A small store-driven picker: lists the workspace's checkpoints (newest
// first) and restores the clicked one via st.restoreCheckpoint() — files go
// back to the snapshot, the conversation stays. Opened by the /rewind slash
// command (store.rewindPicker), closed on backdrop / Close / after restore.
// NOTE (A1 task constraints): App.tsx is owned by another agent, so this
// component is mounted from DiffModal.tsx (the one root-mounted component
// file assigned to A1) — functionally identical to a root-level mount.
import React, { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useStore } from '../store';
import { useT, useDigits } from '../i18n';
import { Btn, Modal } from './ui';

export function RewindChooser() {
  const t = useT();
  const n = useDigits();
  const cps = useStore((s) => s.rewindPicker);
  const restore = useStore((s) => s.restoreCheckpoint);
  const close = () => useStore.getState().setRewindPicker(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const onRestore = async (id: string) => {
    if (busyId !== null) return; // one restore at a time — row + chip share this
    setBusyId(id);
    try {
      await restore(id); // the action closes the picker itself
    } finally {
      setBusyId(null);
    }
  };

  const titleNode = (
    <div className="flex items-center gap-2 min-w-0 w-full">
      <History size={14} className="text-acc2 shrink-0" />
      <span className="truncate">{t('slash.rewind.list', 'Checkpoints ({n})', { n: cps?.length ?? 0 })}</span>
    </div>
  );

  return (
    <Modal
      open={!!cps}
      onClose={close}
      width={500}
      title={titleNode}
      footer={
        <div className="flex items-center justify-end">
          <Btn variant="ghost" onClick={close}>
            {t('slash.rewind.close', 'Close')}
          </Btn>
        </div>
      }
      z={60}
      ariaLabel={t('slash.rewind.list', 'Checkpoints ({n})', { n: cps?.length ?? 0 })}
    >
      <div className="text-[11.5px] text-faint mb-3">{t('slash.rewind.pick', 'Pick a checkpoint to restore — files go back, the conversation stays.')}</div>
      {cps?.length === 0 && (
        <div className="text-[12px] text-dim py-6 text-center" dir="auto" role="status">
          {t('slash.rewind.empty', 'No checkpoints yet — they are created automatically before edits.')}
        </div>
      )}
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5 pe-1">
        {(cps ?? []).map((cp, i) => (
          <div
            key={cp.id}
            // The whole row is the real target — the tiny Restore chip was the
            // only clickable area even though the copy invites "pick a row".
            title={t('slash.rewind.restore', 'Restore')}
            className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 hover:border-acc transition-colors min-w-0 cursor-pointer"
            onClick={() => void onRestore(cp.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return; // let the inner button own its keys
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void onRestore(cp.id);
              }
            }}
            tabIndex={0}
            role="group"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-[12.5px] font-medium" title={cp.label}>
                  {cp.label}
                </span>
                {i === 0 && (
                  <span className="stamp stamp-acc shrink-0 !h-[14px] !text-[8.5px]">{t('slash.rewind.latest', 'latest')}</span>
                )}
              </div>
              <div className="text-[10.5px] text-faint tnum" dir="ltr">
                {n(new Date(cp.at).toLocaleTimeString())} · {t('slash.rewind.files', '{n} files', { n: cp.fileCount })}
              </div>
            </div>
            <button
              className="inline-flex items-center gap-1 h-[24px] px-2 rounded-md border border-line text-[11px] text-dim hover:text-[var(--ink)] hover:border-acc transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-wait"
              onClick={(e) => { e.stopPropagation(); void onRestore(cp.id); }}
              disabled={busyId !== null}
              aria-label={`${t('slash.rewind.restore', 'Restore')} — ${cp.label}`}
            >
              <RotateCcw size={11} className={busyId === cp.id ? 'animate-pulse' : ''} />
              {busyId === cp.id ? t('slash.rewind.restoring', 'Restoring…') : t('slash.rewind.restore', 'Restore')}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default RewindChooser;
