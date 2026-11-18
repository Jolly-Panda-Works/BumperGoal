import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArtImage, Logo } from '../ui/components';
import { assetUrl, uiUrl } from '../game/art';

export function RakhtkanHome() {
  const { t } = useTranslation();
  return (
    <div className="screen home lobby rakhtkan-home">
      <section className="lobby__hero">
        <div className="lobby__brand">
          <Logo big />
          <p>{t('app.tagline')}</p>
        </div>
      </section>
      <div className="lobby__modes">
        {[
          { to: '/play/local', title: t('friends.title'), tone: 'blue', art: 'mode_local' },
          { to: '/play/online', title: t('home.playOnline'), tone: 'gold', art: 'rank_gold' },
        ].map((mode) => (
          <Link
            key={mode.to}
            to={mode.to}
            className={`lobby-mode lobby-mode--${mode.tone}`}
            style={{ backgroundImage: `url(${assetUrl(`lobby/card_${mode.tone}.webp`)})` }}
          >
            <ArtImage className="lobby-mode__art" src={uiUrl(mode.art)} />
            <span className="lobby-mode__copy">
              <strong>{mode.title}</strong>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
