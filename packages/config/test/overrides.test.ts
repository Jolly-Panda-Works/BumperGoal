import { afterEach, describe, expect, it } from 'vitest';
import {
  aiProfiles,
  appliedConfig,
  applyConfigOverrides,
  arenasConfig,
  configDefaults,
  cosmetics,
  economyConfig,
  locate,
  physicsConfig,
  rulesConfig,
} from '../src';

afterEach(() => {
  applyConfigOverrides(0, {});
});

describe('balance overrides', () => {
  it('edits the exported config in place and restores defaults', () => {
    const skipped = applyConfigOverrides(3, {
      'economy/startingBalance': { coins: 900, gems: 1 },
      'cosmetics/teams/@team_ocean/price': null,
      'arenas/arenas/@city/entryFee': 250,
      'rules/goalsToWin': 4,
      'physics/ball/linearDamping': 1.2,
      'ai-profiles/profiles/@pro/powerSteps': [0.5, 1],
      'cosmetics/teams/@retired/price': { coins: 1 },
    });
    expect(skipped).toEqual(['cosmetics/teams/@retired/price']);
    expect(economyConfig.startingBalance.coins).toBe(900);
    expect(cosmetics.teams.find((t) => t.id === 'team_ocean')?.price).toBeNull();
    expect(arenasConfig.arenas.find((a) => a.id === 'city')?.entryFee).toBe(250);
    expect(rulesConfig.goalsToWin).toBe(4);
    expect(physicsConfig.ball.linearDamping).toBe(1.2);
    expect(aiProfiles.find((p) => p.id === 'pro')?.powerSteps).toEqual([0.5, 1]);
    expect(appliedConfig().revision).toBe(3);

    applyConfigOverrides(4, { 'rules/goalsToWin': 3 });
    expect(rulesConfig.goalsToWin).toBe(3);
    expect(economyConfig.startingBalance.coins).toBe(500);
    expect(physicsConfig.ball.linearDamping).toBe(1);
    expect(cosmetics.teams.find((t) => t.id === 'team_ocean')?.price).not.toBeNull();
  });

  it('keeps the three real models regardless of the retired club-team switch', () => {
    applyConfigOverrides(1, { 'economy/features/clubTeams/enabled': false });
    expect(cosmetics.teams.some((t) => t.group === 'club')).toBe(false);
    applyConfigOverrides(2, {});
    expect(cosmetics.teams.some((t) => t.group === 'club')).toBe(false);
    expect(cosmetics.teams).toHaveLength(3);
  });

  it('rejects locked, structural and mistyped edits', () => {
    const skipped = applyConfigOverrides(1, {
      'rules/discsPerTeam': 6,
      'cosmetics/teams/@team_volt/default': false,
      'cosmetics/teams/@team_ocean/primary': '#fff',
      'cosmetics/teams/0/price': { coins: 1 },
      'economy/startingBalance/coins': 3,
      'rules/goalsToWin': '3',
      'rules/formation/0': [1, 2, 3],
      'economy/tutorialReward': { diamonds: 1 },
    });
    expect(skipped).toHaveLength(8);
    expect(rulesConfig.discsPerTeam).toBe(5);
  });

  it('keeps defaults separate from the live objects', () => {
    applyConfigOverrides(1, { 'rules/goalsToWin': 7 });
    const defaults = configDefaults();
    expect(locate(defaults, 'rules/goalsToWin')?.value).toBe(2);
  });
});

describe('team images', () => {
  const img = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  it('sets and clears an uploaded disc image', () => {
    expect(applyConfigOverrides(1, { 'cosmetics/teams/@team_ocean/image': img })).toEqual([]);
    expect(cosmetics.teams.find((t) => t.id === 'team_ocean')?.image).toBe(img);
    applyConfigOverrides(2, {});
    expect(cosmetics.teams.find((t) => t.id === 'team_ocean')?.image).toBeUndefined();
  });
  it('rejects other image sources and paths', () => {
    const skipped = applyConfigOverrides(1, {
      'cosmetics/teams/@team_ocean/image': 'https://evil.example/x.png',
      'cosmetics/teams/@team_volt/image': 'data:image/svg+xml;base64,PHN2Zz4=',
      'cosmetics/formations/@formation_wall/image': img,
    });
    expect(skipped).toHaveLength(3);
  });
});

describe('arena themes', () => {
  it('switches an arena to another existing theme only', () => {
    expect(applyConfigOverrides(1, { 'arenas/arenas/@park/theme': 'legends' })).toEqual([]);
    expect(arenasConfig.arenas.find((a) => a.id === 'park')?.theme).toBe('legends');
    expect(applyConfigOverrides(2, { 'arenas/arenas/@park/theme': 'moon' })).toHaveLength(1);
    expect(arenasConfig.arenas.find((a) => a.id === 'park')?.theme).toBe('park');
  });
});

describe('arenas added in the panel', () => {
  const asset = 'asset:' + '0'.repeat(64);
  it('adds, edits and removes an arena with art', () => {
    const skipped = applyConfigOverrides(1, {
      'arenas/arenas/@desert/entryFee': 900,
      'arenas/arenas/+desert': {
        entryFee: 800,
        minLevel: 8,
        xpMultiplier: 1.5,
        theme: 'coast',
        names: { en: 'Desert' },
      },
      'arenas/arenas/@desert/art': { turf: { src: asset, w: 10, h: 6 } },
      'ai-profiles/profiles/@pro/image': 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(skipped).toEqual([]);
    const desert = arenasConfig.arenas.find((a) => a.id === 'desert');
    expect(desert?.entryFee).toBe(900);
    expect(desert?.art?.turf?.src).toBe(asset);
    expect(aiProfiles.find((p) => p.id === 'pro')?.image).toContain('data:image/png');
    applyConfigOverrides(2, {});
    expect(arenasConfig.arenas.some((a) => a.id === 'desert')).toBe(false);
    expect(arenasConfig.arenas).toHaveLength(5);
  });
  it('rejects art that is not an uploaded asset', () => {
    expect(
      applyConfigOverrides(1, { 'arenas/arenas/@park/art': { turf: { src: 'https://x/y.png', w: 1, h: 1 } } }),
    ).toHaveLength(1);
  });
});
