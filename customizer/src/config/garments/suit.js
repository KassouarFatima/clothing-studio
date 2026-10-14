import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute,
  Shape, ShapeGeometry, TubeGeometry, Vector3,
} from 'three';

const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const bell = (x, center, width) => Math.exp(-(((x - center) / width) ** 2));

// Rows are [height, half-width, depth, center-x, center-z]. Smooth interpolation
// keeps the tailoring continuous through waist, elbow and knee profiles.
function profile(rows, height) {
  let i = 0;
  while (i < rows.length - 2 && height > rows[i + 1][0]) i++;
  const a = rows[i], b = rows[i + 1];
  const t = Math.max(0, Math.min(1, (height - a[0]) / (b[0] - a[0])));
  const smooth = t * t * (3 - 2 * t);
  return a.map((value, column) => column === 0 ? height : mix(value, b[column], smooth));
}

function surface(segments, rows, sample) {
  const positions = [], uvs = [], indices = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= segments; i++) {
      const point = sample(i / segments, j / rows);
      positions.push(point[0], point[1], point[2]);
      uvs.push(point[3], point[4]);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Subdivide the triangulated cloth panel before draping it onto the garment.
// This gives lapels a rolled surface, rather than a flat triangular silhouette.
function panel(points, depth, subdivisions = 2) {
  const shape = new Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const flat = new ShapeGeometry(shape);
  let vertices = Array.from({ length: flat.attributes.position.count }, (_, i) => [
    flat.attributes.position.getX(i), flat.attributes.position.getY(i),
  ]);
  let indices = Array.from(flat.index.array);
  flat.dispose();
  for (let pass = 0; pass < subdivisions; pass++) {
    const next = [], midpointCache = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!midpointCache.has(key)) {
        midpointCache.set(key, vertices.length);
        vertices.push([mix(vertices[a][0], vertices[b][0], 0.5), mix(vertices[a][1], vertices[b][1], 0.5)]);
      }
      return midpointCache.get(key);
    };
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    indices = next;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices.flatMap(([x, y]) => [x, y, depth(x, y)]), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(vertices.flatMap(([x, y]) => [x * 1.4 + 0.5, y * 1.4]), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function seam(points, radius = 0.00085) {
  return new TubeGeometry(new CatmullRomCurve3(points.map(point => new Vector3(...point))),
    Math.max(12, points.length * 5), radius, 5, false);
}

function button(x, y, z, radius = 0.009, thickness = 0.003) {
  const geometry = new CylinderGeometry(radius, radius * 0.94, thickness, 24, 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry;
}

/** Tailored two-piece suit, with the front facing +Z and the neck at +Y. */
export function createSuit() {
  const pieces = [];
  const add = (geometry, role = 'fabric', color) => {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    pieces.push({ geometry, role, ...(color ? { color } : {}) });
  };

  const jacketRows = [
    [0.015, 0.207, 0.113, 0, -0.008],
    [0.10, 0.212, 0.115, 0, -0.004],
    [0.28, 0.185, 0.111, 0, 0],
    [0.44, 0.201, 0.125, 0, -0.005],
    [0.61, 0.228, 0.13, 0, -0.009],
    [0.715, 0.238, 0.114, 0, -0.009],
    [0.755, 0.205, 0.096, 0, -0.009],
    [0.805, 0.089, 0.067, 0, -0.006],
  ];
  const jacketGap = y => y > 0.285
    ? 0.003 + Math.pow((y - 0.285) / 0.52, 0.93) * 0.068
    : 0.003 + 0.029 * Math.pow((0.285 - y) / 0.27, 2.1);
  const jacketPoint = (u, v, inset = 0) => {
    const y = mix(0.015, 0.805, v);
    const [, width, depth, , centerZ] = profile(jacketRows, y);
    const gap = Math.asin(Math.min(0.94, jacketGap(y) / width));
    const angle = gap + u * (TAU - 2 * gap);
    const front = Math.max(0, Math.cos(angle));
    // Small tension folds around the fastening; the broad chest stays pressed.
    const folds = 0.0018 * Math.sin(y * 64 + Math.sin(angle) * 5)
      * bell(y, 0.28, 0.17) * front;
    const hem = 0.018 * Math.pow(front, 8) * bell(y, 0.015, 0.06);
    return [Math.sin(angle) * (width - inset), y + hem,
      Math.cos(angle) * (depth - inset) + centerZ + folds,
      angle * 0.24, y * 1.4];
  };
  add(surface(112, 78, jacketPoint));
  // A thin inner facing is visible along the open quarters and neck.
  add(surface(64, 44, (u, v) => jacketPoint(u, v, 0.004)), 'lining', '#252b34');

  // The tucked shirt sits behind the open jacket, including a rounded back.
  add(surface(72, 36, (u, v) => {
    const y = mix(0.24, 0.793, v), angle = u * TAU;
    const neck = Math.max(0, (y - 0.72) / 0.073);
    const width = mix(0.13, 0.073, neck), depth = mix(0.109, 0.064, neck);
    return [Math.sin(angle) * width, y, Math.cos(angle) * depth + 0.002,
      u, v];
  }), 'shirt', '#f4f1eb');

  // Stand collar remains hollow: there is no mannequin inside the neckline.
  add(surface(80, 8, (u, v) => {
    const angle = u * TAU;
    return [Math.sin(angle) * mix(0.074, 0.070, v), mix(0.774, 0.819, v),
      Math.cos(angle) * 0.062 - 0.003, u, v];
  }), 'shirt', '#f7f5ef');

  for (const sign of [-1, 1]) {
    const mirror = points => points.map(([x, y]) => [x * sign, y]);
    // Folded shirt collar points frame the knot instead of a painted triangle.
    add(panel(mirror([[0.012, 0.78], [0.062, 0.796], [0.084, 0.739], [0.038, 0.683]]),
      (x, y) => 0.112 + 0.014 * bell(y, 0.735, 0.047) - Math.abs(x) * 0.10), 'shirt', '#fffdf7');

    // A separate upper collar and lower lapel leave the characteristic notch.
    add(panel(mirror([[0.074, 0.805], [0.146, 0.754], [0.108, 0.701], [0.066, 0.74]]),
      (x, y) => 0.113 + 0.022 * bell(y, 0.73, 0.053) - Math.abs(x) * 0.045), 'fabric');
    const lapel = [[0.067, 0.73], [0.110, 0.690], [0.143, 0.686],
      [0.124, 0.60], [0.024, 0.30], [0.034, 0.465], [0.050, 0.62]];
    const lapelDepth = (x, y) => 0.118 + 0.026 * bell(y, 0.57, 0.2)
      + 0.009 * bell(Math.abs(x), 0.065, 0.04);
    add(panel(mirror(lapel), lapelDepth, 3));
    add(seam([[0.111 * sign, 0.687, lapelDepth(0.111, 0.687) + 0.001],
      [0.139 * sign, 0.683, lapelDepth(0.139, 0.683) + 0.001],
      [0.120 * sign, 0.597, lapelDepth(0.120, 0.597) + 0.001],
      [0.060 * sign, 0.42, lapelDepth(0.060, 0.42) + 0.001],
      [0.025 * sign, 0.307, lapelDepth(0.025, 0.307) + 0.001]], 0.00065), 'trim');

    const sleeveRows = [
      [0.065, 0.052, 0.059, 0.329, 0.023],
      [0.12, 0.055, 0.061, 0.328, 0.019],
      [0.28, 0.062, 0.067, 0.316, 0.002],
      [0.39, 0.069, 0.073, 0.308, -0.017],
      [0.54, 0.077, 0.082, 0.283, -0.017],
      [0.685, 0.086, 0.089, 0.235, -0.011],
      [0.728, 0.072, 0.074, 0.213, -0.011],
    ];
    const sleevePoint = (u, v, cuff = false) => {
      const y = cuff ? mix(0.040, 0.072, v) : mix(0.065, 0.728, v);
      const [, width, depth, centerX, centerZ] = profile(sleeveRows, y);
      const angle = u * TAU;
      const fold = cuff ? 0 : 0.0028 * Math.sin(y * 83 + angle * 1.8)
        * bell(y, 0.37, 0.10) * (0.3 + 0.7 * Math.abs(Math.cos(angle)));
      return [sign * centerX + Math.sin(angle) * (width + fold) * (cuff ? 0.91 : 1),
        y - sign * Math.sin(angle) * width * 0.27,
        centerZ + Math.cos(angle) * (depth + fold) * (cuff ? 0.91 : 1),
        u * 0.61, y * 1.4];
    };
    add(surface(64, 68, (u, v) => sleevePoint(u, v)));
    add(surface(48, 10, (u, v) => sleevePoint(u, v, true)), 'shirt', '#f3f0e9');

    // Rolled cuff edge, sleeve vent buttons, and an underarm construction seam.
    const cuffEdge = Array.from({ length: 49 }, (_, i) => sleevePoint(i / 48, 0).slice(0, 3));
    add(seam(cuffEdge, 0.0011), 'trim');
    add(seam([[sign * 0.357, 0.084, 0.069], [sign * 0.355, 0.17, 0.065],
      [sign * 0.356, 0.29, 0.049], [sign * 0.341, 0.41, 0.041]], 0.0007), 'trim');
    for (let i = 0; i < 4; i++) {
      add(button(sign * (0.344 - i * 0.0011), 0.107 + i * 0.018, 0.077 - i * 0.0015, 0.005), 'dark', '#242832');
    }

    // Slightly lifted welt and pocket flap follow the jacket's convex front.
    const pocketDepth = x => 0.117 * Math.sqrt(Math.max(0.1, 1 - (x / 0.212) ** 2)) + 0.006;
    add(panel(mirror([[0.075, 0.213], [0.171, 0.232], [0.173, 0.219], [0.077, 0.198]]),
      x => pocketDepth(x) + 0.0005), 'dark', '#242a33');
    add(panel(mirror([[0.074, 0.215], [0.172, 0.235], [0.176, 0.194], [0.082, 0.175]]),
      (x, y) => pocketDepth(x) + 0.003 + 0.002 * bell(y, 0.21, 0.035)));

    // Pressed trouser legs have fullness at the thigh, a shaped knee and a
    // tapered open ankle. A subtle vertical ridge catches light as a crease.
    const trouserRows = [
      [-0.90, 0.060, 0.070, 0.116, 0.007],
      [-0.84, 0.061, 0.073, 0.117, 0.006],
      [-0.67, 0.068, 0.077, 0.115, 0.007],
      [-0.46, 0.076, 0.083, 0.109, 0.015],
      [-0.35, 0.079, 0.088, 0.105, 0.022],
      [-0.17, 0.090, 0.098, 0.103, 0.008],
      [0.015, 0.100, 0.103, 0.101, -0.004],
      [0.19, 0.099, 0.099, 0.099, -0.008],
    ];
    const trouserPoint = (u, v) => {
      const y = mix(-0.90, 0.19, v), angle = u * TAU;
      const [, width, depth, centerX, centerZ] = profile(trouserRows, y);
      const crease = 0.005 * Math.pow(Math.abs(Math.cos(angle)), 28);
      const kneeFold = 0.0028 * Math.sin(y * 60 + angle * 1.7) * bell(y, -0.40, 0.12);
      const ankleFold = 0.0017 * Math.sin(y * 112 + angle) * bell(y, -0.83, 0.07);
      return [sign * centerX + Math.sin(angle) * (width + kneeFold + ankleFold), y,
        centerZ + Math.cos(angle) * (depth + crease + kneeFold + ankleFold),
        u * 0.72, (y + 0.9) * 1.4];
    };
    add(surface(80, 100, trouserPoint));
    add(seam(Array.from({ length: 49 }, (_, i) => trouserPoint(i / 48, 0.012).slice(0, 3)), 0.00095), 'trim');
    add(seam([[-0.001 + sign * 0.16, -0.87, 0.023], [sign * 0.182, -0.60, 0.013],
      [sign * 0.192, -0.35, 0.018], [sign * 0.201, -0.12, 0.006]], 0.00065), 'trim');
  }

  // Dark silk tie: dimensional knot and a gently bowed pointed blade.
  add(panel([[-0.019, 0.768], [0.019, 0.768], [0.016, 0.730], [0, 0.713], [-0.016, 0.730]],
    (x, y) => 0.134 + 0.009 * bell(x, 0, 0.02) + 0.007 * bell(y, 0.743, 0.025), 3), 'dark', '#263347');
  add(panel([[-0.010, 0.718], [0.010, 0.718], [0.028, 0.386], [0, 0.350], [-0.027, 0.386]],
    (x, y) => 0.130 + 0.010 * bell(x, 0, 0.035) + 0.005 * bell(y, 0.57, 0.2), 3), 'dark', '#263347');

  // Breast welt, a folded linen pocket square, and two horn fastening buttons.
  add(panel([[0.104, 0.581], [0.182, 0.597], [0.184, 0.585], [0.105, 0.569]],
    x => 0.126 * Math.sqrt(Math.max(0.1, 1 - (x / 0.228) ** 2)) + 0.004));
  add(panel([[0.122, 0.586], [0.123, 0.607], [0.145, 0.609], [0.158, 0.605], [0.170, 0.610], [0.171, 0.596]],
    x => 0.126 * Math.sqrt(Math.max(0.1, 1 - (x / 0.228) ** 2)) + 0.002), 'shirt', '#eeeae0');
  for (const y of [0.283, 0.17]) {
    add(button(0.008, y, 0.121, 0.0102), 'dark', '#22262d');
    add(button(0.008, y, 0.123, 0.007, 0.001), 'metal', '#555552');
  }
  // The trouser rise bridges the two leg tubes. Without this curved gusset the
  // negative space between the legs would continue unnaturally to the waist.
  const riseOutline = [[-0.112, 0.18], [0.112, 0.18], [0.096, -0.055],
    [0.051, -0.139], [0, -0.169], [-0.051, -0.139], [-0.096, -0.055]];
  const riseDepth = (x, y) => {
    const drop = Math.max(0, Math.min(1, (y + 0.17) / 0.19));
    return 0.031 + 0.068 * Math.sin(drop * Math.PI / 2)
      - 0.023 * Math.pow(Math.abs(x) / 0.112, 2);
  };
  add(panel(riseOutline, riseDepth, 3));
  add(panel(riseOutline, (x, y) => -riseDepth(x, y) - 0.009, 3));
  add(seam([[0.006, 0.09, 0.100], [0.006, 0.015, 0.100],
    [0.006, -0.045, 0.090], [0, -0.09, 0.073]], 0.00075), 'trim');
  // Center-back tailoring and the short vent are real raised seams.
  add(seam([[0, 0.774, -0.083], [0, 0.69, -0.126], [0, 0.55, -0.137],
    [0, 0.40, -0.124], [0, 0.27, -0.112], [0, 0.16, -0.117], [0, 0.035, -0.124]], 0.0008), 'trim');

  return pieces;
}
