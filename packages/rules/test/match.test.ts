import { describe, expect, it } from 'vitest';
import { physicsConfig, rulesConfig } from '@flickkick/config';
import { hashBodies, type ShotResult } from '@flickkick/sim';
import {
  applyShotResult,
  applyTimeout,
  beginShot,
  createMatch,
  discOwner,
  forfeit,
  impulseFromAim,
  kickoffBodies,
  validateShot,
  type MatchState,
  type Shot,
} from '../src/index';

function newMatch(seed = 7): MatchState {
  return createMatch({
    matchId: 'm1',
    mode: 'local_pvp',
    rngSeed: seed,
    rules: rulesConfig,
    players: [
      { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
      { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
    ],
  });
}

function fakeResult(state: MatchState, outcome: ShotResult['outcome'], move = 0.5): ShotResult {
  const bodies = state.bodies.map((b, i) => (i === 0 ? { ...b, x: Math.fround(b.x + move) } : b));
  return { outcome, ticks: 100, bodies, hash: hashBodies(bodies), frames: null };
}

function validShot(state: MatchState): Shot {
  const disc = state.turn.side === 'L' ? 0 : state.discsPerTeam;
  return { seq: state.turn.seq, discIndex: disc, ...impulseFromAim(0, 0.5, physicsConfig) };
}

describe('createMatch', () => {
  it('builds a mirrored kickoff with the ball in the centre', () => {
    const bodies = kickoffBodies(rulesConfig);
    expect(bodies).toHaveLength(rulesConfig.discsPerTeam * 2 + 1);
    expect(bodies.at(-1)).toEqual({ kind: 'ball', x: 0, y: 0, angle: 0 });
    for (let i = 0; i < rulesConfig.discsPerTeam; i++) {
      expect(bodies[i + rulesConfig.discsPerTeam]!.x).toBe(-bodies[i]!.x);
      expect(bodies[i]!.x).toBeLessThan(0);
    }
  });

  it('coin toss is deterministic per seed and both sides occur', () => {
    expect(newMatch(1).turn.side).toBe(newMatch(1).turn.side);
    const sides = new Set(Array.from({ length: 20 }, (_, i) => newMatch(i).turn.side));
    expect(sides).toEqual(new Set(['L', 'R']));
  });

  it('assigns disc ownership by index', () => {
    const s = newMatch();
    expect(discOwner(s, 0)).toBe('L');
    expect(discOwner(s, 5)).toBe('R');
    expect(discOwner(s, 10)).toBeNull(); // ball
    expect(discOwner(s, -1)).toBeNull();
    expect(discOwner(s, 1.5)).toBeNull();
  });
});

describe('validateShot', () => {
  const s = newMatch();
  const side = s.turn.side;
  const other = side === 'L' ? 'R' : 'L';

  it('accepts a valid shot', () => {
    expect(validateShot(s, side, validShot(s), physicsConfig)).toEqual({ ok: true });
  });

  it.each([
    ['out of turn', () => validateShot(s, other, validShot(s), physicsConfig), 'not_your_turn'],
    ['replayed seq', () => validateShot(s, side, { ...validShot(s), seq: s.turn.seq - 1 }, physicsConfig), 'stale_seq'],
    [
      'nonexistent disc',
      () => validateShot(s, side, { ...validShot(s), discIndex: 99 }, physicsConfig),
      'invalid_disc',
    ],
    ['ball as disc', () => validateShot(s, side, { ...validShot(s), discIndex: 10 }, physicsConfig), 'invalid_disc'],
    [
      'opponent disc',
      () => validateShot(s, side, { ...validShot(s), discIndex: side === 'L' ? 5 : 0 }, physicsConfig),
      'not_your_disc',
    ],
    ['NaN', () => validateShot(s, side, { ...validShot(s), ix: Number.NaN }, physicsConfig), 'non_finite'],
    [
      'too strong',
      () => validateShot(s, side, { ...validShot(s), ix: 50, iy: 0 }, physicsConfig),
      'power_out_of_range',
    ],
    [
      'too weak',
      () => validateShot(s, side, { ...validShot(s), ix: 0.01, iy: 0 }, physicsConfig),
      'power_out_of_range',
    ],
    ['while simulating', () => validateShot(beginShot(s), side, validShot(s), physicsConfig), 'not_awaiting_shot'],
  ])('rejects %s', (_name, run, reason) => {
    expect(run()).toEqual({ ok: false, reason });
  });

  it('impulseFromAim clamps power into the valid range', () => {
    for (const power of [-1, 0, 0.001, 0.5, 1, 7]) {
      const shot = { seq: s.turn.seq, discIndex: side === 'L' ? 0 : 5, ...impulseFromAim(1.1, power, physicsConfig) };
      expect(validateShot(s, side, shot, physicsConfig).ok).toBe(true);
    }
  });
});

describe('applyShotResult', () => {
  it('passes the turn and keeps settled positions', () => {
    const s = newMatch();
    const shot = validShot(s);
    const r = fakeResult(s, 'settled');
    const { state, events } = applyShotResult(beginShot(s), s.turn.side, shot, r, rulesConfig);
    expect(state.turn.side).not.toBe(s.turn.side);
    expect(state.turn.seq).toBe(s.turn.seq + 1);
    expect(state.bodies).toEqual(r.bodies);
    expect(state.stateHash).toBe(r.hash);
    expect(state.phase).toBe('AWAIT_SHOT');
    expect(events.map((e) => e.type)).toEqual(['shot', 'turn']);
  });

  it('scores, resets to kickoff and gives kickoff to the conceding side', () => {
    const s = { ...newMatch(), turn: { index: 0, side: 'L' as const, seq: 1 } };
    const { state, events } = applyShotResult(s, 'L', validShot(s), fakeResult(s, 'goal_right'), rulesConfig);
    expect(state.score).toEqual({ L: 1, R: 0 });
    expect(state.bodies).toEqual(kickoffBodies(rulesConfig));
    expect(state.turn.side).toBe('R');
    expect(events).toContainEqual({ type: 'goal', scorer: 'L', ownGoal: false, score: { L: 1, R: 0 } });
  });

  it('counts own goals for the opponent', () => {
    const s = { ...newMatch(), turn: { index: 0, side: 'L' as const, seq: 1 } };
    const { state, events } = applyShotResult(s, 'L', validShot(s), fakeResult(s, 'goal_left'), rulesConfig);
    expect(state.score).toEqual({ L: 0, R: 1 });
    expect(events).toContainEqual({ type: 'goal', scorer: 'R', ownGoal: true, score: { L: 0, R: 1 } });
  });

  it('ends the match at goalsToWin', () => {
    let s: MatchState = { ...newMatch(), turn: { index: 0, side: 'L', seq: 1 } };
    for (let g = 0; g < rulesConfig.goalsToWin; g++) {
      s = { ...s, turn: { ...s.turn, side: 'L' } };
      s = applyShotResult(s, 'L', validShot(s), fakeResult(s, 'goal_right'), rulesConfig).state;
    }
    expect(s.phase).toBe('ENDED');
    expect(s.result).toEqual({ winner: 'L', reason: 'goals' });
    expect(validateShot(s, 'R', validShot(s), physicsConfig)).toEqual({ ok: false, reason: 'match_ended' });
  });

  it('invalid simulation rolls back without consuming the turn', () => {
    const s = newMatch();
    const { state } = applyShotResult(beginShot(s), s.turn.side, validShot(s), fakeResult(s, 'invalid'), rulesConfig);
    expect(state.bodies).toEqual(s.bodies);
    expect(state.turn.side).toBe(s.turn.side);
    expect(state.turn.seq).toBe(s.turn.seq + 1);
    expect(state.shotCount).toBe(0);
  });

  it('max shots: leader wins, a tie enters sudden death and the next goal wins', () => {
    const base = newMatch();
    const lead = { ...base, shotCount: base.maxShots - 1, score: { L: 1, R: 0 } };
    const won = applyShotResult(lead, lead.turn.side, validShot(lead), fakeResult(lead, 'settled'), rulesConfig).state;
    expect(won.result).toEqual({ winner: 'L', reason: 'max_shots' });

    const tie = { ...base, shotCount: base.maxShots - 1, score: { L: 1, R: 1 } };
    const sd = applyShotResult(tie, tie.turn.side, validShot(tie), fakeResult(tie, 'settled'), rulesConfig).state;
    expect(sd.phase).toBe('AWAIT_SHOT');
    expect(sd.suddenDeath).toBe(true);
    const shooter = sd.turn.side;
    const goal = shooter === 'L' ? 'goal_right' : 'goal_left';
    const end = applyShotResult(sd, shooter, validShot(sd), fakeResult(sd, goal), rulesConfig).state;
    expect(end.result).toEqual({ winner: shooter, reason: 'goals' });
  });
});

describe('timeouts and forfeits', () => {
  it('passes the turn on timeout and forfeits after the configured count', () => {
    let s = newMatch();
    const first = s.turn.side;
    for (let i = 0; i < rulesConfig.timeoutForfeitCount - 1; i++) {
      s = applyTimeout(s).state; // first side times out
      expect(s.turn.side).not.toBe(first);
      s = { ...s, turn: { ...s.turn, side: first } }; // opponent "shoots" instantly
    }
    s = applyTimeout(s).state;
    expect(s.phase).toBe('ENDED');
    expect(s.result?.reason).toBe('forfeit_timeouts');
    expect(s.result?.winner).not.toBe(first);
  });

  it('a successful shot resets the timeout counter', () => {
    let s = applyTimeout(newMatch()).state;
    const side = s.turn.side === 'L' ? 'R' : 'L';
    s = { ...s, turn: { ...s.turn, side } };
    s = applyShotResult(s, side, validShot(s), fakeResult(s, 'settled'), rulesConfig).state;
    expect(s.consecutiveTimeouts[side]).toBe(0);
  });

  it('forfeit ends the match for the other side', () => {
    const { state } = forfeit(newMatch(), 'L', 'forfeit_quit');
    expect(state.result).toEqual({ winner: 'R', reason: 'forfeit_quit' });
  });
});
