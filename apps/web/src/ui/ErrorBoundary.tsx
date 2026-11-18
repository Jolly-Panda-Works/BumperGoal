import { Component, type ErrorInfo, type ReactNode } from 'react';
import { showMessage } from './messages';
import i18n from '../i18n';
import { ErrorState } from './components';

/** Last-resort boundary: a render error shows a recoverable state instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
    showMessage(i18n.t('errors.generic'), 'error');
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot">
        <ErrorState
          title={i18n.t('errors.generic')}
          onRetry={() => {
            this.setState({ error: null });
            window.location.assign('/home');
          }}
        />
      </div>
    );
  }
}
