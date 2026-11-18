// Visual editors for the admin panel: kickoff formations on a pitch and team disc images.
import { useRef, useState } from 'react';
import { MAX_IMAGE_LENGTH } from '@flickkick/config';
import { tr } from './adminText';

type Point = [number, number];

export interface PitchSize {
  halfWidth: number;
  halfHeight: number;
  goalHalfWidth: number;
  goalDepth: number;
  discRadius: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Drag the left team's discs on the pitch; the right team mirrors them. Positions
 * stay in the own half. Game y points up, so the SVG flips it.
 */
export function FormationEditor({
  value,
  defaults,
  pitch,
  onChange,
}: {
  value: Point[];
  defaults: Point[];
  pitch: PitchSize;
  onChange: (index: number, p: Point) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const { halfWidth: w, halfHeight: h, goalHalfWidth: g, goalDepth: d, discRadius: r } = pitch;
  const pad = d + 0.4;

  const toGame = (e: React.PointerEvent): Point | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const x = Math.min(-r, Math.max(-w + r, p.x));
    const y = Math.min(h - r, Math.max(-h + r, -p.y));
    return [round1(x), round1(y)];
  };

  return (
    <div className="ad-formation">
      <svg
        ref={svg}
        className="ad-formation__pitch"
        viewBox={`${-w - pad} ${-h - 0.4} ${(w + pad) * 2} ${(h + 0.4) * 2}`}
        onPointerMove={(e) => {
          if (drag === null) return;
          const p = toGame(e);
          if (p) onChange(drag, p);
        }}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
        role="img"
        aria-label="Kickoff formation"
      >
        <rect x={-w} y={-h} width={w * 2} height={h * 2} className="ad-formation__turf" />
        <rect x={-w - d} y={-g} width={d} height={g * 2} className="ad-formation__goal" />
        <rect x={w} y={-g} width={d} height={g * 2} className="ad-formation__goal" />
        <line x1={0} y1={-h} x2={0} y2={h} className="ad-formation__line" />
        <circle cx={0} cy={0} r={1.4} className="ad-formation__line" fill="none" />
        <rect x={-w} y={-h} width={w * 2} height={h * 2} className="ad-formation__line" fill="none" />
        <circle cx={0} cy={0} r={0.22} className="ad-formation__ball" />
        {value.map(([x, y], i) => (
          <circle key={`o${i}`} cx={-x} cy={-y} r={r} className="ad-formation__disc ad-formation__disc--away" />
        ))}
        {defaults.map(([x, y], i) =>
          value[i]?.[0] === x && value[i]?.[1] === y ? null : (
            <circle key={`d${i}`} cx={x} cy={-y} r={r} className="ad-formation__ghost" />
          ),
        )}
        {value.map(([x, y], i) => (
          <g
            key={`h${i}`}
            className={`ad-formation__handle${drag === i ? ' is-dragging' : ''}`}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag(i);
            }}
          >
            <circle cx={x} cy={-y} r={r} className="ad-formation__disc" />
            <text x={x} y={-y} className="ad-formation__num">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <p className="ad-formation__hint">{tr('formation.hint')}</p>
    </div>
  );
}

/** Crops an uploaded file to a centered circle (disc art) or square (portraits), small enough for the server. */
async function toDiscImage(file: File, circle: boolean): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  for (const [size, quality] of [
    [224, 0.9],
    [192, 0.85],
    [160, 0.8],
    [128, 0.75],
  ] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    if (circle) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    let url = canvas.toDataURL('image/webp', quality);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
    if (url.length <= MAX_IMAGE_LENGTH) return url;
  }
  throw new Error(tr('image.tooBig'));
}

export function ImageEditor({
  shape,
  current,
  bundled,
  overridden,
  onChange,
}: {
  shape: 'circle' | 'square';
  current: string | undefined;
  bundled: string | undefined;
  overridden: boolean;
  onChange: (image: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`ad-team-image ad-team-image--${shape}`}>
      <span className="ad-team-image__disc">
        {current ? <img src={current} alt="" /> : <span className="ad-team-image__empty">{tr('image.noArt')}</span>}
      </span>
      {overridden && bundled && (
        <span className="ad-team-image__disc ad-team-image__disc--small" title="Built-in art">
          <img src={bundled} alt="" />
        </span>
      )}
      <span className="ad-team-image__actions">
        <button type="button" className="admin__btn admin__btn--small" onClick={() => input.current?.click()}>
          {tr('action.upload')}
        </button>
        {overridden && (
          <button type="button" className="admin__btn admin__btn--small" onClick={() => onChange(undefined)}>
            {tr('action.useBuiltIn')}
          </button>
        )}
        <small>{tr(shape === 'circle' ? 'image.hint' : 'image.square')}</small>
        {error && <small className="admin__error-text">{error}</small>}
      </span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          toDiscImage(file, shape === 'circle').then(
            (url) => {
              setError(null);
              onChange(url);
            },
            (err: unknown) => setError(err instanceof Error ? err.message : tr('image.unreadable')),
          );
        }}
      />
    </div>
  );
}

/** On narrow screens the editor sits below the list: bring it into view after a pick. */
export function revealDetail(from: Element): void {
  if (!window.matchMedia('(max-width: 900px)').matches) return;
  const detail = from.closest('.ad-browser')?.querySelector('.ad-browser__detail');
  requestAnimationFrame(() => detail?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
