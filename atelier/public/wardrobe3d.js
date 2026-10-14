// MODE's wardrobe: professionally made 3D garments (Marvelous Designer / CLO quality, CC-BY, see garments.json for
// credits), prepared in Blender on one shared body frame (metres, feet at y = 0, facing +z), so any top, bottom and
// shoes combine into one outfit — shown like an invisible-mannequin product shoot.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildAvatar, paintFit, bodyDeformer, reshapeGarment, SIZES, V } from './fit.js';

const BASE = 'models/garments/';
const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader().setDRACOLoader(draco);
let catalogue = null;
export async function garmentCatalogue() {
  catalogue ||= fetch(`${BASE}garments.json?v=${V}`).then((r) => { if (!r.ok) throw new Error('The garment catalogue could not be loaded.'); return r.json(); });
  return catalogue;
}
const scenes = new Map();
// gender: load the version fitted to that avatar (garments/<gender>/<key>.glb); none: the garment as designed.
// light: the lighter copy made for seeing from a few metres (the street's racks and mannequins), where there is one.
function loadAsset(key, gender, light) {
  const url = `${BASE}${gender ? `${gender}/` : light ? 'street/' : ''}${key}.glb?v=${V}`;
  if (!scenes.has(url)) scenes.set(url, loader.loadAsync(url).then((g) => g.scene).catch((e) => { scenes.delete(url); throw e; }));
  return scenes.get(url);
}
// A garment's texture made neutral and light (its folds, weave and stitching kept), so any colour can be dyed onto it —
// even garments that were made in black.
const neutral = new Map();
function neutralMap(tex) {
  if (neutral.has(tex.uuid)) return neutral.get(tex.uuid);
  const img = tex.image, w = Math.min(img.width, 1024), h = Math.round(img.height * w / img.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h), p = d.data;
  let sum = 0, n = 0;
  for (let i = 0; i < p.length; i += 16) { sum += p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11; n++; }
  const mean = sum / n, k = Math.min(3, 0.35 * 255 / Math.max(20, mean)); // keep the detail's contrast, lift its level
  for (let i = 0; i < p.length; i += 4) {
    // the weave and folds keep their contrast; worn-out spots and stains (far from the mean) are softened, so they
    // don't turn into white cracks once dyed
    const l = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11, v = Math.max(0, Math.min(255, 215 + 28 * Math.tanh((l - mean) * k / 28)));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = tex.flipY; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.anisotropy = 8;
  t.repeat.copy(tex.repeat); t.offset.copy(tex.offset); t.channel = tex.channel;
  neutral.set(tex.uuid, t);
  return t;
}
// Where the fabric has a gap (the downloaded models have some), what shows is the inside of the garment: shadowed by the
// front, it read as a black hole. A garment marked `lining` (the parka) shows its inside as plain lining, in its own colour.
function lining(m) {
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'if ( ! gl_FrontFacing ) outgoingLight = diffuseColor.rgb * 0.88;\n#include <opaque_fragment>'); };
  m.customProgramCacheKey = () => 'garment-lining';
}
// A copy of a garment, its own materials (so a colour can be applied without touching other copies).
async function garment(key, { color, tint, gender, light } = {}) {
  const info = (await garmentCatalogue())[key], src = await loadAsset(key, gender, light && info?.street), g = src.clone(true), plain = info?.plain;
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.side = THREE.DoubleSide;
    if (info?.lining) lining(o.material);
    if (tint && color) { // dye it: the colour on the neutral fabric
      // plain: the model's own texture is a shattered atlas (patches of fabric among black filler): plain dye instead
      if (plain) { o.material.map = null; o.material.roughness = 0.62; }
      else if (o.material.map?.image) o.material.map = neutralMap(o.material.map);
      o.material.color = new THREE.Color(color);
    }
    o.castShadow = o.receiveShadow = true;
  });
  return g;
}
// An outfit: [{ asset, color? }, …]. Shoes come as one right shoe (mirrored for the left) or as a pair.
// scales: { asset: horizontal scale for the chosen size } (1 = the size the garment was made in, M).
export async function buildLook(pieces, scales = {}, gender = null, light = false) {
  const cat = await garmentCatalogue(), group = new THREE.Group();
  const closedOuter = pieces.some((p) => cat[p.asset]?.closed); // a buttoned coat hides the top (and would clash with it)
  const layered = pieces.some((p) => cat[p.asset]?.slot === 'outer'); // a top under an open jacket sits a little inside it
  for (const p of pieces) {
    const info = cat[p.asset];
    if (!info || (closedOuter && info.slot === 'top')) continue;
    const g = await garment(p.asset, { color: p.color, tint: info.tint, gender, light });
    g.userData.asset = p.asset;
    const k = (scales[p.asset] || 1) * (layered && info.slot === 'top' ? 0.94 : 1); g.scale.set(k, 1, k);
    group.add(g);
    if (info.slot === 'shoes' && !info.pair) { const l = g.clone(true); l.scale.x = -1; l.userData.mirror = true; group.add(l); } // one shoe: mirror it for the left foot
  }
  return group;
}
export function disposeLook(group) {
  group?.traverse((o) => { if (!o.isMesh) return; if (o.parent?.userData.avatar || o.userData.ownGeometry || o.material.vertexColors) o.geometry.dispose(); if (!o.parent?.userData.avatar) o.material.dispose(); });
}

