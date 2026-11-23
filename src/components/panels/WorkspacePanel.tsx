// WorkspacePanel — the project command center (SURVEYOR v4).
// Drafting-table voice top-down by intent: hero (caps-lg name · tnum
// path · ruler) → tick-framed stat tiles → numbered sections:
//   01 ACTIVITY (working-tree changes + session pulse)
//   02 QUICK ACTIONS (incl. agent bridge actions)
//   03 SESSIONS · 04 MCP STATUS (health dots + latency) ·
//   05 SCHEDULED (next 3 jobs) · 06 FILE TYPES · 07 MEMORY ·
//   08 WORKTREES → quick search → the file tree as the workhorse.
// Matte Warm Clay & Sage throughout; bilingual via t().
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FileCode2,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  GitMerge,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { FileNode, WorktreeInfo } from '../../../shared/types';
import { api } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, Chip, Empty, IconBtn, Kbd, Spinner, TextInput } from '../ui';
import {
  IconTile,
  IcBranchMini,
  IcDna,
  IcFile,
  IcGit,
  IcPreview,
  IcSessions,
  IcSpark,
  IcTerminal,
  IcWorkspace,
} from '../icons';
import { ProjectFiles, FILES_CREATE_EVENT } from '../ProjectFiles';
import { cronNextRun } from './SchedulePanel';
import { PageHead } from '../pages';
import '../workspace.css';
import '../pages.css';
// FINAL LAUNCH POLISH — editorial art layer (loaded last so it wins ties).
import './hgs-art.css';

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

/* An original 1px folder with a hatched spine — the drafting-table mark for
   the Workspace masthead. All hairlines use currentColor / the accent token. */
function WorkspaceGlyph() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1"
      strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M6 11H3v26h36v-4" opacity=".4" />
      <path d="M6 11h12l4 4h20v22H6z" />
      <path d="M6 20h36" />
      <g className="hgs-pf-spine">
        <path d="M7 19 11 15M7 25 13 19M7 31 15 23M7 37 15 29" />
      </g>
      <circle cx="36" cy="30" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Numbered SURVEYOR section header: "01 — TITLE ———" */
function Sec({ no, title, children }: { no: string; title: string; children?: ReactNode }) {
  return (
    <div className="px-3 pt-4 shrink-0">
      <div className="sec-titled">
        <span className="sec-no">{no}</span>
        <span className="sec-tt">{title}</span>
        <span className="sec-rule" />
        {children}
      </div>
    </div>
  );
}

// ---------- file-tree walking helpers ----------
function countFiles(node: FileNode | null): number {
  if (!node) return 0;
  if (node.type === 'file') return 1;
  let n = 0;
  for (const c of node.children ?? []) n += countFiles(c);
  return n;
}

interface ExtStat {
  ext: string;
  count: number;
  tone: string;
}

const EXT_TONE: Record<string, string> = {
  ts: 'var(--acc)',
  tsx: 'var(--acc)',
  js: 'var(--acc)',
  jsx: 'var(--acc)',
  mjs: 'var(--acc)',
  cjs: 'var(--acc)',
  json: 'var(--amber)',
  css: 'var(--acc2)',
  scss: 'var(--acc2)',
  less: 'var(--acc2)',
  html: 'var(--clay)',
  vue: 'var(--clay)',
  svelte: 'var(--clay)',
  md: 'var(--dim)',
  mdx: 'var(--dim)',
  py: 'var(--acc2)',
  rs: 'var(--v-think)',
  go: 'var(--v-think)',
  java: 'var(--v-think)',
  kt: 'var(--v-think)',
  c: 'var(--v-think)',
  cpp: 'var(--v-think)',
  h: 'var(--v-think)',
  sh: 'var(--v-run)',
  yml: 'var(--v-run)',
  yaml: 'var(--v-run)',
  toml: 'var(--v-run)',
  png: 'var(--ok)',
  jpg: 'var(--ok)',
  jpeg: 'var(--ok)',
  svg: 'var(--ok)',
  gif: 'var(--ok)',
  webp: 'var(--ok)',
};

const FALLBACK_TONES = ['var(--acc)', 'var(--acc2)', 'var(--clay)', 'var(--amber)', 'var(--v-think)', 'var(--ok)'];

/** Extension histogram over the FileNode tree → top 6 + "other". */
function extStats(node: FileNode | null, t: (k: string, fb: string) => string): ExtStat[] {
  const counts = new Map<string, number>();
  const walk = (n: FileNode): void => {
    if (n.type === 'file') {
      const m = /\.([a-z0-9]+)$/i.exec(n.name);
      const ext = m ? m[1].toLowerCase() : '';
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
      return;
    }
    for (const c of n.children ?? []) walk(c);
  };
  if (node) walk(node);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((a, [, c]) => a + c, 0);
  const out: ExtStat[] = top.map(([ext, count], i) => ({
    ext: ext || t('wscc.other', 'other'),
    count,
    tone: EXT_TONE[ext] ?? FALLBACK_TONES[i % FALLBACK_TONES.length],
  }));
  if (rest > 0) out.push({ ext: t('wscc.other', 'other'), count: rest, tone: 'var(--faint)' });
  return out;
}

