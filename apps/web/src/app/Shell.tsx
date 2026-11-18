import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useLocalProfile } from '../services/localProfile';
import { formatNumber } from '../i18n';
import { useLocalInventory } from '../services/localInventory';
import { useOnline } from '../services/online';
import { rakhtkan } from '../services/gameVariant';
import { Avatar, CurrencyPill } from '../ui/components';
import { IconHome, IconOffline, IconShop, IconLocker, IconTrophy, IconUser } from '../ui/icons';

function useNetwork(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Shell() {
  const { t } = useTranslation();
  const profile = useLocalProfile();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!rakhtkan && profile.pendingLevelUps.length && location.pathname !== '/level-up') navigate('/level-up');
  }, [profile.pendingLevelUps.length, location.pathname, navigate]);
  const online = useNetwork();
  const server = useOnline();
  const inventory = useLocalInventory();
  const wallet = server.status === 'online' ? server.profile?.wallet : inventory;
  const nav = [
    { to: '/home', label: t('nav.home'), icon: <IconHome /> },
    { to: '/shop', label: t('nav.shop'), icon: <IconShop /> },
    { to: '/leaderboard', label: t('nav.leaderboard'), icon: <IconTrophy /> },
    { to: '/locker', label: t('profile.locker'), icon: <IconLocker /> },
    { to: '/profile', label: t('nav.profile'), icon: <IconUser /> },
  ].filter((item) => !rakhtkan || item.to === '/home' || item.to === '/shop');

  const owner =
    location.pathname.startsWith('/rewards/levels') ||
    location.pathname === '/level-up' ||
    location.pathname === '/settings' ||
    location.pathname === '/tutorial'
      ? '/profile'
      : location.pathname;

  return (
    <div className={`shell ${location.pathname === '/home' ? 'shell--lobby' : ''}`}>
      <header className="topbar">
        <div className="topbar__right">
          <div className="topbar__wallet">
            <Link to={rakhtkan ? '/shop' : '/shop?tab=currency&group=coins'} aria-label={t('common.coins')}>
              <CurrencyPill currency="coins" amount={wallet ? (wallet.coins ?? 0) : null} />
            </Link>
            <Link to={rakhtkan ? '/shop' : '/shop?tab=currency&group=gems'} aria-label={t('common.gems')}>
              <CurrencyPill currency="gems" amount={wallet ? (wallet.gems ?? 0) : null} />
            </Link>
          </div>
          <Link to={rakhtkan ? '/welcome' : '/profile'} className="profile-chip" aria-label={t('nav.profile')}>
            <Avatar id={profile.avatarId} size={34} />
            <span className="profile-chip__copy">
              <span className="profile-chip__name">
                <bdi>{profile.displayName}</bdi>
              </span>
              <small>{t('common.levelLong', { level: formatNumber(profile.knownLevel) })}</small>
            </span>
          </Link>
        </div>
      </header>
      {!online && (
        <div className="offline-banner" role="status">
          <IconOffline size={18} /> {t('common.offline')}
        </div>
      )}
      <nav
        style={
          {
            '--nav-selected': Math.max(
              0,
              nav.findIndex((item) => owner.startsWith(item.to)),
            ),
          } as React.CSSProperties
        }
        className={`navbar ${rakhtkan ? 'navbar--rakhtkan' : ''}`}
        aria-label={t('nav.main')}
      >
        {nav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={owner.startsWith(item.to) ? 'page' : undefined}
            className={`navbar__item ${owner.startsWith(item.to) ? 'is-active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <main className="shell__main" key={location.pathname}>
        <Outlet />
      </main>
    </div>
  );
}
