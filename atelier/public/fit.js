// Your body and the fit, like a virtual fitting room: a realistic avatar (Blender Studio Human Base Meshes, CC0) reshaped
// to your height, chest, waist and hips. The clothes keep their designed shape and the avatar adapts to each look: its
// arms take the sleeves' angle and the skin under the fabric is hidden (per-vertex masks made in Blender, see
// blender/fit_garments.py), so the body never pokes through. Every garment's size chart is compared with your
// measurements to recommend a size and colour a fit map: tight, snug, good fit or loose, at the chest, waist and hips.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Bump when the models (garments, avatars, masks) change: the files are cached for a year under their version.
export const V = '20261006c';
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const FRAME_H = 1.75; // the garments' body frame is a 1.75 m person
const LEVEL = { chest: 0.725, waist: 0.61, hips: 0.52 };   // heights as a share of body height
// minimum ease (garment minus body, cm) for each cut
const MIN_EASE = { fitted: 2, 'fitted waist': 2, 'fitted bodice': 2, regular: 6, relaxed: 10, tailored: 4, wide: 6, baggy: 10, draped: 4 };
export const STATUS = {
  tight: { label: 'Too tight', color: '#d64545' }, snug: { label: 'Snug', color: '#e8913a' },
  good: { label: 'Good fit', color: '#3aa565' }, loose: { label: 'Loose', color: '#4a7fd6' },
};
// ---------- size advice ----------
// For each piece with a size chart: its girths in every size, the smallest size that leaves enough ease everywhere,
// and how each zone fits in the chosen size.
export function fitAdvice(cat, pieces, body, chosen = {}) {
  return pieces.map((p) => {
    const info = cat[p.asset], chart = info?.size;
    if (!chart) return { asset: p.asset, name: p.name, sized: false };
    const min = MIN_EASE[chart.fit] ?? 6;
    const zones = Object.entries(chart.M).filter(([, v]) => v);
    const girthAt = (i, v) => v + (i - 2) * chart.grade;
    const ease = (i) => Object.fromEntries(zones.map(([z, v]) => [z, Math.round(girthAt(i, v) - body[z])]));
    const minAt = (z) => (z === 'waist' && info.slot === 'bottom' ? 1 : min); // a waistband sits close
    const okAt = (i) => zones.every(([z, v]) => girthAt(i, v) - body[z] >= minAt(z));
    let rec = SIZES.findIndex((_, i) => okAt(i));
    const outOfRange = rec < 0;
    if (outOfRange) rec = SIZES.length - 1;
    const size = SIZES.includes(chosen[p.asset]) ? SIZES.indexOf(chosen[p.asset]) : rec;
    const e = ease(size);
    const status = Object.fromEntries(Object.entries(e).map(([z, d]) => [z, d < 0 ? 'tight' : d < minAt(z) ? 'snug' : d < minAt(z) + 12 ? 'good' : 'loose']));
    const main = info.slot === 'bottom' ? (chart.M.hips ? 'hips' : 'waist') : 'chest';
    // the smallest scale at which the garment still reaches around the body (a size tighter than the body would
    // sink into it and the skin would poke through)
    const minScale = Math.max(1, ...zones.map(([z, v]) => (girthAt(size, v) > 0 ? body[z] / girthAt(size, v) : 1)));
    return { asset: p.asset, name: p.name, sized: true, recommended: SIZES[rec], outOfRange, size: SIZES[size], ease: e, status, fit: chart.fit, minScale,
      scale: (girthAt(size, chart.M[main] || chart.M.hips || chart.M.waist)) / (chart.M[main] || chart.M.hips || chart.M.waist) };
  });
}

