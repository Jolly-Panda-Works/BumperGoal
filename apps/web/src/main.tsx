import '@fontsource/rubik/400.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/800.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/800.css';
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
