// "Design it yourself": a small layer editor for the print area. Layers are images (uploads, or the current AI design)
// and text; drag to move, sliders to resize and rotate. The result is exported as a transparent PNG whose canvas is
// the whole print area, so the customer's positioning is kept on the shirt and in the print file.
const PRINT_W = 1024, PRINT_H = 1280; // print area, 4:5 like a standard front print
const FONTS = {
  'Bold': '900 160px "Arial Black", Impact, sans-serif',
  'Classic': '700 150px Georgia, "Times New Roman", serif',
  'Script': 'italic 700 150px "Snell Roundhand", "Brush Script MT", cursive',
  'Street': '900 170px Impact, "Haettenschweiler", sans-serif',
  'Japanese': '900 160px "Hiragino Mincho ProN", "Hiragino Sans", serif',
};
let layers = [], selected = -1, colors = {}, onApply = null;
const $ = (id) => document.getElementById(id);

export function initEditor({ catalogue, apply }) {
  colors = catalogue.colors;
  onApply = apply;
  const sw = $('edColors');
  sw.innerHTML = '';
  for (const [key, c] of Object.entries(colors)) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.title = c.name; b.style.background = c.hex; b.dataset.color = key;
    b.addEventListener('click', () => { state.color = key; draw(); markSwatch(); });
    sw.append(b);
  }
  $('edUpload').addEventListener('change', onUpload);
  $('edAddText').addEventListener('click', addText);
  $('edText').addEventListener('keydown', (e) => { if (e.key === 'Enter') addText(); });
  $('edSize').addEventListener('input', () => { if (cur()) { cur().scale = +$('edSize').value / 100; draw(); } });
  $('edRotate').addEventListener('input', () => { if (cur()) { cur().rot = +$('edRotate').value * Math.PI / 180; draw(); } });
  $('edTextColor').addEventListener('input', () => { if (cur()?.type === 'text') { cur().color = $('edTextColor').value; renderText(cur()); draw(); } });
  $('edFont').addEventListener('change', () => { if (cur()?.type === 'text') { cur().font = $('edFont').value; renderText(cur()); draw(); } });
  $('edDelete').addEventListener('click', () => { if (selected >= 0) { layers.splice(selected, 1); select(layers.length - 1); draw(); } });
  $('edPlacement').addEventListener('change', () => { state.placement = $('edPlacement').value; });
  $('edClose').addEventListener('click', close);
  $('edApply').addEventListener('click', applyDesign);
  for (const [k] of Object.entries(FONTS)) { const o = document.createElement('option'); o.value = o.textContent = k; $('edFont').append(o); }
  pointerEvents();
}
const state = { color: 'white', placement: 'front-center' };
const cur = () => layers[selected];

export async function openEditor(design) {
  $('editor').hidden = false;
  layers = []; selected = -1;
  state.color = design?.shirtColor || 'white';
  state.placement = design?.placement || 'front-center';
  $('edPlacement').value = state.placement;
  if (design?.artwork) { // start from the current design so it can be adjusted by hand
    // data: URLs (the clothing-studio handoff) break when a query string is
    // appended; only cache-bust real file URLs.
    const src = design.artwork.startsWith('data:') ? design.artwork : `${design.artwork}?t=${Date.now()}`;
    const img = await loadImage(src);
    addImage(img, 'Current design');
  }
  markSwatch();
  draw();
}
function close() { $('editor').hidden = true; }
function markSwatch() { for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('active', b.dataset.color === state.color); }
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// ---------- layers ----------
function addImage(source, name) {
  const fit = Math.min(PRINT_W * 0.8 / source.width, PRINT_H * 0.6 / source.height, 1.5);
  layers.push({ type: 'image', name, src: source, x: PRINT_W / 2, y: PRINT_H * 0.42, scale: fit, rot: 0 });
  select(layers.length - 1);
  draw();
}
async function onUpload(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const img = await loadImage(URL.createObjectURL(file));
  let src = img;
  if ($('edRemoveWhite').checked) { // knock out a white/near-white background (soft edge)
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const m = Math.min(p[i], p[i + 1], p[i + 2]);
      if (m > 240) p[i + 3] = 0; else if (m > 215) p[i + 3] = Math.min(p[i + 3], (240 - m) / 25 * 255);
    }
    g.putImageData(d, 0, 0);
    src = c;
  }
  addImage(src, file.name.slice(0, 24));
}
function renderText(l) { // text is rendered once to its own canvas, then placed like an image
  const c = l.canvas || document.createElement('canvas'), g = c.getContext('2d');
  g.font = FONTS[l.font];
  const w = Math.ceil(g.measureText(l.text).width) + 40, h = 230;
  c.width = w; c.height = h;
  g.font = FONTS[l.font]; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0)';
  g.fillStyle = l.color;
  g.fillText(l.text, w / 2, h / 2 + 8);
  l.canvas = c; l.src = c;
}
function addText() {
  const text = $('edText').value.trim();
  if (!text) return;
  $('edText').value = '';
  const l = { type: 'text', name: `“${text.slice(0, 16)}”`, text, font: $('edFont').value || 'Bold', color: $('edTextColor').value,
    x: PRINT_W / 2, y: PRINT_H * (layers.length ? 0.78 : 0.45), scale: 1, rot: 0 };
  renderText(l);
  l.scale = PRINT_W * 0.8 / l.canvas.width; // start wide; the Size slider adjusts it
  layers.push(l);
  select(layers.length - 1);
  draw();
}
function select(i) {
  selected = i;
  const l = cur();
  $('edSize').value = l ? Math.round(l.scale * 100) : 100;
  $('edRotate').value = l ? Math.round(l.rot * 180 / Math.PI) : 0;
  $('edTextTools').hidden = !(l?.type === 'text');
  if (l?.type === 'text') { $('edTextColor').value = l.color; $('edFont').value = l.font; }
  const list = $('edLayers');
  list.innerHTML = '';
  layers.forEach((ly, k) => {
    const b = document.createElement('button');
    b.textContent = `${ly.type === 'text' ? 'T' : '🖼'}  ${ly.name}`;
    b.className = k === selected ? 'active' : '';
    b.addEventListener('click', () => { select(k); draw(); });
    list.append(b);
  });
}

