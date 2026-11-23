import { LeagueScreen } from '../screens/League';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Link, Navigate, Route, useLocation } from 'react-router';
import { loadPhysics } from '../services/sim';
import { useSettings } from '../services/settings';
import { profileStore, useLocalProfile } from '../services/localProfile';
import {
  loadBaseAssets,
  pauseBackgroundAssets,
  startBackgroundAssets,
  streamScreenAssets,
} from '../services/assetLoading';
import { audio } from '../services/audio';
import { restoreLocalRankedProgress } from '../services/localRanked';
import { connect } from '../services/online';
import { useConfigRevision } from '../services/remoteConfig';
import { useAssetsVersion } from '../services/assets';
import { ErrorState, Logo, Spinner } from '../ui/components';
import { enableImmersiveMode } from '../services/device';
import { Shell } from './Shell';
import { rakhtkan } from '../services/gameVariant';
import { RakhtkanHome } from '../screens/RakhtkanHome';
import { FriendsScreen } from '../screens/Friends';
import { AnimatedRoutes } from '../ui/AnimatedRoutes';
import { WelcomeScreen } from '../screens/Welcome';
import { MatchStatsScreen } from '../screens/History';
import { HomeScreen } from '../screens/Home';
import { PlayAIScreen } from '../screens/PlayAI';
import { OnlineScreen } from '../screens/Online';
import { MatchmakingScreen } from '../screens/Matchmaking';
import { MatchScreen } from '../screens/Match';
import { TutorialScreen } from '../screens/Tutorial';
import { ResultScreen } from '../screens/Result';
import { HistoryScreen, LockerScreen, ProfileScreen } from '../screens/Profile';
import { ShopScreen } from '../screens/Shop';
import { RewardsScreen, LevelRewardsScreen, LevelUpScreen } from '../screens/Rewards';
import { LeaderboardScreen } from '../screens/Leaderboard';
import { SettingsScreen } from '../screens/Settings';
import { NotFoundScreen } from '../screens/NotFound';

import { screenPreview } from '../dev/mode';
const Screens = import.meta.env.DEV && import.meta.env.MODE === 'screens' ? lazy(() => import('../dev/Screens')) : null;

const AdminScreen = lazy(() => import('../screens/Admin').then((m) => ({ default: m.AdminScreen })));

const fullOnly = (screen: React.ReactNode) => (rakhtkan ? <Navigate to="/home" replace /> : screen);

type BootState = 'loading' | 'ready' | 'error';

/** F-01: preloads the physics module and the base art before any screen opens. */
function useBoot(): [BootState, number, () => void] {
  const [state, setState] = useState<BootState>('loading');
  const [progress, setProgress] = useState(0);
  const load = useCallback(() => {
    setState('loading');
    Promise.all([loadPhysics(), loadBaseAssets(profileStore.get().welcomed, setProgress)]).then(
      () => setState('ready'),
      () => setState('error'),
    );
  }, []);
  useEffect(load, [load]);
  return [state, progress, load];
}

function FirstRunGate({ children }: { children: React.ReactNode }) {
  const profile = useLocalProfile();
  if (!profile.welcomed) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function OrientationNotice() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  if (pathname.startsWith('/admin')) return null;
  return (
    <div className="orientation-screen" role="status">
      <Logo big />
      <h1>{t('orientation.title')}</h1>
      <p>{t('orientation.hint')}</p>
    </div>
  );
}

