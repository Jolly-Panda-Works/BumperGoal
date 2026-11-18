import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button, EmptyState } from '../ui/components';

export function NotFoundScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="screen">
      <EmptyState
        art="not-found"
        title={t('errors.notFound')}
        action={<Button onClick={() => navigate('/home')}>{t('nav.home')}</Button>}
      />
    </div>
  );
}
