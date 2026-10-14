import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';

// Pants, jacket, hat and backpack have no downloadable model files, so
// their geometry is built here from parametric panels. Every garment faces
// +Z with +Y up and is authored inside the showroom's normalization bounds
// (height 0.75, width 0.66) so the shared fit math in tryon/fitPose.js can
// use the authored spans directly. Fabric panels carry UVs in [0, 1] with
// v = 0 at the top, matching the GLB convention the pattern texture expects.

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

export const PROCEDURAL_GARMENTS = ['pants', 'jacket', 'hat', 'bag'];
export const isProcedural = (garment) => PROCEDURAL_GARMENTS.includes(garment);

// Average normals across the wraparound seam so a repeating pattern does not
// show a lighting crack where the first and last columns meet.
function blendSeam(geometry, positions, rows, columns) {
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
}

function flipWinding(geometry) {
  const index = geometry.getIndex();
  const array = index.array;
  for (let offset = 0; offset < array.length; offset += 3) {
    const swap = array[offset + 1];
    array[offset + 1] = array[offset + 2];
    array[offset + 2] = swap;
  }
  index.needsUpdate = true;
}

// Panels are wound by construction order, which is easy to get backwards on a
// new surface. The probe names one vertex that must face a known direction;
// if it does not, the winding (and then the normals) are corrected.
// Returns true when the winding had to be flipped.
function orientOutward(geometry, probe) {
  if (!probe) return false;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < position.count; index++) {
    const dx = position.getX(index) - probe.at[0];
    const dy = position.getY(index) - probe.at[1];
    const dz = position.getZ(index) - probe.at[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < nearestDistance) { nearestDistance = distance; nearest = index; }
  }
  const facing = normal.getX(nearest) * probe.toward[0]
    + normal.getY(nearest) * probe.toward[1]
    + normal.getZ(nearest) * probe.toward[2];
  if (facing >= 0) return false;
  flipWinding(geometry);
  geometry.computeVertexNormals();
  return true;
}

/**
 * Builds a UV-mapped panel surface. `point(t, angle)` returns one vertex with
 * t = 0 first (the top of a garment panel) and angle sweeping front → side →
 * back, so row 0 lands on the top edge for the upright pattern texture.
 */
function surface(rows, columns, point, { probe } = {}) {
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
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  blendSeam(geometry, positions, rows, columns);
  if (orientOutward(geometry, probe)) blendSeam(geometry, positions, rows, columns);
  return geometry;
}

function cord(points, radius, closed = false, segments = 64) {
  const curve = new CatmullRomCurve3(points.map((point) => new Vector3(...point)), closed, 'centripetal');
  return new TubeGeometry(curve, segments, radius, 10, closed);
}

function ring(radiusX, radiusZ, y, segments = 96) {
  return Array.from({ length: segments }, (_, index) => {
    const theta = index / segments * TAU;
    return [Math.sin(theta) * radiusX, y, Math.cos(theta) * radiusZ];
  });
}

// Waist-to-ankle trousers, authored at real proportions: hips ~0.30 wide
// over 0.75 tall and the crotch at ~27% down, so the silhouette reads like
// proper trousers instead of wide shorts.
function pantsParts() {
  const parts = [];
  const add = (geometry, role = 'fabric') => parts.push({ geometry, role });

  // Hips: waistband to crotch. Straight at the waist, fullest at the seat.
  add(surface(28, 96, (t, angle) => {
    const theta = angle * TAU;
    const rx = t < 0.45
      ? lerp(0.145, 0.15, smooth(t / 0.45))
      : lerp(0.15, 0.148, smooth((t - 0.45) / 0.55));
    const rz = t < 0.45
      ? lerp(0.088, 0.094, smooth(t / 0.45))
      : lerp(0.094, 0.086, smooth((t - 0.45) / 0.55));
    return [
      Math.sin(theta) * rx,
      lerp(0.375, 0.1, t),
      Math.cos(theta) * rz,
    ];
  }, { probe: { at: [0, 0.2, 0.0919], toward: [0, 0, 1] } }));

  // Legs: overlapping at the crotch, then separating immediately below it,
  // tapering thigh to ankle with a small gap between the cuffs.
  for (const side of [-1, 1]) {
    add(surface(36, 64, (t, angle) => {
      const theta = angle * TAU;
      const taper = smooth(t);
      return [
        side * lerp(0.074, 0.078, t) + Math.sin(theta) * lerp(0.074, 0.065, taper),
        lerp(0.2, -0.375, t),
        Math.cos(theta) * lerp(0.085, 0.055, taper),
      ];
    }, { probe: { at: [side * 0.0761, -0.1, 0.0688], toward: [0, 0, 1] } }));
  }

  // Ribbed waistband, sitting proud of the hips all the way around.
  add(surface(5, 96, (t, angle) => {
    const theta = angle * TAU;
    const rib = Math.cos(theta * 48) * 0.0012;
    return [
      Math.sin(theta) * (0.1495 + rib),
      lerp(0.34, 0.378, t),
      Math.cos(theta) * (0.0908 + rib),
    ];
  }, { probe: { at: [0, 0.36, 0.092], toward: [0, 0, 1] } }), 'trim');

  return parts;
}