// Studio turntable with a real photo-studio light (HDRI), soft shadows and ambient occlusion.
export class LookViewer {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(r.domElement);
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    new RGBELoader().load('assets/studio_small_08_1k.hdr', (hdr) => { this.scene.environment = pmrem.fromEquirectangular(hdr).texture; hdr.dispose(); }, undefined, () => {});
    const key = new THREE.DirectionalLight(0xfff4ea, 1.5); key.position.set(1.2, 3, 2.4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 5; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
    Object.assign(key.shadow.camera, { left: -1, right: 1, top: 2, bottom: -0.2, near: 0.5, far: 8 });
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.8, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(26, 3 / 4, 0.05, 40);
    this.camera.position.set(0, 1.0, 4.4);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { target: new THREE.Vector3(0, 0.88, 0), enablePan: false, enableDamping: true, autoRotate: true, autoRotateSpeed: 1.3, minDistance: 1.2, maxDistance: 7 });
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; clearTimeout(this.resume); });
    this.controls.addEventListener('end', () => { this.resume = setTimeout(() => { this.controls.autoRotate = true; }, 5000); });
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, 512, 512);
    ao.updateGtaoMaterial({ radius: 0.1, distanceExponent: 1.5, thickness: 0.05, scale: 1.2 }); ao.blendIntensity = 0.85;
    this.composer.addPass(ao); this.composer.addPass(new OutputPass());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); this.composer.render(); };
    loop();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  // opts: { avatar: { gender, body: { height, chest, waist, hips } }, advice: [fitAdvice…], fitmap: bool }
  async setLook(pieces, opts = {}) {
    pieces ||= [];
    const cat = await garmentCatalogue(), advice = opts.advice || [];
    const scales = Object.fromEntries(advice.filter((a) => a.sized).map((a) => [a.asset, a.scale]));
    const look = await buildLook(pieces, opts.avatar ? {} : scales, opts.avatar?.gender);
    if (opts.avatar) {
      // the clothes follow the body (they were fitted to the avatar); a bigger or smaller size than recommended shows
      // as a little more or less room
      const deform = await bodyDeformer(opts.avatar.gender, opts.avatar.body);
      for (const g of look.children) {
        const info = cat[g.userData.asset], a = advice.find((x) => x.asset === g.userData.asset && x.sized);
        const step = a ? SIZES.indexOf(a.size) - SIZES.indexOf(a.recommended) : 0;
        const mode = ['dress'].includes(info.slot) || ['plaid_skirt', 'overcoat', 'parka'].includes(g.userData.asset) ? 'skirt' : info.slot === 'bottom' || info.slot === 'suit' ? 'legs' : 'garment';
        reshapeGarment(g, deform, mode === 'garment' ? 'legs' : mode, Math.max(1 + Math.max(-1, step) * 0.03, a?.minScale || 1)); // never narrower than the body: no poke-through
      }
      // the garments shown, outermost first (a closed jacket hides the top under it)
      const closed = pieces.some((p) => cat[p.asset]?.closed), rank = { outer: 0, top: 1, dress: 2 };
      const worn = pieces.filter((p) => cat[p.asset] && !(closed && cat[p.asset].slot === 'top')).map((p) => p.asset)
        .sort((a, b) => (rank[cat[a].slot] ?? 9) - (rank[cat[b].slot] ?? 9));
      look.add(await buildAvatar(opts.avatar.gender, opts.avatar.body, worn, opts.avatar.part));
      if (opts.fitmap) {
        look.updateMatrixWorld(true);
        for (const g of look.children) {
          const a = advice.find((x) => x.asset === g.userData.asset && x.sized);
          if (a) paintFit(g, a.status, H);
        }
      }
    }
    if (this.look) { this.scene.remove(this.look); disposeLook(this.look); }
    this.look = look; this.scene.add(look);
    const box = new THREE.Box3().setFromObject(look);
    if (!box.isEmpty()) this.controls.target.set(0, (box.min.y + box.max.y) / 2, 0);
  }
  snapshot(width = 600, height = 800) {
    const r = this.renderer, size = r.getSize(new THREE.Vector2()), pr = r.getPixelRatio();
    r.setPixelRatio(1); r.setSize(width, height, false); this.composer.setSize(width, height);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color(0xf1eee9); this.composer.render(); this.scene.background = null;
    const url = r.domElement.toDataURL('image/jpeg', 0.9);
    r.setPixelRatio(pr); r.setSize(size.x, size.y, false); this.composer.setSize(size.x, size.y);
    this.camera.aspect = size.x / size.y; this.camera.updateProjectionMatrix();
    return url;
  }
}
