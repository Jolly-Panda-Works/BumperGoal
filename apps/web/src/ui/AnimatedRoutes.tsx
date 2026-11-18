import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Routes, useLocation } from 'react-router';
import { useSettings } from '../services/settings';

/** Snapshot the outgoing screen without keeping two live game scenes mounted. */
export function AnimatedRoutes({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [displayed, setDisplayed] = useState(location);
  const displayedRef = useRef(location);
  const { reducedMotion } = useSettings();

  useEffect(() => {
    const previous = displayedRef.current;
    if (previous === location) return;
    const commit = () => {
      displayedRef.current = location;
      setDisplayed(location);
    };
    let cancelled = false;
    const reduce = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const changesScreen = previous.pathname !== location.pathname;
    if (reduce || !changesScreen) {
      commit();
      return;
    }
    if (typeof document.startViewTransition === 'function') {
      const transition = document.startViewTransition(() => {
        if (!cancelled) flushSync(commit);
      });
      // Background tabs can skip transitions; navigation must still complete.
      void transition.ready.catch(() => undefined);
      return () => {
        cancelled = true;
        transition.skipTransition();
      };
    }
    commit();
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.shell__main, .result-screen, .panel-screen, .dev-gallery')
        ?.animate?.([{ transform: 'translateY(6px)' }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location, reducedMotion]);

  return <Routes location={displayed}>{children}</Routes>;
}
