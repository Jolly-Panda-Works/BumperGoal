import { rakhtkan } from '../services/gameVariant';
import { matchSession } from '../services/matchSession';
import { localOnlineEnabled, localRankedHistory } from '../services/localRanked';
import { PanelScreen } from '../ui/components';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useLocation } from 'react-router';
import type { Side } from '@flickkick/rules';
import { cosmetics } from '@flickkick/config';
import { formatNumber } from '../i18n';
import { useLocalProfile, type LocalMatchRecord } from '../services/localProfile';
import { connect, rpc, useOnline } from '../services/online';
import type { MatchStatistics } from '../game/matchStatistics';
import { Avatar, Badge, Button, Card, EmptyState, ScreenHeader, Spinner, TeamSwatch } from '../ui/components';
import { IconHistory, IconInfo, IconUsers } from '../ui/icons';

interface OnlineHistoryEntry {
  matchId: string;
  endedAt: number;
  mode: string;
  arena: string;
  opponentName: string;
  opponentIsBot: boolean;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  reason: string;
  rewards: { xp: number; coins: number; gems: number };
  playerName?: string;
  playerAvatarId?: string;
  opponentAvatarId?: string;
  teamId?: string;
  opponentTeamId?: string;
  playerSide?: Side;
  statistics?: MatchStatistics;
}
interface HistoryRecord {
  id: string;
  endedAt: number;
  kind: 'practice' | 'online';
  playerName: string;
  playerAvatarId?: string;
  opponentAvatarId?: string;
  opponentName: string;
  teamId?: string;
  opponentTeamId?: string;
  opponentIsBot: boolean;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  mode: string;
  reason: string;
  aiProfile?: string | null;
  arena?: string;
  playerSide: Side;
  statistics?: MatchStatistics;
}
const fromLocal = (entry: LocalMatchRecord): HistoryRecord => ({
  ...entry,
  kind: 'practice',
  playerName: entry.playerName ?? '',
  playerSide: entry.playerSide ?? 'L',
});
const fromOnline = (entry: OnlineHistoryEntry): HistoryRecord => ({
  ...entry,
  id: entry.matchId,
  endedAt: entry.endedAt * 1000,
  kind: 'online',
  playerName: entry.playerName ?? '',
  playerSide: entry.playerSide ?? 'L',
});

function TeamIdentity({
  name,
  teamId,
  away = false,
  bot = false,
  avatarId,
}: {
  name: string;
  teamId?: string;
  away?: boolean;
  bot?: boolean;
  avatarId?: string;
}) {
  const { t } = useTranslation();
  const known = teamId && cosmetics.teams.some((team) => team.id === teamId);
  return (
    <span className={`match-team ${away ? 'match-team--away' : ''}`}>
      <span className="match-team__copy">
        <strong>
          <bdi>{known ? t(`teams.${teamId}`) : name}</bdi>
        </strong>
        {known && (
          <small>
            <bdi>{name}</bdi>
          </small>
        )}
      </span>
      {avatarId ? (
        <Avatar id={avatarId} size={30} />
      ) : known ? (
        <TeamSwatch teamId={teamId} size={30} />
      ) : bot ? (
        <Avatar id="bot" size={30} />
      ) : (
        <span className="match-team__unknown">
          <IconUsers size={24} />
        </span>
      )}
    </span>
  );
}
function MatchScore({ record }: { record: HistoryRecord }) {
  const { t } = useTranslation();
  const profile = useLocalProfile();
  return (
    <div className="match-scoreline" dir="ltr">
      <TeamIdentity
        name={record.playerName || profile.displayName || t('common.you')}
        teamId={record.teamId}
        avatarId={record.playerAvatarId ?? profile.avatarId}
      />
      <strong
        className={`match-score-pill ${record.won ? 'is-win' : 'is-loss'}`}
        aria-label={`${formatNumber(record.scoreFor)} - ${formatNumber(record.scoreAgainst)}`}
      >
        {formatNumber(record.scoreFor)} - {formatNumber(record.scoreAgainst)}
      </strong>
      <TeamIdentity
        away
        name={record.opponentName}
        teamId={record.opponentTeamId}
        bot={record.opponentIsBot}
        avatarId={record.opponentAvatarId}
      />
    </div>
  );
}
function MatchMeta({ record }: { record: HistoryRecord }) {
  const { t } = useTranslation();
  return (
    <>
      <Badge>
        {record.kind === 'online'
          ? t('history.onlineTab')
          : t(record.mode === 'local_pvp' ? 'history.local2p' : 'history.practice')}
      </Badge>
      {record.aiProfile && <Badge>{t(`ai.profiles.${record.aiProfile}`)}</Badge>}
    </>
  );
}
const summaryTransition = (record: HistoryRecord) =>
  'match-' +
  record.kind +
  '-' +
  Array.from(record.id)
    .map((char) => char.codePointAt(0)!.toString(16))
    .join('-');

