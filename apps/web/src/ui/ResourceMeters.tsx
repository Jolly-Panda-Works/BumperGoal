import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useLocalInventory } from '../services/localInventory';
import { useOnline } from '../services/online';
import { CurrencyIcon } from './components';
import { assetUrl } from '../game/art';
import { formatNumber } from '../i18n';

/** Shared live resource meters for the illustrated game screens. */
export function ResourceMeters({ illustrated = false }: { illustrated?: boolean }) {
  const { t } = useTranslation();
  const inventory = useLocalInventory();
  const server = useOnline();
  const wallet = server.status === 'online' ? server.profile?.wallet : inventory;
  return createPortal(
    <div className="stadium-wallet stadium-wallet--shared">
      <Link to="/shop?tab=currency&group=coins" aria-label={t('common.coins')}>
        {illustrated ? (
          <img className="currency-icon" src={assetUrl('ui/coin.webp')} alt="" />
        ) : (
          <CurrencyIcon currency="coins" size={80} />
        )}
        <span className="stadium-wallet__amount">
          <bdi>{formatNumber(wallet?.coins ?? 0)}</bdi>
        </span>
        <b className="stadium-wallet__plus" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />
          </svg>
        </b>
      </Link>
      <Link to="/shop?tab=currency&group=gems" aria-label={t('common.gems')}>
        {illustrated ? (
          <img className="currency-icon" src={assetUrl('ui/gem.webp')} alt="" />
        ) : (
          <CurrencyIcon currency="gems" size={80} />
        )}
        <span className="stadium-wallet__amount">
          <bdi>{formatNumber(wallet?.gems ?? 0)}</bdi>
        </span>
        <b className="stadium-wallet__plus" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />
          </svg>
        </b>
      </Link>
    </div>,
    document.body,
  );
}
