// Garment types, all built from the one realistic t-shirt model (sewing-pattern UVs, baked folds), so every type keeps
// the real fabric look and carries the print the same way. A type is a small recipe:
//   sleeves: none | short | three-quarter | long      length: crop | regular | long | dress
//   neck: crew | v      hood, zip: true/false      pocket: none | kangaroo | chest
//   ribbed: ribbed collar, cuffs and waistband      fabric: jersey | fleece | sport | denim | wool | leather | linen | knit | satin
//   buttons: a buttoned front      collar: a standing collar      pattern: none | stripes | pinstripe | plaid | camo | dots
// Sleeves are removed or lengthened and the body is lengthened by moving the model's vertices; armholes, crops and
// V-necks are cut with a per-vertex alpha (smooth edges); ribbing, pockets and zips are painted into the fabric
// texture; the hood and drawstrings are extra meshes.
import * as THREE from 'three';

export const TSHIRT = { id: 'tshirt', name: 'T-shirt', sleeves: 'short', length: 'regular', neck: 'crew', hood: false, zip: false,
  pocket: 'none', ribbed: false, fabric: 'jersey', buttons: false, collar: false, pattern: 'none' };
export const garmentKey = (g) => ['sleeves', 'length', 'neck', 'hood', 'zip', 'pocket', 'ribbed', 'fabric', 'buttons', 'collar', 'pattern', 'patternColor'].map((k) => g[k]).join('|');

