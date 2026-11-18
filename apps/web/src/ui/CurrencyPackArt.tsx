import { ArtImage, CurrencyIcon } from './components';
import { cosmetics } from '@flickkick/config';

/** Flat currency symbols indicate pack size without baked 3D artwork. */
export function CurrencyPackArt({ id }: { id: string }) {
  const uploaded = cosmetics.currencyPacks.find((pack) => pack.id === id)?.image;
  if (uploaded)
    return (
      <div className="currency-pack-art currency-pack-art--flat" aria-hidden="true">
        <ArtImage src={uploaded} size={160} />
      </div>
    );
  const tier = Math.max(1, Math.min(6, Number(id.split('_').at(-1)) || 1));
  return (
    <div className="currency-pack-art currency-pack-art--flat" aria-hidden="true">
      {Array.from({ length: tier }, (_, i) => (
        <CurrencyIcon key={i} currency={id.startsWith('pack_gems_') ? 'gems' : 'coins'} size={70} />
      ))}
    </div>
  );
}
