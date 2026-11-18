import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { cosmetics, carModelForTeam, legacyTeamId, resolveTeamId } from '@flickkick/config';

it('offers exactly the three real car models with matching game and shop assets', () => {
  expect(cosmetics.teams).toHaveLength(3);
  expect(cosmetics.teams.map((team) => team.carModel)).toEqual(['cicada', 'cruiser', 'carrier']);
  for (const team of cosmetics.teams) {
    expect(carModelForTeam(team.id)).toBe(team.carModel);
    for (const ext of ['.glb', '-preview.png'])
      expect(existsSync(new URL(`../public/assets/cars/${team.carModel}${ext}`, import.meta.url))).toBe(true);
  }
});

it('maps retired choices and purchases to their former preview model', () => {
  expect(legacyTeamId('team_forest')).toBe('team_ocean');
  expect(carModelForTeam('team_forest')).toBe('carrier');
  expect(resolveTeamId('missing')).toBe('team_volt');
});
