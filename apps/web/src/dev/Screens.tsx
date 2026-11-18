import { rakhtkan } from '../services/gameVariant';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MatchmakingStage } from '../screens/Matchmaking';
import { ResultScreen } from '../screens/Result';
import { LevelUpScreen } from '../screens/Rewards';
import { profileStore } from '../services/localProfile';
import { settingsStore } from '../services/settings';
import { streamScreenAssets } from '../services/assetLoading';
import { resultFixture, seedScreens } from './fixtures';
import './screens.css';

const pages: [string, string][] = [
  ['خانه', '/home'],
  ['خوش‌آمدگویی', '/welcome'],
  ['آموزش', '/tutorial'],
  ['انتخاب حریف هوش مصنوعی', '/play/ai'],
  ['بازی دونفره', '/play/local'],
  ['انتخاب زمین آنلاین', '/play/online'],
  ['جست‌وجوی حریف', '/dev/search'],
  ['حریف پیدا شد', '/dev/found'],
  ['زمین بازی', '/match'],
  ['برد', '/dev/result/win'],
  ['باخت', '/dev/result/loss'],
  ['برد با پاداش آنلاین', '/dev/result/online-win'],
  ['باخت با پاداش آنلاین', '/dev/result/online-loss'],
  ['پروفایل', '/profile'],
  ['تاریخچه', '/profile/history'],
  ['آمار مسابقه', '/profile/history/practice/dev-preview-match'],
  ['کمد', '/locker'],
  ['فروشگاه', '/shop'],
  ['سکه و الماس', '/wallet'],
  ['جدول رتبه‌بندی', '/leaderboard'],
  ['پاداش روزانه', '/rewards'],
  ['پاداش سطح‌ها', '/rewards/levels'],
  ['ارتقای سطح', '/dev/level-up'],
  ['تنظیمات', '/settings'],
  ['مدیریت (نیازمند سرور)', '/admin'],
  ['صفحه پیدا نشد', '/dev-not-found'],
];

function Gallery() {
  const { i18n } = useTranslation();
  return (
    <main className="dev-gallery" dir="rtl">
      <h1>پیش‌نمایش صفحه‌های Bumper Goal</h1>
      <p>
        داده‌های نمونهٔ مستقل از حساب اصلی؛ بدون اتصال به سرور. صفحه‌های آنلاین وضعیت محلی یا آفلاین را نمایش می‌دهند.
      </p>
      <div className="dev-controls">
        <label>
          زبان{' '}
          <select
            value={i18n.language}
            onChange={(event) => settingsStore.set({ language: event.target.value as 'fa' | 'en' | 'ar' })}
          >
            <option value="fa">فارسی</option>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </label>
        <button
          className="btn btn--secondary"
          onClick={() => {
            seedScreens();
            window.location.reload();
          }}
        >
          بازنشانی داده‌های نمونه
        </button>
      </div>
      <nav className="dev-grid">
        {pages
          .filter(
            ([, to]) =>
              !rakhtkan ||
              ![
                '/tutorial',
                '/play/ai',
                '/profile',
                '/profile/history',
                '/locker',
                '/wallet',
                '/leaderboard',
                '/rewards',
                '/rewards/levels',
                '/dev/level-up',
                '/settings',
                '/admin',
              ].includes(to),
          )
          .map(([label, to]) => (
            <Link key={to} to={to}>
              {label}
            </Link>
          ))}
      </nav>
    </main>
  );
}

function ResultPreview() {
  const { variant = 'loss' } = useParams();
  useEffect(() => streamScreenAssets('/result'), []);
  return <ResultScreen outcome={resultFixture(variant.endsWith('win'), variant.startsWith('online-'))} />;
}

function LevelPreview() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const before = profileStore.get().pendingLevelUps;
    profileStore.set({ pendingLevelUps: [8] });
    setReady(true);
    return () => profileStore.set({ pendingLevelUps: before });
  }, []);
  return ready ? <LevelUpScreen /> : null;
}

function SearchPreview({ found = false }: { found?: boolean }) {
  return (
    <main className="panel-screen matchmaking">
      <MatchmakingStage
        player={{ name: 'Crafted', avatarId: profileStore.get().avatarId, level: 8 }}
        arenaId="park"
        entryFee={100}
        prize={200}
        searching={!found}
        preview={
          found
            ? {
                opponent: { name: 'FlickBot', avatarId: 'bot', level: 8, isBot: true },
                arena: 'park',
                entryFee: 100,
                prize: 200,
                started: false,
              }
            : undefined
        }
      />
    </main>
  );
}

export default function Screens() {
  return (
    <Routes>
      <Route index element={<Gallery />} />
      <Route path="result/:variant" element={<ResultPreview />} />
      {!rakhtkan && <Route path="level-up" element={<LevelPreview />} />}
      <Route path="search" element={<SearchPreview />} />
      <Route path="found" element={<SearchPreview found />} />
      <Route path="*" element={<Gallery />} />
    </Routes>
  );
}
