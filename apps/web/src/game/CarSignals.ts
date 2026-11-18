import * as THREE from 'three';

/** Presentation-only random choice, stable for both clients and independent of physics RNG. */
export function nightForMatch(seed: number, matchId: string): boolean {
  // Match IDs survive reconnects even if the gameplay RNG has already advanced.
  let hash = ((matchId ? 0 : seed) ^ 2166136261) >>> 0;
  for (const letter of matchId) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) % 4 === 0;
}

export interface SignalRig {
  indicators: THREE.Group;
  headlights: THREE.Group;
  beam: THREE.Mesh;
  light: THREE.SpotLight;
  flashUntil: number;
}

/** Local +Z is the car's nose; every lamp and target turns with its heading. */
export class CarSignals {
  private rigs = new Map<number, SignalRig>();
  private lastHorn = -Infinity;
  headlightCount = 0;
  flashingCount = 0;
  hornCount = 0;

  constructor(private night: boolean) {}

  attach(index: number, root: THREE.Group): SignalRig {
    const indicators = new THREE.Group();
    indicators.name = 'collision-hazard-lights';
    for (const x of [-0.38, 0.38])
      for (const z of [-0.66, 0.66]) {
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.065, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffad18, toneMapped: false }),
        );
        lamp.position.set(x, 0.28, z);
        indicators.add(lamp);
      }
    indicators.visible = false;
    root.add(indicators);
    const headlights = new THREE.Group();
    headlights.name = 'moving-headlights';
    for (const x of [-0.25, 0.25]) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff6d2, toneMapped: false }),
      );
      lamp.position.set(x, 0.3, 0.7);
      headlights.add(lamp);
    }
    headlights.visible = false;
    root.add(headlights);
    const light = new THREE.SpotLight(0xfff2c1, 0, 5.5, Math.PI / 7, 0.65, 1);
    light.position.set(0, 0.36, 0.68);
    light.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set(0, 0, 4.5);
    root.add(target);
    light.target = target;
    root.add(light);
    // A translucent footprint keeps the beam readable on low graphics too.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-0.18, 0.035, 0.72, 0.18, 0.035, 0.72, 1.1, 0.035, 4.3, -0.18, 0.035, 0.72, 1.1, 0.035, 4.3, -1.1, 0.035, 4.3],
        3,
      ),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute([0.75, 0.7, 0.4, 0.75, 0.7, 0.4, 0, 0, 0, 0.75, 0.7, 0.4, 0, 0, 0, 0, 0, 0], 3),
    );
    const beam = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    beam.name = 'headlight-ground-beam';
    beam.visible = false;
    root.add(beam);
    const rig = { indicators, headlights, beam, light, flashUntil: -Infinity };
    this.rigs.set(index, rig);
    return rig;
  }

  collision(indices: readonly number[], now: number): boolean {
    if (indices.length !== 2 || indices[0] === indices[1] || indices.some((index) => !this.rigs.has(index)))
      return false;
    for (const index of indices) this.rigs.get(index)!.flashUntil = now + 1800;
    if (now - this.lastHorn < 450) return false;
    this.lastHorn = now;
    this.hornCount++;
    return true;
  }

  sample(index: number, moving: boolean, now: number, reducedMotion: boolean): void {
    const rig = this.rigs.get(index);
    if (!rig) return;
    rig.indicators.visible = now < rig.flashUntil && (reducedMotion || Math.floor(now / 240) % 2 === 0);
    const lit = this.night && moving;
    rig.headlights.visible = lit;
    rig.beam.visible = lit;
    rig.light.intensity = lit ? 12 : 0;
  }

  updateCounts(): void {
    this.headlightCount = 0;
    this.flashingCount = 0;
    for (const rig of this.rigs.values()) {
      if (rig.headlights.visible) this.headlightCount++;
      if (rig.indicators.visible) this.flashingCount++;
    }
  }

  clear(): void {
    for (const rig of this.rigs.values()) {
      rig.flashUntil = -Infinity;
      rig.indicators.visible = false;
      rig.headlights.visible = false;
      rig.beam.visible = false;
      rig.light.intensity = 0;
    }
    this.lastHorn = -Infinity;
    this.updateCounts();
  }
}
