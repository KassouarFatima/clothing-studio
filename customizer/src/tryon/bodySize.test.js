/* eslint-env node */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSize, measureBody, predictSize } from './bodySize.js';

// A 1000x1000 photo: shoulders at 30 % of the height, hips at 70 %, a
// silhouette 240 px wide, and a wider 400 px band across the shoulders — a
// real body is always narrower below the shoulders than at them. The torso is
// exactly 0.5 m in the model's metric frame, which calibrates 0.125 cm per
// pixel.
function landmarks() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[11] = { x: 0.42, y: 0.30, visibility: 1 };
  points[12] = { x: 0.58, y: 0.30, visibility: 1 };
  points[23] = { x: 0.46, y: 0.70, visibility: 1 };
  points[24] = { x: 0.54, y: 0.70, visibility: 1 };
  return points;
}

function worldLandmarks() {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  points[11] = { x: 0.2, y: 0.45, z: 0 };
  points[12] = { x: -0.2, y: 0.45, z: 0 };
  points[23] = { x: 0.12, y: -0.05, z: 0 };
  points[24] = { x: -0.12, y: -0.05, z: 0 };
  return points;
}

function mask({
  columns = [380, 619], rows = [250, 780],
  // A real body is narrower below the shoulders than at them: the arms only
  // separate from the torso further down.
  shoulder = { columns: [300, 699], rows: [315, 365] },
  extra = [], width = 1000, height = 1000,
} = {}) {
  const coverage = new Uint8Array(width * height);
  const fill = ([from, to], [top, bottom]) => {
    for (let y = top; y <= bottom; y++) {
      for (let x = from; x <= to; x++) coverage[y * width + x] = 255;
    }
  };
  fill(columns, rows);
  if (shoulder) fill(shoulder.columns, shoulder.rows);
  for (const block of extra) fill(block.columns ?? columns, block.rows ?? rows);
  return { coverage, width, height };
}

const measured = () => measureBody(landmarks(), worldLandmarks(), mask(), 1000, 1000);

test('the silhouette gives girths in centimetres and the torso calibrates them', () => {
  const body = measured();
  assert.ok(Math.abs(body.torsoCm - 50) < 1e-8);
  assert.ok(Math.abs(body.shoulderCm - 50) < 1e-8); // 400 px x 0.125 cm/px
  // Below the shoulders the body is narrower, so the girth is read clean:
  // 240 px x 0.125 cm/px x 2.8 — never through the arms.
  assert.ok(Math.abs(body.chestCm - 84) < 1e-8);
  // This silhouette reads the same width at every level, so the waist meets
  // the clamp that keeps it under the chest it hangs from.
  assert.ok(Math.abs(body.waistCm - 84 * 0.92) < 1e-8);
  assert.ok(Math.abs(body.hipCm - 84) < 1e-8);
});

test('the size letters follow the unisex chart, tops by chest and bottoms by waist', () => {
  const body = measured();
  assert.equal(predictSize('tshirt', body).size, 'XS'); // chest 84 cm
  assert.equal(predictSize('dress', body).size, 'XS');
  assert.equal(predictSize('hoodie', body).size, 'XS');
  assert.equal(predictSize('pants', body).size, 'M'); // waist 77 cm (84 x 0.92)
  assert.equal(predictSize('pants', body).basis, 'waist');

  // One size per letter step, straight from the chest number.
  const chest = value => predictSize('tshirt', { ...body, chestCm: value }).size;
  assert.equal(chest(88), 'XS');
  assert.equal(chest(94), 'S');
  assert.equal(chest(100), 'M');
  assert.equal(chest(106), 'L');
  assert.equal(chest(112), 'XL');
  assert.equal(chest(118), 'XXL');
  assert.equal(chest(126), 'XXXL');
});

test('the cap and the backpack are one size and are never given a body size', () => {
  const body = measured();
  assert.equal(predictSize('hat', body).size, 'One size');
  assert.equal(predictSize('bag', body).size, 'One size');
  assert.match(describeSize(predictSize('bag', body)), /one size/i);
});

test('a missing measurement is reported, never turned into a size', () => {
  assert.equal(predictSize('tshirt', null), null);
  assert.equal(predictSize('tshirt', { chestCm: null, waistCm: 80 }), null);
  assert.match(describeSize(null), /Not enough of you is in frame/);
});

