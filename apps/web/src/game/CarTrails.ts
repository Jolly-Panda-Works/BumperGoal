import * as THREE from 'three';
import { cosmetics } from '@flickkick/config';

interface Segment {
  born: number;
  color: THREE.Color;
  alpha: number;
}

/** Bounded, purely visual ribbons; one draw call for every equipped car. */
export class CarTrails {
  static readonly lifetime = 650;
  private readonly capacity = 768;
  private positions = new Float32Array(this.capacity * 18);
  private colors = new Float32Array(this.capacity * 24);
  private geometry = new THREE.BufferGeometry();
  private material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  private mesh = new THREE.Mesh(this.geometry, this.material);
  private segments: (Segment | undefined)[] = [];
  private previous = new Map<number, THREE.Vector3>();
  private cursor = 0;
  private emitted = 0;

  constructor(private scene: THREE.Scene) {
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.scene.add(this.mesh);
  }

  get emittedCount() {
    return this.emitted;
  }
  get activeCount() {
    return this.segments.filter(Boolean).length;
  }

  sample(
    index: number,
    position: THREE.Vector3,
    movement: THREE.Vector3,
    deltaMs: number,
    now: number,
    trailId: string | undefined,
  ): void {
    const trail = cosmetics.trails.find((item) => item.id === trailId);
    const speed = (movement.length() * 1000) / Math.max(1, deltaMs);
    if (!trail || speed < 0.8 || deltaMs > 100 || movement.length() > 2) {
      this.previous.delete(index);
      return;
    }
    const direction = movement.clone().normalize();
    const rear = position.clone().addScaledVector(direction, -0.58);
    const old = this.previous.get(index);
    this.previous.set(index, rear);
    if (!old || old.distanceToSquared(rear) > 4) return;
    const normal = new THREE.Vector3(-direction.z, 0, direction.x);
    const strength = Math.min(1, speed / 9);
    const width = 0.1 + strength * 0.25;
    const palette = trail.colors;
    if (trail.pattern === 'dash' && Math.floor(now / 55) % 2) return;
    const lanes = trail.pattern === 'twin' ? 2 : trail.pattern === 'ribbon' ? palette.length : 1;
    for (let lane = 0; lane < lanes; lane++) {
      const offset = trail.pattern === 'twin' ? (lane ? 0.23 : -0.23) : ((lane - (lanes - 1) / 2) * width) / lanes;
      this.quad(old, rear, normal, offset, width / lanes, palette[lane % palette.length]!, now, 0.5 + strength * 0.45);
    }
    if (trail.pattern === 'spark') {
      const offset = Math.sin(now * 0.12 + index) * 0.24;
      const center = rear.clone().addScaledVector(normal, offset);
      this.quad(
        center.clone().addScaledVector(direction, -0.13),
        center.clone().addScaledVector(direction, 0.13),
        normal,
        0,
        0.075,
        palette[1 % palette.length]!,
        now,
        0.95,
      );
    }
  }

  private quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    normal: THREE.Vector3,
    offset: number,
    width: number,
    hex: string,
    now: number,
    alpha: number,
  ): void {
    const slot = this.cursor++ % this.capacity;
    const corners = [
      a.clone().addScaledVector(normal, offset - width / 2),
      a.clone().addScaledVector(normal, offset + width / 2),
      b.clone().addScaledVector(normal, offset + width / 2),
      b.clone().addScaledVector(normal, offset - width / 2),
    ];
    for (const [vertex, corner] of [0, 1, 2, 0, 2, 3].entries()) {
      const p = corners[corner]!;
      this.positions.set([p.x, 0.14, p.z], slot * 18 + vertex * 3);
    }
    this.segments[slot] = { born: now, color: new THREE.Color(hex), alpha };
    this.emitted++;
    this.geometry.attributes.position!.needsUpdate = true;
  }

  update(now: number, reducedMotion = false): void {
    if (reducedMotion) {
      this.clear();
      return;
    }
    this.segments.forEach((segment, slot) => {
      if (!segment) return;
      const fade = Math.max(0, 1 - (now - segment.born) / CarTrails.lifetime);
      for (let vertex = 0; vertex < 6; vertex++)
        this.colors.set(
          [segment.color.r, segment.color.g, segment.color.b, segment.alpha * fade * fade],
          slot * 24 + vertex * 4,
        );
      if (!fade) this.segments[slot] = undefined;
    });
    this.geometry.attributes.color!.needsUpdate = true;
  }

  resetMotion(): void {
    this.previous.clear();
  }
  clear(): void {
    this.resetMotion();
    this.segments.length = 0;
    this.colors.fill(0);
    this.geometry.attributes.color!.needsUpdate = true;
  }
  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
