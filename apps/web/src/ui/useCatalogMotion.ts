import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSettings } from '../services/settings';

const columns = () => (window.innerWidth < 600 ? 1 : window.innerWidth < 1100 ? 2 : 4);
const ease = 'cubic-bezier(.22,.72,.18,1)';

/** Local catalog motion, independent of whole-page view transitions. */
export function useCatalogMotion() {
  const listRef = useRef<HTMLDivElement>(null);
  const version = useRef(0);
  const moving = useRef(false);
  const animations = useRef<Animation[]>([]);
  const snapshots = useRef<HTMLElement[]>([]);
  const [visibleCount, setVisibleCount] = useState(columns);
  const { reducedMotion } = useSettings();
  const cancel = () => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    snapshots.current.forEach((snapshot) => snapshot.remove());
    snapshots.current = [];
    moving.current = false;
  };
  useEffect(() => {
    const resize = () => setVisibleCount(columns());
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      version.current++;
      cancel();
    };
  }, []);
  const reduce = () => reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const run = (element: HTMLElement, frames: Keyframe[], duration: number) => {
    const animation = element.animate(frames, { duration, easing: ease, fill: 'both' });
    animations.current.push(animation);
    return animation.finished.catch(() => undefined);
  };
  const switchCategory = async (apply: () => void) => {
    const token = ++version.current;
    cancel();
    const outgoing = listRef.current;
    if (!outgoing || reduce()) {
      flushSync(apply);
      return;
    }
    moving.current = true;
    outgoing.dataset.motion = 'tab-exit';
    await run(
      outgoing,
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${outgoing.clientWidth + 40}px)`, opacity: 0 },
      ],
      260,
    );
    if (token !== version.current) return;
    flushSync(apply);
    // Search-parameter navigation may commit its route in an effect.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (token !== version.current) return;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const incoming = listRef.current;
    if (incoming) {
      incoming.dataset.motion = 'tab-enter';
      await run(
        incoming,
        [
          { transform: `translateX(-${incoming.clientWidth + 40}px)`, opacity: 0.15 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        380,
      );
    }
    if (token === version.current) {
      cancel();
      if (incoming) delete incoming.dataset.motion;
    }
  };
  const moveWindow = async (apply: () => void, direction: number) => {
    if (moving.current || !direction) return;
    const token = ++version.current;
    const list = listRef.current;
    if (!list || reduce()) {
      flushSync(apply);
      return;
    }
    cancel();
    moving.current = true;
    const old = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-catalog-id]')).map((element) => ({
      id: element.dataset.catalogId!,
      rect: element.getBoundingClientRect(),
      clone: element.cloneNode(true) as HTMLElement,
    }));
    flushSync(apply);
    const cards = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-catalog-id]'));
    const bounds = list.getBoundingClientRect();
    const step = (old[0]?.rect.width ?? list.clientWidth) + (parseFloat(getComputedStyle(list).columnGap) || 0);
    const jobs: Promise<unknown>[] = [];
    list.dataset.motion = 'item-slide';
    for (const card of cards) {
      const previous = old.find((item) => item.id === card.dataset.catalogId);
      const rect = card.getBoundingClientRect();
      jobs.push(
        run(
          card,
          [
            {
              transform: `translate(${previous ? previous.rect.x - rect.x : direction * step}px,${previous ? previous.rect.y - rect.y : 0}px)`,
              opacity: previous ? 1 : 0,
            },
            { transform: 'translate(0,0)', opacity: 1 },
          ],
          420,
        ),
      );
    }
    for (const item of old.filter((item) => !cards.some((card) => card.dataset.catalogId === item.id))) {
      const clone = item.clone;
      // WebGL drawing buffers cannot be cloned; reveal the already-loaded image fallback.
      clone.querySelectorAll('.home-car-render').forEach((renderer) => renderer.remove());
      delete clone.dataset.catalogId;
      clone.dataset.catalogSnapshot = 'true';
      clone.setAttribute('aria-hidden', 'true');
      clone.inert = true;
      Object.assign(clone.style, {
        position: 'absolute',
        left: `${item.rect.x - bounds.x}px`,
        top: `${item.rect.y - bounds.y}px`,
        width: `${item.rect.width}px`,
        height: `${item.rect.height}px`,
        zIndex: '4',
        pointerEvents: 'none',
        margin: '0',
      });
      list.appendChild(clone);
      snapshots.current.push(clone);
      jobs.push(
        run(
          clone,
          [
            { transform: 'translateX(0)', opacity: 1 },
            { transform: `translateX(${-direction * step}px)`, opacity: 0 },
          ],
          420,
        ),
      );
    }
    await Promise.all(jobs);
    if (token === version.current) {
      cancel();
      delete list.dataset.motion;
    }
  };
  return { listRef, visibleCount, switchCategory, moveWindow };
}
