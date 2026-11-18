import * as THREE from 'three';

export type CollisionKind = 'car' | 'ball' | 'wall';
export interface ImpactStyle {
  quality: 'low' | 'high';
  reducedMotion: boolean;
}
interface Burst {
  group: THREE.Group;
  flash: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  dust: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  sparks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[];
  start: number;
  strength: number;
  count: number;
  phase: number;
}

/** Bounded, presentation-only collision feedback. No simulation bodies are changed. */
export class ImpactEffects {
  private root = new THREE.Group();
  private bursts: Burst[] = [];
  private jolts = new Map<number, { start: number; strength: number }>();
  private shakeStart = -Infinity;
  private shakeStrength = 0;
  private offset = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 0.11 : 0.39;
      if (i === 0) shape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    const star = new THREE.ShapeGeometry(shape);
    const ring = new THREE.RingGeometry(0.87, 1, 32);
    const chip = new THREE.BoxGeometry(0.15, 0.035, 0.035);
    const dust = new THREE.SphereGeometry(0.26, 8, 6);
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const light = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const flashMaterial = light();
      flashMaterial.blending = THREE.AdditiveBlending;
      flashMaterial.depthTest = false;
      const flash = new THREE.Mesh(star, flashMaterial);
      flash.renderOrder = 30;
      flash.position.y = 0.26;
      const wave = new THREE.Mesh(ring, light());
      wave.rotation.x = -Math.PI / 2;
      wave.position.y = 0.035;
      const puff = new THREE.Mesh(dust, light());
      puff.position.y = 0.14;
      const sparkMaterial = light();
      sparkMaterial.blending = THREE.AdditiveBlending;
      const sparks = Array.from({ length: 8 }, () => new THREE.Mesh(chip, sparkMaterial));
      group.add(flash, wave, puff, ...sparks);
      this.root.add(group);
      this.bursts.push({
        group,
        flash,
        ring: wave,
        dust: puff,
        sparks,
        start: -Infinity,
        strength: 0,
        count: 8,
        phase: 0,
      });
    }
    scene.add(this.root);
  }

  get activeCount() {
    return this.bursts.filter((burst) => burst.group.visible).length;
  }

  emit(
    point: THREE.Vector3,
    kind: CollisionKind,
    strength: number,
    now: number,
    style: ImpactStyle,
    bodies: number[],
  ): boolean {
    if (style.reducedMotion || !Number.isFinite(strength) || strength <= 0) return false;
    const s = Math.min(1, strength);
    if (this.bursts.some((burst) => now - burst.start < 75 && burst.group.position.distanceToSquared(point) < 0.36))
      return false;
    const pool = style.quality === 'low' ? this.bursts.slice(0, 4) : this.bursts;
    const burst =
      pool.find((item) => !item.group.visible) ??
      pool.reduce((oldest, item) => (item.start < oldest.start ? item : oldest));
    burst.group.visible = true;
    burst.group.position.copy(point);
    burst.group.position.y = 0;
    burst.start = now;
    burst.strength = s;
    burst.count = style.quality === 'low' ? 3 : 8;
    burst.phase = ((now % 100) / 100) * Math.PI;
    const color = kind === 'ball' ? 0x73e8ff : kind === 'wall' ? 0xff9048 : 0xffd34b;
    burst.ring.material.color.setHex(color);
    burst.flash.material.color.setHex(0xfff4c7);
    burst.sparks[0]!.material.color.setHex(color);
    burst.dust.material.color.setHex(kind === 'wall' ? 0xe1c59c : 0xc7d89c);
    burst.dust.visible = style.quality === 'high';
    for (const index of bodies) this.jolts.set(index, { start: now, strength: s });
    if (style.quality === 'high' && s > 0.3) {
      this.shakeStrength = now - this.shakeStart < 80 ? Math.max(this.shakeStrength, s) : s;
      this.shakeStart = now;
    }
    return true;
  }

  update(now: number, camera: THREE.Camera, reducedMotion: boolean): void {
    if (reducedMotion) {
      this.clear();
      return;
    }
    for (const burst of this.bursts) {
      if (!burst.group.visible) continue;
      const age = (now - burst.start) / 1000;
      if (age >= 0.44) {
        burst.group.visible = false;
        continue;
      }
      const fade = Math.max(0, 1 - age / 0.44);
      burst.flash.quaternion.copy(camera.quaternion);
      burst.flash.scale.setScalar((0.65 + burst.strength * 0.8) * Math.max(0, 1 - age / 0.095));
      burst.flash.material.opacity = Math.max(0, 1 - age / 0.095);
      burst.ring.scale.setScalar(0.16 + age * (2 + burst.strength * 2.4));
      burst.ring.material.opacity = Math.max(0, 0.8 - age * 2.7);
      burst.dust.scale.setScalar(0.45 + age * (2.2 + burst.strength));
      burst.dust.material.opacity = fade * 0.21 * burst.strength;
      burst.sparks[0]!.material.opacity = fade;
      burst.sparks.forEach((spark, index) => {
        spark.visible = index < burst.count;
        const angle = (index / burst.count) * Math.PI * 2 + burst.phase;
        const speed = (1.2 + burst.strength * 3) * (0.7 + (index % 3) * 0.16);
        spark.position.set(
          Math.cos(angle) * speed * age,
          Math.max(0.04, 0.18 + (1.3 + burst.strength) * age - 5 * age * age),
          Math.sin(angle) * speed * age,
        );
        spark.rotation.set(angle * 0.4, -angle, angle);
        spark.scale.set(1 + burst.strength, fade, fade);
      });
    }
    for (const [index, jolt] of this.jolts) if (now - jolt.start > 420) this.jolts.delete(index);
  }

  applyChassis(index: number, chassis: THREE.Group, now: number, reducedMotion: boolean): void {
    chassis.position.set(0, 0, 0);
    chassis.rotation.set(0, 0, 0);
    chassis.scale.set(1, 1, 1);
    const jolt = this.jolts.get(index);
    if (!jolt || reducedMotion) return;
    const age = (now - jolt.start) / 1000;
    if (age > 0.42) return;
    const decay = Math.exp(-age * 11) * jolt.strength;
    chassis.position.y = Math.abs(Math.sin(age * 32)) * decay * 0.09;
    chassis.scale.y = 1 - decay * 0.06;
    chassis.scale.z = 1;
  }

  cameraOffset(now: number, camera: THREE.Camera): THREE.Vector3 {
    const age = now - this.shakeStart;
    if (age > 190 || age < 0) return this.offset.set(0, 0, 0);
    const amplitude = Math.pow(1 - age / 190, 2) * this.shakeStrength * 0.095;
    return this.offset
      .set(Math.sin(age * 0.15) * amplitude, Math.cos(age * 0.19) * amplitude * 0.65, 0)
      .applyQuaternion(camera.quaternion);
  }

  clear(): void {
    this.bursts.forEach((burst) => {
      burst.group.visible = false;
      burst.start = -Infinity;
    });
    this.jolts.clear();
    this.shakeStrength = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        materials.add(object.material as THREE.Material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.clear();
  }
}
