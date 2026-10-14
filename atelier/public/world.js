// Atelier City: walk a real city square (photo-scanned HDRI panorama projected onto the ground), enter the
// ATELIER boutique, browse t-shirts on the walls and talk to Yanis, the AI tailor. The shop panel (chat, design,
// try-on, print files) is the existing shop page, opened on top of the world.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { makeShirt } from './shirt3d.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 500);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const manager = new THREE.LoadingManager();
manager.onProgress = (url, done, total) => { $('status').textContent = `Loading the city… ${Math.round(done / total * 100)}%`; };
const tex = new THREE.TextureLoader(manager);
function texture(name, repeat, srgb) {
  const t = tex.load(`assets/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pbr(base, repeat, extra = {}) { // a Poly Haven material (colour, normal, roughness maps)
  return new THREE.MeshStandardMaterial({
    map: texture(`${base}_diff.jpg`, repeat, true), normalMap: texture(`${base}_nor.jpg`, repeat),
    roughnessMap: texture(`${base}_rough.jpg`, repeat), ...extra,
  });
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- the city: a real square photographed in 360°, projected onto the ground ----------
const SKY_HEIGHT = 1.7, SKY_RADIUS = 45;
new RGBELoader(manager).load('assets/outdoor_umbrellas_4k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  const sky = new GroundedSkybox(hdr, SKY_HEIGHT, SKY_RADIUS);
  sky.position.y = SKY_HEIGHT - 0.01;
  scene.add(sky);
});
// Invisible ground that only shows shadows, so the boutique sits in the photo.
const shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.32 }));
shadowGround.rotation.x = -Math.PI / 2;
shadowGround.position.y = 0.002;
shadowGround.receiveShadow = true;
scene.add(shadowGround);

const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(10, 16, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// ---------- the boutique ----------
const SHOP = { x0: -5, x1: 5, zFront: -6, zBack: -14, h: 4 };
const colliders = []; // axis-aligned boxes the visitor can't walk through: { minX, maxX, minZ, maxZ }
const solid = (x0, x1, z0, z1) => colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });

function boxUV(w, h, d, tile = 2) { // box whose texture repeats by real size instead of stretching
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su / tile, uv.getY(i) * sv / tile);
  }
  return g;
}
function add(geo, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

const plaster = pbr('white_plaster_rough_01', [1, 1], { color: 0xf1e7d6, envMapIntensity: 0.6 });
const plasterIn = new THREE.MeshStandardMaterial({ color: 0xf2ece3, roughness: 0.92, envMapIntensity: 0.3,
  normalMap: texture('white_plaster_rough_01_nor.jpg', [1, 1]), normalScale: new THREE.Vector2(0.4, 0.4) }); // clean painted plaster
const wood = pbr('wood_floor_deck', [4, 3], { envMapIntensity: 0.35 });
const concrete = pbr('concrete_floor_02', [1, 1], { color: 0xb8b2aa, envMapIntensity: 0.5 });
const metal = new THREE.MeshStandardMaterial({ color: 0x1d2124, metalness: 0.7, roughness: 0.32 });
const brass = new THREE.MeshStandardMaterial({ color: 0xb38a4a, metalness: 1, roughness: 0.28 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeeff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.16,
  envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
const oak = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.55, envMapIntensity: 0.4 });

const { x0, x1, zFront, zBack, h } = SHOP, W = x1 - x0, D = zFront - zBack, T = 0.25;
// floor, ceiling, walls
add(new THREE.BoxGeometry(W, 0.06, D), wood, 0, 0.03, (zFront + zBack) / 2, { cast: false });
add(boxUV(W + 0.6, 0.3, D + 0.6, 3), concrete, 0, h + 0.15, (zFront + zBack) / 2); // roof
add(new THREE.BoxGeometry(W, 0.02, D), new THREE.MeshStandardMaterial({ color: 0xf7f4ef, roughness: 0.95, envMapIntensity: 0.25 }), 0, h - 0.01, (zFront + zBack) / 2, { cast: false }); // ceiling
add(boxUV(W + T * 2, h, T, 2.5), plasterIn, 0, h / 2, zBack - T / 2);
add(boxUV(T, h, D, 2.5), plasterIn, x0 - T / 2, h / 2, (zFront + zBack) / 2);
add(boxUV(T, h, D, 2.5), plasterIn, x1 + T / 2, h / 2, (zFront + zBack) / 2);
solid(x0 - 1, x1 + 1, zBack - T - 0.2, zBack);
solid(x0 - T - 0.2, x0, zBack, zFront);
solid(x1, x1 + T + 0.2, zBack, zFront);
// exterior skin on the sides and back (cream plaster), slightly outside the interior walls
add(boxUV(T, h + 1.2, D + T * 2, 3), plaster, x0 - T * 1.5, (h + 1.2) / 2, (zFront + zBack) / 2);
add(boxUV(T, h + 1.2, D + T * 2, 3), plaster, x1 + T * 1.5, (h + 1.2) / 2, (zFront + zBack) / 2);
add(boxUV(W + T * 4, h + 1.2, T, 3), plaster, 0, (h + 1.2) / 2, zBack - T * 1.5);

// Shop front: metal-framed glass windows either side of an open door, sign band above.
const DOOR = 0.95, SILL = 0.45, GLASS_TOP = 3.05;
const front = (x, w, y, hh) => add(new THREE.BoxGeometry(w, hh, T), metal, x, y, zFront + T / 2);
front(x0 + 0.2, 0.4, h / 2, h);                       // corner piers
front(x1 - 0.2, 0.4, h / 2, h);
front(-DOOR - 0.06, 0.12, h / 2, h);                  // door posts
front(DOOR + 0.06, 0.12, h / 2, h);
for (const side of [-1, 1]) {
  const a = side < 0 ? x0 + 0.4 : DOOR + 0.12, b = side < 0 ? -DOOR - 0.12 : x1 - 0.4, cx = (a + b) / 2, w = b - a;
  add(boxUV(w, SILL, T + 0.1, 1.5), plaster, cx, SILL / 2, zFront + T / 2);                                           // sill
  add(new THREE.BoxGeometry(w, GLASS_TOP - SILL, 0.02), glass, cx, (SILL + GLASS_TOP) / 2, zFront + T / 2, { cast: false });
  add(new THREE.BoxGeometry(0.06, GLASS_TOP - SILL, T), metal, cx, (SILL + GLASS_TOP) / 2, zFront + T / 2);           // mullion
  // striped awning
  const stripes = canvasTex(512, 64, (g, cw, ch) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#f2ead8' : '#23463c'; g.fillRect(i * cw / 16, 0, cw / 16, ch); } });
  stripes.repeat.set(w / 2.2, 1); stripes.wrapS = THREE.RepeatWrapping;
  const aw = add(new THREE.BoxGeometry(w + 0.2, 0.04, 1.1), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.9 }), cx, GLASS_TOP + 0.12, zFront + 0.75);
  aw.rotation.x = 0.33;
  solid(a, b, zFront - 0.05, zFront + T + 0.05);
}
add(new THREE.BoxGeometry(DOOR * 2 + 0.24, h - 2.6, T), metal, 0, 2.6 + (h - 2.6) / 2, zFront + T / 2); // above the door
add(new THREE.BoxGeometry(W + 0.5, 0.06, 0.6), metal, 0, 0.03, zFront + 0.35, { cast: false });           // threshold

// Sign: "ATELIER" in cream on deep green, across the top of the front.
const signTex = canvasTex(2048, 220, (g, cw, ch) => {
  g.fillStyle = '#1f3a33'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#efe4c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '300 120px Georgia, "Times New Roman", serif';
  g.fillText('A  T  E  L  I  E  R', cw / 2, ch * 0.42);
  g.font = 'italic 34px Georgia, serif';
  g.fillText('custom t-shirts · designed with AI', cw / 2, ch * 0.82);
});
add(new THREE.BoxGeometry(W + 0.5, 1.05, 0.12), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }), 0, h + 0.55, zFront + 0.32);
// two brass wall lamps lighting the sign
for (const x of [-2.6, 2.6]) {
  add(new THREE.CylinderGeometry(0.05, 0.11, 0.18, 16), brass, x, h + 1.2, zFront + 0.6);
}

// ---------- interior lighting ----------
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a3026, 0.5));
for (const [x, z] of [[-2.5, -8.2], [2.5, -8.2], [-2.5, -11.6], [2.5, -11.6], [0, -12.9]]) {
  const l = new THREE.PointLight(0xffe4c4, 9, 9, 1.5);
  l.position.set(x, h - 0.35, z);
  scene.add(l);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 2 }), x, h - 0.03, z, { cast: false });
}

// ---------- furniture ----------
// counter at the back, with Yanis behind it
add(boxUV(2.6, 0.95, 0.7, 1.2), oak, 0, 0.475, -12.4);
add(new THREE.BoxGeometry(2.75, 0.05, 0.85), new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.25 }), 0, 0.975, -12.4);
solid(-1.4, 1.4, -12.85, -11.95);
// poster on the back wall
const poster = canvasTex(800, 1100, (g, cw, ch) => {
  const grd = g.createLinearGradient(0, 0, 0, ch); grd.addColorStop(0, '#b5562b'); grd.addColorStop(1, '#6e2f17');
  g.fillStyle = grd; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#f6ecdc'; g.textAlign = 'center';
  g.font = '300 92px Georgia, serif'; g.fillText('Describe it.', cw / 2, 330);
  g.fillText('We design it.', cw / 2, 450); g.fillText('You wear it.', cw / 2, 570);
  g.font = 'italic 40px Georgia, serif'; g.fillText('Ask Yanis at the counter', cw / 2, 800);
});
for (const x of [-3.2, 3.2]) {
  add(new THREE.BoxGeometry(1.5, 2.06, 0.05), metal, x, 2.2, zBack + 0.03);
  add(new THREE.PlaneGeometry(1.4, 1.94), new THREE.MeshStandardMaterial({ map: poster, roughness: 0.7 }), x, 2.2, zBack + 0.06, { cast: false });
}
// rug
const rugTex = canvasTex(512, 672, (g, cw, ch) => { // woven rug with a border
  g.fillStyle = '#3b3a37'; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = '#c9b79a'; g.lineWidth = 10; g.strokeRect(30, 30, cw - 60, ch - 60);
  g.lineWidth = 3; g.strokeRect(52, 52, cw - 104, ch - 104);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * cw, Math.random() * ch, 2, 2); }
});
add(new THREE.BoxGeometry(3.2, 0.012, 4.2), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1, envMapIntensity: 0.3 }), 0, 0.066, -9.4, { cast: false });

// ---------- t-shirts: wall displays and window stands ----------
const CATALOGUE = [
  { id: 'd56b997dd6', color: '#f2f1ee', placement: 'front-large' },
  { id: '2077d19a86', color: '#141414', placement: 'front-center' },
  { id: 'dc2060318b', color: '#f2f1ee', placement: 'front-center' },
  { id: '77bf4df232', color: '#1b2340', placement: 'front-center' },
];
const ALT_COLORS = ['#7d8085', '#2e4a36', '#d8c6a5', '#9b1c1f'];
const targets = []; // things you can press E on: { pos, label, open }
const shirtCache = new Map();
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function shirt(design, color) {
  const key = design.id + color;
  if (!shirtCache.has(key)) {
    shirtCache.set(key, loadImage(`catalogue/${design.id}.png`).then((art) => makeShirt(art, color, design.placement)));
  }
  const m = (await shirtCache.get(key)).clone();
  m.castShadow = true;
  return m;
}
async function hangShirt(design, color, x, y, z, ry, envIntensity = 0.45) {
  const s = await shirt(design, color);
  s.material.envMapIntensity = envIntensity;
  const g = new THREE.Group();
  s.scale.setScalar(1.25);
  g.add(s);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16, Math.PI * 1.4), brass); // hanger hook
  hook.position.y = 0.4; hook.rotation.z = Math.PI * 0.8;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.62, 6), brass);
  bar.rotation.z = Math.PI / 2; bar.position.y = 0.31;
  g.add(hook, bar);
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  targets.push({ pos: new THREE.Vector3(x, 1.4, z), label: 'Press E to try this t-shirt', open: () => openShop(`index.html?design=${design.id}`) });
}
async function buildShirts() {
  // wall displays: six face-out shirts on each side wall
  let k = 0;
  for (const [x, ry, rail] of [[x0 + 0.42, Math.PI / 2, x0 + 0.2], [x1 - 0.42, -Math.PI / 2, x1 - 0.2]]) {
    add(new THREE.CylinderGeometry(0.018, 0.018, 5.4, 10), brass, rail, 2.32, -10.4).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const design = CATALOGUE[k % CATALOGUE.length], color = i < 3 ? design.color : ALT_COLORS[k % ALT_COLORS.length];
      await hangShirt(design, color, x, 1.95, -12.8 + i * 0.86, ry);
      k++;
    }
    solid(Math.min(x, rail) - 0.45, Math.max(x, rail) + 0.45, -13.4, -7.4);
  }
  // shop windows: one shirt on a stand in each, facing the street
  for (const [x, i] of [[-2.8, 0], [2.8, 3]]) {
    add(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 24), metal, x, 0.08, zFront - 0.75);
    add(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8), metal, x, 0.85, zFront - 0.75);
    await hangShirt(CATALOGUE[i], CATALOGUE[i].color, x, 1.95, zFront - 0.75, 0, 0.8);
  }
}

// ---------- Yanis, the AI tailor ----------
let yanis = null, mixer = null;
new GLTFLoader(manager).load('models/Xbot.glb', (g) => {
  yanis = g.scene;
  const box = new THREE.Box3().setFromObject(yanis);
  yanis.scale.multiplyScalar(1.78 / (box.max.y - box.min.y));
  yanis.position.set(0, 0.06, -13.25);
  yanis.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(yanis);
  mixer = new THREE.AnimationMixer(yanis);
  const idle = g.animations.find((a) => a.name === 'idle') || g.animations[0];
  if (idle) mixer.clipAction(idle).play();
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(512, 128, (c, w, hh) => {
    c.fillStyle = 'rgba(20,20,20,.72)'; c.beginPath(); c.roundRect(8, 8, w - 16, hh - 16, 40); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 46px -apple-system, sans-serif'; c.fillText('Yanis · AI tailor', w / 2, hh / 2);
  }), depthTest: false }));
  tag.scale.set(0.9, 0.225, 1);
  tag.position.set(0, 2.15, -13.25);
  scene.add(tag);
  targets.push({ pos: new THREE.Vector3(0, 1.4, -12.4), label: 'Press E to talk to Yanis', open: () => openShop('index.html') });
});

// ---------- walking ----------
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const EYE = 1.65;
const player = new THREE.Vector3(0, EYE, 9);
let yaw = 0, pitch = 0, ready = false, shopOpen = false;
const locked = () => document.pointerLockElement === renderer.domElement;
$('start').addEventListener('click', () => { if (ready) renderer.domElement.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  const l = locked();
  $('crosshair').hidden = !l;
  $('start').hidden = l || shopOpen;
  if (!l) { for (const k in keys) keys[k] = false; if (ready) $('status').textContent = 'Paused — click to continue'; }
});
addEventListener('mousemove', (e) => {
  if (!locked()) return;
  yaw -= e.movementX * 0.0022;
  pitch = clamp(pitch - e.movementY * 0.0022, -1.3, 1.3);
});

function collide(p) {
  const r = 0.32;
  for (const b of colliders) {
    const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
    else { // centre inside the box: leave by the nearest side
      const out = [[b.minX - r - p.x, 0], [b.maxX + r - p.x, 0], [0, b.minZ - r - p.z], [0, b.maxZ + r - p.z]]
        .sort((a, c) => Math.hypot(...a) - Math.hypot(...c))[0];
      p.x += out[0]; p.z += out[1];
    }
  }
  const rr = Math.hypot(p.x, p.z), lim = SKY_RADIUS * 0.55;
  if (rr > lim) { p.x *= lim / rr; p.z *= lim / rr; }
}

let bob = 0;
const vel = new THREE.Vector3();
function update(dt) {
  if (!locked()) return;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const want = new THREE.Vector3()
    .addScaledVector(f, (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0))
    .addScaledVector(r, (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0));
  if (want.lengthSq()) want.normalize().multiplyScalar(keys.ShiftLeft || keys.ShiftRight ? 3.4 : 1.7);
  vel.lerp(want, 1 - Math.exp(-10 * dt));
  player.addScaledVector(vel, dt);
  collide(player);
  bob += vel.length() * dt * 5.5;
}

// What is in front of you and close enough to interact with.
let current = null;
function findTarget() {
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  let best = null, bestScore = 0;
  for (const t of targets) {
    const to = t.pos.clone().sub(camera.position), d = to.length();
    if (d > 2.4) continue;
    const facing = to.normalize().dot(look);
    if (facing < 0.6) continue;
    const score = facing / d;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}
addEventListener('keydown', (e) => { if (e.code === 'KeyE' && locked() && current) current.open(); });

// ---------- the shop panel ----------
function openShop(src) {
  shopOpen = true;
  const frame = $('shopFrame');
  if (frame.dataset.src !== src) { frame.src = src; frame.dataset.src = src; }
  frame.hidden = false;
  $('closeShop').hidden = false;
  $('prompt').hidden = true;
  document.exitPointerLock();
}
$('closeShop').addEventListener('click', () => {
  shopOpen = false;
  $('shopFrame').hidden = true;
  $('closeShop').hidden = true;
  renderer.domElement.requestPointerLock();
});

// ---------- loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  camera.position.set(player.x, EYE + Math.sin(bob) * 0.025, player.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  if (mixer) mixer.update(dt);
  if (yanis) { // Yanis turns to face you when you come close
    const dx = player.x - yanis.position.x, dz = player.z - yanis.position.z;
    const target = Math.hypot(dx, dz) < 6 ? Math.atan2(dx, dz) : 0;
    yanis.rotation.y += (target - yanis.rotation.y) * (1 - Math.exp(-3 * dt));
  }
  current = locked() ? findTarget() : null;
  $('prompt').hidden = !current;
  if (current) $('prompt').textContent = current.label;
  renderer.render(scene, camera);
}

manager.onLoad = () => {
  if (ready) return;
  ready = true;
  $('status').textContent = 'Click to enter';
  window.__ready = true;
};
buildShirts().then(() => { window.__shirts = true; });
// Optional URL settings for screenshots: ?x=0&z=-8&yaw=0&pitch=0
const q = new URLSearchParams(location.search);
if (q.has('x')) player.x = +q.get('x');
if (q.has('z')) player.z = +q.get('z');
if (q.has('yaw')) yaw = +q.get('yaw');
if (q.has('pitch')) pitch = +q.get('pitch');
if (q.has('noui')) $('start').hidden = true;
animate();
