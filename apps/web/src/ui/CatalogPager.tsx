import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { IconBack } from './icons';

export function CatalogPager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="catalog-pager" aria-label={t('catalog.pagination')}>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('catalog.previous')}
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        <IconBack size={28} />
      </button>
      <span dir="ltr">
        {formatNumber(page + 1)} / {formatNumber(Math.max(1, pages))}
      </span>
      <button
        type="button"
        className="icon-btn catalog-pager__next"
        aria-label={t('catalog.next')}
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <IconBack size={28} />
      </button>
    </nav>
  );
}
