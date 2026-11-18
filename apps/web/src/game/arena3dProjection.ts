export const FIELD_WIDTH_SCALE = 0.82;
/** Model +Z, the aim arrow and physics all share this forward heading. */
export function carHeading(angle: number, orientation: number) {
  return Math.PI - angle + (orientation === -1 ? Math.PI : 0);
}
export function arenaPosition(x: number, y: number, orientation: number) {
  return { x: y * orientation * FIELD_WIDTH_SCALE, z: -x * orientation };
}
export function shotFromGround(
  origin: { x: number; z: number },
  point: { x: number; z: number },
  orientation: number,
  sensitivity: number,
) {
  const dx = (origin.z - point.z) * orientation;
  const dy = ((point.x - origin.x) * orientation) / FIELD_WIDTH_SCALE;
  const distance = Math.hypot(dx, dy);
  return { angle: Math.atan2(-dy, -dx), power: distance < 0.15 ? 0 : Math.min(1, (distance * sensitivity) / 2.6) };
}
