// A fixed pool of real lights that stands in for all of a scene's point and spot lights. Every light in a scene is
// evaluated for every pixel of every material (about 17 in this street, 43% of the frame time), though each only reaches
// a few metres. The pool lends its lights to the ones that reach what the camera can see (their reach sphere meets the
// view frustum), nearest first: the picture is the same, but the shaders loop over 9 lights instead of 17. A light
// changing hands fades out and in, so nothing pops, and the shader never changes (no recompiling while walking).
import * as THREE from 'three';

export function createLightPool(scene, camera, { points = 6, spots = 3, reach = 45 } = {}) {
  const virtual = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isPointLight && !o.isSpotLight) return;
    virtual.push({
      spot: !!o.isSpotLight, pos: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld), color: o.color.clone(), intensity: o.intensity,
      distance: o.distance || 20, decay: o.decay, angle: o.angle, penumbra: o.penumbra,
      target: o.isSpotLight ? new THREE.Vector3().setFromMatrixPosition(o.target.matrixWorld) : null, sphere: new THREE.Sphere(),
    });
  });
  for (const v of virtual) v.sphere.set(v.pos, v.distance);
  for (const o of scene.children.slice()) removeLights(o);
  function removeLights(o) {
    for (const c of o.children.slice()) removeLights(c);
    if (o.isPointLight || o.isSpotLight) { if (o.isSpotLight) o.target.parent?.remove(o.target); o.parent?.remove(o); }
  }
  const slots = [];
  const make = (spot) => {
    const light = spot ? new THREE.SpotLight(0xffffff, 0, 1, 1, 0, 1) : new THREE.PointLight(0xffffff, 0, 1, 2);
    scene.add(light); if (spot) scene.add(light.target);
    slots.push({ light, spot, v: null, next: null, k: 0 });
  };
  for (let i = 0; i < points; i++) make(false);
  for (let i = 0; i < spots; i++) make(true);
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4(), tmp = new THREE.Vector3();
  const apply = (s, v) => {
    const l = s.light; s.v = v;
    l.color.copy(v.color); l.distance = v.distance; l.decay = v.decay; l.position.copy(v.pos);
    if (s.spot) { l.angle = v.angle; l.penumbra = v.penumbra; l.target.position.copy(v.target); l.target.updateMatrixWorld(); }
    l.updateMatrixWorld();
  };
  let wanted = new Set();
  return {
    virtual, slots,
    update(dt) {
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const near = virtual.filter((v) => frustum.intersectsSphere(v.sphere) && camera.position.distanceTo(v.pos) - v.distance < reach)
        .map((v) => [camera.position.distanceTo(v.pos), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      wanted = new Set();
      for (const spot of [false, true]) {
        const mine = slots.filter((s) => s.spot === spot), pick = near.filter((v) => v.spot === spot).slice(0, mine.length);
        pick.forEach((v) => wanted.add(v));
        const held = new Set(mine.map((s) => s.next || s.v).filter(Boolean));
        const free = pick.filter((v) => !held.has(v));
        for (const s of mine) {   // a slot whose light is no longer wanted takes over the next wanted one
          const cur = s.next || s.v;
          if (cur && wanted.has(cur)) continue;
          const v = free.shift();
          if (v) s.next = v; else if (cur && !s.next) s.next = null;
        }
      }
      for (const s of slots) {
        const hand = s.next && s.next !== s.v;
        const goal = s.v && !hand && wanted.has(s.v) ? 1 : 0;
        s.k += Math.sign(goal - s.k) * Math.min(Math.abs(goal - s.k), dt * 6);
        if (s.k === 0 && hand) { apply(s, s.next); s.next = null; }
        else if (s.k === 0 && s.v && !wanted.has(s.v)) s.v = null;
        s.light.intensity = s.v ? s.v.intensity * s.k : 0;
        if (s.k === 0 && !s.v && s.next) { apply(s, s.next); s.next = null; }
      }
    },
  };
}
