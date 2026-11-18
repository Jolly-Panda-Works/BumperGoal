import { rpc } from './online';
import { settingsStore } from './settings';
import { VoiceSession } from './voice';

const COMMS_URL = ((import.meta.env.VITE_COMMS_URL as string | undefined) ?? '').trim();

export const voiceConfigured = COMMS_URL !== '';

export const voiceChat = new VoiceSession({
  enabled: () => settingsStore.get().voiceChat,
  baseUrl: COMMS_URL,
  mint: (matchId) => rpc<{ enabled: boolean; token?: string }>('voice_token', { matchId }),
  openRoom: (baseUrl) => import('./voiceRoom').then((m) => m.openGameRoom(baseUrl)),
});
