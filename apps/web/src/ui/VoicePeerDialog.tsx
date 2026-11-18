import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REPORT_REASONS, type ReportReason, type VoicePeer } from '../services/voice';
import { Button, Dialog, Toggle } from './components';

export function VoicePeerDialog({
  open,
  peer,
  name,
  reported,
  onClose,
  onSilence,
  onReport,
}: {
  open: boolean;
  peer: VoicePeer;
  name: string;
  reported: boolean;
  onClose: () => void;
  onSilence: (on: boolean) => void;
  onReport: (reason: ReportReason) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason(null);
  }, [open]);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    const ok = await onReport(reason);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open={open}
      title={t('voice.title', { name })}
      onClose={onClose}
      actions={
        reported ? undefined : (
          <Button variant="danger" disabled={!reason || busy} onClick={() => void send()}>
            {t('voice.reportSend')}
          </Button>
        )
      }
    >
      <div className="stack voice-dialog">
        <Toggle
          label={t('voice.silence', { name })}
          hint={t('voice.silenceNote')}
          checked={peer.silenced}
          onChange={onSilence}
        />
        <h3 className="voice-dialog__heading">{t('voice.report')}</h3>
        {reported ? (
          <p className="notice">{t('voice.reported')}</p>
        ) : (
          <div className="voice-reasons" role="radiogroup" aria-label={t('voice.reportReason')}>
            {REPORT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                className={`voice-reason ${reason === r ? 'is-active' : ''}`}
                onClick={() => setReason(r)}
              >
                {t(`voice.reason.${r}`)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
