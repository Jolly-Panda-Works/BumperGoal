import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { profileStore } from '../services/localProfile';
import { matchSession } from '../services/matchSession';
import { uiUrl } from '../game/art';
import { ArtImage, Button } from '../ui/components';
import { MatchScreen } from './Match';

/** F-03: guided first match against the Rookie bot, no turn timer. */
export function TutorialScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const steps = [t('tutorial.step1'), t('tutorial.step2'), t('tutorial.step3')];

  const skip = () => {
    profileStore.set({ tutorialDone: true });
    navigate(profileStore.get().welcomed ? '/home' : '/welcome', { replace: true });
  };

  // Do not mount the game (and therefore its controller/AI/input) during the introduction.
  if (started) return <MatchScreen />;
  return (
    <main className="tutorial-intro">
      <section className="coach" aria-label={t('tutorial.title')}>
        <ArtImage className="coach__art" src={uiUrl(`coach_${step + 1}`)} />
        <div className="coach__text" aria-live="polite">
          <p className="coach__step">
            {step + 1}/{steps.length}
          </p>
          <h1>{t('tutorial.title')}</h1>
          <p>{steps[step]}</p>
        </div>
        <div className="coach__actions">
          <Button variant="ghost" size="sm" onClick={skip}>
            {t('tutorial.skip')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (step < steps.length - 1) setStep((s) => s + 1);
              else {
                matchSession.setSetup({ mode: 'tutorial', aiProfileId: 'rookie' });
                setStarted(true);
              }
            }}
          >
            {step === steps.length - 1 ? t('tutorial.letsPlay') : t('tutorial.next')}
          </Button>
        </div>
      </section>
    </main>
  );
}
