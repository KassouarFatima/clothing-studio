/* eslint-env node */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPoseTracker } from './poseTracker.js';

function fakeRuntime(t, capture) {
  const originalWorker = globalThis.Worker;
  const originalCapture = globalThis.createImageBitmap;
  const workers = [];
  class FakeWorker {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message, transfers) { this.messages.push({ message, transfers }); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  }
  globalThis.Worker = FakeWorker;
  globalThis.createImageBitmap = capture;
  t.after(() => {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
    if (originalCapture === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalCapture;
  });
  return workers;
}

const video = () => ({ readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 1 });

test('abort during initialization terminates the worker and rejects the pending tracker', async t => {
  const workers = fakeRuntime(t, async () => ({}));
  const controller = new AbortController();
  const pending = createPoseTracker({ signal: controller.signal });
  assert.equal(workers[0].messages[0].message.type, 'init');
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(workers[0].terminated, true);
});

test('closing while a bitmap is being created closes that late bitmap without transfer', async t => {
  let finishCapture;
  let bitmapClosed = false;
  const workers = fakeRuntime(t, () => new Promise(resolve => { finishCapture = resolve; }));
  const pending = createPoseTracker();
  workers[0].reply({ type: 'ready' });
  const tracker = await pending;
  const detecting = tracker.detect(video());
  tracker.close();
  finishCapture({ close: () => { bitmapClosed = true; } });
  await detecting;
  assert.equal(bitmapClosed, true);
  assert.equal(workers[0].messages.length, 1);
  assert.equal(workers[0].terminated, true);
});

test('only one resized camera frame is in flight and a matching result reaches the caller', async t => {
  let captures = 0;
  let options;
  const bitmap = { close() {} };
  const workers = fakeRuntime(t, async (_, settings) => { captures += 1; options = settings; return bitmap; });
  const poses = [];
  const pending = createPoseTracker({ onPose: pose => poses.push(pose) });
  const worker = workers[0];
  worker.reply({ type: 'ready' });
  const tracker = await pending;
  t.after(() => tracker.close());
  await tracker.detect(video());
  await tracker.detect({ ...video(), currentTime: 2 });
  assert.equal(captures, 1);
  assert.equal(options.resizeWidth, 640);
  assert.equal(options.resizeHeight, 360);
  assert.deepEqual(worker.messages[1].transfers, [bitmap]);
  worker.reply({ type: 'pose', frameId: 99, landmarks: [] });
  assert.deepEqual(poses, []);
  worker.reply({ type: 'pose', frameId: 1, landmarks: null });
  assert.deepEqual(poses, [null]);
});

test('a chosen photo is analysed once, and a new photo re-arms detection', async t => {
  let captures = 0;
  const workers = fakeRuntime(t, async () => { captures += 1; return { close() {} }; });
  const originalNow = performance.now;
  let ticks = 1000;
  performance.now = () => (ticks += 100); // every call lands in a fresh frame window
  t.after(() => { performance.now = originalNow; });
  const pending = createPoseTracker();
  workers[0].reply({ type: 'ready' });
  const tracker = await pending;
  t.after(() => tracker.close());
  const first = { naturalWidth: 900, naturalHeight: 1200 }; // a photo has no currentTime
  await tracker.detect(first);
  workers[0].reply({ type: 'pose', frameId: 1, landmarks: [] });
  await tracker.detect(first); // the same picture has nothing new to analyse
  assert.equal(captures, 1);
  await tracker.detect({ naturalWidth: 900, naturalHeight: 1200 }); // another picture
  assert.equal(captures, 2);
});

test('a precise still photo is captured at its own resolution, the camera stays light', async t => {
  let options;
  const workers = fakeRuntime(t, async (_, settings) => { options = settings; return { close() {} }; });
  const originalNow = performance.now;
  let ticks = 5000;
  performance.now = () => (ticks += 100);
  t.after(() => { performance.now = originalNow; });
  const pending = createPoseTracker({ precise: true });
  assert.equal(workers[0].messages[0].message.precise, true); // the heavy ML model is asked for
  workers[0].reply({ type: 'ready' });
  const tracker = await pending;
  t.after(() => tracker.close());
  await tracker.detect({ naturalWidth: 1200, naturalHeight: 1800 });
  assert.equal(options.resizeWidth, 853); // 1280 cap on the long side, not the camera's 640
  assert.equal(options.resizeHeight, 1280);
  assert.equal(options.resizeQuality, 'high');
});

test('a runtime worker failure releases resources and reports exactly one error', async t => {
  const workers = fakeRuntime(t, async () => ({}));
  const errors = [];
  const pending = createPoseTracker({ onError: error => errors.push(error) });
  const worker = workers[0];
  worker.reply({ type: 'ready' });
  await pending;
  worker.reply({ type: 'error', message: 'WebGL context lost' });
  worker.reply({ type: 'error', message: 'late duplicate' });
  assert.equal(worker.terminated, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'WebGL context lost');
});
