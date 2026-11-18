import type { TFunction } from 'i18next';
import { arenasConfig } from '@flickkick/config';

/** Display name of an arena: built-in arenas are translated, panel-added ones carry their own names. */
export function arenaName(id: string, t: TFunction, lang: string): string {
  const names = arenasConfig.arenas.find((a) => a.id === id)?.names;
  if (names) return names[lang] ?? names.en ?? id;
  return t(`online.arenas.${id}`);
}
