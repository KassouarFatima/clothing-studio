import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function surface(rows, columns, point, reverse = false) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions.push(...point(row / rows, column / columns));
      uvs.push(column / columns, row / rows);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(...(reverse ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // UVs split the wraparound edge; average its normals to avoid a lighting seam.
  const normal = geometry.getAttribute('normal');
  for (let row = 0; row <= rows; row++) {
    const first = row * (columns + 1);
    const last = first + columns;
    if (Math.abs(positions[first * 3] - positions[last * 3])
      + Math.abs(positions[first * 3 + 1] - positions[last * 3 + 1])
      + Math.abs(positions[first * 3 + 2] - positions[last * 3 + 2]) < 0.000001) {
      const blended = new Vector3(
        normal.getX(first) + normal.getX(last),
        normal.getY(first) + normal.getY(last),
        normal.getZ(first) + normal.getZ(last),
      ).normalize();
      normal.setXYZ(first, blended.x, blended.y, blended.z);
      normal.setXYZ(last, blended.x, blended.y, blended.z);
    }
  }
  return geometry;
}

function cord(points, radius, closed = false, segments = 64) {
  const curve = new CatmullRomCurve3(points.map((point) => new Vector3(...point)), closed, 'centripetal');
  return new TubeGeometry(curve, segments, radius, 10, closed);
}

// Retain the source garment's drape and neckline, trimming only the short sleeves.
function torsoFromShirt(baseGeometry) {
  const source = baseGeometry.index ? baseGeometry.toNonIndexed() : baseGeometry.clone();
  const position = source.getAttribute('position');
  const uv = source.getAttribute('uv');
  const positions = [];
  const uvs = [];
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    let outside = false;
    for (let offset = 0; offset < 3; offset++) {
      const index = triangle + offset;
      if (Math.abs(position.getX(index)) > 0.183 && position.getY(index) > -0.055) outside = true;
    }
    if (outside) continue;
    for (let offset = 0; offset < 3; offset++) {
      const index = triangle + offset;
      const x = position.getX(index) * 1.035;
      const y = position.getY(index);
      const z = position.getZ(index) * 1.045;
      positions.push(x, y, z);
      uvs.push(uv ? uv.getX(index) : x + 0.5, uv ? uv.getY(index) : y + 0.5);
    }
  }
  source.dispose();
  const torso = new BufferGeometry();
  torso.setAttribute('position', new Float32BufferAttribute(positions, 3));
  torso.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  // Preserve smooth source normals across the original mesh's UV seams.
  const normals = [];
  const sourceNormal = baseGeometry.getAttribute('normal');
  const sourceIndex = baseGeometry.index;
  const sourcePosition = baseGeometry.getAttribute('position');
  const count = sourceIndex ? sourceIndex.count : sourcePosition.count;
  for (let triangle = 0; triangle < count; triangle += 3) {
    const ids = [0, 1, 2].map((offset) => sourceIndex ? sourceIndex.getX(triangle + offset) : triangle + offset);
    if (ids.some((index) => Math.abs(sourcePosition.getX(index)) > 0.183 && sourcePosition.getY(index) > -0.055)) continue;
    for (const index of ids) {
      if (sourceNormal) {
        const normal = new Vector3(sourceNormal.getX(index) / 1.035, sourceNormal.getY(index), sourceNormal.getZ(index) / 1.045).normalize();
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  }
  if (normals.length === positions.length) torso.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  else torso.computeVertexNormals();
  return torso;
}

/** Ghost-mannequin hoodie; front is +Z, with dimensions matching shirt_baked.glb. */
export function createHoodie(baseGeometry) {
  const parts = [];
  const add = (geometry, role = 'fabric', color) => {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts.push({ geometry, role, ...(color ? { color } : {}) });
  };
  add(torsoFromShirt(baseGeometry));

  for (const side of [-1, 1]) {
    const curve = new CatmullRomCurve3([
      new Vector3(side * 0.154, 0.177, -0.026),
      new Vector3(side * 0.225, 0.095, -0.027),
      new Vector3(side * 0.283, -0.096, -0.009),
      new Vector3(side * 0.306, -0.304, 0.007),
    ], false, 'centripetal');

    const sleevePoint = (t, angle, cuff = false) => {
      const center = curve.getPoint(Math.min(t, 1));
      const tangent = curve.getTangent(Math.min(t, 1)).normalize();
      if (t > 1) center.addScaledVector(tangent, (t - 1) * 0.055);
      const across = new Vector3(-tangent.y, tangent.x, 0).normalize();
      const around = angle * TAU;
      const width = cuff ? lerp(0.044, 0.040, t - 1) : lerp(0.077, 0.045, smooth(t));
      const depth = cuff ? lerp(0.041, 0.037, t - 1) : lerp(0.072, 0.042, smooth(t));
      const folds = cuff
        ? Math.cos(around * 48) * 0.0008
        : Math.sin(around * 3 + t * 31) * 0.003 * Math.sin(Math.PI * t)
          + Math.sin(around * 7 - t * 19) * 0.0014 * Math.sin(Math.PI * t);
      center.addScaledVector(across, Math.sin(around) * (width + folds));
      center.z += Math.cos(around) * (depth + folds);
      return [center.x, center.y, center.z];
    };
    add(surface(56, 64, (t, angle) => sleevePoint(t, angle)));
    add(surface(14, 144, (t, angle) => sleevePoint(1 + t, angle, true)), 'trim');
    add(cord(Array.from({ length: 64 }, (_, index) => sleevePoint(1, index / 64)), 0.0015, true), 'trim');
    add(cord(Array.from({ length: 64 }, (_, index) => sleevePoint(2, index / 64, true)), 0.0020, true), 'trim');
  }

  const hemPoint = (t, angle) => {
    const theta = angle * TAU;
    const rib = Math.cos(theta * 104) * 0.00075;
    const radiusX = lerp(0.173, 0.170, 1 - t) + rib;
    const radiusZ = lerp(0.108, 0.103, 1 - t) + rib;
    return [Math.sin(theta) * radiusX, lerp(-0.366, -0.322, t), Math.cos(theta) * radiusZ + 0.004];
  };
  add(surface(12, 240, hemPoint, true), 'trim');
  add(cord(Array.from({ length: 96 }, (_, index) => hemPoint(1, index / 96)), 0.0010, true), 'trim');

  // A deep, open-faced hood with separate inward-facing lining and a rolled edge.
  const hoodPoint = (t, angle, inset = 0) => {
    const theta = lerp(0.94, Math.PI - 0.006, t);
    const phi = angle * TAU;
    const sinTheta = Math.sin(theta);
    const drape = 0.0018 * Math.sin(phi * 5 + theta * 3) * sinTheta;
    return [
      (0.126 - inset + drape) * sinTheta * Math.cos(phi),
      0.356 + (0.169 - inset) * sinTheta * Math.sin(phi),
      -0.024 + (0.136 - inset + drape) * Math.cos(theta),
    ];
  };
  add(surface(56, 80, (t, angle) => hoodPoint(t, angle)));
  add(surface(56, 80, (t, angle) => hoodPoint(t, angle, 0.006), true), 'lining');
  add(cord(Array.from({ length: 96 }, (_, index) => hoodPoint(0, index / 96, 0.002)), 0.0051, true), 'trim');
  // The center seam makes the hood read as sewn panels rather than a smooth shell.
  add(cord(Array.from({ length: 48 }, (_, index) => hoodPoint(index / 47, 0.25)), 0.0008), 'trim');

  const pocketPoint = (t, horizontal) => {
    const width = t < 0.55 ? lerp(0.108, 0.124, Math.sin(t / 0.55 * Math.PI / 2)) : lerp(0.124, 0.076, smooth((t - 0.55) / 0.45));
    const x = (horizontal * 2 - 1) * width;
    const y = lerp(-0.276, -0.088, t) + 0.002 * Math.cos(horizontal * TAU);
    const z = 0.125 * Math.sqrt(Math.max(0.1, 1 - (x / 0.19) ** 2)) + 0.009
      + 0.0055 * Math.sin(t * Math.PI) * Math.sin(horizontal * Math.PI)
      + 0.0013 * Math.sin(horizontal * 23 + t * 8) * Math.sin(t * Math.PI);
    return [x, y, z];
  };
  add(surface(36, 48, pocketPoint, true));
  add(cord(Array.from({ length: 40 }, (_, index) => pocketPoint(0, index / 39)), 0.0010), 'trim');
  add(cord(Array.from({ length: 40 }, (_, index) => pocketPoint(1, index / 39)), 0.0010), 'trim');
  for (const edge of [0, 1]) {
    add(cord(Array.from({ length: 32 }, (_, index) => pocketPoint(lerp(0.52, 1, index / 31), edge)), 0.0024), 'dark');
    const welt = Array.from({ length: 32 }, (_, index) => {
      const point = pocketPoint(lerp(0.51, 1, index / 31), edge);
      point[0] += edge ? -0.0025 : 0.0025;
      point[2] += 0.0013;
      return point;
    });
    add(cord(welt, 0.0022), 'trim');
  }

  for (const side of [-1, 1]) {
    const eyelet = new TorusGeometry(0.0044, 0.0012, 10, 24);
    eyelet.translate(side * 0.061, 0.218, 0.109);
    add(eyelet, 'metal');
    const stringPoints = [
      [side * 0.061, 0.218, 0.112],
      [side * 0.057, 0.174, 0.143],
      [side * 0.064, 0.096, 0.153],
      [side * 0.053, side < 0 ? 0.033 : 0.010, 0.150],
    ];
    add(cord(stringPoints, 0.0021), 'trim', '#d8d1c0');
    const end = stringPoints[stringPoints.length - 1];
    add(cord([end, [end[0] - side * 0.001, end[1] - 0.016, end[2]]], 0.0025, false, 8), 'metal');
  }

  return parts;
}
