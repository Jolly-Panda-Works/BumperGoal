import { teamAttributes, teamTurnTime, rulesConfig } from '@flickkick/config';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
export function TeamAttributes({ id }: { id: string }) {
  const { t } = useTranslation();
  const attributes = teamAttributes(id);
  return (
    <dl className="team-attributes">
      {(['force', 'time', 'aim'] as const).map((key) => {
        const value = attributes[key];
        const label = t(`teamAttributes.${key}`);
        const shown =
          key === 'time'
            ? t('teamAttributes.seconds', { value: formatNumber(teamTurnTime(id, rulesConfig.turnTimeMs) / 1000) })
            : `${formatNumber(value)}/${formatNumber(10)}`;
        return (
          <div key={key} className={`team-attribute team-attribute--${key}`} title={t(`teamAttributes.${key}Hint`)}>
            <dt>{label}</dt>
            <dd>
              <span
                className="team-attribute__bar"
                role="meter"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={value}
                aria-valuetext={shown}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} className={i < value ? 'is-filled' : ''} />
                ))}
              </span>
              <bdi>{shown}</bdi>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