// ---------- relative time (compact, same grammar as SessionsPanel) ----------
function relTime(ts: number, lang: string): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  const h = Math.floor(d / 3_600_000);
  const dd = Math.floor(d / 86_400_000);
  if (lang === 'ar') {
    if (m < 1) return 'الآن';
    if (h < 1) return `قبل ${m}د`;
    if (dd < 1) return `قبل ${h}س`;
    if (dd < 7) return `قبل ${dd}ي`;
    return new Date(ts).toLocaleDateString('ar');
  }
  if (m < 1) return 'now';
  if (h < 1) return `${m}m ago`;
  if (dd < 1) return `${h}h ago`;
  if (dd < 7) return `${dd}d ago`;
  return new Date(ts).toLocaleDateString();
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---------- search result grouping (from the original panel) ----------
interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/** Group hits by file, preserving first-seen order. */
function groupByFile(hits: SearchHit[]): { path: string; hits: SearchHit[] }[] {
  const map = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const arr = map.get(h.path);
    if (arr) arr.push(h);
    else map.set(h.path, [h]);
  }
  return [...map.entries()].map(([path, hs]) => ({ path, hits: hs }));
}

/** Line text with the matched substring wrapped in a flat accent mark. */
function MatchLine({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="wsp-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ---------- MCP health (defensive — channel may not exist yet) ----------
interface McpHealthSnapshot {
  id: string;
  name: string;
  status: 'up' | 'down' | 'starting' | 'disabled' | 'quarantined';
  latencyMs?: number;
  toolCount: number;
  lastError?: string;
}

/** Invoke a possibly-missing preload method defensively. */
async function bridgeInvoke<T>(method: string, fallback: T, ...args: unknown[]): Promise<T> {
  try {
    // Defensive: (window as any).surnia — brand-new channels land here first.
    const w = window as unknown as { surnia?: Record<string, unknown>; kodex?: Record<string, unknown> };
    // FIX v11.31 — the old `(w.surnia ?? w.surnia)` typo dropped the legacy
    // kodex bridge entirely; MCP health silently returned [] on those builds.
    const f = (w.surnia ?? w.kodex)?.[method];
    if (typeof f !== 'function') return fallback;
    return (await (f as (...a: unknown[]) => Promise<unknown>)(...args)) as T;
  } catch {
    return fallback;
  }
}

function mcpDotState(status: string | undefined): string {
  if (!status) return 'pending';
  return status;
}

// ============================================================
export function WorkspacePanel({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const wsPath = useStore((s) => s.wsPath);
  // v10.2 — Codex-style hand-off: run THIS chat inside a worktree
  const session = useStore((s) => s.session);
  const setSessionWorktree = useStore((s) => s.setSessionWorktree);
  const fileTree = useStore((s) => s.fileTree);
  const treeLoading = useStore((s) => s.treeLoading);
  const git = useStore((s) => s.git);
  const sessions = useStore((s) => s.sessions);
  const searchResults = useStore((s) => s.searchResults);
  const searching = useStore((s) => s.searching);
  const running = useStore((s) => s.running);
  const mcpServers = useStore((s) => s.settings.mcpServers);
  const scheduledJobs = useStore((s) => s.scheduledJobs);
  const loadJobs = useStore((s) => s.loadJobs);

  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const refreshTree = useStore((s) => s.refreshTree);
  const createEntry = useStore((s) => s.createEntry);
  const runSearch = useStore((s) => s.runSearch);
  const openFile = useStore((s) => s.openFile);
  const openSession = useStore((s) => s.openSession);
  const newSession = useStore((s) => s.newSession);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const togglePreview = useStore((s) => s.togglePreview);
  const sendMessage = useStore((s) => s.sendMessage);
  const notify = useStore((s) => s.notify);
  const setRail = useStore((s) => s.setRail);

  const [createMode, setCreateMode] = useState<'file' | 'dir' | null>(null);
  const [createName, setCreateName] = useState('');
  // v11.31 — the parent directory for the controlled create form. The
  // PROJECT FILES header sends the folder currently being browsed; without
  // this, every "New file"/"New folder" landed at the workspace root.
  const [createDir, setCreateDir] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // The PROJECT FILES section (and the rail drawer) can ask the page header
  // to open its inline create form. Keep both mounts in sync without props
  // threading through every layer.
  useEffect(() => {
    const onFilesCreate = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: 'file' | 'dir'; dir?: string }>).detail;
      const mode = detail?.mode;
      if (mode !== 'file' && mode !== 'dir') return;
      setCreateMode(mode);
      setCreateName('');
      setCreateDir(detail?.dir ?? wsPath);
      document.getElementById('project-files')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Focus the inline input once the form has mounted.
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('.pf-create-input')?.focus();
      });
    };
    window.addEventListener(FILES_CREATE_EVENT, onFilesCreate);
    return () => window.removeEventListener(FILES_CREATE_EVENT, onFilesCreate);
  }, [wsPath]);

  // ----- project memory (MEMORY.md) -----
  const [memory, setMemory] = useState<string | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);

  const loadMemory = useCallback(async (ws: string) => {
    setMemoryLoading(true);
    try {
      const content = await api.memoryRead(ws);
      setMemory(typeof content === 'string' ? content : '');
    } catch {
      setMemory(null);
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  useEffect(() => {
    setEditingMemory(false);
    setMemory(null);
    if (wsPath) void loadMemory(wsPath);
  }, [wsPath, loadMemory]);

  const saveMemory = async () => {
    if (!wsPath || memorySaving) return;
    setMemorySaving(true);
    try {
      await api.memoryWrite(wsPath, memoryDraft);
      setMemory(memoryDraft);
      setEditingMemory(false);
      notify(t('misc.saved', 'Saved'));
    } catch {
      notify(t('wscc.memoryFailed', 'Could not save MEMORY.md'));
    } finally {
      setMemorySaving(false);
    }
  };

  // ----- worktrees -----
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);
  const [wtName, setWtName] = useState('');
  const [wtBusy, setWtBusy] = useState(false);

  const loadWorktrees = useCallback(async (ws: string) => {
    try {
      const list = await api.worktreeList(ws);
      setWorktrees(Array.isArray(list) ? list : []);
    } catch {
      setWorktrees(null);
    }
  }, []);

  useEffect(() => {
    setWorktrees(null);
    if (wsPath) void loadWorktrees(wsPath);
  }, [wsPath, loadWorktrees]);

  const createWorktree = async () => {
    const name = wtName.trim();
    if (!wsPath || !name || wtBusy) return;
    setWtBusy(true);
    try {
      await api.worktreeCreate(wsPath, name);
      setWtName('');
      notify(t('wscc.worktreeCreated', 'Worktree created'));
      await loadWorktrees(wsPath);
    } catch {
      notify(t('wscc.worktreeFailed', 'Worktree operation failed'));
    } finally {
      setWtBusy(false);
    }
  };

  const mergeWorktree = async (wt: WorktreeInfo) => {
    if (!wsPath) return;
    if (!window.confirm(t('wscc.worktreeConfirmMerge', 'Merge this worktree into the current branch?'))) return;
    setWtBusy(true);
    try {
      await api.worktreeMerge(wsPath, wt.name);
      notify(t('wscc.worktreeMerged', 'Worktree merged'));
    } catch {
      notify(t('wscc.worktreeFailed', 'Worktree operation failed'));
    } finally {
      setWtBusy(false);
    }
  };

  const removeWorktree = async (wt: WorktreeInfo) => {
    if (!wsPath) return;
    if (!window.confirm(t('wscc.worktreeConfirmRemove', 'Remove this worktree?'))) return;
    setWtBusy(true);
    try {
      await api.worktreeRemove(wsPath, wt.name, true);
      notify(t('wscc.worktreeRemoved', 'Worktree removed'));
      await loadWorktrees(wsPath);
    } catch {
      notify(t('wscc.worktreeFailed', 'Worktree operation failed'));
    } finally {
      setWtBusy(false);
    }
  };

  // ----- MCP health (04) — defensive poll every 60s -----
  const [mcpHealth, setMcpHealth] = useState<McpHealthSnapshot[] | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const list = await bridgeInvoke<McpHealthSnapshot[]>('mcpHealthGet', []);
      if (alive) setMcpHealth(list);
    };
    void tick();
    const iv = window.setInterval(() => void tick(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  // ----- scheduled jobs (05) — one pull on mount (store also re-polls after mutations)
  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // ----- derived stats -----
  const wsSessions = useMemo(
    () => sessions.filter((s) => (wsPath ? s.workspace === wsPath : true)).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, wsPath],
  );
  const totalTokens = useMemo(() => wsSessions.reduce((a, s) => a + (s.totalTokens || 0), 0), [wsSessions]);
  const lastActivity = wsSessions[0]?.updatedAt ?? 0;
  const files = useMemo(() => countFiles(fileTree), [fileTree]);
  const langs = useMemo(() => extStats(fileTree, t), [fileTree, t]);
  const langsTotal = langs.reduce((a, l) => a + l.count, 0);
  const recent = wsSessions.slice(0, 5);
  const dirtyCount = git?.changed.length ?? 0;

  // 05 — next 3 scheduled jobs by computed next-run time
  const nextJobs = useMemo(() => {
    return [...scheduledJobs]
      .map((j) => ({ job: j, at: cronNextRun(j.cron) }))
      .sort((a, b) => a.at - b.at)
      .slice(0, 3);
  }, [scheduledJobs]);

  // ----- debounced project search (300ms) -----
  useEffect(() => {
    const h = setTimeout(() => {
      void runSearch(q);
    }, 300);
    return () => clearTimeout(h);
  }, [q, runSearch]);
  const hasQuery = q.trim().length > 0;

  const resetCreate = () => {
    setCreateMode(null);
    setCreateName('');
    setCreateDir(null);
  };
  const commitCreate = () => {
    const name = createName.trim();
    const parent = createDir ?? wsPath;
    if (createMode && name && parent) void createEntry(createMode, parent, name);
    resetCreate();
  };

  // Agent bridge quick actions — the chat agent mounts listeners for these
  // window events; guarded so a missing listener is always harmless.
  const dispatchAgentEvent = (event: string) => {
    // Guarded dispatch: 'surnia:run-review' / 'surnia:run-recap' are consumed
    // by the chat agent (try/catch — CustomEvent is always available, but the
    // guard keeps this safe in exotic embeds).
    try {
      window.dispatchEvent(new CustomEvent(event));
    } catch {
      /* listener not mounted — harmless */
    }
  };

  const quickActions: { label: string; icon: ReactNode; tone: string; onClick: () => void; disabled?: boolean }[] = [
    {
      label: t('wscc.newSession', 'New session'),
      icon: <IcSpark size={14} />,
      tone: 'var(--acc)',
      onClick: () => void newSession(),
    },
    {
      label: t('wscc.terminal', 'Terminal'),
      icon: <IcTerminal size={14} />,
      tone: 'var(--acc2)',
      onClick: () => void toggleTerminal(),
    },
    {
      label: t('wscc.preview', 'Preview'),
      icon: <IcPreview size={14} />,
      tone: 'var(--clay)',
      onClick: () => togglePreview(),
    },
    {
      label: t('wscc.initMemory', 'Init memory'),
      icon: <IcFile size={14} />,
      tone: 'var(--amber)',
      onClick: () => void sendMessage('/init'),
      disabled: running || !wsPath,
    },
    {
      label: t('wscc.review', 'Review changes'),
      icon: <IcGit size={14} />,
      tone: 'var(--v-think)',
      onClick: () => void sendMessage('/review'),
      disabled: running || !wsPath,
    },
    {
      label: t('wscc.reviewCode', 'Review my code'),
      icon: <IcGit size={14} />,
      tone: 'var(--acc)',
      onClick: () => dispatchAgentEvent('surnia:run-review'),
      disabled: !wsPath,
    },
    {
      label: t('wscc.sessionRecap', 'Session recap'),
      icon: <IcSessions size={14} />,
      tone: 'var(--acc2)',
      onClick: () => dispatchAgentEvent('surnia:run-recap'),
    },
    {
      label: t('wscc.dnaMap', 'What has SADEEM learned?'),
      icon: <IcDna size={14} />,
      tone: 'var(--ok)',
      onClick: () => {
        // rail 06 — DNA (setRail opens the sidebar when switching views)
        const wasDna = useStore.getState().rail === 'dna';
        setRail('dna');
        if (wasDna && !useStore.getState().sidebarOpen) useStore.getState().toggleSidebar();
      },
    },
    {
      // v11 — templates were buried in the palette; they get a real tile.
      label: t('wscc.newProjectTpl', 'New project'),
      icon: <IcFile size={14} />,
      tone: 'var(--acc)',
      onClick: () => useStore.getState().setNewProject(true),
    },
    {
      // v11 — scheduled jobs get a direct tile too (visibility rule).
      label: t('wscc.schedJobs', 'Scheduled jobs'),
      icon: <IcSessions size={14} />,
      tone: 'var(--amber)',
      onClick: () => {
        useStore.getState().setScheduled(true);
        useStore.getState().setRail('sessions');
      },
    },
  ];

  // 01 — activity feed: working-tree changes first, session pulse as fallback
  const activityFiles = (git?.changed ?? []).slice(0, 6);
  const statusTone = (s: string): 'warn' | 'ok' | 'bad' | 'acc' | 'default' => {
    if (s === 'M' || s.startsWith('M')) return 'warn';
    if (s === 'A' || s.startsWith('A')) return 'ok';
    if (s === 'D' || s.startsWith('D')) return 'bad';
    if (s === '??') return 'acc';
    return 'default';
  };
  // 'ok' maps to the sage accent (no separate stamp-ok exists in SURVEYOR)
  const stampFor = (s: string): string => {
    const tone = statusTone(s);
    if (tone === 'default') return 'stamp-clay';
    if (tone === 'ok') return 'stamp-acc';
    return `stamp-${tone}`;
  };

  return (
    <div className="page-v14 ws-page hgs-page flex flex-col min-h-0 h-full">
      {/* `pv14-stagger` removed: pages.css pv14-rise translates every direct
          child by 9px with staggered delays → stat grid + PROJECT FILES were
          painted at different offsets and collided. hgs-art.css keeps
          .ws-scroll transform-free — the collision must not return. */}
      <div className="ws-scroll ws-doc flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col">
        {/* ============ page header — editorial masthead ============ */}
        <div className="ws-page-head hgs-head">
        <PageHead
          eyebrow={lang === 'ar' ? '٠١ / مساحة العمل' : '01 / WORKSPACE'}
          title={wsPath ? base(wsPath) : t('ws.noWorkspace', 'No folder open')}
          description={lang === 'ar'
            ? 'ملفاتك وجلساتك ونشاط الوكيل — كلها في مكان واحد.'
            : 'Your files, sessions and agent activity — all in one place.'}
          toolbar={<span className="hgs-glyph" aria-hidden><WorkspaceGlyph /></span>}
          meta={wsPath ? (
            <>
              <span className="font-code text-[var(--faint)] truncate min-w-0" dir="ltr" title={wsPath}>
                {wsPath}
              </span>
              {git ? (
                <>
                  <span className="stamp stamp-acc max-w-[22ch]" title={`${t('sb.branch', 'branch')}: ${git.branch}`}>
                    <IcBranchMini size={11} className="shrink-0" />
                    <span className="truncate min-w-0" dir="ltr">{git.branch}</span>
                  </span>
                  {dirtyCount > 0 ? (
                    <span className="stamp stamp-warn tnum" title={t('git.changes', 'Changes')}>
                      {t('wscc.dirty', '{n} uncommitted').replace('{n}', String(dirtyCount))}
                    </span>
                  ) : (
                    <span className="stamp" title={t('wscc.clean', 'clean working tree')}>
                      {t('wscc.clean', 'clean working tree')}
                    </span>
                  )}
                </>
              ) : (
                <span className="stamp">
                  <IcBranchMini size={11} className="shrink-0" />
                  <span className="whitespace-nowrap">{t('sb.noRepo', 'no git repo')}</span>
                </span>
              )}
            </>
          ) : undefined}
          actions={
            <div className="ws-actions-cluster">
              <IconBtn
                className="!w-7 !h-7"
                title={t('ws.newFile', 'New file')}
                active={createMode === 'file'}
                onClick={() => {
                  setCreateMode(createMode === 'file' ? null : 'file');
                  setCreateName('');
                  setCreateDir(wsPath);
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLInputElement>('.pf-create-input')?.focus();
                  });
                }}
              >
                <FilePlus2 size={14} />
              </IconBtn>
              <IconBtn
                className="!w-7 !h-7"
                title={t('ws.newFolder', 'New folder')}
                active={createMode === 'dir'}
                onClick={() => {
                  setCreateMode(createMode === 'dir' ? null : 'dir');
                  setCreateName('');
                  setCreateDir(wsPath);
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLInputElement>('.pf-create-input')?.focus();
                  });
                }}
              >
                <FolderPlus size={14} />
              </IconBtn>
              <span className="ws-actions-sep" aria-hidden />
              <IconBtn className="!w-7 !h-7" title={t('ws.openFolder', 'Open folder')} onClick={() => void openFolderDialog()}>
                <FolderOpen size={14} />
              </IconBtn>
              <IconBtn className="!w-7 !h-7" title={t('ws.refresh', 'Refresh')} onClick={() => void refreshTree()}>
                <RefreshCw size={14} className={treeLoading ? 'spin' : undefined} />
              </IconBtn>
            </div>
          }
        />
        </div>{/* /ws-page-head */}

        {wsPath ? (
          <>
            {/* ============ STAT BAND — one bordered strip, hairline dividers.
                Four equal cells in a single frame: consistent height at every
                width, no floating boxes to collide with the section below. ============ */}
            <div className="ws-statband" role="group" aria-label={lang === 'ar' ? 'إحصاءات مساحة العمل' : 'Workspace statistics'}>
              <div className="ws-stat-cell" title={t('wscc.files', 'Files')}>
                <span className="ws-stat-label">{t('wscc.files', 'Files')}</span>
                <span className="ws-stat-value tnum" dir="ltr">{files.toLocaleString()}</span>
              </div>
              <div className="ws-stat-cell" title={t('wscc.sessionsCount', 'Sessions')}>
                <span className="ws-stat-label">{t('wscc.sessionsCount', 'Sessions')}</span>
                <span className="ws-stat-value tnum" dir="ltr">{wsSessions.length.toLocaleString()}</span>
              </div>
              <div className="ws-stat-cell" title={t('wscc.tokens', 'Tokens')}>
                <span className="ws-stat-label">{t('wscc.tokens', 'Tokens')}</span>
                <span className="ws-stat-value tnum" dir="ltr">{fmtTokens(totalTokens)}</span>
              </div>
              <div className="ws-stat-cell" title={t('wscc.lastActivity', 'Last activity')}>
                <span className="ws-stat-label">{t('wscc.lastActivity', 'Last activity')}</span>
                <span className="ws-stat-value">{lastActivity ? relTime(lastActivity, lang) : t('wscc.never', 'never')}</span>
              </div>
            </div>

            {/* ============ PROJECT FILES — the centrepiece, with its own
                editorial section boundary (mono index + drawn hairline) ============ */}
            <section id="project-files" className="ws-pf-section" aria-label={lang === 'ar' ? 'ملفات المشروع' : 'Project files'}>
              <div className="ws-sec-head">
                <span className="ws-sec-index">{lang === 'ar' ? '٠٢ / ملفات المشروع' : '02 / PROJECT FILES'}</span>
                <span className="ws-sec-hair" aria-hidden />
                <svg className="ws-sec-mark" viewBox="0 0 16 16" width="14" height="14" fill="none"
                  stroke="currentColor" strokeWidth="1" aria-hidden="true">
                  <path d="M8 0v5M8 11v5M0 8h5M11 8h5" />
                  <circle cx="8" cy="8" r="2.4" />
                </svg>
              </div>
              <ProjectFiles
                createMode={createMode}
                createName={createName}
                setCreateName={setCreateName}
                commitCreate={commitCreate}
                resetCreate={resetCreate}
              />
            </section>

            {/* ============ 01 — ACTIVITY ============ */}
            <Sec no="01" title={t('wscc.activity', 'Activity')}>
              <IconBtn
                className="!w-5 !h-5 -me-1"
                title={t('ws.refresh', 'Refresh')}
                onClick={() => void refreshTree()}
              >
                <RefreshCw size={11} className={treeLoading ? 'spin' : undefined} />
              </IconBtn>
            </Sec>
            <div className="px-3 shrink-0">
              {activityFiles.length > 0 ? (
                <div className="ws-quiet-list">
                  {activityFiles.map((c) => (
                    <button
                      key={`${c.status}:${c.path}`}
                      className="keyrow w-full text-start"
                      title={c.path}
                      onClick={() => void openFile(wsPath ? `${wsPath}/${c.path}`.replace(/\/+/g, '/') : c.path)}
                    >
                      {/* letter + tone stamp — the M/A/D letter is the non-color cue */}
                      <span
                        className={`stamp !h-[14px] !px-1 !text-[8.5px] shrink-0 ${stampFor(c.status)}`}
                        aria-label={c.status}
                      >
                        {c.status}
                      </span>
                      <span className="key-main">
                        <span className="key-sub !text-[10.5px] wscc-act-path">{c.path}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : recent.length > 0 ? (
                <div className="ws-quiet-list">
                  {recent.slice(0, 3).map((s) => (
                    <div key={s.id} className="keyrow" title={s.title}>
                      <span className="led led-idle shrink-0" aria-hidden />
                      <span className="key-main min-w-0">
                        {/* v2.6 RTL: dir=auto — Arabic titles read RTL, Latin LTR */}
                        <span className="key-title !text-[11.5px] truncate" dir="auto">{s.title}</span>
                      </span>
                      {/* v2.6 RTL: localized time in its own isolated span */}
                      <span className="text-[9.5px] text-faint shrink-0" dir="auto">{relTime(s.updatedAt, lang)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ws-note">
                  {t('wscc.noActivity', 'No changes recorded yet — edits and sessions will appear here')}
                </div>
              )}
            </div>

            {/* ============ 02 — QUICK ACTIONS ============ */}
            <Sec no="02" title={t('wscc.quick', 'Quick actions')} />
            <div className="px-3 shrink-0">
              <div className="grid grid-cols-2 gap-1.5">
                {quickActions.map((a) => (
                  <button
                    key={a.label}
                    className="qt-tile flex-col !items-start !gap-1.5 py-2"
                    onClick={a.onClick}
                    disabled={a.disabled}
                    title={a.label}
                  >
                    <IconTile icon={a.icon} tone={a.tone} size={20} />
                    <span className="qt-label whitespace-normal leading-snug">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ============ 03 — SESSIONS ============ */}
            <Sec no="03" title={t('wscc.recent', 'Sessions')} />
            <div className="px-3 shrink-0">
              {recent.length > 0 ? (
                <div className="ws-quiet-list">
                  {recent.map((s) => (
                    <button
                      key={s.id}
                      className="keyrow w-full text-start"
                      title={s.title}
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('surnia:session-loading'));
                        void openSession(s.id).finally(() => window.dispatchEvent(new CustomEvent('surnia:session-loaded')));
                      }}
                    >
                      <IcSessions size={13} className="text-acc2 shrink-0" />
                      <span className="key-main min-w-0">
                        {/* v2.6 RTL: dir=auto on the title — Arabic titles type and
                            truncate RTL, Latin LTR; block display (chat.css v2.6)
                            keeps it on its own line so it can never touch the meta */}
                        <span className="key-title truncate" dir="auto">{s.title}</span>
                        {/* v2.6 RTL: meta is its own flex row (key-sub-flex, ≥gap-1.5)
                            with an explicit '·' separator; the localized time word
                            ("الآن") is isolated in its own dir=auto span, while the
                            token count stays LTR technical data */}
                        <span className="key-sub key-sub-flex">
                          <span dir="auto">{relTime(s.updatedAt, lang)}</span>
                          <span className="text-faint" aria-hidden="true">·</span>
                          <span className="tnum" dir="ltr">{fmtTokens(s.totalTokens)}</span>
                        </span>
                      </span>
                      {/* bare count — a lone digit run cannot bidi-reorder */}
                      <Kbd className="!h-[15px] !px-1 !text-[9px] shrink-0 tnum">{s.messageCount}</Kbd>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="ws-note">{t('wscc.noSessions', 'No sessions in this workspace yet')}</div>
              )}
            </div>

            {/* ============ 04 — MCP STATUS (v11: always visible) ============ */}
            {true && (
              <>
                <Sec no="04" title={t('wscc.mcpStatus', 'MCP status')} />
                <div className="px-3 shrink-0">
                  <div className="ws-quiet-list">
                    {(mcpServers ?? []).length === 0 && (
                      <div className="px-3 py-2.5 flex items-center gap-2 flex-wrap">
                        <span className="text-[10.5px] text-faint flex-1 min-w-0">
                          {t('wscc.mcpEmpty', 'No MCP servers yet — connect one to extend the agent.')}
                        </span>
                        <button
                          className="stamp stamp-acc cursor-pointer"
                          onClick={() => window.dispatchEvent(new CustomEvent('surnia:open-settings', { detail: { section: 'mcp' } }))}
                        >
                          {t('wscc.mcpAdd', 'Add MCP server')}
                        </button>
                      </div>
                    )}
                    {(mcpServers ?? []).map((cfg) => {
                      const h = mcpHealth?.find((x) => x.id === cfg.id);
                      const state = h?.status ?? (cfg.enabled === false ? 'disabled' : 'starting');
                      return (
                        <div key={cfg.id} className="keyrow" title={h?.lastError || cfg.id}>
                          <span className="wscc-mcp-dot" data-state={mcpDotState(state)} aria-label={state} />
                          <span className="key-main">
                            <span className="key-title !text-[11.5px]">{h?.name ?? cfg.name ?? cfg.id}</span>
                            <span className="key-sub" dir="ltr">
                              {state}
                              {h?.toolCount ? ` · ${h.toolCount} tools` : ''}
                            </span>
                          </span>
                          <span className="tnum text-[9.5px] text-dim shrink-0" dir="ltr" title={t('wscc.latency', 'Latency')}>
                            {h?.latencyMs != null ? `${h.latencyMs}ms` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* ============ 05 — SCHEDULED (v11: always visible) ============ */}
            {true && (
              <>
                <Sec no="05" title={t('wscc.scheduled', 'Scheduled')} />
                <div className="px-3 shrink-0">
                  <div className="ws-quiet-list">
                    {nextJobs.length === 0 && (
                      <div className="px-3 py-2.5 flex items-center gap-2 flex-wrap">
                        <span className="text-[10.5px] text-faint flex-1 min-w-0">
                          {t('wscc.schedEmpty', 'No scheduled jobs yet — put agent work on a cron.')}
                        </span>
                        <button
                          className="stamp stamp-acc cursor-pointer"
                          onClick={() => {
                            useStore.getState().setScheduled(true);
                            useStore.getState().setRail('sessions');
                          }}
                        >
                          {t('wscc.schedNew', 'New scheduled job')}
                        </button>
                      </div>
                    )}
                    {nextJobs.map(({ job, at }) => (
                      <button
                        key={job.id}
                        className="keyrow w-full text-start"
                        title={job.prompt}
                        onClick={() => {
                          if (!job.sessionId) return;
                          window.dispatchEvent(new CustomEvent('surnia:session-loading'));
                          void openSession(job.sessionId).finally(() =>
                            window.dispatchEvent(new CustomEvent('surnia:session-loaded')),
                          );
                        }}
                      >
                        <span className={`stamp shrink-0 ${job.enabled ? 'stamp-acc' : ''}`}>
                          {job.enabled ? t('sched.state.active', 'ACTIVE') : t('sched.state.paused', 'PAUSED')}
                        </span>
                        <span className="key-main">
                          <span className="key-title !text-[11.5px]">{job.name}</span>
                        </span>
                        <span className="tnum text-[9.5px] text-faint shrink-0" dir="ltr" title={job.cron}>
                          {at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ============ 06 — FILE TYPES ============ */}
            <Sec no="06" title={t('wscc.fileTypes', 'File types')} />
            <div className="px-3 shrink-0">
              <div className="ws-types-card ws-quiet-list">
                {langs.length > 0 ? (
                  <>
                    {/* v2.6 RTL: the legend is technical Latin data (ext + count) —
                        the bar and the chip row stay LTR even in the Arabic UI,
                        exactly like the editor status line. Per-chip flex items
                        with real gaps; no string concatenation anywhere. */}
                    <div className="seg-bar" dir="ltr" role="img" aria-label={t('wscc.fileTypes', 'File types')}>
                      {langs.map((l) => (
                        <span
                          key={l.ext}
                          style={{ width: `${Math.max(3, (l.count / langsTotal) * 100)}%`, background: l.tone }}
                          title={`${l.ext} · ${l.count}`}
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-2.5 gap-y-1 mt-2" dir="ltr">
                      {langs.map((l) => (
                        <span key={l.ext} className="inline-flex items-center gap-1 text-[11px] text-dim min-w-0 shrink-0">
                          <span className="w-[7px] h-[7px] rounded-[1px] shrink-0" style={{ background: l.tone }} />
                          <span className="tnum" dir="ltr">
                            {l.ext}
                          </span>
                          <span className="text-faint tnum" dir="ltr">{l.count}</span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="ws-note">{t('wscc.noFiles', 'No files indexed yet')}</div>
                )}
              </div>
            </div>

            {/* ============ 07 — MEMORY ============ */}
            <Sec no="07" title={t('wscc.memory', 'Project memory')}>
              {editingMemory ? (
                <>
                  <IconBtn className="!w-5 !h-5 -me-1" title={t('misc.save', 'Save')} disabled={memorySaving} onClick={() => void saveMemory()}>
                    {memorySaving ? <Spinner size={11} /> : <Save size={11} />}
                  </IconBtn>
                  <IconBtn
                    className="!w-5 !h-5 -me-1"
                    title={t('ws.cancel', 'Cancel')}
                    onClick={() => {
                      setEditingMemory(false);
                      setMemoryDraft('');
                    }}
                  >
                    <X size={11} />
                  </IconBtn>
                </>
              ) : (
                <IconBtn
                  className="!w-5 !h-5 -me-1"
                  title={t('ws.rename', 'Edit')}
                  disabled={!memory}
                  onClick={() => {
                    setMemoryDraft(memory ?? '');
                    setEditingMemory(true);
                  }}
                >
                  <Pencil size={11} />
                </IconBtn>
              )}
            </Sec>
            <div className="px-3 shrink-0">
              <div className="aurora-panel bg-[var(--bg1)] overflow-hidden">
                {memoryLoading ? (
                  <div className="p-2.5 flex flex-col gap-2" aria-label={t('misc.loading', 'Loading…')}>
                    <div className="skel-row skeleton-shimmer" />
                    <div className="skel-row skeleton-shimmer" style={{ height: 12 }} />
                    <div className="skel-row skeleton-shimmer" style={{ height: 12 }} />
                  </div>
                ) : editingMemory ? (
                  <textarea
                    autoFocus
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void saveMemory();
                      }
                    }}
                    spellCheck={false}
                    dir="auto"
                    className="w-full bg-transparent outline-none resize-none tnum text-[11px] leading-relaxed p-2.5 min-h-[120px] max-h-[220px] select-text"
                  />
                ) : memory && memory.trim() ? (
                  <div className="p-2.5">
                    {memory
                      .split('\n')
                      .slice(0, 8)
                      .map((line, i) => (
                        <div key={i} className="text-[11px] leading-[1.55] text-dim whitespace-pre-wrap break-words select-text">
                          {line || '\u00A0'}
                        </div>
                      ))}
                    {memory.split('\n').length > 8 && (
                      <div className="tnum text-[9.5px] text-faint mt-1.5">
                        +{memory.split('\n').length - 8} {lang === 'ar' ? 'سطراً' : 'more lines'}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 text-[10.5px] text-faint leading-relaxed">{t('wscc.memoryEmpty', 'No MEMORY.md yet — run /init to generate one')}</div>
                )}
              </div>
            </div>

            {/* ============ 08 — WORKTREES ============ */}
            <Sec no="08" title={t('wscc.worktrees', 'Worktrees')} />
            <div className="px-3 pb-1 shrink-0">
              {worktrees === null ? null : worktrees.length === 0 ? (
                <div className="ws-note">{t('wscc.worktreeEmpty', 'No worktrees — create one to run agents in parallel')}</div>
              ) : (
                <div className="ws-quiet-list">
                  {worktrees.map((wt) => (
                    <div key={wt.name} className={`keyrow !items-start${session?.worktree?.name === wt.name ? ' wt-current' : ''}`} title={wt.path}>
                      <IcGit size={13} className="text-acc2 shrink-0 mt-0.5" />
                      <div className="key-main">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11.5px] font-medium truncate min-w-0" dir="ltr">
                            {wt.name}
                          </span>
                          {wt.dirty && <span className="w-[6px] h-[6px] rounded-full bg-warn shrink-0" title="dirty" />}
                          {session?.worktree?.name === wt.name && (
                            <span className="stamp stamp-acc !h-[14px] !px-1.5 !text-[8px] shrink-0">
                              {t('wscc.wtThisChat', 'THIS CHAT')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[9.5px] text-faint mt-0.5 min-w-0">
                          <span className="tnum truncate min-w-0" dir="ltr">
                            {wt.branch}
                          </span>
                          <span className="shrink-0">·</span>
                          <span className="shrink-0 whitespace-nowrap">
                            {t('wscc.createdRel', 'created {0}').replace('{0}', relTime(wt.createdAt || Date.now(), lang))}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <IconBtn
                          className="!w-6 !h-6"
                          title={t('wscc.wtRunHere', 'Run THIS chat in this worktree (hand-off)')}
                          disabled={wtBusy}
                          onClick={() => void setSessionWorktree(wt.name)}
                        >
                          <Play size={12} />
                        </IconBtn>
                        <IconBtn className="!w-6 !h-6" title={t('wscc.worktreeMerge', 'Merge')} disabled={wtBusy} onClick={() => void mergeWorktree(wt)}>
                          <GitMerge size={12} />
                        </IconBtn>
                        <IconBtn className="!w-6 !h-6" title={t('wscc.worktreeRemove', 'Remove')} disabled={wtBusy} onClick={() => void removeWorktree(wt)}>
                          <Trash2 size={12} />
                        </IconBtn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* create worktree inline form */}
              <div className="flex items-center gap-1.5 mt-1.5">
                <TextInput
                  value={wtName}
                  placeholder={t('wscc.worktreeNew', 'New worktree')}
                  className="h-7 !text-[11.5px] flex-1 min-w-0"
                  onChange={(e) => setWtName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void createWorktree();
                    }
                  }}
                />
                <Btn className="!h-7 !px-2.5 shrink-0" disabled={!wtName.trim() || wtBusy} onClick={() => void createWorktree()}>
                  <Plus size={12} />
                </Btn>
              </div>
            </div>
          </>
        ) : null}

        {/* ============ content search (separate from the file-name filter) ============ */}
        <div className="px-3 pt-3 pb-2 border-t border-line mt-1 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 text-faint pointer-events-none" style={{ insetInlineStart: 10 }} />
            <TextInput
              value={q}
              placeholder={t('ws.searchContents', 'Search file contents…')}
              className="ps-8 h-7 !text-[12px] pe-8 !rounded-full"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
              }}
            />
            {hasQuery && (
              <button
                className="ibtn !w-8 !h-8 absolute top-1/2 -translate-y-1/2"
                style={{ insetInlineEnd: 3 }}
                title={t('search.clear', 'Clear')}
                aria-label={t('search.clear', 'Clear')}
                onClick={() => setQ('')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ============ CONTENT SEARCH — results only. The file tree now has
            its own PROJECT FILES section above; no duplicate tree here. ============ */}
        {hasQuery && (
          <div className="flex-1 min-h-[120px]">
            {searchResults === null || searching ? (
              <div className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-faint">
                <Spinner size={12} />
                {t('misc.loading', 'Loading…')}
              </div>
            ) : searchResults.length === 0 ? (
              <Empty icon={<Search size={22} />} title={t('ws.noResults', 'No results')} />
            ) : (
              <div className="py-1">
                {groupByFile(searchResults).map((g) => (
                  <div key={g.path}>
                    <div className="wsp-filehead h-[24px] flex items-center gap-1.5 px-2.5 sticky top-0 z-10">
                      <FileCode2 size={12} className="text-acc2 shrink-0" />
                      <span className="text-[11px] font-semibold truncate min-w-0" title={g.path}>
                        {base(g.path)}
                      </span>
                      <span className="ms-auto text-[9.5px] text-faint tnum shrink-0">{g.hits.length}</span>
                    </div>
                    {g.hits.map((hit, i) => (
                      <button
                        key={`${hit.path}:${hit.line}:${i}`}
                        className="wsp-row w-full text-start flex items-baseline gap-2 px-3 py-[3px] cursor-pointer min-w-0"
                        title={`${hit.path}:${hit.line}`}
                        onClick={() => void openFile(hit.path)}
                      >
                        <Kbd className="shrink-0 tnum">{hit.line}</Kbd>
                        <span className="text-[11px] text-faint truncate min-w-0 tnum" dir="ltr" style={{ textAlign: 'left' }}>
                          <MatchLine text={hit.text} q={q.trim()} />
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                {/* result cap note — mirrors the global SearchPanel wording */}
                {searchResults.length >= 500 && (
                  <div className="px-3 py-2 text-[10.5px] text-warn text-center">
                    {t('search.capped', 'Result limit reached — refine your query to see more')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspacePanel;
