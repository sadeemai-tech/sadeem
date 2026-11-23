// SADEEM onboarding — v10: ONE premium, skippable screen.
// Brand-plate hero (Logo + SADEEM wordmark + version stamp) → three
// quick-start cards (Open folder / New project / Clone, existing store
// actions only) → provider select + API key with honest "stored locally"
// helper text → security-posture segmented control (real presets from
// ./settings/presets — READ-ONLY import) → one primary "Enter SADEEM"
// button. Esc behaves exactly like Enter-without-config: it never traps
// the user. Everything persists through the normal updateSettings path;
// no new store fields were added. Breathing layout, token-only colors,
// lucide icons only, bilingual/RTL via dir="auto" + logical props.
import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  FilePlus2,
  FolderOpen,
  GitBranch,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { PROVIDER_PRESETS, useStore } from '../store';
import { useT } from '../i18n';
import { APP_VERSION } from '../version';
import type { ProviderId } from '../../shared/types';
import { Field, Select, TextInput } from './ui';
import { Logo } from './Logo';
import { IconTile } from './icons';
import { PRESET_IDS, SECURITY_PRESETS, applyPreset, type PresetId } from './settings/presets';

export function Onboarding() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const open = useStore((s) => s.onboardingOpen);
  const settings = useStore((s) => s.settings);
  const wsPath = useStore((s) => s.wsPath);
  const updateSettings = useStore((s) => s.updateSettings);
  const openFolderDialog = useStore((s) => s.openFolderDialog);
  const setNewProject = useStore((s) => s.setNewProject);
  const setCloneOpen = useStore((s) => s.setCloneOpen);

  const [closed, setClosed] = useState(false);
  const [provId, setProvId] = useState<ProviderId>(settings.model?.provider ?? 'anthropic');
  const [apiKey, setApiKey] = useState('');
  const [later, setLater] = useState(false);
  const [chosenPreset, setChosenPreset] = useState<PresetId | null>(null);

  const finish = () => {
    updateSettings({ onboardingDone: true });
    setClosed(true);
  };

  // Esc = Enter-without-config. Local capture listener (stops before the
  // app-level Esc handler); onboarding is in App's overlayOpen guard too.
  useEffect(() => {
    if (!open || closed) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closed]);

  if (closed || !open) return null;

  const preset = PROVIDER_PRESETS[provId];
  const keyless = preset.keyless || provId === 'custom';
  const hasKey =
    keyless || (settings.providers[provId]?.apiKey ?? '').length > 0 || apiKey.length > 0;

  /** Quick-start actions — existing store behaviors only (no new fields). */
  const QUICK: { id: string; icon: ReactNode; titleKey: string; titleFb: string; subKey: string; subFb: string; run: () => void }[] = [
    {
      id: 'open',
      icon: <FolderOpen size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.open',
      titleFb: 'Open folder',
      subKey: 'welcome.openDesc',
      subFb: 'Work on any folder on this machine',
      run: () => void openFolderDialog(),
    },
    {
      id: 'new',
      icon: <FilePlus2 size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.newProject',
      titleFb: 'New project',
      subKey: 'welcome.newProjectDesc',
      subFb: 'Create a project from scratch with the AI',
      run: () => setNewProject(true),
    },
    {
      id: 'clone',
      icon: <GitBranch size={15} strokeWidth={1.7} />,
      titleKey: 'welcome.clone',
      titleFb: 'Clone repository',
      subKey: 'welcome.cloneDesc',
      subFb: 'git clone from any URL',
      run: () => setCloneOpen(true),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto set-scroll"
      style={{ background: 'var(--bg)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboard.title', 'Welcome to SADEEM')}
    >
      {/* sanctioned brand wash — token-derived, ≤2 subtle radial stops */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'none',
        }}
      />

      <div className="relative w-[640px] max-w-full mx-auto pt-14 pb-10 px-6 anim-in">
        {/* ══════════════════════════════════════════════
            HERO — brand plate + wordmark + version stamp
            ══════════════════════════════════════════════ */}
        <header className="flex flex-col items-center text-center">
          <Logo size={52} />
          <h1 className="caps caps-xl mt-4 select-none leading-none m-0">
            <span className="aurora-gradient-text">{t('app.name', 'SADEEM')}</span>
          </h1>
          <span
            className="stamp tnum mt-3"
            dir="ltr"
            title={t('ck.hero.verTip', 'Version {v}', { v: APP_VERSION })}
          >
            v{APP_VERSION}
          </span>
          {/* v11.31 — one tagline in the ACTIVE language only. The old plate
              printed EN and AR together regardless of the language setting. */}
          <p
            className="mt-4 text-[14px] leading-snug text-[var(--ink)]"
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            lang={lang === 'ar' ? 'ar' : 'en'}
          >
            {lang === 'ar'
              ? t('ck.tagline.arabic', 'الوكيل الذي يجب أن يُثبت أنه أنهى.')
              : t('ck.tagline.latin', 'The agent that must PROVE it is done.')}
          </p>
        </header>

        {/* ══════════════════════════════════════════════
            REAL CAPABILITIES — honest, one line per script.
            BYOK / no subscription is the actual current state.
            ══════════════════════════════════════════════ */}
        <section className="mt-7 text-center" aria-label={t('onboard.caps.title', 'What SADEEM really does')}>
          {/* One line, active language only — no EN+AR stacked together. */}
          <p className="text-[11.5px] leading-snug text-dim" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang === 'ar' ? 'ar' : 'en'}>
            {lang === 'ar'
              ? t(
                  'onboard.caps',
                  '145 أداة حقيقية · ملفات أدوات · دليل حيّ · وكلاء خارجيون وفروع · بمفتاحك الخاص بلا اشتراك.',
                )
              : t(
                  'onboard.caps',
                  '145 real tools · tool profiles · Living Playbook · MCP & subagents · bring your own key — no subscription.',
                )}
          </p>
          <p className="text-[10.5px] text-faint mt-1.5" dir="auto">
            {t(
              'onboard.caps.guide',
              'Open the capability guide from the command palette ({mod}+K) anytime.',
              { mod: 'Ctrl' },
            )}
          </p>
        </section>

        {/* ══════════════════════════════════════════════
            QUICK START — open folder / new project / clone
            ══════════════════════════════════════════════ */}
        <section className="mt-9" aria-label={t('welcome.quick.title', 'Quick start')}>
          <div className="grid sm:grid-cols-3 gap-2.5">
            {QUICK.map(({ id, icon, titleKey, titleFb, subKey, subFb, run }) => (
              <button
                key={id}
                type="button"
                className="aurora-panel aurora-raised p-4 text-start cursor-pointer group min-w-0 flex flex-col gap-2.5"
                onClick={run}
                aria-label={t(titleKey, titleFb)}
              >
                <IconTile icon={icon} tone="var(--acc2)" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--ink)] truncate group-hover:text-[var(--acc)] transition-colors" dir="auto">
                    {t(titleKey, titleFb)}
                  </span>
                  <span className="block text-[10.5px] text-faint leading-snug mt-0.5 line-clamp-2" dir="auto">
                    {t(subKey, subFb)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════
            PROVIDER — select + key, honest local storage note
            ══════════════════════════════════════════════ */}
        <section
          className="aurora-panel p-5 mt-6"
          aria-label={t('onboard.ai.title', 'Connect an AI model')}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} strokeWidth={1.7} className="text-acc shrink-0" aria-hidden />
            <span className="caps caps-md text-[var(--ink)]">
              {t('onboard.ai.title', 'Connect an AI model')}
            </span>
          </div>
          <p className="text-[11.5px] text-dim mt-0.5" dir="auto">
            {t('onboard.ai.sub', 'Pick a provider and paste your API key — it stays on this device.')}
          </p>

          <div className="mt-4">
            <Field label={t('settings.providers', 'AI providers')}>
              <Select
                value={provId}
                onChange={(e) => {
                  setProvId(e.target.value as ProviderId);
                  setApiKey('');
                }}
              >
                {Object.entries(PROVIDER_PRESETS).map(([rawId, p]) => (
                  <option key={rawId} value={rawId}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            {!keyless && !later && (
              <Field label={t('settings.apiKey', 'API key')}>
                <TextInput
                  type="password"
                  autoComplete="off"
                  dir="ltr"
                  className="font-code"
                  placeholder="sk-…"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    updateSettings({
                      providers: {
                        ...settings.providers,
                        // v11.12 (A6-RADICAL fix #7): onboarding now writes
                        // enabled:true — the old shape {apiKey} left the entry
                        // eligible-by-credentials but permanently model-less
                        // unless the user later opened Settings.
                        [provId]: { ...(settings.providers[provId] ?? {}), apiKey: e.target.value, enabled: true },
                      },
                    });
                  }}
                />
              </Field>
            )}

            <p className="text-[11px] text-faint flex items-center gap-1.5" dir="auto">
              <KeyRound size={12} strokeWidth={1.7} aria-hidden />
              {t('onboard.key.localOnly', 'Your key is stored locally on your machine only — it is never sent anywhere but your chosen provider.')}
            </p>

            <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
              <span
                className="flex items-center gap-1.5 text-[11px]"
                style={{ color: hasKey ? 'var(--ok)' : 'var(--faint)' }}
              >
                {hasKey ? <Check size={12} aria-hidden /> : <KeyRound size={12} aria-hidden />}
                {hasKey
                  ? t('onboard.key.ok', 'Provider ready')
                  : t('onboard.key.missing', 'No key yet — SADEEM will ask when you first run')}
              </span>
              {!keyless && !later && (
                <button
                  type="button"
                  className="text-[11px] text-acc hover:underline cursor-pointer"
                  onClick={() => setLater(true)}
                >
                  {t('onboard.skipModel', 'Configure later')}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════
            WORKSPACE + SECURITY POSTURE (segmented control)
            ══════════════════════════════════════════════ */}
        <section className="aurora-panel p-5 mt-3" aria-label={t('onboard.ws.title', 'Open a project')}>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              className="btn btn-primary press"
              onClick={() => void openFolderDialog()}
            >
              <FolderOpen size={14} strokeWidth={1.8} />
              {t('onboard.folderPick', 'Pick a folder')}
            </button>
            {wsPath ? (
              <span className="flex items-center gap-1.5 text-[11.5px] min-w-0" style={{ color: 'var(--ok)' }}>
                <Check size={13} className="shrink-0" aria-hidden />
                <span className="font-code text-[10.5px] text-dim truncate max-w-[34ch]" dir="ltr" title={wsPath}>
                  {wsPath}
                </span>
              </span>
            ) : (
              <span className="text-[11px] text-faint" dir="auto">
                {t('onboard.ws.later', 'Or open one later from the Welcome screen')}
              </span>
            )}
          </div>

          <div className="aurora-divider my-4" aria-hidden />

          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={14} strokeWidth={1.7} className="text-acc shrink-0" aria-hidden />
            <span className="caps caps-md text-[var(--ink)]">
              {t('onboard.step.security', 'Security level')}
            </span>
          </div>
          <p className="text-[11px] text-dim mt-0.5" dir="auto">
            {t(
              'onboard.security.sub',
              'One posture for approvals, verification and network — change it anytime in Settings.',
            )}
          </p>

          {/* segmented control — real presets, selected = accent fill */}
          <div
            className="mt-3 inline-flex flex-wrap items-center gap-1 p-1 rounded-[var(--radius-sm)]"
            style={{ background: 'var(--bg1)', border: '1px solid var(--line)' }}
            role="group"
            aria-label={t('onboard.step.security', 'Security level')}
          >
            {PRESET_IDS.map((id) => {
              const p = SECURITY_PRESETS.find((x) => x.id === id);
              if (!p) return null;
              const active = chosenPreset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setChosenPreset(id);
                    applyPreset(id);
                  }}
                  aria-pressed={active}
                  title={p.summary.join(' · ')}
                  className="h-7 px-3 inline-flex items-center gap-1.5 rounded-[6px] text-[11.5px] font-semibold cursor-pointer transition-colors"
                  style={
                    active
                      ? { background: 'var(--acc)', color: 'var(--acc-ink)' }
                      : { color: 'var(--faint)' }
                  }
                >
                  <ShieldCheck size={12} strokeWidth={1.8} aria-hidden />
                  <span dir="auto">{t(p.labelKey, id)}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-faint mt-3" dir="auto">
            {t('onboard.trust.note', 'Nothing runs outside the chosen folder without asking you first.')}
          </p>
        </section>

        {/* ══════════════════════════════════════════════
            ENTER + ESCAPE HATCH
            ══════════════════════════════════════════════ */}
        <div className="flex flex-col items-center mt-8 mb-2">
          <button
            type="button"
            className="btn btn-primary press !h-10 !px-8 !text-[13.5px] !rounded-full"
            onClick={finish}
            autoFocus
          >
            {t('onboard.enter', 'Enter SADEEM')}
          </button>
          <p className="text-[10.5px] text-faint mt-3 text-center" dir="auto">
            {t(
              'onboard.enter.hint',
              'Provider, folder and security can all be changed later in Settings — Esc exits anytime.',
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;
