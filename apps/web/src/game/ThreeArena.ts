import { ImpactEffects } from './ImpactEffects';
import { CarTrails } from './CarTrails';
import { CarDriveEffects, fullPowerNitro, wheelPivots, type CarDriveRig } from './CarDriveEffects';
import { AimArrow } from './AimArrow';
import { collisionContact } from './collisionContact';
import { kickoffCarHeading, resetKickoffViews } from './kickoffPresentation';
import { isPhone } from '../services/device';
import { preferredArenaLayout } from './arenaLayout';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Entity } from 'koota';
import { physicsConfig, teamPhysics, carModelForTeam } from '@flickkick/config';
import { audio } from '../services/audio';
import { settingsStore } from '../services/settings';
import { bodyEntities, clearAiming, runFrame, type Impact } from './ecs/systems';
import {
  Aiming,
  BodyRef,
  Heading,
  Highlighted,
  HudTrait,
  HoldTrait,
  IsBall,
  PlaybackTrait,
  Position,
  Team,
} from './ecs/traits';
import { cartoonSurroundings } from './cartoonSurroundings';
import { fitArenaCamera } from './arenaCamera';
import { arenaPosition, FIELD_WIDTH_SCALE, shotFromGround } from './arena3dProjection';
import { TireMarks } from './tireMarks';
import { assetUrl } from './art';
import type { SceneInit } from './MatchScene';

const TEAM_COLORS = [0xc93637, 0x338de0];
const UP = new THREE.Vector3(0, 1, 0);
interface Body3D {
  entity: Entity;
  object: THREE.Group;
  ring?: THREE.Mesh;
  chassis?: THREE.Group;
  headingRoot?: THREE.Group;
  driveRig?: CarDriveRig;
  last: THREE.Vector3;
}

