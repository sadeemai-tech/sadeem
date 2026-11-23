// ============================================================
// SADEEM settings — Git & Worktrees section (v10.3).
// Real, wired functionality: live worktree list for the open
// workspace + create/remove via the git service, plus a
// how-it-works guide. The editorial masthead and the branch-fork
// glyph are presentation only — every IPC call and key is unchanged.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Plus, Trash2, GitMerge, FolderGit2 } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { Btn, Spinner } from '../ui';
import { GroupCard, InfoNote } from './controls';
import './s4-art.css';
import type { WorktreeInfo } from '../../../shared/types';

const NAME_RE = /^[a-z0-9][a-z0-9-_]{0,39}$/;

/** The one precise artistic element of this page: a real branch fork —
 *  two lanes, a fork node and a merge point, all 1px currentColor ink. */
const BranchForkGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path className="s4-ink" d="M20 8v14c0 7 5 12 12 12h20" />
    <path className="s4-ink" d="M20 22v28" />
    <path className="s4-ink s4-thin" d="M20 28c0-6 5-11 11-11h13" />
    <path className="s4-ink" d="M48 17l6 0-2-2M52 34l6 0-2 2" />
    <circle className="s4-dot" cx="20" cy="22" r="2.4" />
    <circle className="s4-dot" cx="46" cy="17" r="1.8" />
    <circle className="s4-dot" cx="20" cy="50" r="1.8" />
  </svg>
);

export function GitWorktreeSection() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const ar = lang === 'ar';
  const wsPath = useStore((s) => s.wsPath);
  const notify = useStore((s) => s.notify);

  const [trees, setTrees] = useState<WorktreeInfo[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wsPath) return;
    try {
      setTrees(await api.worktreeList(wsPath));
    } catch {
      setTrees([]); // not a git repo — the note below explains
    }
  }, [wsPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (): Promise<void> => {
    const name = draft.trim().toLowerCase();
    if (!wsPath) return;
    if (!NAME_RE.test(name)) {
      notify(
        lang === 'ar'
          ? 'الاسم: 1-40 حرفاً من a-z 0-9 - _ ويبدأ بحرف أو رقم'
          : 'Name: 1-40 chars of a-z 0-9 - _ starting with a-z0-9',
      );
      return;
    }
    setBusy(true);
    try {
      const wt = await api.worktreeCreate(wsPath, name);
      notify(`${lang === 'ar' ? 'أُنشئت شجرة العمل' : 'Worktree created'}: ${wt.branch}`);
      setDraft('');
      await refresh();
    } catch (err) {
      notify(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string): Promise<void> => {
    if (!wsPath) return;
    setRemoving(name);
    try {
      await api.worktreeRemove(wsPath, name, true);
      notify(lang === 'ar' ? `أُزيلت ${name}` : `Removed ${name}`);
      await refresh();
    } catch (err) {
      notify(String(err instanceof Error ? err.message : err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="s4-page s4-git">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.git.eyebrow', ar ? '١٦ / التحكم بالمصدر' : '16 / SOURCE CONTROL')}
          </span>
          <BranchForkGlyph />
        </div>
        <h2 className="s4-title">
          {t('settings.nav.git', ar ? 'Git وأشجار العمل' : 'Git & Worktrees')}
        </h2>
        <p className="s4-desc">
          {t(
            'settings.git.desc',
            'Source control and isolated parallel work: each worktree is a full checkout with its own branch — the agent (or a chat pinned to it) works there without touching your main tree.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        <GroupCard title={t('settings.wt.how', 'How worktrees work')}>
          <ol className="flex flex-col gap-1.5 leading-relaxed" dir="auto">
            <li>
              <span className="s4-mono">01</span>{' '}
              {t(
                'settings.wt.step1',
                'Create one below or from the Worktree chip under the composer — SADEEM adds a sibling folder + branch sadeem/<name>.',
              )}
            </li>
            <li>
              <span className="s4-mono">02</span>{' '}
              {t(
                'settings.wt.step2',
                'Pin a chat to it (Worktree chip): the agent, its tools and the live preview all run inside that tree — parallel tasks never collide.',
              )}
            </li>
            <li>
              <span className="s4-mono">03</span>{' '}
              {t(
                'settings.wt.step3',
                'Merge back from the Git panel when the work is done; ignored files listed in .worktreeinclude are copied into new trees automatically.',
              )}
            </li>
          </ol>
        </GroupCard>

        <GroupCard title={t('settings.wt.list', 'Worktrees in this workspace')}>
          {!wsPath ? (
            <InfoNote>{t('settings.wt.noWs', 'Open a project first — worktrees live inside a git repository.')}</InfoNote>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') void create();
                  }}
                  placeholder={t('settings.wt.placeholder', 'feature-name')}
                  dir="ltr"
                  spellCheck={false}
                  className="set-input h-[26px] flex-1 px-2 text-[11.5px] font-code outline-none"
                  aria-label={t('settings.wt.placeholder', 'feature-name')}
                />
                <Btn className="!h-[26px] !text-[11px]" onClick={() => void create()} disabled={busy}>
                  {busy ? <Spinner size={11} /> : <Plus size={12} />}
                  {t('settings.wt.create', 'Create worktree')}
                </Btn>
              </div>
              {trees === null ? (
                <div className="flex items-center gap-2 text-[11px] text-faint px-1 py-2">
                  <Spinner size={12} /> {t('common.loading', 'Loading…')}
                </div>
              ) : trees.length === 0 ? (
                <InfoNote>
                  {t(
                    'settings.wt.empty',
                    'Not a git repository, or no worktrees yet — create one above to try isolated parallel work.',
                  )}
                </InfoNote>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {trees.map((w) => (
                    <div
                      key={w.path}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-[8px] border border-[var(--line)] bg-[var(--bg1)]"
                    >
                      <FolderGit2 size={13} className="text-acc shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] font-code truncate" dir="ltr" title={w.path}>
                          {w.name}
                        </div>
                        <div className="text-[9.5px] text-faint flex items-center gap-1.5" dir="ltr">
                          <GitBranch size={9} aria-hidden /> {w.branch}
                          {w.dirty ? <span className="text-warn">· {t('settings.wt.dirty', 'has changes')}</span> : null}
                        </div>
                      </div>
                      <Btn
                        className="!h-[24px] !text-[10.5px] !px-2"
                        title={t('settings.wt.mergeHint', 'Merge this worktree back into the current branch')}
                        onClick={() => {
                          void api
                            .worktreeMerge(wsPath, w.name)
                            .then((r) =>
                              notify(
                                r.ok
                                  ? lang === 'ar'
                                    ? `دمجت ${w.name}`
                                    : `Merged ${w.name}`
                                  : String(r.error ?? 'merge failed'),
                              ),
                            )
                            .then(refresh)
                            .catch((err: unknown) => notify(String(err instanceof Error ? err.message : err)));
                        }}
                      >
                        <GitMerge size={11} />
                        {t('settings.wt.merge', 'Merge')}
                      </Btn>
                      <Btn
                        className="!h-[24px] !text-[10.5px] !px-2"
                        title={t('settings.wt.remove', 'Remove this worktree')}
                        onClick={() => void remove(w.name)}
                        disabled={removing === w.name}
                      >
                        {removing === w.name ? <Spinner size={11} /> : <Trash2 size={11} />}
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </GroupCard>
      </div>
    </div>
  );
}

export default GitWorktreeSection;
