import { useEffect, useState } from 'react';
import { audio } from '../services/audio';
import { IconCheck } from './icons';

/** A keyed React overlay replays for every deliberate selection or successful purchase. */
export function useCollectibleReaction() {
  const [reaction, setReaction] = useState<{ id: string; kind: 'select' | 'purchase'; serial: number } | null>(null);
  useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(() => setReaction(null), 900);
    return () => window.clearTimeout(timer);
  }, [reaction]);
  return {
    play(id: string, kind: 'select' | 'purchase' = 'select') {
      setReaction((previous) => ({ id, kind, serial: (previous?.serial ?? 0) + 1 }));
      audio.play(kind === 'purchase' ? 'coin' : 'swoosh', kind === 'purchase' ? 1 : 0.4);
    },
    render(id: string) {
      return reaction?.id === id ? (
        <span
          key={reaction.serial}
          className={`collectible-reaction collectible-reaction--${reaction.kind}`}
          aria-hidden="true"
        >
          <span className="collectible-reaction__check">
            <IconCheck size={24} />
          </span>
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} style={{ '--spark-angle': `${i * 45}deg` } as React.CSSProperties} />
          ))}
        </span>
      ) : null;
    },
  };
}
