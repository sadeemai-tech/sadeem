// ============================================================
// SADEEM settings — Notifications section.
// Desktop notification on agent completion + close-to-tray
// behaviour. Single home for both (Agent stays pure engine).
// ============================================================
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { S1Page } from './GeneralSection';
import { GroupCard, SettingRow, Toggle } from './controls';
import './s1-art.css';

export function NotificationsSection() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const ar = useStore((s) => s.settings.language === 'ar');

  return (
    <S1Page
      className="s1-notifications"
      eyebrow={t('s1.eyebrow.notifications', ar ? '١١ / الإشعارات' : '11 / NOTIFICATIONS')}
      titleKey="settings.nav.notifications"
      titleFallback="Notifications"
      glyph="notifications"
      desc={t(
        'settings.notifications.desc',
        'Desktop-level feedback while SADEEM runs in the background.',
      )}
    >
      <GroupCard>
        <SettingRow
          label={t('settings.doneNotifications', 'Notify when agent finishes')}
          hint={t(
            'settings.doneNotifications.hint',
            'Desktop notification when a run completes in the background',
          )}
        >
          <Toggle
            checked={settings.doneNotifications !== false}
            onChange={(v) => updateSettings({ doneNotifications: v })}
            label={t('settings.doneNotifications', 'Notify when agent finishes')}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.closeToTray', 'Close to system tray')}
          hint={t(
            'settings.closeToTray.hint',
            'Keep SADEEM running in the tray when the window is closed',
          )}
        >
          <Toggle
            checked={settings.closeToTray === true}
            onChange={(v) => updateSettings({ closeToTray: v })}
            label={t('settings.closeToTray', 'Close to system tray')}
          />
        </SettingRow>
      </GroupCard>
    </S1Page>
  );
}

export default NotificationsSection;
