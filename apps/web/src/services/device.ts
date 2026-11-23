import { screenPreview } from '../dev/mode';
// Phone integration: fullscreen and landscape lock for matches. Both are best
// effort: browsers allow them only after a user gesture (the tap that starts the
// match counts for a few seconds), and an installed app is fullscreen already.

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

/** A touch phone (not a tablet or a desktop with a touch screen). */
export function isPhone(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

export async function enterMatchMode(): Promise<void> {
  if (screenPreview || !isPhone()) return;
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
  } catch {
    // Not allowed here (no gesture, iOS Safari, desktop): the rotate hint covers it.
  }
}

export function leaveMatchMode(): void {
  // Keep phone menus in landscape while the game remains in immersive mode.
  if (isPhone() && document.fullscreenElement) return;
  try {
    (screen.orientation as LockableOrientation | undefined)?.unlock?.();
  } catch {
    // ignore
  }
}

/** Fullscreen requires a real user gesture; retry after leaving fullscreen. */
export function enableImmersiveMode(): () => void {
  const enter = () => {
    // The operator panel is a normal web page, not the game.
    if (screenPreview) return;
    if (window.location.pathname.startsWith('/admin')) return;
    if (document.fullscreenElement || !document.fullscreenEnabled) return;
    void document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(async () => {
        if (isPhone()) await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
      })
      .catch(() => undefined);
  };
  window.addEventListener('pointerup', enter, true);
  return () => window.removeEventListener('pointerup', enter, true);
}
