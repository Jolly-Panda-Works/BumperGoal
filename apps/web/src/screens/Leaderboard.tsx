import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, RankBadge, rankForLevel, ScreenHeader, Tabs } from '../ui/components';
import { useLocalProfile } from '../services/localProfile';
import { rpc, useOnline } from '../services/online';
import { formatNumber } from '../i18n';
interface Ranking {
  userId: string;
  name: string;
  avatarId: string;
  level: number;
  rank: number;
  score: number;
}
export function LeaderboardScreen() {
  const { t } = useTranslation();
  const profile = useLocalProfile();
  const server = useOnline();
  const [tab, setTab] = useState<'weekly' | 'allTime'>('weekly');
  const [rows, setRows] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const online = server.status === 'online';
  useEffect(() => {
    let active = true;
    setRows([]);
    setError(false);
    if (!online) {
      setLoading(false);
      return;
    }
    setLoading(true);
    rpc<{ records: Ranking[] }>('leaderboard_list', { period: tab })
      .then(
        (result) => {
          if (active) setRows(result.records);
        },
        () => {
          if (active) setError(true);
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, online, attempt]);
  const now = new Date();
  const week = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const records = profile.history.filter((r) => tab === 'allTime' || r.endedAt >= week);
  const wins = tab === 'allTime' ? profile.practice.won : records.filter((r) => r.won).length;
  const stats = online && server.profile ? server.profile.stats : profile.practice;
  const userId = server.profile?.userId ?? 'local';
  const displayRows = online
    ? rows
    : [
        {
          userId,
          name: profile.displayName,
          avatarId: profile.avatarId,
          level: profile.knownLevel,
          rank: 1,
          score: wins,
        },
      ];
  return (
    <div className="screen leaderboard-screen">
      <div className="shop-heading">
        <ScreenHeader title={t('leaderboard.title')} />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'weekly', label: t('leaderboard.weekly') },
            { id: 'allTime', label: t('leaderboard.allTime') },
          ]}
        />
      </div>
      <Card className="rank-summary">
        <div className="rank-summary__identity">
          <Avatar id={profile.avatarId} size={54} />
          <div>
            <strong>
              <bdi>{profile.displayName}</bdi>
            </strong>
            <small>{t('common.levelLong', { level: formatNumber(profile.knownLevel) })}</small>
          </div>
          <RankBadge rank={rankForLevel(profile.knownLevel)} size={44} />
        </div>
        <dl className="stat-row">
          {(['played', 'won', 'lost'] as const).map((key) => (
            <div key={key}>
              <dt>{t(`profile.${key}`)}</dt>
              <dd>{formatNumber(stats[key])}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="rank-scroll" key={tab}>
        {loading ? (
          <p role="status">{t('common.loading')}</p>
        ) : error ? (
          <Button onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</Button>
        ) : (
          <table className="ranking-table">
            <caption>
              {online ? t(tab === 'weekly' ? 'leaderboard.weekly' : 'leaderboard.allTime') : t('leaderboard.local')}
            </caption>
            <thead>
              <tr>
                <th>{t('leaderboard.position')}</th>
                <th>{t('profile.displayName')}</th>
                <th>{t(online ? 'result.xp' : 'profile.won')}</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.userId} className={row.userId === userId ? 'is-me' : ''}>
                  <td>{formatNumber(row.rank)}</td>
                  <td>
                    <span className="ranking-player">
                      <Avatar id={row.avatarId} size={32} />
                      <bdi>{row.name || t('common.you')}</bdi>
                    </span>
                  </td>
                  <td>{formatNumber(row.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
