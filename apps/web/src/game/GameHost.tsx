// Owns the lifetime of one Phaser.Game. React never renders the board itself.
import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { settingsStore } from '../services/settings';
import { BOARD } from './theme';
import { portraitViewport } from './portraitViewport';
import { MatchScene, SCENE_KEY, type SceneInit } from './MatchScene';

export function GameHost({ init }: { init: SceneInit }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(init);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    // Camera framing changes only presentation; simulation coordinates stay intact.
    const resolution = settingsStore.get().graphics === 'low' ? 1 : 2;
    const dimensions = () => portraitViewport(parent.clientWidth, parent.clientHeight, resolution);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      ...dimensions(),
      backgroundColor: BOARD.background,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { activePointers: 3 },
      banner: false,
      audio: { noAudio: true }, // sound is handled by services/audio
      loader: { timeout: 12_000, maxRetries: 2 }, // a stalled request must not hold the match back
      scene: [],
    });
    game.scene.add(SCENE_KEY, MatchScene, true, initRef.current);
    // Phaser caches the canvas position. In the dev server, React StrictMode's
    // twin canvas sits above this one until it is removed, which left that cache
    // a full board height off and every press missed. Re-reading the position
    // before each press (capture phase: before Phaser's own listener) is cheap
    // and keeps input exact whatever moved the canvas.
    const refreshBounds = () => game.scale.updateBounds();
    const observer = new ResizeObserver(() => {
      if (!game.isBooted) return;
      const size = dimensions();
      // Resize reallocates the canvas and render targets; layout notifications can repeat.
      if (game.scale.gameSize.width !== size.width || game.scale.gameSize.height !== size.height) {
        game.scale.resize(size.width, size.height);
      }
      refreshBounds();
    });
    observer.observe(parent);
    parent.addEventListener('pointerdown', refreshBounds, true);
    return () => {
      observer.disconnect();
      parent.removeEventListener('pointerdown', refreshBounds, true);
      // Phaser ignores destroy() before boot completes (e.g. React StrictMode's
      // immediate remount), which would leave a second live scene on the controller.
      if (game.isBooted) {
        game.destroy(true);
      } else {
        game.scene.remove(SCENE_KEY);
        game.events.once(Phaser.Core.Events.READY, () => game.destroy(true));
      }
    };
  }, []);

  return <div ref={parentRef} className="game-host" data-testid="game-host" />;
}