// The model's pattern pieces, by their place in the texture: front and back body panels, the two sleeves, the collar.
const region = (u, v) => (v >= 0.94 ? 'collar' : v > 0.721 ? 'sleeve' : u < 0.5 ? 'front' : 'back');
// A point on the body (x, y in model units) → its place in the texture, from a fit of the model's own UVs.
export const toUV = {
  front: (x, y) => [1.1756 * x + 0.2605, -1.1047 * y + 0.3166],
  back: (x, y) => [-1.1673 * x + 0.7457, -1.1178 * y + 0.3101],
};
const HEM_Y = -0.352, CROP_Y = -0.13, BODY_ZC = 0.012;
const NECK = { x: 0.002, y: 0.241, z: -0.006, rx: 0.088, rz: 0.074 };
const SLEEVE_EXT = { 'three-quarter': 0.16, long: 0.31 };
const BODY_EXT = { long: { ext: 0.13, flare: 0.04 }, dress: { ext: 0.44, flare: 0.3 } };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- body geometry ----------
const shapes = new Map();
export function bodyGeometry(base, g) {
  const key = ['sleeves', 'length', 'neck', 'ribbed'].map((k) => g[k]).join('|');
  if (!shapes.has(key)) shapes.set(key, shape(base, g));
  return shapes.get(key);
}
function shape(base, g) {
  if (g.sleeves === 'short' && g.length === 'regular' && g.neck === 'crew' && !g.ribbed) return base; // the t-shirt as modelled
  const geo = base.clone();
  const pos = geo.attributes.position, uv = geo.attributes.uv, n = pos.count;
  const reg = Array.from({ length: n }, (_, i) => region(uv.getX(i), uv.getY(i)));
  const p0 = pos.array.slice(), moved = new Float32Array(n), alpha = new Float32Array(n).fill(1);
  const P = (i) => new THREE.Vector3(p0[i * 3], p0[i * 3 + 1], p0[i * 3 + 2]);
  const body = (i) => reg[i] === 'front' || reg[i] === 'back';

  // Sleeves: lengthened along their own direction (the cuff end moves, the armhole stays), narrowing to the cuff.
  if (SLEEVE_EXT[g.sleeves]) {
    const ext = SLEEVE_EXT[g.sleeves], taper = g.sleeves === 'long' ? 0.68 : 0.82;
    for (const side of [1, -1]) {
      const A = new THREE.Vector3(side * 0.177, 0.092, -0.016), H = new THREE.Vector3(side * 0.205, -0.002, -0.023); // armhole, hem centres
      const d = H.clone().sub(A), L = d.length(); d.normalize();
      const e = new THREE.Vector3(d.x + side * 0.08, d.y, d.z).normalize(); // hang a little away from the body
      for (let i = 0; i < n; i++) {
        if (reg[i] !== 'sleeve' || Math.sign(p0[i * 3]) !== side) continue;
        const p = P(i), s = p.clone().sub(A).dot(d) / L, w = smooth(0.12, 1, s);
        if (!w) continue;
        const axis = A.clone().addScaledVector(d, p.clone().sub(A).dot(d)), r = p.clone().sub(axis);
        p.addScaledVector(e, ext * w).addScaledVector(r, (taper - 1) * w);
        pos.setXYZ(i, p.x, p.y, p.z); moved[i] = w;
      }
    }
  }
  // Body: a ribbed waistband gathers the hem a little; longer garments stretch below the waist and flare.
  const lower = BODY_EXT[g.length];
  for (let i = 0; i < n; i++) {
    if (!body(i)) continue;
    let x = pos.getX(i), y = p0[i * 3 + 1], z = pos.getZ(i), m = 0;
    if (g.ribbed && g.length !== 'crop') {
      const t = clamp01((-0.29 - y) / (-0.29 - HEM_Y)) * (g.length === 'dress' ? 0 : 1);
      if (t) { x *= 1 - 0.05 * t; z = BODY_ZC + (z - BODY_ZC) * (1 - 0.05 * t); m = t; }
    }
    if (lower && y < -0.2) {
      const t = (-0.2 - y) / (-0.2 - HEM_Y), f = 1 + lower.flare * t * t;
      y -= lower.ext * t; x *= f; z = BODY_ZC + (z - BODY_ZC) * f; m = 1;
    }
    if (m) { pos.setXYZ(i, x, y, z); moved[i] = Math.max(moved[i], m); }
  }
  // Cuts (alpha < 0.5 is cut away). The alpha ramps gently over several triangles so that, interpolated across each
  // triangle, its 0.5 line is a smooth curve rather than the triangles' jagged edges.
  let cut = false;
  for (let i = 0; i < n; i++) {
    const x = p0[i * 3], y = p0[i * 3 + 1], z = p0[i * 3 + 2];
    let a = 1;
    if (body(i) && g.sleeves === 'none') { // tank: deep armholes, narrow straps
      const f = Math.hypot((x - Math.sign(x) * 0.225) / 0.075, (y - 0.15) / 0.17);
      a = Math.min(a, 0.5 + (f - 1) * 1.6);
    }
    if (body(i) && g.length === 'crop') a = Math.min(a, 0.5 + (y - CROP_Y) * 14);
    if (g.neck === 'v' && z > 0 && (body(i) || reg[i] === 'collar')) {
      const half = reg[i] === 'collar' ? 0.068 : (y - 0.115) * 0.62;
      if (y > 0.08) a = Math.min(a, 0.5 + (Math.abs(x) - half) * 14);
    }
    alpha[i] = clamp01(a);
    if (a < 1) cut = true;
  }
  // Sleeveless: the sleeves go entirely.
  if (g.sleeves === 'none') {
    const idx = geo.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (reg[idx[t]] !== 'sleeve' && reg[idx[t + 1]] !== 'sleeve' && reg[idx[t + 2]] !== 'sleeve') keep.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(keep);
  }
  // New shading where the shape changed, blended into the model's own normals.
  if (moved.some(Boolean)) {
    const orig = geo.attributes.normal.array.slice();
    geo.computeVertexNormals();
    const nr = geo.attributes.normal;
    for (let i = 0; i < n; i++) {
      const w = moved[i], v = new THREE.Vector3(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]).lerp(new THREE.Vector3(nr.getX(i), nr.getY(i), nr.getZ(i)), w).normalize();
      nr.setXYZ(i, v.x, v.y, v.z);
    }
  }
  if (cut) {
    const c = new Float32Array(n * 4).fill(1);
    for (let i = 0; i < n; i++) c[i * 4 + 3] = alpha[i];
    geo.setAttribute('color', new THREE.BufferAttribute(c, 4));
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}
export const hasCuts = (g) => g.sleeves === 'none' || g.length === 'crop' || g.neck === 'v';

