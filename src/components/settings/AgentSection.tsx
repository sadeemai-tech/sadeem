// ============================================================
// SADEEM settings — Agent section (pure engine tuning).
// maxTurns, prompt caching, parallel tool calls, retries,
// auto-compact + threshold, auto-approve edits, auto-verify after
// edits (agent.autoVerify), dangerous-command policy
// (agent.allowDangerousCommands), per-section reset.
// v7: model router (agent.modelRoles per-step roles + verifier
// posture agent.verifierMode) and the network allowlist
// (agent.networkAllowlist) for run_command.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { ListChecks, PenLine, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { PROVIDER_PRESETS, useStore } from '../../store';
import { useT } from '../../i18n';
import { S1Page } from './GeneralSection';
import { GroupCard, InfoNote, NumberInput, Segmented, SettingRow, Slider, Toggle } from './controls';
import { Btn, Select, TextInput } from '../ui';
import type { AppSettings, ProviderId } from '../../../shared/types';
import {
  MAX_SUBAGENTS_CEILING,
  MAX_SUBAGENTS_DEFAULT,
  MAX_SUBAGENTS_MIN,
  clampMaxSubagents,
} from '../../../shared/types';
import toolInventory from '../../generated/toolInventory.json';
import './s1-art.css';

/** v7 — router roles surfaced in the UI ('context' stays engine-internal for now). */
type ModelRole = 'plan' | 'search' | 'edit' | 'verify';

type RoleCfg = { provider: string; model: string };

const ROUTER_ROLES: { id: ModelRole; key: string; fb: string; hintKey: string; hintFb: string }[] = [
  {
    id: 'plan',
    key: 'settings.agent.router.role.plan',
    fb: 'Planning (plan)',
    hintKey: 'settings.agent.router.role.plan.hint',
    hintFb: 'Deep reasoning and plan steps — the strong model earns its cost here.',
  },
  {
    id: 'search',
    key: 'settings.agent.router.role.search',
    fb: 'Search / reads (search)',
    hintKey: 'settings.agent.router.role.search.hint',
    hintFb: 'Greps, file reads and listings — a cheap fast model is plenty.',
  },
  {
    id: 'edit',
    key: 'settings.agent.router.role.edit',
    fb: 'Edits (edit)',
    hintKey: 'settings.agent.router.role.edit.hint',
    hintFb: 'Code edits and writes — keep this one accurate.',
  },
  {
    id: 'verify',
    key: 'settings.agent.router.role.verify',
    fb: 'Verifier (verify)',
    hintKey: 'settings.agent.router.role.verify.hint',
    hintFb: 'Checks the run result — pick a DIFFERENT provider family than the editor.',
  },
];

/** v12 — default verify models used by the "auto-pick a different provider" shortcut. */
const VERIFY_FALLBACK_MODEL: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-5.1-codex',
  zai: 'glm-4.7',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-3-pro-preview',
  xai: 'grok-4',
  ollama: 'llama3.1',
  mistral: 'mistral-large-latest',
};

const ROLE_ICON: Record<ModelRole, typeof ListChecks> = {
  plan: ListChecks,
  search: Search,
  edit: PenLine,
  verify: ShieldCheck,
};

export const AGENT_DEFAULTS: NonNullable<AppSettings['agent']> = {
  maxTurns: 40,
  promptCaching: true,
  parallelToolCalls: true,
  maxRetries: 2,
  autoCompact: true,
  compactThreshold: 120000,
  autoVerify: true,
  allowDangerousCommands: false,
  // v11.23 founder rule: automatic provider failover is ALWAYS off unless the
  // user explicitly opts in. Keep the renderer reset/patch path aligned with
  // electron/services/storeService.ts -> DEFAULT_SETTINGS.agent.
  allowModelFailover: false,
  taskBudgetUsd: 2,
  toolProfile: 'balanced',
};