// Bomber jacket: zip-front torso with a standing collar, a ribbed hem and
// long sleeves angled out from the shoulders in a product-shot pose, so the
// silhouette reads wider than tall.
function jacketParts() {
  const parts = [];
  const add = (geometry, role = 'fabric') => parts.push({ geometry, role });

  // Shouldered torso, waist length, ending where the ribbed hem begins.
  const jacketStops = [
    [0.0, 0.032, 0.037, 0.3],
    [0.18, 0.115, 0.066, 0.27],
    [0.35, 0.112, 0.068, 0.19],
    [0.6, 0.104, 0.07, 0.07],
    [0.85, 0.106, 0.07, -0.01],
    [1.0, 0.105, 0.069, -0.035],
  ];
  const jacketAt = (t) => {
    let index = 0;
    while (index < jacketStops.length - 2 && t > jacketStops[index + 1][0]) index++;
    const from = jacketStops[index];
    const to = jacketStops[index + 1];
    const mix = Math.min(1, Math.max(0, (t - from[0]) / (to[0] - from[0])));
    return [lerp(from[1], to[1], mix), lerp(from[2], to[2], mix), lerp(from[3], to[3], mix)];
  };
  const neckDip = (angle) => {
    const cos = Math.cos(angle * TAU);
    return Math.max(0, cos) ** 1.5 * 0.042 + Math.max(0, -cos) ** 1.5 * 0.016;
  };

  add(surface(44, 96, (t, angle) => {
    const theta = angle * TAU;
    const [rx, rz, y] = jacketAt(t);
    const rim = Math.max(0, 1 - t / 0.22);
    return [Math.sin(theta) * rx, y - neckDip(angle) * rim, Math.cos(theta) * rz];
  }, { probe: { at: [0, 0.19, 0.068], toward: [0, 0, 1] } }));

  // Standing collar above the dipped neckline.
  add(surface(4, 64, (t, angle) => {
    const theta = angle * TAU;
    const dip = neckDip(angle) * (1 - t) * 0.85;
    return [
      Math.sin(theta) * lerp(0.034, 0.04, t),
      lerp(0.276, 0.315, t) - dip,
      Math.cos(theta) * lerp(0.04, 0.046, t),
    ];
  }, { probe: { at: [0, 0.3, 0.046], toward: [0, 0, 1] } }), 'trim');

  // Ribbed bomber hem, sitting proud of the body's open edge.
  add(surface(5, 96, (t, angle) => {
    const theta = angle * TAU;
    const rib = Math.cos(theta * 48) * 0.0012;
    return [
      Math.sin(theta) * (0.1068 + rib),
      lerp(-0.035, -0.07, t),
      Math.cos(theta) * (0.0705 + rib),
    ];
  }, { probe: { at: [0, -0.049, 0.0717], toward: [0, 0, 1] } }), 'trim');

  const cuffRing = (curve) => Array.from({ length: 48 }, (_, index) => {
    const theta = index / 48 * TAU;
    const center = curve.getPoint(1);
    const tangent = curve.getTangent(1).normalize();
    const across = new Vector3(-tangent.y, tangent.x, 0).normalize();
    return [
      center.x + across.x * Math.sin(theta) * 0.0345,
      center.y + across.y * Math.sin(theta) * 0.0345,
      center.z + Math.cos(theta) * 0.0375,
    ];
  });

  // Sleeves hang at about 18 degrees off vertical, cuffs landing beside the hem.
  for (const side of [-1, 1]) {
    const curve = new CatmullRomCurve3([
      new Vector3(side * 0.075, 0.265, 0),
      new Vector3(side * 0.115, 0.16, 0.006),
      new Vector3(side * 0.15, 0.05, 0.012),
      new Vector3(side * 0.175, -0.05, 0.016),
    ], false, 'centripetal');
    add(surface(40, 48, (t, angle) => {
      const theta = angle * TAU;
      const center = curve.getPoint(Math.min(t, 1));
      const tangent = curve.getTangent(Math.min(t, 1)).normalize();
      const across = new Vector3(-tangent.y, tangent.x, 0).normalize();
      const rx = lerp(0.046, 0.033, smooth(t));
      const rz = lerp(0.05, 0.036, smooth(t));
      return [
        center.x + across.x * Math.sin(theta) * rx,
        center.y + across.y * Math.sin(theta) * rx,
        center.z + Math.cos(theta) * rz,
      ];
    }, { probe: { at: [side * 0.132, 0.107, 0.052], toward: [0, 0, 1] } }));
    add(cord(cuffRing(curve), 0.0045, true, 48), 'trim');
  }

  // Zip down the front, from the collar to the ribbed hem.
  add(cord([
    [0, 0.255, 0.071],
    [0, 0.1, 0.074],
    [0, -0.032, 0.0736],
  ], 0.0045, false, 32), 'trim');

  // Slanted welt pockets, half-embedded so only the ridge shows.
  for (const side of [-1, 1]) {
    add(cord([
      [side * 0.035, 0.02, 0.0675],
      [side * 0.085, -0.02, 0.0585],
    ], 0.004, false, 16), 'trim');
  }

  return parts;
}

