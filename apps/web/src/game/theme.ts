// Board palette: markings, aim and highlight colours, plus the procedural
// placeholders the scene draws when a texture from ./art is missing.
import { cosmetics, type BallDef, type TeamDef } from '@flickkick/config';

export const BOARD = {
  width: 1280,
  height: 720,
  pxPerUnit: 66,
  background: 0x0b1226,
  pitchDark: 0x1f7a3e,
  pitchLight: 0x26914a,
  line: 0xeaf7ee,
  wall: 0x0e1630,
  wallEdge: 0x3c4a7a,
  net: 0xdfe7ff,
  aimLow: 0xc6ff3d,
  aimHigh: 0xff5a5f,
  highlight: 0xc6ff3d,
};

export const hex = (color: string): number => Number.parseInt(color.replace('#', ''), 16);

export function teamDef(id: string): TeamDef {
  return cosmetics.teams.find((t) => t.id === id) ?? cosmetics.teams[0]!;
}

export function ballDef(id: string): BallDef {
  return cosmetics.balls.find((b) => b.id === id) ?? cosmetics.balls[0]!;
}

/** If both teams look alike, the right side swaps to a contrasting default. */
export function resolveTeams(left: string, right: string): [TeamDef, TeamDef] {
  const l = teamDef(left);
  let r = teamDef(right);
  if (r.id === l.id || r.primary.toLowerCase() === l.primary.toLowerCase()) {
    r = cosmetics.teams.find((t) => t.id !== l.id && t.primary.toLowerCase() !== l.primary.toLowerCase())!;
  }
  return [l, r];
}
