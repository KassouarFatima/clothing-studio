/* eslint-env node */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GARMENT_FIT, framingHint, getPoseFit } from './fitPose.js';

function pose() {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  landmarks[11] = { x: 0.65, y: 0.25, visibility: 0.95 };
  landmarks[12] = { x: 0.35, y: 0.25, visibility: 0.95 };
  landmarks[23] = { x: 0.60, y: 0.65, visibility: 0.95 };
  landmarks[24] = { x: 0.40, y: 0.65, visibility: 0.95 };
  return landmarks;
}

test('centers the garment below shoulders and keeps its shoulder line anchored', () => {
  const fit = getPoseFit(pose(), 640, 480);
  assert.equal(fit.visible, true);
  assert.equal(fit.center.x, 320);
  assert.equal(fit.rotation, 0);
  assert.ok(Math.abs(fit.center.y - GARMENT_FIT.tshirt.shoulderY * fit.scaleY - 120) < 1e-8);
});

test('viewport resizing scales the same fit without changing rotation', () => {
  const small = getPoseFit(pose(), 640, 480);
  const large = getPoseFit(pose(), 1280, 960);
  assert.equal(large.center.x, small.center.x * 2);
  assert.equal(large.center.y, small.center.y * 2);
  assert.equal(large.scaleX, small.scaleX * 2);
  assert.equal(large.scaleY, small.scaleY * 2);
});

test('mirroring both camera axes produces a mirrored center and opposite rotation', () => {
  const landmarks = pose();
  landmarks[23].x += 0.06;
  landmarks[24].x += 0.06;
  landmarks[11].y -= 0.025;
  landmarks[12].y += 0.025;
  const normal = getPoseFit(landmarks, 640, 480);
  const mirrored = getPoseFit(landmarks.map(point => ({ ...point, x: 1 - point.x })), 640, 480);
  assert.ok(normal.rotation > 0);
  assert.ok(Math.abs(mirrored.rotation + normal.rotation) < 1e-8);
  assert.ok(Math.abs(mirrored.center.x + normal.center.x - 640) < 1e-8);
  assert.ok(Math.abs(mirrored.center.y - normal.center.y) < 1e-8);
});

test('missing, low confidence, cropped and narrow sideways poses hide the garment', () => {
  assert.equal(getPoseFit(null, 640, 480).visible, false);
  for (const mutate of [
    landmarks => { landmarks[11].visibility = 0.2; },
    landmarks => { landmarks[12].x = NaN; },
    landmarks => { landmarks[11].x = 0.51; landmarks[12].x = 0.49; },
    landmarks => { landmarks[23].y = 0.05; landmarks[24].y = 0.05; },
  ]) {
    const landmarks = pose();
    mutate(landmarks);
    assert.equal(getPoseFit(landmarks, 640, 480).visible, false);
  }
});

test('a top fits from the shoulders alone, while a dress waits for the hips', () => {
  const landmarks = pose();
  landmarks[23].y = 1.1;
  landmarks[24].y = 1.1;
  const shirt = getPoseFit(landmarks, 640, 480, 'tshirt');
  assert.equal(shirt.visible, true);
  assert.equal(shirt.hipsVisible, false);
  assert.equal(getPoseFit(landmarks, 640, 480, 'dress').visible, false);
  assert.equal(getPoseFit(landmarks, 640, 480, 'suit').visible, false);
  assert.equal(getPoseFit(landmarks, 640, 480, 'hoodie').visible, true);

  // The estimated torso follows the model's own proportions, so the garment
  // keeps its shape: width and length scale together from the shoulders.
  const shoulderPixels = (0.65 - 0.35) * 640;
  assert.ok(Math.abs(shirt.scaleX - shoulderPixels / GARMENT_FIT.tshirt.shoulderWidth) < 1e-8);
  assert.ok(Math.abs(shirt.scaleX - shirt.scaleY) < 1e-8);
  assert.equal(shirt.center.x, 320);
  assert.ok(Math.abs(shirt.center.y - GARMENT_FIT.tshirt.shoulderY * shirt.scaleY - 120) < 1e-8);
});

