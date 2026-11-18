import type { BodyState } from '@flickkick/sim';

export const PROTOCOL_VERSION = 1;

/** L defends the goal at x < 0 and attacks the goal at x > 0; R the opposite. */
export type Side = 'L' | 'R';

export type MatchMode = 'online' | 'online_bot' | 'local_ai' | 'local_pvp' | 'tutorial';

export interface PlayerInfo {
  id: string;
  displayName: string;
  level: number;
  teamId: string;
  isBot: boolean;
  side: Side;
}

export type MatchPhase = 'AWAIT_SHOT' | 'SIMULATING' | 'ENDED';

export type EndReason = 'goals' | 'max_shots' | 'forfeit_timeouts' | 'forfeit_quit' | 'forfeit_disconnect';

export interface MatchResult {
  winner: Side;
  reason: EndReason;
}

/** A shot command. ix/iy are f32 impulse components; seq prevents replays. */
export interface Shot {
  seq: number;
  discIndex: number;
  ix: number;
  iy: number;
}

export interface MatchState {
  protocolVersion: number;
  simVersion: number;
  matchId: string;
  mode: MatchMode;
  /** Index 0 plays side L, index 1 plays side R. */
  players: [PlayerInfo, PlayerInfo];
  phase: MatchPhase;
  turn: { index: number; side: Side; seq: number };
  /** Discs of L (0..n-1), discs of R (n..2n-1), ball last. Positions are f32. */
  bodies: BodyState[];
  discsPerTeam: number;
  score: Record<Side, number>;
  goalsToWin: number;
  shotCount: number;
  maxShots: number;
  suddenDeath: boolean;
  consecutiveTimeouts: Record<Side, number>;
  timeoutForfeitCount: number;
  rngSeed: number;
  result: MatchResult | null;
  stateHash: string;
}

export type MatchEvent =
  | { type: 'shot'; side: Side; shot: Shot }
  | { type: 'goal'; scorer: Side; ownGoal: boolean; score: Record<Side, number> }
  | { type: 'turn'; side: Side; index: number }
  | { type: 'timeout'; side: Side; consecutive: number }
  | { type: 'sudden_death' }
  | { type: 'invalid_simulation'; side: Side }
  | { type: 'ended'; result: MatchResult; score: Record<Side, number> };

export type ShotRejection =
  | 'match_ended'
  | 'not_awaiting_shot'
  | 'not_your_turn'
  | 'stale_seq'
  | 'invalid_disc'
  | 'not_your_disc'
  | 'non_finite'
  | 'power_out_of_range';

export const otherSide = (side: Side): Side => (side === 'L' ? 'R' : 'L');
