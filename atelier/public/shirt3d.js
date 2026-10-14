// Realistic 3D garments: the design is printed into the fabric texture of a real garment model (sewing-pattern UVs,
// baked folds), so the print follows every crease. Other garment types (hoodie, tank top, dress…) are reshaped from
// the same model (garments.js). Used by the studio turntable, the live camera try-on and the boutique walls.
import * as THREE from 'three';
import { TSHIRT, bodyGeometry, hasCuts, paintDetails, paintFabric, printArea, extraParts, FABRIC } from './garments.js';
import { fabricMaps, weaveInto, addUnitUV } from './fabrics.js';
const UV_UNITS = 0.9; // 1 unit of the shirt's texture ≈ 0.9 model units of fabric
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Where each placement sits on the model's texture (u = across, v = down from the collar), sizes as texture fractions.
// The front panel is centred at u .258 (neck ends at v ≈ .11), the back panel at u .75.
const PRINT = {
  'front-center': { u: 0.258, top: 0.175, w: 0.17, maxH: 0.24 },
  'front-large': { u: 0.258, top: 0.165, w: 0.215, maxH: 0.32 },
  'chest-left': { u: 0.258 + 0.075, top: 0.19, w: 0.065, maxH: 0.08 },
  back: { u: 0.75, top: 0.15, w: 0.22, maxH: 0.34 },
};
const TEX = 2048;

let shirtPromise = null, normalScale = new THREE.Vector2(1, 1);
export function loadShirt() { // the garment model is loaded once and shared
  shirtPromise ||= new GLTFLoader().loadAsync('models/shirt_model.glb').then((g) => {
    let mesh;
    g.scene.traverse((o) => { if (o.isMesh) mesh = o; });
    normalScale = mesh.material.normalScale.clone();
    return { geometry: mesh.geometry, normalMap: mesh.material.normalMap, aoMap: mesh.material.aoMap };
  });
  return shirtPromise;
}

