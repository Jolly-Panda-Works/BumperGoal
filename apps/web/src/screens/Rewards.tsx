import { PanelScreen } from '../ui/components';
import { useEffect, useState } from 'react';
import { useLocalProfile, acknowledgeLevelUp } from '../services/localProfile';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { economyConfig, progressionConfig } from '@flickkick/config';
import { levelUpRewards } from '@flickkick/rules';
import { formatNumber } from '../i18n';
import { uiUrl } from '../game/art';
import { ArtImage, Button, Card, Badge, PriceTag, ScreenHeader } from '../ui/components';
import { IconCheck } from '../ui/icons';
import { claimLocalDaily, dailyClaimedCount, useLocalInventory } from '../services/localInventory';
import { claimDaily, getOnline } from '../services/online';
import { toast } from '../ui/toast';

/** F-15: rewards. Online the server credits the daily grant; offline it is a local practice grant. */
export function RewardsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inventory = useLocalInventory();
  const [claiming, setClaiming] = useState(false);
  const claimed = dailyClaimedCount();
  const claimedToday = inventory.lastDaily === new Date().toDateString();
  const claim = async () => {
    if (getOnline().status !== 'online') {
      claimLocalDaily();
      return;
    }
    setClaiming(true);
    try {
      await claimDaily();
    } catch {
      toast(t('rewards.claimFailed'), 'error');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <PanelScreen className="">
      <ScreenHeader title={t('rewards.daily')} onBack={() => navigate('/home')} />
      <div className="daily-track">
        {economyConfig.dailyRewards.map((reward, i) => (
          <Card
            key={i}
            className={`daily-track__day ${i < claimed ? 'is-claimed' : i === claimed && !claimedToday ? 'is-current' : ''}`}
          >
            <span className="muted">{t('rewards.day', { n: formatNumber(i + 1) })}</span>
            <ArtImage className="daily-track__art" src={uiUrl(rewardArt(reward))} size={64} />
            <PriceTag price={reward} />
            {i < claimed && (
              <Badge tone="success">
                <IconCheck size={14} /> {t('rewards.received')}
              </Badge>
            )}
          </Card>
        ))}
      </div>
      <Button disabled={claimedToday || claiming} onClick={() => void claim()}>
        {t(claimedToday ? 'rewards.received' : 'rewards.claim')}
      </Button>
    </PanelScreen>
  );
}

/** Reward tile art grows with the coin amount; gem rewards use the gem art. */
function rewardArt(reward: { coins?: number; gems?: number }): string {
  if (reward.gems) return 'reward_gems';
  const coins = reward.coins ?? 0;
  return coins >= 200 ? 'reward_coins-large' : coins >= 100 ? 'reward_coins-medium' : 'reward_coins-small';
}

/** Server match settlement already credits level rewards atomically. Claim acknowledges
 * that receipt; it must never credit the same reward a second time in the client. */
export function LevelRewardsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useLocalProfile();
  return (
    <PanelScreen className="">
      <ScreenHeader title={t('rewards.levelRewards')} onBack={() => navigate('/profile')} />
      <ul className="level-rewards">
        {Array.from({ length: progressionConfig.maxLevel - 1 }, (_, i) => i + 2).map((level) => {
          const reward = levelUpRewards(level - 1, level, progressionConfig);
          return (
            <li
              key={level}
              className={level <= profile.knownLevel && !profile.pendingLevelUps.includes(level) ? 'is-received' : ''}
            >
              <span>{t('rewards.levelReward', { level: formatNumber(level) })}</span>
              <PriceTag price={reward} />
              {profile.pendingLevelUps.includes(level) ? (
                <Button size="sm" onClick={() => navigate('/level-up')}>
                  {t('rewards.claim')}
                </Button>
              ) : (
                <small>
                  {t(level <= profile.knownLevel ? 'rewards.received' : 'rewards.locked', {
                    level: formatNumber(level),
                  })}
                </small>
              )}
            </li>
          );
        })}
      </ul>
    </PanelScreen>
  );
}

export function LevelUpScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useLocalProfile();
  const level = profile.pendingLevelUps[0];
  useEffect(() => {
    if (!level) navigate('/rewards/levels', { replace: true });
  }, [level, navigate]);
  if (!level) return null;
  const reward = levelUpRewards(level - 1, level, progressionConfig);
  return (
    <PanelScreen className="level-up-screen" key={level}>
      <h1>{t('rewards.levelUp')}</h1>
      <div className="level-up-emblem">
        <ArtImage src={uiUrl('levelup')} size={180} />
        <strong className="level-up-number">{formatNumber(level)}</strong>
      </div>
      <h2>{t('rewards.levelReward', { level: formatNumber(level) })}</h2>
      <PriceTag price={reward} />
      <Button
        onClick={() => {
          acknowledgeLevelUp(level);
          if (profile.pendingLevelUps.length === 1) navigate('/rewards/levels', { replace: true });
        }}
      >
        {t('rewards.claim')}
      </Button>
    </PanelScreen>
  );
}
