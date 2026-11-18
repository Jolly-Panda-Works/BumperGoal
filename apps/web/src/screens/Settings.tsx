import { useOnline } from '../services/online';
import { LinkEmailCard } from './Profile';
import { PanelScreen } from '../ui/components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { SIM_VERSION } from '@flickkick/sim';
import { useLanguages, formatNumber } from '../i18n';
import { audio } from '../services/audio';
import { localInventory } from '../services/localInventory';
import { profileStore } from '../services/localProfile';
import { settingsStore, useSettings } from '../services/settings';
import { Button, Card, ConfirmDialog, ScreenHeader, Segmented, Slider, Toggle } from '../ui/components';

const APP_VERSION = '0.1.0';

/** F-17: every setting here is applied to the live game and UI. */
export function SettingsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const s = useSettings();
  const languageOptions = useLanguages();
  const online = useOnline();
  const [confirm, setConfirm] = useState<'reset' | 'clear' | null>(null);
  const pct = (v: number) => `${formatNumber(Math.round(v * 100))}%`;

  return (
    <PanelScreen className="settings">
      <ScreenHeader title={t('settings.title')} onBack={() => navigate('/profile')} />

      <Card>
        <h2>{t('settings.audio')}</h2>
        <Slider
          label={t('settings.music')}
          value={s.musicVolume}
          format={pct}
          disabled={s.muted}
          onChange={(musicVolume) => settingsStore.set({ musicVolume })}
        />
        <Slider
          label={t('settings.sfx')}
          value={s.sfxVolume}
          format={pct}
          disabled={s.muted}
          onChange={(sfxVolume) => {
            settingsStore.set({ sfxVolume });
            audio.play('tap');
          }}
        />
        <Toggle label={t('settings.mute')} checked={s.muted} onChange={(muted) => settingsStore.set({ muted })} />
        <Toggle
          label={t('settings.voiceChat')}
          hint={t('settings.voiceChatNote')}
          checked={s.voiceChat}
          onChange={(voiceChat) => settingsStore.set({ voiceChat })}
        />
      </Card>

      <Card>
        <Segmented
          label={t('settings.language')}
          value={s.language}
          options={languageOptions.map((l) => ({ value: l.id, label: l.label }))}
          onChange={(language) => settingsStore.set({ language })}
        />
      </Card>

      <Card>
        <h2>{t('settings.gameplay')}</h2>
        <Segmented
          label={t('settings.graphics')}
          value={s.graphics}
          options={[
            { value: 'low', label: t('settings.graphicsLow') },
            { value: 'high', label: t('settings.graphicsHigh') },
          ]}
          onChange={(graphics) => settingsStore.set({ graphics })}
        />
        <Slider
          label={t('settings.aimSensitivity')}
          value={s.aimSensitivity}
          min={0.5}
          max={2}
          step={0.1}
          format={(v) => `×${formatNumber(Math.round(v * 10) / 10)}`}
          onChange={(aimSensitivity) => settingsStore.set({ aimSensitivity })}
        />
        <Toggle
          label={t('settings.aimGuide')}
          checked={s.aimGuide}
          onChange={(aimGuide) => settingsStore.set({ aimGuide })}
        />
      </Card>

      <Card>
        <h2>{t('settings.accessibility')}</h2>
        <Toggle
          label={t('settings.reducedMotion')}
          checked={s.reducedMotion}
          onChange={(reducedMotion) => settingsStore.set({ reducedMotion })}
        />
        <Toggle
          label={t('settings.highContrast')}
          checked={s.highContrast}
          onChange={(highContrast) => settingsStore.set({ highContrast })}
        />
        <Toggle
          label={t('settings.vibration')}
          checked={s.vibration}
          onChange={(vibration) => settingsStore.set({ vibration })}
        />
        <Toggle
          label={t('settings.notifications')}
          checked={s.inGameToasts}
          onChange={(inGameToasts) => settingsStore.set({ inGameToasts })}
        />
      </Card>

      <Card>
        <h2>{t('settings.privacy')}</h2>
        <Toggle
          label={t('settings.analytics')}
          hint={t('settings.analyticsNote')}
          checked={s.analyticsOptIn}
          onChange={(analyticsOptIn) => settingsStore.set({ analyticsOptIn })}
        />
      </Card>

      <div className="button-row">
        <Button variant="ghost" onClick={() => setConfirm('reset')}>
          {t('settings.reset')}
        </Button>
        {import.meta.env.DEV && (
          <Button variant="danger" onClick={() => setConfirm('clear')}>
            {t('settings.clearData')}
          </Button>
        )}
      </div>
      {online.status === 'online' &&
        (online.profile?.emailLinked ? <p className="notice">{t('profile.linked')}</p> : <LinkEmailCard />)}
      <p className="fine-print settings__version">
        {t('settings.version', { version: APP_VERSION, sim: SIM_VERSION })}
      </p>

      <ConfirmDialog
        open={confirm === 'reset'}
        title={t('settings.resetTitle')}
        body={t('settings.resetBody')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          settingsStore.reset();
          setConfirm(null);
        }}
      />
      {import.meta.env.DEV && (
        <ConfirmDialog
          open={confirm === 'clear'}
          danger
          title={t('settings.clearTitle')}
          body={t('settings.clearBody')}
          confirmLabel={t('settings.clearData')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            settingsStore.reset();
            profileStore.reset();
            localInventory.reset();
            setConfirm(null);
            navigate('/welcome', { replace: true });
          }}
        />
      )}
    </PanelScreen>
  );
}