export function App() {
  const { t } = useTranslation();
  const settings = useSettings();
  useConfigRevision(); // screens read the balance objects directly; re-render when the server changes them
  useAssetsVersion(); // and when uploaded art finishes loading
  useEffect(() => enableImmersiveMode(), []);
  useEffect(() => restoreLocalRankedProgress(), []);
  const [boot, progress, retry] = useBoot();

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', settings.highContrast);
    document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
  }, [settings.highContrast, settings.reducedMotion]);

  // Guests connect automatically once they have been welcomed; local play never waits for this.
  const welcomed = useLocalProfile().welcomed;
  useEffect(() => {
    if (boot === 'ready' && welcomed) void connect();
  }, [boot, welcomed]);

  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (boot !== 'ready') {
    return (
      <div className="boot">
        <div aria-label={t('app.name')}>
          <Logo big />
        </div>
        {boot === 'loading' ? (
          <>
            <Spinner label={t('boot.loading')} />
            <progress className="boot__progress" value={progress} max={1} aria-hidden="true" />
          </>
        ) : (
          <ErrorState title={t('boot.failed')} onRetry={retry} />
        )}
      </div>
    );
  }

  return (
    <BrowserRouter>
      <OrientationNotice />
      <MusicDirector />
      <AssetDirector />
      {screenPreview && (
        <Link className="dev-return" to="/dev">
          صفحه‌ها
        </Link>
      )}
      <AnimatedRoutes>
        {Screens && (
          <Route
            path="/dev/*"
            element={
              <Suspense fallback={<Spinner />}>
                <Screens />
              </Suspense>
            }
          />
        )}
        <Route path="/admin" element={<Suspense fallback={<Spinner />}>{fullOnly(<AdminScreen />)}</Suspense>} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/tutorial" element={fullOnly(<TutorialScreen />)} />
        <Route path="/match" element={<MatchScreen />} />
        <Route
          path="/result"
          element={
            <FirstRunGate>
              <ResultScreen />
            </FirstRunGate>
          }
        />
        <Route
          element={
            <FirstRunGate>
              <Shell />
            </FirstRunGate>
          }
        >
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={rakhtkan ? <RakhtkanHome /> : <HomeScreen />} />
          <Route path="/play/ai" element={fullOnly(<PlayAIScreen />)} />
          <Route path="/play/local" element={<FriendsScreen />} />
          <Route path="/play/online" element={<OnlineScreen />} />
          <Route path="/play/online/search" element={<MatchmakingScreen />} />
          <Route path="/profile" element={fullOnly(<ProfileScreen />)} />
          <Route path="/profile/history/:kind/:matchId" element={<MatchStatsScreen />} />
          <Route path="/profile/history" element={fullOnly(<HistoryScreen />)} />
          <Route path="/locker" element={rakhtkan ? <Navigate to="/shop" replace /> : <LockerScreen />} />
          <Route path="/league" element={<LeagueScreen />} />
          <Route path="/inventory" element={<Navigate to="/locker" replace />} />
          <Route path="/leaderboard" element={fullOnly(<LeaderboardScreen />)} />
          <Route path="/shop" element={<ShopScreen />} />
          <Route path="/level-up" element={fullOnly(<LevelUpScreen />)} />
          <Route path="/rewards/levels" element={fullOnly(<LevelRewardsScreen />)} />
          <Route path="/rewards" element={fullOnly(<RewardsScreen />)} />
          <Route
            path="/wallet"
            element={<Navigate to={rakhtkan ? '/shop' : '/shop?tab=currency&group=coins'} replace />}
          />
          <Route path="/settings" element={fullOnly(<SettingsScreen />)} />
          <Route path="*" element={<NotFoundScreen />} />
        </Route>
      </AnimatedRoutes>
    </BrowserRouter>
  );
}

/**
 * Streams the art of the current screen, then the rest in the background
 * (held back during play, so downloads never compete with a match).
 */
function AssetDirector() {
  const { pathname } = useLocation();
  useEffect(() => startBackgroundAssets(), []);
  useEffect(() => {
    streamScreenAssets(pathname);
    pauseBackgroundAssets(pathname === '/match' || pathname === '/tutorial');
  }, [pathname]);
  return null;
}

/**
 * Picks the looping music for the current screen.
 */
function MusicDirector() {
  const { pathname } = useLocation();
  useEffect(() => {
    // The match scene starts its own music after the walk-on intro.
    if (pathname === '/match' || pathname === '/tutorial') audio.playMusic(null);
    // After the win/lose jingle.
    else if (pathname === '/result') audio.playMusic('highlights', 0.8, 2.2);
    else if (pathname.startsWith('/play/online') || pathname === '/leaderboard') audio.playMusic('league');
    else audio.playMusic('menu');
  }, [pathname]);
  return null;
}
