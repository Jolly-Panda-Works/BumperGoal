import * as THREE from 'three';

/** A mesh shaft has a real world-space thickness on desktop and mobile. */
export class AimArrow extends THREE.Group {
  private material = new THREE.MeshBasicMaterial({ color: 0xffdd59, depthTest: false, toneMapped: false });
  private shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 12), this.material);
  private head = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1, 16), this.material);
  constructor() {
    super();
    this.add(this.shaft, this.head);
    this.shaft.renderOrder = this.head.renderOrder = 10;
    this.setLength(1);
  }
  setDirection(direction: THREE.Vector3): void {
    this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  }
  setLength(length: number): void {
    const headLength = Math.min(0.48, length * 0.4);
    this.shaft.scale.y = length - headLength;
    this.shaft.position.y = (length - headLength) / 2;
    this.head.scale.y = headLength;
    this.head.position.y = length - headLength / 2;
  }
  setColor(color: THREE.Color): void {
    this.material.color.copy(color);
  }
}
