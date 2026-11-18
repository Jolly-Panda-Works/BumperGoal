import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cosmetics, carModelForTeam, legacyTeamId, resolveTeamId } from '@flickkick/config';

it('offers the original and nine imported car models with matching game and shop assets', () => {
  expect(cosmetics.teams).toHaveLength(12);
  expect(cosmetics.teams.slice(0, 3).map((team) => team.carModel)).toEqual(['cicada', 'cruiser', 'carrier']);
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

it('imports all nine textured GLBs with rolling wheel meshes and the shared collider length', () => {
  for (let i = 1; i <= 9; i++) {
    const data = readFileSync(new URL(`../public/assets/cars/tiny-racer-${i}.glb`, import.meta.url));
    const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    expect(json.images.length).toBeGreaterThan(0);
    expect(
      json.nodes.filter((node: { name?: string }) => node.name?.startsWith('wheel_')).length,
    ).toBeGreaterThanOrEqual(2);
    const bounds = json.meshes.flatMap((mesh: { primitives: { attributes: { POSITION: number } }[] }) =>
      mesh.primitives.map((primitive) => json.accessors[primitive.attributes.POSITION]),
    );
    const min = Math.min(...bounds.map((a: { min: number[] }) => a.min[2]));
    const max = Math.max(...bounds.map((a: { max: number[] }) => a.max[2]));
    expect(max - min).toBeCloseTo(1.42, 4);
  }
});
