export const FIELD_WIDTH_SCALE = 0.82;
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
