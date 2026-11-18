import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { assetUrl } from '../game/art';
import { carModelForTeam, progressionConfig } from '@flickkick/config';
import { levelProgress } from '@flickkick/rules';
import { useLocalProfile } from '../services/localProfile';
import { useLocalInventory } from '../services/localInventory';
import { useOnline } from '../services/online';
import { formatNumber } from '../i18n';
import { Avatar, CurrencyIcon, Dialog } from '../ui/components';
import { IconGear, IconGift, IconShop, IconTrophy, IconGarage } from '../ui/icons';
import { LevelStar } from '../ui/LevelStar';
const HomeCar = lazy(() => import('../ui/HomeCar'));
/** Live controls over independent art layers; no text is baked into the scenery. */
export function HomeScreen() {
  const { t } = useTranslation();
  const profile = useLocalProfile();
  const inventory = useLocalInventory();
  const server = useOnline();
  const wallet = server.status === 'online' ? server.profile?.wallet : inventory;
  const [play, setPlay] = useState(false);
  const model = carModelForTeam(profile.teamId);
  const xp = levelProgress(server.profile?.xp ?? profile.knownXP, progressionConfig);
  const modes = [
    { to: '/play/ai', title: t('home.playAI'), desc: t('home.playAIDesc') },
    { to: '/play/local', title: t('home.local2p'), desc: t('home.local2pDesc') },
    { to: '/play/online', title: t('home.playOnline'), desc: t('home.playOnlineDesc') },
  ];
  return (
    <div className="screen home stadium-home">
      <div className="stadium-home__stage">
        <Link to="/profile" className="stadium-profile" aria-label={t('nav.profile')}>
          <span className="stadium-profile__portrait">
            <Avatar id={profile.avatarId} size={100} />
          </span>
          <span className="stadium-profile__copy">
            <strong>
              <bdi>{profile.displayName}</bdi>
            </strong>
            <span
              className="stadium-profile__xp"
              role="progressbar"
              aria-label={t('profile.xp', { current: formatNumber(xp.current), needed: formatNumber(xp.needed) })}
              aria-valuemin={0}
              aria-valuemax={xp.needed || 1}
              aria-valuenow={xp.current}
            >
              <i style={{ width: `${Math.min(100, (xp.current / (xp.needed || 1)) * 100)}%` }} />
            </span>
          </span>
          <span
            className="stadium-profile__level"
            role="img"
            aria-label={t('common.levelLong', { level: formatNumber(profile.knownLevel) })}
          >
            <LevelStar value={formatNumber(profile.knownLevel)} />
          </span>
        </Link>
        <Link
          className="stadium-settings cartoon-button cartoon-button--blue"
          to="/settings"
          aria-label={t('nav.settings')}
        >
          <IconGear size={44} />
        </Link>
        <div className="stadium-brand">
          <img src={assetUrl('home/wordmark.webp')} alt="Bumper Goal" width={1776} height={880} />
        </div>
        <div className="stadium-wallet">
          <Link to="/shop?tab=currency&group=coins" aria-label={t('common.coins')}>
            <CurrencyIcon currency="coins" size={80} />
            <span className="stadium-wallet__amount">
              <bdi>{formatNumber(wallet?.coins ?? 0)}</bdi>
            </span>
            <b className="stadium-wallet__plus" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />
              </svg>
            </b>
          </Link>
          <Link to="/shop?tab=currency&group=gems" aria-label={t('common.gems')}>
            <CurrencyIcon currency="gems" size={80} />
            <span className="stadium-wallet__amount">
              <bdi>{formatNumber(wallet?.gems ?? 0)}</bdi>
            </span>
            <b className="stadium-wallet__plus" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />
              </svg>
            </b>
          </Link>
        </div>
        <div className="stadium-shortcuts">
          <Link className="cartoon-button cartoon-button--purple cartoon-button--labeled" to="/league">
            <IconTrophy size={64} />
            <span>{t('nav.league')}</span>
          </Link>
          <Link className="cartoon-button cartoon-button--blue cartoon-button--labeled" to="/rewards">
            <IconGift size={64} />
            <span>{t('rewards.daily')}</span>
          </Link>
        </div>
        <div className="stadium-hero">
          <div className="stadium-hero__car">
            <img className="stadium-hero__fallback" src={assetUrl(`cars/${model}-preview.png`)} alt="" />
            <Suspense fallback={null}>
              <HomeCar model={model} />
            </Suspense>
          </div>
          <div className="stadium-hero__ball">
            <span className="stadium-ball-fallback" />
            <Suspense fallback={null}>
              <HomeCar model={`ball:${profile.ballId}`} />
            </Suspense>
          </div>
        </div>
        <Link className="stadium-shop cartoon-button cartoon-button--orange cartoon-button--labeled" to="/shop">
          <IconShop size={64} />
          <span>{t('nav.shop')}</span>
        </Link>
        <div className="stadium-actions">
          <Link className="cartoon-button cartoon-button--blue stadium-garage cartoon-button--labeled" to="/locker">
            <IconGarage size={64} />
            <span>{t('nav.inventory')}</span>
          </Link>
          <button
            className="cartoon-button cartoon-button--gold stadium-play"
            type="button"
            onClick={() => setPlay(true)}
          >
            {t('home.startMatch')}
          </button>
        </div>
      </div>
      <Dialog open={play} title={t('home.chooseMode')} onClose={() => setPlay(false)}>
        <div className="stadium-modes">
          {modes.map((mode) => (
            <Link key={mode.to} className="cartoon-button cartoon-button--blue" to={mode.to}>
              <strong>{mode.title}</strong>
              <small>{mode.desc}</small>
            </Link>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
