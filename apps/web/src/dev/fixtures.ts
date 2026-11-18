import { cosmetics, rulesConfig } from '@flickkick/config';
import { createMatch } from '@flickkick/rules';
import { createMatchStatistics } from '../game/matchStatistics';
import { defaultProfile, profileStore } from '../services/localProfile';
import { localInventory } from '../services/localInventory';
import { matchSession, type MatchOutcome } from '../services/matchSession';

export function resultFixture(won: boolean, online = false): MatchOutcome {
  const state = createMatch({
    matchId: 'dev-preview-match',
    mode: 'local_ai',
    rngSeed: 42,
    rules: rulesConfig,
    players: [
      { id: 'preview-player', displayName: 'Crafted', level: 8, teamId: 'team_volt', isBot: false },
      { id: 'preview-bot', displayName: 'FlickBot', level: 8, teamId: 'team_coral', isBot: true },
    ],
  });
  state.phase = 'ENDED';
  state.score = won ? { L: 2, R: 1 } : { L: 1, R: 2 };
  state.result = { winner: won ? 'L' : 'R', reason: 'goals' };
  const statistics = createMatchStatistics();
  statistics.durationMs = 125000;
  statistics.sides.L = {
    shots: 8,
    scoringShots: won ? 2 : 1,
    ownGoals: 0,
    timeouts: 0,
    powerTotal: 520,
    simulationTicks: 900,
  };
  statistics.sides.R = {
    shots: 7,
    scoringShots: won ? 1 : 2,
    ownGoals: 0,
    timeouts: 0,
    powerTotal: 420,
    simulationTicks: 800,
  };
  return {
    state,
    statistics,
    side: 'L',
    setup: { mode: online ? 'online' : 'local_ai', arena: 'park', aiProfileId: 'rookie' },
    rewards: {
      xp: won ? 100 : 50,
      coins: won ? 200 : 0,
      gems: won ? 5 : 0,
      prize: won ? 200 : 0,
      entryFee: 100,
      levelBefore: 7,
      levelAfter: won ? 8 : 7,
    },
  };
}

/** Storage is namespaced by mode; these fixtures never overwrite a real profile. */
export function seedScreens() {
  const outcome = resultFixture(false);
  profileStore.set({
    ...defaultProfile(),
    welcomed: true,
    tutorialDone: true,
    displayName: 'Crafted',
    knownLevel: 8,
    knownXP: 5000,
    practice: { played: 12, won: 7, lost: 5, goalsFor: 22, goalsAgainst: 16 },
    history: [
      {
        id: outcome.state.matchId,
        endedAt: Date.now(),
        mode: 'local_ai',
        opponentName: 'FlickBot',
        opponentIsBot: true,
        aiProfile: 'rookie',
        scoreFor: 1,
        scoreAgainst: 2,
        won: false,
        reason: 'goals',
        playerName: 'Crafted',
        playerSide: 'L',
        teamId: 'team_volt',
        opponentTeamId: 'team_coral',
        statistics: outcome.statistics,
      },
    ],
  });
  localInventory.set({ coins: 25000, gems: 500, owned: [], packs: [], dailyIndex: 2, lastDaily: undefined });
  matchSession.setSetup({
    mode: 'local_pvp',
    names: ['Crafted', 'Player 2'],
    teams: ['team_volt', 'team_coral'],
    arena: 'park',
  });
  matchSession.setOutcome(outcome);
  // Ensure the default avatar remains an actual shipped item when art data changes.
  if (!cosmetics.avatars.some((avatar) => avatar.id === profileStore.get().avatarId))
    profileStore.set({ avatarId: cosmetics.avatars[0]!.id });
}