function MatchSummary({ record, detail = false }: { record: HistoryRecord; detail?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <div className="match-record__heading">
        <time dateTime={new Date(record.endedAt).toISOString()}>
          {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(record.endedAt)}
        </time>
        <Badge tone={record.won ? 'success' : 'danger'}>{t(record.won ? 'history.won' : 'history.lost')}</Badge>
      </div>
      <MatchScore record={record} />
      <div className="match-record__meta">
        <span>
          <MatchMeta record={record} />
        </span>
        {!detail && (
          <span className="match-record__details">
            <IconInfo size={15} />
            {t('stats.view')}
          </span>
        )}
      </div>
    </>
  );
}
function HistoryRow({ record }: { record: HistoryRecord }) {
  return (
    <li>
      <Link
        className="card match-record match-summary"
        style={{ viewTransitionName: summaryTransition(record) }}
        state={{ historyRecord: record }}
        to={`/profile/history/${record.kind}/${encodeURIComponent(record.id)}`}
      >
        <MatchSummary record={record} />
      </Link>
    </li>
  );
}
export function HistoryScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { history } = useLocalProfile();
  const { status } = useOnline();
  const [online, setOnline] = useState<OnlineHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (status !== 'online') return;
    let active = true;
    setOnline(null);
    setFailed(false);
    rpc<{ entries: OnlineHistoryEntry[] }>('history_list').then(
      (result) => {
        if (active) setOnline(result.entries);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [status, attempt]);
  const ranked =
    localOnlineEnabled && status !== 'online'
      ? localRankedHistory().map((receipt) => ({
          ...fromLocal(receipt.record),
          kind: 'online' as const,
          arena: receipt.arena,
        }))
      : (online ?? []).map(fromOnline);
  const records = [...history.map(fromLocal), ...ranked].sort((a, b) => b.endedAt - a.endedAt);
  return (
    <PanelScreen className="history-screen">
      <ScreenHeader title={t('history.title')} onBack={() => navigate('/profile')} />
      {failed ? (
        <Button onClick={() => setAttempt((value) => value + 1)}>{t('common.retry')}</Button>
      ) : !records ? (
        <Spinner label={t('common.loading')} />
      ) : !records.length ? (
        <EmptyState
          art="empty-history"
          icon={<IconHistory size={40} />}
          title={t('history.empty')}
          action={<Button onClick={() => navigate('/play/ai')}>{t('home.playAI')}</Button>}
        />
      ) : (
        <ul className="match-history">
          {records.map((record) => (
            <HistoryRow key={record.id} record={record} />
          ))}
        </ul>
      )}
    </PanelScreen>
  );
}

