import { connect, getOnline, rpc } from './online';

export interface Invitation {
  code: string;
  expiresAt: number;
  matchId?: string;
  local?: boolean;
}
export const localFriendsAvailable = import.meta.env.DEV;

export async function friendRequest(
  action: 'create' | 'join' | 'status' | 'cancel',
  code?: string,
  local?: boolean,
): Promise<Invitation> {
  if (import.meta.env.DEV && (local || getOnline().status !== 'online')) {
    const { localFriendRequest } = await import('../dev/localFriendsClient');
    return localFriendRequest<Invitation>(action, { code });
  }
  if (getOnline().status !== 'online') await connect();
  if (getOnline().status !== 'online') throw new Error('unavailable');
  return rpc<Invitation>(`friend_${action}`, { code });
}