test('shoulders-only fitting still rejects a camera that is too close or sideways', () => {
  const cropped = () => {
    const landmarks = pose();
    landmarks[23].y = 1.1;
    landmarks[24].y = 1.1;
    return landmarks;
  };
  const tooClose = cropped();
  tooClose[11].x = 0.95;
  tooClose[12].x = 0.05;
  assert.equal(getPoseFit(tooClose, 640, 480, 'tshirt').visible, false);

  const sideways = cropped();
  sideways[11].y = 0.55;
  sideways[12].y = 0.1;
  assert.equal(getPoseFit(sideways, 640, 480, 'tshirt').visible, false);
});

test('long garments use torso anchors instead of shrinking the complete outfit into the torso', () => {
  const shirt = getPoseFit(pose(), 640, 480, 'tshirt');
  const suit = getPoseFit(pose(), 640, 480, 'suit');
  const dress = getPoseFit(pose(), 640, 480, 'dress');
  assert.ok(suit.scaleY * 0.75 > shirt.scaleY * 0.613 * 1.5);
  assert.ok(dress.scaleY * 0.75 > shirt.scaleY * 0.613 * 1.5);
  assert.ok(suit.center.y > shirt.center.y);
});

test('manual fit controls are bounded and movement uses body proportions', () => {
  const normal = getPoseFit(pose(), 640, 480);
  const changed = getPoseFit(pose(), 640, 480, 'tshirt', { size: 1.2, verticalOffset: 0.1 });
  assert.ok(Math.abs(changed.scaleY / normal.scaleY - 1.2) < 1e-8);
  assert.ok(Math.abs(changed.center.y - 120 - GARMENT_FIT.tshirt.shoulderY * changed.scaleY - 19.2) < 1e-8);

  // The horizontal offset moves across the torso: a torso-length fraction
  // perpendicular to the body line (rotation is 0 here, so it is screen x).
  const across = getPoseFit(pose(), 640, 480, 'tshirt', { horizontalOffset: 0.25 });
  assert.ok(Math.abs(across.center.x - (320 + 0.25 * 192)) < 1e-8);
  assert.ok(Math.abs(across.center.y - normal.center.y) < 1e-8);

  const extreme = getPoseFit(pose(), 640, 480, 'tshirt', { size: 20, verticalOffset: 10, horizontalOffset: 10 });
  const clamped = getPoseFit(pose(), 640, 480, 'tshirt', { size: 1.3, verticalOffset: 0.4, horizontalOffset: 0.5 });
  assert.deepEqual(extreme, clamped);
  assert.equal(getPoseFit(pose(), 0, 480).visible, false);
});

function headPose() {
  const landmarks = pose();
  landmarks[2] = { x: 0.46, y: 0.12, visibility: 0.99 };
  landmarks[5] = { x: 0.54, y: 0.12, visibility: 0.99 };
  return landmarks;
}

test('pants wait for the hips while the jacket fits like a top', () => {
  const landmarks = pose();
  landmarks[23].y = 1.1;
  landmarks[24].y = 1.1;
  assert.equal(getPoseFit(landmarks, 640, 480, 'pants').visible, false);
  assert.equal(getPoseFit(landmarks, 640, 480, 'jacket').visible, true);
  assert.equal(getPoseFit(landmarks, 640, 480, 'jacket').hipsVisible, false);

  // With hips in frame the leg garments appear and hang below the shoulders.
  const fitted = getPoseFit(pose(), 640, 480, 'pants');
  assert.equal(fitted.visible, true);
  assert.equal(fitted.hipsVisible, true);
  assert.ok(Math.abs(fitted.center.y - 120 - GARMENT_FIT.pants.shoulderY * fitted.scaleY) < 1e-8);
});

