import { aiProfiles, type AIProfile } from '@flickkick/config';

/**
 * DifficultyProfile: player level → AI profile. Step mapping, documented in
 * docs/PRODUCT_SPEC.md §6. Level is the only input in Phase 1.
 */
export function profileForLevel(level: number, profiles: readonly AIProfile[] = aiProfiles): AIProfile {
  const sorted = [...profiles].sort((a, b) => a.minLevel - b.minLevel);
  let chosen = sorted[0];
  if (!chosen) throw new Error('no AI profiles configured');
  for (const p of sorted) if (level >= p.minLevel) chosen = p;
  return chosen;
}

export function profileById(id: AIProfile['id'], profiles: readonly AIProfile[] = aiProfiles): AIProfile {
  const p = profiles.find((x) => x.id === id);
  if (!p) throw new Error(`unknown AI profile ${id}`);
  return p;
}
