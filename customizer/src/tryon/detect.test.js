/* eslint-env node */
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPeople, fitStatus, NO_CLEAR_PERSON, NO_PERSON, subjectBox, subjectPoint } from './detect.js';

// A standing body: shoulders at 30 % of the height, hips at 70 %.
function landmarks() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[11] = { x: 0.42, y: 0.30 };
  points[12] = { x: 0.58, y: 0.30 };
  points[23] = { x: 0.46, y: 0.70 };
  points[24] = { x: 0.54, y: 0.70 };
  return points;
}

const box = (score = 0.9, xyxy = [0.3, 0.05, 0.75, 0.9]) =>
  ({ label: 'person', score, xyxy });

const response = payload => ({ ok: true, json: async () => payload });
const photo = { name: 'photo.jpg' };

test('no photo means no request — the detector is never reached', async () => {
  let called = false;
  const result = await detectPeople(null, { fetcher: async () => { called = true; return response({ ok: true, boxes: [] }); } });
  assert.equal(called, false);
  assert.deepEqual(result, { down: true, boxes: [], count: 0 });
});

test('a service that is not running falls back quietly (down, not an error)', async () => {
  const result = await detectPeople(photo, {
    fetcher: async () => { throw new TypeError('fetch failed'); },
  });
  assert.deepEqual(result, { down: true, boxes: [], count: 0 });
});

test('a failing or nonsense service is treated as absent', async () => {
  const httpError = await detectPeople(photo, { fetcher: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(httpError.down, true);
  const garbage = await detectPeople(photo, { fetcher: async () => ({ ok: true, json: async () => { throw new SyntaxError('no json'); } }) });
  assert.equal(garbage.down, true);
  const notOk = await detectPeople(photo, { fetcher: async () => response({ ok: false, error: 'x' }) });
  assert.equal(notOk.down, true);
});

test('a hanging service gives up after its deadline instead of blocking Wear it', async () => {
  const result = await detectPeople(photo, {
    giveUpMs: 20,
    fetcher: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      void url;
    }),
  });
  assert.deepEqual(result, { down: true, boxes: [], count: 0 });
});

test('an already-aborted caller never waits for the detector', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await detectPeople(photo, {
    signal: controller.signal,
    fetcher: async () => response({ ok: true, boxes: [box()] }),
  });
  assert.equal(result.down, true);
});

test('valid person boxes survive, broken entries are dropped', async () => {
  const result = await detectPeople(photo, {
    fetcher: async () => response({
      ok: true,
      boxes: [
        box(0.91),
        { label: 'person', score: 0.5, xyxy: [0.8, 0.1, 0.4, 0.9] }, // reversed
        { label: 'person', score: 'high', xyxy: [0.1, 0.1, 0.2, 0.5] }, // not a number
        { label: 'backpack', score: 0.8, xyxy: [0.1, 0.1, 0.2, 0.5] }, // not a person
        { label: 'person', score: 0.7, xyxy: [0.2, 0.2, 0.2, 0.5] }, // zero width
      ],
    }),
  });
  assert.equal(result.down, false);
  assert.equal(result.count, 1);
  assert.equal(result.boxes[0].score, 0.91);
});

test('the measured body is located inside the detected person', () => {
  const boxes = [box(0.9, [0.3, 0.05, 0.75, 0.9]), box(0.6, [0.02, 0.02, 0.2, 0.4])];
  const subject = subjectBox(boxes, landmarks());
  assert.ok(subject, 'the torso centre must sit in the main person box');
  assert.equal(subject.score, 0.9);
  // Nobody at all -> the pose, if any, landed on something else.
  assert.equal(subjectBox([], landmarks()), null);
  assert.equal(subjectBox([box(0.9, [0.0, 0.0, 0.2, 0.3])], landmarks()), null);
  assert.equal(subjectBox(undefined, landmarks()), null);
});

test('the subject point averages what is visible of the body', () => {
  const all = subjectPoint(landmarks());
  assert.equal(Math.round(all.x * 100), 50);
  assert.equal(Math.round(all.y * 100), 50);
  const onlyShoulders = subjectPoint(landmarks().map((point, index) => (index >= 23 ? null : point)));
  assert.equal(Math.round(onlyShoulders.y * 100), 30);
  assert.equal(subjectPoint([]), null);
  assert.equal(subjectPoint(undefined), null);
});

test('the status line tells the photo the truth', () => {
  const hidden = fitStatus(false, { down: false, count: 1 }, 'tshirt');
  assert.match(hidden, /head and shoulders/);
  const plain = fitStatus(true, { down: true, count: 0 }, 'tshirt');
  assert.equal(plain, 'Fit ready — adjust Size and Position');
  const single = fitStatus(true, { down: false, count: 1 }, 'tshirt');
  assert.equal(single, 'Fit ready — adjust Size and Position');
  const crowd = fitStatus(true, { down: false, count: 2 }, 'tshirt');
  assert.match(crowd, /several people/);
});

test('the two photo refusals carry their own message', () => {
  assert.match(NO_PERSON, /No person was found/);
  assert.match(NO_CLEAR_PERSON, /line the fit up/);
});
