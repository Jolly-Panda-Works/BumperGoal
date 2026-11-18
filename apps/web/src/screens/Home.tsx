import { ShieldAvatar } from '../ui/ShieldAvatar';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { assetUrl } from '../game/art';
import { carModelForTeam } from '@flickkick/config';
import { useLocalProfile } from '../services/localProfile';
import { formatNumber } from '../i18n';
import { Dialog } from '../ui/components';
import { useLocalInventory } from '../services/localInventory';
import { ResourceMeters } from '../ui/ResourceMeters';
const HomeCar = lazy(() => import('../ui/HomeCar'));
/** Live controls over independent art layers; no text is baked into the scenery. */
export function HomeScreen() {
  const { t } = useTranslation();
  const profile = useLocalProfile();
  const [play, setPlay] = useState(false);
  const inventory = useLocalInventory();
  const dailyReady = inventory.lastDaily !== new Date().toDateString();
  const model = carModelForTeam(profile.teamId);
  const modes = [
    { to: '/play/ai', title: t('home.playAI'), desc: t('home.playAIDesc') },
    { to: '/play/local', title: t('home.local2p'), desc: t('home.local2pDesc') },
    { to: '/play/online', title: t('home.playOnline'), desc: t('home.playOnlineDesc') },
  ];
  return (
    <div className="screen home stadium-home toy-menu">
      <div className="toy-menu__stage">
        <header className="toy-menu__header">
          <Link to="/profile" className="toy-profile" aria-label={t('nav.profile')}>
            <ShieldAvatar id={profile.avatarId} />
            <span className="toy-profile__name">
              <bdi>{profile.displayName}</bdi>
            </span>
            <span
              className="toy-profile__level"
              aria-label={t('common.levelLong', { level: formatNumber(profile.knownLevel) })}
            >
              {formatNumber(profile.knownLevel)}
            </span>
          </Link>
          <Link className="toy-control toy-settings" to="/settings" aria-label={t('nav.settings')}>
            <img src={assetUrl('icons/settings.webp')} alt="" />
          </Link>
        </header>
        <ResourceMeters illustrated />
        <aside className="toy-menu__left">
          <Link className="toy-shortcut" to="/league" aria-label={t('nav.league')}>
            <span className="toy-control toy-shortcut__face">
              <span className="toy-art toy-art--trophy" />
            </span>
          </Link>
          <Link className="toy-shortcut" to="/rewards" aria-label={t('rewards.daily')}>
            <span className="toy-control toy-shortcut__face">
              <img src={assetUrl('icons/level-reward.webp')} alt="" />
            </span>
            {dailyReady && (
              <span className="toy-badge" aria-label={t('rewards.claim')}>
                !
              </span>
            )}
          </Link>
        </aside>
        <div className="toy-menu__hero" aria-hidden="true">
          <div className="toy-menu__car">
            <img className="stadium-hero__fallback" src={assetUrl(`cars/${model}-preview.png`)} alt="" />
            <Suspense fallback={null}>
              <HomeCar model={model} />
            </Suspense>
          </div>
          <div className="toy-menu__ball">
            <Suspense fallback={<span className="stadium-ball-fallback" />}>
              <HomeCar model={`ball:${profile.ballId}`} />
            </Suspense>
          </div>
        </div>
        <nav className="toy-menu__bottom" aria-label={t('nav.main')}>
          <Link className="toy-control toy-bottom-button toy-shop" to="/shop" aria-label={t('nav.shop')}>
            <img src={assetUrl('icons/shop.webp')} alt="" />
          </Link>
          <Link className="toy-control toy-bottom-button toy-garage" to="/locker" aria-label={t('nav.inventory')}>
            <span className="toy-art toy-art--car" />
          </Link>
          <button
            className="toy-control toy-play"
            aria-label={t('home.startMatch')}
            type="button"
            onClick={() => setPlay(true)}
          >
            <span aria-hidden="true">▶</span>
          </button>
        </nav>
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