// ---------- the avatar ----------
const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader().setDRACOLoader(draco);
let avatarInfo = null;
export const avatarCatalogue = () => (avatarInfo ||= fetch(`models/avatars/avatars.json?v=${V}`).then((r) => { if (!r.ok) throw new Error('The avatars could not be loaded.'); return r.json(); }));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('The avatar could not be loaded.'); return r.json(); });
// Per garment: which avatar vertices it covers (a bit each) and the arm angle its sleeves need (null: the avatar's own).
const covers = new Map();
export function garmentCover(gender) {
  if (!covers.has(gender)) covers.set(gender, json(`models/garments/${gender}/cover.json?v=${V}`).then((c) =>
    Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { bits: b64(v.mask), arm: v.arm }]))));
  return covers.get(gender);
}
const bases = new Map();
// The avatar's geometry, with every triangle sorted into a body region.
function loadBase(gender) {
  if (!bases.has(gender)) bases.set(gender, Promise.all([avatarCatalogue(), loader.loadAsync(`models/avatars/${gender}.glb?v=${V}`), json(`models/avatars/${gender}-arms.json?v=${V}`)]).then(([info, gltf, rig]) => {
    let mesh; gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld);
    const H = info[gender].height, pos = geo.attributes.position, n = pos.count;
    // torso half-width per 1.5 cm band: walk out from the middle until the gap to the arm
    const bins = new Map();
    for (let i = 0; i < n; i++) { const b = Math.round(pos.getY(i) / 0.015); (bins.get(b) || bins.set(b, []).get(b)).push(pos.getX(i)); }
    const half = new Map(), cz = new Map(), legX = new Map();
    for (const [b, xs] of bins) {
      xs.sort((a, c) => a - c);
      let m = xs.findIndex((x) => x >= 0); if (m < 0) m = xs.length - 1;
      let lo = m, hi = m;
      while (lo > 0 && xs[lo] - xs[lo - 1] < 0.02) lo--;
      while (hi < xs.length - 1 && xs[hi + 1] - xs[hi] < 0.02) hi++;
      half.set(b, Math.max(-xs[lo], xs[hi]));
    }
    const region = new Uint8Array(n), NAMES = ['head', 'shoulders', 'torso', 'pelvis', 'upperArm', 'forearm', 'hand', 'thigh', 'calf', 'foot'];
    const R = Object.fromEntries(NAMES.map((k, i) => [k, i]));
    const sums = new Map();
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), t = y / H, ax = Math.abs(x), b = Math.round(y / 0.015);
      let r;
      if (t > 0.845 && ax < 0.13) r = R.head;
      else if (t < 0.05) r = R.foot;
      else if (t < 0.28) r = R.calf;
      else if (t < 0.47 && ax < 0.2) r = R.thigh;
      else if (t > 0.78) r = R.shoulders;
      else if (ax > (half.get(b) ?? 0.2) + 0.004) r = t > 0.63 ? R.upperArm : t > 0.5 ? R.forearm : R.hand;
      else r = t > 0.56 ? R.torso : R.pelvis;
      region[i] = r;
      if (r === R.torso || r === R.pelvis || r === R.shoulders) { const s = sums.get(b) || [0, 0]; s[0] += pos.getZ(i); s[1]++; sums.set(b, s); }
      if (r === R.thigh || r === R.calf) { const k = `${b}${x > 0 ? '+' : '-'}`, s = legX.get(k) || [0, 0, 0]; s[0] += x; s[1] += pos.getZ(i); s[2]++; legX.set(k, s); }
    }
    for (const [b, [z, c]] of sums) cz.set(b, z / c);
    const arms = { joint: rig.joint, angle: rig.angle, w: b64(rig.w) };
    return { geo, H, base: info[gender].measurements, region, R, NAMES, half, cz, legX, arms, rest: pos.array.slice() };
  }));
  return bases.get(gender);
}
const SKIN = new THREE.MeshPhysicalMaterial({ color: 0xd2ab95, roughness: 0.6, sheen: 0.12, sheenColor: new THREE.Color(0xc99a84), sheenRoughness: 0.8, // a soft sheen: a bright one rims the arms in white
  vertexColors: true, // the face (eyes, brows, lips, blush) is painted per-vertex: the model has no texture
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); // drawn just behind the clothes where they touch

// The body change from the avatar's own measurements to yours, as a function of a point in the avatar's space.
// Used for the avatar itself and for the clothes (fitted to the avatar in Blender), so the two always match.
// mode: 'body' (by the avatar's own regions), 'legs' (trousers: each leg grows from its own axis), 'skirt' (dresses,
// skirts, long coats: one tube around both legs, growing with the hips).
function makeDeformer(B, body) {
  const kH = body.height / 100 / B.H;
  const f = { chest: body.chest / (B.base.chest * kH), waist: body.waist / (B.base.waist * kH), hips: body.hips / (B.base.hips * kH) };
  const girthF = (t) => {
    if (t >= 0.8) return 1 + (f.chest - 1) * 0.5;
    if (t >= LEVEL.chest) return f.chest + (1 + (f.chest - 1) * 0.5 - f.chest) * (t - LEVEL.chest) / (0.8 - LEVEL.chest);
    if (t >= LEVEL.waist) return f.waist + (f.chest - f.waist) * (t - LEVEL.waist) / (LEVEL.chest - LEVEL.waist);
    if (t >= LEVEL.hips) return f.hips + (f.waist - f.hips) * (t - LEVEL.hips) / (LEVEL.waist - LEVEL.hips);
    return f.hips;
  };
  const { R } = B;
  const torso = (x, y, z, t, b) => { const k = girthF(t), c = B.cz.get(b) ?? 0; return [x * k, y, c + (z - c) * k]; };
  const leg = (x, y, z, t, b, thigh) => {
    const s = B.legX.get(`${b}${x > 0 ? '+' : '-'}`);
    if (!s) return torso(x, y, z, Math.max(t, LEVEL.hips), b);
    const lx = s[0] / s[2], lz = s[1] / s[2], k = 1 + (f.hips - 1) * (thigh ? 0.3 + 0.5 * Math.max(0, (t - 0.28) / 0.19) : 0.2);
    return [lx + (x - lx) * k + lx * (k - 1) * 0.6, y, lz + (z - lz) * k];
  };
  // The arm keeps its own shape but joins the torso exactly where the torso ends: it moves by the same amount the
  // torso moved at the armpit band (same girth factor and same centre), so no seam opens or folds there at any size.
  const kAp = girthF(0.775), apX = B.half.get(Math.round(0.775 * B.H / 0.015)) ?? 0.16;
  const arm = (x, y, z, b) => { const c = B.cz.get(b) ?? 0; return [x + Math.sign(x) * (kAp - 1) * apX, y, c + (z - c) * kAp]; };
  return (x, y, z, mode, region) => {
    const t = y / B.H, b = Math.round(y / 0.015);
    let p;
    if (mode === 'body') {
      if (region === R.torso || region === R.pelvis || region === R.shoulders) p = torso(x, y, z, t, b);
      else if (region === R.thigh || region === R.calf) p = leg(x, y, z, t, b, region === R.thigh);
      else if (region === R.upperArm || region === R.forearm || region === R.hand) p = arm(x, y, z, b);
      else p = [x, y, z];
    } else {
      const inTorso = Math.abs(x) <= (B.half.get(b) ?? 0.18) * 1.3 + 0.03;
      if (t < 0.05) p = [x, y, z];                                                   // shoes
      else if (t < 0.47) p = mode === 'skirt' ? torso(x, y, z, LEVEL.hips - 0.01, b) : leg(x, y, z, t, b, t > 0.28);
      else if (t > 0.845) p = [x, y, z];                                             // hats
      else p = inTorso || t < 0.56 ? torso(x, y, z, t, b) : arm(x, y, z, b);
    }
    return [p[0] * kH, p[1] * kH, p[2] * kH];
  };
}
export async function bodyDeformer(gender, body) { const B = await loadBase(gender); return makeDeformer(B, body); }

// Both arms turned about the shoulder joints from the avatar's own angle to `angle` (degrees from vertical, outward
// positive), each vertex by its arm weight (the same turn the garments' masks were made with).
function poseArms(B, angle) {
  const p = B.rest.slice(), { joint: [jx, jy], w } = B.arms, d = (angle - B.arms.angle) * Math.PI / 180;
  for (let i = 0; i < w.length; i++) {
    if (!w[i]) continue;
    const x = p[i * 3], y = p[i * 3 + 1], sg = Math.sign(x), a = sg * d * w[i] / 255;
    const dx = x - sg * jx, dy = y - jy, c = Math.cos(a), s = Math.sin(a);
    p[i * 3] = sg * jx + dx * c - dy * s; p[i * 3 + 1] = jy + dx * s + dy * c;
  }
  return p;
}
// A face without textures: eyes, brows, lips and a touch of blush painted straight onto the vertices by position
// (the head box gives the landmarks), so the avatar is never a blank doll. Only the front of the head is painted.
function paintFace(geo, B, H) {
  const pos = geo.attributes.position, n = pos.count;
  let y1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (B.region[i] !== 0) continue; // 0 = head
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > y1) y1 = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!(y1 > 0) || !(x1 > x0)) return;
  const cx = (x0 + x1) / 2, hw = (x1 - x0) || 0.1, zFront = z0 + (z1 - z0) * 0.55;
  const L = 0.135 * H; // crown to chin, from the avatar's final height: the face box also holds the neck
  const hh = L, eyeY = y1 - L * 0.5, browY = eyeY + L * 0.07, mouthY = y1 - L * 0.73; // eyes mid-head, mouth a third up from the chin
  const col = geo.getAttribute('color');
  for (let i = 0; i < n; i++) {
    if (B.region[i] !== 0 || pos.getZ(i) < zFront) continue;
    const x = pos.getX(i), y = pos.getY(i);
    const paint = (dx, dy, rx, ry, tint, strength) => {
      const d = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (d >= 1) return;
      const s = (1 - d) ** 2 * strength, r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      col.setXYZ(i, r + (tint[0] - r) * s, g + (tint[1] - g) * s, b + (tint[2] - b) * s);
    };
    const side = Math.abs(x - cx);
    paint(side - hw * 0.21, y - eyeY, hw * 0.11, hh * 0.035, [0.18, 0.13, 0.11], 0.75);   // eyes (mirrored)
    paint(side - hw * 0.21, y - browY, hw * 0.13, hh * 0.022, [0.32, 0.23, 0.16], 0.6);    // brows
    paint(x - cx, y - mouthY, hw * 0.15, hh * 0.028, [0.72, 0.42, 0.4], 0.7);              // lips
    paint(side - hw * 0.28, y - (mouthY + hh * 0.06), hw * 0.16, hh * 0.06, [0.86, 0.56, 0.5], 0.2); // blush
  }
  col.needsUpdate = true;
}

