import { ShieldAvatar } from '../ui/ShieldAvatar';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { assetUrl } from '../game/art';
import { carModelForTeam } from '@flickkick/config';
import { useLocalProfile } from '../services/localProfile';
import { formatNumber } from '../i18n';
import { Dialog } from '../ui/components';
import { IconGear, IconGift, IconShop, IconTrophy, IconGarage } from '../ui/icons';
import { ResourceMeters } from '../ui/ResourceMeters';
const HomeCar = lazy(() => import('../ui/HomeCar'));
/** Live controls over independent art layers; no text is baked into the scenery. */
export function HomeScreen() {
  const { t } = useTranslation();
  const profile = useLocalProfile();
  const [play, setPlay] = useState(false);
  const model = carModelForTeam(profile.teamId);
  const modes = [
    { to: '/play/ai', title: t('home.playAI'), desc: t('home.playAIDesc') },
    { to: '/play/local', title: t('home.local2p'), desc: t('home.local2pDesc') },
    { to: '/play/online', title: t('home.playOnline'), desc: t('home.playOnlineDesc') },
  ];
  return (
    <div className="screen home stadium-home">
      <div className="stadium-home__stage">
        <Link to="/profile" className="stadium-profile stadium-profile--nameplate" aria-label={t('nav.profile')}>
          <span className="stadium-profile__portrait">
            <ShieldAvatar id={profile.avatarId} />
            <span
              className="stadium-profile__level"
              role="img"
              aria-label={t('common.levelLong', { level: formatNumber(profile.knownLevel) })}
            >
              <b>{formatNumber(profile.knownLevel)}</b>
            </span>
          </span>
          <span className="stadium-profile__copy">
            <strong>
              <bdi>{profile.displayName}</bdi>
            </strong>
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
        <ResourceMeters />
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
