// ============================================================
// WorktreeChip — v10.2 Codex-style worktree picker in the composer.
// Codex UX this mirrors (learn.chatgpt.com/docs/environments/git-worktrees):
//   · a "Worktree" control under the composer of every chat
//   · pick the main tree or an existing worktree — the chat RUNS there
//   · "New worktree…" creates an isolated checkout + sadeem/<name> branch
// The chip is quiet when there is no git repo (hidden) and shows the
// pinned branch when a session is handed off into a worktree.
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitBranch, Plus, X } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/api';
import { useT } from '../i18n';
import type { WorktreeInfo } from '../../shared/types';

const NAME_RE = /^[a-z0-9][a-z0-9-_]{0,39}$/;

export function WorktreeChip() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const wsPath = useStore((s) => s.wsPath);
  const session = useStore((s) => s.session);
  const setSessionWorktree = useStore((s) => s.setSessionWorktree);
  const notify = useStore((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorktreeInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const wt = session?.worktree ?? null;

  useEffect(() => {
    if (!open || !wsPath) return;
    let alive = true;
    api
      .worktreeList(wsPath)
      .then((l) => {
        if (!alive) return;
        const items = Array.isArray(l) ? l : [];
        setList(items);
        // v11.11 (A5) — the chip must never LIE about state: a pinned worktree
        // that no longer exists on disk (merged+removed elsewhere, deleted by
        // the agent's worktree_remove, or pruned) would keep the session
        // running against a dead cwd. Auto-unpin + tell the user.
        if (session?.worktree && !items.some((w) => w.name === session.worktree?.name)) {
          const gone = session.worktree.name;
          void setSessionWorktree(null);
          notify(
            lang === 'ar'
              ? `شجرة العمل "${gone}" لم تعد موجودة — أُلغى تثبيت هذه الجلسة وعادت إلى الشجرة الرئيسية.`
              : `Worktree "${gone}" no longer exists — this chat was unpinned and is back on the main tree.`,
          );
        }
      })
      .catch(() => {
        if (alive) setList([]); // not a git repo → chip shows main tree only
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wsPath]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!wsPath) return null;

  const create = async () => {
    const name = draft.trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      notify(
        lang === 'ar'
          ? 'الاسم: 1-40 حرفًا من a-z 0-9 - _ ويبدأ بحرف أو رقم'
          : 'Name: 1-40 chars of a-z 0-9 - _ starting with a-z0-9',
      );
      return;
    }
    setBusy(true);
    try {
      await api.worktreeCreate(wsPath, name);
      const fresh = await api.worktreeResolve(wsPath, name);
      if (fresh) {
        await setSessionWorktree(fresh.name);
        setList((l) => (l ? [...l.filter((x) => x.name !== fresh.name), fresh] : [fresh]));
      }
      setCreating(false);
      setDraft('');
      setOpen(false);
    } catch (err) {
      notify(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wt-chip-root" ref={rootRef}>
      <button
        type="button"
        className={`stamp wt-chip${wt ? ' is-pinned' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={
          wt
            ? `${lang === 'ar' ? 'تعمل داخل شجرة العمل' : 'Running in worktree'}: ${wt.name} (${wt.branch})`
            : t('wt.chipMain', lang === 'ar' ? 'الشجرة الرئيسية' : 'Main tree')
        }
      >
        <GitBranch size={10} aria-hidden />
        <span dir="ltr" className="wt-chip-name">
          {wt ? wt.name : t('wt.chipMain', lang === 'ar' ? 'MAIN' : 'MAIN')}
        </span>
        <ChevronDown size={10} className={open ? 'is-open' : ''} aria-hidden />
      </button>

      {open && (
        <div className="wt-menu" role="listbox" aria-label={t('wt.menu', 'Worktrees')}>
          <div className="wt-menu-cap caps">
            {t('wt.where', lang === 'ar' ? 'أين تعمل هذه الجلسة' : 'Where this chat runs')}
          </div>
          <button
            role="option"
            aria-selected={!wt}
            className={`wt-row${!wt ? ' is-on' : ''}`}
            onClick={() => {
              void setSessionWorktree(null);
              setOpen(false);
            }}
          >
            <GitBranch size={11} aria-hidden />
            <span className="wt-row-name" dir="ltr">
              {t('wt.mainTree', lang === 'ar' ? 'الشجرة الرئيسية' : 'Main tree')}
            </span>
            <span className="wt-row-sub" dir="ltr">
              {wsPath.split(/[\\/]/).pop()}
            </span>
          </button>
          {(list ?? []).map((w) => (
            <button
              key={w.path}
              role="option"
              aria-selected={wt?.name === w.name}
              className={`wt-row${wt?.name === w.name ? ' is-on' : ''}`}
              onClick={() => {
                void setSessionWorktree(w.name);
                setOpen(false);
              }}
            >
              <GitBranch size={11} aria-hidden />
              <span className="wt-row-name" dir="ltr">
                {w.name}
              </span>
              <span className="wt-row-sub" dir="ltr">
                {w.branch}
                {w.dirty ? ' · *' : ''}
              </span>
            </button>
          ))}
          {list !== null && list.length === 0 && !creating && (
            <div className="wt-empty">
              {t('wt.none', lang === 'ar' ? 'لا توجد أشجار عمل بعد' : 'No worktrees yet')}
            </div>
          )}
          {creating ? (
            <div className="wt-create">
              <input
                autoFocus
                dir="ltr"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                  if (e.key === 'Escape') setCreating(false);
                }}
                placeholder={lang === 'ar' ? 'اسم الشجرة، مثال: fix-api' : 'worktree name, e.g. fix-api'}
                className="wt-create-input"
              />
              <button type="button" className="wt-create-go" disabled={busy} onClick={() => void create()}>
                {busy ? '…' : t('wt.create', lang === 'ar' ? 'إنشاء' : 'Create')}
              </button>
              <button
                type="button"
                className="wt-create-x"
                aria-label={t('common.cancel', 'Cancel')}
                onClick={() => setCreating(false)}
              >
                <X size={11} aria-hidden />
              </button>
            </div>
          ) : (
            <button
              role="option"
              className="wt-row wt-new"
              onClick={() => setCreating(true)}
            >
              <Plus size={11} aria-hidden />
              <span className="wt-row-name">{t('wt.new', lang === 'ar' ? 'شجرة عمل جديدة…' : 'New worktree…')}</span>
              <span className="wt-row-sub" dir="ltr">
                sadeem/&lt;{lang === 'ar' ? 'اسم' : 'name'}&gt;
              </span>
            </button>
          )}
          <div className="wt-menu-foot">
            {t(
              'wt.foot',
              lang === 'ar'
                ? 'كل شجرة عمل نسخة معزولة للمستودع — العمل والتشغيل يجريان فيها ثم يُدمَج بضغطة.'
                : 'Each worktree is an isolated checkout — the agent works and runs there, then you merge with one click.',
            )}
          </div>
        </div>
      )}
    </div>
  );
}
