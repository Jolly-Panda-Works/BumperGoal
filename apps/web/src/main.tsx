import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import './i18n';
import './services/remoteConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastHost } from './ui/toast';
import { App } from './app/App';
import { ErrorBoundary } from './ui/ErrorBoundary';

if (import.meta.env.DEV && import.meta.env.MODE === 'screens') {
  const { seedScreens } = await import('./dev/fixtures');
  seedScreens();
  await import('./dev/screens.css');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <ToastHost />
  </StrictMode>,
);
import './styles/lobby.css';
import './styles/motion.css';

import './styles/rakhtkan.css';

import './styles/bumper-ui.css';

import './styles/cartoon-ui.css';

import './styles/profile-art.css';

import './styles/shared-header.css';

import './styles/catalog-art.css';

import './styles/flat-ui.css';
import './styles/toy-menu.css';
