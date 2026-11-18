import { useId } from 'react';

/** Layered gold enamel matches the beveled cartoon controls at any pixel density. */
export function LevelStar({ value }: { value: string }) {
  const id = useId();
  const outline =
    'M50 5 Q53 5 55 10 L66 31 90 35 Q97 36 92 42 L75 61 79 87 Q80 94 73 91 L50 79 27 91 Q20 94 21 87 L25 61 8 42 Q3 36 10 35 L34 31 45 10 Q47 5 50 5Z';
  return (
    <>
      <svg viewBox="0 0 100 105" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2=".7" y2="1">
            <stop stopColor="#ffffc0" />
            <stop offset=".4" stopColor="#ffce18" />
            <stop offset="1" stopColor="#e77a00" />
          </linearGradient>
          <linearGradient id={`${id}-face`} x1="0" y1="0" x2=".35" y2="1">
            <stop stopColor="#fffaaa" />
            <stop offset=".35" stopColor="#ffe830" />
            <stop offset="1" stopColor="#ffb400" />
          </linearGradient>
        </defs>
        <path
          d={outline}
          transform="translate(0 5)"
          fill="#a74a00"
          stroke="#743600"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d={outline} fill={`url(#${id}-rim)`} stroke="#7d3d00" strokeWidth="3" strokeLinejoin="round" />
        <path
          d={outline}
          transform="translate(7 7) scale(.86)"
          fill={`url(#${id}-face)`}
          stroke="#fff49a"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="m50 12-12 23-23 4 23 5 12-21 12 21 23-5-23-4Z" fill="#fff" opacity=".55" />
        <path d="m50 53 23 31-3-23 15-20-23 5Z" fill="#ef9500" opacity=".26" />
      </svg>
      <b>{value}</b>
    </>
  );
}
