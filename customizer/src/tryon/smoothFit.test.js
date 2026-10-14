/* eslint-env node */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFitSmoother } from './smoothFit.js';

const feed = (smoother, samples, step = 1 / 30) => {
  samples.forEach((values, index) => smoother.push(values, index * step));
  return (samples.length - 1) * step;
};

test('a still pose settles on its value and is not carried anywhere', () => {
  const smoother = createFitSmoother();
  const last = feed(smoother, Array.from({ length: 30 }, () => ({ x: 100, rotation: 0.2 })));
  const fit = smoother.predict(last + 0.05);
  assert.ok(Math.abs(fit.x - 100) < 1e-6);
  assert.ok(Math.abs(fit.rotation - 0.2) < 1e-6);
});

test('camera jitter is smoothed away while the body holds still', () => {
  const smoother = createFitSmoother();
  const jitter = [4, -5, 3, -4, 5, -3, 4, -5, 3, -4, 5, -3, 4, -5, 2, -3];
  const last = feed(smoother, jitter.map(offset => ({ x: 200 + offset })));
  const fit = smoother.predict(last);
  assert.ok(Math.abs(fit.x - 200) < 2, `expected the shake to settle near 200, got ${fit.x}`);
});

test('steady movement is carried forward instead of trailing behind', () => {
  const smoother = createFitSmoother();
  const speed = 600; // pixels per second
  const step = 1 / 30;
  const samples = Array.from({ length: 24 }, (_, index) => ({ x: index * speed * step }));
  const last = feed(smoother, samples, step);
  const latest = samples.at(-1).x;

  // Shown one frame after the sample was captured, the garment should be at
  // least close to where the body has moved on to, not stuck at the sample.
  const shown = smoother.predict(last + step);
  assert.ok(shown.x > latest, `prediction ${shown.x} should lead the last sample ${latest}`);
  assert.ok(Math.abs(shown.x - (latest + speed * step)) < speed * step * 0.6);
});

test('prediction is capped, ignores stale and out-of-order samples, and resets', () => {
  const smoother = createFitSmoother({ maxLead: 0.1 });
  feed(smoother, Array.from({ length: 10 }, (_, index) => ({ x: index * 20 })));
  const capped = smoother.predict(10);
  const atCap = smoother.predict(9 / 30 + 0.1);
  assert.equal(capped.x, atCap.x);

  const before = smoother.predict(9 / 30).x;
  smoother.push({ x: 9999 }, 0); // older than the newest sample
  assert.equal(smoother.predict(9 / 30).x, before);

  assert.equal(smoother.started, true);
  smoother.reset();
  assert.equal(smoother.started, false);
  assert.equal(smoother.predict(1), null);
});

test('values that are not numbers never reach the garment', () => {
  const smoother = createFitSmoother();
  smoother.push({ x: 10, y: NaN }, 0);
  smoother.push({ x: 20, y: undefined }, 1 / 30);
  const fit = smoother.predict(1 / 30);
  assert.ok(Number.isFinite(fit.x));
  assert.equal('y' in fit, false);
});
