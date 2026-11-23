// SADEEM — Clone repository dialog (real `git clone` with progress).
// SURVEYOR v4: fields read as a definition list (.defrow), the live git log
// sits under a .fhdr strip, errors are squared keyline alerts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, FolderOpen, GitBranch, Loader2, X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { Btn, Modal, TextInput } from './ui';

export function CloneDialog() {
  const t = useT();
  const open = useStore((s) => s.cloneOpen);
  const setCloneOpen = useStore((s) => s.setCloneOpen);
  const cloneRepo = useStore((s) => s.cloneRepo);
  const notify = useStore((s) => s.notify);
  const lang = useStore((s) => s.settings?.language ?? 'en');

  const [url, setUrl] = useState('');
  const [destDir, setDestDir] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logSub = useRef<(() => void) | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);
  const cloneFailed = lang === 'ar'
    ? 'تعذّر النسخ — تحقّق من الرابط والشبكة'
    : 'Clone failed — check the URL and network';

  // A fresh dialog is a fresh form: a previous failure's error, progress log
  // and destination must never leak into the next attempt (stale data).
  useEffect(() => {
    if (!open) return;
    setUrl(''); setDestDir(''); setName(''); setBranch('');
    setError(null); setLog([]); setBusy(false);
    // Modal() focuses its own dialog on open via rAF; queue this AFTER it so
    // the URL field (the first thing to type) actually gets keyboard focus.
    const raf = requestAnimationFrame(() => urlRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    return () => {
      logSub.current?.();
      logSub.current = null;
    };
  }, []);

  const go = async () => {
    if (!url.trim() || !destDir) return;
    setError(null);
    setBusy(true);
    setLog([]);
    logSub.current?.();
    if (typeof api.onCloneProgress === 'function') {
      logSub.current = api.onCloneProgress((p) => {
        setLog((prev) => [...prev.slice(-20), p.message]);
      });
    }
    try {
      const res = await cloneRepo({
        url: url.trim(),
        destDir,
        name: name.trim() || undefined,
        branch: branch.trim() || undefined,
      });
      if (res.ok) {
        notify(t('cl.done', 'Repository cloned — opening it'));
        setCloneOpen(false);
        setUrl('');
        setName('');
        setBranch('');
      } else {
        setError(t(`cl.err.${res.error}`, cloneFailed));
      }
    } catch {
      // A thrown IPC error must not strand the dialog in "Cloning…" forever.
      setError(cloneFailed);
    } finally {
      logSub.current?.();
      logSub.current = null;
      setBusy(false);
    }
  };

  const row = (label: string, ctl: ReactNode) => (
    <div className="defrow">
      <span className="def-label w-[128px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{ctl}</div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) setCloneOpen(false);
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <GitBranch size={15} strokeWidth={1.7} style={{ color: 'var(--acc)' }} aria-hidden />
          {t('cl.title', 'Clone a git repository')}
        </span>
      }
      width={520}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn variant="ghost" onClick={() => setCloneOpen(false)} disabled={busy}>
            {t('diff.close', 'Close')}
          </Btn>
          <Btn variant="primary" disabled={busy || !url.trim() || !destDir} onClick={() => void go()} title={!url.trim() || !destDir ? t('cl.needFields', lang === 'ar' ? 'أضف رابط المستودع ومجلد الوجهة أولاً.' : 'Add a repository URL and a destination folder first.') : undefined}>
            {busy ? <Loader2 size={13} className="spin" aria-hidden /> : <Check size={13} strokeWidth={2} aria-hidden />}
            {busy ? t('cloning', 'Cloning…') : t('cl.go', 'Clone')}
          </Btn>
        </div>
      }
    >
      {!busy && (!url.trim() || !destDir) && (
        <div className="text-[10.5px] text-faint mb-1" dir="auto" role="status">
          {!url.trim()
            ? t('cl.needUrl', lang === 'ar' ? 'الصق رابط المستودع للمتابعة.' : 'Paste a repository URL to continue.')
            : t('cl.needDest', lang === 'ar' ? 'اختر مجلد الوجهة — سيوضع النسخ بداخله.' : 'Pick a destination folder — the clone lands inside it.')}
        </div>
      )}
      {row(
        t('cl.url', 'Repository URL'),
        <input ref={urlRef} className="input font-code" value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder={t('cl.urlPh', 'https://github.com/user/repo.git')} aria-label={t('cl.url', 'Repository URL')} />,
      )}
      {row(
        t('cl.dest', 'Destination'),
        <div className="flex gap-2">
          <TextInput value={destDir} onChange={(e) => setDestDir(e.target.value)} dir="ltr" placeholder="~/projects" className="flex-1 font-code" />
          <Btn
            onClick={async () => {
              const dir = await api.openFolderDialog();
              if (dir) setDestDir(dir);
            }}
          >
            <FolderOpen size={13} strokeWidth={1.8} />
            {t('np.browse', 'Browse…')}
          </Btn>
        </div>,
      )}
      {row(t('cl.name', 'Folder name (optional)'), <TextInput value={name} onChange={(e) => setName(e.target.value)} dir="ltr" className="font-code" placeholder="my-repo" />)}
      {row(t('cl.branch', 'Branch (optional)'), <TextInput value={branch} onChange={(e) => setBranch(e.target.value)} dir="ltr" className="font-code" placeholder="main" />)}

      {busy && log.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-sm)] overflow-hidden" style={{ border: '1px solid var(--line)' }}>
          <div className="fhdr">
            <GitBranch size={11} strokeWidth={1.8} style={{ color: 'var(--acc)' }} aria-hidden />
            <span>git clone</span>
            <span className="flex-1" />
            <Loader2 size={10} className="spin" style={{ color: 'var(--acc)' }} aria-hidden />
          </div>
          <div className="max-h-[140px] overflow-y-auto set-scroll p-2 flex flex-col gap-0.5" style={{ background: 'var(--bg1)' }} dir="ltr">
            {log.map((line, i) => (
              <div key={i} className="text-[10.5px] tnum text-dim truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          className="mt-2 flex items-start gap-2 text-[11.5px] px-3 py-2 rounded-[var(--radius-sm)] anim-in"
          style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)', color: 'var(--bad)', border: '1px solid color-mix(in srgb, var(--bad) 35%, transparent)' }}
          role="alert"
        >
          <X size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span dir="auto">{error}</span>
        </div>
      )}
    </Modal>
  );
}

export default CloneDialog;
