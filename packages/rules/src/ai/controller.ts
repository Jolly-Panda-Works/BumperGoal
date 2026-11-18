// AIController: picks a shot for `side` with a bounded simulation budget.
//
// The AI only uses information a human player has (the current board) and the
// real physics to predict its own candidate shots. Execution error is applied
// after the decision, so a weaker profile both searches less and executes worse.
// Decisions are deterministic for a given (state, profile, seed); the budget is
// a simulation count, not wall-clock time, so results never depend on CPU speed.
import type { AIProfile, PhysicsConfig } from '@flickkick/config';
import type { FlickSim } from '@flickkick/sim';
import { ballIndex, discIndicesOf, validateShot } from '../match';
import { Rng, mixSeed } from '../rng';
import { otherSide, type MatchState, type Shot, type Side } from '../types';
import { generateCandidates, type Candidate } from './candidates';
import { evaluateOutcome, GOAL_SCORE } from './evaluator';
import { attackGoal, norm, rotate, sub } from './geometry';

export interface AIDecision {
  shot: Shot;
  /** The intended (noise-free) choice, for debugging and tests. */
  intended: Candidate;
  expectedScore: number;
  simulations: number;
  candidatesEvaluated: number;
}

const LOOKAHEAD_TOP = 4;
const LOOKAHEAD_REPLIES = 2; // powers per opponent disc

/** PhysicsPredictionAdapter: candidate → impulse → simulated outcome. */
function toImpulse(c: Candidate, physics: PhysicsConfig): { ix: number; iy: number } {
  const magnitude = Math.max(physics.minImpulse, c.power * physics.maxImpulse);
  return { ix: Math.fround(c.dir.x * magnitude), iy: Math.fround(c.dir.y * magnitude) };
}

export function decideShot(
  state: MatchState,
  side: Side,
  profile: AIProfile,
  sim: FlickSim,
  seed: number,
  physicsOverride?: PhysicsConfig,
): AIDecision {
  const physics = physicsOverride ?? sim.config;
  const reserve = profile.lookAhead ? LOOKAHEAD_TOP * state.discsPerTeam * LOOKAHEAD_REPLIES : 0;
  const candidates = generateCandidates(state, side, profile, physics, profile.maxSimulations - reserve);

  let simulations = 0;
  const scored = candidates.map((c) => {
    const { ix, iy } = toImpulse(c, physics);
    const result = sim.simulateShot(state.bodies, { bodyIndex: c.discIndex, ix, iy });
    simulations++;
    return { c, result, score: evaluateOutcome(state, side, result, profile, physics) };
  });
  scored.sort((a, b) => b.score - a.score || b.c.prior - a.c.prior);

  // Look-ahead: penalise shots that leave the opponent an easy goal.
  if (profile.lookAhead) {
    const opp = otherSide(side);
    for (const entry of scored.slice(0, LOOKAHEAD_TOP)) {
      if (entry.score >= GOAL_SCORE || entry.result.outcome !== 'settled') continue;
      const after = { ...state, bodies: entry.result.bodies };
      const ball = after.bodies[ballIndex(after)]!;
      const target = attackGoal(opp, physics);
      let worst = 0;
      for (const i of discIndicesOf(after, opp)) {
        const disc = after.bodies[i]!;
        const u = norm(sub(target, ball));
        const rr = physics.disc.radius + physics.ball.radius;
        const dir = norm(sub({ x: ball.x - u.x * rr, y: ball.y - u.y * rr }, disc));
        for (const power of [0.7, 1.0].slice(0, LOOKAHEAD_REPLIES)) {
          const m = power * physics.maxImpulse;
          const reply = sim.simulateShot(after.bodies, {
            bodyIndex: i,
            ix: Math.fround(dir.x * m),
            iy: Math.fround(dir.y * m),
          });
          simulations++;
          const conceded = (side === 'L' ? 'goal_left' : 'goal_right') === reply.outcome;
          if (conceded) worst = Math.max(worst, GOAL_SCORE * 0.6);
        }
      }
      entry.score -= worst;
    }
    scored.sort((a, b) => b.score - a.score || b.c.prior - a.c.prior);
  }

  const best = scored[0];
  if (!best) throw new Error('AI produced no candidates');

  // Execution error, seeded per turn.
  const rng = new Rng(mixSeed(seed, state.turn.index));
  const aimError = rng.gaussian() * profile.aimErrorDeg * (Math.PI / 180);
  const powerScale = 1 + rng.gaussian() * profile.powerError;
  const dir = rotate(best.c.dir, aimError);
  const magnitude = Math.min(
    physics.maxImpulse,
    Math.max(physics.minImpulse, best.c.power * powerScale * physics.maxImpulse),
  );
  const shot: Shot = {
    seq: state.turn.seq,
    discIndex: best.c.discIndex,
    ix: Math.fround(dir.x * magnitude),
    iy: Math.fround(dir.y * magnitude),
  };

  // AIActionValidator: the AI goes through the same validation as players.
  const check = validateShot(state, side, shot, physics);
  if (!check.ok) throw new Error(`AI generated an invalid shot: ${check.reason}`);

  return { shot, intended: best.c, expectedScore: best.score, simulations, candidatesEvaluated: scored.length };
}
