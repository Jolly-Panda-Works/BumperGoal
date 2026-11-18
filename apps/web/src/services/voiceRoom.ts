import { createGameRoom } from '@comms/sdk/game';
import { livekitConnector } from '@comms/sdk/media';
import type { VoiceRoom } from './voice';

export async function openGameRoom(baseUrl: string): Promise<VoiceRoom> {
  const room = createGameRoom({ baseUrl, connector: livekitConnector(() => import('livekit-client')) });
  return {
    join: (token) => room.join(token),
    leave: () => room.leave(),
    setMic: (on) => room.setMic(on),
    silence: (id, on) => room.silence(id, on),
    report: (id, reason, note) => room.report(id, reason, note),
    subscribe: (listener) => room.subscribe(listener),
    getSnapshot: () => room.getSnapshot(),
    resumeAudio: () => room.resumeAudio(),
  };
}