// ---------- drawing ----------
function drawLayers(g, withSelection) {
  for (const [k, l] of layers.entries()) {
    const w = l.src.width * l.scale, h = l.src.height * l.scale;
    g.save(); g.translate(l.x, l.y); g.rotate(l.rot);
    g.drawImage(l.src, -w / 2, -h / 2, w, h);
    if (withSelection && k === selected) { g.strokeStyle = '#b5562b'; g.lineWidth = 5; g.setLineDash([16, 10]); g.strokeRect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16); }
    g.restore();
  }
}
function draw() {
  const c = $('edCanvas'), g = c.getContext('2d');
  g.fillStyle = colors[state.color]?.hex || '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(128,128,128,.55)'; g.setLineDash([12, 12]); g.lineWidth = 3; g.strokeRect(6, 6, c.width - 12, c.height - 12); g.setLineDash([]);
  drawLayers(g, true);
}
function exportArtwork() {
  const c = document.createElement('canvas'); c.width = PRINT_W; c.height = PRINT_H;
  drawLayers(c.getContext('2d'), false);
  return c.toDataURL('image/png');
}
async function applyDesign() {
  if (!layers.length) { $('edHint').textContent = 'Add an image or some text first.'; return; }
  $('edApply').disabled = true;
  $('edApply').textContent = 'Printing your design…';
  try {
    await onApply({ artwork: exportArtwork(), shirtColor: state.color, placement: state.placement,
      summary: layers.map((l) => (l.type === 'text' ? `“${l.text}”` : 'image')).join(' + ') });
    close();
  } catch (e) { $('edHint').textContent = e.message; }
  finally { $('edApply').disabled = false; $('edApply').textContent = 'Put it on the garment'; }
}

// ---------- drag to move ----------
function pointerEvents() {
  const c = $('edCanvas');
  let drag = null;
  const pos = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
  c.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    for (let k = layers.length - 1; k >= 0; k--) { // topmost layer under the pointer
      const l = layers[k], dx = p.x - l.x, dy = p.y - l.y;
      const lx = dx * Math.cos(-l.rot) - dy * Math.sin(-l.rot), ly = dx * Math.sin(-l.rot) + dy * Math.cos(-l.rot);
      if (Math.abs(lx) < l.src.width * l.scale / 2 && Math.abs(ly) < l.src.height * l.scale / 2) {
        select(k); drag = { k, ox: dx, oy: dy }; c.setPointerCapture(e.pointerId); draw(); return;
      }
    }
  });
  c.addEventListener('pointermove', (e) => { if (!drag) return; const p = pos(e), l = layers[drag.k]; l.x = p.x - drag.ox; l.y = p.y - drag.oy; draw(); });
  c.addEventListener('pointerup', () => { drag = null; });
}
