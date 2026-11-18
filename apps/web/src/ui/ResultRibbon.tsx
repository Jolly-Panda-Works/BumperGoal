import { useLayoutEffect, useRef } from 'react';
import { ArtImage } from './components';
import { uiUrl } from '../game/art';

/** Keep the complete localized result inside the central ribbon, including long names. */
export function ResultRibbon({ text, victory, tone = '' }: { text: string; victory: boolean; tone?: string }) {
  const box = useRef<HTMLHeadingElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current || !label.current) return;
      if (box.current.clientWidth < 4 || box.current.clientHeight < 4) return;
      const span = label.current;
      span.style.fontSize = '';
      const base = Number.parseFloat(getComputedStyle(span).fontSize);
      const ratio = Math.min(
        1,
        (box.current.clientWidth - 4) / span.scrollWidth,
        (box.current.clientHeight - 2) / span.scrollHeight,
      );
      span.style.fontSize = `${base * Math.max(0, ratio)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (box.current) observer.observe(box.current);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [text, victory]);
  return (
    <div className={`result__ribbon ${victory ? 'result__ribbon--victory' : 'result__ribbon--defeat'}`}>
      <ArtImage className="result__ribbon-art" src={uiUrl(victory ? 'result_victory' : 'result_defeat')} />
      <h1 ref={box} className={`result__title ${tone}`}>
        <span ref={label} dir="auto">
          {text}
        </span>
      </h1>
    </div>
  );
}
