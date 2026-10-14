/**
 * Body size from a single photo: centimetres, then a letter size.
 *
 * A pose model cannot measure you like a tailor, but it hands over two things
 * that together are enough: a metric body frame (its "world" landmarks, in
 * metres) and a silhouette mask of the person.
 *
 * The vertical frame is the trustworthy half. The shoulder-to-hip torso the
 * model reports in metres lands on real bodies (45-55 cm) — while its shoulder
 * JOINTS read about 30 % narrow with the arms down, because the model places
 * them inside the deltoid. So the torso is what calibrates pixels into
 * centimetres, and every girth is then read off the silhouette OUTLINE — the
 * actual body edge, clothing included — never off the joints.
 *
 * A circumference is estimated from the frontal width as an ellipse: a body is
 * roughly 0.75 as deep as it is wide, which makes girth ~ width x 2.8.
 */

const FRONT_TO_GIRTH = 2.8;
// A mask pixel belongs to the person at this confidence (0-255).
const BODY_CONFIDENCE = 100;

// A girth is not one row but a ZONE of the body, read as a percentile of the
// rows in it. The chest is the widest point of the upper torso, the waist the
// narrowest point between bust and hips, the hips the widest point below them
// — which is exactly what a size chart means by those words. A single row
// would be decided by one arm, one gap or one strand of hair instead.
const STEP = 0.02; // rows are sampled every 2 % of the torso
const ZONE_MIN = 0.6; // a zone mostly outside the photo is not read at all
const ZONES = {
  // Below the armpit: higher rows still carry the arms merged with the torso
  // and would read the shoulders as a chest.
  shoulder: { from: 0.05, to: 0.15, percentile: 0.5 },
  // The narrowest rows of the zone are the true torso: the wide ones are the
  // moment the arms still touch it.
  chest: { from: 0.3, to: 0.45, percentile: 0.25 },
  // Above the hip line only: lower than that the legs split and the gap
  // between them would read as an impossibly narrow waist.
  waist: { from: 0.5, to: 0.85, percentile: 0.25 },
  hips: { from: 0.95, to: 1.2, percentile: 0.75 },
};

// The arms are the one thing a silhouette cannot separate from the body: when
// they hang close, every girth reads them too, and no percentile of the rows
// can undo that. The shoulder line knows the difference — a torso is always
// narrower than the shoulders it hangs from — so a girth whose frontal width
// rivals them was measured through the arms, and falls back to the ratio a
// real body keeps. The waist is likewise never much wider than the chest, nor
// the hips much narrower than it.
const ARM_MERGE = 0.9;
const CHEST_OF_SHOULDER = 2.4;
// A natural waist sits at 0.75-0.9 of the chest on real bodies; a reading
// above that is the arms again, and would order a size too big for pants.
const WAIST_OF_CHEST = 0.92;
const HIP_OF_CHEST = 0.9;
const HIP_OF_CHEST_TOP = 1.35; // pear shapes included; above that it is the arms
// A real chest never outruns its own torso by more than this: a larger ratio
// means the pose was reclining or bent, and the calibration is a lie.
const SHORT_TORSO_LIMIT = 2.6;

// Sanity windows in centimetres. Outside them the detection is wrong, not the
// person: they span children to very large adults.
const LIMITS = {
  shoulder: [24, 70],
  chest: [50, 170],
  waist: [40, 160],
  hip: [55, 180],
  torso: [25, 95],
};

const LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
// Typical unisex charts, in centimetres of circumference.
const CHEST_BOUNDS = [91, 97, 103, 109, 115, 121];
const WAIST_BOUNDS = [71, 76, 81, 87, 92, 97];
// Garments sized from the waist, and garments that are not body-sized at all.
const BOTTOMS = ['pants'];
const ONE_SIZE = ['hat', 'bag'];

const finite = value => Number.isFinite(value);
const usable = point => point && finite(point.x) && finite(point.y);
const usableWorld = point => point && finite(point.x) && finite(point.y) && finite(point.z);

