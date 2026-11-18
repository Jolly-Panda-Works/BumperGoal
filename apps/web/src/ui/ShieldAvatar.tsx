import { useId } from 'react';
import { avatarUrl } from '../game/art';

/** The photo and border share one SVG coordinate system, so the mask stays aligned. */
export function ShieldAvatar({ id }: { id: string }) {
  const key = useId();
  const outer = 'M10 8 25 3H75L90 8V76L80 91 50 111 20 91 10 76Z';
  const inner = 'M15 14 26 9H74L85 14V74L76 86 50 103 24 86 15 74Z';
  return (
    <svg className="shield-avatar" viewBox="0 0 100 114" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${key}-mask`}>
          <path d={inner} />
        </clipPath>
      </defs>
      <path d={outer} fill="#35caff" stroke="#032958" strokeWidth="2" strokeLinejoin="round" />
      <path d={inner} fill="#082859" />
      <image
        href={avatarUrl(id)}
        x="14"
        y="8"
        width="72"
        height="97"
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${key}-mask)`}
      />
      <path d={inner} fill="none" stroke="#073c7f" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
