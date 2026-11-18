import { PanelScreen } from '../ui/components';
import { useDragScroll } from '../ui/useDragScroll';
import { useState, type ReactNode } from 'react';
import { rakhtkan } from '../services/gameVariant';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isValidDisplayName, useLocalProfile } from '../services/localProfile';
import { matchSession } from '../services/matchSession';
import { cosmetics } from '@flickkick/config';
import { ownsLocal, useLocalInventory } from '../services/localInventory';
import { TeamSwatch } from '../ui/components';
import { Button, Card, ScreenHeader } from '../ui/components';

/** F-18: pass-and-play on one device. */
export function LocalSetupScreen({ controls }: { controls?: ReactNode } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useLocalProfile();
  const [names, setNames] = useState<[string, string]>([profile.displayName, t('local.player2')]);
  useLocalInventory();
  const available = cosmetics.teams.filter((item) =>
    rakhtkan ? ownsLocal('teams', item.id) : item.group === 'original',
  );
  const firstTeam = available.some((item) => item.id === profile.teamId) ? profile.teamId : available[0]!.id;
  const topScroll = useDragScroll();
  const bottomScroll = useDragScroll();
  const [teams, setTeams] = useState<[string, string]>([
    firstTeam,
    available.find((item) => item.id !== firstTeam)!.id,
  ]);
  const valid = names.every((n) => isValidDisplayName(n)) && teams[0] !== teams[1];

  const start = () => {
    if (!valid) return;
    matchSession.setSetup({ mode: 'local_pvp', names: [names[0].trim(), names[1].trim()], teams });
    navigate('/match');
  };

  return (
    <PanelScreen className="local-setup">
      <ScreenHeader title={t(rakhtkan ? 'friends.title' : 'local.title')} onBack={() => navigate('/home')} />
      {controls}
      <Card className="form-card">
        {([1, 0] as const).map((i) => (
          <div className="field" key={i}>
            <label className="field__label" htmlFor={`p${i}`}>
              {i === 0 ? t('local.player1') : t('local.player2')}
            </label>
            <input
              id={`p${i}`}
              className="input"
              value={names[i]}
              maxLength={16}
              aria-invalid={!isValidDisplayName(names[i])}
              onChange={(e) => setNames((prev) => (i === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value]))}
            />
            <div
              {...(i === 1 ? topScroll : bottomScroll)}
              className="local-team"
              role="radiogroup"
              aria-label={t('local.team', { n: i + 1 })}
            >
              {available.map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={teams[i] === item.id}
                  disabled={teams[i === 0 ? 1 : 0] === item.id}
                  aria-label={t(`teams.${item.id}`)}
                  className={teams[i] === item.id ? 'is-active' : ''}
                  key={item.id}
                  onClick={() => setTeams((prev) => (i === 0 ? [item.id, prev[1]] : [prev[0], item.id]))}
                >
                  <TeamSwatch teamId={item.id} size={52} />
                </button>
              ))}
            </div>
            {!isValidDisplayName(names[i]) && <small className="field__error">{t('welcome.nameInvalid')}</small>}
          </div>
        ))}
      </Card>
      <Button size="lg" onClick={start} disabled={!valid}>
        {t('local.start')}
      </Button>
    </PanelScreen>
  );
}
