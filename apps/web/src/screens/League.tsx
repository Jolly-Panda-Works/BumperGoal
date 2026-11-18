import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { arenasConfig, arenaPrize, progressionConfig } from '@flickkick/config';
import { levelProgress } from '@flickkick/rules';
import { useLocalProfile } from '../services/localProfile';
import { useOnline } from '../services/online';
import { useLocalInventory } from '../services/localInventory';
import { formatNumber } from '../i18n';
import { arenaName } from '../i18n/arenaName';
import { Avatar, Card, RankBadge, rankForLevel, ScreenHeader, ProgressBar } from '../ui/components';
import { IconTrophy, IconLock } from '../ui/icons';

export function LeagueScreen() {
  const { t, i18n } = useTranslation();
  const profile = useLocalProfile();
  const server = useOnline();
  const inventory = useLocalInventory();
  const level = server.profile?.level ?? profile.knownLevel;
  const xp = levelProgress(server.profile?.xp ?? profile.knownXP, progressionConfig);
  const stats = server.profile?.stats ?? profile.practice;
  const wins = Object.values(inventory.ranked?.receipts ?? {}).filter((receipt) => receipt.record.won).length;
  return (
    <div className="screen league-screen">
      <div className="section-heading">
        <ScreenHeader title={t('league.title')} />
        <Link className="btn btn--ghost" to="/leaderboard">
          {t('league.rankings')}
        </Link>
      </div>
      <Card className="league-hero">
        <RankBadge rank={rankForLevel(level)} size={92} />
        <div className="league-hero__copy">
          <div className="league-identity">
            <Avatar id={profile.avatarId} size={44} />
            <strong>
              <bdi>{profile.displayName}</bdi>
            </strong>
          </div>
          <h2>{t('common.levelLong', { level: formatNumber(level) })}</h2>
          <ProgressBar value={xp.current} max={xp.needed || 1} label={t('league.progress')} />
          <small>
            {formatNumber(xp.current)} / {formatNumber(xp.needed)} XP
          </small>
        </div>
        <dl className="league-stats">
          <div>
            <dt>{t('profile.played')}</dt>
            <dd>{formatNumber(stats.played)}</dd>
          </div>
          <div>
            <dt>{t('profile.won')}</dt>
            <dd>{formatNumber(stats.won)}</dd>
          </div>
          <div>
            <dt>{t('league.leagueWins')}</dt>
            <dd>{formatNumber(server.profile?.stats.won ?? wins)}</dd>
          </div>
        </dl>
      </Card>
      <p className="section-note">{t(server.status === 'online' ? 'league.online' : 'league.local')}</p>
      <div className="section-heading">
        <h2>{t('league.road')}</h2>
        <Link to="/rewards/levels">{t('league.rewards')}</Link>
      </div>
      <div className="league-road">
        {arenasConfig.arenas.map((arena, index) => {
          const unlocked = level >= arena.minLevel;
          return (
            <Card key={arena.id} className={`league-stage ${unlocked ? 'is-unlocked' : 'is-locked'}`}>
              <div className="league-stage__number">{formatNumber(index + 1)}</div>
              <IconTrophy size={52} />
              <h3>{arenaName(arena.id, t, i18n.language)}</h3>
              <p>{t('common.levelLong', { level: formatNumber(arena.minLevel) })}</p>
              <dl>
                <div>
                  <dt>{t('league.entry')}</dt>
                  <dd>{formatNumber(arena.entryFee)}</dd>
                </div>
                <div>
                  <dt>{t('league.prize')}</dt>
                  <dd>{formatNumber(arenaPrize(arena))}</dd>
                </div>
              </dl>
              {unlocked ? (
                <Link className="btn btn--primary" to={`/play/online?arena=${arena.id}`}>
                  {t('league.play')}
                </Link>
              ) : (
                <span className="badge">
                  <IconLock size={16} />
                  {t('league.locked')}
                </span>
              )}
            </Card>
          );
        })}
      </div>
      <div className="league-links">
        <Link className="btn btn--secondary" to="/play/ai">
          {t('home.playAI')}
        </Link>
        <Link className="btn btn--ghost" to="/profile/history">
          {t('league.history')}
        </Link>
      </div>
    </div>
  );
}
