// SkillsMemorySection — v5 settings section (15) · المهارات والذاكرة.
// One place for the learning stack: the skills library (trust gate, manager
// link, scope explanation) and memory (auto-learning toggle, global memory
// editor — same settings.memory field Privacy uses).
// FINAL LAUNCH POLISH — presentation only: editorial head, original ring
// glyph, confidence-ladder plate. Every selector / IPC call / control and
// its strings below are byte-for-byte the original wiring.
import React, { useEffect, useState } from 'react';
import { Blocks, BrainCircuit, ExternalLink, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT, useDigits } from '../../i18n';
import { GroupCard, InfoNote, SettingRow, Toggle } from './controls';
import { Btn } from '../ui';
import './s2-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

/** confidence ladder — seven rungs, evenly spaced 12 units apart. */
const LADDER_RUNGS = Array.from({ length: 7 }, (_, i) => {
  const y = 12 + i * 12;
  const x2 = 28 + 44 + i * 22;
  return { i, y, x2 };
});

export function SkillsMemorySection() {
  const t = useT();
  const n = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const skillsTrustNeeded = useStore((s) => s.skillsTrustNeeded);
  const trustWorkspaceSkills = useStore((s) => s.trustWorkspaceSkills);
  const setRail = useStore((s) => s.setRail);
  const setSettings = useStore((s) => s.setSettings);
  const wsPath = useStore((s) => s.wsPath);
  const [skillCount, setSkillCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    // No workspace open → no honest count to show (a '.' probe would list an
    // unrelated CWD and invent a number).
    if (!wsPath) {
      setSkillCount(null);
      return () => { alive = false; };
    }
    void (async () => {
      const list = await api.skillsManagerList(wsPath).catch(() => null);
      if (alive) setSkillCount(Array.isArray(list) ? list.length : null);
    })();
    return () => {
      alive = false;
    };
  }, [wsPath]);

  const openManager = () => {
    setSettings(false);
    setRail('skills');
  };

  const autoMemory = settings.agent?.autoMemory !== false;

  return (
    <section className="set-section s2-page" dir={lang === 'ar' ? 'rtl' : undefined}>
      {/* ---------- refined page head · 02 / SKILLS & MEMORY ---------- */}
      <header className="s2-head">
        <div className="s2-glyph-wrap">
          <svg className="s2-glyph" viewBox="0 0 40 40" aria-hidden="true">
            {/* layered rings */}
            <circle cx="20" cy="20" r="16" />
            <circle cx="20" cy="20" r="10.5" />
            <circle cx="20" cy="20" r="5" />
            <path className="quiet" d="M20 1v4M20 35v4M1 20h4M35 20h4" />
            <circle className="dot" cx="20" cy="20" r="1.4" />
          </svg>
        </div>
        <div className="s2-head-copy">
          <div className="s2-eyebrow">
            <span className="no">{n('02')}</span>
            <span className="slash">/</span>
            {t('settings.nav.memory', 'Skills & Memory')}
          </div>
          <h2 className="s2-display">{t('settings.nav.memory', 'Skills & Memory')}</h2>
          <p className="s2-desc">
            {tx(
              'Skills earn trust through verified runs; memory carries what the agent learned between them.',
              'المهارات تكتسب الثقة بالتشغيلات الموثّقة، والذاكرة تحمل ما تعلّمه الوكيل بينها.',
            )}
          </p>
        </div>
        <span className="s2-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · confidence ladder ---------- */}
      <div className="s2-plate s2-plate--ladder" aria-hidden="true">
        <svg viewBox="0 0 320 104">
          <line className="quiet" x1="28" y1="6" x2="28" y2="90" />
          {LADDER_RUNGS.map(({ i, y, x2 }) => (
            <g key={i}>
              <line
                className={i < 2 ? 'quiet' : i > 4 ? 'accent mid' : 'mid'}
                x1="28" y1={y} x2={x2} y2={y}
              />
              <circle className="dot" cx={x2} cy={y} r={i === 6 ? 2.2 : 1.5} />
            </g>
          ))}
          <circle className="dot accent" cx="28" cy="60" r="2.6" />
          <g className="quiet">
            <line x1="28" y1="97" x2="204" y2="97" />
            <path d="M28 93v8M204 93v8" />
          </g>
        </svg>
      </div>

      <div className="s2-groups">
        <GroupCard title={t('sm.skills.title', 'Skills library')}>
          <div className="flex items-center gap-3 py-1">
            <Blocks size={18} className="text-acc shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">
                {t('sm.skills.manage', 'Manage skills')}
                {skillCount !== null && (
                  <span className="text-dim font-normal"> · {skillCount}</span>
                )}
              </div>
              <div className="text-[11.5px] text-dim">
                {t(
                  'sm.skills.manageHint',
                  'Browse, create, import and fork skills — workspace, global and built-in scopes.',
                )}
              </div>
            </div>
            <Btn onClick={openManager}>
              <ExternalLink size={12} />
              {t('sm.skills.open', 'Open')}
            </Btn>
          </div>

          {skillsTrustNeeded && (
            <SettingRow
              label={t('sm.skills.trust', "Trust this workspace's skills")}
              hint={t(
                'sm.skills.trustDesc',
                'Workspace skills are instructions from the project folder — review them, then enable.',
              )}
            >
              <Btn
                variant="primary"
                disabled={!wsPath}
                onClick={() => {
                  // The store action persists, toasts success and reloads the
                  // skill list; calling the bridge directly failed silently.
                  void trustWorkspaceSkills();
                }}
              >
                {t('sm.skills.trustBtn', 'Trust')}
              </Btn>
            </SettingRow>
          )}

          <InfoNote>
            {t(
              'sm.skills.note',
              'Skills you give the agent are loaded with use_skill BEFORE work begins — they are followed, not ignored. The agent can also save new ones with create_skill. Skills are plain markdown folders on disk — yours to edit and share.',
            )}
          </InfoNote>
        </GroupCard>

        <GroupCard title={t('sm.memory.title', 'Memory')}>
          <div className="flex items-center gap-3 py-1">
            <BrainCircuit size={18} className="text-acc shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">{t('sm.memory.auto', 'Auto-learning')}</div>
              <div className="text-[11.5px] text-dim">
                {t(
                  'sm.memory.autoHint',
                  'After each run, distill durable project facts into MEMORY.md and user patterns into DNA.',
                )}
              </div>
            </div>
            <Toggle
              checked={autoMemory}
              onChange={(v) =>
                updateSettings({ agent: { ...(settings.agent ?? {}), autoMemory: v } })
              }
            />
          </div>

          <SettingRow
            label={t('sm.memory.global', 'Global memory')}
            hint={t('sm.memory.globalDesc', 'Text injected into every agent run, in every project.')}
          >
            <textarea
              className="set-textarea"
              value={settings.memory ?? ''}
              placeholder={t('settings.memory.ph', 'Anything the agent should always know…')}
              onChange={(e) => updateSettings({ memory: e.target.value })}
              dir="auto"
            />
          </SettingRow>
        </GroupCard>
      </div>
    </section>
  );
}

export default SkillsMemorySection;