// Casquette (baseball cap), unisex: domed crown, curved front bill, panel
// seams, a top button and an adjustable back strap. The depth axis gets a
// 1.06 stretch because a head is deeper than it is wide.
function hatParts() {
  const parts = [];
  const add = (geometry, role = 'fabric') => parts.push({ geometry, role });

  const crownProfile = [
    [0, 0.145], [0.06, 0.141], [0.105, 0.131], [0.135, 0.115],
    [0.152, 0.093], [0.158, 0.065], [0.16, 0.02], [0.16, -0.04],
  ];
  const crownAt = (t) => {
    const scaled = t * (crownProfile.length - 1);
    const index = Math.min(crownProfile.length - 2, Math.floor(scaled));
    const mix = scaled - index;
    return [
      lerp(crownProfile[index][0], crownProfile[index + 1][0], mix),
      lerp(crownProfile[index][1], crownProfile[index + 1][1], mix),
    ];
  };

  add(surface(36, 96, (t, angle) => {
    const theta = angle * TAU;
    const [radius, y] = crownAt(t);
    return [Math.sin(theta) * radius, y, Math.cos(theta) * radius * 1.06];
  }, { probe: { at: [0, 0.02, 0.1696], toward: [0, 0, 1] } }));

  // The bill grows out of the front rim, drooping toward the tip and
  // cupping upward at the edges, the way a worn-in casquette sits.
  add(surface(8, 48, (u, a) => {
    const phi = lerp(-1.05, 1.05, a);
    const rx = lerp(0.16, 0.205, u);
    const rz = lerp(0.17, 0.29, u);
    return [
      Math.sin(phi) * rx,
      -0.04 - 0.075 * u ** 1.3 + 0.02 * (phi / 1.05) ** 2,
      Math.cos(phi) * rz,
    ];
  }, { probe: { at: [0, -0.115, 0.29], toward: [0, 1, 0] } }));

  // Sweatband edge around the head opening.
  add(cord(ring(0.161, 0.17, -0.04), 0.005, true), 'trim');

  // Six-panel look: seam lines from the button down to the opening.
  for (const seam of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const points = Array.from({ length: 24 }, (_, index) => {
      const [radius, y] = crownAt(index / 23);
      return [Math.sin(seam) * radius, y, Math.cos(seam) * radius * 1.06];
    });
    add(cord(points, 0.0035, false, 48), 'trim');
  }

  const button = new SphereGeometry(0.012, 12, 8);
  button.translate(0, 0.145, 0);
  parts.push({ geometry: button, role: 'trim' });

  // Adjustable strap across the back of the opening.
  add(cord([
    [-0.05, -0.042, -0.16],
    [0, -0.045, -0.1705],
    [0.05, -0.042, -0.16],
  ], 0.006, false, 32), 'trim');

  return parts;
}

