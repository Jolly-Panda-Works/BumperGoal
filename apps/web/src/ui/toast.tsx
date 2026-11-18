import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from './components';
import { messageStore, showMessage, type Message, type MessageTone } from './messages';
export type Toast = Message;
/** Existing toast callers now use the common popup and remain visible until dismissed. */
export function toast(text: string, tone: MessageTone = 'info', _ms = 2600): void {
  showMessage(text, tone);
}
export function ToastHost() {
  const { t } = useTranslation();
  const list = useSyncExternalStore(messageStore.subscribe, messageStore.get);
  const current = list[0];
  useEffect(() => {
    const unexpected = () => showMessage(t('errors.generic'), 'error');
    window.addEventListener('error', unexpected);
    window.addEventListener('unhandledrejection', unexpected);
    return () => {
      window.removeEventListener('error', unexpected);
      window.removeEventListener('unhandledrejection', unexpected);
    };
  }, [t]);
  const close = () => {
    if (current) messageStore.dismiss(current.id);
  };
  return (
    <Dialog
      open={!!current}
      title={t(`messages.${current?.tone ?? 'info'}`)}
      onClose={close}
      messageTone={current?.tone}
      actions={
        <>
          <Button variant={current?.action ? 'secondary' : 'primary'} onClick={close}>
            {t('common.close')}
          </Button>
          {current?.action && (
            <Button
              onClick={() => {
                const action = current.action;
                close();
                action?.run();
              }}
            >
              {current.action.label}
            </Button>
          )}
        </>
      }
    >
      <p className="message-popup__text" role={current?.tone === 'error' ? 'alert' : 'status'}>
        {current?.text}
      </p>
    </Dialog>
  );
}
export function Notice({ text, tone = 'info' }: { text: string; tone?: MessageTone }) {
  useEffect(() => showMessage(text, tone), [text, tone]);
  return null;
}
