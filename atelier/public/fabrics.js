// Real fabrics: photo-scanned cloth from Poly Haven (CC0) — its weave as a normal map, its sheen as a roughness map,
// and its light/dark texture (grey) to mix into the garment's own colour. Every map tiles at the fabric's real size,
// on the mesh's second UV set ("uv1"), which is measured in model units (1 unit ≈ 1.15 m).
import * as THREE from 'three';

// size of one texture tile, in model units
const FILE = { poplin: 'canvas', twill: 'canvas' }; // fabrics that share a scan
const TILE = { poplin: 0.06, twill: 0.07, jersey: 0.07, fleece: 0.1, sport: 0.09, denim: 0.1, wool: 0.12, leather: 0.28, linen: 0.1, knit: 0.1, satin: 0.16, canvas: 0.09 };
const loader = new THREE.TextureLoader(), cache = new Map();
function load(url, srgb) {
  return new Promise((resolve, reject) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.channel = 1;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    resolve(t);
  }, undefined, reject));
}
// { normal, rough, detail (grey texture), tile } for a fabric name; null if the files can't be loaded.
export function fabricMaps(name) {
  const key = TILE[name] ? name : 'jersey';
  if (!cache.has(key)) {
    cache.set(key, Promise.all(['nor', 'rough', 'diff'].map((m) => load(`assets/fabric/${FILE[key] || key}_${m}.jpg`, false)))
      .then(([normal, rough, detail]) => {
        for (const t of [normal, rough, detail]) t.repeat.set(1 / TILE[key], 1 / TILE[key]);
        return { normal, rough, detail, tile: TILE[key] };
      }).catch((e) => { console.warn('fabric textures unavailable:', key, e); return null; }));
  }
  return cache.get(key);
}
// The grey fabric texture mixed into a colour canvas (soft light keeps the colour, adds the cloth's own variation).
export function weaveInto(ctx, size, detail, tilePx, strength = 0.85) {
  const img = detail?.image;
  if (!img) return;
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = strength;
  for (let y = 0; y < size; y += tilePx) for (let x = 0; x < size; x += tilePx) ctx.drawImage(img, x, y, tilePx, tilePx);
  ctx.restore();
}
// Adds a second UV set in model units, from the first one scaled by `scale` (u, v).
export function addUnitUV(geo, su, sv = su) {
  if (geo.attributes.uv1) return geo;
  const uv = geo.attributes.uv, a = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { a[i * 2] = uv.getX(i) * su; a[i * 2 + 1] = uv.getY(i) * sv; }
  geo.setAttribute('uv1', new THREE.BufferAttribute(a, 2));
  return geo;
}