test('the bag appears only on a back-facing pose', () => {
  // Front, head-framed and sideways poses keep the bag hidden — the hint
  // tells you to turn around or pick the Back sample model.
  assert.equal(getPoseFit(pose(), 640, 480, 'bag').visible, false);
  assert.equal(getPoseFit(headPose(), 640, 480, 'bag').visible, false);
  const sideways = pose();
  sideways[11].x = 0.5;
  sideways[12].x = 0.5;
  assert.equal(getPoseFit(sideways, 640, 480, 'bag').visible, false);

  // Rear view — anatomical left shoulder (11) on the image's left: the bag
  // fits from the shoulders like a top and hangs mid-back.
  const back = pose();
  back[11].x = 0.35;
  back[12].x = 0.65;
  back[23].y = 1.1; // shoulders-only, so width and length scale together
  back[24].y = 1.1;
  const fit = getPoseFit(back, 640, 480, 'bag');
  const bag = GARMENT_FIT.bag;
  assert.equal(fit.visible, true);
  assert.equal(fit.hipsVisible, false);
  const shoulderPixels = (0.65 - 0.35) * 640;
  assert.ok(Math.abs(fit.scaleX - shoulderPixels / bag.shoulderWidth) < 1e-8);
  assert.ok(Math.abs(fit.scaleX - fit.scaleY) < 1e-8);
  assert.ok(Math.abs(fit.center.y - 120 - bag.shoulderY * fit.scaleY) < 1e-8);

  // With the hips in frame the rear view still fits.
  const backFull = pose();
  backFull[11].x = 0.35;
  backFull[12].x = 0.65;
  assert.equal(getPoseFit(backFull, 640, 480, 'bag').visible, true);
});

test('the hat scales from the eyes and rides above the eye line', () => {
  const fit = getPoseFit(headPose(), 640, 480, 'hat');
  assert.equal(fit.visible, true);
  const expected = (0.54 - 0.46) * 640 * GARMENT_FIT.hat.eyeSpanToHeadSpan
    * GARMENT_FIT.hat.headSpanToWidth / GARMENT_FIT.hat.headWidth;
  assert.ok(Math.abs(fit.scaleX - expected) < 1e-8);
  assert.equal(fit.scaleX, fit.scaleY);
  assert.ok(Math.abs(fit.center.x - 320) < 1e-9);
  assert.ok(Math.abs(fit.center.y - (0.12 * 480 - GARMENT_FIT.hat.headDrop * fit.scaleY)) < 1e-8);
  assert.ok(Math.abs(fit.rotation) < 1e-12);

  const sized = getPoseFit(headPose(), 640, 480, 'hat', { size: 1.2, verticalOffset: 0.1 });
  assert.ok(Math.abs(sized.scaleY / fit.scaleY - 1.2) < 1e-8);
  const expectedY = 0.12 * 480 - GARMENT_FIT.hat.headDrop * sized.scaleY
    + 0.1 * GARMENT_FIT.hat.headHeight * sized.scaleY;
  assert.ok(Math.abs(sized.center.y - expectedY) < 1e-8);
  // The offset keeps the torso convention: positive nudges the garment down.
  assert.ok(sized.center.y > fit.center.y);

  // The hat also moves sideways: a head-span fraction from the eye centre.
  const across = getPoseFit(headPose(), 640, 480, 'hat', { horizontalOffset: 0.5 });
  const faceSpan = (0.54 - 0.46) * 640 * GARMENT_FIT.hat.eyeSpanToHeadSpan;
  assert.ok(Math.abs(across.center.x - (320 + 0.5 * faceSpan)) < 1e-8);
  assert.ok(Math.abs(across.center.y - fit.center.y) < 1e-8);
});

test('the hat follows the face tilt, mirrors with the camera and hides without eyes or ears', () => {
  const landmarks = headPose();
  landmarks[2].x = 0.3;
  landmarks[5].x = 0.38;
  landmarks[5].y = 0.15;
  const tilted = getPoseFit(landmarks, 640, 480, 'hat');
  assert.ok(tilted.rotation < 0);
  const mirrored = getPoseFit(landmarks.map(point => ({ ...point, x: 1 - point.x })), 640, 480, 'hat');
  assert.ok(Math.abs(mirrored.rotation + tilted.rotation) < 1e-8);
  assert.ok(Math.abs(mirrored.center.x + tilted.center.x - 640) < 1e-8);

  const cropped = headPose();
  cropped[2].x = 0.005;
  cropped[5].x = 0.01;
  cropped[7].visibility = 0.2;
  cropped[8].visibility = 0.2;
  assert.equal(getPoseFit(cropped, 640, 480, 'hat').visible, false);
});

test('framing hints describe what each garment needs', () => {
  assert.match(framingHint('pants'), /shoulders to hips/);
  assert.match(framingHint('jacket'), /head and shoulders/);
  assert.match(framingHint('hat'), /face/);
  assert.match(framingHint('bag'), /behind/);
});