// Urban daypack: rounded lid top, gusseted front zip pocket, side bottle
// pockets, padded shoulder straps with buckles and a sternum strap. The
// fabric panel faces +Z so the designer's pattern shows in the showroom.
function backpackParts() {
  const parts = [];
  const add = (geometry, role = 'fabric') => parts.push({ geometry, role });

  // Superellipse (n = 4): a rectangle with softly rounded corners.
  const superPoint = (angle, rx, rz) => {
    const theta = angle * TAU;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return [
      rx * Math.sign(cos) * Math.sqrt(Math.abs(cos)),
      rz * Math.sign(sin) * Math.sqrt(Math.abs(sin)),
    ];
  };

  // Body silhouette: snug under the top zip, fullest across the middle, then
  // curving into a flat base the pack can stand on.
  const bodyStops = [
    [0.0, 0.135, 0.062, 0.155],
    [0.3, 0.157, 0.075, 0.085],
    [0.6, 0.164, 0.078, -0.01],
    [0.85, 0.158, 0.074, -0.115],
    [1.0, 0.132, 0.058, -0.2],
  ];
  const bodyAt = (t) => {
    let index = 0;
    while (index < bodyStops.length - 2 && t > bodyStops[index + 1][0]) index += 1;
    const from = bodyStops[index];
    const to = bodyStops[index + 1];
    const mix = Math.min(1, Math.max(0, (t - from[0]) / (to[0] - from[0])));
    return [lerp(from[1], to[1], mix), lerp(from[2], to[2], mix), lerp(from[3], to[3], mix)];
  };
  const profileAtY = (y) => {
    let index = 0;
    while (index < bodyStops.length - 2 && y < bodyStops[index + 1][3]) index += 1;
    const from = bodyStops[index];
    const to = bodyStops[index + 1];
    const mix = Math.min(1, Math.max(0, (from[3] - y) / (from[3] - to[3])));
    return [lerp(from[1], to[1], mix), lerp(from[2], to[2], mix)];
  };
  const zFront = (x, y) => {
    const [rx, rz] = profileAtY(y);
    return rz * (1 - Math.min(1, Math.abs(x / rx) ** 4)) ** 0.25;
  };
  const xSide = (z, y) => {
    const [rx, rz] = profileAtY(y);
    return rx * (1 - Math.min(1, Math.abs(z / rz) ** 4)) ** 0.25;
  };

  // Main body tube.
  add(surface(24, 96, (t, angle) => {
    const [rx, rz, y] = bodyAt(t);
    const [x, z] = superPoint(angle, rx, rz);
    return [x, y, z];
  }, { probe: { at: [0, -0.02, 0.0776], toward: [0, 0, 1] } }));

  // The lid: a dome rising off the rim so the top reads round, not flat.
  add(surface(10, 96, (t, angle) => {
    const shrink = Math.cos(t * Math.PI / 2);
    const [x, z] = superPoint(angle, 0.135 * shrink, 0.062 * shrink);
    return [x, 0.155 + 0.035 * Math.sin(t * Math.PI / 2), z];
  }, { probe: { at: [0, 0.19, 0], toward: [0, 1, 0] } }));

  // Flat base inside the rounded bottom edge.
  add(surface(8, 96, (t, angle) => {
    const [x, z] = superPoint(angle, 0.132 * t, 0.058 * t);
    return [x, -0.2, z];
  }, { probe: { at: [0, -0.2, 0], toward: [0, -1, 0] } }));

  // Main zip rail wraps the seam where the lid meets the body, with a pull
  // ring hanging at the right.
  add(cord(Array.from({ length: 96 }, (_, index) => {
    const [x, z] = superPoint(index / 96, 0.1375, 0.0645);
    return [x, 0.157, z];
  }), 0.004, true), 'trim');
  const pull = new TorusGeometry(0.014, 0.0035, 8, 24);
  pull.translate(0.13, 0.148, 0.043);
  parts.push({ geometry: pull, role: 'metal' });

  // Carry handle off the crown.
  const handle = new TorusGeometry(0.05, 0.009, 8, 32, Math.PI);
  handle.translate(0, 0.186, -0.012);
  parts.push({ geometry: handle, role: 'trim' });

  // Gusseted front pocket: a soft-rectangle face swelling off the panel,
  // with its own zip along the top edge.
  add(surface(8, 64, (t, angle) => {
    const shrink = Math.cos(t * Math.PI / 2);
    const bulge = Math.sin(t * Math.PI / 2);
    const rim = superPoint(angle, 0.1, 0.07);
    const x = rim[0] * shrink;
    const y = -0.09 + rim[1] * shrink;
    return [x, y, zFront(x, y) - 0.0015 + 0.032 * bulge];
  }, { probe: { at: [0, -0.09, 0.10545], toward: [0, 0, 1] } }));
  add(cord([
    [-0.095, -0.015, 0.078],
    [0, -0.015, 0.0803],
    [0.095, -0.015, 0.078],
  ], 0.0035, false, 32), 'trim');

  // Side bottle pockets: pouches swelling off each side panel behind an
  // elastic seam that rings the pouch.
  for (const side of [-1, 1]) {
    const pocketCenter = -0.1;
    const halfHeight = 0.065;
    const halfDepth = 0.045;
    add(surface(16, 48, (t, column) => {
      const phi = column * TAU;
      const shrink = Math.cos(t * Math.PI / 2);
      const y = pocketCenter + halfHeight * Math.sin(phi) * shrink;
      const z = halfDepth * Math.cos(phi) * shrink;
      return [side * (xSide(z, y) - 0.0015 + 0.02 * Math.sin(t * Math.PI / 2)), y, z];
    }, { probe: { at: [side * (xSide(0, pocketCenter) + 0.0185), pocketCenter, 0], toward: [side, 0, 0] } }));
    add(cord(Array.from({ length: 64 }, (_, index) => {
      const phi = index / 64 * TAU;
      const y = pocketCenter + halfHeight * Math.sin(phi);
      const z = halfDepth * Math.cos(phi);
      return [side * xSide(z, y), y, z];
    }), 0.003, true, 64), 'trim');
  }

  // Padded shoulder straps bow off the back panel, buckle hardware sits at
  // the adjustment point, and a sternum strap ties the two together.
  for (const side of [-1, 1]) {
    const curve = new CatmullRomCurve3([
      new Vector3(side * 0.068, 0.15, -0.056),
      new Vector3(side * 0.09, 0, -0.112),
      new Vector3(side * 0.075, -0.17, -0.056),
    ], false, 'centripetal');
    add(surface(24, 6, (t, width) => {
      const point = curve.getPoint(Math.min(t, 1));
      return [point.x + (width - 0.5) * 0.055, point.y, point.z];
    }, { probe: { at: [side * 0.09, 0, -0.113], toward: [0, 0, -1] } }), 'trim');

    const buckle = new BoxGeometry(0.032, 0.036, 0.007);
    buckle.translate(side * 0.0785, -0.13, -0.0712);
    parts.push({ geometry: buckle, role: 'metal' });
  }

  add(cord([
    [-0.1, -0.03, -0.1056],
    [0, -0.03, -0.1056],
    [0.1, -0.03, -0.1056],
  ], 0.0035, false, 32), 'trim');

  return parts;
}

