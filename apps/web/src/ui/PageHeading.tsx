import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IconBack } from './icons';

/** A physical left back control alongside the localized page title. */
export function PageHeading({ title, to = '/home' }: { title: string; to?: string }) {
  const { t } = useTranslation();
  return (
    <div className="page-heading">
      <Link className="icon-btn page-heading__back" to={to} aria-label={t('common.back')}>
        <IconBack size={28} />
      </Link>
      <h1>{title}</h1>
    </div>
  );
}
