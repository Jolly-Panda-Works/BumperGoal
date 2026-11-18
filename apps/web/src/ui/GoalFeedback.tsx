import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Side } from '@flickkick/rules';
import type { MatchDriver } from '../game/driver';
import { useSettings } from '../services/settings';
import { formatNumber } from '../i18n';

export interface GoalAnnouncementData {
  scored: boolean;
  name: string;
  score: { L: number; R: number };
  ownGoal: boolean;
}

export function GoalAnnouncement({
  data,
  reducedMotion = false,
}: {
  data: GoalAnnouncementData;
  reducedMotion?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`goal-feedback goal-feedback--${data.scored ? 'scored' : 'conceded'}`}
      role="status"
      aria-live="polite"
    >
      <div className="goal-feedback__wash" aria-hidden="true" />
      {!reducedMotion && (
        <div className="goal-feedback__particles" aria-hidden="true">
          {Array.from({ length: data.scored ? 36 : 12 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  '--x': `${(i * 37) % 100}%`,
                  '--drift': `${((i * 53) % 180) - 90}px`,
                  '--delay': `${(i % 6) * -0.08}s`,
                  '--spin': `${i * 47}deg`,
                  '--color': ['#ffe45c', '#ffffff', '#40daff', '#baff36'][i % 4],
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <div className="goal-feedback__message">
        <span className="goal-feedback__label">{t(data.scored ? 'match.goalScored' : 'match.goalConceded')}</span>
        <strong>{t('match.goal')}</strong>
        <span className="goal-feedback__player">
          {data.name}
          {data.ownGoal ? ` · ${t('match.ownGoal')}` : ''}
        </span>
        <bdi className="goal-feedback__score">
          {formatNumber(data.score.L)} : {formatNumber(data.score.R)}
        </bdi>
      </div>
    </div>
  );
}

/** Lives only for the goal pause; independent of simulation and turn state. */
export function GoalFeedback({ controller, playerSide }: { controller: MatchDriver; playerSide: Side }) {
  const [goal, setGoal] = useState<(GoalAnnouncementData & { serial: number }) | null>(null);
  const settings = useSettings();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let serial = 0;
    const off = controller.bus.on('events', (events) => {
      for (const event of events)
        if (event.type === 'goal') {
          clearTimeout(timer);
          setGoal({
            scored: event.scorer === playerSide,
            name: controller.playerOf(event.scorer).displayName,
            score: event.score,
            ownGoal: event.ownGoal,
            serial: ++serial,
          });
          timer = setTimeout(() => setGoal(null), 1500);
        }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [controller, playerSide]);
  return goal ? <GoalAnnouncement key={goal.serial} data={goal} reducedMotion={settings.reducedMotion} /> : null;
}
