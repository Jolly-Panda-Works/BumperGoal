import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original low-poly scenery in the warm stone / olive grass / blue-roof palette. */
export function cartoonSurroundings() {
  const group = new THREE.Group();
  const materials = new Map<number, THREE.MeshToonMaterial>();
  const material = (color: number) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshToonMaterial({ color }));
    return materials.get(color)!;
  };
  const block = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 180), material(0x6c9849));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.82;
  ground.receiveShadow = true;
  group.add(ground);
  // Courtyard and side canals surround the playable grass, rather than covering it.
  block(15.8, 0.22, 22.4, 0x929d83, 0, -0.67, 0);
  for (const side of [-1, 1]) {
    block(0.65, 0.04, 19.2, 0x4295bd, side * 5.85, -0.37, 0);
    block(0.11, 0.12, 19.4, 0xc0b486, side * 6.22, -0.3, 0);
    for (let i = 0; i < 16; i++) block(0.09, 0.012, 0.65, 0x85c9d3, side * 5.78, -0.34, -8.6 + i * 1.15);
    for (const z of [-4.8, 4.8]) {
      for (let plank = 0; plank < 5; plank++)
        block(1.25, 0.12, 0.16, plank % 2 ? 0xd6bc75 : 0xc4a968, side * 5.85, -0.18, z + plank * 0.18);
    }
    // Modular stone blocks and their lighter capstones read clearly on a phone.
    for (let step = 0; step < 25; step++) {
      const z = -9.7 + step * 0.8;
      block(0.52, 0.6, 0.77, step % 3 ? 0x77838a : 0x909990, side * 6.6, -0.16, z);
      block(0.61, 0.13, 0.81, 0xc9c4a1, side * 6.6, 0.21, z);
      if (step % 2 === 0) block(0.55, 0.27, 0.38, 0xb7b79f, side * 6.6, 0.39, z);
    }
    for (const z of [-9.8, 9.8]) {
      block(1.65, 0.25, 1.65, 0xbfa965, side * 6.6, -0.33, z);
      block(1.35, 1.45, 1.35, 0x899698, side * 6.6, 0.48, z);
      block(1.6, 0.22, 1.6, 0xd6ce9e, side * 6.6, 1.27, z);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.13, 0.86, 4), material(z < 0 ? 0x497cad : 0x5b89b2));
      roof.position.set(side * 6.6, 1.8, z);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
      block(0.07, 0.8, 0.07, 0xefd183, side * 6.6, 2.45, z);
      block(0.46, 0.29, 0.04, z < 0 ? 0x4c95c9 : 0xc95342, side * 6.6 + 0.21, 2.58, z);
      block(0.33, 0.47, 0.025, 0x334f64, side * 6.6, 0.61, z + 0.68);
    }
    for (let i = 0; i < 18; i++) {
      const z = -13 + i * 1.5;
      const x = side * (8 + (i % 3) * 1.2);
      block(0.2, 0.7, 0.2, 0x705b3c, x, -0.35, z);
      const crown = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.78 + (i % 3) * 0.13, 0),
        material([0x4d7f3c, 0x618f3a, 0x6a9a43][i % 3]!),
      );
      crown.position.set(x, 0.52, z);
      crown.scale.y = 1.2;
      crown.castShadow = true;
      group.add(crown);
      if (i % 2 === 0) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.37, 0), material(0x81918b));
        rock.position.set(side * 7.6, -0.5, z + 0.5);
        rock.scale.y = 0.65;
        group.add(rock);
      }
    }
  }
  for (const end of [-1, 1])
    for (let i = 0; i < 15; i++) {
      const x = -5.95 + i * 0.85;
      block(0.81, 0.62, 0.5, i % 2 ? 0x8d9793 : 0x7f8b8d, x, -0.14, end * 10.45);
      block(0.85, 0.14, 0.61, 0xc9c7a5, x, 0.23, end * 10.45);
    }
  // A compact tournament gate sits behind each goal; team colors mark the ends.
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      block(0.65, 1.55, 0.85, 0x87949b, side * 1.8, 0.4, end * 9.9);
      block(0.82, 0.19, 1.0, 0xd6c998, side * 1.8, 1.27, end * 9.9);
      block(0.8, 0.37, 0.75, end < 0 ? 0x4e80b1 : 0xc85845, side * 1.8, 1.5, end * 9.9);
    }
    block(2.95, 0.32, 0.65, 0x83929a, 0, 0.35, end * 10.05);
    block(2.95, 0.14, 0.78, 0xd1c695, 0, 0.6, end * 10.05);
  }
  // Batch static scenery by paint color so the phone renders dozens of draws, not hundreds.
  group.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const paint = object.material as THREE.Material;
    if (!batches.has(paint)) batches.set(paint, []);
    batches.get(paint)!.push(geometry);
    originals.add(object.geometry);
  });
  group.clear();
  originals.forEach((geometry) => geometry.dispose());
  for (const [paint, geometries] of batches) {
    const merged = mergeGeometries(geometries)!;
    geometries.forEach((geometry) => geometry.dispose());
    const mesh = new THREE.Mesh(merged, paint);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
