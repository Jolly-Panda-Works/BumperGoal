import { useTranslation } from 'react-i18next';
import { cosmetics } from '@flickkick/config';
import { RetryImage } from './RetryImage';
import { trailUrl } from '../game/art';
export function TrailPreview({ id }: { id: string }) {
  const { t } = useTranslation();
  if (!cosmetics.trails.some((trail) => trail.id === id)) return null;
  return (
    <RetryImage
      className="trail-preview"
      src={trailUrl(id)}
      alt={t(`trails.${id}`)}
      width={128}
      height={128}
      draggable={false}
      decoding="async"
    />
  );
}