// Fabric texture: garment colour + fine cotton grain, with its details (ribbing, pockets, zip) and the artwork
// printed in at its placement.
function fabricCanvas(art, hex, placement, g, maps, allOver) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, TEX, TEX);
  paintFabric(ctx, TEX, hex, g, Math.random, { weave: !maps });
  if (maps) weaveInto(ctx, TEX, maps.detail, maps.tile / UV_UNITS * TEX); // the real cloth's texture, at its real size
  paintDetails(ctx, TEX, hex, g, 'under');
  if (art) {
    const draw = (p) => {
      let w = p.w * TEX, h = w * art.height / art.width;
      if (h > p.maxH * TEX) { w *= p.maxH * TEX / h; h = p.maxH * TEX; }
      ctx.globalAlpha = 0.97; // ink sits in the cotton, a hair of the fabric shows through
      ctx.drawImage(art, p.u * TEX - w / 2, p.top * TEX, w, h);
      ctx.globalAlpha = 1;
    };
    // A studio full-texture design carries the whole artwork: printed large on the
    // front AND the back panel, so all of it shows — not a small patch on the chest.
    if (allOver) { draw(printArea(PRINT['front-large'], g, 'front-large')); draw(printArea(PRINT.back, g, 'back')); }
    else draw(printArea(PRINT[placement] || PRINT['front-center'], g, placement));
  }
  paintDetails(ctx, TEX, hex, g, 'over');
  const img = ctx.getImageData(0, 0, TEX, TEX), d = img.data; // knit grain over cloth and print alike
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10 + (((i >> 2) % TEX) % 3 === 0 ? -3 : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
// The garment as a group: the body (with the print) plus any extra parts (hood, drawstrings, zip pull).
// A copy of a garment shape pushed outward along its (seam-welded) normals, for a jacket worn over another top.
const inflated = new Map();
function inflate(geo, d) {
  const key = `${geo.uuid}|${d}`;
  if (inflated.has(key)) return inflated.get(key);
  const out = geo.clone(), p = out.attributes.position, n = out.attributes.normal, sum = new Map();
  const k = (i) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  for (let i = 0; i < p.count; i++) { const s = sum.get(k(i)) || [0, 0, 0]; s[0] += n.getX(i); s[1] += n.getY(i); s[2] += n.getZ(i); sum.set(k(i), s); }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromArray(sum.get(k(i))).normalize();
    p.setXYZ(i, p.getX(i) + v.x * d, p.getY(i) + v.y * d, p.getZ(i) + v.z * d);
  }
  out.computeBoundingBox(); out.computeBoundingSphere();
  inflated.set(key, out);
  return out;
}
export async function makeShirt(art, hex, placement, garment, { inflate: grow = 0, allOver = false } = {}) {
  const g = { ...TSHIRT, ...(garment || {}) };
  const { geometry, normalMap, aoMap } = await loadShirt();
  // jersey keeps the model's own cotton weave; other fabrics use photo-scanned cloth (denim, wool, leather…)
  const maps = g.fabric && g.fabric !== 'jersey' ? await fabricMaps(g.fabric) : null;
  const map = new THREE.CanvasTexture(fabricCanvas(art, hex, placement, g, maps, allOver));
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  const f = FABRIC[g.fabric] || FABRIC.jersey;
  const material = new THREE.MeshPhysicalMaterial({
    map, normalMap, aoMap, aoMapIntensity: 1, roughness: f.roughness, metalness: 0,
    sheen: f.sheen, sheenRoughness: f.sheenRoughness, sheenColor: new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.5),
    clearcoat: f.clearcoat || 0, clearcoatRoughness: f.clearcoatRoughness || 0,
    side: THREE.DoubleSide,
  });
  if (f.normal !== 1) material.normalScale = normalScale.clone().multiplyScalar(f.normal);
  if (maps) { material.normalMap = maps.normal; material.roughnessMap = maps.rough; material.normalScale = new THREE.Vector2(f.normal, f.normal); }
  if (hasCuts(g)) { material.vertexColors = true; material.alphaTest = 0.5; }
  const shape = addUnitUV(bodyGeometry(geometry, g), UV_UNITS);
  const body = new THREE.Mesh(grow ? inflate(shape, grow) : shape, material);
  const group = new THREE.Group();
  const extras = extraParts(g, material, hex);
  if (grow) for (const e of extras) { e.scale.multiplyScalar(1.05); e.position.multiplyScalar(1.05); }
  group.add(body, ...extras);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.userData.garment = g;
  return group;
}
export function disposeGarment(group) { // geometries are shared between garments; textures and materials are not
  group?.traverse((o) => { if (o.isMesh) { o.material.map?.dispose(); o.material.dispose(); } });
}
function studioLights(scene, renderer) {
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
  key.position.set(1.2, 2, 2);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 1.4);
  rim.position.set(-2, 1, -1.5);
  scene.add(key, rim);
}

// Studio turntable like a product shoot: slowly rotating, drag to turn, scroll to zoom.
export class ShirtViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    studioLights(this.scene, this.renderer);
    this.camera = new THREE.PerspectiveCamera(30, 3 / 4, 0.01, 20);
    this.camera.position.set(0, 0, 1.45);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { target: new THREE.Vector3(0, -0.045, 0), enablePan: false, enableDamping: true,
      autoRotate: true, autoRotateSpeed: 1.6, minDistance: 0.9, maxDistance: 2.6 });
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; clearTimeout(this.resume); });
    this.controls.addEventListener('end', () => { this.resume = setTimeout(() => { this.controls.autoRotate = true; }, 4000); });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  async setDesign(art, hex, placement, garment, opts = {}) {
    const shirt = await makeShirt(art, hex, placement, garment, opts);
    if (this.shirt) { this.scene.remove(this.shirt); disposeGarment(this.shirt); }
    this.shirt = shirt;
    this.scene.add(shirt);
    this.placement = placement;
    // Frame the whole garment (a dress is much longer than a tee).
    const box = new THREE.Box3().setFromObject(shirt);
    if (shirt.userData.garment.length === 'crop') box.min.y = Math.max(box.min.y, -0.17); // the cut-away part still has geometry
    const size = box.getSize(new THREE.Vector3());
    this.fitDist = Math.max(1.45, size.y / 2 / Math.tan(THREE.MathUtils.degToRad(15)) * 1.1);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, (box.min.y + box.max.y) / 2, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, this.fitDist);
    this.controls.maxDistance = Math.max(2.6, this.fitDist * 1.6);
  }
  // Still image of the shirt on white, front (or back) view, 3:4 — used for the try-on AI and the print sheet.
  snapshot(side = 'front', width = 768, height = 1024) {
    const r = this.renderer, cam = this.camera, saved = { pos: cam.position.clone(), aspect: cam.aspect, size: r.getSize(new THREE.Vector2()), auto: this.controls.autoRotate, pr: r.getPixelRatio() };
    this.scene.background = new THREE.Color(0xffffff);
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    cam.aspect = width / height; cam.updateProjectionMatrix();
    cam.position.set(0, this.controls.target.y, (side === 'back' ? -1 : 1) * (this.fitDist || 1.45) * 1.03);
    cam.lookAt(this.controls.target);
    r.render(this.scene, cam);
    const url = r.domElement.toDataURL('image/jpeg', 0.93);
    this.scene.background = null;
    r.setPixelRatio(saved.pr);
    r.setSize(saved.size.x, saved.size.y, false);
    cam.aspect = saved.aspect; cam.updateProjectionMatrix();
    cam.position.copy(saved.pos);
    cam.lookAt(this.controls.target);
    return url;
  }
}

