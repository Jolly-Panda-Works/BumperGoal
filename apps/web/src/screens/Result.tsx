import { Notice } from '../ui/toast';
import { rakhtkan } from '../services/gameVariant';
import { ResultRibbon } from '../ui/ResultRibbon';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { formatNumber } from '../i18n';
import { audio } from '../services/audio';
import { matchSession, type MatchOutcome } from '../services/matchSession';
import { useLocalProfile } from '../services/localProfile';
import { uiUrl } from '../game/art';
import { ArtImage, Avatar, Button, Card, PriceTag } from '../ui/components';
import type { OnlineRewards } from '../game/OnlineMatchController';

/** Full-screen result with all actions visible on portrait phones. */
export function ResultScreen({ outcome: suppliedOutcome }: { outcome?: MatchOutcome } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outcome = suppliedOutcome ?? matchSession.getOutcome();
  const avatarId = useLocalProfile().avatarId;
  const won = outcome ? outcome.state.result?.winner === outcome.side : false;
  const pvp = outcome?.setup.mode === 'local_pvp';

  useEffect(() => {
    if (outcome && !pvp) audio.play(won ? 'win' : 'lose');
  }, [outcome, pvp, won]);

  if (!outcome || !outcome.state.result) return <Navigate to="/home" replace />;
  const { state, setup } = outcome;
  const result = state.result!;
  const [left, right] = state.players;

  return (
    <main className="result result-screen">
      <ResultRibbon victory={won} tone={won ? 'is-win' : 'is-loss'} text={t(won ? 'result.win' : 'result.lose')} />
      <section className="result__details" aria-label={t('stats.view')}>
        <Card className="result__board" dir="ltr">
          <div className={`result__player ${result.winner === 'L' ? 'is-winner' : ''}`}>
            <Avatar id={left.isBot ? 'bot' : outcome.side === 'L' ? avatarId : 'avatar_owl'} size={64} />
            <bdi>{left.displayName}</bdi>
          </div>
          <div className="result__score">
            {formatNumber(state.score.L)} <span>:</span> {formatNumber(state.score.R)}
          </div>
          <div className={`result__player ${result.winner === 'R' ? 'is-winner' : ''}`}>
            <Avatar
              id={
                right.isBot ? (outcome.setup.opponentAvatarId ?? 'bot') : outcome.side === 'R' ? avatarId : 'avatar_owl'
              }
              size={64}
            />
            <bdi>{right.displayName}</bdi>
          </div>
          {result.reason.startsWith('forfeit') && (
            <small className="result__ending-note">{t(`result.reasons.${result.reason}${!won ? '_self' : ''}`)}</small>
          )}
        </Card>
        {!setup.friendMatch &&
          (setup.mode === 'online' ? (
            <OnlineRewardsCard rewards={outcome.rewards ?? null} />
          ) : (
            <div className="result__local-rewards" aria-label={t('result.rewards')}>
              <PriceTag price={{ coins: outcome.rewards?.coins ?? 0 }} />
              <PriceTag price={{ gems: outcome.rewards?.gems ?? 0 }} />
              <span>
                {t('result.xp')}: {formatNumber(outcome.rewards?.xp ?? 0)}
              </span>
            </div>
          ))}
        <Link
          className="btn btn--secondary btn--md result__stats-link"
          to={`/profile/history/${setup.mode === 'online' ? 'online' : 'practice'}/${encodeURIComponent(state.matchId)}`}
        >
          {t('stats.view')}
        </Link>
      </section>
      <div className="button-row">
        <Button variant="secondary" onClick={() => navigate('/home')}>
          {t('result.home')}
        </Button>
        <Button
          onClick={() => {
            if (setup.friendMatch) {
              navigate('/play/local');
              return;
            }
            if (setup.mode === 'online') {
              navigate(`/play/online/search?arena=${setup.arena ?? 'park'}`);
              return;
            }
            if (rakhtkan && setup.mode === 'local_ai') {
              navigate('/play/online');
              return;
            }
            matchSession.setSetup(setup);
            navigate('/match');
          }}
        >
          {t('result.playAgain')}
        </Button>
      </div>
    </main>
  );
}

function OnlineRewardsCard({ rewards }: { rewards: OnlineRewards | null }) {
  const { t } = useTranslation();
  if (!rewards) return <Notice text={t('result.rewardsPending')} />;
  return (
    <Card className="rewards-card">
      <h2>{t('result.rewards')}</h2>
      <dl className="stat-grid">
        <div>
          <dt>{t('result.xp')}</dt>
          <dd>+{formatNumber(rewards.xp)}</dd>
        </div>
        <div>
          <dt>{t('online.prize')}</dt>
          <dd>
            <PriceTag price={{ coins: rewards.prize }} />
          </dd>
        </div>
        <div>
          <dt>{t('online.entryFee')}</dt>
          <dd>
            <PriceTag price={{ coins: -rewards.entryFee }} />
          </dd>
        </div>
      </dl>
      {rewards.levelAfter > rewards.levelBefore && (
        <p className="level-up">
          <span className="level-up__badge" aria-hidden="true">
            <ArtImage src={uiUrl('levelup')} />
            <span>{formatNumber(rewards.levelAfter)}</span>
          </span>
          {t('result.levelUp', { level: formatNumber(rewards.levelAfter) })}{' '}
          {rewards.coins - rewards.prize > 0 && <PriceTag price={{ coins: rewards.coins - rewards.prize }} />}{' '}
          {rewards.gems > 0 && <PriceTag price={{ gems: rewards.gems }} />}
        </p>
      )}
    </Card>
  );
}