const BUILDERS = {
  pants: pantsParts,
  jacket: jacketParts,
  hat: hatParts,
  bag: backpackParts,
};

// Non-fabric details keep a fixed neutral color so the pattern only ever
// covers the garment's fabric panels.
const ROLE_STYLE = {
  fabric: { color: '#ffffff', roughness: 0.93, metalness: 0 },
  trim: { color: '#232a3d', roughness: 0.85, metalness: 0 },
  dark: { color: '#1a1e27', roughness: 0.8, metalness: 0 },
  metal: { color: '#8b909a', roughness: 0.35, metalness: 0.7 },
};

/** Builds a fresh garment model; the caller owns its geometry and materials. */
export function createProceduralModel(garment) {
  const build = BUILDERS[garment];
  if (!build) return null;
  const group = new Group();
  group.name = `procedural_${garment}`;
  build().forEach((part, index) => {
    const style = ROLE_STYLE[part.role] || ROLE_STYLE.fabric;
    const material = new MeshStandardMaterial({
      color: style.color,
      roughness: style.roughness,
      metalness: style.metalness,
      side: DoubleSide,
    });
    const mesh = new Mesh(part.geometry, material);
    mesh.name = `${part.role}_${garment}_${index}`;
    mesh.userData.role = part.role;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}
