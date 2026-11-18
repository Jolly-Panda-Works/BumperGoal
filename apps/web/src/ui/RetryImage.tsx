import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { retryUrl } from '../game/art';

const MAX_RETRIES = 3;
/** Longer than any art file needs on a slow phone; a stalled request never fires an error. */
const STALL_MS = 12_000;
const BACKOFF_MS = 1_000;

/** An image that asks again when its request fails or stalls. */
export function RetryImage({
  src,
  onFailed,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & { src: string; onFailed?: () => void }) {
  const ref = useRef<HTMLImageElement>(null);
  const [retry, setRetry] = useState({ src, attempt: 0 });
  const attempt = retry.src === src ? retry.attempt : 0;

  const next = useCallback(() => {
    if (attempt < MAX_RETRIES) setRetry({ src, attempt: attempt + 1 });
    else onFailed?.();
  }, [attempt, onFailed, src]);

  useEffect(() => {
    const stall = setTimeout(() => {
      if (!ref.current?.complete) next();
    }, STALL_MS);
    return () => clearTimeout(stall);
  }, [next]);

  return (
    <img
      {...rest}
      ref={ref}
      src={retryUrl(src, attempt)}
      onError={() => setTimeout(next, BACKOFF_MS * (attempt + 1))}
    />
  );
}
