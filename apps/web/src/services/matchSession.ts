// Hands match setup from a setup screen to the match screen, and the outcome
// from the match to the result screen, without putting data in URLs.
import type { MatchStatistics } from '../game/matchStatistics';
import type { AIProfile } from '@flickkick/config';
import type { MatchState, Side } from '@flickkick/rules';
import type { OnlineRewards } from '../game/OnlineMatchController';
import { streamMatchAssets } from './assetLoading';
import { profileStore } from './localProfile';

export interface MatchSetup {
  /** Private, unranked server match joined through an invitation. */
  friendMatch?: boolean;
  localFriend?: boolean;
  localBot?: boolean;
  opponentAvatarId?: string;
  mode: 'local_ai' | 'local_pvp' | 'tutorial' | 'online';
  /** Online: the authoritative Nakama match to join. */
  matchId?: string;
  arena?: string;
  aiProfileId?: AIProfile['id'];
  /** True when the player kept the level-matched difficulty. */
  levelMatched?: boolean;
  names?: [string, string];
  teams?: [string, string];
}

export interface MatchOutcome {
  statistics?: MatchStatistics;
  setup: MatchSetup;
  state: MatchState;
  /** The local player's side (always L offline; either side online). */
  side: Side;
  /** Online only: rewards granted by the server. */
  rewards?: OnlineRewards | null;
}

let pendingSetup: MatchSetup | null = null;
let lastOutcome: MatchOutcome | null = null;

export const matchSession = {
  setSetup(setup: MatchSetup): void {
    pendingSetup = setup;
    const { avatarId, ballId } = profileStore.get();
    streamMatchAssets(setup.arena, setup.teams ?? [], ballId, [avatarId, setup.opponentAvatarId ?? 'bot']);
  },
  getSetup(): MatchSetup | null {
    return pendingSetup;
  },
  setOutcome(outcome: MatchOutcome): void {
    lastOutcome = outcome;
  },
  getOutcome(): MatchOutcome | null {
    return lastOutcome;
  },
};