export function MatchStatsScreen() {
  const { kind, matchId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const cached = location.state?.historyRecord as HistoryRecord | undefined;
  const profile = useLocalProfile();
  const server = useOnline();
  const [entry, setEntry] = useState<OnlineHistoryEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (kind !== 'online' || server.status !== 'online' || !matchId) return;
    let active = true;
    setEntry(null);
    setFailed(false);
    rpc<OnlineHistoryEntry>('history_get', { matchId }).then(
      (value) => {
        if (active) setEntry(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [kind, matchId, server.status, attempt]);
  const local = profile.history.find((record) => record.id === matchId);
  const outcome = matchSession.getOutcome();
  const completed: HistoryRecord | null =
    outcome && outcome.state.matchId === matchId
      ? {
          id: outcome.state.matchId,
          endedAt: Date.now(),
          kind: kind === 'online' ? 'online' : 'practice',
          playerName: outcome.state.players[outcome.side === 'L' ? 0 : 1].displayName,
          opponentName: outcome.state.players[outcome.side === 'L' ? 1 : 0].displayName,
          opponentIsBot: outcome.state.players[outcome.side === 'L' ? 1 : 0].isBot,
          teamId: outcome.state.players[outcome.side === 'L' ? 0 : 1].teamId,
          opponentTeamId: outcome.state.players[outcome.side === 'L' ? 1 : 0].teamId,
          scoreFor: outcome.state.score[outcome.side],
          scoreAgainst: outcome.state.score[outcome.side === 'L' ? 'R' : 'L'],
          won: outcome.state.result?.winner === outcome.side,
          mode: outcome.state.mode,
          reason: outcome.state.result?.reason ?? 'goals',
          playerSide: outcome.side,
          statistics: outcome.statistics,
        }
      : null;
  const record =
    completed ??
    (kind === 'online'
      ? localOnlineEnabled && matchId?.startsWith('local-ranked-')
        ? (() => {
            const receipt = localRankedHistory().find((r) => r.record.id === matchId);
            return receipt ? { ...fromLocal(receipt.record), kind: 'online' as const, arena: receipt.arena } : null;
          })()
        : entry
          ? fromOnline(entry)
          : cached?.id === matchId && cached?.kind === kind
            ? cached
            : null
      : kind === 'practice' && local
        ? fromLocal(local)
        : null);
  const back = () =>
    rakhtkan
      ? navigate(completed ? '/result' : '/home')
      : navigate(`/profile/history?tab=${kind === 'online' ? 'online' : 'practice'}`);
  if (!record)
    return (
      <PanelScreen className="">
        <ScreenHeader title={t('stats.title')} onBack={back} />
        {kind === 'online' && server.status === 'online' && !failed ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <>
            <p role="status">{t(kind === 'online' ? 'stats.unavailable' : 'errors.notFound')}</p>
            {kind === 'online' && (
              <Button
                onClick={() => {
                  if (server.status !== 'online') void connect();
                  setAttempt((value) => value + 1);
                }}
              >
                {t('common.retry')}
              </Button>
            )}
          </>
        )}
      </PanelScreen>
    );
  const stats =
    record.statistics?.version === 1 && record.statistics.sides?.L && record.statistics.sides?.R
      ? record.statistics
      : undefined;
  const mine = stats?.sides[record.playerSide];
  const theirs = stats?.sides[record.playerSide === 'L' ? 'R' : 'L'];
  const total = (mine?.shots ?? 0) + (theirs?.shots ?? 0);
  const share = total ? Math.round(((mine?.shots ?? 0) / total) * 100) : 0;
  const percent = (value: number | undefined, shots: number | undefined) =>
    value !== undefined && shots ? `${formatNumber(Math.round((value / shots) * 100))}%` : '—';
  const number = (value: number | undefined) => (value === undefined ? '—' : formatNumber(value));
  const rows = [
    ['goals', formatNumber(record.scoreFor), formatNumber(record.scoreAgainst)],
    ['shots', number(mine?.shots), number(theirs?.shots)],
    ['scoringShots', number(mine?.scoringShots), number(theirs?.scoringShots)],
    ['conversion', percent(mine?.scoringShots, mine?.shots), percent(theirs?.scoringShots, theirs?.shots)],
    ['ownGoals', number(mine?.ownGoals), number(theirs?.ownGoals)],
    ['timeouts', number(mine?.timeouts), number(theirs?.timeouts)],
    [
      'averagePower',
      mine?.shots ? `${formatNumber(Math.round(mine.powerTotal / mine.shots))}%` : '—',
      theirs?.shots ? `${formatNumber(Math.round(theirs.powerTotal / theirs.shots))}%` : '—',
    ],
    [
      'movement',
      mine ? t('stats.seconds', { n: formatNumber(Math.round(mine.simulationTicks / 6) / 10) }) : '—',
      theirs ? t('stats.seconds', { n: formatNumber(Math.round(theirs.simulationTicks / 6) / 10) }) : '—',
    ],
  ];
  return (
    <PanelScreen className="match-stats-screen">
      <ScreenHeader title={t('stats.title')} onBack={back} />
      <Card className="match-detail-summary match-summary" style={{ viewTransitionName: summaryTransition(record) }}>
        <MatchSummary record={record} detail />
      </Card>
      {!stats && (
        <p className="stats-legacy" role="status">
          {t('stats.legacy')}
        </p>
      )}
      <Card className="match-statistics" style={{ viewTransitionName: 'match-comparison' }}>
        <h2>{t('stats.comparison')}</h2>
        <div className="shot-share">
          <span>{t('stats.shotShare')}</span>
          <div
            className={`shot-share__bar ${!total ? 'is-empty' : ''}`}
            dir="ltr"
            role="img"
            aria-label={!stats ? t('stats.legacy') : total ? `${share}% / ${100 - share}%` : t('stats.noShots')}
          >
            <span style={{ width: `${share}%` }} />
            {total > 0 && <span style={{ width: `${100 - share}%` }} />}
          </div>
          <div className="shot-share__values" dir="ltr">
            <strong>{total ? `${formatNumber(share)}%` : '—'}</strong>
            <strong>{total ? `${formatNumber(100 - share)}%` : '—'}</strong>
          </div>
        </div>
        <dl className="match-stat-rows">
          {rows.map(([key, left, right]) => (
            <div key={key} dir="ltr">
              <dd>{left}</dd>
              <dt>{t(`stats.${key}`)}</dt>
              <dd>{right}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </PanelScreen>
  );
}
