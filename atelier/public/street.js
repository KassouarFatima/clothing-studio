// Atelier Street: walk a Japanese shopping street built in 3D (shops, utility poles, cherry trees, a shrine), enter the
// ATELIER boutique, browse t-shirts on the walls and talk to Yanis, the AI tailor. The shop panel (chat, design,
// try-on, print files) is the existing shop page, opened on top of the world.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { createLightPool } from './lightpool.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildStreet, addWalkers, updateStreet, STREET, PEOPLE, personFrom, clipOf, INDOOR } from './street-city.js';
import { startSound, toggleSound, updateSound } from './street-sound.js';
import { makeShirt } from './shirt3d.js';
import { buildLook, disposeLook } from './wardrobe3d.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 500);
// Ambient occlusion: soft contact shadows in corners, under awnings and where walls meet the ground.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
// The occlusion itself (the expensive part, and a soft effect) is worked out and denoised on half the pixels, then
// spread over the picture; the depth/normal buffers the outlines use stay full size.
{
  const fullSize = ao.setSize.bind(ao);
  ao.setSize = (w, h) => {
    fullSize(w, h);
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    ao.gtaoRenderTarget.setSize(hw, hh); ao.pdRenderTarget.setSize(hw, hh);
    ao.gtaoMaterial.uniforms.resolution.value.set(hw, hh); ao.pdMaterial.uniforms.resolution.value.set(hw, hh);
  };
}
ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1.2 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
// Anime-style ink outlines: edges are found where depth jumps or surfaces change direction (from the AO pass's
// depth and normal buffers), darkened, and faded out with distance. Plus a touch of extra colour.
const outline = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tDepth: { value: ao.depthTexture }, tNormal: { value: ao.normalTexture },
    resolution: { value: new THREE.Vector2(innerWidth, innerHeight) }, near: { value: camera.near }, far: { value: camera.far }, strength: { value: 0.75 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth, tNormal; uniform vec2 resolution; uniform float near, far, strength; varying vec2 vUv;
    float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
    vec3 nrm(vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.12);
      if (texture2D(tDepth, vUv).x >= 0.99999) { gl_FragColor = c; return; } // sky
      float d0 = lin(vUv), edge = 0.0; vec3 n0 = nrm(vUv);
      vec2 px = 1.1 / resolution;
      vec2 offs[4]; offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
      for (int i = 0; i < 4; i++) {
        float d = lin(vUv + offs[i]);
        edge = max(edge, smoothstep(0.025, 0.07, abs(d - d0) / d0));
        edge = max(edge, smoothstep(0.3, 0.6, 1.0 - dot(n0, nrm(vUv + offs[i]))));
      }
      edge *= 1.0 - smoothstep(22.0, 70.0, d0);
      c.rgb = mix(c.rgb, c.rgb * 0.22, edge * strength);
      gl_FragColor = c;
    }`,
});
outline.uniforms.tDepth.value = ao.depthTexture;   // render-target textures aren't copied when the pass clones its uniforms
outline.uniforms.tNormal.value = ao.normalTexture;
composer.addPass(outline);
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  outline.uniforms.resolution.value.set(innerWidth, innerHeight);
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

// ---------- sky, sunlight and atmosphere ----------
const SUN = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(28));
const sky = new Sky();
sky.scale.setScalar(4000);
Object.assign(sky.material.uniforms.turbidity, { value: 3 });
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.85;
sky.material.uniforms.sunPosition.value.copy(SUN);
scene.add(sky);
{ // the sky also lights every material (soft ambient light and reflections)
  const envScene = new THREE.Scene(), envSky = new Sky();
  envSky.material = sky.material; envSky.scale.setScalar(100);
  envScene.add(envSky);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0, 0.1, 1000).texture;
  scene.environmentIntensity = 0.45;
}
scene.fog = new THREE.Fog(0xcfdbe6, 45, 140);
const sun = new THREE.DirectionalLight(0xffe8cf, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

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

buildStreet({ scene, add, solid });

const plaster = new THREE.MeshStandardMaterial({ color: 0xe9dfcf, roughness: 0.9, normalMap: texture('white_plaster_rough_01_nor.jpg', [1, 1]), normalScale: new THREE.Vector2(0.5, 0.5) });
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
const CATALOGUE = [ // the shop's own designs
  { id: 'd56b997dd6', color: '#f2f1ee', placement: 'front-large' },
  { id: '2077d19a86', color: '#141414', placement: 'front-center' },
  { id: 'dc2060318b', color: '#f2f1ee', placement: 'front-center' },
  { id: '77bf4df232', color: '#1b2340', placement: 'front-center' },
];
const ALT_COLORS = ['#7d8085', '#2e4a36', '#d8c6a5', '#9b1c1f'];
const targets = []; // things you can press E on: { pos, label, open }
const shirtCache = new Map();
// crossOrigin: when hosted, the artwork comes from the storage's own address, and WebGL can only use it with CORS
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error(`Could not load ${src}`)); i.src = src; }); }
async function shirt(design, color) {
  const key = design.id + color + (design.allOver ? 'a' : '') + JSON.stringify(design.garmentType || '');
  if (!shirtCache.has(key)) {
    // a failed load is dropped from the cache, so a later re-hang fetches it again (a
    // busy machine can fail an image once with ERR_INSUFFICIENT_RESOURCES)
    shirtCache.set(key, loadImage(`/output/designs/${design.id}/artwork.png?v=20261009a`)
      .then((art) => makeShirt(art, color, design.placement, design.garmentType, { allOver: !!design.allOver }))
      .catch((e) => { shirtCache.delete(key); throw e; }));
  }
  return (await shirtCache.get(key)).clone();
}
const hung = []; // shirts currently on display (removed and re-hung when the store changes)
function label(text, x, y, z, ry) { // small card under a customer design: “Title” · by Author
  const tex = canvasTex(512, 96, (c, w, hh) => {
    c.fillStyle = '#fbf7ef'; c.fillRect(0, 0, w, hh); c.fillStyle = '#b5562b'; c.fillRect(0, 0, 10, hh);
    c.fillStyle = '#1d1b18'; c.font = '600 34px -apple-system, sans-serif'; c.textBaseline = 'middle'; c.fillText(text.slice(0, 30), 26, hh / 2);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.116), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m);
  return m;
}
async function hangShirt(design, color, x, y, z, ry, envIntensity = 0.45) {
  const s = await shirt(design, color);
  s.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.envMapIntensity = envIntensity; } });
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
  const target = { pos: new THREE.Vector3(x, 1.4, z), label: design.title ? `Press E to try “${design.title}” by ${design.author}` : `Press E to try this ${(design.garmentType?.name || 't-shirt').toLowerCase()}`,
    open: () => openShop(`index.html?design=${design.id}`) };
  targets.push(target);
  const card = design.title ? label(`“${design.title}” · by ${design.author}`, x + Math.sin(ry) * 0.02, y - 0.6, z + Math.cos(ry) * 0.02, ry) : null;
  hung.push({ g, target, card });
}
const WALL_SLOTS = [];
for (const [x, ry] of [[x0 + 0.42, Math.PI / 2], [x1 - 0.42, -Math.PI / 2]]) for (let i = 0; i < 6; i++) WALL_SLOTS.push([x, 1.95, -12.8 + i * 0.86, ry]);
const WINDOW_SLOTS = [[-3.7, 1.95, zFront - 0.75, 0], [3.7, 1.95, zFront - 0.75, 0]]; // beside the window mullions
function buildFixtures() { // rails, wall bars and window stands (built once)
  for (const [x, rail] of [[x0 + 0.42, x0 + 0.2], [x1 - 0.42, x1 - 0.2]]) {
    add(new THREE.CylinderGeometry(0.018, 0.018, 5.4, 10), brass, rail, 2.32, -10.4).rotation.x = Math.PI / 2;
    solid(Math.min(x, rail) - 0.45, Math.max(x, rail) + 0.45, -13.4, -7.4);
  }
  for (const [x] of WINDOW_SLOTS) {
    add(new THREE.CylinderGeometry(0.22, 0.26, 0.04, 24), metal, x, 0.08, zFront - 0.75);
    add(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8), metal, x, 0.85, zFront - 0.75);
  }
}
let hungStoreIds = null; // which store designs are on the walls right now (buildShirts snapshots them)
let hangAttempts = 0;    // how many times a failing hang has been retried in a row
let wallPage = 0, wallTimer = null; // the walls turn a page at a time when the store is bigger than the display
async function buildShirts() {
  // Customer designs from the store hang first (newest first, the two newest in the shop windows);
  // the walls slowly turn through the rest a page at a time, so every design the customer made
  // gets seen; the shop's own designs fill the remaining places in alternative colours.
  let store = [];
  try { store = (await (await fetch('/api/store')).json()).designs || []; } catch {}
  for (const h of hung.splice(0)) {
    scene.remove(h.g);
    h.g.traverse((o) => { if (o.isMesh) o.material?.dispose(); }); // per-hang material clones; the shared textures stay cached
    if (h.card) { scene.remove(h.card); h.card.material?.map?.dispose(); h.card.material?.dispose(); }
    targets.splice(targets.indexOf(h.target), 1);
  }
  let garments = [];
  try { garments = (await (await fetch('/api/catalogue')).json()).garments || []; } catch {}
  const row = (d) => ({ design: d, color: d.color || '#f2f1ee' });
  const windows = store.slice(0, WINDOW_SLOTS.length).map(row); // the newest always face the street
  const walls = store.slice(WINDOW_SLOTS.length).map(row);
  const pages = Math.max(1, Math.ceil(walls.length / WALL_SLOTS.length));
  wallPage %= pages;
  const items = [...windows, ...walls.slice(wallPage * WALL_SLOTS.length, (wallPage + 1) * WALL_SLOTS.length)];
  for (let k = 0; items.length < WALL_SLOTS.length + WINDOW_SLOTS.length; k++) {
    // the shop's own designs, shown on every garment of the catalogue in turn
    const d = CATALOGUE[k % CATALOGUE.length], garmentType = garments.length ? garments[k % garments.length] : undefined;
    items.push({ design: { ...d, garmentType }, color: k < CATALOGUE.length ? d.color : ALT_COLORS[k % ALT_COLORS.length] });
  }
  const slots = [...WINDOW_SLOTS, ...WALL_SLOTS];
  let failed = 0;
  for (const [i, it] of items.slice(0, slots.length).entries()) {
    const [x, y, z, ry] = slots[i];
    // one missing artwork leaves its place empty, not the whole shop
    try { await hangShirt(it.design, it.color, x, y, z, ry, i < WINDOW_SLOTS.length ? 0.8 : 0.45); } catch (e) { console.warn(e.message); failed++; }
  }
  hungStoreIds = new Set(store.map((d) => d.id)); // now the walls match the store
  window.__hangFailures = failed;
  clearInterval(wallTimer);
  if (pages > 1) wallTimer = setInterval(() => { wallPage++; buildShirts(); }, 15000); // turn the walls
  // A loaded machine can fail a few image loads (ERR_INSUFFICIENT_RESOURCES): hang
  // them again shortly — but only three times in a row, genuinely missing files stay empty.
  if (failed && hangAttempts < 3) { hangAttempts++; setTimeout(buildShirts, 4000); }
  else if (!failed) hangAttempts = 0;
}
buildFixtures();
addEventListener('message', (e) => { // a design or a look was just published from a shop panel
  if (e.origin === location.origin && e.data?.type === 'atelier-store-updated') buildShirts();
  if (e.origin === location.origin && e.data?.type === 'mode-looks-updated') buildMannequins();
});

// ---------- clothing-studio: a design finished in "Let'sDo it." (the other site) ----------
// The studio's backend pushes finished designs into this Atelier server side
// (saved + published the moment the customer presses "🎁 Give to customer"), so
// the display never depends on which tabs happen to be open. This page only
// watches the store: anything new re-hangs the display — the newest customer
// design takes the shop window — and gets a toast. The handoff slot stays as
// a fallback for when that server-to-server push failed.
let checking = false;
let lastYanisAt = 0; // when the customer was last taken to Yanis (a push wave only calls them once)
function worldToast(text) {
  const t = $('wtoast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(worldToast.t);
  worldToast.t = setTimeout(() => { t.hidden = true; }, Math.max(5000, text.length * 60));
}
async function checkNewDesigns() {
  if (checking || !hungStoreIds) return; // wait for the first hang (buildShirts sets the snapshot)
  checking = true;
  try {
    // 1) something new in the store (the server-side push landed while this page was open)
    let store = null;
    try { store = (await (await fetch('/api/store')).json()).designs || []; } catch { return; }
    const fresh = store.filter((d) => !hungStoreIds.has(d.id));
    if (fresh.length) {
      await buildShirts();
      worldToast(fresh.length > 1 ? `🖼 ${fresh.length} new designs on the walls — Yanis is waiting for you at the counter!` : '🖼 New design finished — Yanis is waiting for you at the counter!');
      // the whole design history arrives over a few seconds: only the newest ends at the counter
      if (Date.now() - lastYanisAt > 15000) {
        lastYanisAt = Date.now();
        if (shopOpen) closeShop();
        backToYanis(fresh[0].id);
      }
      return;
    }
    // 2) fallback: the push failed and left the design in the handoff slot
    let design = null, allOver = false;
    try {
      const j = await (await fetch('http://localhost:8080/api/v1/handoff')).json();
      design = j?.design; allOver = !!j?.allOver;
    } catch { return; } // backend not running: nothing to receive
    if (typeof design !== 'string' || !design.startsWith('data:image/')) return;
    const created = await (await fetch('/api/design/manual', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artwork: design, shirtColor: 'white', placement: 'front-center', summary: 'Finished in “Let’sDo it.”', allOver }),
    })).json();
    if (!created?.id) return; // not saved: keep the design and try again shortly
    await fetch('/api/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: created.id, title: 'From “Let’sDo it.”', author: 'You' }),
    });
    await fetch('http://localhost:8080/api/v1/handoff', { method: 'DELETE' });
    await buildShirts(); // re-hang: your design is the newest, it takes the shop window
    worldToast('🖼 Your design from “Let’sDo it.” is ready — Yanis is waiting at the counter!');
    if (shopOpen) closeShop();
    backToYanis(created.id);
  } catch { /* could not import it: keep the design for the next attempt */ }
  finally { checking = false; }
}
checkNewDesigns(); // a push may have landed before this page opened
addEventListener('focus', () => checkNewDesigns()); // coming back from the studio focuses this tab
setInterval(() => checkNewDesigns(), 5000); // safety net when focus stays elsewhere

// ---------- MODE's walls, like a big-city clothing store: a coloured feature wall with a rail of face-out garments,
// a rail of coats and dresses, a lit shoe wall and a hat shelf, all with the real garments ----------
async function buildModeWalls() {
  const { X0, X1, ZB } = STREET.mode.bounds;
  const oak = new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.4 });
  const put = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const wear = async (asset, color) => { const g = await buildLook([{ asset, color }], {}, null, true); g.traverse((o) => { if (o.isMesh) o.material.envMapIntensity = 0.6; }); return g; };
  // a hanger and a garment hung on it, facing out (the garment's collar sits just under the hanger)
  const hang = async (asset, color, x, railY, z, ry) => {
    const g = await wear(asset, color), box = new THREE.Box3().setFromObject(g);
    const holder = new THREE.Group();
    g.position.y = railY - 0.1 - (asset === 'hoodie' || asset === 'parka' ? 1.47 + 0.08 : Math.min(box.max.y, 1.52));
    holder.add(g);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 6, 14, Math.PI * 1.5), brass); hook.position.y = railY + 0.01; hook.rotation.z = Math.PI * 0.75;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 6), oak); bar.rotation.z = Math.PI / 2; bar.position.y = railY - 0.08;
    holder.add(hook, bar);
    holder.position.set(x, 0, z); holder.rotation.y = ry;
    scene.add(holder);
  };
  // 1. back wall: a terracotta feature wall, "NEW SEASON", and a brass rail of face-out garments under spotlights
  const featureW = 4.6, fx = X0 + 0.4 + featureW / 2;
  put(new THREE.BoxGeometry(featureW, 3.2, 0.04), new THREE.MeshStandardMaterial({ color: 0xc0623e, roughness: 0.85 }), fx, 1.65, ZB + 0.03);
  put(new THREE.PlaneGeometry(2.6, 0.42), new THREE.MeshStandardMaterial({ map: canvasTex(1024, 168, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.fillStyle = '#f4efe6'; c.font = '300 84px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('NEW  SEASON', w / 2, h / 2 - 8); c.font = 'italic 30px Georgia, serif'; c.fillText('colour, cut & drape', w / 2, h - 22);
  }), transparent: true, roughness: 0.6 }), fx, 3.0, ZB + 0.06);
  put(new THREE.CylinderGeometry(0.014, 0.014, featureW - 0.3, 10), brass, fx, 2.38, ZB + 0.32).rotation.z = Math.PI / 2;
  for (const dx of [-(featureW - 0.4) / 2, (featureW - 0.4) / 2]) put(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), brass, fx + dx, 2.38, ZB + 0.17).rotation.x = Math.PI / 2;
  const back = [['tshirt', '#e07a2a'], ['hoodie', '#d9a330'], ['mens_shirt', '#8fc1e8'], ['flannel'], ['tshirt', '#2e5fa8']];
  for (const [i, [a, c]] of back.entries()) await hang(a, c, fx - 1.8 + i * 0.9, 2.38, ZB + 0.36, 0);
  for (const dx of [-1.4, 0, 1.4]) { const l = new THREE.SpotLight(0xfff1dc, 9, 5, 0.55, 0.6, 1.2); l.position.set(fx + dx, 3.6, ZB + 1.6); l.target.position.set(fx + dx, 1.6, ZB + 0.3); scene.add(l, l.target); }
  // 2. right wall (above the folded-clothes table): coats, a parka and dresses, side by side, facing into the shop
  put(new THREE.CylinderGeometry(0.014, 0.014, 4.4, 10), brass, X1 - 0.34, 2.45, -9.5).rotation.x = Math.PI / 2;
  const side = [['overcoat', '#2e4a36'], ['evening_dress', '#1f7a5a'], ['parka', '#2e5fa8'], ['red_dress', '#c43d7e'], ['overcoat', '#b88a5a'],
    ['evening_dress', '#e8705a'], ['red_dress', '#d9a330'], ['parka', '#c0281f']];
  for (const [i, [a, c]] of side.entries()) await hang(a, c, X1 - 0.38, 2.45, -11.5 + i * 0.56, -Math.PI / 2);
  // 3. left wall: a lit shoe wall (white shelves, pairs facing into the shop)
  const shoeZ = -12.3, shelves = [0.45, 0.85, 1.25, 1.65];
  put(new THREE.BoxGeometry(0.06, 1.8, 1.9), white, X0 + 0.04, 1.05, shoeZ);
  const shoes = [['converse', '#c0281f'], ['pumps', '#2e5fa8'], ['chelsea', '#6b4226'], ['converse', '#f0d64a'], ['riding_boot', '#5a3a24'], ['adidas'], ['pumps', '#c43d7e'], ['converse', '#1f7a5a']];
  for (const [r, y] of shelves.entries()) {
    put(new THREE.BoxGeometry(0.34, 0.025, 1.8), white, X0 + 0.2, y, shoeZ);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 1.7), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1dc, emissiveIntensity: 2 }));
    lamp.position.set(X0 + 0.32, y + 0.37, shoeZ); scene.add(lamp);
    for (let k = 0; k < 2; k++) {
      const [a, c] = shoes[(r * 2 + k) % shoes.length];
      if (a === 'riding_boot' && y > 1.3) continue;
      const g = await wear(a, c), box = new THREE.Box3().setFromObject(g), ctr = box.getCenter(new THREE.Vector3());
      const s = Math.min(1, 0.36 / (box.max.y - box.min.y + 0.0001));
      const holder = new THREE.Group(); g.position.set(-ctr.x, -box.min.y, -ctr.z); holder.add(g); holder.scale.setScalar(s);
      holder.position.set(X0 + 0.2, y + 0.013, shoeZ - 0.45 + k * 0.9); holder.rotation.y = Math.PI / 2 + 0.35; scene.add(holder);
    }
  }
  const shoeLight = new THREE.PointLight(0xfff1dc, 3, 3, 1.6); shoeLight.position.set(X0 + 1.2, 1.4, shoeZ); scene.add(shoeLight);
  // 4. hat shelf near the window, on oak brackets
  put(new THREE.BoxGeometry(0.3, 0.03, 1.4), oak, X0 + 0.18, 1.75, -7.9);
  for (const [i, [a, c]] of [['cap', '#c0281f'], ['bucket_hat', '#e8a6b8'], ['cap', '#f0d64a']].entries()) {
    const g = await wear(a, c), box = new THREE.Box3().setFromObject(g), ctr = box.getCenter(new THREE.Vector3());
    g.position.set(X0 + 0.18 - ctr.x, 1.765 - box.min.y, -8.35 + i * 0.45 - ctr.z); scene.add(g);
  }
}

// ---------- MODE: whole looks on the mannequins (saved looks first, then the collection's) ----------
const dressed = [];
async function buildMannequins() {
  let lib;
  try { lib = await (await fetch('/api/fashion/library')).json(); } catch { return; }
  for (const d of dressed.splice(0)) { scene.remove(d.g); disposeLook(d.g); targets.splice(targets.indexOf(d.target), 1); }
  const byId = new Map(lib.pieces.map((p) => [p.id, p]));
  // colourful looks first (the window podiums, then the ones inside): one for every podium
  const picks = ['l-streetwear', 'l-gala', 'l-winter-street', 'l-festival', 'l-cocktail', 'l-casual-red', 'l-old-money', 'l-y2k', 'l-boho', 'l-office', 'l-lilac', 'l-sporty-cap'];
  const looks = [...lib.saved.map((l) => ({ id: l.id, name: `“${l.title}” by ${l.author}`, pieces: l.pieces })),
    ...picks.map((id) => lib.looks.find((l) => l.id === id)).filter(Boolean).map((l) => ({ id: l.id, name: l.name, pieces: l.pieces.map((x) => byId.get(x)).filter(Boolean) }))];
  for (const [i, slot] of STREET.mode.mannequins.entries()) {
    const look = looks[i];
    if (!look) break;
    try {
      // shown like an invisible mannequin: the garments hold the body's shape
      const g = await buildLook(look.pieces.map((p) => ({ asset: p.asset, color: p.color })), {}, null, true);
      g.position.set(slot.x, slot.y, slot.z);
      g.traverse((o) => { if (o.isMesh) o.material.envMapIntensity = 0.5; });
      scene.add(g);
      const target = { pos: new THREE.Vector3(slot.x, 1.4, slot.z + 0.6), label: `Press E to see this look: ${look.name}`, open: () => openShop(`mode.html?look=${look.id}`) };
      targets.push(target);
      dressed.push({ g, target });
    } catch (e) { console.warn('mannequin look failed', e); }
  }
}

// ---------- people: Yanis (the AI tailor, in a suit), the café barista, and passers-by ----------
let yanis = null, mixer = null, barista = null, rin = null;
const extraMixers = [];
function nameTag(text, x, y, z) {
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(512, 128, (c, w, hh) => {
    c.fillStyle = 'rgba(20,20,20,.72)'; c.beginPath(); c.roundRect(8, 8, w - 16, hh - 16, 40); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 46px -apple-system, sans-serif'; c.fillText(text, w / 2, hh / 2);
  }), depthTest: false }));
  tag.scale.set(0.9, 0.225, 1);
  tag.position.set(x, y, z);
  scene.add(tag);
}
Promise.all(PEOPLE.map((n) => new GLTFLoader(manager).loadAsync(`models/people/${n}.glb`))).then((gltfs) => {
  const byName = Object.fromEntries(PEOPLE.map((n, i) => [n, gltfs[i]]));
  // Yanis behind the boutique counter
  yanis = personFrom(byName.suit, 1.78);
  yanis.position.set(0, 0.06, -13.25);
  scene.add(yanis);
  mixer = new THREE.AnimationMixer(yanis);
  mixer.clipAction(clipOf(byName.suit, /^idle$/i)).play();
  nameTag('Yanis · AI tailor', 0, 2.15, -13.25);
  targets.push({ pos: new THREE.Vector3(0, 1.4, -12.4), label: 'Press E to talk to Yanis', open: () => openShop('index.html') });
  // the barista in Café Sakura
  barista = personFrom(byName.woman2, 1.66);
  barista.position.copy(STREET.cafe.barista);
  scene.add(barista);
  const bm = new THREE.AnimationMixer(barista);
  bm.clipAction(clipOf(byName.woman2, /^idle$/i)).play();
  extraMixers.push(bm);
  nameTag('Mika · barista', STREET.cafe.barista.x, 2.05, STREET.cafe.barista.z);
  const drinks = ['a matcha latte 🍵', 'a hot coffee ☕', 'a sakura tea 🌸', 'a dorayaki 🥞'];
  targets.push({ pos: STREET.cafe.barista.clone().setY(1.4).add(new THREE.Vector3(0, 0, 0.8)), label: 'Press E to order at Café Sakura',
    open: () => say(`Mika: いらっしゃいませ! Here is ${drinks[Math.floor(Math.random() * drinks.length)]} — enjoy!`) });
  // Rin, the stylist at the MODE counter
  rin = personFrom(byName.woman1, 1.7);
  rin.position.copy(STREET.mode.stylist);
  scene.add(rin);
  const rm = new THREE.AnimationMixer(rin);
  rm.clipAction(clipOf(byName.woman1, /^idle$/i)).play();
  extraMixers.push(rm);
  nameTag('Rin · stylist', STREET.mode.stylist.x, 2.1, STREET.mode.stylist.z);
  targets.push({ pos: STREET.mode.stylist.clone().setY(1.4).add(new THREE.Vector3(0, 0, 0.8)), label: 'Press E to talk to Rin, the stylist', open: () => openShop('mode.html') });
  // passers-by
  addWalkers(scene, gltfs);
});
let sayTimer;
function say(text) {
  $('prompt').textContent = text;
  $('prompt').dataset.say = '1';
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { delete $('prompt').dataset.say; }, 4000);
}

// ---------- walking ----------
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const EYE = 1.65;
const player = new THREE.Vector3(0, EYE, 2);
let yaw = 0, pitch = 0, ready = false, shopOpen = false;
const locked = () => document.pointerLockElement === renderer.domElement;
$('start').addEventListener('click', () => { if (ready) { startSound(); renderer.domElement.requestPointerLock(); } });
addEventListener('keydown', (e) => { if (e.code === 'KeyM') say(toggleSound() ? 'Sound on 🔊' : 'Sound off 🔇'); });
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
  p.x = clamp(p.x, -STREET.len + 1, STREET.len - 1);
  p.z = clamp(p.z, -14, 24);
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
function closeShop() { // back to walking: re-lock the pointer, or offer the "click to continue" overlay
  shopOpen = false;
  $('shopFrame').hidden = true;
  $('closeShop').hidden = true;
  try { renderer.domElement.requestPointerLock(); } catch { /* refused: the overlay below takes over */ }
  setTimeout(() => { // some browsers refuse a silent re-lock: make sure the visitor is never stuck
    if (!locked() && !shopOpen) { $('start').hidden = false; if (ready) $('status').textContent = 'Paused — click to continue'; }
  }, 300);
}
$('closeShop').addEventListener('click', () => closeShop());
function backToYanis(designId) { // the studio loop ends here: stand in front of the counter and hear the price
  player.set(0, EYE, -11.3); // just in front of the counter, facing it
  yaw = 0; pitch = 0; bob = 0;
  vel.set(0, 0, 0);
  for (const k in keys) keys[k] = false;
  setTimeout(() => { if (!shopOpen) openShop(`index.html?design=${designId}&price=1`); }, 350);
}

// ---------- loop ----------
renderer.shadowMap.autoUpdate = false;
const SHADOW_R = new THREE.Vector3().crossVectors(SUN.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();   // the sun's view axes
const SHADOW_U = new THREE.Vector3().crossVectors(SHADOW_R, SUN.clone().negate()).normalize();
const SHADOW_STEP = (76 / 4096) * 54;   // about 1 m, a whole number of shadow-map texels
let shadowAge = 0, shadowAt = [1e9, 1e9];
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  camera.position.set(player.x, EYE + Math.sin(bob) * 0.025, player.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  if (mixer) mixer.update(dt);
  for (const m of extraMixers) m.update(dt);
  updateStreet(dt, clock.elapsedTime, player);
  lightPool?.update(dt);
  const room = INDOOR.findIndex((b) => player.x > b.x0 && player.x < b.x1 && player.z > b.z0 && player.z < b.z1);
  updateSound(dt, clock.elapsedTime, player, room === 0 || room === 2 ? 'boutique' : room === 1 ? 'cafe' : 'street');
  // The sun's shadow follows the visitor in whole-texel steps (so edges never crawl) and is redrawn about 20 times a
  // second (staff move, but you don't see a shadow lag by 50 ms) instead of every frame.
  {
    const a = player.x * SHADOW_R.x + player.z * SHADOW_R.z, b = player.x * SHADOW_U.x + player.z * SHADOW_U.z;
    const sa = Math.round(a / SHADOW_STEP) * SHADOW_STEP, sb = Math.round(b / SHADOW_STEP) * SHADOW_STEP;
    sun.target.position.set(player.x - (a - sa) * SHADOW_R.x - (b - sb) * SHADOW_U.x, -(b - sb) * SHADOW_U.y, player.z - (a - sa) * SHADOW_R.z - (b - sb) * SHADOW_U.z);
    sun.position.copy(sun.target.position).addScaledVector(SUN, 70);
    shadowAge += dt;
    if (sa !== shadowAt[0] || sb !== shadowAt[1] || shadowAge > 0.05) { renderer.shadowMap.needsUpdate = true; shadowAt = [sa, sb]; shadowAge = 0; }
  }
  for (const npc of [yanis, barista, rin]) { // shop staff turn to face you when you come close
    if (!npc) continue;
    const dx = player.x - npc.position.x, dz = player.z - npc.position.z;
    const target = Math.hypot(dx, dz) < 6 ? Math.atan2(dx, dz) : 0;
    npc.rotation.y += (target - npc.rotation.y) * (1 - Math.exp(-3 * dt));
  }
  current = locked() ? findTarget() : null;
  if ($('prompt').dataset.say) $('prompt').hidden = false;
  else { $('prompt').hidden = !current; if (current) $('prompt').textContent = current.label; }
  composer.render();
}

manager.onLoad = () => {
  if (ready) return;
  ready = true;
  $('status').textContent = 'Click to enter';
  window.__ready = true;
};
buildShirts().then(() => { window.__shirts = true; });
let lightPool = null;
buildMannequins().then(() => buildModeWalls()).then(() => {
  window.__mannequins = true;
  if (!new URLSearchParams(location.search).has('nopool')) { lightPool = createLightPool(scene, camera); lightPool.update(0); renderer.compileAsync(scene, camera).catch(() => {}); }
});
// Optional URL settings for screenshots: ?x=0&z=-8&yaw=0&pitch=0
const q = new URLSearchParams(location.search);
if (q.has('x')) player.x = +q.get('x');
if (q.has('z')) player.z = +q.get('z');
if (q.has('yaw')) yaw = +q.get('yaw');
if (q.has('pitch')) pitch = +q.get('pitch');
if (q.has('noui')) $('start').hidden = true;
if (q.has('debug')) window.__dbg = { renderer, scene, composer, ao, outline, sun, camera, player, get lightPool() { return lightPool; } };   // for measuring frame costs
animate();
