// Measurements refer to each centered Garment's local coordinates, after the
// same normalization used by the showroom. Fit the torso, not a long garment's
// complete bounds: a dress hem and suit trousers must extend below the hips.
// needsHips: a top is fitted from the shoulders alone when the hips are out of
// frame, so a T-shirt only asks for the upper body. A dress, a suit and pants
// cover the legs, so they stay hidden until the hips are visible.
// fitMode 'head' scales a hat from the eye line instead of the shoulders.
// The bag is worn from the shoulders like a top: its normalized box renders
// about as wide as the shoulders and covers roughly seven tenths of the
// torso — where a daypack sits on your back (see the Back sample model).
export const GARMENT_FIT = Object.freeze({
  tshirt: { shoulderWidth: 0.34, torsoLength: 0.52, shoulderY: 0.245, needsHips: false },
  hoodie: { shoulderWidth: 0.365, torsoLength: 0.50, shoulderY: 0.215, needsHips: false },
  dress: { shoulderWidth: 0.27, torsoLength: 0.36, shoulderY: 0.35, needsHips: true },
  suit: { shoulderWidth: 0.186, torsoLength: 0.275, shoulderY: 0.328, needsHips: true },
  pants: { shoulderWidth: 0.35, torsoLength: 0.50, shoulderY: 0.875, needsHips: true },
  jacket: { shoulderWidth: 0.3564, torsoLength: 0.5268, shoulderY: 0.2286, needsHips: false },
  hat: { fitMode: 'head', headWidth: 0.66, headSpanToWidth: 1.2, eyeSpanToHeadSpan: 2.46, headDrop: 0.21, headHeight: 0.504, needsHips: false },
  bag: { shoulderWidth: 0.6, torsoLength: 1.05, shoulderY: 0.36, needsHips: false },
});

export function framingHint(garment = 'tshirt') {
  const profile = GARMENT_FIT[garment] || GARMENT_FIT.tshirt;
  if (garment === 'bag') return 'The backpack shows best from behind: turn around, or pick the Back sample model';
  if (profile.fitMode === 'head') return 'Keep your face and head visible so the hat can follow you';
  return profile.needsHips
    ? 'Step back so your whole body, from shoulders to hips, is visible'
    : 'Step back so your head and shoulders are visible';
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const hiddenFit = () => ({
  center: { x: 0, y: 0 }, scaleX: 0, scaleY: 0, rotation: 0,
  visible: false, hipsVisible: false, confidence: 0,
});

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Number.isFinite(point.visibility) && point.visibility >= 0.55
    && (point.presence === undefined || point.presence >= 0.5)
    && point.x >= 0.015 && point.x <= 0.985
    && point.y >= 0.015 && point.y <= 0.985;
}

// BlazePose labels are anatomical, so on a clearly back-facing pose the
// person's left shoulder (11) lands on the image's LEFT half — mirrored
// when they face the camera. Face landmarks cannot decide this: the model
// still reports the eyes with high confidence on a rear view.
function backFacing(landmarks) {
  const left = landmarks[11];
  const right = landmarks[12];
  return Boolean(left && right && Number.isFinite(left.x) && Number.isFinite(right.x)
    && left.x < right.x - 0.02);
}

const EYE_POINTS = [2, 5];
const EAR_POINTS = [7, 8];

// A hat sits on the head, not the shoulders: scale it from the distance
// between the eyes (falling back to the ears), keep it above that line by a
// fixed model-space drop, and tilt it with the face instead of the torso.
function fitHead(landmarks, width, height, profile, adjustments) {
  const toPixels = point => ({ x: point.x * width, y: point.y * height });
  const eyes = EYE_POINTS.map(index => landmarks[index]);
  const ears = EAR_POINTS.map(index => landmarks[index]);
  const useEyes = eyes.every(validPoint);
  const axis = useEyes ? eyes : ears.every(validPoint) ? ears : null;
  if (!axis) return hiddenFit();

  const [first, second] = axis;
  const [left, right] = first.x <= second.x
    ? [toPixels(first), toPixels(second)] : [toPixels(second), toPixels(first)];
  const anchor = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const faceSpan = Math.hypot(left.x - right.x, left.y - right.y);
  const span = faceSpan * (useEyes ? profile.eyeSpanToHeadSpan : 1);
  if (span < width * 0.03 || span > width * 0.7) return hiddenFit();

  const rotation = Math.atan2(-(right.y - left.y), right.x - left.x);
  if (Math.abs(rotation) > 0.9) return hiddenFit();

  const size = clamp(finiteOr(adjustments.size, 1), 0.75, 1.3);
  const verticalOffset = clamp(finiteOr(adjustments.verticalOffset, 0), -0.4, 0.4);
  const horizontalOffset = clamp(finiteOr(adjustments.horizontalOffset, 0), -0.5, 0.5);
  const scale = span * profile.headSpanToWidth / profile.headWidth * size;
  return {
    center: {
      // The horizontal offset is a head-span fraction, so the hat can sit at
      // any spot on the head, not only dead centre of the eye line.
      x: anchor.x + horizontalOffset * span,
      // The model's origin sits headDrop above the anchor line, and the
      // Position slider nudges the hat along its own height.
      y: anchor.y - profile.headDrop * scale + verticalOffset * profile.headHeight * scale,
    },
    scaleX: scale, scaleY: scale, rotation, visible: true, hipsVisible: false,
    confidence: Math.min(...axis.map(point => point.visibility)),
  };
}

