// The garment is drawn over the camera picture, so on its own it covers
// whatever is in front of it: your arms, your chin, the room behind you. This
// layer paints those camera pixels back on top, which reads as the garment
// sitting behind them:
//   * outside your silhouette, from the pose model's body mask;
//   * over your head and neck, from the face landmarks — except for a hat,
//     which has to cover the head instead of hiding behind it.
// Everything stays on this device; it only reuses frames already on screen.

const HEAD = { nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8, leftMouth: 9, rightMouth: 10 };
const SHOULDERS = [11, 12];
// The mask edge is soft. Widening it keeps sleeve and hem edges from being
// nibbled away while the body outline still cuts the garment to shape.
const MASK_GAIN = 2.4;
const MASK_BLUR = 4;
// Past this age a mask says more about where you were than where you are.
const STALE_MASK = 220;

const maskCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');

// A <video> reports videoWidth/videoHeight; a photo (<img>) reports
// naturalWidth/naturalHeight. Both are drawable frames.
const sourceSize = source => ({
  width: source.videoWidth || source.naturalWidth || 0,
  height: source.videoHeight || source.naturalHeight || 0,
});

const usable = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && (point.visibility === undefined || point.visibility >= 0.5);

function headAndNeckPath(ctx, landmarks, width, height) {
  const points = Object.fromEntries(Object.entries(HEAD)
    .map(([name, index]) => [name, landmarks[index]]));
  const shoulders = SHOULDERS.map(index => landmarks[index]);
  if (!Object.values(points).every(usable) || !shoulders.every(usable)) return false;

  const at = point => ({ x: point.x * width, y: point.y * height });
  const nose = at(points.nose);
  const leftEar = at(points.leftEar);
  const rightEar = at(points.rightEar);
  const mouth = {
    x: (points.leftMouth.x + points.rightMouth.x) / 2 * width,
    y: (points.leftMouth.y + points.rightMouth.y) / 2 * height,
  };
  const eyes = (points.leftEye.y + points.rightEye.y) / 2 * height;
  const chin = mouth.y + (mouth.y - eyes) * 0.85;
  const headWidth = Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y) * 0.62;
  if (!(headWidth > 0) || !Number.isFinite(chin)) return false;

  const [left, right] = shoulders.map(at);
  const shoulderWidth = Math.hypot(left.x - right.x, left.y - right.y);
  const neckBottom = (left.y + right.y) / 2 - shoulderWidth * 0.24;

  ctx.beginPath();
  ctx.ellipse(nose.x, (nose.y + chin) / 2, headWidth, Math.max(chin - nose.y, 10) * 1.5, 0, 0, Math.PI * 2);
  if (neckBottom > chin) {
    const neckWidth = headWidth * 0.8;
    ctx.moveTo(mouth.x - neckWidth, chin - 5);
    ctx.lineTo(mouth.x + neckWidth, chin - 5);
    ctx.quadraticCurveTo(mouth.x + neckWidth * 1.1, neckBottom, mouth.x, neckBottom);
    ctx.quadraticCurveTo(mouth.x - neckWidth * 1.1, neckBottom, mouth.x - neckWidth, chin - 5);
    ctx.closePath();
  }
  return true;
}

/** Repaints the camera pixels that belong in front of the garment. */
export function paintOcclusion(canvas, source, sample, options = {}) {
  if (!canvas || !source) return;
  const { width, height } = sourceSize(source);
  const context = canvas.getContext('2d');
  if (!context || !width || !height) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);

  const landmarks = sample?.landmarks;
  if (!Array.isArray(landmarks)) return;
  const mask = sample.mask;

  // The mask describes where you were when its frame was captured. The older
  // it is, the more it is widened and softened, so a moving body is never
  // sliced by its own outline from a moment ago.
  const age = Math.max(0, performance.now() - (sample.time ?? performance.now()));
  if (mask && maskCanvas && age < STALE_MASK) {
    const gain = MASK_GAIN + age / 60;
    const blur = MASK_BLUR + age / 25;
    // Keep the camera picture everywhere you are not, so the garment cannot
    // spill over the room behind you.
    if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
      maskCanvas.width = mask.width;
      maskCanvas.height = mask.height;
    }
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    const outside = maskContext.createImageData(mask.width, mask.height);
    for (let index = 0; index < mask.coverage.length; index++) {
      outside.data[index * 4 + 3] = 255 - Math.min(255, mask.coverage[index] * gain);
    }
    maskContext.putImageData(outside, 0, 0);

    context.drawImage(source, 0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    context.filter = `blur(${blur}px)`;
    context.drawImage(maskCanvas, 0, 0, width, height);
    context.filter = 'none';
    context.globalCompositeOperation = 'source-over';
  }

  context.save();
  if (!options.skipHead && headAndNeckPath(context, landmarks, width, height)) {
    context.clip();
    context.drawImage(source, 0, 0, width, height);
  }
  context.restore();
}

/**
 * How bright the room is, from the light on your face: the garment is lit to
 * match instead of always looking like a studio render.
 */
export function measureRoomLight(probe, source, landmarks) {
  const nose = landmarks?.[HEAD.nose];
  const [left, right] = SHOULDERS.map(index => landmarks?.[index]);
  if (!probe || !usable(nose) || !usable(left) || !usable(right)) return null;
  const { width, height } = sourceSize(source);
  const size = Math.hypot((left.x - right.x) * width, (left.y - right.y) * height) * 0.35;
  if (!(size > 1)) return null;

  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(source, nose.x * width - size / 2, nose.y * height - size / 2, size, size, 0, 0, probe.width, probe.height);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      total += (data[index] * 0.3 + data[index + 1] * 0.59 + data[index + 2] * 0.11) / 255;
    }
    return Math.min(1, Math.max(0.15, total / (data.length / 4) * 1.3));
  } catch {
    return null;
  }
}
