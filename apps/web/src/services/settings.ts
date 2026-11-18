// Client-owned preferences (ARCHITECTURE §7). Mirrored to Nakama storage once
// online services are connected (M6); localStorage is the source on this device.
import { useSyncExternalStore } from 'react';
import { Store } from './storage';

import { detectLanguage, isLanguage, type Language } from '../i18n/languages';
export type { Language } from '../i18n/languages';
export type GraphicsQuality = 'low' | 'high';

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  muted: boolean;
  language: Language;
  graphics: GraphicsQuality;
  /** Multiplies drag length → power. 1 = default. */
  aimSensitivity: number;
  aimGuide: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  vibration: boolean;
  inGameToasts: boolean;
  voiceChat: boolean;
  analyticsOptIn: boolean;
}

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const browserLanguage = (): Language => {
  try {
    return detectLanguage(navigator.language);
  } catch {
    return 'en';
  }
};

export const defaultSettings = (): Settings => ({
  musicVolume: 0.5,
  sfxVolume: 0.8,
  muted: false,
  language: browserLanguage(),
  graphics: 'high',
  aimSensitivity: 1,
  aimGuide: true,
  reducedMotion: prefersReducedMotion(),
  highContrast: false,
  vibration: true,
  inGameToasts: true,
  voiceChat: true,
  analyticsOptIn: false,
});

const clamp01 = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export function sanitizeSettings(raw: Partial<Settings>): Settings {
  const d = defaultSettings();
  return {
    musicVolume: clamp01(raw.musicVolume, d.musicVolume),
    sfxVolume: clamp01(raw.sfxVolume, d.sfxVolume),
    muted: typeof raw.muted === 'boolean' ? raw.muted : d.muted,
    language: isLanguage(raw.language) ? (raw.language as Language) : d.language,
    graphics: raw.graphics === 'low' || raw.graphics === 'high' ? raw.graphics : d.graphics,
    aimSensitivity:
      typeof raw.aimSensitivity === 'number' && Number.isFinite(raw.aimSensitivity)
        ? Math.min(2, Math.max(0.5, raw.aimSensitivity))
        : d.aimSensitivity,
    aimGuide: typeof raw.aimGuide === 'boolean' ? raw.aimGuide : d.aimGuide,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : d.reducedMotion,
    highContrast: typeof raw.highContrast === 'boolean' ? raw.highContrast : d.highContrast,
    vibration: typeof raw.vibration === 'boolean' ? raw.vibration : d.vibration,
    inGameToasts: typeof raw.inGameToasts === 'boolean' ? raw.inGameToasts : d.inGameToasts,
    voiceChat: typeof raw.voiceChat === 'boolean' ? raw.voiceChat : d.voiceChat,
    analyticsOptIn: typeof raw.analyticsOptIn === 'boolean' ? raw.analyticsOptIn : d.analyticsOptIn,
  };
}

export const settingsStore = new Store<Settings>('flickkick.settings.v1', defaultSettings(), sanitizeSettings);

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}
