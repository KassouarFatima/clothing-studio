/* eslint-env node */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, DoubleSide, Vector3 } from 'three';
import { GARMENTS } from './catalog.js';
import { GARMENT_FIT } from '../../tryon/fitPose.js';
import { PROCEDURAL_GARMENTS, createProceduralModel, isProcedural } from './procedural.js';

// The showroom normalizes every garment into height 0.75 / width 0.66, so
// these ratios are what the user actually sees. They lock the proportions
// (a cap cannot go back to being a bucket, pants cannot go back to shorts).
const NORMALIZED_HEIGHT = 0.75;
const NORMALIZED_WIDTH = 0.66;
const ASPECT = {
  pants: [2.0, 3.0],      // ~2.5: real trousers, waist to ankle
  jacket: [0.7, 1.1],     // ~0.9: sleeves angled out make it wider than tall
  hat: [0.6, 1.05],       // ~0.77: a cap is wider than it is tall
  bag: [1.0, 1.4],        // ~1.25: a daypack body plus carry handle
};

function normalizedSize(group) {
  const box = new Box3().setFromObject(group);
  assert.ok(Number.isFinite(box.min.x) && Number.isFinite(box.max.y), 'garment bounds must be finite');
  const size = box.getSize(new Vector3());
  const scale = Math.min(NORMALIZED_HEIGHT / size.y, NORMALIZED_WIDTH / size.x);
  return { box, size, scaled: { x: size.x * scale, y: size.y * scale, z: size.z * scale } };
}

test('the four procedural garments are listed and none is blocked from the camera', () => {
  assert.deepEqual([...PROCEDURAL_GARMENTS], ['pants', 'jacket', 'hat', 'bag']);
  for (const id of PROCEDURAL_GARMENTS) {
    assert.ok(isProcedural(id));
    const entry = GARMENTS.find(garment => garment.id === id);
    assert.ok(entry, `missing catalog entry: ${id}`);
    assert.equal(entry.trackable, undefined, 'every listed garment can be placed on a body');
  }
  assert.equal(createProceduralModel('tshirt'), null, 'GLB garments have no procedural builder');
});

for (const garment of PROCEDURAL_GARMENTS) {
  test(`${garment} builds finite geometry with pattern-ready fabric panels`, () => {
    const group = createProceduralModel(garment);
    assert.ok(group && group.children.length >= 3, `${garment} should have several parts`);

    let fabricPanels = 0;
    group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      assert.equal(mesh.material.side, DoubleSide, `${mesh.name} must be double sided`);
      assert.ok(mesh.userData.role, `${mesh.name} must declare its role`);
      assert.ok(mesh.name.startsWith(mesh.userData.role), `${mesh.name} must be prefixed with its role`);

      const position = mesh.geometry.getAttribute('position');
      assert.ok(position && position.count > 0, `${mesh.name} needs vertices`);
      for (let index = 0; index < position.count; index++) {
        assert.ok(Number.isFinite(position.getX(index))
          && Number.isFinite(position.getY(index))
          && Number.isFinite(position.getZ(index)), `${mesh.name} has a non-finite vertex`);
      }

      if (mesh.userData.role === 'fabric') {
        fabricPanels += 1;
        const uv = mesh.geometry.getAttribute('uv');
        assert.ok(uv && uv.count === position.count, `${mesh.name} needs per-vertex UVs`);
        for (let index = 0; index < uv.count; index++) {
          const u = uv.getX(index);
          const v = uv.getY(index);
          assert.ok(u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6,
            `${mesh.name} UV out of range: ${u}, ${v}`);
        }
      }
    });
    assert.ok(fabricPanels >= 1, `${garment} must expose at least one fabric panel for the pattern`);
  });

  test(`${garment} normalizes into the showroom bounds with the expected proportions`, () => {
    const group = createProceduralModel(garment);
    const { scaled } = normalizedSize(group);
    assert.ok(scaled.y <= NORMALIZED_HEIGHT + 1e-3, `height ${scaled.y} exceeds the frame`);
    assert.ok(scaled.x <= NORMALIZED_WIDTH + 1e-3, `width ${scaled.x} exceeds the frame`);

    const aspect = scaled.y / scaled.x;
    const [min, max] = ASPECT[garment];
    assert.ok(aspect >= min && aspect <= max,
      `${garment} aspect ${aspect.toFixed(2)} outside [${min}, ${max}]`);

    if (garment === 'hat') {
      // A casquette projects forward: the bill makes it deeper than wide.
      assert.ok(scaled.z >= scaled.x * 1.15, `cap depth ${scaled.z} is too shallow`);
    }
    if (garment === 'bag') {
      // The carry handle must rise above the backpack body.
      const box = new Box3().setFromObject(group);
      assert.ok(box.max.y > 0.2, 'the backpack handle should extend above the body');
    }
  });
}

test('fit profiles stay aligned with the authored geometry', () => {
  // Pants hang from the waist: top edge = half the normalized height.
  const pants = GARMENT_FIT.pants;
  assert.ok(Math.abs((pants.shoulderY - pants.torsoLength) - 0.375) < 0.01, 'pants waist sits at +0.375');
  assert.equal(pants.needsHips, true);

  // The jacket fits from the shoulders like a top, no hips required, and
  // stays inside the fit clamp for a normal shoulder/torso ratio.
  const jacket = GARMENT_FIT.jacket;
  assert.equal(jacket.needsHips, false);
  const jacketRatio = 0.85 * jacket.torsoLength / jacket.shoulderWidth;
  assert.ok(jacketRatio > 0.72 && jacketRatio < 1.35, `jacket scaleX ratio ${jacketRatio} hits the clamp`);

  // The cap is measured in head units and keeps a sensible shoulder clamp
  // for the pants (hips ≈ 0.85 of shoulder width on screen).
  const pantsRatio = 0.85 * pants.torsoLength / pants.shoulderWidth;
  assert.ok(pantsRatio > 0.72 && pantsRatio < 1.35, `pants scaleX ratio ${pantsRatio} hits the clamp`);
  assert.ok(GARMENT_FIT.hat.headSpanToWidth >= 1 && GARMENT_FIT.hat.headSpanToWidth <= 1.5,
    'a cap crown is about as wide as the head, not a wide brim');
  assert.ok(GARMENT_FIT.hat.headHeight > 0.4 && GARMENT_FIT.hat.headHeight < 0.7,
    'cap height should be about half its normalized width');
  // The backpack rides the shoulders like a top: at a real shoulder-to-torso
  // ratio (~0.45 on screen) width and length keep their shape without
  // hitting the clamp, and it never waits for the hips.
  const bag = GARMENT_FIT.bag;
  assert.equal(bag.needsHips, false);
  const bagRatio = 0.45 * bag.torsoLength / bag.shoulderWidth;
  assert.ok(bagRatio > 0.72 && bagRatio < 1.35, `bag scaleX ratio ${bagRatio} hits the clamp`);
});
