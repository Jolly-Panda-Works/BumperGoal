import { physicsConfig } from '@flickkick/config';
import { FlickSim, initPhysics } from '@flickkick/sim';

/** Loads Rapier once per page; safe to call repeatedly. */
export const loadPhysics = initPhysics;

export function createSim(): Promise<FlickSim> {
  return FlickSim.create(physicsConfig);
}
