import * as THREE from 'three';

export interface CarDriveRig {
  root: THREE.Group;
  wheels: { pivot: THREE.Group; radius: number }[];
  flame: THREE.Group;
}

/** Normalized GLBs have baked vertices: restore a pivot at each wheel's centre. */
export function wheelPivots(model: THREE.Object3D): CarDriveRig['wheels'] {
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && /wheel/i.test(object.name)) meshes.push(object);
  });
  return meshes.map((mesh) => {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const centre = box.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = `${mesh.name}_axle`;
    pivot.position.copy(mesh.position).add(centre);
    mesh.parent!.add(pivot);
    pivot.add(mesh);
    mesh.position.copy(centre).negate();
    return { pivot, radius: Math.max(0.07, box.getSize(new THREE.Vector3()).y / 2) };
  });
}

export function fullPowerNitro(ix: number, iy: number, maxImpulse: number): boolean {
  return maxImpulse > 0 && Math.hypot(ix, iy) >= maxImpulse * 0.97;
}

export class CarDriveEffects {
  private smoke: { sprite: THREE.Sprite; born: number; active: boolean; velocity: THREE.Vector3 }[] = [];
  private texture: THREE.DataTexture;
  private lastPuff = new Map<number, number>();
  private cursor = 0;
  smokeCount = 0;
  nitroCount = 0;
  wheelTurns = 0;

  constructor(private scene: THREE.Scene) {
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const offset = (y * 32 + x) * 4;
        const alpha = Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 15.5);
        pixels.set([220, 230, 240, Math.round(alpha * alpha * 255)], offset);
      }
    this.texture = new THREE.DataTexture(pixels, 32, 32);
    this.texture.needsUpdate = true;
    for (let i = 0; i < 64; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.texture,
          transparent: true,
          depthWrite: false,
          opacity: 0,
          toneMapped: false,
        }),
      );
      sprite.visible = false;
      this.scene.add(sprite);
      this.smoke.push({ sprite, born: 0, active: false, velocity: new THREE.Vector3() });
    }
  }

  rig(root: THREE.Group): CarDriveRig {
    const flame = new THREE.Group();
    flame.name = 'nitro-exhaust';
    for (const x of [-0.22, 0.22]) {
      for (const core of [false, true]) {
        const mesh = new THREE.Mesh(
          new THREE.ConeGeometry(core ? 0.055 : 0.13, 1, 10),
          new THREE.MeshBasicMaterial({
            color: core ? 0xeaffff : 0x20baff,
            transparent: true,
            opacity: core ? 1 : 0.85,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0.19, core ? -0.88 : -0.99);
        mesh.scale.y = core ? 0.3 : 0.55;
        flame.add(mesh);
      }
    }
    flame.visible = false;
    root.add(flame);
    return { root, wheels: [], flame };
  }

  sample(
    index: number,
    rig: CarDriveRig,
    movement: THREE.Vector3,
    delta: number,
    now: number,
    moving: boolean,
    nitro: boolean,
    reducedMotion: boolean,
    lowQuality: boolean,
  ): void {
    const distance = movement.length();
    const speed = (distance * 1000) / Math.max(1, delta);
    const active = moving && !reducedMotion && speed > 0.05 && distance < 2;
    rig.flame.visible = active && nitro && speed > 1.8;
    if (!active) return;
    const forward = rig.root.getWorldDirection(new THREE.Vector3());
    const direction = movement.dot(forward) < 0 ? -1 : 1;
    for (const wheel of rig.wheels) wheel.pivot.rotation.x += (direction * distance) / wheel.radius;
    if (rig.wheels.length) this.wheelTurns++;
    if (rig.flame.visible) {
      rig.flame.scale.z = 0.9 + Math.sin(now * 0.07) * 0.12;
      this.nitroCount++;
    }
    if (speed < 0.4 || now - (this.lastPuff.get(index) ?? -Infinity) < (lowQuality ? 110 : 55)) return;
    this.lastPuff.set(index, now);
    rig.root.updateWorldMatrix(true, false);
    for (const x of [-0.22, 0.22]) {
      const puff = this.smoke[this.cursor++ % (lowQuality ? 24 : 64)]!;
      puff.sprite.position.copy(rig.root.localToWorld(new THREE.Vector3(x, 0.17, -0.73)));
      puff.velocity.copy(forward).multiplyScalar(-0.4).y = 0.35;
      puff.born = now;
      puff.active = true;
      puff.sprite.visible = true;
      puff.sprite.material.color.setHex(rig.flame.visible ? 0xa0e7ff : 0xc9d1da);
      this.smokeCount++;
    }
  }

  update(now: number, delta: number, reducedMotion: boolean): void {
    for (const puff of this.smoke) {
      if (!puff.active) continue;
      const age = (now - puff.born) / 1000;
      if (age >= 0.7 || reducedMotion) {
        puff.active = false;
        puff.sprite.visible = false;
        continue;
      }
      puff.sprite.position.addScaledVector(puff.velocity, delta / 1000);
      puff.sprite.scale.setScalar(0.18 + age * 0.8);
      puff.sprite.material.opacity = 0.65 * (1 - age / 0.7);
    }
  }

  clear(): void {
    this.lastPuff.clear();
    for (const puff of this.smoke) {
      puff.active = false;
      puff.sprite.visible = false;
    }
  }
  dispose(): void {
    for (const puff of this.smoke) {
      this.scene.remove(puff.sprite);
      puff.sprite.material.dispose();
    }
    this.texture.dispose();
  }
}
