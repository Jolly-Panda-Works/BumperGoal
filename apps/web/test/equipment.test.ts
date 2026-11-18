import { afterEach, expect, it } from 'vitest';
import { cosmetics } from '@flickkick/config';
import { activateEquipment, equipmentState } from '../src/services/equipment';
import { localInventory, purchaseLocal } from '../src/services/localInventory';
import { profileStore } from '../src/services/localProfile';

afterEach(() => {
  profileStore.reset();
  localInventory.reset();
});

it('keeps exactly one active team and persists activation in the gameplay loadout', async () => {
  const teams = cosmetics.teams.filter((item) => item.price === null);
  expect(teams.length).toBeGreaterThan(1);
  await activateEquipment('teams', teams[0]!.id);
  await activateEquipment('teams', teams[1]!.id);
  expect(equipmentState('teams', teams[0]!.id)).toBe('owned');
  expect(equipmentState('teams', teams[1]!.id)).toBe('active');
  expect(profileStore.get().teamId).toBe(teams[1]!.id);
});

it('moves a paid ball from locked to purchased to active, without equipping an unowned item', async () => {
  const ball = cosmetics.balls.find((item) => item.price !== null)!;
  expect(equipmentState('balls', ball.id)).toBe('locked');
  const before = profileStore.get().ballId;
  await expect(activateEquipment('balls', ball.id)).rejects.toThrow('not owned');
  expect(profileStore.get().ballId).toBe(before);
  localInventory.set({ coins: 1000000, gems: 1000000, owned: [] });
  expect(purchaseLocal('balls', ball.id)).toBe(true);
  expect(equipmentState('balls', ball.id)).toBe('owned');
  await activateEquipment('balls', ball.id);
  expect(equipmentState('balls', ball.id)).toBe('active');
  expect(profileStore.get().ballId).toBe(ball.id);
  expect(profileStore.get().pending.ballId).not.toBe(ball.id);
});

it('activates a purchased formation and trail independently', async () => {
  localInventory.set({ coins: 1000000, gems: 1000000, owned: [] });
  const formation = cosmetics.formations.at(-1)!;
  const trail = cosmetics.trails[0]!;
  expect(purchaseLocal('formations', formation.id)).toBe(true);
  expect(purchaseLocal('trails', trail.id)).toBe(true);
  await activateEquipment('formations', formation.id);
  await activateEquipment('trails', trail.id);
  expect(profileStore.get().formationId).toBe(formation.id);
  expect(profileStore.get().trailId).toBe(trail.id);
});