// The avatar for a body { height, chest, waist, hips } (cm), dressed in `assets`: posed for their sleeves, and without
// the skin they cover (a triangle is hidden when all three corners are covered).
// part: 'legs' shows only the legs (looks with bare legs, otherwise the shoes would float under a hem).
export async function buildAvatar(gender, body, assets = [], part = 'body') {
  const [B, cover] = await Promise.all([loadBase(gender), garmentCover(gender)]);
  const geo = B.geo.clone(), pos = geo.attributes.position, n = pos.count;
  const worn = assets.map((a) => cover[a]).filter(Boolean);
  // the arms follow the outermost sleeves: a jacket's, else the top's, else a dress's
  const arm = worn.find((c) => c.arm != null)?.arm;
  const rest = arm != null ? poseArms(B, arm) : B.rest;
  const deform = makeDeformer(B, body);
  for (let i = 0; i < n; i++) {
    const p = deform(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], 'body', B.region[i]);
    pos.setXYZ(i, p[0], p[1], p[2]);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  paintFace(geo, B, body.height / 100);
  geo.computeVertexNormals();
  const covered = (i) => worn.some((c) => c.bits[i >> 3] & (1 << (i & 7)));
  // Skin under the fabric sits a few millimetres deeper: at the edge of the mask (a kept triangle is kept whole)
  // and wherever the body and the garment deform slightly differently, the skin can never poke through.
  const nrm = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    if (!covered(i)) continue;
    pos.setXYZ(i, pos.getX(i) - nrm.getX(i) * 0.005, pos.getY(i) - nrm.getY(i) * 0.005, pos.getZ(i) - nrm.getZ(i) * 0.005);
  }
  geo.computeVertexNormals();
  const idx = geo.index.array, keep = [], low = (i) => B.rest[i * 3 + 1] / B.H < 0.56 && Math.abs(B.rest[i * 3]) < 0.23;   // below the crotch, and not the hands
  for (let t = 0; t < idx.length; t += 3) {
    if (part === 'legs' && !(low(idx[t]) && low(idx[t + 1]) && low(idx[t + 2]))) continue;
    if (!(covered(idx[t]) && covered(idx[t + 1]) && covered(idx[t + 2]))) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  geo.setIndex(keep);
  const m = new THREE.Mesh(geo, SKIN); m.castShadow = m.receiveShadow = true;
  const group = new THREE.Group(); group.add(m);
  group.userData.avatar = true;
  return group;
}
// Reshapes a garment (fitted to the avatar) to the same body; ease: extra scale for the chosen size (1 = recommended).
export function reshapeGarment(garment, deform, mode, ease = 1) {
  const v = new THREE.Vector3();
  garment.updateMatrixWorld(true);
  garment.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone(), pos = geo.attributes.position, inv = o.matrixWorld.clone().invert();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const p = deform(v.x * ease, v.y, v.z * ease, mode);
      v.set(p[0], p[1], p[2]).applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    o.geometry = geo; o.userData.ownGeometry = true;
  });
}

// Fit map: paint a garment by how each zone fits (by height on the body).
export function paintFit(garment, status, H) {
  const zoneAt = (t) => (t > 0.66 ? 'chest' : t > 0.565 ? 'waist' : 'hips');
  const c = new THREE.Color();
  garment.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone(), pos = geo.attributes.position, col = new Float32Array(pos.count * 3), v = new THREE.Vector3();
    o.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const st = status[zoneAt(v.y / H)] || status.hips || status.waist || status.chest;
      c.set(st ? STATUS[st].color : '#9aa0a6');
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.geometry = geo;
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  });
}
