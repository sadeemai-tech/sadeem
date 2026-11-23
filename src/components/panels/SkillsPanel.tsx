// SkillsPanel — Rail view 08 (v5) · the skill library manager.
// Three scopes: this workspace (.surnia/skills) → global library
// (<userData>/skills) → built-in (shipped). Create from scratch, import a
// folder, fork a built-in to edit it, delete what you own. The agent sees
// the merged index in its SKILLS prompt section and can load bodies with
// use_skill — everything here is plain markdown folders on disk.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, FolderDown, FolderPlus, MoreHorizontal, PenLine, Plus, Save, ShieldCheck, Store, Trash2 } from 'lucide-react';
import type { SkillInfo } from '../../../shared/types';
import { api, type RivalSkillSource, type MarketplaceSkill } from '../../lib/api';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { Btn, SectionTitle, Spinner } from '../ui';
import { PageHead } from '../pages';
import '../workspace.css';
import '../pages.css';
import './skills-art.css';
import './panel-craft.css';

type Scope = 'workspace' | 'global' | 'builtin';

const SCOPE_ORDER: Scope[] = ['workspace', 'global', 'builtin'];

/** Open one skill's detail view (list row → body + companion files).
 *  Exported for the v1121 SSR crash-regression harness (no render-phase
 *  state updates — all fetches live in this effect). */