// ---------- details painted into the fabric (2048 px texture) ----------
// Called before the print (ribbing, pockets) and after it (zip, which runs over a front print).
export function paintDetails(ctx, T, hex, g, stage) {
  const shade = (a) => `rgba(0,0,0,${a})`, light = (a) => `rgba(255,255,255,${a})`;
  const P = (side, x, y) => toUV[side](x, y).map((v) => v * T);
  if (stage === 'under') {
    const ribs = (v0, v1, u0, u1) => {
      for (let x = u0 * T; x < u1 * T; x += 7) { ctx.fillStyle = shade(0.11); ctx.fillRect(x, v0 * T, 3, (v1 - v0) * T); }
      ctx.fillStyle = shade(0.2); ctx.fillRect(u0 * T, v0 * T, (u1 - u0) * T, 3);
    };
    if (g.ribbed) {
      if (g.length === 'crop') {
        for (const side of ['front', 'back']) {
          const v0 = toUV[side](0, CROP_Y + 0.028)[1], v1 = toUV[side](0, CROP_Y - 0.005)[1];
          ribs(v0, v1, side === 'front' ? 0 : 0.5, side === 'front' ? 0.5 : 1);
        }
      } else if (g.length !== 'dress') ribs(0.672, 0.722, 0, 1);       // waistband
      if (g.sleeves !== 'none') ribs(0.9, 0.94, 0, 0.76);               // cuffs
      ribs(0.944, 0.99, 0, 0.5);                                        // collar
    }
    if (g.pocket === 'kangaroo') {
      const top = -0.15, bottom = g.length === 'crop' ? CROP_Y + 0.035 : -0.295;
      if (bottom < top - 0.04) {
        const pts = [[-0.075, top], [0.075, top], [0.125, top - 0.065], [0.125, bottom], [-0.125, bottom], [-0.125, top - 0.065]].map(([x, y]) => P('front', x, y));
        ctx.save();
        ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        ctx.fillStyle = shade(0.05); ctx.fill();
        ctx.lineWidth = 7; ctx.strokeStyle = shade(0.16); ctx.stroke();                 // seam shadow
        ctx.setLineDash([9, 7]); ctx.lineWidth = 2; ctx.strokeStyle = light(0.22); ctx.stroke(); // stitching
        ctx.setLineDash([]);
        for (const s of [-1, 1]) { // the two hand openings
          const [ax, ay] = P('front', s * 0.075, top), [bx, by] = P('front', s * 0.125, top - 0.065);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax + s * 6, by, bx, by);
          ctx.lineWidth = 11; ctx.strokeStyle = shade(0.32); ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (g.pocket === 'chest') {
      const [x0, y0] = P('front', 0.035, 0.125), [x1, y1] = P('front', 0.105, 0.045);
      const [l, t, w, h] = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
      ctx.fillStyle = shade(0.05); ctx.fillRect(l, t, w, h);
      ctx.lineWidth = 6; ctx.strokeStyle = shade(0.16); ctx.strokeRect(l, t, w, h);
      ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = light(0.22); ctx.strokeRect(l + 6, t + 6, w - 12, h - 12); ctx.setLineDash([]);
      ctx.fillStyle = shade(0.25); ctx.fillRect(l, t, w, 5);
    }
  } else if (g.buttons && !g.zip) { // a buttoned placket down the centre front
    const [cx, top] = P('front', 0, 0.2), bottom = g.length === 'crop' ? P('front', 0, CROP_Y)[1] : P('front', 0, HEM_Y)[1];
    ctx.fillStyle = shade(0.07); ctx.fillRect(cx - 22, top, 44, bottom - top);
    ctx.setLineDash([9, 7]); ctx.lineWidth = 2; ctx.strokeStyle = light(0.22);
    for (const dx of [-22, 22]) { ctx.beginPath(); ctx.moveTo(cx + dx, top); ctx.lineTo(cx + dx, bottom); ctx.stroke(); }
    ctx.setLineDash([]);
    for (let y = top + 40; y < bottom - 20; y += 120) {
      ctx.beginPath(); ctx.arc(cx, y, 11, 0, Math.PI * 2); ctx.fillStyle = shade(0.45); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 1, y - 1, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(236,230,218,.9)'; ctx.fill();
    }
  } else if (g.zip) { // a metal zip down the centre front, on its tape, with stitched plackets
    const [cx, top] = P('front', 0, 0.212), bottom = g.length === 'crop' ? P('front', 0, CROP_Y)[1] : P('front', 0, HEM_Y)[1];
    ctx.fillStyle = shade(0.35); ctx.fillRect(cx - 14, top, 28, bottom - top);
    for (let y = top; y < bottom; y += 7) { ctx.fillStyle = (y / 7) % 2 < 1 ? '#c9ccd1' : '#9fa3a9'; ctx.fillRect(cx - 6 + (((y / 7) | 0) % 2 ? 2 : -2), y, 8, 4); }
    ctx.setLineDash([9, 7]); ctx.lineWidth = 2; ctx.strokeStyle = light(0.25);
    for (const dx of [-24, 24]) { ctx.beginPath(); ctx.moveTo(cx + dx, top); ctx.lineTo(cx + dx, bottom); ctx.stroke(); }
    ctx.setLineDash([]);
  }
}
// The cloth itself: a weave for the fabric, then the pattern (both drawn over the whole texture, so they run across
// every pattern piece the same way). Also used for trousers and skirts.
export function paintFabric(ctx, T, hex, g, rand = Math.random, { weave = true } = {}) {
  const s = T / 2048, shade = (a) => `rgba(0,0,0,${a})`, light = (a) => `rgba(255,255,255,${a})`;
  const pc = g.patternColor || contrast(hex);
  switch (g.pattern) {
    case 'stripes': ctx.fillStyle = pc; for (let y = 0; y < T; y += 72 * s) ctx.fillRect(0, y, T, 30 * s); break;
    case 'pinstripe': ctx.fillStyle = pc; for (let x = 0; x < T; x += 44 * s) ctx.fillRect(x, 0, 3 * s, T); break;
    case 'plaid':
      ctx.globalAlpha = 0.42; ctx.fillStyle = pc;
      for (let k = 0; k < T; k += 160 * s) { ctx.fillRect(k, 0, 56 * s, T); ctx.fillRect(0, k, T, 56 * s); }
      ctx.globalAlpha = 1; ctx.fillStyle = light(0.22);
      for (let k = 100 * s; k < T; k += 160 * s) { ctx.fillRect(k, 0, 3 * s, T); ctx.fillRect(0, k, T, 3 * s); }
      ctx.globalAlpha = 1; break;
    case 'camo':
      for (const [c, n] of [[pc, 90], [shadeHex(hex, 0.6), 80], [shadeHex(pc, 0.7), 60]]) {
        ctx.fillStyle = c;
        for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.ellipse(rand() * T, rand() * T, (40 + rand() * 90) * s, (25 + rand() * 50) * s, rand() * 3, 0, Math.PI * 2); ctx.fill(); }
      }
      break;
    case 'dots': ctx.fillStyle = pc;
      for (let y = 0, r = 0; y < T; y += 56 * s, r++) for (let x = (r % 2) * 28 * s; x < T; x += 56 * s) { ctx.beginPath(); ctx.arc(x, y, 10 * s, 0, Math.PI * 2); ctx.fill(); }
      break;
  }
  if (!weave) return;
  switch (g.fabric) {
    case 'denim': // diagonal twill
      ctx.lineWidth = 2 * s;
      for (let k = -T; k < T; k += 7 * s) { ctx.strokeStyle = (k / (7 * s)) % 2 ? light(0.07) : shade(0.08); ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + T, T); ctx.stroke(); }
      for (let i = 0; i < 1600; i++) { ctx.fillStyle = light(0.05 + rand() * 0.07); ctx.fillRect(rand() * T, rand() * T, (10 + rand() * 40) * s, 2 * s); }
      break;
    case 'knit': for (let x = 0; x < T; x += 12 * s) { ctx.fillStyle = shade(0.12); ctx.fillRect(x, 0, 4 * s, T); } break;
    case 'linen': for (let i = 0; i < 2500; i++) { ctx.fillStyle = rand() < 0.5 ? light(0.08) : shade(0.06); ctx.fillRect(rand() * T, rand() * T, (8 + rand() * 30) * s, 1.5 * s); } break;
    case 'wool': for (let i = 0; i < 9000; i++) { ctx.fillStyle = rand() < 0.5 ? light(0.06) : shade(0.07); ctx.fillRect(rand() * T, rand() * T, 2 * s, 2 * s); } break;
  }
}
// A colour that reads on top of hex (for patterns without a chosen colour), and a darker/lighter version of a colour.
function contrast(hex) { const c = new THREE.Color(hex), l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; return l > 0.5 ? '#1b2340' : '#f2efe8'; }
export function shadeHex(hex, k) { return `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`; }