// Live camera try-on: the whole 3D shirt is fitted to your shoulders and torso from body tracking, turns when you
// turn, is lit to match your room, and is then cut to your silhouette by the caller.
export class ShirtAR {
  constructor() {
    // preserveDrawingBuffer: the live try-on snapshot reads this canvas at
    // any moment, and without it the read can come back blank.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    studioLights(this.scene, this.renderer);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000); // the shirt is scaled to pixels, so depth spans hundreds of units
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.fit = null;
  }
  get canvas() { return this.renderer.domElement; }
  async setDesign(art, hex, placement, garment, opts = {}) {
    const shirt = await makeShirt(art, hex, placement, garment, opts);
    shirt.position.y = -0.17; // the model's shoulder line sits at the holder's origin
    if (this.shirt) { this.holder.remove(this.shirt); disposeGarment(this.shirt); }
    this.shirt = shirt;
    this.holder.add(shirt);
  }
  // lm: image landmarks (0..1), world: metric landmarks; W,H: video size; light: 0..1 brightness of the room.
  render(lm, world, W, H, light) {
    const r = this.renderer;
    if (r.domElement.width !== W || r.domElement.height !== H) {
      r.setSize(W, H, false);
      Object.assign(this.camera, { left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2 });
      this.camera.updateProjectionMatrix();
    }
    const ls = { x: lm[11].x * W, y: lm[11].y * H }, rs = { x: lm[12].x * W, y: lm[12].y * H };
    const shoulderPx = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    const hipsOk = lm[23].visibility > 0.4 && lm[24].visibility > 0.4;
    const hipY = hipsOk ? (lm[23].y + lm[24].y) / 2 * H : null;
    const target = {
      x: (ls.x + rs.x) / 2 - W / 2,
      y: H / 2 - (ls.y + rs.y) / 2,
      s: shoulderPx / 0.27,                                 // shoulder joints are ~30 cm apart on the model's scale
      stretch: hipsOk ? clamp((hipY - (ls.y + rs.y) / 2) / shoulderPx / 1.45, 0.85, 1.3) : 1,
      roll: -Math.atan2(ls.y - rs.y, ls.x - rs.x),
      yaw: world ? Math.atan2(world[11].z - world[12].z, world[11].x - world[12].x) : 0,
    };
    // Smooth the fit so the shirt doesn't jitter.
    this.fit = this.fit ? Object.fromEntries(Object.keys(target).map((k) => [k, this.fit[k] + (target[k] - this.fit[k]) * 0.4])) : target;
    const f = this.fit;
    this.holder.position.set(f.x, f.y, 0);
    // The camera view is shown mirrored (like a mirror), so the shirt is drawn mirrored too: the print then reads correctly.
    this.holder.scale.set(-f.s, f.s * f.stretch, f.s);
    this.holder.rotation.set(0, f.yaw, f.roll);
    r.toneMappingExposure = 0.55 + light * 0.9; // match the room's brightness
    r.render(this.scene, this.camera);
    return r.domElement;
  }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
