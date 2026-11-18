import { type PerspectiveCamera, Vector3 } from 'three';
import { FIELD_WIDTH_SCALE } from './arena3dProjection';

/** Fixed oblique camera, fitted to the whole playable arena on any viewport. */
export function fitArenaCamera(camera: PerspectiveCamera, width: number, height: number, halfLength: number) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const target = new Vector3(0, 0, 0.85);
  const direction = new Vector3(0, 1.7, 1).normalize();
  let distance = 18;
  for (let step = 0; step < 70; step++) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let fits = true;
    for (const x of [-4.62, 4.62])
      for (const z of [-(halfLength + 0.85), halfLength + 0.85])
        for (const y of [0, 1.2]) {
          const p = new Vector3(x * FIELD_WIDTH_SCALE, y, z).project(camera);
          if (Math.abs(p.x) > 0.97 || p.y > 0.82 || p.y < -0.96) fits = false;
        }
    if (fits) break;
    distance *= 1.025;
  }
}