export function AgentSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const ar = useStore((s) => s.settings.language === 'ar');

  const agent = settings.agent ?? {};
  const patch = (p: Partial<NonNullable<AppSettings['agent']>>) =>
    updateSettings({ agent: { ...AGENT_DEFAULTS, ...agent, ...p } });
  // v1142 — top-level, genuinely persisted subagent ceiling (defensive on read).
  const maxSubagents = clampMaxSubagents(settings.maxSubagents);
  const setMaxSubagents = (v: number) => updateSettings({ maxSubagents: clampMaxSubagents(v) });

  const resetAgent = () => {
    updateSettings({ agent: { ...AGENT_DEFAULTS } });
    notify(t('settings.saved', 'Saved'));
  };

  // ---- v7 model router: roles fall back to the active session model ----
  const model = settings.model;
  const providerLabel = PROVIDER_PRESETS[model.provider]?.label ?? model.provider;
  const roles = (agent.modelRoles ?? {}) as Partial<Record<ModelRole, RoleCfg>>;
  const setRole = (r: ModelRole, cfg: RoleCfg) =>
    patch({ modelRoles: { ...roles, [r]: cfg } });
  const clearRole = (r: ModelRole) => {
    const next = { ...roles };
    delete next[r];
    patch({ modelRoles: next });
  };
  // provider dropdown: every configured provider (settings.providers keys)
  // plus the built-in presets, so the list is never empty
  const providerIds = Array.from(
    new Set<string>([...Object.keys(settings.providers ?? {}), ...Object.keys(PROVIDER_PRESETS)]),
  );
  // verifier posture: 'fail-open' is the legacy default
  const verifierMode = agent.verifierMode ?? 'fail-open';

  // v12 — one-click "auto-pick a DIFFERENT provider for Verify": prefer a
  // configured provider other than the active one (cross-family verification
  // is the whole point of the router), fall back to any preset.
  const autoPickVerify = () => {
    const others = providerIds.filter((id) => id !== model.provider);
    const configured = others.filter((id) => !!(settings.providers as Record<string, { apiKey?: string }> | undefined)?.[id]?.apiKey);
    const pick = (configured.length ? configured : others)[0];
    if (!pick) {
      notify(t('settings.agent.router.autoVerify.none', 'No second provider configured — add one under Providers first.'));
      return;
    }
    const live = (settings.providers as Record<string, { lastModels?: string[] }> | undefined)?.[pick]?.lastModels?.[0];
    setRole('verify', { provider: pick, model: live || VERIFY_FALLBACK_MODEL[pick] || model.model });
    notify(t('settings.agent.router.autoVerify.done', 'Verify now uses a different provider'));
  };

  // ---- v7 network allowlist: one hostname per line, normalized on commit ----
  const [allowText, setAllowText] = useState<string>((agent.networkAllowlist ?? []).join('\n'));
  const allowFocused = useRef(false);
  useEffect(() => {
    if (!allowFocused.current) setAllowText((agent.networkAllowlist ?? []).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.networkAllowlist]);
  const commitAllowlist = () => {
    const list = Array.from(
      new Set(
        allowText
          .split(/[\n,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    const prev = agent.networkAllowlist ?? [];
    if (list.length === prev.length && list.every((h, i) => h === prev[i])) return;
    patch({ networkAllowlist: list });
  };

  const autoCompact = agent.autoCompact === true;
  // autoVerify defaults ON (engine verifies builds/tests after edits)
  const autoVerify = agent.autoVerify !== false;
  // allowDangerousCommands defaults OFF → the ALWAYS-ASK gate stands
  const skipDangerGate = agent.allowDangerousCommands === true;
  // v12 — tool profile advertised to the model (default balanced)
  const toolProfile = agent.toolProfile ?? 'balanced';

  return (
    <S1Page
      className="s1-agent"
      eyebrow={t('s1.eyebrow.agent', ar ? '٠٥ / الوكيل' : '05 / AGENT')}
      titleKey="settings.nav.agent"
      titleFallback="Agent"
      glyph="agent"
      desc={t(
        'settings.agent.desc',
        'Engine tuning for the autonomous loop: turn budget, caching, retries and context compaction.',
      )}
      onReset={resetAgent}
    >
      {/* v2.4 — project rules info line (SADEEM: recessed well) */}
      <div className="set-note" dir="auto" style={{ marginBottom: 12 }}>
        {t(
          'set.agent.rulesInfo',
          'Project rules: put .md files in .surnia/rules/ (or AGENTS.md / CLAUDE.md at the repo root) and they are loaded into every run automatically.',
        )}
      </div>
      <GroupCard title={t('settings.agent.loop', 'Run loop')}>
        <SettingRow
          label={t('settings.agent.maxTurns', 'Max turns per run')}
          hint={t(
            'settings.agent.maxTurns.hint',
            'Hard cap on tool-loop iterations (10–100). A run that hits the cap stops cleanly.',
          )}
        >
          <NumberInput
            value={agent.maxTurns ?? 40}
            min={10}
            max={100}
            onChange={(v) => patch({ maxTurns: v })}
            label={t('settings.agent.maxTurns', 'Max turns per run')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.agent.maxRetries', 'Retries on rate limit')}
          hint={t(
            'settings.agent.maxRetries.hint',
            'Automatic retries (0–6) when the provider rate-limits or hiccups',
          )}
        >
          <NumberInput
            value={agent.maxRetries ?? 2}
            min={0}
            max={6}
            onChange={(v) => patch({ maxRetries: v })}
            label={t('settings.agent.maxRetries', 'Retries on rate limit')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.agent.taskBudget', 'Cost guardrail per run ($)')}
          hint={t(
            'settings.agent.taskBudget.hint',
            'Hard spend ceiling for ONE run (USD, 0 = unlimited). When the run crosses it, the agent stops and reports honestly instead of burning tokens overnight.',
          )}
        >
          <NumberInput
            value={agent.taskBudgetUsd ?? 0}
            min={0}
            max={1000}
            step={1}
            onChange={(v) => patch({ taskBudgetUsd: v })}
            label={t('settings.agent.taskBudget', 'Cost guardrail per run ($)')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.agent.autoVerify', 'Auto-verify after edits')}
          hint={t(
            'settings.agent.autoVerify.hint',
            'Runs the project build / test / typecheck after consecutive edits and self-repairs failures.',
          )}
        >
          <Toggle
            checked={autoVerify}
            onChange={(v) => patch({ autoVerify: v })}
            label={t('settings.agent.autoVerify', 'Auto-verify after edits')}
          />
        </SettingRow>
      </GroupCard>

      {/* v1142 — founder: «الشخص بيقدر يحدد كم ايجنت بيقدر يستخدمه». A REAL
          persisted setting, not a hardcoded engine constant. */}
      <GroupCard title={t('settings.agent.subagents.title.v1142', ar ? 'الوكلاء الفرعيون' : 'Subagents')}>
        <SettingRow
          label={t(
            'settings.agent.subagents.maxConcurrent.v1142',
            ar ? 'الحد الأقصى للوكلاء الفرعيين بالتوازي' : 'Max parallel subagents',
          )}
          hint={t(
            'settings.agent.subagents.maxConcurrent.hint.v1142',
            ar
              ? 'كم وكيل فرعي (خلفي/متوازٍ) يمكن تشغيله في آن واحد داخل الجلسة — من ١ إلى ٦٤. الافتراضي ٦٤ (لا حد عملي) ويمكنك خفضه. هذا سقف حقيقي وليس "غير محدود".'
              : 'How many background / parallel subagents may run at once in one session (1–64). Default 64 (effectively no limit) — lower it for a lighter machine. This is a REAL ceiling, not "unlimited".',
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Slider
              value={maxSubagents}
              min={MAX_SUBAGENTS_MIN}
              max={MAX_SUBAGENTS_CEILING}
              onChange={setMaxSubagents}
              label={t(
                'settings.agent.subagents.maxConcurrent.v1142',
                ar ? 'الحد الأقصى للوكلاء الفرعيين بالتوازي' : 'Max parallel subagents',
              )}
              suffix={ar ? 'وكيل' : 'agents'}
            />
            <NumberInput
              value={maxSubagents}
              min={MAX_SUBAGENTS_MIN}
              max={MAX_SUBAGENTS_CEILING}
              onChange={setMaxSubagents}
              label={t(
                'settings.agent.subagents.maxConcurrent.v1142',
                ar ? 'إدخال دقيق لعدد الوكلاء الفرعيين' : 'Exact parallel subagent count',
              )}
            />
          </div>
        </SettingRow>
        <div className="set-note" dir="auto">
          {t(
            'settings.agent.subagents.honest.v1142',
            ar
              ? `السقف الأعلى ${MAX_SUBAGENTS_CEILING} وكلاء — القيم الأعلى تُخفَّض تلقائياً. الافتراضي ${MAX_SUBAGENTS_DEFAULT} يحافظ على سلوك "بلا حد عملي"; اختر رقماً أقل للحد من التوازي.`
              : `Hard ceiling: ${MAX_SUBAGENTS_CEILING} agents — higher values are clamped. The ${MAX_SUBAGENTS_DEFAULT} default keeps the "no practical limit" posture; pick a smaller number to bound parallelism.`,
          )}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.agent.efficiency', 'Efficiency')}>
        <SettingRow
          label={t('settings.agent.promptCaching', 'Prompt caching')}
          hint={t(
            'settings.agent.promptCaching.hint',
            'Caches the long system prompt on Anthropic — faster and ~90% cheaper on repeat turns.',
          )}
        >
          <Toggle
            checked={agent.promptCaching !== false}
            onChange={(v) => patch({ promptCaching: v })}
            label={t('settings.agent.promptCaching', 'Prompt caching')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.agent.parallel', 'Parallel tool calls')}
          hint={t('settings.agent.parallel.hint', 'Run independent tool calls at the same time (Pro).')}
        >
          <Toggle
            checked={agent.parallelToolCalls !== false}
            onChange={(v) => patch({ parallelToolCalls: v })}
            label={t('settings.agent.parallel', 'Parallel tool calls')}
          />
        </SettingRow>
        {/* v12 — real provider embeddings for semantic_search (offline by default). */}
        <SettingRow
          label={t('settings.agent.embeddings', 'Real embeddings (semantic search)')}
          hint={t(
            'settings.agent.embeddings.hint',
            'Use the configured provider’s /embeddings endpoint for meaning-based code search instead of the offline hasher. Re-indexes on change; falls back to offline if unavailable.',
          )}
        >
          <Toggle
            checked={settings.embeddings?.enabled === true}
            onChange={(v) => updateSettings({ embeddings: { ...settings.embeddings, enabled: v } })}
            label={t('settings.agent.embeddings', 'Real embeddings (semantic search)')}
          />
        </SettingRow>
        {/* v1131 — honest safety status. Failover is a store-level opt-in, not
            a UI toggle: SADEEM never silently switches provider on a 429. */}
        <InfoNote>
          {t(
            'settings.agent.failover.honest.v1131',
            ar
              ? 'التبديل التلقائي بين المزوّدين مُعطَّل افتراضياً — لا يحوّل سديم تشغيلك إلى مزوّد آخر دون طلب صريح منك.'
              : 'Automatic provider failover is OFF by default — SADEEM never silently switches your run to another provider or model.',
          )}
        </InfoNote>
      </GroupCard>

      {/* v12 — tool profile: fix "too many tools hurt weak models" WITHOUT
          deleting any tool (all executors stay; only what is advertised
          to the model changes). */}
      <GroupCard title={t('settings.agent.toolProfile', 'Tool profile')}>
        <SettingRow
          label={t('settings.agent.toolProfile.label', 'Tools advertised to the model')}
          hint={t(
            'settings.agent.toolProfile.hint',
            'Weak models choose better from a short list. No tool is removed — every tool stays callable; this only changes what is advertised.',
          )}
        >
          <Segmented<'essential' | 'balanced' | 'full'>
            value={toolProfile}
            ariaLabel={t('settings.agent.toolProfile', 'Tool profile')}
            options={[
              { value: 'essential', label: t('settings.agent.toolProfile.essential', 'essential') },
              { value: 'balanced', label: t('settings.agent.toolProfile.balanced', 'balanced') },
              { value: 'full', label: t('settings.agent.toolProfile.full', 'full') },
            ]}
            onChange={(v) => patch({ toolProfile: v })}
          />
        </SettingRow>
        <div className="def-desc" style={{ paddingInlineStart: 2 }}>
          {toolProfile === 'essential'
            ? t(
                'settings.agent.toolProfile.essential.desc',
                'essential — ~30 core tools (files, run, search, plan, todos, checkpoints, web). Best for weak/local models.',
              )
            : toolProfile === 'full'
              ? t(
                  // v1131 — derive the count from the generated inventory so the
                  // copy can never drift again (it used to say a stale "134").
                  'settings.agent.toolProfile.full.desc.v1131',
                  ar
                    ? `كامل — تُعرض جميع الأدوات (${toolInventory.total})، بما فيها LSP والمصحّح ودفاتر الملاحظات وأدوات الوسائط والمكاتب.`
                    : `full — all ${toolInventory.total} tools are advertised, including LSP, debugger, notebooks and the media/office builders.`,
                )
              : t(
                  'settings.agent.toolProfile.balanced.desc',
                  'balanced (default) — most tools; only the deepest specialists are hidden from the list (they remain callable).',
                )}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.agent.context', 'Context')}>
        <SettingRow
          label={t('settings.agent.autoCompact', 'Auto-compact long sessions')}
          hint={t(
            'settings.agent.autoCompact.hint',
            'Summarize the transcript automatically when it grows past the threshold',
          )}
        >
          <Toggle
            checked={autoCompact}
            onChange={(v) => patch({ autoCompact: v })}
            label={t('settings.agent.autoCompact', 'Auto-compact long sessions')}
          />
        </SettingRow>

        {autoCompact && (
          <SettingRow
            label={t('settings.agent.compactThreshold', 'Compact threshold (characters)')}
            hint={t(
              'settings.agent.compactThreshold.hint',
              '20,000–400,000 chars of transcript before a compaction pass runs',
            )}
          >
            <NumberInput
              value={agent.compactThreshold ?? 120000}
              min={20000}
              max={400000}
              step={10000}
              onChange={(v) => patch({ compactThreshold: v })}
              label={t('settings.agent.compactThreshold', 'Compact threshold (characters)')}
            />
          </SettingRow>
        )}
      </GroupCard>

      {/* v7 — per-step model router (strong plans / cheap reads / different verifier) */}
      <GroupCard title={t('settings.agent.router.title.v1131', ar ? 'موجّه النماذج' : 'Model router')}>
        <SettingRow
          label={t('settings.agent.router.session', 'Session model')}
          hint={t(
            'settings.agent.router.session.hint',
            'The active model — the default for every role below until that role is set.',
          )}
        >
          <span
            className="stamp !h-[16px] max-w-[26ch]"
            dir="ltr"
            title={`${model.provider} · ${model.model}`}
          >
            <span className="truncate min-w-0">
              {providerLabel} · {model.model}
            </span>
          </span>
        </SettingRow>

        {/* v12 — compact 3-click role strip: see the model, pin the active
            model in one click, or drop to the full dropdowns below. */}
        <div className="router-role-strip grid grid-cols-2 gap-2 my-2">
          {ROUTER_ROLES.map((r) => {
            const Icon = ROLE_ICON[r.id];
            const cfg = roles[r.id];
            const label = cfg
              ? `${PROVIDER_PRESETS[cfg.provider as ProviderId]?.label ?? cfg.provider} · ${cfg.model}`
              : t('settings.agent.router.sessionDefault', 'session default');
            return (
              <div key={r.id} className="card p-2.5 min-w-0 flex flex-col gap-2" dir="auto">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon size={13} className="text-[var(--acc)] shrink-0" aria-hidden />
                  <span className="text-[11.5px] font-semibold truncate">{t(r.key, r.fb)}</span>
                  {cfg ? (
                    <button
                      type="button"
                      className="ms-auto text-[10px] text-[var(--faint)] hover:text-[var(--bad)] transition-colors cursor-pointer"
                      title={t('settings.agent.router.clearRole', 'Clear override')}
                      onClick={() => clearRole(r.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <span
                  className="stamp !h-[18px] max-w-full text-[10px]"
                  dir="ltr"
                  title={cfg ? `${cfg.provider} · ${cfg.model}` : `${model.provider} · ${model.model}`}
                >
                  <span className="truncate min-w-0">{label}</span>
                </span>
                <Btn
                  variant="ghost"
                  className="!h-6 !px-2 text-[10px] w-full"
                  title={t('settings.agent.router.useActive.hint', 'Pin this role to the active session model')}
                  onClick={() => setRole(r.id, { provider: model.provider, model: model.model })}
                >
                  <Sparkles size={11} className="me-1 inline-block -mt-0.5" />
                  {t('settings.agent.router.useActive', 'use active model')}
                </Btn>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end my-2">
          <Btn variant="default" className="!h-7 !px-2.5 text-[10.5px]" onClick={autoPickVerify}>
            <ShieldCheck size={12} className="me-1 inline-block -mt-0.5" />
            {t('settings.agent.router.autoVerify', 'Auto-pick different provider for Verify')}
          </Btn>
        </div>

        {ROUTER_ROLES.map((r) => (
          <RoleRow
            key={r.id}
            label={t(r.key, r.fb)}
            hint={t(r.hintKey, r.hintFb)}
            cfg={roles[r.id]}
            providerIds={providerIds}
            onSet={(cfg) => setRole(r.id, cfg)}
            onClear={() => clearRole(r.id)}
          />
        ))}

        <SettingRow
          label={t('settings.agent.router.posture', 'Verifier posture')}
          hint={t(
            'settings.agent.router.posture.hint',
            'What a verifier error means for the run verdict.',
          )}
        >
          <Segmented<'fail-open' | 'fail-closed'>
            value={verifierMode}
            ariaLabel={t('settings.agent.router.posture', 'Verifier posture')}
            options={[
              { value: 'fail-open', label: t('settings.agent.router.posture.open', 'lenient') },
              { value: 'fail-closed', label: t('settings.agent.router.posture.closed', 'strict') },
            ]}
            onChange={(v) => patch({ verifierMode: v })}
          />
        </SettingRow>
        <div className="def-desc" style={{ paddingInlineStart: 2 }}>
          {verifierMode === 'fail-closed'
            ? t(
                'settings.agent.router.posture.closed.desc',
                'strict (fail-closed) — verifier errors = NOT verified.',
              )
            : t(
                'settings.agent.router.posture.open.desc',
                'lenient (fail-open) — verifier errors pass the run.',
              )}
        </div>

        <div className="def-desc" style={{ paddingInlineStart: 2 }}>
          {t(
            'settings.agent.router.explain',
            'Strong model plans, cheap model reads, a DIFFERENT provider family verifies — one vendor’s blind spot cannot bless a broken run.',
          )}
        </div>
      </GroupCard>

      {/* v7 — network allowlist for run_command / http_request */}
      <GroupCard title={t('settings.agent.allowlist', 'Network allowlist')}>
        <label className="block">
          <textarea
            className="input font-code"
            style={{ height: 'auto', minHeight: 66, resize: 'vertical', lineHeight: 1.6 }}
            rows={3}
            dir="ltr"
            spellCheck={false}
            value={allowText}
            placeholder={t('settings.agent.allowlist.ph', 'api.github.com — one hostname per line')}
            aria-label={t('settings.agent.allowlist', 'Network allowlist')}
            onFocus={() => {
              allowFocused.current = true;
            }}
            onChange={(e) => setAllowText(e.target.value)}
            onBlur={() => {
              allowFocused.current = false;
              commitAllowlist();
            }}
            onKeyDown={(e) => {
              // keep the settings modal's Escape / shortcut handlers predictable
              e.stopPropagation();
            }}
          />
        </label>
        <div className="text-[10.5px] text-[var(--faint)] mt-1">
          {t('settings.agent.allowlist.empty', 'Empty = no restriction')}
        </div>
        <div className="def-desc mt-1.5">
          {t(
            'settings.agent.allowlist.hint',
            'When set, http_request can only reach these hosts — long unattended runs stay inside your policy.',
          )}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.permissions', 'Permissions')}>
        <SettingRow
          label={t('settings.autoApproveEdits', 'Auto-approve file edits')}
          hint={t('settings.autoApproveEdits.hint', 'Agent edits are applied without confirmation')}
        >
          <Toggle
            checked={settings.autoApproveEdits}
            onChange={(v) => updateSettings({ autoApproveEdits: v })}
            label={t('settings.autoApproveEdits', 'Auto-approve file edits')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.agent.dangerPolicy', 'Dangerous-command policy')}
          hint={t(
            'settings.agent.dangerPolicy.hint',
            'Danger-classified commands are always held for your approval unless the gate is skipped.',
          )}
        >
          <span className="flex items-center gap-2.5">
            {skipDangerGate ? (
              <span className="stamp stamp-bad">{t('settings.agent.danger.gateOff', 'GATE OFF')}</span>
            ) : (
              <span className="stamp stamp-warn">{t('settings.agent.danger.alwaysAsk', 'ALWAYS ASK')}</span>
            )}
            <Toggle
              checked={skipDangerGate}
              onChange={(v) => patch({ allowDangerousCommands: v })}
              label={t('settings.agent.dangerGate', 'Skip danger gate (not recommended)')}
            />
          </span>
        </SettingRow>
        <div className="def-desc" style={{ paddingInlineStart: 2 }}>
          {t(
            'settings.agent.dangerGate.label',
            'Skip danger gate (not recommended)',
          )}
          {' — '}
          {t(
            'settings.agent.dangerGate.desc',
            'When enabled, dangerous shell commands skip the always-ask gate. Keep it off unless you know what you are doing.',
          )}
        </div>
      </GroupCard>

      <GroupCard title={t('settings.agent.inventory', 'Tool inventory')}>
        <SettingRow
          label={t('settings.agent.inventory.total', `${toolInventory.total} tools available to the agent`)}
          hint={t(
            'settings.agent.inventory.hint',
            'Every tool below is registered in the engine and callable by the model. Internet set: web_search, web_fetch, http_request, download_file, search_web, open_path (opens URLs in your real browser) + the 8 browser_* automation tools.',
          )}
        >
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{ background: 'var(--bg4)', color: 'var(--dim)' }}
            dir="ltr"
          >
            {toolInventory.total}
          </span>
        </SettingRow>
        {Object.entries(toolInventory.groups).map(([kind, names]) => (
          <div key={kind} className="py-1.5 border-t" style={{ borderColor: 'var(--line-soft)' }}>
            <div className="flex items-center gap-2 flex-wrap" dir="ltr">
              <span
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg3)', color: 'var(--acc)' }}
              >
                {kind} · {(names as string[]).length}
              </span>
              {(names as string[]).map((n) => (
                <span key={n} className="text-[10.5px]" style={{ color: 'var(--faint)' }}>
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </GroupCard>
    </S1Page>
  );
}

// ---------------- v7 model-router role row ----------------
/**
 * One router role: provider dropdown + model id + "use session model" clear
 * button. An unset role shows the session-default stamp — the engine falls
 * back to the active session model for it.
 */
function RoleRow({
  label,
  hint,
  cfg,
  providerIds,
  onSet,
  onClear,
}: {
  label: string;
  hint: string;
  cfg?: RoleCfg;
  providerIds: string[];
  onSet: (cfg: RoleCfg) => void;
  onClear: () => void;
}) {
  const t = useT();
  // never hide the stored provider, even if it is not a known preset
  const ids = Array.from(new Set(cfg ? [cfg.provider, ...providerIds] : providerIds));
  return (
    <SettingRow label={label} hint={hint}>
      <div className="flex items-center gap-1.5 min-w-0 max-w-full flex-wrap justify-end">
        {cfg ? (
          <>
            <Select
              value={cfg.provider}
              aria-label={`${label} — ${t('settings.agent.router.providerPh', 'provider…')}`}
              onChange={(e) => onSet({ ...cfg, provider: e.target.value })}
              className="!w-[128px] shrink-0 !h-7 text-[11.5px]"
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_PRESETS[id as ProviderId]?.label ?? id}
                </option>
              ))}
            </Select>
            <TextInput
              value={cfg.model}
              placeholder={t('settings.agent.router.modelPh', 'model id')}
              aria-label={`${label} — ${t('settings.agent.router.modelPh', 'model id')}`}
              onChange={(e) => onSet({ ...cfg, model: e.target.value })}
              className="font-code flex-1 min-w-[120px] max-w-[190px] !h-7 text-[11.5px]"
              dir="ltr"
            />
            <Btn
              variant="ghost"
              className="!h-7 !px-2 text-[10.5px] shrink-0"
              title={t('settings.agent.router.session.hint', 'Falls back to the active session model')}
              onClick={onClear}
            >
              {t('settings.agent.router.useSession', 'use session model')}
            </Btn>
          </>
        ) : (
          <span
            className="stamp !h-[16px] text-[9.5px]"
            title={t('settings.agent.router.session.hint', 'Falls back to the active session model')}
          >
            {t('settings.agent.router.sessionDefault', 'session default')}
          </span>
        )}
      </div>
    </SettingRow>
  );
}

export default AgentSection;
