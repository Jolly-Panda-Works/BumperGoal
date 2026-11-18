import { cosmetics } from '@flickkick/config';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { assetUrl } from '../game/art';

/** Static renders of the supplied GLBs keep a full catalog cheap on mobile. */
export function TeamCarPreview({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const index = Math.max(
    0,
    cosmetics.teams.findIndex((team) => team.id === teamId),
  );
  const team = cosmetics.teams[index]!;
  const model = ['cicada', 'cruiser', 'carrier'][index % 3]!;
  return (
    <span className="team-car-preview" style={{ '--team-color': team.primary } as CSSProperties}>
      <img
        src={assetUrl(`cars/${model}-preview.png`)}
        alt={t(`teams.${team.id}`)}
        width={512}
        height={512}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
