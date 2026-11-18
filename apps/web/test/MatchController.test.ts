import { beforeAll, describe, expect, it } from 'vitest';
import { physicsConfig, rulesConfig, teamPhysics, teamTurnTime } from '@flickkick/config';
import { decideShot, profileById } from '@flickkick/rules';
import { FlickSim } from '@flickkick/sim';
import { MatchController, type Clock } from '../src/game/MatchController';
import type { AIClient } from '../src/game/aiClient';

class FakeClock implements Clock {
  t = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  };
  clearTimeout = (id: number) => void this.timers.delete(id);
  /** Advances time, firing due timers in order. */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.t = end;
  }
}

let sim: FlickSim;
beforeAll(async () => {
  sim = await FlickSim.create(physicsConfig);
});

const players = [
  { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
  { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
] as const;

function syncAI(): AIClient {
  return {
    decide: (state, side, profile, seed) =>
      Promise.resolve(
        decideShot(
          state,
          side,
          profile,
          sim,
          seed,
          teamPhysics(state.players[side === 'L' ? 0 : 1].teamId, physicsConfig),
        ).shot,
      ),
    dispose: () => undefined,
  };
}

describe('MatchController', () => {
  it('passes the turn when the timer expires and forfeits after repeated timeouts', async () => {
    const clock = new FakeClock();
    const c = new MatchController({
      matchId: 't',
      mode: 'local_pvp',
      players: [players[0], players[1]],
      humanSides: ['L', 'R'],
      sim,
      seed: 3,
      clock,
    });
    c.start();
    const first = c.current.turn.side;
    const firstDuration = teamTurnTime(c.playerOf(first).teamId, rulesConfig.turnTimeMs);
    await clock.advance(firstDuration - 1);
    expect(c.current.turn.side).toBe(first);
    await clock.advance(2);
    expect(c.current.turn.side).not.toBe(first);
    for (let i = 0; i < rulesConfig.timeoutForfeitCount * 2; i++)
      await clock.advance(teamTurnTime(c.playerOf(c.current.turn.side).teamId, rulesConfig.turnTimeMs) + 1);
    expect(c.current.phase).toBe('ENDED');
    expect(c.current.result?.reason).toBe('forfeit_timeouts');
  });

  it('locks input while a shot is simulating and applies it on completeShot', () => {
    const clock = new FakeClock();
    const c = new MatchController({
      matchId: 't',
      mode: 'local_pvp',
      players: [players[0], players[1]],
      humanSides: ['L', 'R'],
      sim,
      seed: 1,
      clock,
    });
    c.start();
    const side = c.current.turn.side;
    const disc = side === 'L' ? 0 : 5;
    let played = 0;
    c.bus.on('playShot', () => played++);
    expect(c.requestShot(disc, 0, 0.6)).toBeNull();
    expect(played).toBe(1);
    expect(c.current.phase).toBe('SIMULATING');
    expect(c.canAim()).toBe(false);
    expect(c.requestShot(disc, 0, 0.6)).toBe('not_awaiting_shot');
    c.completeShot();
    expect(c.current.phase).toBe('AWAIT_SHOT');
    expect(c.current.turn.side).not.toBe(side);
    expect(c.current.shotCount).toBe(1);
    expect(c.statistics.sides[side].shots).toBe(1);
    expect(c.statistics.sides[side].powerTotal).toBeCloseTo(60, 3);
    expect(c.statistics.sides[side].simulationTicks).toBeGreaterThan(0);
    const snapshot = c.statistics;
    snapshot.sides[side].shots = 900;
    c.completeShot();
    expect(c.statistics.sides[side].shots).toBe(1);
  });

  it('rejects shooting an opponent disc', () => {
    const c = new MatchController({
      matchId: 't',
      mode: 'local_pvp',
      players: [players[0], players[1]],
      humanSides: ['L', 'R'],
      sim,
      seed: 1,
      clock: new FakeClock(),
    });
    c.start();
    const other = c.current.turn.side === 'L' ? 5 : 0;
    expect(c.requestShot(other, 0, 0.5)).toBe('not_your_disc');
  });

  it('the bot takes its turn after its think time, through the same validation', async () => {
    const clock = new FakeClock();
    const profile = profileById('amateur');
    const c = new MatchController({
      matchId: 't',
      mode: 'local_ai',
      players: [players[0], { ...players[1], isBot: true }],
      humanSides: ['L'],
      ai: { side: 'R', profile, client: syncAI() },
      sim,
      seed: 11,
      clock,
    });
    let botShots = 0;
    c.bus.on('playShot', (p) => {
      if (p.side === 'R') botShots++;
      clock.setTimeout(() => c.completeShot(), 10); // the scene would animate here
    });
    c.start();
    if (c.current.turn.side === 'L') {
      c.requestShot(0, 0, 0.5);
      await clock.advance(20);
    }
    expect(c.getSnapshot().thinkingSide).toBe('R');
    await clock.advance(profile.thinkTimeMs - 100);
    expect(botShots).toBe(0);
    await clock.advance(200);
    expect(botShots).toBe(1);
    expect(c.current.turn.side).toBe('L');
  });

  it('forfeit ends the match and stops timers', async () => {
    const clock = new FakeClock();
    const c = new MatchController({
      matchId: 't',
      mode: 'local_pvp',
      players: [players[0], players[1]],
      humanSides: ['L', 'R'],
      sim,
      seed: 1,
      clock,
    });
    let ended = 0;
    c.bus.on('ended', () => ended++);
    c.start();
    c.forfeit('L');
    expect(c.current.result).toEqual({ winner: 'R', reason: 'forfeit_quit' });
    await clock.advance(rulesConfig.turnTimeMs * 5);
    expect(ended).toBe(1);
  });
});
