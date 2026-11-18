import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../game/art';
import { cosmetics } from '@flickkick/config';

/** Static showroom rendering of the equipped model; its camera preserves proportions. */
export default function HomeCar({ model }: { model: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.65;
    renderer.setClearColor(0, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(29, 1, 0.01, 50);
    scene.add(new THREE.HemisphereLight(0xc5f5ff, 0x66802e, 3));
    const key = new THREE.DirectionalLight(0xffffff, 4.5);
    key.position.set(-3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x69dfff, 3);
    rim.position.set(3, 2, -3);
    scene.add(rim);
    let root: THREE.Object3D | undefined;
    const disposeTree = (tree: THREE.Object3D) => {
      const textures = new Set<THREE.Texture>();
      tree.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
            m.dispose();
          }
        }
      });
      textures.forEach((t) => t.dispose());
    };
    const render = () => {
      const w = host.clientWidth,
        h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // The stadium horizon is near mid-frame: view the car almost at pitch level.
      const direction = new THREE.Vector3(-1.5, 0.35, 2.2).normalize();
      camera.position.copy(direction);
      camera.lookAt(0, 0, 0);
      let distance = 4;
      if (root) {
        // Fit all eight model bounds in camera space, leaving a 10% safe border.
        const box = new THREE.Box3().setFromObject(root);
        const rotation = camera.quaternion.clone().invert();
        const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.9;
        distance = 0;
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              const p = new THREE.Vector3(x, y, z).applyQuaternion(rotation);
              distance = Math.max(distance, p.z + Math.abs(p.x) / (tan * camera.aspect), p.z + Math.abs(p.y) / tan);
            }
      }
      if (model.startsWith('ball:')) distance = 1.08 / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
      camera.position.copy(direction.multiplyScalar(distance));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    host.appendChild(renderer.domElement);
    const observer = new ResizeObserver(render);
    observer.observe(host);
    if (model.startsWith('ball:')) {
      const definition = cosmetics.balls.find((ball) => ball.id === model.slice(5)) ?? cosmetics.balls[0]!;
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1, 80, 48),
        new THREE.MeshStandardMaterial({ color: definition.primary, roughness: 0.62 }),
      );
      root = ball;
      const layout = new THREE.IcosahedronGeometry(1, 0);
      const vertices = layout.getAttribute('position');
      const used = new Set<string>();
      for (let i = 0; i < vertices.count; i++) {
        const normal = new THREE.Vector3().fromBufferAttribute(vertices, i).normalize();
        const key = normal
          .toArray()
          .map((n) => n.toFixed(3))
          .join(',');
        if (used.has(key)) continue;
        used.add(key);
        const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        const positions: number[] = [];
        // Subdivide before projecting onto the sphere so panel interiors never sink into it.
        for (let side = 0; side < 5; side++) {
          const a = new THREE.Vector3(Math.cos(side * Math.PI * 0.4), Math.sin(side * Math.PI * 0.4), 0).multiplyScalar(
            0.36,
          );
          const b = new THREE.Vector3(
            Math.cos((side + 1) * Math.PI * 0.4),
            Math.sin((side + 1) * Math.PI * 0.4),
            0,
          ).multiplyScalar(0.36);
          const emit = (u: number, v: number) => {
            const point = a
              .clone()
              .multiplyScalar(u / 12)
              .addScaledVector(b, v / 12)
              .applyQuaternion(rotation)
              .add(normal)
              .normalize()
              .multiplyScalar(1.003);
            positions.push(point.x, point.y, point.z);
          };
          for (let u = 0; u < 12; u++)
            for (let v = 0; v < 12 - u; v++) {
              emit(u, v);
              emit(u + 1, v);
              emit(u, v + 1);
              if (u + v < 11) {
                emit(u + 1, v);
                emit(u + 1, v + 1);
                emit(u, v + 1);
              }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        ball.add(
          new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: definition.secondary, roughness: 0.7 })),
        );
      }
      layout.dispose();
      ball.rotation.set(0.2, 0.35, 0.15);
      scene.add(ball);
      render();
      host.dataset.ready = 'true';
    } else
      new GLTFLoader().load(
        assetUrl(`cars/${model}.glb`),
        (gltf) => {
          if (disposed) {
            disposeTree(gltf.scene);
            return;
          }
          root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const center = box.getCenter(new THREE.Vector3());
          const scale = 2 / box.getSize(new THREE.Vector3()).length();
          root.scale.setScalar(scale);
          root.position.copy(center.multiplyScalar(-scale));
          scene.add(root);
          render();
          host.dataset.ready = 'true';
        },
        undefined,
        () => {
          /* Keep the static preview if WebGL or loading fails. */
        },
      );
    return () => {
      disposed = true;
      observer.disconnect();
      if (root) disposeTree(root);
      renderer.dispose();
      renderer.domElement.remove();
      delete host.dataset.ready;
    };
  }, [model]);
  return <div className="home-car-render" ref={ref} aria-hidden="true" />;
}