test('a cropped photo keeps the lines it can still read', () => {
  // The photo ends at the waist: the hip row is outside the silhouette.
  const body = measureBody(landmarks(), worldLandmarks(), mask({ rows: [250, 500] }), 1000, 1000);
  assert.ok(Math.abs(body.chestCm - 84) < 1e-8);
  assert.equal(body.hipCm, null);
  assert.equal(predictSize('pants', body), null); // no waist below 500 either
});

test('somebody standing beside the subject cannot widen the measurement', () => {
  const body = measureBody(landmarks(), worldLandmarks(), mask({ extra: [{ columns: [820, 950], rows: [200, 800] }] }), 1000, 1000);
  assert.ok(Math.abs(body.chestCm - 84) < 1e-8);
});

test('impossible detections report nothing at all', () => {
  assert.equal(measureBody(null, worldLandmarks(), mask(), 1000, 1000), null);
  assert.equal(measureBody(landmarks(), null, mask(), 1000, 1000), null);
  assert.equal(measureBody(landmarks(), worldLandmarks(), null, 1000, 1000), null);
  assert.equal(measureBody(landmarks(), worldLandmarks(), mask(), 0, 1000), null);
  // A 10 px silhouette is a misdetection, not a person: every line is dropped.
  const body = measureBody(landmarks(), worldLandmarks(), mask({ columns: [495, 505], shoulder: null }), 1000, 1000);
  assert.equal(body.shoulderCm, null);
  assert.equal(body.chestCm, null);
  assert.equal(predictSize('tshirt', body), null);
});

test('a girth read through the arms falls back to the ratio a body keeps', () => {
  // Arms held close never separate from the torso, so every level reads
  // shoulders-plus-arms: a 50 cm silhouette at the chest and at the shoulder
  // alike. No body has that, so the estimate comes from the shoulder instead.
  const merged = mask({ columns: [300, 699], rows: [250, 780], shoulder: null });
  const body = measureBody(landmarks(), worldLandmarks(), merged, 1000, 1000);
  assert.ok(Math.abs(body.shoulderCm - 50) < 1e-8);
  assert.ok(Math.abs(body.chestCm - 120) < 1e-8); // shoulders 50 cm x 2.4
  assert.ok(Math.abs(body.waistCm - 120 * 0.92) < 1e-8); // clamped to chest x 0.92
  assert.ok(Math.abs(body.hipCm - 140) < 1e-8); // never narrower than the chest
});

test('a reclining pose is refused instead of measured through its own shadow', () => {
  // The model still reports a correct 0.5 m torso, but the shoulder and hip
  // sit close together in the photo — a body lying down or bent forward.
  // Every pixel then stands for far more centimetres, and the girths would
  // come out monstrous; refusing beats inventing an XXXL.
  const points = landmarks();
  points[11] = { x: 0.42, y: 0.45, visibility: 1 };
  points[12] = { x: 0.58, y: 0.45, visibility: 1 };
  points[23] = { x: 0.46, y: 0.55, visibility: 1 };
  points[24] = { x: 0.54, y: 0.55, visibility: 1 };
  const wide = mask({ columns: [100, 899], rows: [400, 600], shoulder: null });
  assert.equal(measureBody(points, worldLandmarks(), wide, 1000, 1000), null);
  assert.match(describeSize(predictSize('tshirt', null)), /Not enough of you is in frame/);
});

test('a mask smaller than the photo is scaled back into image pixels', () => {
  // The pose model caps its mask at 1280 px while the photo can be far larger.
  // Reading the mask's raw pixels as image pixels would understate every
  // girth by that ratio — on a real photo, by a third.
  const width = 1200;
  const height = 1800;
  const cmPerPx = 50 / (0.4 * height); // a 0.5 m torso over 40 % of the height
  const small = mask({
    width: 853, height: 1280, columns: [250, 550], rows: [200, 1000],
    shoulder: { columns: [150, 650], rows: [405, 465] }, // the shoulder band, in mask rows
  });
  const body = measureBody(landmarks(), worldLandmarks(), small, width, height);
  const frontal = 301 * (width / 853) * cmPerPx; // 301 mask px = 423 image px
  const shoulderLine = 501 * (width / 853) * cmPerPx;
  assert.ok(Math.abs(body.shoulderCm - shoulderLine) < 1e-9);
  assert.ok(Math.abs(body.chestCm - frontal * 2.8) < 1e-9);
  assert.equal(predictSize('tshirt', body).size, 'XS');
});