export function SkillDetail({ ws, slug, onBack, editable = false }: { ws: string; slug: string; onBack: () => void; editable?: boolean }) {
  const t = useT();
  const notify = useStore((s) => s.notify);
  const [skill, setSkill] = useState<Awaited<ReturnType<typeof api.skillsRead>>>(null);
  const [fileBody, setFileBody] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(true);
  // v11.36 — real edit mode (the More actions → Edit handler opens this with
  // editable=true). Drafts are seeded from the loaded skill, never invented.
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void (async () => {
      const s = await api.skillsRead(ws, slug).catch(() => null);
      if (!alive) return;
      setSkill(s);
      if (s) {
        setDraftName(s.name);
        setDraftDescription(s.description ?? '');
        setDraftBody(s.body ?? '');
      }
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [ws, slug]);

  const saveEdit = async () => {
    if (!skill || saving || draftName.trim().length < 2 || draftBody.trim().length < 10) return;
    setSaving(true);
    try {
      const scope = skill.scope === 'global' ? 'global' : 'workspace';
      const savedSlug = await api.skillsSave(ws,
        { name: draftName.trim(), description: draftDescription.trim(), body: draftBody }, scope);
      notify(t('skills.saved', 'Skill saved') + `: ${savedSlug || slug}`);
      onBack();
    } catch (err) {
      notify(String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  if (busy) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner size={18} />
      </div>
    );
  }
  if (!skill) {
    return (
      <div className="p-4 text-[12.5px] text-dim">
        {t('skills.notFound', 'Skill not found.')}
        <div className="mt-3">
          <Btn onClick={onBack}>{t('skills.back', 'Back')}</Btn>
        </div>
      </div>
    );
  }
  const scope = (skill.scope ?? 'workspace') as Scope;

  return (
    <div className="flex flex-col gap-3 p-3 min-h-0">
      <div className="flex items-center gap-2">
        <Btn onClick={onBack} variant="ghost" aria-label={t('skills.back', 'Back')} title={t('skills.back', 'Back')}>
          <ArrowLeft size={13} />
        </Btn>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold truncate">{skill.name}</div>
          <div className="text-[11.5px] text-dim truncate" dir="auto">
            {skill.description || '—'}
          </div>
        </div>
        <span className="stamp stamp-acc !h-[16px] !text-[9px]">{scope}</span>
      </div>

      {editable ? (
        <div className="flex flex-col gap-2">
          <input
            className="h-8 px-2 text-[13px] bg-[var(--bg2)] border border-line rounded-[8px] outline-none focus:border-[var(--line-accent)]"
            placeholder={t('skills.namePh', 'Skill name — e.g. Deploy checklist')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            dir="auto"
            aria-label={t('skills.name', 'Skill name')}
          />
          <input
            className="h-8 px-2 text-[12.5px] bg-[var(--bg2)] border border-line rounded-[8px] outline-none focus:border-[var(--line-accent)]"
            placeholder={t('skills.descPh', 'One-line description used for matching')}
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            dir="auto"
            aria-label={t('skills.desc', 'Skill description')}
          />
          <textarea
            className="min-h-[220px] p-2 text-[12.5px] leading-[1.55] bg-[var(--bg2)] border border-line rounded-[10px] outline-none focus:border-[var(--line-accent)] resize-y select-text"
            placeholder={t('skills.bodyPh', 'Markdown instructions the agent follows when the skill is used…')}
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            dir="auto"
            aria-label={t('skills.action.edit', 'Edit skill')}
          />
          <div className="flex items-center gap-2">
            <span className="stamp stamp-acc !h-[16px] !text-[9px]">{scope}</span>
            <div className="flex-1" />
            <Btn
              variant="primary"
              disabled={saving || draftName.trim().length < 2 || draftBody.trim().length < 10}
              onClick={() => void saveEdit()}
            >
              {saving ? <Spinner size={12} /> : <Save size={12} />}
              {t('skills.save', 'Save skill')}
            </Btn>
          </div>
        </div>
      ) : (
        <pre className="text-[12.5px] leading-[1.6] whitespace-pre-wrap break-words bg-[var(--bg2)] border border-line rounded-[10px] p-3 overflow-auto max-h-[46vh] select-text" dir="auto">
          {skill.body}
        </pre>
      )}

      {fileBody ? (
        <div className="min-h-0">
          <div className="sec-titled">
            <span className="sec-no">02</span>
            <span className="sec-tt flex-1 truncate">{fileBody.name}</span>
            <button className="press text-dim" onClick={() => setFileBody(null)} aria-label="close">
              ×
            </button>
          </div>
          <pre className="text-[12px] leading-[1.55] whitespace-pre-wrap break-words bg-[var(--bg2)] border border-line rounded-[10px] p-3 overflow-auto max-h-[30vh] select-text" dir="ltr">
            {fileBody.text}
          </pre>
        </div>
      ) : (skill.files?.length ?? 0) > 0 ? (
        <div>
          <div className="sec-titled">
            <span className="sec-no">02</span>
            <span className="sec-tt">scripts · references · assets</span>
          </div>
          <div className="flex flex-col gap-1">
            {(skill.files ?? []).map((f) => (
              <button
                key={f}
                className="tree-row"
                onClick={async () => {
                  try {
                    const text = await api.skillsReadFile(ws, slug, f, scope);
                    setFileBody({ name: f, text });
                  } catch (err) {
                    notify(String((err as Error)?.message ?? err));
                  }
                }}
              >
                <span className="tree-name truncate" dir="ltr">
                  {f}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The add-skill form ("SkillComposer" in the founder's wording).
 *  Exported for the v1121 SSR crash-regression harness. */
export function NewSkillForm({ ws, onDone }: { ws: string; onDone: (slug: string) => void }) {
  const t = useT();
  const notify = useStore((s) => s.notify);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<'workspace' | 'global'>('workspace');
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length >= 2 && body.trim().length >= 10;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const slug = await api.skillsSave(ws, { name: name.trim(), description: description.trim(), body }, scope);
      notify(t('skills.saved', 'Skill saved') + `: ${slug}`);
      onDone(slug);
    } catch (err) {
      notify(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <input
        className="h-8 px-2 text-[13px] bg-[var(--bg2)] border border-line rounded-[8px] outline-none focus:border-[var(--line-accent)]"
        placeholder={t('skills.namePh', 'Skill name — e.g. Deploy checklist')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        dir="auto"
      />
      <input
        className="h-8 px-2 text-[12.5px] bg-[var(--bg2)] border border-line rounded-[8px] outline-none focus:border-[var(--line-accent)]"
        placeholder={t('skills.descPh', 'One-line description used for matching')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        dir="auto"
      />
      <textarea
        className="min-h-[180px] p-2 text-[12.5px] leading-[1.55] bg-[var(--bg2)] border border-line rounded-[8px] outline-none focus:border-[var(--line-accent)] resize-y select-text"
        placeholder={t('skills.bodyPh', 'Markdown instructions the agent follows when the skill is used…')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        dir="auto"
      />
      <div className="flex items-center gap-2">
        <select
          className="h-7 px-1.5 text-[12px] bg-[var(--bg2)] border border-line rounded-[8px]"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'workspace' | 'global')}
        >
          <option value="workspace">{t('skills.scope.workspace', 'This workspace')}</option>
          <option value="global">{t('skills.scope.global', 'All projects (global)')}</option>
        </select>
        <div className="flex-1" />
        <Btn variant="primary" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? <Spinner size={12} /> : t('skills.save', 'Save skill')}
        </Btn>
      </div>
    </div>
  );
}

/** v11.36 — the REAL per-skill "More actions" menu.
 *  The founder's complaint was literal: the ⋯ control was a dead no-op, so
 *  clicking it showed nothing. Every item below calls a real handler that acts
 *  on the real skill store (read/save/delete/fork through the api bridge).
 *  `initialOpen` exists ONLY so the SSR harness can render the open menu and
 *  assert the items are real (no dead buttons); normal use starts closed. */
export function SkillActionsMenu({
  scope,
  actions,
  initialOpen = false,
}: {
  scope: Scope;
  actions: {
    onInspect: () => void;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
  };
  initialOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(initialOpen);
  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };
  // A built-in skill is read-only on disk: its "duplicate" is an honest fork,
  // and it has no Edit/Delete (those would be dead controls that fail on disk).
  const items = scope === 'builtin'
    ? [
        { key: 'inspect', ico: BookOpen, label: t('skills.action.inspect', 'Inspect skill'), run: actions.onInspect },
        { key: 'duplicate', ico: FolderDown, label: t('skills.fork', 'Copy to edit'), run: actions.onDuplicate },
      ]
    : [
        { key: 'inspect', ico: BookOpen, label: t('skills.action.inspect', 'Inspect skill'), run: actions.onInspect },
        { key: 'edit', ico: PenLine, label: t('skills.action.edit', 'Edit skill'), run: actions.onEdit },
        { key: 'duplicate', ico: FolderDown, label: t('skills.action.duplicate', 'Duplicate skill'), run: actions.onDuplicate },
        { key: 'delete', ico: Trash2, label: t('skills.delete', 'Delete'), run: actions.onDelete },
      ];
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="press text-faint hover:text-acc opacity-70 hover:opacity-100 transition-opacity"
        title={t('skills.more', 'More actions')}
        aria-label={t('skills.more', 'More actions')}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="skill-more-actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[61]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-hidden />
      )}
      {open && (
        <div
          className="glass-menu absolute z-[62] top-[calc(100%+4px)] end-0 min-w-[156px] py-1 rounded-[10px] anim-glass-pop"
          style={{ insetInlineEnd: 0 }}
          role="menu"
          data-testid="skill-actions-menu"
        >
          {items.map(({ key, ico: Ico, label, run: fn }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              data-testid={`skill-action-${key}`}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-dim hover:text-[var(--ink)] hover:bg-[var(--hover-2)]"
              onClick={run(fn)}
            >
              <Ico size={12} className="shrink-0" />
              <span className="truncate" dir="auto">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   EDITORIAL ART — presentation only. The ladder's rungs and marker
   positions come from REAL confidence values already in the store
   (learned-pattern trust); no number is invented. Motion guarded
   by prefers-reduced-motion + html.reduce-motion.
   ============================================================ */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    if (
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      root.classList.contains('reduce-motion') ||
      typeof IntersectionObserver === 'undefined'
    ) {
      el.setAttribute('data-in', 'true');
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        el.setAttribute('data-in', 'true');
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Original 1px glyph — ascending steps, a skill earning trust. */
function SkillsGlyph() {
  return (
    <span className="sk-glyph" aria-hidden="true">
      <svg viewBox="0 0 72 34" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <path d="M6 28h14v-7h14v-7h14V7h14" />
        <path d="M6 31h60" opacity=".35" />
        <circle className="sk-g-dot" cx="62" cy="7" r="2" />
      </svg>
    </span>
  );
}

/** A confidence ladder on a true 0–100% scale. Every rung sits at an exact
 *  multiple of GAP from the same top origin (equal spacing — no pixel drift);
 *  the baseline carries 0/25/50/75/100 axis ticks and the marker's x is the
 *  real confidence value projected onto that same axis. Empty state honest. */
function ConfidenceLadder({ values, ar }: { values: number[]; ar: boolean }) {
  const ref = useInView<HTMLDivElement>();
  const shown = values.slice(0, 5);
  const W = 540, H = 176;
  const L = 46, R = 22;                 // scale: x=L → 0%, x=W-R → 100%
  const AXIS_TOP = 25, GAP = 28;        // equal rung pitch
  const AX = W - R;
  const SPAN = AX - L;
  const BASE = AXIS_TOP + GAP * 4;      // last of the five rung rows
  const xOf = (v: number) => L + SPAN * Math.min(1, Math.max(0, v));
  const rubric = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div ref={ref} className="sk-ladder sk-reveal">
      <div className="sk-ladder-head">
        <span className="sk-ladder-fig">{ar ? 'اللوحة ٠٤ / سلم الثقة' : 'PLATE 04 / CONFIDENCE LADDER'}</span>
        <span className="sk-ladder-cap">
          {ar ? 'قيم حقيقية من الأنماط المتعلَّمة' : 'real values from learned patterns'}
        </span>
      </div>
      <svg className="craft-svg sk-ladder-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={ar ? 'سلم ثقة المهارات' : 'Skill confidence ladder'}>
        {/* 0–100 axis ticks along the baseline — exact quarters */}
        {rubric.map((f, i) => {
          const x = xOf(f);
          return (
            <g key={f}>
              <line className="craft-sk-tick" x1={x} y1={BASE - 4} x2={x} y2={BASE + 4} />
              <text className="craft-txt" x={x} y={BASE + 16} textAnchor="middle">{Math.round(f * 100)}</text>
              <line className="craft-sk-tick craft-draw" pathLength={1} x1={x} y1={AXIS_TOP - 8} x2={x} y2={BASE + 4}
                style={{ animationDelay: `${i * 60}ms` }} />
            </g>
          );
        })}
        <line className="craft-sk-axis craft-draw" pathLength={1} x1={L} y1={BASE + 4} x2={AX} y2={BASE + 4}
          style={{ animationDelay: '300ms' }} />
        {shown.length === 0 ? (
          <text className="craft-txt" x={L} y={AXIS_TOP + 4}>
            {ar ? 'لا توجد قيم ثقة مسجَّلة بعد' : 'no confidence values recorded yet'}
          </text>
        ) : shown.map((v, i) => {
          // every rung is EXACTLY GAP below the previous — no off-by-pixel
          const y = AXIS_TOP + i * GAP;
          const pct = Math.round(v * 100);
          const mx = xOf(v);
          return (
            <g key={i}>
              <line className="craft-sk-rung craft-draw" pathLength={1} x1={L} y1={y} x2={AX} y2={y}
                style={{ animationDelay: `${i * 60 + 80}ms` }} />
              <line className="craft-sk-markline" x1={mx} y1={y - 7} x2={mx} y2={y + 7} />
              <circle className="craft-sk-marker" cx={mx} cy={y} r="3" />
              <text className="craft-sk-num" x={L - 10} y={y + 3} textAnchor="end">{String(i + 1).padStart(2, '0')}</text>
              <text className="craft-sk-val" x={mx > AX - 30 ? AX - 2 : mx + 6} y={y + 3}
                textAnchor={mx > AX - 30 ? 'end' : 'start'}>{pct}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SkillsPanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const skillAr = useStore((s) => s.settings?.language ?? 'en') === 'ar';
  // #300 GUARD — the selector returns ONLY the slice reference. A selector
  // that returned a fresh array (e.g. `.map().sort()` inline) would hand
  // zustand/React a different `getSnapshot` value on every call → infinite
  // re-render (minified React error #300). Derivation is memoized below.
  const dnaPatterns = useStore((s) => s.dna?.patterns);
  const skillConfidences = useMemo(
    () => (dnaPatterns ?? []).map((p) => p.confidence).sort((a, b) => b - a),
    [dnaPatterns],
  );
  const wsPath = useStore((s) => s.wsPath);
  const notify = useStore((s) => s.notify);
  // v11.38 — a listed skill must be USABLE, not merely visible. This is the
  // real bridge that queues the exact use_skill call into the composer.
  const insertIntoComposer = useStore((s) => s.insertIntoComposer);
  // v5 consent gate — same store wiring the DNA panel uses; a workspace
  // carrying skills needs an explicit trust decision (warn tone, never red).
  const skillsTrustNeeded = useStore((s) => s.skillsTrustNeeded);
  const trustWorkspaceSkills = useStore((s) => s.trustWorkspaceSkills);
  const ws = wsPath || '.';
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  // v11.9 — skill scope roots (kdx:skills:roots): where workspace / global
  // skills live on disk, surfaced as a faint header hint (honest paths).
  const [roots, setRoots] = useState<{ global: string; workspace: string } | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  // v11.36 — More actions → Edit opens the SAME detail view in edit mode.
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // v1142 — ONE entry point for every "add skill" path. The old UI had three
  // competing controls (New + folder-import icons, a Marketplace footer, a
  // rival-import footer); the menu below keeps every handler but one button.
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  // v6.1 — "Import from other agents": skills kept by rival coding tools
  // (Claude Code / Codex / OpenCode / Antigravity / Gemini CLI) on this machine.
  const [rivalsOpen, setRivalsOpen] = useState(false);
  const [rivals, setRivals] = useState<RivalSkillSource[] | null>(null);
  const [rivalScope, setRivalScope] = useState<'workspace' | 'global'>('workspace');
  const [importingId, setImportingId] = useState<string | null>(null);
  // v12 — bundled skills marketplace (one-click install to global scope).
  const [marketOpen, setMarketOpen] = useState(false);
  const [market, setMarket] = useState<MarketplaceSkill[] | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await api.skillsManagerList(ws).catch(() => null);
    setSkills(list ?? []);
  }, [ws]);
  // #300 GUARD — a stable callback prop for the detail view. An inline arrow
  // here is harmless on its own, but a new function in an effect dep list of
  // a child is the other classic #300 trigger; keep it referentially stable.
  const closeDetail = useCallback(() => {
    setOpenSlug(null);
    setEditSlug(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // v11.9 — one-shot roots fetch (defensive: legacy bridge may lack the method)
  useEffect(() => {
    let alive = true;
    if (typeof api.skillsRoots !== 'function') return;
    void (async () => {
      const r = await api.skillsRoots(ws).catch(() => null);
      if (alive) setRoots(r && typeof r.global === 'string' ? r : null);
    })();
    return () => {
      alive = false;
    };
  }, [ws]);

  // v1142 — the Marketplace detail is now opened from the single Add menu.
  // Load the catalog exactly once per open; a failed fetch is never disguised
  // as "no skills" (same honest error path the old footer button used).
  useEffect(() => {
    if (!marketOpen || market !== null) return;
    setMarketError(null);
    let alive = true;
    void api.skillsMarketplaceList(ws)
      .then((m) => { if (alive) setMarket(m); })
      .catch((err) => {
        // Never disguise a failed catalog fetch as "no skills".
        if (!alive) return;
        setMarket([]);
        setMarketError(String((err as Error)?.message ?? err) || t('skills.market.loadFailed', 'Could not load the marketplace.'));
      });
    return () => { alive = false; };
  }, [marketOpen, market, ws]);

  const filtered = useMemo(() => {
    const list = skills ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.slug.includes(q),
    );
  }, [skills, query]);

  const grouped = useMemo(() => {
    const map = new Map<Scope, SkillInfo[]>();
    for (const sc of SCOPE_ORDER) map.set(sc, []);
    for (const s of filtered) {
      const sc = (s.scope ?? 'workspace') as Scope;
      map.get(sc)?.push(s);
    }
    for (const sc of SCOPE_ORDER) map.get(sc)?.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [filtered]);

  // ---------- v6.1 — rival agents (detect + bulk import) ----------
  // #300 GUARD — this useCallback MUST stay above the early returns below.
  // Hooks are counted by CALL ORDER: when the list view called it but the
  // detail/create views returned early before it, React saw a different
  // hook count on the next render and threw
  // "Rendered more hooks than during the previous render" (#300).
  const loadRivals = useCallback(async () => {
    const list = await api.rivalsSkills().catch(() => [] as RivalSkillSource[]);
    setRivals(Array.isArray(list) ? list : []);
  }, []);

  if (openSlug) {
    return <SkillDetail ws={ws} slug={openSlug} onBack={closeDetail} />;
  }
  if (editSlug) {
    return <SkillDetail ws={ws} slug={editSlug} onBack={closeDetail} editable />;
  }
  if (creating) {
    return (
      <div className="flex flex-col min-h-0">
        <div className="flex items-center gap-2 p-3 pb-0">
          <Btn onClick={() => setCreating(false)} variant="ghost" aria-label={t('skills.back', 'Back')} title={t('skills.back', 'Back')}>
            <ArrowLeft size={13} />
          </Btn>
          <div className="text-[14px] font-semibold">{t('skills.new', 'New skill')}</div>
        </div>
        <NewSkillForm
          ws={ws}
          onDone={(slug) => {
            setCreating(false);
            setOpenSlug(slug);
            void reload();
          }}
        />
      </div>
    );
  }

  const importFolder = async () => {
    try {
      const dir = await api.openFolderDialog();
      if (!dir) return; // cancelled — not a failure
      const slug = await api.skillsImportDir(ws, dir, 'global');
      if (slug) {
        notify(t('skills.imported', 'Skill imported') + `: ${slug}`);
        await reload();
        setOpenSlug(slug);
      } else {
        notify(t('skills.importFailed', 'Could not import — the folder must contain a SKILL.md file.'));
      }
    } catch (err) {
      notify(String((err as Error)?.message ?? err) || t('skills.importFailed', 'Could not import — the folder must contain a SKILL.md file.'));
    }
  };

  const forkBuiltin = async (slug: string) => {
    const forked = await api.skillsForkBuiltin(ws, slug, 'global').catch(() => null);
    if (forked) {
      notify(t('skills.forked', 'Copied to your global library for editing'));
      await reload();
      setOpenSlug(forked);
    } else {
      // A fork icon that does nothing on failure is a dead control.
      notify(t('skills.forkFailed', 'Could not copy this built-in skill.'));
    }
  };

  const removeSkill = async (slug: string, scope: Scope) => {
    const ok = await api.skillsDelete(ws, slug, scope).catch(() => false);
    if (ok) {
      notify(t('skills.deleted', 'Skill deleted') + `: ${slug}`);
      await reload();
    } else {
      notify(t('skills.deleteFailed', 'Could not delete this skill.'));
    }
  };

  // ---------- v11.38 — "USE WITH AI": visible, real skill usage ----------
  // The founder's complaint was that clicking a skill did not make the AI use
  // it. Inspecting a SKILL.md is not usage: the model must CALL use_skill. This
  // queues the exact tool call (with the skill's name as context) into the
  // composer so the next send genuinely loads the body via the real tool.
  // NOTE: deliberately NOT named `use*` — this is a plain callback, not a
  // React hook; a `use` prefix after the early returns trips React's hook-order
  // lint (React #300). Rename keeps it honest.
  const queueUseSkill = (s: SkillInfo) => {
    insertIntoComposer(`use_skill("${s.slug}") — load the "${s.name}" skill first, then: `);
    notify(t('skills.useWithAI.queued', 'Skill queued — type your task and send. The agent loads it first.'));
  };

  // ---------- v11.36 — real "More actions" handlers ----------
  const inspectSkill = (slug: string) => setOpenSlug(slug);
  const editSkill = (s: SkillInfo, scope: Scope) => {
    // Built-ins are read-only on disk; an honest "edit" is a fork into the
    // global library (never a no-op button that fails when clicked).
    if (scope === 'builtin') {
      void forkBuiltin(s.slug);
      return;
    }
    setEditSlug(s.slug);
  };
  const duplicateSkill = async (s: SkillInfo, scope: Scope) => {
    if (scope === 'builtin') {
      await forkBuiltin(s.slug);
      return;
    }
    const full = await api.skillsRead(ws, s.slug).catch(() => null);
    if (!full) {
      notify(t('skills.duplicateFailed', 'Could not read this skill to duplicate it.'));
      return;
    }
    try {
      const newSlug = await api.skillsSave(ws, {
        name: `${full.name} (copy)`,
        description: full.description,
        body: full.body,
      }, scope === 'global' ? 'global' : 'workspace');
      notify(t('skills.duplicated', 'Skill duplicated') + `: ${newSlug}`);
      await reload();
      setOpenSlug(newSlug);
    } catch (err) {
      notify(t('skills.duplicateFailed', 'Could not read this skill to duplicate it.') + `: ${String((err as Error)?.message ?? err)}`);
    }
  };

  const toggleRivals = () => {
    const next = !rivalsOpen;
    setRivalsOpen(next);
    if (next && rivals === null) void loadRivals(); // scan once, cache afterwards
  };

  const importFromRival = async (src: RivalSkillSource) => {
    if (src.count === 0 || importingId) return;
    setImportingId(src.id);
    try {
      const res = await api.rivalsSkillsImport(ws, src.root, rivalScope);
      const n = res?.imported ?? 0;
      const failed = res?.failed ?? 0;
      if (n > 0) {
        notify(
          t('skills.rivals.imported', 'Imported {n} skill(s) from {src} · تم استيراد {n} مهارة من {src}', {
            n,
            src: src.label,
          }) + (failed > 0 ? ` · ${failed} ${t('skills.rivals.failedShort', 'failed')}` : ''),
        );
        await reload();
      } else {
        notify(t('skills.rivals.none', 'Nothing new — existing skills were skipped · لا جديد — تم تخطي المهارات الموجودة'));
      }
    } catch (err) {
      notify(String((err as Error)?.message ?? err));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className={'page-v14 art-skills flex flex-col min-h-0 h-full ' + (embedded ? '' : '')}>
      <div className="px-3 pt-3">
        <PageHead
          eyebrow={skillAr ? '٠٤ / المهارات' : '04 / SKILLS'}
          title={t('rail.skills', 'Skill library')}
          description={t('skills.desc', 'Reusable instructions the agent loads on demand, stored as plain files.')}
          toolbar={<SkillsGlyph />}
          meta={roots ? (
            <>
              <span className="font-code text-[var(--faint)] truncate" dir="ltr" title={`${t('skills.scope.workspace')}: ${roots.workspace}`}>
                {t('skills.scope.workspace')}: {roots.workspace}
              </span>
              <span className="font-code text-[var(--faint)] truncate" dir="ltr" title={`${t('skills.scope.global')}: ${roots.global}`}>
                {t('skills.scope.global')}: {roots.global}
              </span>
            </>
          ) : undefined}
        />
        {/* the instrument: a confidence ladder from real learned values */}
        <ConfidenceLadder values={skillConfidences} ar={skillAr} />
      </div>

      {/* ---------- workspace-skills trust consent (--warn, honest) ---------- */}
      {skillsTrustNeeded && (
        <div
          className="mx-3 mt-2 p-3 anim-in"
          style={{
            border: '1px solid color-mix(in srgb, var(--warn) 40%, var(--line))',
            borderRadius: 'var(--radius-md)',
            background: 'color-mix(in srgb, var(--warn) 6%, var(--panel))',
          }}
          role="alert"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck size={14} className="text-warn shrink-0" />
            <span className="text-[11.5px] font-semibold">{t('skills.trust.title', 'Trust this workspace\u2019s skills?')}</span>
          </div>
          <div className="text-[11px] text-dim leading-relaxed mb-2">
            {t('skills.trust.body', 'Workspace skills can instruct the agent. Trust them if you wrote them or reviewed them.')}
          </div>
          {typeof api.skillsTrust === 'function' ? (
            <Btn variant="primary" className="!h-7 !px-2.5 !text-[11px]" onClick={() => void trustWorkspaceSkills()}>
              {t('skills.trust.btn', 'Trust workspace skills')}
            </Btn>
          ) : (
            <div className="text-[10.5px] text-warn leading-snug">
              {t('skills.trust.unavailable', 'Trust is unavailable in this build — workspace skills stay untrusted.')}
            </div>
          )}
        </div>
      )}

      <div className="px-3 pb-2 flex items-center gap-2 mt-2">
        <input
          className="h-7 flex-1 min-w-0 px-2 text-[12.5px] bg-[var(--bg1)] border border-line rounded-[var(--radius-sm)] outline-none focus:border-[var(--line-accent)]"
          placeholder={t('skills.searchPh', 'Search skills…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
        />
        <Btn
          variant="primary"
          className="!h-7 !text-[11px] shrink-0"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((v) => !v)}
        >
          <Plus size={12} className="me-1" />
          {t('skills.add', 'Add skill · إضافة مهارة')}
          <ChevronDown size={12} className={'ms-1 transition-transform ' + (addOpen ? '' : '-rotate-90')} />
        </Btn>
      </div>

      {addOpen && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5" role="group" aria-label={t('skills.add.menu', 'Ways to add a skill · طرق إضافة مهارة')}>
          <Btn className="!h-7 !text-[11px]" onClick={() => { setAddOpen(false); setCreating(true); }}>
            <Plus size={12} className="me-1" />{t('skills.new', 'New skill')}
          </Btn>
          <Btn className="!h-7 !text-[11px]" onClick={() => { void importFolder(); }}>
            <FolderPlus size={12} className="me-1" />{t('skills.import', 'Import skill folder')}
          </Btn>
          <Btn className="!h-7 !text-[11px]" aria-expanded={marketOpen} onClick={() => setMarketOpen((v) => !v)}>
            <Store size={12} className="me-1" />{t('skills.market.title', 'Marketplace · السوق')}
          </Btn>
          <Btn className="!h-7 !text-[11px]" aria-expanded={rivalsOpen} onClick={toggleRivals}>
            <FolderDown size={12} className="me-1" />{t('skills.rivals.title', 'Import from other agents · استيراد من الوكلاء الآخرين')}
          </Btn>
        </div>
      )}

      {!skills ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size={18} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center px-6 anim-in">
          <BookOpen size={20} className="text-[var(--faint)]" strokeWidth={1.5} aria-hidden />
          <div className="text-[12px] text-dim leading-relaxed max-w-[240px]">
            {t('skills.empty', 'No skills match. Create one, or ask the agent: "save this procedure as a skill".')}
          </div>
          <Btn variant="primary" className="!h-7 !text-[11px] mt-1" onClick={() => setCreating(true)}>
            <Plus size={12} />
            {t('skills.new', 'New skill')}
          </Btn>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-3">
          {SCOPE_ORDER.map((scope) => {
            const list = grouped.get(scope) ?? [];
            if (!list.length) return null;
            return (
              <div key={scope}>
                <div className="sec-titled">
                  <span className="sec-no">{String(SCOPE_ORDER.indexOf(scope) + 1).padStart(2, '0')}</span>
                  <span className="sec-tt flex-1">{t(`skills.scope.${scope}`, scope)}</span>
                  <span className="text-[10.5px] text-faint tnum">{list.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {list.map((s) => (
                    <div
                      key={`${scope}/${s.slug}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenSlug(s.slug)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpenSlug(s.slug);
                        }
                      }}
                      className="sk-skill-row group cursor-pointer px-2.5 py-2 flex flex-col gap-1 min-w-0 transition-colors"
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--panel)',
                      }}
                      title={s.description || s.name}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <PenLine size={12} className="text-acc2 shrink-0" aria-hidden />
                        <span className="text-[12px] font-medium truncate flex-1 min-w-0" dir="auto">
                          {s.name}
                        </span>
                        <span className="stamp !h-[16px] !px-1.5 !text-[9px] shrink-0" title={t(`skills.scope.${scope}`, scope)}>
                          {scope}
                        </span>
                        <button
                          type="button"
                          className="stamp stamp-acc !h-[16px] !px-1.5 !text-[9px] shrink-0 press"
                          data-testid={`skill-use-with-ai-${s.slug}`}
                          title={t('skills.useWithAI', 'Use with AI — queue use_skill for this skill')}
                          aria-label={t('skills.useWithAI', 'Use with AI — queue use_skill for this skill')}
                          onClick={(e) => {
                            e.stopPropagation();
                            queueUseSkill(s);
                          }}
                        >
                          {t('skills.useShort', 'USE')}
                        </button>
                        <SkillActionsMenu
                          scope={scope}
                          actions={{
                            onInspect: () => inspectSkill(s.slug),
                            onEdit: () => editSkill(s, scope),
                            onDuplicate: () => void duplicateSkill(s, scope),
                            onDelete: () => void removeSkill(s.slug, scope),
                          }}
                        />
                      </div>
                      {s.description ? (
                        <div className="text-[10.5px] text-faint truncate" dir="auto">
                          {s.description}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="text-[11px] text-faint leading-[1.6] pb-2">
            {t(
              'skills.hint',
              'Skills are plain markdown folders on disk. Press USE to queue use_skill for a skill — the agent loads its full body and follows it before doing the task. New skills are saved with create_skill.',
            )}
          </div>
          {/* v1143 — honest auto-use info: a skill added here is advertised on
              the very next run and the most relevant one is loaded first; USE
              forces a specific skill. No i18n edit needed (bilingual fallback). */}
          <div className="text-[11px] text-acc2 leading-[1.6] pb-3" role="note">
            {t(
              'skills.autoUseInfo',
              'AUTO-USE: every skill you add here is advertised to the AI on the next run — it loads the most relevant one FIRST and follows ALL its steps. Press USE to force a specific skill. / الاستخدام التلقائي: كل سكيلز تضيفها هنا تظهر للذكاء الاصطناعي في التشغيل التالي، فيحمّل الأنسب منها أولاً وينفّذ كل خطواته. اضغط USE لإجبار سكيلز معيّن.',
            )}
          </div>
        </div>
      )}

      {/* v1142 — Marketplace detail; opened only from the single Add menu. */}
      {marketOpen && (
        <div className="px-3 pb-3 shrink-0">
          <div className="sec-titled">
            <Store size={12} className="text-faint shrink-0" />
            <span className="sec-tt truncate">{t('skills.market.title', 'Marketplace · السوق')}</span>
          </div>
          <div className="flex flex-col gap-1 mt-1.5">
            {market === null ? (
              <div className="flex items-center gap-2 py-1.5 text-[11.5px] text-dim">
                <Spinner size={12} /> {t('skills.market.loading', 'Loading catalog…')}
              </div>
            ) : marketError ? (
              <div className="text-[11px] text-bad py-1 leading-snug" dir="ltr">{marketError}</div>
            ) : market.length === 0 ? (
              <div className="text-[11px] text-faint py-1">{t('skills.market.empty', 'No marketplace skills available.')}</div>
            ) : market.map((item) => (
              <div key={item.slug} className="flex items-center gap-2 tree-row !py-1.5">
                <span className="flex-1 min-w-0 truncate text-[11.5px]" title={item.description}>
                  {item.name} <span className="text-faint text-[10px]">{item.category}</span>
                </span>
                {item.installed && <ShieldCheck size={12} className="text-acc shrink-0" />}
                {item.installed ? (
                  <Btn
                    className="!h-6 !px-2 !text-[10.5px] shrink-0"
                    onClick={async () => {
                      const r = await api.skillsMarketplaceRemove(ws, item.slug).catch(() => ({ ok: false, output: '' }));
                      notify(r.ok ? t('skills.market.removed', 'Removed') : (r.output || t('skills.market.failed', 'Could not remove')));
                      if (r.ok) { await reload(); setMarket(null); setMarketError(null); }
                    }}
                  >{t('skills.market.remove', 'Remove')}</Btn>
                ) : (
                  <Btn
                    variant="primary"
                    disabled={installingSlug !== null}
                    className="!h-6 !px-2 !text-[10.5px] shrink-0"
                    onClick={async () => {
                      setInstallingSlug(item.slug);
                      try {
                        const r = await api.skillsMarketplaceInstall(ws, item.slug).catch(() => ({ ok: false, output: '' }));
                        notify(r.ok ? t('skills.market.installed', 'Installed') : (r.output || t('skills.market.failed', 'Install failed')));
                        if (r.ok) { await reload(); setMarket(null); setMarketError(null); }
                      } finally { setInstallingSlug(null); }
                    }}
                  >{installingSlug === item.slug ? <Spinner size={10} /> : t('skills.market.install', 'Install')}</Btn>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* v1142 — rival-import detail; opened only from the single Add menu */}
      {rivalsOpen && (
        <div className="px-3 pb-3 shrink-0">
          <div className="sec-titled">
            <FolderDown size={12} className="text-acc shrink-0" />
            <span className="sec-tt truncate">
              {t('skills.rivals.title', 'Import from other agents · استيراد من الوكلاء الآخرين')}
            </span>
            <select
              className="h-6 px-1 text-[10.5px] bg-[var(--bg2)] border border-line rounded-[6px] shrink-0"
              title={t('skills.rivals.scopeTip', 'Imported skills land in this scope')}
              value={rivalScope}
              onChange={(e) => setRivalScope(e.target.value as 'workspace' | 'global')}
            >
              <option value="workspace">{t('skills.scope.workspace', 'This workspace')}</option>
              <option value="global">{t('skills.scope.global', 'All projects (global)')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 mt-1.5">
            {rivals === null ? (
              <div className="flex items-center gap-2 py-1.5 text-[11.5px] text-dim">
                <Spinner size={12} />
                {t('skills.rivals.scanning', 'Scanning installed agent tools… · جارٍ فحص الأدوات المثبتة…')}
              </div>
            ) : rivals.every((r) => r.count === 0) ? (
              <div className="text-[11px] text-faint leading-snug py-1">
                {t(
                  'skills.rivals.noneFound',
                  'No skills found in other agent tools on this machine · لا توجد مهارات في الأدوات الأخرى',
                )}
              </div>
            ) : (
              rivals.map((src) => (
                <div key={src.id} className="tree-row">
                  <FolderDown size={12} className="text-acc shrink-0" />
                  <span className="tree-name truncate flex-1" dir="auto" title={src.root}>
                    {src.label}
                  </span>
                  <span className={'stamp tnum !h-[16px] !text-[9px] shrink-0 ' + (src.count > 0 ? 'stamp-acc' : '')}>
                    {src.count}
                  </span>
                  <Btn
                    className="!h-6 !px-2 !text-[10.5px] shrink-0"
                    disabled={src.count === 0 || importingId !== null}
                    onClick={() => void importFromRival(src)}
                  >
                    {importingId === src.id ? <Spinner size={10} /> : t('skills.rivals.import', 'Import')}
                  </Btn>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SkillsPanel;