/**
 * The width of the person's own silhouette at one image row, in mask pixels.
 * Widening starts at the body's centre line and stops at the first gap, so a
 * chair, a wall or a second person standing beside them cannot widen it.
 */
function silhouetteWidth(mask, row, centre) {
  const y = Math.round(row);
  if (!(y >= 0 && y < mask.height)) return 0;
  const base = y * mask.width;
  let at = Math.round(centre);
  if (!(at >= 0 && at < mask.width)) return 0;
  if (mask.coverage[base + at] < BODY_CONFIDENCE) {
    // Hands clasped in front, a bag held at the hip: look a few pixels each way.
    let start = -1;
    for (let gap = 1; gap <= 8 && start < 0; gap++) {
      if (at - gap >= 0 && mask.coverage[base + at - gap] >= BODY_CONFIDENCE) start = at - gap;
      else if (at + gap < mask.width && mask.coverage[base + at + gap] >= BODY_CONFIDENCE) start = at + gap;
    }
    if (start < 0) return 0;
    at = start;
  }
  let left = at;
  while (left - 1 >= 0 && mask.coverage[base + left - 1] >= BODY_CONFIDENCE) left -= 1;
  let right = at;
  while (right + 1 < mask.width && mask.coverage[base + right + 1] >= BODY_CONFIDENCE) right += 1;
  return right - left + 1;
}

// A measurement outside its window is reported as missing, never as a size.
const within = (value, key) => {
  const [low, high] = LIMITS[key];
  return finite(value) && value >= low && value <= high ? value : null;
};

/**
 * Body measurements in centimetres from one detection.
 * Returns null when the pose, its metric frame or its silhouette is unusable;
 * individual fields are null when that one line could not be read.
 */
