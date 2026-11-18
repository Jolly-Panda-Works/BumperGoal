import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { IconBack } from './icons';

/** Arrows advance one item in the same catalog; the label describes visible items. */
export function CatalogPager({
  offset,
  total,
  visibleCount,
  onChange,
}: {
  offset: number;
  total: number;
  visibleCount: number;
  onChange: (offset: number) => void;
}) {
  const { t } = useTranslation();
  const last = Math.max(0, total - visibleCount);
  const first = total ? offset + 1 : 0;
  const end = Math.min(total, offset + visibleCount);
  return (
    <nav className="catalog-pager" aria-label={t('catalog.pagination')}>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('catalog.previous')}
        disabled={offset === 0}
        onClick={() => onChange(offset - 1)}
      >
        <IconBack size={28} />
      </button>
      <span dir="ltr" aria-live="polite">
        {formatNumber(first)}
        {end > first ? `–${formatNumber(end)}` : ''} / {formatNumber(total)}
      </span>
      <button
        type="button"
        className="icon-btn catalog-pager__next"
        aria-label={t('catalog.next')}
        disabled={offset >= last}
        onClick={() => onChange(offset + 1)}
      >
        <IconBack size={28} />
      </button>
    </nav>
  );
}
