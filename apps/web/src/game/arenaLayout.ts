export type ArenaLayout = 'portrait' | 'landscape';
export function preferredArenaLayout(width: number, phone = false): ArenaLayout {
  return phone || width < 700 ? 'portrait' : 'landscape';
}
