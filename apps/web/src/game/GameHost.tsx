import { useEffect, useRef, useState } from 'react';
import type { SceneInit } from './MatchScene';
import { ThreeArena } from './ThreeArena';

export function GameHost({ init }: { init: SceneInit }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(init);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!parentRef.current) return;
    try {
      const arena = new ThreeArena(parentRef.current, initRef.current);
      return () => arena.destroy();
    } catch (cause) {
      console.error('Unable to initialize 3D arena', cause);
      setError(true);
    }
  }, []);
  return (
    <div ref={parentRef} className="game-host" data-testid="game-host">
      {error && <p role="alert">نمای سه‌بعدی بارگذاری نشد. صفحه را در مرورگری با پشتیبانی WebGL 2 باز کنید.</p>}
    </div>
  );
}
