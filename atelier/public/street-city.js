// Procedural Japanese shopping street ("shōtengai") around the ATELIER boutique.
// The street runs along the x axis. North side: shop fronts face +z, with the boutique at x -5..5.
// South side: shop fronts face -z. Everything is built from code: no downloads needed.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = (() => { let s = 20261003; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); // seeded: same street every time
const pick = (a) => a[Math.floor(R() * a.length)];
const LEN = 90;                                   // street from x -LEN to +LEN
// Indoor areas (boutique, café): no petals or outdoor effects there.
export const INDOOR = [{ x0: -5.3, x1: 5.3, z0: -14.3, z1: -5.9 }, { x0: 6.2, x1: 15.4, z0: -14.3, z1: -5.9 }, { x0: -15.4, x1: -6.2, z0: -14.3, z1: -5.9 }];
const indoors = (x, z) => INDOOR.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
export const STREET = { len: LEN, northFront: -6, curbN: -3.6, curbS: 3.6, southFront: 6.2 };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function speckle(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * alpha})`;
    g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2);
  }
}

// ---------- ground: asphalt with markings, tiled sidewalks, curbs ----------
function buildGround(scene, add) {
  const asphalt = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#5d6066'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 26000, 0.18);
    for (let i = 0; i < 14; i++) { // repair patches
      g.fillStyle = `rgba(30,32,36,${0.15 + R() * 0.15})`; g.fillRect(R() * w, R() * h, 40 + R() * 120, 20 + R() * 60);
    }
    g.fillStyle = '#f2f0e8'; // white edge lines
    g.fillRect(0, h * 0.04, w, 6); g.fillRect(0, h * 0.96 - 6, w, 6);
    g.fillStyle = '#e8b43a'; // dashed yellow centre line
    for (let x = 0; x < w; x += 128) g.fillRect(x, h / 2 - 4, 80, 8);
  }, [2 * LEN / 24, 1]);
  const road = add(new THREE.PlaneGeometry(2 * LEN, 7.2), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92 }), 0, 0.01, 0, { cast: false });
  road.rotation.x = -Math.PI / 2;
  // crosswalk in front of the boutique, and "止まれ"-style stop line near the shrine
  const zebra = canvasTex(512, 256, (g, w, h) => { for (let x = 0; x < w; x += 64) { g.fillStyle = '#f4f2ea'; g.fillRect(x + 8, 0, 40, h); } });
  const cw = add(new THREE.PlaneGeometry(4, 6.6), new THREE.MeshStandardMaterial({ map: zebra, transparent: true, roughness: 0.8 }), 0, 0.016, 0, { cast: false });
  cw.rotation.x = -Math.PI / 2; cw.rotation.z = Math.PI / 2;

  const tiles = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, 0.12);
    g.strokeStyle = 'rgba(60,55,50,.35)'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
    g.fillStyle = '#d9b43a'; g.fillRect(w * 0.42, 0, w * 0.16, h); // tactile paving strip
  }, [2 * LEN / 2, 1]);
  const swMat = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.95 });
  for (const [z, d] of [[-4.8, 2.4], [4.9, 2.6]]) {
    add(new THREE.BoxGeometry(2 * LEN, 0.15, d), swMat, 0, 0.075, z, { cast: false });
  }
  const curb = new THREE.MeshStandardMaterial({ color: 0xc8c3b9, roughness: 0.9 });
  for (const z of [-3.62, 3.62]) add(new THREE.BoxGeometry(2 * LEN, 0.17, 0.16), curb, 0, 0.085, z);
  // ground beyond the buildings (behind lots, alleys)
  const far = add(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1 }), 0, -0.01, 0, { cast: false });
  far.rotation.x = -Math.PI / 2;
}

// ---------- buildings ----------
const WALLS = ['#e9dcc4', '#d8c8ad', '#c7d3d6', '#a9bfc9', '#d9c2a0', '#bfcdbb', '#e6cfc1', '#8f7258', '#b8a58c', '#d6d0c4', '#9fb1bd', '#e3d6b8'];
const ROOFS = [0x3d4652, 0x4a4f57, 0x5b4a3e, 0x2f3a44, 0x6b6f73];
const SHOPS = [
  ['ラーメン', '春風', '#9e1f1f'], ['喫茶', 'さくら', '#2f5d50'], ['本屋', '古書店', '#3b4a6b'], ['薬局', 'くすり', '#1f6e8c'],
  ['寿司', '松', '#7a2a1e'], ['花屋', 'はな', '#b4556b'], ['パン', 'ベーカリー', '#a8662a'], ['八百屋', 'やさい', '#4c7a2e'],
  ['居酒屋', '鳥よし', '#5a2a1a'], ['和菓子', '甘味処', '#7a5a8a'], ['自転車', 'サイクル', '#2c5f8a'], ['クリーニング', '白洗舎', '#2d6f6b'],
];
function facadeTexture(w, floors, shop, wall) {
  const PX = 64; // pixels per metre
  const windows = [];
  const tex = canvasTex(Math.round(w * PX), floors * 3 * PX, (g, cw, ch) => {
    g.fillStyle = wall; g.fillRect(0, 0, cw, ch);
    const siding = R() < 0.35;
    if (siding) { g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 2; for (let y = 0; y < ch; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); } }
    speckle(g, cw, ch, cw * ch / 60, 0.05);
    const grime = g.createLinearGradient(0, 0, 0, ch); grime.addColorStop(0, 'rgba(0,0,0,0)'); grime.addColorStop(1, 'rgba(40,35,30,.18)');
    g.fillStyle = grime; g.fillRect(0, 0, cw, ch);
    const bays = Math.max(1, Math.round(w / 3));
    for (let f = 1; f < floors; f++) { // upper floors: windows
      const top = ch - (f + 1) * 3 * PX;
      for (let b = 0; b < bays; b++) {
        const bw = cw / bays, ww = bw * (0.42 + R() * 0.2), wh = PX * (1.0 + R() * 0.4);
        const x = b * bw + (bw - ww) / 2, y = top + PX * 0.75;
        g.fillStyle = '#5c5a56'; g.fillRect(x - 5, y - 5, ww + 10, wh + 10);
        const glass = g.createLinearGradient(x, y, x + ww, y + wh);
        glass.addColorStop(0, '#9fb8c8'); glass.addColorStop(0.5, '#cfe0ea'); glass.addColorStop(1, '#7f97a8');
        g.fillStyle = glass; g.fillRect(x, y, ww, wh);
        if (R() < 0.5) { g.fillStyle = pick(['#efe8d8', '#e8d9c0', '#d9e2e8']); g.fillRect(x, y, ww * (0.3 + R() * 0.4), wh); } // curtain
        g.fillStyle = '#5c5a56'; g.fillRect(x + ww / 2 - 2, y, 4, wh); // sliding frame
        windows.push({ x: (x + ww / 2) / PX - w / 2, y: (ch - y - wh / 2) / PX, w: ww / PX, h: wh / PX });
      }
    }
    // ground floor: shop front or house entrance
    const gy = ch - 3 * PX;
    if (shop) {
      g.fillStyle = '#2b2622'; g.fillRect(cw * 0.05, gy + PX * 0.9, cw * 0.9, PX * 2.1);
      const n = Math.max(2, Math.round(w / 1.8));
      for (let i = 0; i < n; i++) { // glass doors / display, lit warm inside
        const x = cw * 0.07 + i * (cw * 0.86 / n), pw = cw * 0.86 / n - 8;
        const inner = g.createLinearGradient(0, gy + PX, 0, ch);
        inner.addColorStop(0, '#f3dfb6'); inner.addColorStop(1, '#b89a6a');
        g.fillStyle = inner; g.fillRect(x, gy + PX * 1.05, pw, PX * 1.95);
        for (let k = 0; k < 6; k++) { g.fillStyle = `hsl(${R() * 360},40%,${45 + R() * 25}%)`; g.fillRect(x + R() * pw * 0.8, gy + PX * (1.9 + R() * 0.9), 8 + R() * 18, 10 + R() * 20); }
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + pw * 0.15, gy + PX * 1.05, pw * 0.12, PX * 1.95);
      }
    } else {
      g.fillStyle = '#6d5a48'; g.fillRect(cw * 0.6, gy + PX * 0.8, PX * 0.95, PX * 2.2); // door
      g.fillStyle = '#9fb8c8'; g.fillRect(cw * 0.12, gy + PX * 1.1, cw * 0.36, PX);   // window
      windows.push({ x: (cw * 0.3) / PX - w / 2, y: 3 - 1.6, w: cw * 0.36 / PX, h: 1 });
    }
  });
  return { tex, windows };
}
// Roof tiles: rows of overlapping kawara tiles with slight colour variation.
function roofTexture(base) {
  return canvasTex(256, 256, (g, w, h) => {
    const c = new THREE.Color(base);
    for (let y = 0; y < h; y += 16) for (let x = -(y / 16 % 2) * 16; x < w; x += 32) {
      const k = 0.85 + R() * 0.3;
      g.fillStyle = `rgb(${c.r * 255 * k | 0},${c.g * 255 * k | 0},${c.b * 255 * k | 0})`;
      g.fillRect(x, y, 31, 15);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + 13, 31, 3);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 2, y + 1, 27, 2);
    }
  }, [3, 3]);
}
// 3D details on a facade, merged into a few meshes per building: window frames and sills, a gutter and downpipe.
const frameMat = new THREE.MeshStandardMaterial({ color: 0x6f6c66, roughness: 0.55, metalness: 0.3 });
const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.5, metalness: 0.4 });
function box(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z); }
function facadeDetails(scene, windows, x, w, H, front, dir, pitched) {
  const frames = [], pipes = [];
  for (const win of windows) {
    const cx = x + win.x, cy = win.y, z = front + dir * 0.05, t = 0.07;
    frames.push(box(win.w + 0.14, t, 0.1, cx, cy + win.h / 2 + t / 2, z));       // head
    frames.push(box(win.w + 0.3, 0.06, 0.22, cx, cy - win.h / 2 - 0.03, front + dir * 0.11)); // sill
    frames.push(box(t, win.h, 0.1, cx - win.w / 2 - t / 2, cy, z));              // jambs
    frames.push(box(t, win.h, 0.1, cx + win.w / 2 + t / 2, cy, z));
    frames.push(box(0.035, win.h, 0.06, cx, cy, front + dir * 0.03));           // sash meeting rail
    if (R() < 0.25) frames.push(box(win.w + 0.2, 0.05, 0.6, cx, cy + win.h / 2 + 0.25, front + dir * 0.3)); // small rain hood
  }
  if (pitched) { // half-round gutter along the eaves, and a downpipe at one corner
    const gz = front + dir * 0.55, side = R() < 0.5 ? -1 : 1;
    pipes.push(new THREE.CylinderGeometry(0.07, 0.07, w + 0.4, 8).rotateZ(Math.PI / 2).translate(x, H - 0.05, gz));
    pipes.push(new THREE.CylinderGeometry(0.045, 0.045, H, 8).translate(x + side * (w / 2 - 0.15), H / 2, front + dir * 0.12));
    pipes.push(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8).rotateX(Math.PI / 2).translate(x + side * (w / 2 - 0.15), H - 0.1, front + dir * 0.33));
  }
  for (const [list, mat] of [[frames, frameMat], [pipes, pipeMat]]) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }
}
function signTexture(text, sub, color, vertical) {
  return vertical
    ? canvasTex(128, 512, (g, w, h) => {
      g.fillStyle = color; g.fillRect(0, 0, w, h); g.strokeStyle = '#f4ead2'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#fbf3df'; g.textAlign = 'center'; g.font = 'bold 74px "Hiragino Mincho ProN", "Hiragino Sans", serif';
      [...text].slice(0, 6).forEach((ch, i, arr) => g.fillText(ch, w / 2, (h / (arr.length + 1)) * (i + 1) + 26));
    })
    : canvasTex(1024, 192, (g, w, h) => {
      g.fillStyle = '#f6efe0'; g.fillRect(0, 0, w, h); g.fillStyle = color; g.fillRect(0, 0, w, 26); g.fillRect(0, h - 26, w, 26);
      g.fillStyle = '#2a1e18'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 96px "Hiragino Mincho ProN", "Hiragino Sans", serif'; g.fillText(`${text}  ${sub}`, w / 2, h / 2 + 4);
    });
}
function prismRoof(w, d, rise, mat) { // gable roof along x
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - 0.35, 0); shape.lineTo(0, rise); shape.lineTo(d / 2 + 0.35, 0); shape.lineTo(-d / 2 - 0.35, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w + 0.5, bevelEnabled: false });
  g.translate(0, 0, -(w + 0.5) / 2); g.rotateY(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}
function building(scene, add, solid, x, w, side, shopInfo) {
  const floors = 2 + (R() < 0.3 ? 1 : 0), H = floors * 3 + 0.3, D = 8 + R() * 3;
  const front = side === 'N' ? STREET.northFront : STREET.southFront, dir = side === 'N' ? 1 : -1; // dir: facade normal z
  const zc = front - dir * D / 2, wall = pick(WALLS);
  const plain = new THREE.MeshStandardMaterial({ color: wall, roughness: 0.9 });
  const facade = facadeTexture(w, floors, !!shopInfo, wall);
  const face = new THREE.MeshStandardMaterial({ map: facade.tex, roughness: 0.85 });
  const mats = [plain, plain, plain, plain, dir > 0 ? face : plain, dir > 0 ? plain : face]; // +x -x +y -y +z -z
  add(new THREE.BoxGeometry(w, H, D), mats, x, H / 2, zc);
  solid(x - w / 2, x + w / 2, Math.min(front, front - dir * D), Math.max(front, front - dir * D));
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(pick(ROOFS)), roughness: 0.7, metalness: 0.1 });
  const pitched = R() < 0.65;
  if (pitched) { const roof = prismRoof(w, D, 1.4 + R(), roofMat); roof.position.set(x, H, zc); roof.castShadow = true; roof.receiveShadow = true; scene.add(roof); }
  else add(new THREE.BoxGeometry(w + 0.1, 0.5, D + 0.1), new THREE.MeshStandardMaterial({ color: 0xbdb7ad, roughness: 0.9 }), x, H + 0.25, zc);
  const fz = front + dir * 0.02;
  facadeDetails(scene, facade.windows, x, w, H, front, dir, pitched);
  if (shopInfo) {
    const [name, sub, color] = shopInfo;
    // awning over the shop front
    const aw = add(new THREE.BoxGeometry(w * 0.92, 0.05, 1.1), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), x, 2.95, front + dir * 0.55);
    aw.rotation.x = dir * 0.28;
    // horizontal sign board above the awning
    add(new THREE.BoxGeometry(Math.min(w * 0.8, 6), 0.75, 0.1), new THREE.MeshStandardMaterial({ map: signTexture(name, sub, color), roughness: 0.6 }), x, 3.55, fz + dir * 0.06).rotation.y = dir > 0 ? 0 : Math.PI;
    // vertical blade sign sticking out over the sidewalk
    const blade = add(new THREE.BoxGeometry(0.08, 2.2, 0.55), new THREE.MeshStandardMaterial({ map: signTexture(name, '', color, true), roughness: 0.6 }), x + w / 2 - 0.4, 4.4, front + dir * 0.4);
    blade.rotation.y = Math.PI / 2;
    // paper lanterns for some
    if (R() < 0.45) for (const off of [-0.9, 0.9]) add(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xb8231c, emissive: 0x4a0a05, roughness: 0.6 }), x + off, 2.55, front + dir * 0.5).scale.set(1, 1.3, 1);
  }
  // balcony with railing on upper floor
  if (floors >= 2 && R() < 0.6) {
    const bw = Math.min(w * 0.7, 4.5), by = 3.25, bz = front + dir * 0.55;
    add(new THREE.BoxGeometry(bw, 0.12, 1.1), plain, x - w * 0.1, by, bz);
    const rail = new THREE.MeshStandardMaterial({ color: 0x8b9096, metalness: 0.6, roughness: 0.4 });
    add(new THREE.BoxGeometry(bw, 0.04, 0.04), rail, x - w * 0.1, by + 1, bz + dir * 0.53);
    for (let i = 0; i <= Math.floor(bw / 0.12); i++) add(new THREE.BoxGeometry(0.02, 1, 0.02), rail, x - w * 0.1 - bw / 2 + i * 0.12, by + 0.5, bz + dir * 0.53, { cast: false });
  }
  // air-conditioner units on the facade
  if (R() < 0.7) {
    const ac = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 });
    add(new THREE.BoxGeometry(0.8, 0.55, 0.3), ac, x + w * 0.25, 3 + 1.0 + R() * 1.5, front + dir * 0.16);
  }
}
function buildBuildings(scene, add, solid) {
  for (const side of ['N', 'S']) {
    let x = -LEN;
    while (x < LEN) {
      let w = 6 + R() * 4.5;
      if (side === 'N' && x < 15.8 && x + w > -16.3) { x = 15.8; continue; }      // MODE + boutique + café lots
      if (side === 'S' && x < 27 && x + w > 15) { x = 27; continue; }           // shrine lot
      if (x + w > LEN) w = LEN - x;
      if (w > 3) building(scene, add, solid, x + w / 2, w - 0.5, side, R() < 0.72 ? pick(SHOPS) : null);
      x += w + (R() < 0.25 ? 1.6 : 0.2); // occasional alley
    }
  }
}

// ---------- shrine entrance with torii gate and stone lanterns ----------
function buildShrine(scene, add, solid) {
  const red = new THREE.MeshStandardMaterial({ color: 0xc8381e, roughness: 0.55 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1b1a, roughness: 0.5 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xaaa69c, roughness: 0.95 });
  const cx = 21, z0 = 7.2;
  for (const dx of [-1.6, 1.6]) {
    add(new THREE.CylinderGeometry(0.17, 0.2, 4.2, 20), red, cx + dx, 2.1, z0);
    add(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 20), black, cx + dx, 0.15, z0);
    solid(cx + dx - 0.25, cx + dx + 0.25, z0 - 0.25, z0 + 0.25);
  }
  add(new THREE.BoxGeometry(3.9, 0.22, 0.32), red, cx, 3.45, z0);                       // nuki
  const kasagi = add(new THREE.BoxGeometry(4.8, 0.26, 0.42), black, cx, 4.3, z0);       // top beam
  kasagi.geometry.attributes.position.array.forEach((v, i, a) => { if (i % 3 === 0 && Math.abs(v) > 2) a[i + 1] += 0.12; });
  add(new THREE.BoxGeometry(4.4, 0.2, 0.36), red, cx, 4.08, z0);
  add(new THREE.BoxGeometry(0.15, 0.6, 0.1), black, cx, 3.75, z0 + 0.12);              // name plaque
  // stone path and lanterns leading to a small shrine hall
  add(new THREE.BoxGeometry(2.2, 0.08, 14), stone, cx, 0.04, z0 + 7, { cast: false });
  for (const dx of [-2.2, 2.2]) for (const dz of [3, 8]) {
    add(new THREE.BoxGeometry(0.5, 0.15, 0.5), stone, cx + dx, 0.08, z0 + dz);
    add(new THREE.CylinderGeometry(0.1, 0.14, 0.9, 8), stone, cx + dx, 0.6, z0 + dz);
    add(new THREE.BoxGeometry(0.45, 0.4, 0.45), new THREE.MeshStandardMaterial({ color: 0xcfc9bc, emissive: 0x6b4a10, emissiveIntensity: 0.4 }), cx + dx, 1.25, z0 + dz);
    add(new THREE.ConeGeometry(0.42, 0.35, 4), stone, cx + dx, 1.6, z0 + dz).rotation.y = Math.PI / 4;
  }
  const hall = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7 });
  add(new THREE.BoxGeometry(5, 2.6, 4), hall, cx, 1.6, z0 + 15.5);
  add(new THREE.BoxGeometry(5.4, 0.3, 4.4), stone, cx, 0.15, z0 + 15.5);
  const roof = prismRoof(5.2, 4, 1.6, new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6 }));
  roof.position.set(cx, 2.9, z0 + 15.5); roof.castShadow = true; scene.add(roof);
  solid(cx - 3, cx + 3, z0 + 13, z0 + 18);
  // low fence around the shrine grounds
  for (const dx of [-6, 6]) add(new THREE.BoxGeometry(0.15, 0.9, 16), stone, cx + dx, 0.45, z0 + 8), solid(cx + dx - 0.1, cx + dx + 0.1, z0, z0 + 16);
}

// ---------- cherry blossom trees with falling petals ----------
function cherryTree(scene, add, x, z, s = 1) {
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a32, roughness: 0.9 });
  const trunk = add(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 2.6 * s, 10), bark, x, 1.3 * s, z);
  trunk.rotation.z = (R() - 0.5) * 0.15;
  const pinks = [0xf6c1d0, 0xf3aec4, 0xf9d3de, 0xeea3bb];
  for (let i = 0; i < 16; i++) {
    const a = R() * Math.PI * 2, r = (0.6 + R() * 1.6) * s;
    const m = add(new THREE.IcosahedronGeometry((0.7 + R() * 0.6) * s, 1),
      new THREE.MeshStandardMaterial({ color: pick(pinks), roughness: 0.85, flatShading: true }),
      x + Math.cos(a) * r, (2.9 + R() * 1.4) * s, z + Math.sin(a) * r);
    m.scale.y = 0.75;
  }
}
let petals = null;
function buildPetals(scene, petalTex) {
  const N = 600, pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([R() * 60 - 30, R() * 7, R() * 20 - 10, R() * 10], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  petals = { pts: new THREE.Points(g, new THREE.PointsMaterial({ map: petalTex, color: 0xffc8d8, size: 0.09, transparent: true, depthWrite: false })), pos, seed, N };
  petals.pts.frustumCulled = false;
  scene.add(petals.pts);
}

// ---------- utility poles and overhead wires ----------
function buildPoles(scene, add, solid) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb5b0a6, roughness: 0.85 });
  const stripes = canvasTex(64, 256, (g, w, h) => { for (let y = -h; y < h * 2; y += 48) { g.fillStyle = '#e7c21f'; g.fillRect(0, y, w, 24); g.fillStyle = '#1b1b1b'; g.fillRect(0, y + 24, w, 24); } g.setTransform(1, -0.3, 0, 1, 0, 0); });
  const guard = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 });
  const wire = new THREE.MeshBasicMaterial({ color: 0x1c1c1c });
  const tops = [];
  for (let x = -LEN + 6; x <= LEN - 6; x += 15) {
    const z = 4.25;
    add(new THREE.CylinderGeometry(0.13, 0.18, 9, 12), concrete, x, 4.5, z);
    add(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 12), guard, x, 1.05, z);
    add(new THREE.BoxGeometry(1.6, 0.1, 0.1), concrete, x, 8.2, z);
    add(new THREE.BoxGeometry(1.1, 0.08, 0.08), concrete, x, 7.6, z);
    if (R() < 0.6) add(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 14), new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5 }), x - 0.35, 6.8, z + 0.25); // transformer
    solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
    tops.push(x);
  }
  // wires: several lines sagging between neighbouring poles, plus a few crossing the street
  const sag = (a, b, drop) => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -drop * 4 * t * (1 - t), 0))); } return pts; };
  for (let i = 0; i < tops.length - 1; i++) {
    for (const [dz, y] of [[-0.7, 8.2], [0.7, 8.2], [-0.45, 7.6], [0.45, 7.6]]) {
      const a = new THREE.Vector3(tops[i], y, 4.25 + dz), b = new THREE.Vector3(tops[i + 1], y, 4.25 + dz);
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sag(a, b, 0.45)), 16, 0.015, 4), wire));
    }
    if (i % 2 === 0) {
      const a = new THREE.Vector3(tops[i], 7.6, 4.25), b = new THREE.Vector3(tops[i] + 3, 6.2, STREET.northFront - 0.1);
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sag(a, b, 0.3)), 16, 0.012, 4), wire));
    }
  }
}

// ---------- street furniture: vending machines, street lamps, parked kei vans ----------
function buildProps(scene, add, solid) {
  const vend = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#e8eef2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d6fb8'; g.fillRect(0, 0, w, 70);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      g.fillStyle = `hsl(${(r * 70 + c * 40) % 360},65%,55%)`; g.fillRect(14 + c * 39, 90 + r * 72, 26, 52);
      g.fillStyle = '#c33'; g.fillRect(18 + c * 39, 146 + r * 72, 18, 8);
    }
    g.fillStyle = '#333'; g.fillRect(30, 400, 196, 70);
  });
  for (const [x, z, ry] of [[9.2, -5.4, 0], [-30, 5.6, Math.PI], [44, -5.4, 0], [-62, -5.4, 0]]) {
    add(new THREE.BoxGeometry(1, 1.85, 0.75), [0, 0, 0, 0, 1, 1].map((k) => (k ? new THREE.MeshStandardMaterial({ map: vend, emissive: 0xffffff, emissiveMap: vend, emissiveIntensity: 0.25 }) : new THREE.MeshStandardMaterial({ color: 0xd8dde0 }))), x, 0.925, z, { ry });
    solid(x - 0.55, x + 0.55, z - 0.45, z + 0.45);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x5a6066, metalness: 0.5, roughness: 0.4 });
  for (let x = -LEN + 12; x < LEN; x += 22) {
    const z = -4.0;
    add(new THREE.CylinderGeometry(0.06, 0.08, 4.6, 8), lampMat, x, 2.3, z);
    add(new THREE.BoxGeometry(0.9, 0.06, 0.06), lampMat, x, 4.55, z + 0.4).rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(0.35, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xffe9b8, emissiveIntensity: 0.4 }), x, 4.48, z + 0.8);
    solid(x - 0.12, x + 0.12, z - 0.12, z + 0.12);
  }
  // white kei vans parked at the kerb
  for (const [x, z, color] of [[-24, 2.4, 0xf2f2ef], [36, -2.4, 0xe9ecef], [-58, 2.4, 0x9fb3c4]]) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.1, metalness: 0.4 });
    add(new THREE.BoxGeometry(3.4, 1.35, 1.48), body, x, 1.05, z);
    add(new THREE.BoxGeometry(1.1, 0.55, 1.5), glass, x + 1.2, 1.35, z);
    add(new THREE.BoxGeometry(2.0, 0.45, 1.5), glass, x - 0.45, 1.4, z);
    for (const dx of [-1.15, 1.15]) for (const dz of [-0.72, 0.72]) {
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 18), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }), x + dx, 0.3, z + dz).rotation.x = Math.PI / 2;
    }
    solid(x - 1.8, x + 1.8, z - 0.85, z + 0.85);
  }
}

// ---------- people: walking along the sidewalks, a few window-shopping ----------
let walkers = [];
export const PEOPLE = ['casual1', 'casual2', 'suit', 'worker', 'woman1', 'woman2', 'beach'];
export function clipOf(gltf, re) { return gltf.animations.find((a) => re.test(a.name.replace(/^.*\|/, ''))); }
export function personFrom(gltf, height = 1.72) { // a fresh, correctly sized copy of a character
  const m = cloneSkinned(gltf.scene), box = new THREE.Box3().setFromObject(gltf.scene);
  m.scale.setScalar(height / (box.max.y - box.min.y));
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  return m;
}
export function addWalkers(scene, gltfs) {
  let k = 0;
  for (const gltf of gltfs) for (let n = 0; n < 2; n++, k++) {
    const m = personFrom(gltf, 1.62 + R() * 0.18), mixer = new THREE.AnimationMixer(m);
    const idler = k % 5 === 4; // some people stand looking at shop windows
    const clip = idler ? clipOf(gltf, /^idle$/i) : clipOf(gltf, /^walk(ing)?$/i);
    if (clip) { const act = mixer.clipAction(clip); act.time = R() * clip.duration; act.play(); }
    const north = k % 2 === 0, dir = R() < 0.5 ? 1 : -1;
    let x = R() * LEN * 1.8 - LEN * 0.9;
    if (Math.abs(x) < 16) x += 20 * Math.sign(x || 1);
    m.position.set(x, 0.15, north ? -4.7 : 4.95);
    m.rotation.y = idler ? (north ? Math.PI : 0) : dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(m);
    walkers.push({ m, mixer, dir: idler ? 0 : dir, speed: 1.1 + R() * 0.35 });
  }
}

// ---------- Café Sakura: a second shop you can walk into ----------
export const cafeTargets = [];
function buildCafe(scene, add, solid) {
  const X0 = 6.3, X1 = 15.3, ZF = -6, ZB = -14, H = 3.6, cx = (X0 + X1) / 2, T = 0.22;
  const wallIn = new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.9, envMapIntensity: 0.3 });
  const wallOut = new THREE.MeshStandardMaterial({ color: 0x6b4a36, roughness: 0.8 });
  const woodFloor = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 32) { g.fillStyle = `hsl(28,${35 + R() * 10}%,${30 + R() * 8}%)`; g.fillRect(0, y, w, 31); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y + 31, w, 1); }
    speckle(g, w, h, 6000, 0.08);
  }, [3, 3]), roughness: 0.6, envMapIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeeff, roughness: 0.03, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  add(new THREE.BoxGeometry(X1 - X0, 0.06, ZF - ZB), woodFloor, cx, 0.03, (ZF + ZB) / 2, { cast: false });
  add(new THREE.BoxGeometry(X1 - X0 + 0.5, 0.25, ZF - ZB + 0.5), wallOut, cx, H + 0.12, (ZF + ZB) / 2);
  add(new THREE.BoxGeometry(X1 - X0, 0.02, ZF - ZB), new THREE.MeshStandardMaterial({ color: 0xf2ece2 }), cx, H - 0.01, (ZF + ZB) / 2, { cast: false });
  add(new THREE.BoxGeometry(X1 - X0 + T * 2, H, T), wallIn, cx, H / 2, ZB - T / 2);
  add(new THREE.BoxGeometry(T, H, ZF - ZB), wallIn, X0 - T / 2, H / 2, (ZF + ZB) / 2);
  add(new THREE.BoxGeometry(T, H, ZF - ZB), wallIn, X1 + T / 2, H / 2, (ZF + ZB) / 2);
  add(new THREE.BoxGeometry(X1 - X0 + T * 2, 1.4, T * 1.5), wallOut, cx, H + 0.7, ZF + 0.1); // sign band
  solid(X0 - 1, X1 + 1, ZB - 0.5, ZB); solid(X0 - 0.4, X0, ZB, ZF); solid(X1, X1 + 0.4, ZB, ZF);
  // front: dark wooden frame, big windows, open door in the middle
  const door = 0.8;
  for (const [a, b] of [[X0, cx - door], [cx + door, X1]]) {
    add(new THREE.BoxGeometry(b - a, 0.5, T), wallOut, (a + b) / 2, 0.25, ZF + T / 2);
    add(new THREE.BoxGeometry(b - a, 2.6, 0.02), glass, (a + b) / 2, 1.8, ZF + T / 2, { cast: false });
    add(new THREE.BoxGeometry(0.08, 2.6, T), dark, (a + b) / 2, 1.8, ZF + T / 2);
    solid(a, b, ZF - 0.05, ZF + T + 0.05);
  }
  for (const x of [X0 + 0.06, cx - door, cx + door, X1 - 0.06]) add(new THREE.BoxGeometry(0.12, 3.1, T + 0.04), dark, x, 1.55, ZF + T / 2);
  add(new THREE.BoxGeometry(X1 - X0, 0.12, T + 0.04), dark, cx, 3.1, ZF + T / 2);
  // sign "CAFÉ SAKURA 喫茶さくら" and a cloth noren curtain at the door
  add(new THREE.BoxGeometry(6, 0.9, 0.08), new THREE.MeshStandardMaterial({ map: canvasTex(1024, 160, (g, w, h) => {
    g.fillStyle = '#2a211b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2dcc0'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '300 76px Georgia, serif'; g.fillText('CAFÉ SAKURA', w * 0.38, h / 2 + 4);
    g.font = 'bold 64px "Hiragino Mincho ProN", serif'; g.fillStyle = '#f3a9c0'; g.fillText('喫茶さくら', w * 0.82, h / 2 + 4);
  }), roughness: 0.6 }), cx, H + 0.7, ZF + 0.3);
  const noren = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#1f3a5a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 60px "Hiragino Mincho ProN", serif'; g.textAlign = 'center'; g.fillText('珈琲', w / 2, 82); });
  for (const dx of [-0.38, 0.38]) add(new THREE.PlaneGeometry(0.72, 0.7), new THREE.MeshStandardMaterial({ map: noren, side: THREE.DoubleSide, roughness: 0.9 }), cx + dx, 2.75, ZF + 0.12, { cast: false });
  // counter with coffee machine, menu board, pendant lights
  add(new THREE.BoxGeometry(3.4, 1.0, 0.7), dark, cx + 1.6, 0.5, ZB + 1.4);
  add(new THREE.BoxGeometry(3.5, 0.06, 0.8), new THREE.MeshStandardMaterial({ color: 0xb98a5c, roughness: 0.4 }), cx + 1.6, 1.03, ZB + 1.4);
  add(new THREE.BoxGeometry(0.6, 0.5, 0.45), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.25 }), cx + 2.6, 1.31, ZB + 1.35);
  solid(cx - 0.1, cx + 3.3, ZB + 0.9, ZB + 1.8);
  add(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshStandardMaterial({ map: canvasTex(660, 390, (g, w, h) => {
    g.fillStyle = '#23302a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#a07a52'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#f1ece0'; g.font = 'italic 44px Georgia, serif'; g.fillText('Menu  メニュー', 40, 70);
    g.font = '30px Georgia, serif';
    [['Coffee  珈琲', '450'], ['Matcha latte  抹茶', '520'], ['Sakura tea  桜茶', '480'], ['Dorayaki  どら焼き', '300']].forEach(([a, b], i) => { g.fillText(a, 50, 140 + i * 58); g.fillText(`${b}円`, w - 150, 140 + i * 58); });
  }), roughness: 0.8 }), cx + 1.6, 2.3, ZB + 0.02, { cast: false });
  for (const [lx, lz] of [[cx - 2.4, -8.4], [cx + 0.2, -8.8], [cx - 2.4, -11.4], [cx + 1.6, -12.6]]) {
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.9, 4), dark, lx, H - 0.45, lz, { cast: false });
    add(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 2.5 }), lx, H - 0.95, lz, { cast: false });
    const l = new THREE.PointLight(0xffc98a, 4, 6, 1.6); l.position.set(lx, H - 1.05, lz); scene.add(l);
  }
  // round tables with chairs
  for (const [tx, tz] of [[cx - 2.6, -8.3], [cx + 0.1, -8.6], [cx - 2.6, -11.2]]) {
    add(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0xc69c6d, roughness: 0.45 }), tx, 0.74, tz);
    add(new THREE.CylinderGeometry(0.04, 0.05, 0.72, 10), dark, tx, 0.37, tz);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }), tx + 0.12, 0.8, tz); // cup
    for (const a of [0.4, Math.PI + 0.4]) {
      const chx = tx + Math.cos(a) * 0.75, chz = tz + Math.sin(a) * 0.75;
      add(new THREE.BoxGeometry(0.42, 0.04, 0.42), dark, chx, 0.46, chz, { ry: -a });
      add(new THREE.BoxGeometry(0.42, 0.45, 0.04), dark, chx + Math.cos(a) * 0.2, 0.7, chz + Math.sin(a) * 0.2, { ry: -a + Math.PI / 2 });
      for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) add(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 6), dark, chx + lx, 0.225, chz + lz, { cast: false });
    }
    solid(tx - 1.1, tx + 1.1, tz - 1.1, tz + 1.1);
  }
  // potted plant by the window
  add(new THREE.CylinderGeometry(0.22, 0.18, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0xd8d2c6 }), X1 - 0.6, 0.29, ZF - 0.6);
  for (let i = 0; i < 6; i++) add(new THREE.IcosahedronGeometry(0.25, 0), new THREE.MeshStandardMaterial({ color: 0x4f7a3a, flatShading: true }), X1 - 0.6 + (R() - 0.5) * 0.3, 0.75 + R() * 0.5, ZF - 0.6 + (R() - 0.5) * 0.3);
  cafeTargets.push({ pos: new THREE.Vector3(cx + 1.6, 1.4, ZB + 1.4), counter: true });
  return { barista: new THREE.Vector3(cx + 1.6, 0.06, ZB + 0.6) };
}

// ---------- MODE: the fashion store (whole looks on mannequins, a stylist at the counter) ----------
function buildMode(scene, add, solid) {
  const X0 = -15.3, X1 = -6.3, ZF = -6, ZB = -14, H = 3.8, cx = (X0 + X1) / 2, T = 0.22;
  const wallIn = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.92, envMapIntensity: 0.3 });
  const wallOut = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.4, metalness: 0.4 });
  const oak = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 42) { g.fillStyle = `hsl(36,${28 + R() * 8}%,${70 + R() * 6}%)`; g.fillRect(0, y, w, 41); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, y + 41, w, 1); }
    speckle(g, w, h, 4000, 0.05);
  }, [3, 3]), roughness: 0.5, envMapIntensity: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xe6f0ff, roughness: 0.03, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  add(new THREE.BoxGeometry(X1 - X0, 0.06, ZF - ZB), oak, cx, 0.03, (ZF + ZB) / 2, { cast: false });
  add(new THREE.BoxGeometry(X1 - X0 + 0.5, 0.25, ZF - ZB + 0.5), wallOut, cx, H + 0.12, (ZF + ZB) / 2);
  add(new THREE.BoxGeometry(X1 - X0, 0.02, ZF - ZB), new THREE.MeshStandardMaterial({ color: 0xf7f6f2 }), cx, H - 0.01, (ZF + ZB) / 2, { cast: false });
  add(new THREE.BoxGeometry(X1 - X0 + T * 2, H, T), wallIn, cx, H / 2, ZB - T / 2);
  add(new THREE.BoxGeometry(T, H, ZF - ZB), wallIn, X0 - T / 2, H / 2, (ZF + ZB) / 2);
  add(new THREE.BoxGeometry(T, H, ZF - ZB), wallIn, X1 + T / 2, H / 2, (ZF + ZB) / 2);
  add(new THREE.BoxGeometry(X1 - X0 + T * 2, 1.4, T * 1.5), wallOut, cx, H + 0.7, ZF + 0.1);
  solid(X0 - 1, X1 + 1, ZB - 0.5, ZB); solid(X0 - 0.4, X0, ZB, ZF); solid(X1, X1 + 0.4, ZB, ZF);
  // front: floor-to-ceiling glass in thin black frames, door in the middle
  const door = 0.8;
  for (const [a, b] of [[X0, cx - door], [cx + door, X1]]) {
    add(new THREE.BoxGeometry(b - a, 0.18, T), black, (a + b) / 2, 0.09, ZF + T / 2);
    add(new THREE.BoxGeometry(b - a, 3.0, 0.02), glass, (a + b) / 2, 1.68, ZF + T / 2, { cast: false });
    solid(a, b, ZF - 0.05, ZF + T + 0.05);
  }
  for (const x of [X0 + 0.04, cx - door, cx + door, X1 - 0.04]) add(new THREE.BoxGeometry(0.06, 3.2, T + 0.04), black, x, 1.6, ZF + T / 2);
  add(new THREE.BoxGeometry(X1 - X0, 0.06, T + 0.04), black, cx, 3.2, ZF + T / 2);
  add(new THREE.BoxGeometry(6, 0.9, 0.08), new THREE.MeshStandardMaterial({ map: canvasTex(1024, 160, (g, w, h) => {
    g.fillStyle = '#2b2e33'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f2ee'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '300 92px Georgia, serif'; g.letterSpacing = '28px'; g.fillText('MODE', w * 0.42, h / 2 + 4);
    g.letterSpacing = '0px'; g.font = '500 44px "Hiragino Sans", sans-serif'; g.fillStyle = '#b9c7d8'; g.fillText('モード', w * 0.78, h / 2 + 4);
    g.font = 'italic 26px Georgia, serif'; g.fillStyle = '#b9c7d8'; g.fillText('whole looks · styled for you', w * 0.42, h - 22);
  }), roughness: 0.6 }), cx, H + 0.7, ZF + 0.3);
  // podiums: two in the window, six inside (the window ones and the nearest are filled first)
  const podium = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.35 });
  const slots = [[X0 + 1.6, ZF - 1.0], [X1 - 1.6, ZF - 1.0], [X0 + 1.7, ZB + 2.6], [cx - 0.2, ZB + 3.6],
    [cx - 1.6, ZF - 2.7], [cx + 1.6, ZF - 2.7], [cx + 1.5, ZB + 3.0], [cx - 2.1, ZB + 1.6]].map(([x, z]) => {
    add(new THREE.CylinderGeometry(0.5, 0.52, 0.14, 40), podium, x, 0.13, z);
    solid(x - 0.55, x + 0.55, z - 0.55, z + 0.55);
    return { x, z, y: 0.2 };
  });
  // counter, folded clothes on a table, a tall mirror, track lights
  add(new THREE.BoxGeometry(2.6, 1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5 }), X1 - 1.8, 0.5, ZB + 1.4);
  add(new THREE.BoxGeometry(2.7, 0.05, 0.8), podium, X1 - 1.8, 1.02, ZB + 1.4);
  solid(X1 - 3.2, X1 - 0.4, ZB + 0.9, ZB + 1.8);
  add(new THREE.BoxGeometry(1.8, 0.05, 0.8), oak, X1 - 1.6, 0.8, -9.6);
  for (const dx of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.05, 0.8, 0.7), black, X1 - 1.6 + dx, 0.4, -9.6);
  solid(X1 - 2.6, X1 - 0.6, -10.1, -9.1);
  const folded = [0x1b2340, 0xd8c6a5, 0x7d8085, 0x9b1c1f, 0xf2f1ee, 0x2e4a36, 0x141414, 0xc8a070];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) add(new THREE.BoxGeometry(0.34, 0.035, 0.28), new THREE.MeshStandardMaterial({ color: folded[(k * 3 + j) % 8], roughness: 0.95 }), X1 - 2.2 + k * 0.4, 0.845 + j * 0.037, -9.6, { cast: false });
  add(new THREE.BoxGeometry(0.9, 2.1, 0.04), black, X0 + 0.04, 1.2, -9.8).rotation.y = Math.PI / 2;
  add(new THREE.PlaneGeometry(0.8, 2.0), new THREE.MeshPhysicalMaterial({ color: 0xdfe7ee, metalness: 1, roughness: 0.04 }), X0 + 0.07, 1.2, -9.8, { cast: false }).rotation.y = Math.PI / 2;
  for (const [lx, lz] of [[cx - 2.2, -7.4], [cx + 2.2, -7.4], [cx - 1.5, -11.2], [cx + 1.6, -11.6]]) {
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 16), black, lx, H - 0.12, lz, { cast: false });
    const l = new THREE.PointLight(0xfff1e0, 5, 7, 1.5); l.position.set(lx, H - 0.35, lz); scene.add(l);
  }
  return { stylist: new THREE.Vector3(X1 - 1.8, 0.06, ZB + 0.6), mannequins: slots, bounds: { X0, X1, ZF, ZB, H } };
}

// ---------- street life: parked bicycles and a flock of birds ----------
function bicycle(add, x, z, ry, color) {
  const g = new THREE.Group(), frame = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
  for (const dx of [-0.52, 0.52]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 8, 28), tyre); w.position.set(dx, 0.36, 0); g.add(w); }
  const tube = (ax, ay, bx, by) => {
    const a = new THREE.Vector3(ax, ay, 0), b = new THREE.Vector3(bx, by, 0), m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, a.distanceTo(b), 6), frame);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(m);
  };
  tube(-0.52, 0.36, -0.05, 0.36); tube(-0.05, 0.36, 0.42, 0.78); tube(-0.05, 0.36, -0.15, 0.85); tube(-0.15, 0.82, 0.42, 0.8); tube(0.52, 0.36, 0.42, 0.95); tube(-0.52, 0.36, -0.15, 0.85);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.32), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 })); basket.position.set(0.6, 0.95, 0); g.add(basket);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.12), tyre); seat.position.set(-0.15, 0.89, 0); g.add(seat);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(x, 0.15, z); g.rotation.y = ry;
  return g;
}
let birds = [];
function buildBirds(scene) {
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0, 0, -0.12, 0.6, 0, -0.05], 3));
  wing.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x1d1f22, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Group(), wr = new THREE.Mesh(wing, mat), wl = new THREE.Mesh(wing, mat);
    wl.scale.x = -1;
    b.add(wr, wl, new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 5).rotateX(Math.PI / 2), mat));
    b.userData = { wr, wl, cx: (R() - 0.5) * 60, r: 12 + R() * 25, h: 16 + R() * 10, speed: (0.15 + R() * 0.1) * (R() < 0.5 ? 1 : -1), ph: R() * 10 };
    scene.add(b); birds.push(b);
  }
}

export function buildStreet({ scene, add, solid }) {
  buildGround(scene, add);
  buildBuildings(scene, add, solid);
  buildShrine(scene, add, solid);
  buildPoles(scene, add, solid);
  buildProps(scene, add, solid);
  const cafe = buildCafe(scene, add, solid);
  STREET.mode = buildMode(scene, add, solid);
  for (const [x, z, n] of [[-19.5, -5.3, 3], [19, -5.3, 2], [-48, 5.5, 3], [52, 5.5, 2], [70, -5.3, 2]]) {
    for (let i = 0; i < n; i++) scene.add(bicycle(add, x + i * 0.55, z, Math.PI / 2 + (R() - 0.5) * 0.15, pick([0xb53a2e, 0x2e5fa8, 0xd8d4c8, 0x2f6b46, 0x111111])));
  }
  buildBirds(scene);
  STREET.cafe = cafe;
  for (const [x, z, s] of [[17, 11, 1.25], [25, 12, 1.15], [21, 18, 1.3], [-17.6, -5.0, 0.95], [13, 5.3, 1], [-40, 5.3, 1], [58, -5.0, 1.05], [-75, 5.3, 1]]) cherryTree(scene, add, x, z, s);
  const petalTex = canvasTex(32, 32, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(16, 16, 12, 7, 0.5, 0, Math.PI * 2); g.fill(); });
  buildPetals(scene, petalTex);
}

export function updateStreet(dt, t, player) {
  if (petals) {
    const { pos, seed, N } = petals;
    for (let i = 0; i < N; i++) {
      const s = seed.subarray(i * 4, i * 4 + 4), fall = ((s[1] - t * 0.55) % 7 + 7) % 7;
      pos[i * 3] = player.x + s[0] + Math.sin(t * 0.8 + s[3]) * 0.6 + t * 0.25 % 1;
      pos[i * 3 + 1] = 0.2 + fall;
      pos[i * 3 + 2] = player.z + s[2] + Math.cos(t * 0.6 + s[3]) * 0.5;
      if (indoors(pos[i * 3], pos[i * 3 + 2])) pos[i * 3 + 1] = -50; // petals never fall inside the shops
    }
    petals.pts.geometry.attributes.position.needsUpdate = true;
  }
  for (const b of birds) {
    const u = b.userData, a = u.ph + t * u.speed;
    b.position.set(player.x + u.cx + Math.cos(a) * u.r, u.h + Math.sin(t * 0.5 + u.ph) * 2, Math.sin(a) * u.r * 0.6);
    b.rotation.y = Math.atan2(-Math.sin(a) * u.speed, Math.cos(a) * u.speed);
    const flap = Math.sin(t * 10 + u.ph) * 0.6 * (Math.sin(t * 0.8 + u.ph) > -0.3 ? 1 : 0.1);
    u.wr.rotation.z = flap; u.wl.rotation.z = -flap;
  }
  for (const w of walkers) {
    w.mixer.update(dt);
    w.m.position.x += w.dir * w.speed * dt;
    if (Math.abs(w.m.position.x) > LEN - 3) { w.dir *= -1; w.m.rotation.y = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  }
}
