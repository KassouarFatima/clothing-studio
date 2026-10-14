import * as THREE from 'three';

const TAU = Math.PI * 2;
const WAIST_Y = 0.055;
const HEM_Y = -0.9;
const WAIST_X = 0.128;
const WAIST_Z = 0.081;
const SHOULDER_X = 0.207;
const smooth = (a, b, value) => {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Keep a single circumferential textile coordinate across the bodice and skirt.
const fabricV = (y) => (y - HEM_Y) / (0.635 - HEM_Y);

function grid(columns, rows, sample, reverse = false, wrap = false) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const { point, uv } = sample(column / columns, row / rows);
      positions.push(...point);
      uvs.push(...uv);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const d = a + columns + 1;
      const c = d + 1;
      indices.push(...(reverse ? [a, d, b, b, d, c] : [a, b, d, b, c, d]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (wrap) {
    const normals = geometry.getAttribute('normal');
    const normal = new THREE.Vector3();
    for (let row = 0; row <= rows; row += 1) {
      const first = row * (columns + 1);
      const last = first + columns;
      normal.set(
        normals.getX(first) + normals.getX(last),
        normals.getY(first) + normals.getY(last),
        normals.getZ(first) + normals.getZ(last),
      ).normalize();
      normals.setXYZ(first, normal.x, normal.y, normal.z);
      normals.setXYZ(last, normal.x, normal.y, normal.z);
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function bodicePoint(horizontal, height, front = true) {
  const side = Math.abs(horizontal);
  const top = (front ? 0.435 : 0.545)
    + (front ? 0.2 : 0.09) * smooth(0, 0.66, side)
    - 0.023 * smooth(0.67, 1, side);
  const y = THREE.MathUtils.lerp(WAIST_Y, top, height);
  // Full bust tapering into the armhole, then broadening at the shoulder strap.
  const width = WAIST_X
    + 0.064 * smooth(0, 0.48, height)
    - 0.049 * Math.exp(-Math.pow((height - 0.81) / 0.14, 2))
    + 0.023 * smooth(0.85, 1, height);
  // Remove the tiny Gaussian tail at the waist so skirt and bodice meet exactly.
  const x = horizontal * (height === 0 ? WAIST_X : height === 1 ? SHOULDER_X : width);
  const depth = WAIST_Z
    + 0.038 * Math.exp(-Math.pow((height - 0.47) / 0.23, 2)) * smooth(0, 0.15, height)
    - 0.022 * smooth(0.65, 1, height);
  const edgeDepth = 0.047 * smooth(0.55, 0.89, height);
  const ellipse = Math.sqrt(Math.max(0, 1 - horizontal * horizontal));
  let z = edgeDepth + (depth - edgeDepth) * ellipse;
  if (front) {
    // Subtle tailoring through the bust; the surface remains smooth and wearable.
    z += 0.012 * Math.exp(-Math.pow((side - 0.47) / 0.24, 2))
      * Math.exp(-Math.pow((height - 0.46) / 0.2, 2)) * smooth(0, 0.1, height);
  } else {
    z *= -1;
  }
  return [x, y, z];
}

function bodice(front, start = -1, end = 1) {
  return grid(front ? 64 : 32, 64, (u, v) => {
    const horizontal = THREE.MathUtils.lerp(start, end, u);
    const point = bodicePoint(horizontal, v, front);
    const arc = Math.asin(THREE.MathUtils.clamp(horizontal, -1, 1));
    const angle = front ? arc : end <= 0 ? -Math.PI - arc : Math.PI - arc;
    return { point, uv: [angle / TAU + 0.5, fabricV(point[1])] };
  }, !front);
}

function skirtPoint(u, drop, inset = 0) {
  const angle = (u - 0.5) * TAU;
  const hip = smooth(0, 0.29, drop);
  const radiusX = WAIST_X + 0.07 * hip + 0.208 * Math.pow(drop, 1.7);
  const radiusZ = WAIST_Z + 0.034 * hip + 0.151 * Math.pow(drop, 1.65);
  // Uneven fold spacing and slowly changing phase avoid a rigid pleated cone.
  const fold = (0.005 + 0.027 * Math.pow(drop, 1.25)) * smooth(0, 0.19, drop)
    * (0.69 * Math.cos(10 * angle + 0.38 * Math.sin(3 * angle) + 0.44 * drop)
      + 0.21 * Math.sin(17 * angle - 1.4 * drop)
      + 0.1 * Math.cos(23 * angle + 2.3 * drop));
  const x = (radiusX + fold - inset) * Math.sin(angle)
    + 0.007 * Math.sin(Math.PI * drop) * Math.sin(2 * angle);
  const z = (radiusZ + fold * 0.82 - inset) * Math.cos(angle);
  const y = WAIST_Y + (HEM_Y - WAIST_Y) * drop
    + Math.pow(drop, 3) * (0.007 * Math.sin(3 * angle + 0.3) + 0.004 * Math.sin(7 * angle))
    + 0.003 * drop * (1 - drop) * Math.sin(9 * angle + 7 * drop);
  return [x, y, z];
}

function piping(points, radius, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, Math.max(32, points.length * 2), radius, 5, closed);
}

/**
 * A hollow sleeveless dress: open neck/armholes, shaped bodice, draped midi skirt.
 * Front is +Z and up is +Y. The viewer owns materials, scale and geometry disposal.
 */
export function createDress() {
  const pieces = [
    { geometry: bodice(true), role: 'fabric' },
    // Split the back at its UV seam instead of interpolating across the full tile.
    { geometry: bodice(false, -1, 0), role: 'fabric' },
    { geometry: bodice(false, 0, 1), role: 'fabric' },
  ];

  for (const side of [-1, 1]) {
    pieces.push({
      geometry: grid(20, 12, (u, v) => {
        const horizontal = side < 0 ? THREE.MathUtils.lerp(-1, -0.66, u) : THREE.MathUtils.lerp(0.66, 1, u);
        const front = new THREE.Vector3(...bodicePoint(horizontal, 1, true));
        const back = new THREE.Vector3(...bodicePoint(horizontal, 1, false));
        const point = front.lerp(back, v);
        point.y += 0.01 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u);
        return { point: point.toArray(), uv: [Math.atan2(point.x, point.z) / TAU + 0.5, fabricV(point.y)] };
      }),
      role: 'fabric',
    });
  }

  pieces.push({
    geometry: grid(160, 96, (u, v) => {
      const point = skirtPoint(u, v);
      return { point, uv: [u, fabricV(point[1])] };
    }, true, true),
    role: 'fabric',
  });

  // Folded hem facing and its thickness make the open skirt read as real fabric.
  pieces.push({
    geometry: grid(160, 5, (u, v) => {
      const point = skirtPoint(u, THREE.MathUtils.lerp(0.968, 1, v), 0.004);
      return { point, uv: [u, fabricV(point[1])] };
    }, false, true),
    role: 'lining',
  });
  pieces.push({
    geometry: grid(160, 2, (u, v) => {
      const point = skirtPoint(u, 1, 0.004 * v);
      point[1] -= 0.001 * Math.sin(Math.PI * v);
      return { point, uv: [u, fabricV(point[1])] };
    }, true, true),
    role: 'fabric',
  });

  const waist = Array.from({ length: 128 }, (_, i) => {
    const angle = i / 128 * TAU;
    return [(WAIST_X + 0.001) * Math.sin(angle), WAIST_Y + 0.001, (WAIST_Z + 0.001) * Math.cos(angle)];
  });
  pieces.push({ geometry: piping(waist, 0.0013, true), role: 'fabric' });

  const neckline = [];
  for (let i = 0; i <= 48; i += 1) neckline.push(bodicePoint(THREE.MathUtils.lerp(-0.66, 0.66, i / 48), 1, true));
  for (let i = 0; i <= 48; i += 1) neckline.push(bodicePoint(THREE.MathUtils.lerp(0.66, -0.66, i / 48), 1, false));
  pieces.push({ geometry: piping(neckline, 0.0017, true), role: 'fabric' });

  for (const side of [-1, 1]) {
    const opening = [];
    for (let i = 0; i <= 40; i += 1) opening.push(bodicePoint(side, THREE.MathUtils.lerp(0.55, 1, i / 40), true));
    for (let i = 0; i <= 40; i += 1) opening.push(bodicePoint(side, THREE.MathUtils.lerp(1, 0.55, i / 40), false));
    pieces.push({ geometry: piping(opening, 0.0016, true), role: 'fabric' });
  }

  return pieces;
}
