import { expect, it } from 'vitest';
import { cosmetics, physicsConfig, rulesConfig, teamPhysics, teamTurnTime, teamAimRange } from '@flickkick/config';
import { createMatch, impulseFromAim, validateShot } from '@flickkick/rules';
it('gives every team a distinct fixed valid stat combination', () => {
  const seen = new Set<string>();
  for (const team of cosmetics.teams) {
    for (const rating of Object.values(team.attributes)) {
      expect(Number.isInteger(rating)).toBe(true);
      expect(rating).toBeGreaterThanOrEqual(1);
      expect(rating).toBeLessThanOrEqual(10);
    }
    seen.add(JSON.stringify(team.attributes));
  }
  expect(seen.size).toBe(cosmetics.teams.length);
});
it('changes force limits, time budgets and guide range independently', () => {
  const a = cosmetics.teams.find((t) => t.id === 'team_volt')!,
    b = cosmetics.teams.find((t) => t.id === 'team_coral')!;
  const ap = teamPhysics(a.id, physicsConfig),
    bp = teamPhysics(b.id, physicsConfig);
  expect(ap.maxImpulse).toBeGreaterThan(bp.maxImpulse);
  expect(teamTurnTime(a.id, 15000)).toBe(15000);
  expect(teamTurnTime(b.id, 15000)).toBe(16000);
  expect(teamAimRange(b.id)).toBeGreaterThan(teamAimRange(a.id));
  const state = createMatch({
    matchId: 'stats',
    mode: 'local_pvp',
    players: [
      { id: 'a', displayName: 'A', teamId: a.id, level: 1, isBot: false },
      { id: 'b', displayName: 'B', teamId: b.id, level: 1, isBot: false },
    ],
    rules: rulesConfig,
    rngSeed: 1,
  });
  state.turn.side = 'R';
  const shot = { seq: state.turn.seq, discIndex: rulesConfig.discsPerTeam, ...impulseFromAim(0, 1, bp) };
  expect(validateShot(state, 'R', shot, bp).ok).toBe(true);
  expect(validateShot(state, 'R', { ...shot, ix: physicsConfig.maxImpulse }, bp)).toEqual({
    ok: false,
    reason: 'power_out_of_range',
  });
  expect(teamPhysics('legacy-unknown', physicsConfig)).toBe(physicsConfig);
});
