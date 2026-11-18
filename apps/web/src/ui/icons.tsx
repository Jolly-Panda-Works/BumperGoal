// Shared game art for navigation/category icons; utility controls retain simple strokes.
import type { SVGProps } from 'react';
import { RetryImage } from './RetryImage';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function gameArt(name: string) {
  return function GameArtIcon({ size = 22, className = '', style }: IconProps) {
    return (
      <span className={`game-art-icon ${className}`} style={{ width: size, height: size, ...style }} aria-hidden="true">
        <RetryImage src={`/assets/icons/${name}.webp`} alt="" draggable={false} decoding="async" />
      </span>
    );
  };
}

function make(paths: React.ReactNode, filled = false) {
  return function Icon({ size = 22, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconHome = gameArt('home');

export const IconShop = gameArt('shop');

/** Garage navigation uses a car bay rather than the old inventory book. */
export function IconGarage({ size = 64 }: { size?: number }) {
  return (
    <svg className="garage-icon" width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <path d="M6 28 40 8l34 20v44H6Z" fill="#b4d9f7" stroke="#123a69" strokeWidth="4" strokeLinejoin="round" />
      <path d="m5 29 35-21 35 21" fill="none" stroke="#f0fcff" strokeWidth="5" strokeLinejoin="round" />
      <path d="M17 32h46v37H17Z" fill="#154a88" stroke="#ecfaff" strokeWidth="3" />
      <path d="M20 36h40M20 42h40" stroke="#5cb8f3" strokeWidth="3" />
      <rect x="31" y="18" width="18" height="8" rx="2" fill="#ffbd1a" stroke="#8e4800" strokeWidth="2" />
      <path
        d="m22 53 5-12h26l5 12 5 5v12H17V58Z"
        fill="#ff3838"
        stroke="#7a142c"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="m28 44-3 10h30l-3-10Z" fill="#73edff" stroke="#efffff" strokeWidth="2" />
      <rect x="21" y="59" width="9" height="5" rx="2" fill="#fff5aa" />
      <rect x="50" y="59" width="9" height="5" rx="2" fill="#fff5aa" />
      <path d="M31 64h18M19 69h42" stroke="#d9efff" strokeWidth="4" />
      <path d="M20 71v5h9v-5M51 71v5h9v-5" fill="#133451" />
    </svg>
  );
}

export const IconShirt = gameArt('teams');

export const IconTrophy = gameArt('rank');

export const IconUser = gameArt('avatars');

export const IconGear = gameArt('settings');

export const IconBack = make(<path d="M15 5 8 12l7 7" />);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconPlay = make(<path d="M8 5v14l11-7z" />, true);
export const IconPause = make(<path d="M8 5h3v14H8zM13 5h3v14h-3z" />, true);
export const IconCheck = make(<path d="m5 12 5 5 9-10" />);
export const IconLock = make(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);
export const IconRobot = make(
  <>
    <rect x="5" y="8" width="14" height="11" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9 16h6" />
  </>,
);
export const IconUsers = make(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <circle cx="17" cy="9" r="2.8" />
    <path d="M16 14.2a5 5 0 0 1 5.5 5" />
  </>,
);
export const IconGlobe = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </>,
);
export const IconHistory = gameArt('history');

export const IconGift = gameArt('level-reward');

export const IconWallet = make(
  <>
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M16 13h2M3 10h18" />
  </>,
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5h.01" />
  </>,
);
export const IconOffline = make(
  <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" />,
);
export const IconSchool = gameArt('tutorial');

export const IconMic = make(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const IconMicOff = make(
  <>
    <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
    <path d="M5 11a7 7 0 0 0 11.5 5.4M19 11c0 .8-.1 1.5-.4 2.2M12 18v3M4 4l16 16" />
  </>,
);
export const IconSpeakerOff = make(<path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" />);
export const IconSpeakerOn = make(<path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />);
export const IconBolt = make(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />, true);

export function IconCoin({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="#FFC83D" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="#B7791F" strokeWidth="1.6" />
      <path d="M10 8.5h4M10 15.5h4M12 7v10" stroke="#8A5A00" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconGem({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3h12l4 6-10 12L2 9z" fill="#4CC9F0" />
      <path d="M2 9h20M8 3l4 18 4-18M6 3 8 9M18 3l-2 6" stroke="#1B6F8F" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export const IconBall = gameArt('balls');

export const IconFormation = gameArt('formations');

export const IconTrail = gameArt('trails');

export const IconLocker = gameArt('locker');
export const IconPacks = gameArt('packs');
