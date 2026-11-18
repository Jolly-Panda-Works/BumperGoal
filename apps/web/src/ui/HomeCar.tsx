import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../game/art';

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
      const direction = new THREE.Vector3(-1.5, 0.9, 2.2).normalize();
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
      camera.position.copy(direction.multiplyScalar(distance));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    host.appendChild(renderer.domElement);
    const observer = new ResizeObserver(render);
    observer.observe(host);
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