export function measureBody(landmarks, worldLandmarks, mask, width, height) {
  if (!Array.isArray(landmarks)
    || !usable(landmarks[11]) || !usable(landmarks[12])
    || !usable(landmarks[23]) || !usable(landmarks[24])) return null;
  if (!usableWorld(worldLandmarks?.[11]) || !usableWorld(worldLandmarks?.[12])
    || !usableWorld(worldLandmarks?.[23]) || !usableWorld(worldLandmarks?.[24])) return null;
  if (!mask || !(mask.width > 0) || !(mask.height > 0) || !mask.coverage) return null;
  if (!(width > 0) || !(height > 0)) return null;

  const shoulder = {
    x: (landmarks[11].x + landmarks[12].x) / 2,
    y: (landmarks[11].y + landmarks[12].y) / 2,
  };
  const hip = {
    x: (landmarks[23].x + landmarks[24].x) / 2,
    y: (landmarks[23].y + landmarks[24].y) / 2,
  };
  const torsoPx = Math.hypot((shoulder.x - hip.x) * width, (shoulder.y - hip.y) * height);
  if (!(torsoPx > 8)) return null;

  const worldShoulder = {
    x: (worldLandmarks[11].x + worldLandmarks[12].x) / 2,
    y: (worldLandmarks[11].y + worldLandmarks[12].y) / 2,
    z: (worldLandmarks[11].z + worldLandmarks[12].z) / 2,
  };
  const worldHip = {
    x: (worldLandmarks[23].x + worldLandmarks[24].x) / 2,
    y: (worldLandmarks[23].y + worldLandmarks[24].y) / 2,
    z: (worldLandmarks[23].z + worldLandmarks[24].z) / 2,
  };
  const torsoM = Math.hypot(
    worldShoulder.x - worldHip.x, worldShoulder.y - worldHip.y, worldShoulder.z - worldHip.z,
  );
  if (!(torsoM > 0.15 && torsoM < 1.2)) return null;
  // Centimetres per image pixel, from the one axis the model measures well.
  const cmPerPx = torsoM * 100 / torsoPx;

  // The mask shares the photo's FRAME, not its pixel size (it is capped at
  // 1280 px), so a mask width is converted back to image pixels before it can
  // meet the centimetres-per-pixel the torso calibrated.
  const maskScale = width / mask.width;
  const centre = (shoulder.x + hip.x) / 2 * mask.width;
  const rowAt = fraction => (shoulder.y + (hip.y - shoulder.y) * fraction) * mask.height;
  // One zone: the percentile of the silhouette widths sampled across it, as a
  // frontal width in centimetres — the caller decides what a girth it makes.
  const zone = ({ from, to, percentile }) => {
    const widths = [];
    for (let fraction = from; fraction <= to + 1e-9; fraction += STEP) {
      widths.push(silhouetteWidth(mask, rowAt(fraction), centre) * maskScale * cmPerPx);
    }
    const readable = widths.filter(value => value > 0).sort((a, b) => a - b);
    if (readable.length < Math.ceil(widths.length * ZONE_MIN)) return 0;
    return readable[Math.min(readable.length - 1, Math.floor(percentile * readable.length))];
  };

  const shoulderRaw = zone(ZONES.shoulder);
  const chestRaw = zone(ZONES.chest);
  // A girth rivaling the shoulders was read through the arms: fall back to
  // the shoulder-derived estimate a real body keeps instead.
  const chest = shoulderRaw > 0 && chestRaw >= ARM_MERGE * shoulderRaw
    ? shoulderRaw * CHEST_OF_SHOULDER
    : chestRaw * FRONT_TO_GIRTH;
  const torsoCm = torsoM * 100;
  // A reclining or bent pose compresses the shoulder-to-hip PIXELS while the
  // model still reports a correct metric torso — so the calibration scales
  // every girth up by the same lie. A real chest never outruns its own torso
  // by this much, so such a pose is refused rather than measured wrong.
  if (chest > SHORT_TORSO_LIMIT * torsoCm) return null;
  // A clamped girth is still a girth; an unreadable one stays missing.
  const waistZone = zone(ZONES.waist);
  const hipZone = zone(ZONES.hips);
  const waistEstimate = waistZone > 0 ? Math.min(waistZone * FRONT_TO_GIRTH, chest * WAIST_OF_CHEST) : 0;
  const hipEstimate = hipZone > 0
    ? Math.min(Math.max(hipZone * FRONT_TO_GIRTH, chest * HIP_OF_CHEST), chest * HIP_OF_CHEST_TOP)
    : 0;

  return {
    shoulderCm: within(shoulderRaw, 'shoulder'),
    chestCm: within(chest, 'chest'),
    waistCm: within(waistEstimate, 'waist'),
    hipCm: within(hipEstimate, 'hip'),
    torsoCm: within(torsoCm, 'torso'),
  };
}

/**
 * The letter size for a garment, on a typical unisex chart.
 * The cap and the backpack are not body-sized, and a missing measurement never
 * becomes a size — both cases are reported instead of guessed.
 */
export function predictSize(garment, measured) {
  if (!measured) return null;
  if (ONE_SIZE.includes(garment)) return { size: 'One size', value: null, basis: 'one-size' };
  const bottoms = BOTTOMS.includes(garment);
  const value = bottoms ? measured.waistCm : measured.chestCm;
  if (!finite(value)) return null;
  const bounds = bottoms ? WAIST_BOUNDS : CHEST_BOUNDS;
  let index = 0;
  while (index < bounds.length && value > bounds[index]) index += 1;
  return { size: LABELS[index], value, basis: bottoms ? 'waist' : 'chest' };
}

/** The sentence shown under the size, honest about what it is based on. */
export function describeSize(report) {
  if (!report) {
    return 'Not enough of you is in frame to size this piece. Pick a photo with your shoulders, hips and torso visible.';
  }
  if (report.basis === 'one-size') return 'The cap and the backpack are one size — use the Size slider to adjust the fit.';
  return `From your ${report.basis} of ${Math.round(report.value)} cm, on a typical unisex chart.`;
}
