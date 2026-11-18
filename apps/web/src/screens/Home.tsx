import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { uiUrl, assetUrl } from '../game/art';
import { IconGift } from '../ui/icons';
import { ArtImage, Logo } from '../ui/components';

/** Main game lobby: offline modes remain available without a server. */
export function HomeScreen() {
  const { t } = useTranslation();
  const modes = [
    { to: '/play/ai', title: t('home.playAI'), desc: t('home.playAIDesc'), tone: 'green', art: 'mode_ai' },
    { to: '/play/local', title: t('home.local2p'), desc: t('home.local2pDesc'), tone: 'blue', art: 'mode_local' },
    { to: '/play/online', title: t('home.playOnline'), desc: t('home.playOnlineDesc'), tone: 'gold', art: 'rank_gold' },
  ];
  return (
    <div className="screen home lobby">
      <section className="lobby__hero" aria-label={t('app.name')}>
        <div className="lobby__brand">
          <Logo big />
          <p>{t('app.tagline')}</p>
        </div>
      </section>
      <Link className="btn btn--secondary lobby__daily" to="/rewards">
        <IconGift />
        <span>{t('rewards.daily')}</span>
      </Link>
      <div className="lobby__modes">
        {modes.map((m) => (
          <Link
            key={m.to}
            to={m.to}
            className={`lobby-mode lobby-mode--${m.tone}`}
            style={{ backgroundImage: `url(${assetUrl(`lobby/card_${m.tone}.webp`)})` }}
          >
            <ArtImage className="lobby-mode__art" src={uiUrl(m.art)} />
            <span className="lobby-mode__copy">
              <strong>{m.title}</strong>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