/**
 * Fits an already-centered showroom garment to normalized camera landmarks.
 * center uses top-left-origin PIXELS; scales are PIXELS per model world unit;
 * rotation uses Three's y-up z rotation. Mirror video and overlay together in
 * CSS, rather than flipping one side's landmarks or the garment texture.
 * adjustments.size changes the fit; verticalOffset and horizontalOffset are
 * torso-length fractions (down the torso and across it), so the garment can
 * be placed anywhere on the body, not only on the centre line.
 */
export function getPoseFit(landmarks, width, height, garment = 'tshirt', adjustments = {}) {
  if (!Array.isArray(landmarks) || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return hiddenFit();

  const profile = GARMENT_FIT[garment] || GARMENT_FIT.tshirt;
  if (profile.fitMode === 'head') return fitHead(landmarks, width, height, profile, adjustments);
  const shoulderPoints = [landmarks[11], landmarks[12]];
  const hipPoints = [landmarks[23], landmarks[24]];
  if (!shoulderPoints.every(validPoint)) return hiddenFit();
  // A backpack is worn on the back: on a front or sideways pose it stays
  // hidden and the framing hint asks you to turn around (or pick the Back
  // sample model) instead of drawing the pack over your chest.
  if (garment === 'bag' && !backFacing(landmarks)) return hiddenFit();
  const hipsVisible = hipPoints.every(validPoint);
  if (profile.needsHips && !hipsVisible) return hiddenFit();

  const toPixels = point => ({ x: point.x * width, y: point.y * height });
  const [leftShoulder, rightShoulder] = shoulderPoints.map(toPixels);
  const shoulders = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
  const shoulderWidth = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
  if (shoulderWidth < width * 0.06) return hiddenFit();
  const [screenLeft, screenRight] = leftShoulder.x <= rightShoulder.x
    ? [leftShoulder, rightShoulder] : [rightShoulder, leftShoulder];
  const shoulderRotation = Math.atan2(-(screenRight.y - screenLeft.y), screenRight.x - screenLeft.x);

  let torsoLength;
  let rotation;
  if (hipsVisible) {
    const [leftHip, rightHip] = hipPoints.map(toPixels);
    const hips = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
    const torsoX = hips.x - shoulders.x;
    const torsoY = hips.y - shoulders.y;
    torsoLength = Math.hypot(torsoX, torsoY);

    // Reject unreliable tiny, sideways, cropped or upside-down detections instead
    // of leaving an enormous or drifting garment over an unrelated camera view.
    if (torsoY < height * 0.10 || torsoLength < height * 0.12
      || shoulderWidth / torsoLength < 0.40
      || shoulderWidth / torsoLength > 1.8 || torsoLength > height * 0.82) return hiddenFit();

    const torsoRotation = Math.atan2(torsoX, torsoY);
    rotation = clamp(torsoRotation * 0.6 + shoulderRotation * 0.4, -0.7, 0.7);
  } else {
    // Upper body only: the torso is estimated from the garment's own
    // shoulder-to-hem proportions, so a top still fits from a close-up.
    if (shoulderWidth > width * 0.85 || Math.abs(shoulderRotation) > 0.7) return hiddenFit();
    torsoLength = shoulderWidth * profile.torsoLength / profile.shoulderWidth;
    rotation = shoulderRotation;
  }

  const size = clamp(finiteOr(adjustments.size, 1), 0.75, 1.3);
  const verticalOffset = clamp(finiteOr(adjustments.verticalOffset, 0), -0.4, 0.4);
  const horizontalOffset = clamp(finiteOr(adjustments.horizontalOffset, 0), -0.5, 0.5);
  const scaleY = torsoLength / profile.torsoLength * size;
  const scaleX = clamp(shoulderWidth / profile.shoulderWidth * size, scaleY * 0.72, scaleY * 1.35);
  const downX = Math.sin(rotation);
  const downY = Math.cos(rotation);
  const centerDistance = profile.shoulderY * scaleY + verticalOffset * torsoLength;
  // Across the body: the perpendicular of the down vector, so the horizontal
  // offset follows the torso's tilt. Both offsets are torso-length fractions.
  const acrossX = downY;
  const acrossY = -downX;
  const acrossDistance = horizontalOffset * torsoLength;

  return {
    center: {
      x: shoulders.x + downX * centerDistance + acrossX * acrossDistance,
      y: shoulders.y + downY * centerDistance + acrossY * acrossDistance,
    },
    scaleX, scaleY, rotation, visible: true, hipsVisible,
    confidence: Math.min(...(hipsVisible ? [...shoulderPoints, ...hipPoints] : shoulderPoints)
      .map(point => point.visibility)),
  };
}
