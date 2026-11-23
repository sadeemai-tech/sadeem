// ============================================================
// SADEEM v11 — Settings → Updates section.
// Real auto-update plumbing: current version, the feed URL (editable),
// auto-check toggle, a manual "Check now" with live status + progress,
// and an honest unsigned-build note. The user always decides to download;
// install happens on quit or immediately, their choice.
// The masthead + version-ring glyph are presentation only.
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Rocket, TriangleAlert } from 'lucide-react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { APP_VERSION } from '../../version';
import { InfoNote, SettingRow, Toggle } from './controls';
import { Btn, Chip, TextInput } from '../ui';
import './s4-art.css';

/**
 * The live official feed. Mirrors `website/lib/site.ts -> SITE.updateFeed` and
 * `electron/services/updateService.ts -> LIVE_UPDATE_FEED` — the renderer
 * cannot import either module (they live outside `src/` / in the main process),
 * so this single constant keeps the placeholder and the validation copy honest.
 * The undeployed legacy host is deliberately NOT used anywhere in this pane.
 */
const LIVE_UPDATE_FEED = 'https://sadeem-ai.com/updates/'; // v11.40 — official domain

type UpdateState = 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error';

interface UpdateStatus {
  state: UpdateState;
  info?: { version?: string; releaseNotes?: string };
  progress?: { percent?: number; transferred?: number; total?: number };
  error?: string;
}

/** Mirrors main's sanitizeFeedUrl() so invalid input is caught BEFORE it is
 *  sent over the bridge. Empty means "use the official https feed". */
function validateFeed(raw: string, ar: boolean): string | null {
  const url = raw.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return null;
    if (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) return null;
  } catch {
    /* not a URL */
  }
  // No dead domain in the copy: the hint names the official feed generically,
  // the field itself shows the real LIVE_UPDATE_FEED value as its placeholder.
  return ar
    ? 'استخدم رابط https:// (أو http://localhost للتطوير فقط)، أو اترك الحقل فارغاً لخلاصة التحديثات الرسمية.'
    : 'Use an https:// URL (or http://localhost for dev only), or leave empty for the official update feed.';
}

function mb(bytes?: number): string {
  return typeof bytes === 'number' && bytes > 0 ? `${(bytes / 1048576).toFixed(1)} MB` : '';
}

/** One precise artistic element of this page: a version ring — a broken
 *  dial with quarter graduations and a short needle to the current mark. */
const VersionRingGlyph = () => (
  <svg className="s4-glyph" viewBox="0 0 72 56" fill="none" aria-hidden="true">
    <path className="s4-ink" d="M36 9a19 19 0 1 1-16 9" />
    <path className="s4-ink s4-thin" d="M36 4v5M17 28h5M50 28h5M24 15l3 3" />
    <path className="s4-ink" d="M36 28 48 17" />
    <circle className="s4-dot" cx="36" cy="28" r="2" />
    <circle className="s4-dot" cx="49" cy="16" r="1.4" />
  </svg>
);

