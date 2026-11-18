/** Flat level mark stays crisp at any pixel density. */
export function LevelStar({ value }: { value: string }) {
  const outline =
    'M50 5 Q53 5 55 10 L66 31 90 35 Q97 36 92 42 L75 61 79 87 Q80 94 73 91 L50 79 27 91 Q20 94 21 87 L25 61 8 42 Q3 36 10 35 L34 31 45 10 Q47 5 50 5Z';
  return (
    <>
      <svg viewBox="0 0 100 105" aria-hidden="true" focusable="false">
        <path d={outline} fill="#ffd34d" stroke="#9d6816" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <b>{value}</b>
    </>
  );
}
