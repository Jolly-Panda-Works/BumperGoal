import { ArtImage } from './components';
import { cosmetics } from '@flickkick/config';
import { uiUrl } from '../game/art';

/** Tiered compositions reuse the game's original transparent currency art. */
export function CurrencyPackArt({ id }: { id: string }) {
  const uploaded = cosmetics.currencyPacks.find((p) => p.id === id)?.image;
  if (uploaded) {
    return (
      <div className="currency-pack-art currency-pack-art--1" aria-hidden="true">
        <ArtImage src={uploaded} size={80} />
      </div>
    );
  }
  const tier = Math.max(1, Math.min(6, Number(id.split('_').at(-1)) || 1));
  const gems = id.startsWith('pack_gems_');
  const images = gems
    ? Array.from({ length: tier }, () => 'pack_gems_s')
    : tier === 1
      ? ['pack_coins_s']
      : tier === 2
        ? ['pack_coins_m']
        : tier === 3
          ? ['pack_coins_s', 'pack_coins_m']
          : tier === 4
            ? ['pack_coins_m', 'pack_coins_m']
            : tier === 5
              ? ['pack_coins_m', 'pack_coins_s', 'pack_coins_m']
              : ['pack_coins_m', 'reward_coins-large', 'pack_coins_m'];
  return (
    <div className={`currency-pack-art currency-pack-art--${images.length}`} aria-hidden="true">
      {images.map((key, index) => (
        <ArtImage key={index} src={uiUrl(key)} size={80} />
      ))}
    </div>
  );
}
