import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { aiProfiles, type AIProfile } from '@flickkick/config';
import { profileForLevel } from '@flickkick/rules';
import { formatNumber } from '../i18n';
import { matchSession } from '../services/matchSession';
import { useLocalProfile } from '../services/localProfile';
import { botPortraitUrl } from '../game/art';
import { ArtImage, Button, ScreenHeader } from '../ui/components';

/** F-08: local match vs AI. Difficulty follows the player's level by default. */
export function PlayAIScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useLocalProfile();
  const matched = profileForLevel(profile.knownLevel);
  const [choice, setChoice] = useState<AIProfile['id']>(matched.id);

  const start = () => {
    matchSession.setSetup({ mode: 'local_ai', aiProfileId: choice, levelMatched: choice === matched.id });
    navigate('/match');
  };

  return (
    <div className="screen ai-screen">
      <ScreenHeader title={t('ai.title')} onBack={() => navigate('/home')} />
      <h2 className="section-title">{t('ai.override')}</h2>
      <div className="difficulty-grid" role="radiogroup" aria-label={t('ai.override')}>
        {[...aiProfiles]
          .sort((a, b) => a.minLevel - b.minLevel)
          .map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={choice === p.id}
              className={`choice ${choice === p.id ? 'is-active' : ''}`}
              onClick={() => setChoice(p.id)}
            >
              <ArtImage className="bot-portrait" src={botPortraitUrl(p.id)} size={112} />
              <strong>{t(`ai.profiles.${p.id}`)}</strong>
              {p.id === matched.id && <em>{t('common.levelLong', { level: formatNumber(profile.knownLevel) })}</em>}
            </button>
          ))}
      </div>
      <Button size="lg" onClick={start}>
        {t('ai.start')}
      </Button>
    </div>
  );
}