// Where the print may go on this type (texture fractions), adjusted for pockets, hoods and crops.
export function printArea(base, g, placement) {
  const p = { ...base };
  if (g.pocket === 'kangaroo' && placement.startsWith('front')) p.maxH = Math.min(p.maxH, 0.25);
  if (g.hood && placement === 'back') p.top += 0.13; // below the hood lying on the back
  if (g.hood && placement.startsWith('front')) p.top += 0.035; // mostly below the drawstrings
  if (g.length === 'crop' && placement !== 'chest-left') p.maxH = Math.min(p.maxH, toUV.front(0, CROP_Y + 0.04)[1] - p.top);
  if (g.neck === 'v' && placement.startsWith('front')) p.top += 0.06;
  return p;
}

// ---------- extra parts ----------
const parts = new Map();
// Hood lying down: a rolled rim around the neck that thins to nothing where its two edges meet at the front, and a
// soft fold of fabric resting on the upper back.
function hoodGeometry() {
  const T0 = 0.28, NS = 72, NP = 30, verts = [], uvs = [], index = [];
  for (let a = 0; a <= NS; a++) {
    const th = T0 + (2 * Math.PI - 2 * T0) * a / NS, b = (1 - Math.cos(th)) / 2;
    const e = smooth(T0, T0 + 1.0, th) * smooth(T0, T0 + 1.0, 2 * Math.PI - th);
    const rho = 0.023 * (0.3 + 0.7 * e) * (0.82 + 0.18 * b), drop = (0.02 + 0.17 * b * b) * e;
    const R = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
    const N = new THREE.Vector3(NECK.x + NECK.rx * Math.sin(th), NECK.y + 0.006, NECK.z + NECK.rz * Math.cos(th));
    for (let s = 0; s <= NP; s++) {
      const k = s / NP;
      let r, y;
      if (k < 0.5) { const f = k / 0.5 * Math.PI; r = rho * (1 - Math.cos(f)); y = rho * (0.9 + 0.35 * b) * Math.sin(f); }
      else { const t = (k - 0.5) / 0.5; r = 2 * rho + (0.03 * Math.sin(t * Math.PI) + 0.012 * t) * b * e; y = -drop * t; }
      const p = N.clone().addScaledVector(R, r);
      p.y += y;
      verts.push(p.x, p.y, p.z);
      uvs.push(a / NS * 7, k * 2);
    }
  }
  for (let a = 0; a < NS; a++) for (let s = 0; s < NP; s++) {
    const i = a * (NP + 1) + s, j = i + NP + 1;
    index.push(i, j, i + 1, i + 1, j, j + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
function cordGeometry(side) {
  const curve = new THREE.CatmullRomCurve3([[0.034, 0.258, 0.07], [0.046, 0.22, 0.096], [0.048, 0.17, 0.118], [0.047, 0.125, 0.13], [0.046, 0.1, 0.134]]
    .map(([x, y, z]) => new THREE.Vector3(side * x, y, z)));
  return { cord: new THREE.TubeGeometry(curve, 40, 0.0028, 6), end: curve.getPoint(1) };
}
const cached = (k, f) => { if (!parts.has(k)) parts.set(k, f()); return parts.get(k); };

// Builds the extras for a type; `fabric` is the body's material (the hood is cut from the same cloth).
export function extraParts(g, fabric, hex) {
  const out = [];
  if (g.hood) {
    const mat = fabric.clone();
    mat.map = null; mat.aoMap = null; mat.vertexColors = false; mat.alphaTest = 0;
    mat.color = new THREE.Color(hex).multiplyScalar(0.97);
    if (fabric.normalMap) { mat.normalMap = fabric.normalMap.clone(); mat.normalMap.channel = 0; mat.normalMap.repeat.set(1, 1); mat.normalMap.offset.set(0, 0); mat.normalMap.needsUpdate = true; }
    mat.roughnessMap = null;
    out.push(new THREE.Mesh(cached('hood', hoodGeometry), mat));
    const cordMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).lerp(new THREE.Color(0xf2efe8), 0.55), roughness: 0.75 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const { cord, end } = cached(`cord${side}`, () => cordGeometry(side));
      out.push(new THREE.Mesh(cord, cordMat));
      const tip = new THREE.Mesh(cached('aglet', () => new THREE.CylinderGeometry(0.0034, 0.0034, 0.016, 8)), metal);
      tip.position.copy(end).y -= 0.008;
      out.push(tip);
    }
  }
  if (g.collar) { // a standing collar around the neckline
    const mat = fabric.clone();
    mat.map = null; mat.aoMap = null; mat.vertexColors = false; mat.alphaTest = 0; mat.roughnessMap = null;
    if (mat.normalMap) { mat.normalMap = mat.normalMap.clone(); mat.normalMap.channel = 0; mat.normalMap.repeat.set(6, 1); mat.normalMap.needsUpdate = true; }
    mat.color = new THREE.Color(g.pattern !== 'none' && g.patternColor ? g.patternColor : hex).multiplyScalar(0.9);
    const collar = new THREE.Mesh(cached('collar', () => {
      const geo = new THREE.CylinderGeometry(NECK.rx + 0.006, NECK.rx + 0.002, 0.032, 48, 1, true);
      geo.scale(1, 1, (NECK.rz + 0.004) / (NECK.rx + 0.004));
      return geo;
    }), mat);
    collar.position.set(NECK.x, NECK.y + 0.012, NECK.z);
    out.push(collar);
  }
  if (g.zip) {
    const pull = new THREE.Mesh(cached('pull', () => new THREE.BoxGeometry(0.011, 0.024, 0.003)),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.28 }));
    pull.position.set(0.003, 0.186, 0.094); pull.rotation.set(-0.35, 0, 0.12);
    out.push(pull);
  }
  return out;
}
export const FABRIC = {
  jersey: { roughness: 0.88, sheen: 0.35, sheenRoughness: 0.8, normal: 1 },
  fleece: { roughness: 0.95, sheen: 0.6, sheenRoughness: 0.9, normal: 0.55 },
  sport: { roughness: 0.58, sheen: 0.15, sheenRoughness: 0.5, normal: 0.7, clearcoat: 0.08, clearcoatRoughness: 0.5 },
  denim: { roughness: 0.85, sheen: 0.2, sheenRoughness: 0.8, normal: 1.3 },
  wool: { roughness: 0.96, sheen: 0.55, sheenRoughness: 0.9, normal: 0.6 },
  leather: { roughness: 0.38, sheen: 0, sheenRoughness: 0.5, normal: 0.35, clearcoat: 0.35, clearcoatRoughness: 0.35 },
  linen: { roughness: 0.92, sheen: 0.3, sheenRoughness: 0.8, normal: 1.1 },
  knit: { roughness: 0.97, sheen: 0.5, sheenRoughness: 0.9, normal: 1.5 },
  satin: { roughness: 0.32, sheen: 1, sheenRoughness: 0.3, normal: 0.25 },
  poplin: { roughness: 0.8, sheen: 0.25, sheenRoughness: 0.7, normal: 0.6 },
  twill: { roughness: 0.82, sheen: 0.25, sheenRoughness: 0.7, normal: 0.9 },
};
