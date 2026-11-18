import { cosmetics } from '@flickkick/config';
import { ownsLocal, type CosmeticKind } from './localInventory';
import { profileStore } from './localProfile';
import { getOnline, updateProfile } from './online';

export const equipmentKey = {
  teams: 'teamId',
  balls: 'ballId',
  avatars: 'avatarId',
  formations: 'formationId',
  trails: 'trailId',
} as const;

export function equipmentState(kind: CosmeticKind, id: string): 'locked' | 'owned' | 'active' {
  if (!ownsLocal(kind, id)) return 'locked';
  return profileStore.get()[equipmentKey[kind]] === id ? 'active' : 'owned';
}

/** A single loadout field per category makes activating two items impossible. */
export async function activateEquipment(kind: CosmeticKind, id: string): Promise<void> {
  if (!ownsLocal(kind, id)) throw new Error('Item is not owned');
  const key = equipmentKey[kind];
  if (getOnline().status === 'online') {
    await updateProfile({ [key]: id });
    return;
  }
  const free = cosmetics[kind].some((item) => item.id === id && item.price === null);
  profileStore.set((profile) => ({
    ...profile,
    [key]: id,
    pending: free ? { ...profile.pending, [key]: id } : profile.pending,
  }));
}
