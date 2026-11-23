// ============================================================
// SADEEM — What's New card. Shown ONCE per version, right after
// the account gate releases, when the persisted
// settings.lastSeenVersion falls behind APP_VERSION. Dismissing
// stamps the version (settings.json) so it never nags again.
//
// Copy reflects the REAL current state (verified against the live
// registry and docs): 145 registered tools, tool profiles, a Living
// Playbook, MCP/subagents, and BYOK with no subscription.
// ============================================================
import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { APP_VERSION } from '../version';
import { Btn } from './ui';

/** Current-state highlights — bilingual, honest, user-facing only. */
const HIGHLIGHTS: { ar: string; en: string }[] = [
  {
    ar: '145 أداة مسجّلة ومختبرة فعلاً: ملفات وطرفية واعتماديات ومتصفح ومستندات وصور وقواعد بيانات وغيرها — وكل استدعاء يخضع لإعدادات الموافقة لديك.',
    en: '145 registered and tested tools: files, terminal, git, browser, documents, images, databases and more — with every call gated by your approval posture.',
  },
  {
    ar: 'ملفات الأدوات: اختر أساسي (40 أداة) أو متوازن (120، الافتراضي) أو كامل (145). الملف الأخف يرسل مخططات أقل في كل طلب — وهو الفرق الذي يحتاجه النموذج الضعيف.',
    en: 'Tool profiles: pick essential (40 tools), balanced (120, the default) or full (145). A leaner profile sends fewer schemas every request — the difference a weaker model needs.',
  },
  {
    ar: 'الدليل الحيّ: بعد كل تشغيل يلخّص سديم ما نجح وما فشل وتفضيلاتك في دليل مُنسَّخ لمساحة العمل، يُعاد حقنه كسياق إرشادي فيجيب بمرور الوقت أفضل على مشروعك.',
    en: 'Living Playbook: after a run, SADEEM distills what worked, what failed and your preferences into a versioned, per-workspace playbook, fed back as advisory context so it gets better on your project over time.',
  },
  {
    ar: 'إمكانيات حقيقية يمكن التحقق منها: أوامر شرطة مائلة فورية، خوادم أدوات خارجية حقيقية، وكلاء فرعيون في الخلفية، ومعاينة حية تفتح نفسها تلقائياً، وحماية مشدّدة: تشفير المفاتيح وحماية المسارات وعزل الاتصالات.',
    en: 'Real, verifiable capabilities: instant slash commands, real MCP servers, background subagents, a live preview that opens itself, and hardened security — key encryption, path jail and an IPC allowlist.',
  },
  {
    ar: 'بمفتاحك الخاص فقط: لا اشتراك ولا خطة شهرية. مفتاحك يُحفظ محلياً على جهازك ولا يُرسل إلا إلى المزوّد الذي تختاره. افتح «دليل الإمكانيات» من لوحة الأوامر في أي وقت.',
    en: 'Bring your own key only: no subscription and no monthly plan. Your key stays on this device and goes only to the provider you choose. Open the capability guide from the command palette anytime.',
  },
];

export function WhatsNew() {
  const t = useT();
  const ar = useStore((s) => s.settings?.language ?? 'en') === 'ar';
  const lastSeen = useStore((s) => s.settings?.lastSeenVersion);
  const booted = useStore((s) => s.booted);
  const account = useStore((s) => s.account);
  const updateSettings = useStore((s) => s.updateSettings);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // only after the gate released (an account exists) and the version is fresh
    setVisible(Boolean(booted && account && lastSeen !== APP_VERSION));
  }, [booted, account, lastSeen]);

  if (!visible) return null;

  const dismiss = () => {
    updateSettings({ lastSeenVersion: APP_VERSION });
    setVisible(false);
  };

  return (
    <div
      className="fixed inset-0 z-[84] flex items-center justify-center p-6"
      style={{ background: 'color-mix(in srgb, var(--ink) 32%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('whatsnew.title', "What's new")}
    >
      <div
        className="card w-full max-w-[420px] p-5 anim-in"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Sparkles size={15} className="text-acc shrink-0" aria-hidden />
          <h2 className="caps caps-md m-0" dir="auto">
            {t('whatsnew.title', ar ? 'جديد في سديم' : "What's new in SADEEM")} · v{APP_VERSION}
          </h2>
          <span className="flex-1" />
          <button className="ibtn press" onClick={dismiss} aria-label={t('whatsnew.close', ar ? 'إغلاق' : 'Close')}>
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="ruler my-3" />
        <ul className="flex flex-col gap-2.5 m-0 p-0 list-none">
          {HIGHLIGHTS.map((h, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="tnum text-[11px] shrink-0 mt-0.5 w-[20px]" style={{ color: 'var(--acc2)' }} dir="ltr">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-[12px] leading-relaxed text-dim" dir="auto">
                {ar ? h.ar : h.en}
              </span>
            </li>
          ))}
        </ul>
        <Btn variant="primary" className="w-full h-9 mt-4" onClick={dismiss}>
          {t('whatsnew.got', ar ? 'رائع — لنبدأ' : 'Great — let’s go')}
        </Btn>
      </div>
    </div>
  );
}

export default WhatsNew;
