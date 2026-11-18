import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiUrl } from '../game/art';
import { useNavigate } from 'react-router';
import { useLanguages } from '../i18n';
import { isValidDisplayName, profileStore, useLocalProfile } from '../services/localProfile';
import { settingsStore, useSettings } from '../services/settings';
import { Button, Segmented, Logo } from '../ui/components';
import { connect, onlineConfigured, signInWithEmail } from '../services/online';
import { toast } from '../ui/toast';
import { rakhtkan } from '../services/gameVariant';

/** F-02: first-run entry as a guest on this device. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useLocalProfile();
  const settings = useSettings();
  const languageOptions = useLanguages();
  const [name, setName] = useState(profile.displayName);
  const [invitation, setInvitation] = useState(
    () => new URLSearchParams(window.location.search).get('ref') ?? localStorage.getItem('flickkick.invitation') ?? '',
  );
  const [touched, setTouched] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const valid = isValidDisplayName(name);

  const start = () => {
    setTouched(true);
    if (!valid) return;
    if (!rakhtkan && invitation && !/^[1-9][0-9]{7}$/.test(invitation)) {
      toast(t('referral.invalid'), 'error');
      return;
    }
    if (!rakhtkan && invitation) localStorage.setItem('flickkick.invitation', invitation);
    profileStore.set({ displayName: name.trim(), welcomed: true });
    void connect();
    navigate(rakhtkan || profileStore.get().tutorialDone ? '/home' : '/tutorial', { replace: true });
  };

  if (signingIn) return <SignInForm onBack={() => setSigningIn(false)} />;

  return (
    <div className="welcome">
      {/* Key art behind the form: wide, square or tall to suit the screen. */}
      <picture className="welcome__hero" aria-hidden="true">
        <source media="(orientation: portrait) and (max-width: 700px)" srcSet={uiUrl('promo_portrait')} />
        <source media="(max-aspect-ratio: 4/3)" srcSet={uiUrl('promo_square')} />
        <img src={uiUrl('promo_landscape')} alt="" decoding="async" />
      </picture>
      <div className="welcome__card">
        <div className="welcome__logo" aria-label={t('app.name')}>
          <Logo big />
        </div>
        <h1>{t('welcome.title')}</h1>
        <p className="muted">{t('welcome.subtitle')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div className="field">
            <label htmlFor="welcome-name" className="field__label">
              {t('welcome.nameLabel')}
            </label>
            <input
              id="welcome-name"
              className="input"
              value={name}
              maxLength={16}
              autoComplete="nickname"
              placeholder={t('welcome.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !valid}
              aria-describedby="welcome-name-hint"
            />
            <small id="welcome-name-hint" className={touched && !valid ? 'field__error' : 'field__hint'}>
              {touched && !valid ? t('welcome.nameInvalid') : t('welcome.nameHint')}
            </small>
          </div>
          {!rakhtkan && (
            <label className="field">
              <span>{t('referral.codeOptional')}</span>
              <input
                className="input"
                inputMode="numeric"
                dir="ltr"
                value={invitation}
                maxLength={8}
                onChange={(event) => setInvitation(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
          )}
          <Segmented
            label={t('welcome.language')}
            value={settings.language}
            options={languageOptions.map((l) => ({ value: l.id, label: l.label }))}
            onChange={(language) => settingsStore.set({ language })}
          />
          <Button type="submit" size="lg" block>
            {t('welcome.start')}
          </Button>
        </form>
        <p className="fine-print">{t('welcome.guestNote')}</p>
        {onlineConfigured && (
          <Button variant="ghost" onClick={() => setSigningIn(true)}>
            {t('welcome.haveAccount')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Recovery: sign in to an account that has a linked email. */
function SignInForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="welcome">
      <form
        className="welcome__card"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          signInWithEmail(email.trim(), password)
            .then(() => {
              profileStore.set({ welcomed: true, tutorialDone: true });
              navigate('/home', { replace: true });
            })
            .catch((err: Error) => toast(t('welcome.signInFailed', { reason: err.message }), 'error'))
            .finally(() => setBusy(false));
        }}
      >
        <h1>{t('welcome.haveAccount')}</h1>
        <div className="field">
          <label className="field__label" htmlFor="signin-email">
            {t('profile.email')}
          </label>
          <input
            id="signin-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="signin-password">
            {t('profile.password')}
          </label>
          <input
            id="signin-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" size="lg" block disabled={busy || !email || password.length < 8}>
          {t('welcome.signIn')}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('welcome.back')}
        </Button>
      </form>
    </div>
  );
}
