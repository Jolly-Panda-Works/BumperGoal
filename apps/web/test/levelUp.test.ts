import { beforeEach, describe, expect, it } from 'vitest';
import { queueLevelUps, acknowledgeLevelUp, profileStore, defaultProfile } from '../src/services/localProfile';
import { localInventory } from '../src/services/localInventory';
describe('authoritative level-up receipts', () => {
  beforeEach(() => profileStore.set(defaultProfile()));
  it('queues every crossed level once without replaying unchanged levels', () => {
    expect(queueLevelUps([], 1, 4)).toEqual([2, 3, 4]);
    expect(queueLevelUps([2, 3, 4], 1, 4)).toEqual([2, 3, 4]);
    expect(queueLevelUps([], 4, 4)).toEqual([]);
    expect(queueLevelUps([], 4, 2)).toEqual([]);
  });
  it('acknowledges one receipt without issuing duplicate currency', () => {
    profileStore.set((p) => ({ ...p, pendingLevelUps: [2, 3] }));
    const before = localInventory.get();
    acknowledgeLevelUp(2);
    acknowledgeLevelUp(2);
    expect(profileStore.get().pendingLevelUps).toEqual([3]);
    expect(localInventory.get()).toEqual(before);
  });
});
