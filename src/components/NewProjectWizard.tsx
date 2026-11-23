// SADEEM — New project dialog: create an EMPTY folder, then build from scratch.
// There is no template catalog and no template picker: the project structure
// comes entirely from the user's request (written by the AI with file tools).
import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { Btn, Modal, TextInput } from './ui';

export function NewProjectWizard() {
  const t = useT();
  const open = useStore((s) => s.newProjectOpen);
  const setNewProject = useStore((s) => s.setNewProject);
  const openWorkspace = useStore((s) => s.openWorkspace);
  const notify = useStore((s) => s.notify);
  const lang = useStore((s) => s.settings?.language ?? 'en');

  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // Modal() focuses its dialog on open via rAF — focus the name field after it
  // so typing goes into the first control, not the dialog chrome.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Unicode-aware slug: an Arabic (or any non-Latin) project name is a valid
  // folder name. The old [a-z0-9] filter erased it, silently disabling Create.
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const canCreate = Boolean(slug && parentDir) && !creating;
  const base = parentDir.replace(/[\\/]+$/, '');

  const reset = () => {
    setName('');
    setParentDir('');
    setError(null);
    setCreating(false);
  };

  const browse = async () => {
    try {
      const dir = await api.openFolderDialog();
      if (dir) setParentDir(dir);
    } catch {
      /* picker cancelled / legacy bridge — keep the typed location */
    }
  };

  const createEmpty = async () => {
    if (!canCreate) return;
    setError(null);
    setCreating(true);
    const projectPath = `${base}/${slug}`;
    try {
      await api.createDir(projectPath);
      await openWorkspace(projectPath);
      notify(t('np.created', 'Empty project created — describe what to build and the AI will create it from scratch'));
      setNewProject(false);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Localized WHY in the UI language; the raw FS message is machine text —
      // kept as a separate dir="ltr" detail line, never as Arabic "prose".
      setError(
        /EXISTS|EEXIST/i.test(msg)
          ? { text: t('np.exists', 'A folder with this name already exists there') }
          : { text: t('np.createFailed', lang === 'ar' ? 'تعذّر إنشاء المجلد' : 'Could not create the folder'), detail: msg },
      );
    } finally {
      setCreating(false);
    }
  };

  const errBox = (err: { text: string; detail?: string }) => (
    <div
      className="mt-3 text-[11.5px] px-3 py-2 rounded-[var(--radius-sm)] anim-in flex items-start gap-2"
      style={{
        background: 'color-mix(in srgb, var(--bad) 10%, transparent)',
        color: 'var(--bad)',
        border: '1px solid color-mix(in srgb, var(--bad) 35%, transparent)',
      }}
      role="alert"
    >
      <span dir="auto">{err.text}</span>
      {err.detail && (
        <span className="font-code text-[10px] opacity-70 block mt-0.5 break-all" dir="ltr">
          {err.detail}
        </span>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!creating) {
          setNewProject(false);
          reset();
        }
      }}
      title={t('np.title', 'New project')}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn
            variant="ghost"
            onClick={() => {
              setNewProject(false);
              reset();
            }}
            disabled={creating}
          >
            {t('ws.cancel', 'Cancel')}
          </Btn>
          <Btn variant="primary" disabled={!canCreate} onClick={() => void createEmpty()}>
            {t('np.create', 'Create project')}
          </Btn>
        </div>
      }
    >
      <div className="defrow">
        <span className="def-label w-[128px] shrink-0" dir="auto">{t('np.name', 'Project name')}</span>
        <div className="flex-1 min-w-0">
          <input
            ref={nameRef}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('np.name', 'Project name')}
            aria-label={t('np.name', 'Project name')}
          />
          {slug && (
            <div className="text-[10.5px] text-faint mt-1.5 tnum font-code" dir="ltr">
              {parentDir ? `${base}/${slug}` : `→ ${slug}/`}
            </div>
          )}
        </div>
      </div>

      <div className="defrow">
        <span className="def-label w-[128px] shrink-0" dir="auto">{t('np.location', 'Location')}</span>
        <div className="flex-1 min-w-0 flex gap-2">
          <TextInput value={parentDir} onChange={(e) => setParentDir(e.target.value)} dir="ltr" placeholder="~/projects" className="flex-1 font-code" />
          <Btn onClick={() => void browse()}>
            <FolderOpen size={13} strokeWidth={1.8} />
            {t('np.browse', 'Browse…')}
          </Btn>
        </div>
      </div>

      <div className="mt-4 text-[11px] text-dim" dir="auto" role="note">
        {t('np.scratch', 'No templates — an empty folder is created and the AI builds the project from scratch from your request.')}
      </div>

      {error && errBox(error)}
    </Modal>
  );
}

export default NewProjectWizard;
