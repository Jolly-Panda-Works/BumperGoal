// Logs every raw wasm export call the official Rapier JS API makes for one
// FlickKick-style shot, so the Go/wazero driver can replay the same sequence.
// Run: node poc/rapier-determinism/trace.mjs
const log = [];
const original = WebAssembly.instantiate;
WebAssembly.instantiate = async (...args) => {
  const result = await original(...args);
  if (!result.instance || !('rawphysicspipeline_step' in result.instance.exports)) return result;
  const real = result.instance.exports;
  // exports is frozen, so build a wrapped copy instead of a Proxy.
  const exports = {};
  for (const [name, v] of Object.entries(real)) {
    exports[name] =
      typeof v !== 'function'
        ? v
        : (...a) => {
            const r = v(...a);
            if (!/^rawvector_[xy]$|__wbindgen_add_to_stack_pointer/.test(name))
              log.push(`${name}(${a.join(', ')}) -> ${r}`);
            return r;
          };
  }
  return { module: result.module, instance: { exports } };
};

const { default: RAPIER } = await import('@dimforge/rapier2d-deterministic-compat');
await RAPIER.init();
log.length = 0;

const world = new RAPIER.World({ x: 0, y: 0 });
log.push('--- world created');
const walls = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(
  RAPIER.ColliderDesc.segment({ x: -7.5, y: 4.5 }, { x: 7.5, y: 4.5 }).setRestitution(0.8).setFriction(0),
  walls,
);
log.push('--- wall');
const body = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(-3, 0).setLinearDamping(1.4).lockRotations().setCanSleep(false),
);
world.createCollider(RAPIER.ColliderDesc.ball(0.42).setDensity(1).setRestitution(0.85).setFriction(0), body);
log.push('--- disc');
body.applyImpulse({ x: 6, y: 0 }, true);
log.push('--- impulse');
world.step();
log.push('--- step');
const t = body.translation();
const v = body.linvel();
log.push(`--- read ${t.x} ${t.y} ${v.x} ${v.y}`);
body.setLinvel({ x: 0, y: 0 }, true);
log.push('--- setLinvel');
world.free();
log.push('--- free');
console.log(log.join('\n'));
