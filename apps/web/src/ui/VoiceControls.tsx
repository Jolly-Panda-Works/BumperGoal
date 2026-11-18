import { useTranslation } from 'react-i18next';
import type { MicState, VoicePeer } from '../services/voice';
import { IconMic, IconMicOff, IconSpeakerOff, IconSpeakerOn } from './icons';

export function micView(mic: MicState): { label: string; pressed: boolean; disabled: boolean; on: boolean } {
  switch (mic) {
    case 'on':
      return { label: 'voice.micOn', pressed: true, disabled: false, on: true };
    case 'pending':
      return { label: 'voice.micPending', pressed: false, disabled: true, on: false };
    case 'denied':
      return { label: 'voice.micDenied', pressed: false, disabled: false, on: false };
    case 'blocked':
      return { label: 'voice.micBlocked', pressed: false, disabled: true, on: false };
    default:
      return { label: 'voice.micOff', pressed: false, disabled: false, on: false };
  }
}

export function MicButton({ mic, speaking, onToggle }: { mic: MicState; speaking: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const view = micView(mic);
  const label = t(view.label);
  return (
    <button
      type="button"
      className={`icon-btn voice-mic voice-mic--${mic} ${speaking && view.on ? 'is-speaking' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={view.pressed}
      disabled={view.disabled}
      onClick={onToggle}
      data-testid="voice-mic"
    >
      {view.on ? <IconMic /> : <IconMicOff />}
    </button>
  );
}

export function VoiceBadge({ peer }: { peer: VoicePeer | null }) {
  const { t } = useTranslation();
  if (!peer || !peer.connected) return null;
  if (peer.silenced)
    return (
      <span className="voice-badge voice-badge--silenced" data-testid={`voice-badge-${peer.id}`} data-state="silenced">
        <IconSpeakerOff size={12} />
        <span className="visually-hidden">{t('voice.silenced')}</span>
      </span>
    );
  if (!peer.speaking) return null;
  return (
    <span className="voice-badge voice-badge--speaking" data-testid={`voice-badge-${peer.id}`} data-state="speaking">
      <IconMic size={12} />
      <span className="visually-hidden">{t('voice.speaking', { name: peer.name })}</span>
    </span>
  );
}

export function AudioUnlock({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="voice-unlock" onClick={onUnlock} data-testid="voice-unlock">
      <IconSpeakerOn size={16} />
      <span>{t('voice.audioBlocked')}</span>
    </button>
  );
}