/** A real 3D presentation of the existing deterministic two-dimensional match. */
export class ThreeArena {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 180);
  private bodies: Body3D[] = [];
  private disposed = false;
  private observer: ResizeObserver;
  private off: (() => void)[] = [];
  private lastTime = 0;
  private clock = 0;
  private orientation: number;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(UP, 0);
  private drag?: { entity: Entity; pointer: number; start: THREE.Vector3 };
  private arrow = new AimArrow();
  private tireMarks = new TireMarks();
  private tracksCanvas = document.createElement('canvas');
  private tracksTexture: THREE.CanvasTexture;
  private lastImpact = 0;
  private lastHeavyImpact = -1000;
  private impactCount = 0;
  private impactEffects: ImpactEffects;
  private carTrails: CarTrails;
  private driveEffects: CarDriveEffects;
  private nitroIndex = -1;
  private cameraRest = new THREE.Vector3();
  private lastTracks = -1000;
  private goalFlashUntil = 0;
  private goalFlashColor = 0xcce998;
  private pendingKickoffAt: number | null = null;

  constructor(
    private parent: HTMLDivElement,
    private init: SceneInit,
  ) {
    this.orientation = init.bottomSide === 'R' ? -1 : 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(
      settingsStore.get().graphics === 'low' ? 1 : Math.min(2, Math.max(1.5, devicePixelRatio)),
    );
    this.renderer.shadowMap.enabled = settingsStore.get().graphics !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Preserve the saturated cartoon palette instead of compressing it into pale highlights.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', 'Bumper Goal 3D football arena');
    parent.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#31a54e');
    this.scene.fog = new THREE.Fog('#31a54e', 80, 150);
    this.scene.add(new THREE.HemisphereLight(0xe6f7ff, 0x284b65, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-7, 15, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 12, bottom: -12, near: 1, far: 45 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 1.5;
    this.scene.add(sun);
    this.impactEffects = new ImpactEffects(this.scene);
    this.carTrails = new CarTrails(this.scene);
    this.driveEffects = new CarDriveEffects(this.scene);
    this.renderer.domElement.dataset.impactCount = '0';
    this.tracksCanvas.width = 512;
    this.tracksCanvas.height = 1024;
    this.tracksTexture = new THREE.CanvasTexture(this.tracksCanvas);
    const existing = new Set(this.scene.children);
    this.makeArena();
    const scenery = new THREE.Group();
    for (const child of [...this.scene.children]) if (!existing.has(child)) scenery.add(child);
    scenery.scale.x = FIELD_WIDTH_SCALE;
    this.scene.add(scenery);
    this.makeBodies();
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(parent);
    this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    canvas.addEventListener('lostpointercapture', this.pointerCancel);
    this.off.push(
      init.controller.bus.on('playShot', (playback) => {
        if (this.pendingKickoffAt !== null) this.resetForKickoff();
        this.cancelAim();
        this.carTrails.resetMotion();
        const physics =
          init.controller.current.mode === 'tutorial'
            ? physicsConfig
            : teamPhysics(init.controller.playerOf(playback.side).teamId, physicsConfig);
        this.nitroIndex = fullPowerNitro(playback.shot.ix, playback.shot.iy, physics.maxImpulse)
          ? playback.shot.discIndex
          : -1;
        audio.play('kick');
        audio.playMusic('match', 0.4);
        audio.vibrate(20);
      }),
    );
    this.off.push(
      init.controller.bus.on('events', (events) => {
        for (const event of events) {
          if (event.type === 'goal') {
            this.pendingKickoffAt = init.controller.current.phase === 'ENDED' ? null : this.clock + 1100;
            init.controller.world.set(HoldTrait, { until: this.clock + 1100 });
            this.goalFlashUntil = this.clock + 900;
            const scored = event.scorer === (init.bottomSide ?? 'L');
            this.goalFlashColor = scored ? 0xffe36b : 0xa73943;
            audio.play('goal');
            audio.play(scored ? 'wow' : 'oh');
            audio.excite(scored ? 1 : 0.3, 2.6);
            audio.vibrate(scored ? [60, 40, 120] : [100, 60, 100]);
          }
          if (event.type === 'timeout') audio.play('error');
          if (event.type === 'ended') audio.play('whistle');
        }
      }),
    );
    audio.startCrowd();
    this.renderer.setAnimationLoop(this.frame);
  }

  private box(
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.scene,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshToonMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private line(points: THREE.Vector3[], color = 0xf3f6d9, opacity = 0.88, parent: THREE.Object3D = this.scene) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
    parent.add(line);
    return line;
  }

  private grassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#169938';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < 12; row++)
      for (let column = 0; column < 6; column++) {
        ctx.fillStyle = (row + column) % 2 ? '#169938' : '#2bb445';
        ctx.fillRect(
          (column * canvas.width) / 6,
          (row * canvas.height) / 12,
          canvas.width / 6 + 1,
          canvas.height / 12 + 1,
        );
      }
    let seed = 42;
    for (let i = 0; i < 18000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const x = (seed >>> 8) % canvas.width;
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const y = (seed >>> 8) % canvas.height;
      ctx.fillStyle = i % 2 ? '#b9f5a90b' : '#124e2e10';
      ctx.fillRect(x, y, 1, 3);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private makeArena() {
    const halfLength = physicsConfig.arena.halfWidth;
    const length = halfLength * 2;
    const goalLine = halfLength - 0.07;
    this.scene.add(cartoonSurroundings());
    this.box(11.4, 0.65, length + 4, 0x305c88, 0, -0.46, 0);
    this.box(10.7, 0.18, length + 3.3, 0xebcb78, 0, -0.14, 0);
    const turf = new THREE.Mesh(
      new THREE.PlaneGeometry(9, length),
      new THREE.MeshToonMaterial({ map: this.grassTexture() }),
    );
    turf.rotation.x = -Math.PI / 2;
    turf.receiveShadow = true;
    this.scene.add(turf);
    const tracks = new THREE.Mesh(
      new THREE.PlaneGeometry(9, length),
      new THREE.MeshBasicMaterial({ map: this.tracksTexture, transparent: true, depthWrite: false }),
    );
    tracks.rotation.x = -Math.PI / 2;
    tracks.position.y = 0.012;
    this.scene.add(tracks);
    const rect = (x1: number, z1: number, x2: number, z2: number) =>
      this.line([
        new THREE.Vector3(x1, 0.018, z1),
        new THREE.Vector3(x2, 0.018, z1),
        new THREE.Vector3(x2, 0.018, z2),
        new THREE.Vector3(x1, 0.018, z2),
        new THREE.Vector3(x1, 0.018, z1),
      ]);
    rect(-4.42, -goalLine, 4.42, goalLine);
    this.box(8.84, 0.012, 0.045, 0xffffff, 0, 0.02, 0);
    this.line(
      Array.from(
        { length: 97 },
        (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 48) * 1.18, 0.022, Math.sin((i * Math.PI) / 48) * 1.18),
      ),
    );
    for (const sign of [-1, 1]) {
      rect(-2.15, sign * goalLine, 2.15, sign * (halfLength - 2.15));
      rect(-1.4, sign * goalLine, 1.4, sign * (halfLength - 0.9));
      this.goal(sign);
      // Low perimeter curbs keep the near goal and cars unobstructed.
      for (const x of [-3.3, 3.3]) this.box(2.35, 0.18, 0.13, 0xffe6a0, x, 0.1, sign * (halfLength + 0.08));
    }
    for (const side of [-1, 1]) {
      this.box(0.16, 0.25, length + 0.35, 0xffe6a0, side * 4.65, 0.1, 0);
      for (const sign of [-1, 1])
        this.box(
          0.18,
          0.06,
          halfLength + 0.25,
          sign === 1 ? 0xff3c48 : 0x168fe8,
          side * 4.65,
          0.25,
          (sign * halfLength) / 2,
        );
    }
    this.stadium();
  }

  private goal(sign: number) {
    const frame = new THREE.Group();
    this.scene.add(frame);
    const z = sign * physicsConfig.arena.halfWidth;
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf5fbff, roughness: 0.3, metalness: 0.3 });
    const beam = (a: THREE.Vector3, b: THREE.Vector3) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, a.distanceTo(b), 12), postMaterial);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      mesh.castShadow = true;
      frame.add(mesh);
    };
    for (const x of [-1.3, 1.3]) {
      beam(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1.15, z));
      beam(new THREE.Vector3(x, 1.15, z), new THREE.Vector3(x, 0.85, z + sign * 0.95));
      beam(new THREE.Vector3(x, 0.85, z + sign * 0.95), new THREE.Vector3(x, 0, z + sign * 0.95));
      for (let step = 0; step <= 6; step++) {
        const dz = (step * 0.95) / 6;
        this.line(
          [new THREE.Vector3(x, 0, z + sign * dz), new THREE.Vector3(x, 1.15 - dz * 0.3, z + sign * dz)],
          0xd6edff,
          0.6,
          frame,
        );
      }
      for (let y = 0.15; y < 1; y += 0.15)
        this.line([new THREE.Vector3(x, y, z), new THREE.Vector3(x, y * 0.74, z + sign * 0.95)], 0xd6edff, 0.38, frame);
    }
    beam(new THREE.Vector3(-1.3, 1.15, z), new THREE.Vector3(1.3, 1.15, z));
    beam(new THREE.Vector3(-1.3, 0.85, z + sign * 0.95), new THREE.Vector3(1.3, 0.85, z + sign * 0.95));
    for (let x = -1.3; x <= 1.31; x += 0.16) {
      this.line(
        [
          new THREE.Vector3(x, 0, z + sign * 0.95),
          new THREE.Vector3(x, 0.85, z + sign * 0.95),
          new THREE.Vector3(x, 1.15, z),
        ],
        0xd6edff,
        0.45,
        frame,
      );
    }
    for (let y = 0.15; y < 0.9; y += 0.15)
      this.line(
        [new THREE.Vector3(-1.3, y, z + sign * 0.95), new THREE.Vector3(1.3, y, z + sign * 0.95)],
        0xd6edff,
        0.4,
        frame,
      );
  }

  private stadium() {
    const palette = [0xb54d42, 0xe7c368, 0x5087a5, 0x65a173];
    const people = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.105, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
      144,
    );
    const matrix = new THREE.Matrix4();
    let person = 0;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const x = side * (5.1 + row * 0.22);
        this.box(
          0.28,
          0.24 + row * 0.22,
          physicsConfig.arena.halfWidth * 2 - 0.2,
          row % 2 ? 0x3a98d5 : 0x245b96,
          x,
          row * 0.11,
          0,
        );
        for (let seat = 0; seat < 24; seat++) {
          matrix.makeTranslation(
            x,
            0.3 + row * 0.22,
            -physicsConfig.arena.halfWidth + 0.5 + (seat * (physicsConfig.arena.halfWidth * 2 - 1)) / 23,
          );
          people.setMatrixAt(person, matrix);
          people.setColorAt(person++, new THREE.Color(palette[(seat + row * 3) % palette.length]!));
        }
      }
    }
    this.scene.add(people);
    // A small sign behind the far goal anchors the arena without obscuring play.
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#087ac5';
    ctx.fillRect(0, 0, 1024, 180);
    ctx.fillStyle = '#ffe744';
    ctx.font = '900 90px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUMPER GOAL', 512, 119);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 0.75),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    sign.position.set(0, 1.7, -physicsConfig.arena.halfWidth - 1.11);
    this.scene.add(sign);
    this.box(4.4, 0.9, 0.15, 0xffcc49, 0, 1.7, -physicsConfig.arena.halfWidth - 1.22);
  }

  private makeBodies() {
    const entities = bodyEntities(this.init.controller.world);
    for (const entity of entities) {
      const object = new THREE.Group();
      object.scale.x = FIELD_WIDTH_SCALE;
      this.scene.add(object);
      const pos = entity.get(Position)!;
      object.position.copy(this.toWorld(pos.x, pos.y));
      const isBall = entity.has(IsBall);
      let ring: THREE.Mesh | undefined;
      let chassis: THREE.Group | undefined;
      let headingRoot: THREE.Group | undefined;
      let driveRig: CarDriveRig | undefined;
      if (isBall) {
        const material = new THREE.MeshStandardMaterial({ color: 0xfcfaf0, roughness: 0.65 });
        const ball = new THREE.Mesh(new THREE.SphereGeometry(physicsConfig.ball.radius, 24, 16), material);
        ball.position.y = physicsConfig.ball.radius;
        ball.castShadow = true;
        object.add(ball);
        // Black pentagonal patches sit on the actual spherical surface.
        const patchLayout = new THREE.IcosahedronGeometry(1, 0);
        const vertices = patchLayout.getAttribute('position');
        const used = new Set<string>();
        for (let i = 0; i < vertices.count; i++) {
          const normal = new THREE.Vector3().fromBufferAttribute(vertices, i).normalize();
          const key = normal
            .toArray()
            .map((n) => n.toFixed(2))
            .join(',');
          if (used.has(key)) continue;
          used.add(key);
          const patch = new THREE.Mesh(
            new THREE.CircleGeometry(physicsConfig.ball.radius * 0.323, 5),
            new THREE.MeshStandardMaterial({ color: 0x18252a, side: THREE.DoubleSide }),
          );
          patch.position.copy(normal.multiplyScalar(physicsConfig.ball.radius + 0.002));
          patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.normalize());
          ball.add(patch);
        }
        patchLayout.dispose();
      } else {
        const team = entity.get(Team)!.side === 'L' ? 0 : 1;
        ring = new THREE.Mesh(
          new THREE.RingGeometry(0.49, 0.535, 48),
          new THREE.MeshBasicMaterial({
            color: TEAM_COLORS[team],
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.025;
        object.add(ring);
        headingRoot = new THREE.Group();
        object.add(headingRoot);
        headingRoot.rotation.y = kickoffCarHeading(entity.get(Team)!.side, this.orientation);
        driveRig = this.driveEffects.rig(headingRoot);
        chassis = new THREE.Group();
        headingRoot.add(chassis);
        const modelRoot = chassis;
        // A lit 3D car remains available while the supplied model streams in.
        const fallback = new THREE.Group();
        this.box(
          (physicsConfig.disc.halfWidth ?? 0.45) * 2,
          0.24,
          (physicsConfig.disc.halfLength ?? 0.71) * 2,
          TEAM_COLORS[team]!,
          0,
          0.24,
          0,
          fallback,
        );
        this.box(0.72, 0.22, 0.58, 0x233b48, 0, 0.45, -0.05, fallback);
        modelRoot.add(fallback);
        new GLTFLoader().load(
          assetUrl(`cars/${carModelForTeam(this.init.controller.playerOf(entity.get(Team)!.side).teamId)}.glb`),
          (gltf) => {
            if (this.disposed) {
              this.disposeTree(gltf.scene);
              return;
            }
            modelRoot.remove(fallback);
            this.disposeTree(fallback);
            gltf.scene.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.castShadow = true;
                o.receiveShadow = true;
                const materials = Array.isArray(o.material) ? o.material : [o.material];
                const converted = materials.map((material) => {
                  const original = material as THREE.MeshStandardMaterial;
                  const toon = new THREE.MeshToonMaterial({ map: original.map, color: original.color });
                  toon.onBeforeCompile = (shader) => {
                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <map_fragment>',
                      `
                      #include <map_fragment>
                      float paintLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                      diffuseColor.rgb = max(vec3(0.0), mix(vec3(paintLuma), diffuseColor.rgb, 1.35) * 1.22);
                      if (diffuseColor.r > diffuseColor.g * 1.8 && diffuseColor.r > diffuseColor.b * 1.5) diffuseColor.rgb *= 1.6;
                    `,
                    );
                  };
                  original.dispose();
                  return toon;
                });
                o.material = Array.isArray(o.material) ? converted : converted[0]!;
              }
            });
            const bounds = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
            gltf.scene.scale.x = ((physicsConfig.disc.halfWidth ?? 0.45) * 2) / bounds.x;
            gltf.scene.scale.z = ((physicsConfig.disc.halfLength ?? 0.71) * 2) / bounds.z;
            driveRig!.wheels = wheelPivots(gltf.scene);
            modelRoot.add(gltf.scene);
          },
          undefined,
          (error) => console.warn('Car model unavailable; keeping the 3D fallback.', error),
        );
      }
      this.bodies.push({ entity, object, ring, chassis, headingRoot, driveRig, last: object.position.clone() });
    }
  }

  private toWorld(x: number, y: number) {
    const point = arenaPosition(x, y, this.orientation);
    return new THREE.Vector3(point.x, 0, point.z);
  }

  private resize() {
    const w = Math.max(1, this.parent.clientWidth),
      h = Math.max(1, this.parent.clientHeight);
    this.renderer.setSize(w, h);
    const layout = preferredArenaLayout(w, isPhone());
    this.renderer.domElement.dataset.layout = layout;
    fitArenaCamera(this.camera, w, h, physicsConfig.arena.halfWidth, layout);
  }

  private point(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  private pointerDown = (event: PointerEvent) => {
    if (
      this.pendingKickoffAt !== null ||
      this.drag ||
      !event.isPrimary ||
      event.button !== 0 ||
      this.init.controller.world.get(PlaybackTrait)?.active
    )
      return;
    audio.unlock();
    const at = this.point(event);
    if (!at) return;
    let selected: Body3D | undefined,
      nearest = 0.85;
    for (const body of this.bodies) {
      if (body.entity.has(IsBall)) continue;
      const distance = body.object.position.distanceTo(at);
      if (distance < nearest) {
        selected = body;
        nearest = distance;
      }
    }
    if (!selected) return;
    const controller = this.init.controller;
    if (!controller.canAim()) {
      this.init.onInvalidPress?.('not_your_turn');
      return;
    }
    if (selected.entity.get(Team)!.side !== controller.current.turn.side) {
      audio.play('error');
      this.init.onInvalidPress?.('not_your_disc');
      return;
    }
    selected.entity.add(Aiming({ angle: 0, power: 0, pointerId: event.pointerId }));
    this.drag = { entity: selected.entity, pointer: event.pointerId, start: selected.object.position.clone() };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    audio.play('tap');
    event.preventDefault();
  };

  private pointerMove = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return;
    const at = this.point(event);
    if (!at) return;
    const { angle, power } = shotFromGround(this.drag.start, at, this.orientation, settingsStore.get().aimSensitivity);
    this.drag.entity.set(Aiming, { angle, power, pointerId: event.pointerId });
    this.arrow.visible = power > 0;
    this.arrow.position.copy(this.drag.start).y = 0.18;
    this.arrow.setDirection(
      new THREE.Vector3(
        Math.sin(angle) * this.orientation * FIELD_WIDTH_SCALE,
        0,
        -Math.cos(angle) * this.orientation,
      ).normalize(),
    );
    this.arrow.setLength(0.65 + power * 2.9);
    this.arrow.setColor(new THREE.Color().lerpColors(new THREE.Color(0xd3f06b), new THREE.Color(0xff854f), power));
  };

  private pointerUp = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return;
    this.pointerMove(event);
    const entity = this.drag.entity,
      aim = entity.get(Aiming)!;
    const index = entity.get(BodyRef)!.index;
    this.cancelAim();
    if (this.renderer.domElement.hasPointerCapture(event.pointerId))
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (aim.power > 0) this.init.controller.requestShot(index, aim.angle, aim.power);
  };

  private pointerCancel = () => this.cancelAim();
  private cancelAim() {
    this.drag = undefined;
    clearAiming(this.init.controller.world);
    this.arrow.visible = false;
  }

  private resetForKickoff(): void {
    this.cancelAim();
    resetKickoffViews(this.bodies, this.init.controller.current, this.orientation);
    this.tireMarks.clear();
    this.impactEffects.clear();
    this.carTrails.clear();
    this.driveEffects.clear();
    this.nitroIndex = -1;
    for (const body of this.bodies)
      if (body.driveRig) {
        body.driveRig.flame.visible = false;
        for (const wheel of body.driveRig.wheels) wheel.pivot.rotation.x = 0;
      }
    this.lastTracks = -Infinity;
    this.pendingKickoffAt = null;
    this.init.controller.world.set(HoldTrait, { until: 0 });
  }

  private onImpact(impact: Impact): void {
    const bodies = this.bodies.map((view) => {
      const pos = view.entity.get(Position)!;
      return {
        kind: view.entity.has(IsBall) ? ('ball' as const) : ('disc' as const),
        angle: view.entity.get(Heading)?.angle ?? 0,
        x: pos.x,
        y: pos.y,
      };
    });
    const contact = collisionContact(impact, bodies);
    const strength = Math.min(1, impact.strength * 6);
    const settings = settingsStore.get();
    if (
      this.impactEffects.emit(
        this.toWorld(contact.x, contact.y),
        contact.kind,
        strength,
        this.clock,
        { quality: settings.graphics, reducedMotion: settings.reducedMotion },
        contact.bodies,
      )
    ) {
      this.renderer.domElement.dataset.impactCount = String(++this.impactCount);
    }
    if (this.clock - this.lastImpact < 45) return;
    audio.play(contact.kind === 'wall' ? 'wall' : contact.kind === 'ball' ? 'ball' : 'hit', strength);
    if (strength > 0.45 && this.clock - this.lastHeavyImpact > 160) {
      if (strength > 0.7) audio.play('impact', strength * 0.55);
      audio.vibrate(Math.round(8 + strength * 16));
      this.lastHeavyImpact = this.clock;
    }
    this.lastImpact = this.clock;
  }

  private frame = (time: number) => {
    if (this.disposed) return;
    const delta = this.lastTime ? Math.min(time - this.lastTime, 100) : 0;
    this.lastTime = time;
    const world = this.init.controller.world;
    if (world.get(HudTrait)?.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.clock += delta;
    runFrame(world, {
      deltaMs: delta,
      nowMs: this.clock,
      reducedMotion: settingsStore.get().reducedMotion,
      onImpact: (impact) => this.onImpact(impact),
      onShotFinished: () => this.init.controller.completeShot(),
    });
    const playing = world.get(PlaybackTrait)?.active ?? false;
    if (this.pendingKickoffAt !== null && this.clock >= this.pendingKickoffAt && !playing) {
      if (this.init.controller.current.phase === 'AWAIT_SHOT') this.resetForKickoff();
      else this.pendingKickoffAt = null;
    }
    if (!playing) {
      this.tireMarks.resetMotion();
      this.carTrails.resetMotion();
    }
    if (this.drag && (!this.init.controller.canAim() || playing)) this.cancelAim();
    for (const body of this.bodies) {
      const pos = body.entity.get(Position)!;
      const next = this.toWorld(pos.x, pos.y),
        movement = next.clone().sub(body.last);
      if (body.entity.has(IsBall)) {
        const ball = body.object.children[0]!;
        if (movement.lengthSq() > 0.000001)
          ball.rotateOnWorldAxis(
            new THREE.Vector3(movement.z, 0, -movement.x).normalize(),
            movement.length() / physicsConfig.ball.radius,
          );
      } else {
        if (playing && !settingsStore.get().reducedMotion)
          this.carTrails.sample(
            body.entity.get(BodyRef)!.index,
            next,
            movement,
            delta,
            this.clock,
            this.init.trailIds?.[body.entity.get(Team)!.side],
          );
        const aim = body.entity.get(Aiming);
        if (body.headingRoot)
          body.headingRoot.rotation.y =
            Math.PI -
            (aim && aim.power > 0 ? aim.angle : (body.entity.get(Heading)?.angle ?? 0)) +
            (this.orientation === -1 ? Math.PI : 0);
        if (body.ring) {
          const active = body.entity.has(Highlighted);
          (body.ring.material as THREE.MeshBasicMaterial).color.set(
            active ? 0xd2f45b : TEAM_COLORS[body.entity.get(Team)!.side === 'L' ? 0 : 1]!,
          );
          const pulse = settingsStore.get().reducedMotion ? 1 : 1 + (active ? Math.sin(this.clock / 180) * 0.06 : 0);
          body.ring.scale.setScalar(pulse);
        }
        if (playing)
          this.tireMarks.sample(body.entity.get(BodyRef)!.index, next.x * 66, next.z * 66, this.clock, 0.27 * 66);
      }
      body.object.position.copy(next);
      if (body.driveRig)
        this.driveEffects.sample(
          body.entity.get(BodyRef)!.index,
          body.driveRig,
          movement,
          delta,
          this.clock,
          playing,
          body.entity.get(BodyRef)!.index === this.nitroIndex,
          settingsStore.get().reducedMotion,
          settingsStore.get().graphics === 'low',
        );
      body.last.copy(next);
    }
    const settings = settingsStore.get();
    this.driveEffects.update(this.clock, delta, settings.reducedMotion);
    this.renderer.domElement.dataset.smokeCount = String(this.driveEffects.smokeCount);
    this.renderer.domElement.dataset.nitroCount = String(this.driveEffects.nitroCount);
    this.renderer.domElement.dataset.wheelTurns = String(this.driveEffects.wheelTurns);
    this.carTrails.update(this.clock, settings.reducedMotion);
    this.renderer.domElement.dataset.trailCount = String(this.carTrails.emittedCount);
    this.impactEffects.update(this.clock, this.camera, settings.reducedMotion);
    for (const body of this.bodies)
      if (body.chassis) {
        this.impactEffects.applyChassis(
          body.entity.get(BodyRef)!.index,
          body.chassis,
          this.clock,
          settings.reducedMotion,
        );
      }
    this.drawTracks();
    (this.scene.background as THREE.Color).setHex(this.clock < this.goalFlashUntil ? this.goalFlashColor : 0x31a54e);
    this.cameraRest.copy(this.camera.position);
    if (!settings.reducedMotion && settings.graphics === 'high')
      this.camera.position.add(this.impactEffects.cameraOffset(this.clock, this.camera));
    this.renderer.render(this.scene, this.camera);
    this.camera.position.copy(this.cameraRest);
    this.camera.updateMatrixWorld();
  };

  private drawTracks() {
    const interval = this.init.controller.world.get(PlaybackTrait)?.active ? 33 : 100;
    if (this.clock - this.lastTracks < interval) return;
    this.lastTracks = this.clock;
    this.tireMarks.prune(this.clock);
    const ctx = this.tracksCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 1024);
    const x = (value: number) => ((value / 66 / FIELD_WIDTH_SCALE + 4.5) / 9) * 512;
    const y = (value: number) =>
      ((value / 66 + physicsConfig.arena.halfWidth) / (physicsConfig.arena.halfWidth * 2)) * 1024;
    ctx.strokeStyle = '#182016';
    ctx.lineCap = 'round';
    for (const mark of this.tireMarks.marks) {
      ctx.globalAlpha = mark.alpha * Math.min(1, (TireMarks.lifetime - this.clock + mark.time) / 4000);
      ctx.lineWidth = mark.width * 0.9;
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x(mark.x1 + mark.offsetX * sign), y(mark.y1 + mark.offsetY * sign));
        ctx.lineTo(x(mark.x2 + mark.offsetX * sign), y(mark.y2 + mark.offsetY * sign));
        ctx.stroke();
      }
    }
    this.tracksTexture.needsUpdate = true;
  }

  private disposeTree(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
  }

  destroy() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.off.forEach((off) => off());
    this.cancelAim();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerUp);
    canvas.removeEventListener('pointercancel', this.pointerCancel);
    canvas.removeEventListener('lostpointercapture', this.pointerCancel);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light && 'shadow' in object) (object as THREE.DirectionalLight).shadow?.dispose();
    });
    this.impactEffects.dispose();
    this.carTrails.dispose();
    this.driveEffects.dispose();
    this.disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    audio.stopCrowd();
    this.tireMarks.clear();
  }
}