export function UpdatesSection() {
  const t = useT();
  const ar = useStore((s) => s.settings.language) === 'ar';
  const updateSettings = useStore((s) => s.updateSettings);
  const settingsUpdates = useStore(
    (s) => s.settings.updates as { autoCheck?: boolean; feedUrl?: string } | undefined,
  );
  const autoCheck = settingsUpdates?.autoCheck !== false;

  const [feed, setFeed] = useState('');
  const [feedInvalid, setFeedInvalid] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void api.updateFeedUrl?.().then((u: string) => alive.current && setFeed(u ?? ''));
    void api.updateStatus?.().then((s: UpdateStatus) => alive.current && setStatus(s ?? { state: 'idle' }));
    const off = api.onUpdateStatus?.((s: unknown) => {
      if (alive.current) setStatus((s as UpdateStatus) ?? { state: 'idle' });
    });
    return () => {
      alive.current = false;
      off?.();
    };
  }, []);

  const saveFeed = async () => {
    const invalid = validateFeed(feed, ar);
    if (invalid) {
      setFeedInvalid(invalid);
      return;
    }
    setFeedInvalid(null);
    setLocalError(null);
    try {
      const applied = await api.updateSetFeedUrl?.(feed.trim());
      const effective = typeof applied === 'string' ? applied : feed.trim();
      setFeed(effective);
      // Keep the renderer store's copy in sync. updateSettings() persists the
      // WHOLE settings object to main; without this spread a later toggle
      // would overwrite main's feedUrl with the stale renderer value.
      updateSettings({ updates: { ...(settingsUpdates ?? {}), feedUrl: effective } } as never);
      // A result from the old feed must not linger as "available vX".
      setStatus({ state: 'idle' });
      setLastChecked(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
      setStatus({ state: 'error', error: msg });
    }
  };

  const check = async () => {
    setChecking(true);
    setLocalError(null);
    try {
      await api.updateCheck?.();
      setLastChecked(Date.now());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
      setStatus({ state: 'error', error: msg });
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    setLocalError(null);
    try {
      await api.updateDownload?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
      setStatus({ state: 'error', error: msg });
    }
  };

  const pct = Math.max(0, Math.min(100, Math.round(status.progress?.percent ?? 0)));

  const stateChip = (): React.ReactNode => {
    switch (status.state) {
      case 'checking':
        return <Chip tone="default">{ar ? 'يفحص الآن…' : 'Checking…'}</Chip>;
      case 'available':
        return <Chip tone="acc">{`${ar ? 'متاح' : 'Available'} · v${status.info?.version ?? '?'}`}</Chip>;
      case 'downloading':
        return <Chip tone="acc">{`${ar ? 'ينزّل' : 'Downloading'} ${pct}%`}</Chip>;
      case 'downloaded':
        return <Chip tone="ok">{ar ? 'جاهز للتثبيت' : 'Ready to install'}</Chip>;
      case 'error':
        return <Chip tone="bad">{ar ? 'خطأ' : 'Error'}</Chip>;
      case 'idle':
        return <Chip tone="default">{ar ? 'لم يُفحص بعد' : 'Not checked yet'}</Chip>;
      default:
        return <Chip tone="ok">{ar ? 'أنت على أحدث إصدار' : 'Up to date'}</Chip>;
    }
  };

  return (
    <div className="s4-page s4-updates">
      <header className="s4-mast">
        <div className="s4-mast-top">
          <span className="s4-eyebrow">
            {t('s4.updates.eyebrow', ar ? '٢١ / التحديثات' : '21 / UPDATES')}
          </span>
          <VersionRingGlyph />
        </div>
        <h2 className="s4-title">
          {t('set.updates.title', ar ? 'التحديثات' : 'Updates')}
        </h2>
        <p className="s4-desc">
          {t(
            'set.updates.desc',
            ar
              ? 'افحص الإصدارات الجديدة من خلاصتك الخاصة، ونزّلها حين تريد — لا شيء يُثبَّت دون موافقتك.'
              : 'Check for new releases against your own feed and download when you want — nothing installs without your click.',
          )}
        </p>
        <div className="s4-rule" aria-hidden />
      </header>

      <div className="s4-body">
        <SettingRow
          label={t('set.updates.current', ar ? 'الإصدار الحالي' : 'Current version')}
          hint={`v${APP_VERSION}`}
        >
          <Chip tone="default">v{APP_VERSION}</Chip>
        </SettingRow>

        <SettingRow
          label={t('set.updates.feed', ar ? 'خلاصة التحديثات' : 'Update feed')}
          hint={t(
            'set.updates.feed.hint.v1131',
            ar
              ? `HTTPS فقط — أو اتركه فارغاً للخلاصة الرسمية: ${LIVE_UPDATE_FEED}`
              : `HTTPS only — or leave empty for the official feed: ${LIVE_UPDATE_FEED}`,
          )}
        >
          <div className="flex gap-2 min-w-0 flex-1" style={{ maxWidth: 340 }}>
            <TextInput
              value={feed}
              onChange={(e) => {
                setFeed(e.target.value);
                if (feedInvalid) setFeedInvalid(null);
              }}
              onBlur={() => void saveFeed()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveFeed();
                }
              }}
              dir="ltr"
              className="font-code"
              placeholder={LIVE_UPDATE_FEED}
              aria-invalid={!!feedInvalid}
              aria-label={ar ? 'رابط خلاصة التحديثات' : 'Update feed URL'}
            />
          </div>
        </SettingRow>
        {feedInvalid && (
          <div className="set-note" role="alert" style={{ color: 'var(--bad)' }}>
            {feedInvalid}
          </div>
        )}

        <SettingRow
          label={t('set.updates.autoCheck', ar ? 'فحص تلقائي هادئ' : 'Quiet automatic check')}
          hint={t('set.updates.autoCheck.hint', ar ? 'مرة واحدة بعد الإقلاع بـ10 دقائق — دون أي تنزيل' : 'Once, 10 minutes after boot — never downloads')}
        >
          <Toggle
            checked={autoCheck}
            onChange={(v) =>
              updateSettings({ updates: { ...(settingsUpdates ?? {}), autoCheck: v } } as never)
            }
            label={t('set.updates.autoCheck', 'Quiet automatic check')}
          />
        </SettingRow>

        <div className="flex items-center gap-2 flex-wrap mt-1">
          <Btn variant="primary" onClick={() => void check()} disabled={checking || !!feedInvalid}>
            {checking ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('set.updates.check', ar ? 'فحص الآن' : 'Check now')}
          </Btn>
          {status.state === 'available' && (
            <Btn onClick={() => void download()}>
              <Download size={12} />
              {t('set.updates.download', ar ? 'تنزيل الإصدار' : 'Download update')}
            </Btn>
          )}
          {status.state === 'downloaded' && (
            <Btn variant="primary" onClick={() => void api.updateInstall?.()}>
              <Rocket size={12} />
              {t('set.updates.install', ar ? 'ثبّت وأعد التشغيل' : 'Install and restart')}
            </Btn>
          )}
          <span className="ms-auto">{stateChip()}</span>
        </div>

        {status.state === 'downloading' && (
          <div className="mt-2">
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{ background: 'var(--line)' }}
              role="progressbar"
              aria-label={ar ? 'تقدّم التنزيل' : 'Download progress'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: 'var(--acc)' }}
              />
            </div>
            <div className="text-[11px] text-dim mt-1" dir="ltr">
              {pct}%
              {mb(status.progress?.transferred) && mb(status.progress?.total)
                ? ` · ${mb(status.progress?.transferred)} / ${mb(status.progress?.total)}`
                : ''}
            </div>
          </div>
        )}

        {status.info?.releaseNotes && status.state !== 'error' && (
          <InfoNote>
            <div className="text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {status.info.releaseNotes}
            </div>
          </InfoNote>
        )}

        {(status.state === 'error' && status.error) || localError ? (
          <InfoNote>
            <span className="font-code" dir="ltr" style={{ color: 'var(--bad)' }}>
              {localError || status.error}
            </span>
          </InfoNote>
        ) : null}

        <InfoNote>
          <div className="flex items-start gap-2">
            <TriangleAlert size={13} className="shrink-0 mt-0.5" />
            <span>
              {ar
                ? 'بنيات اليوم غير موقّعة رقمياً: يستطيع المحدّث تثبيت بناءات NSIS، لكن تحذير Windows SmartScreen سيظل ظاهراً حتى تتوفر شهادة توقيع. سلامة التنزيل متوقفة على خلاصة HTTPS فقط. لا يُنزَّل شيء تلقائياً أبداً.'
                : 'Today’s builds are unsigned: the updater can still install NSIS builds, but the Windows SmartScreen warning stays until a signing certificate ships. Integrity rests on the HTTPS feed alone. Nothing ever downloads by itself.'}
            </span>
          </div>
        </InfoNote>

        {lastChecked && (
          <div className="text-[11px] text-dim mt-1">
            {ar ? 'تم الفحص الآن.' : 'Checked just now.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default UpdatesSection;
