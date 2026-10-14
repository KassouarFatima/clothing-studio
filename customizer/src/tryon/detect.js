// detect.js — Wear it's second pair of eyes: OpenCV + YOLOv8 through the
// local detector service (detect/server.py on 127.0.0.1:8081). The detector
// says how many people are in the photo and which detected person the pose
// must sit on. Nothing leaves this machine, and when the service is not
// running every helper below degrades to the pose-only behaviour Wear it
// always had.
import { framingHint } from './fitPose.js';

const DETECT_URL = 'http://127.0.0.1:8081/detect';
// Landmarks may sit a touch outside the box (arms, loose clothes); the torso
// centre still has to be clearly inside the person the pose claims to measure.
const SUBJECT_PAD = 0.06;

export const NO_PERSON = 'No person was found in this photo. Choose one where your upper body is clearly visible.';
export const NO_CLEAR_PERSON = 'We could not line the fit up with a person in this photo. Choose another picture where you stand clearly.';

const validBox = box => Boolean(box) && box.label === 'person'
  && Number.isFinite(box.score) && box.score > 0 && box.score <= 1
  && Array.isArray(box.xyxy) && box.xyxy.length === 4
  && box.xyxy.every(edge => Number.isFinite(edge) && edge >= 0 && edge <= 1)
  && box.xyxy[2] > box.xyxy[0] && box.xyxy[3] > box.xyxy[1];

const absent = () => ({ down: true, boxes: [], count: 0 });

/**
 * POST the photo bytes to the local detector. It never throws and never
 * blocks Wear it: an absent, slow or broken service comes back {down:true}
 * so the pose-only path takes over unchanged.
 */
export async function detectPeople(photo, { fetcher, signal, giveUpMs = 4000 } = {}) {
  const request = fetcher === undefined ? (typeof fetch === 'function' ? fetch : null) : fetcher;
  if (!request || !photo) return absent();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), giveUpMs);
  const relay = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', relay, { once: true });
  try {
    // The caller gave up before we even asked: answer at once.
    if (controller.signal.aborted) return absent();
    const response = await request(DETECT_URL, { method: 'POST', body: photo, signal: controller.signal });
    if (!response || !response.ok) return absent();
    const data = await response.json();
    if (!data || data.ok !== true || !Array.isArray(data.boxes)) return absent();
    const boxes = data.boxes.filter(validBox);
    return { down: false, boxes, count: boxes.length };
  } catch {
    return absent();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

/** The body the pose measured, in the photo's 0..1 coordinates: the
 * shoulders, with the hips when they are visible (a close-up still counts). */
export function subjectPoint(landmarks) {
  const usable = points => (points || []).filter(point => point
    && Number.isFinite(point.x) && Number.isFinite(point.y));
  const shoulders = usable([landmarks?.[11], landmarks?.[12]]);
  const hips = usable([landmarks?.[23], landmarks?.[24]]);
  const points = shoulders.length ? shoulders.concat(hips) : hips;
  if (!points.length) return null;
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Which detected person the pose landed on — null when the landmarks sit
 * on none of them (the pose locked onto noise, not a person). */
export function subjectBox(boxes, landmarks) {
  const point = subjectPoint(landmarks);
  if (!point || !Array.isArray(boxes)) return null;
  return boxes.find(box => validBox(box)
    && point.x >= box.xyxy[0] - SUBJECT_PAD && point.x <= box.xyxy[2] + SUBJECT_PAD
    && point.y >= box.xyxy[1] - SUBJECT_PAD && point.y <= box.xyxy[3] + SUBJECT_PAD) || null;
}

/** The status line, now that a detector can vouch for the photo:
 * invisible fit -> the garment's own framing hint; several people -> say so. */
export function fitStatus(visible, detector, garment) {
  if (!visible) return framingHint(garment);
  if (detector && !detector.down && detector.count > 1) {
    return 'Fit ready — several people in the photo: the size follows the person measured';
  }
  return 'Fit ready — adjust Size and Position';
}
