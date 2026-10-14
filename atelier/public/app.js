// Atelier front end: chat with the seller, show the design on the chosen garment (t-shirt, hoodie… or a garment type
// the customer describes), try it on (live preview + realistic AI photo), and download the print package.
// All AI calls go through the local server, which holds the keys.
import { ShirtViewer, ShirtAR } from './shirt3d.js';
import { initEditor, openEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const state = { messages: [], design: null, lastSpec: null, busy: false, garmentType: null, draft: null, before: null };
let catalogue = null;
fetch('/api/catalogue').then((r) => r.json()).then((c) => {
  catalogue = c;
  state.garmentType ||= c.garments[0];
  initEditor({ catalogue: c, apply: applyManual });
  renderGarments();
}).catch(() => {});

const colorHex = (c) => catalogue?.colors?.[c]?.hex || '#f2f1ee';

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), Math.max(4000, String(text).length * 70)); // long messages (limits, errors) stay long enough to read
}
// Every request has a time limit (long enough for each AI step) and ends in a clear message, never an endless spinner.
const LIMITS = { '/api/design': 200000, '/api/tryon': 300000, '/api/design/manual': 60000 };
async function api(path, body) {
  let r;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(LIMITS[path] || 80000) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'No answer in time — the free AI service may be busy. Please try again in a moment.'
      : 'Cannot reach the Atelier server. Is it running? (npm start)');
  }
  const j = await r.json().catch(() => ({ error: `The server answered with an error (${r.status}).` }));
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ---------- chat ----------
function addMessage(role, text, extraClass = '') {
  const div = document.createElement('div');
  div.className = `msg ${role} ${extraClass}`;
  div.textContent = text;
  if (/[؀-ۿ]/.test(text)) div.dir = 'rtl'; // Arabic reads right-to-left
  $('messages').append(div);
  $('messages').scrollTop = $('messages').scrollHeight;
  return div;
}
// The language the customer writes in — remembered so Yanis greets them back in it later.
function detectLang(text) {
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/\b(bonjour|bonsoir|salut|je|veux|voudrais|merci|couleur|couleurs|dessin|pour|avec|dans|combien|comment|fais|très|aussi|c'est)\b/i.test(text)) return 'fr';
  return 'en';
}
function rememberLang(text) { try { localStorage.setItem('yanisLang', detectLang(text)); } catch { /* private mode */ } }
async function send(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  rememberLang(text);
  addMessage('user', text);
  state.messages.push({ role: 'user', text });
  const typing = addMessage('seller', 'Yanis is typing…', 'typing');
  try {
    const answer = await api('/api/chat', { messages: state.messages, garmentType: state.garmentType });
    typing.remove();
    addMessage('seller', answer.reply);
    state.messages.push({ role: 'seller', text: answer.reply });
    if (answer.ready && answer.design?.prompt) await makeDesign(answer.design);
  } catch (e) {
    typing.remove();
    addMessage('seller', `⚠️ ${e.message}`);
  } finally {
    state.busy = false;
  }
}
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value;
  $('input').value = '';
  send(text);
});

// ---------- design ----------
async function makeDesign(spec) {
  state.lastSpec = spec;
  const what = `Yanis is designing your ${garmentName().toLowerCase()}…`;
  setWorking(what);
  const started = Date.now();
  const tick = setInterval(() => { $('workingText').textContent = `${what} ${Math.round((Date.now() - started) / 1000)}s`; }, 1000);
  try {
    const d = await api('/api/design', { ...spec, garmentType: state.garmentType });
    state.design = d;
    state.garmentType = d.garmentType;
    renderGarments();
    await show3D(d);
    $('summary').textContent = d.summary || '';
    for (const id of ['btnTry', 'btnPrint', 'btnAgain', 'btnPublish']) $(id).disabled = false;
  } catch (e) {
    toast(e.message);
    addMessage('seller', `⚠️ ${e.message}`);
  } finally {
    clearInterval(tick);
    setWorking(null);
  }
}
function setWorking(text) {
  $('working').hidden = !text;
  if (text) { $('workingText').textContent = text; $('empty').hidden = true; }
}
// The design printed on the realistic 3D shirt, turning slowly like a product shoot.
let viewer = null;
async function show3D(d) {
  try {
    viewer ||= new ShirtViewer($('viewer3d'));
    await viewer.setDesign(await loadImage(d.artwork), colorHex(d.shirtColor), d.placement, d.garmentType, { allOver: !!d.allOver });
    $('mockup').classList.remove('show');
    $('empty').hidden = true;
    // The 3D render also becomes the shop mockup (print sheet) and the garment the try-on AI dresses you in.
    setTimeout(() => api('/api/mockup', { id: d.id, image: viewer.snapshot(d.placement === 'back' ? 'back' : 'front') }).catch(() => {}), 400);
  } catch (e) {
    console.warn('3D view unavailable, showing the photo mockup', e);
    await showMockup(d.garment);
  }
}
function showMockup(src) {
  return new Promise((resolve) => {
    const img = $('mockup');
    img.onload = () => { img.classList.add('show'); $('empty').hidden = true; resolve(); };
    img.onerror = resolve;
    img.src = `${src}?t=${Date.now()}`;
  });
}
$('btnAgain').addEventListener('click', () => state.lastSpec && !state.busy && makeDesign(state.lastSpec));

// ---------- design it yourself ----------
$('btnDIY').addEventListener('click', () => openEditor(state.design));
$('btnLetsDoIt').addEventListener('click', () => window.open('http://localhost:5173/', '_blank')); // clothing-studio: open the "Let'sDo it." studio (site 1)
async function applyManual(spec) { // called by the editor with the finished artwork
  setWorking(`Printing your design onto the ${garmentName().toLowerCase()}…`);
  try {
    const d = await api('/api/design/manual', { ...spec, garmentType: state.garmentType });
    state.design = d;
    state.lastSpec = null; // "New version" asks the AI again; it doesn't apply to hand-made designs
    await show3D(d);
    $('summary').textContent = d.summary || '';
    for (const id of ['btnTry', 'btnPrint', 'btnPublish']) $(id).disabled = false;
    $('btnAgain').disabled = true;
    addMessage('seller', `Nice work! Your own design is on the ${garmentName().toLowerCase()}. You can try it on, download the print files, or put it in the store.`);
  } finally { setWorking(null); }
}

// ---------- put it in the store ----------
$('btnPublish').addEventListener('click', () => {
  if (!state.design) return;
  $('pubTitle').value = (state.design.summary || '').slice(0, 40);
  $('publish').hidden = false;
});
$('pubClose').addEventListener('click', () => { $('publish').hidden = true; });
$('pubGo').addEventListener('click', async () => {
  try {
    await api('/api/publish', { id: state.design.id, title: $('pubTitle').value, author: $('pubAuthor').value });
    $('publish').hidden = true;
    toast('Published! Your design now hangs on the wall of the Atelier boutique.');
    window.parent?.postMessage({ type: 'atelier-store-updated' }, location.origin); // the 3D street re-hangs its walls
  } catch (e) { toast(e.message); }
});
$('btnPrint').addEventListener('click', () => {
  if (!state.design) return;
  toast('Preparing your print files…');
  location.href = `/api/print/${state.design.id}`;
});

// ---------- try-on ----------
let stream = null, mode = 'photo', artImage = null, pose = null, poseLoading = null, rafId = 0;
$('btnTry').addEventListener('click', openTryOn);
$('closeTry').addEventListener('click', closeTryOn);
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => setMode(b.dataset.mode));

async function openTryOn() {
  if (!state.design) return;
  $('tryon').hidden = false;
  resetResult();
  artImage = await loadImage(state.design.artwork);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1440 }, facingMode: 'user' }, audio: false });
    $('video').srcObject = stream;
    await $('video').play();
  } catch {
    toast('Camera not available — you can upload a photo instead.');
  }
  setMode(mode);
}
function closeTryOn() {
  $('tryon').hidden = true;
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.mode === m);
  $('btnShoot').textContent = m === 'live' ? 'Take a snapshot' : 'Take photo & try on';
  $('guide').hidden = m === 'live'; // the framing guide is only for the photo
  $('tryHint').textContent = m === 'live'
    ? 'Quick preview only (a rough idea). For a real-looking result use “Realistic photo”.'
    : 'Best quality: “Upload a photo” taken with your phone (sharper face than the laptop camera). Head to hips visible, good light.';
  cancelAnimationFrame(rafId);
  resetResult();
  if (m === 'live') startLive(); else clearOverlay();
}
function resetResult() {
  $('tryResult').hidden = true;
  $('saveTry').hidden = true;
  $('tryWorking').hidden = true;
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
}
function clearOverlay() {
  const c = $('overlay');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

// Live preview: body tracking (MediaPipe) places the print on the chest, following shoulders and tilt.
async function loadPose() {
  if (pose) return pose;
  poseLoading ||= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
    const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    pose = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: true,
    });
    return pose;
  })();
  return poseLoading;
}
// Live preview: the whole 3D shirt is fitted to your body by body tracking, lit to match your room,
// and cut to your silhouette so it hugs your outline instead of floating.
let ar = null, arDesignId = null, light = 0.5, frame = 0;
const maskCanvas = document.createElement('canvas'), probe = document.createElement('canvas');
probe.width = probe.height = 16;
function measureLight(video, lm, W, H) { // brightness of your face = how bright the room light is (0..1)
  const size = Math.hypot((lm[11].x - lm[12].x) * W, (lm[11].y - lm[12].y) * H) * 0.35;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(video, lm[0].x * W - size / 2, lm[0].y * H - size / 2, size, size, 0, 0, 16, 16);
  const d = pctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
  return Math.min(1, Math.max(0.15, sum / 256 * 1.3));
}
async function startLive() {
  const video = $('video');
  if (!stream) return;
  try { await loadPose(); } catch { toast('Live tracking could not load (internet needed).'); return; }
  ar ||= new ShirtAR();
  if (arDesignId !== state.design.id + JSON.stringify(state.design.garmentType)) {
    await ar.setDesign(artImage, colorHex(state.design.shirtColor), state.design.placement, state.design.garmentType);
    arDesignId = state.design.id + JSON.stringify(state.design.garmentType);
  }
  const c = $('overlay'), ctx = c.getContext('2d'), mctx = maskCanvas.getContext('2d');
  const loop = () => {
    if (mode !== 'live' || $('tryon').hidden) return;
    rafId = requestAnimationFrame(loop);
    if (video.readyState < 2) return;
    const W = video.videoWidth, H = video.videoHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.clearRect(0, 0, W, H);
    const res = pose.detectForVideo(video, performance.now());
    const lm = res.landmarks?.[0], mask = res.segmentationMasks?.[0];
    if (!lm || lm[11].visibility < 0.5 || lm[12].visibility < 0.5) { mask?.close(); return; }
    if (!(frame++ % 15)) light = measureLight(video, lm, W, H);
    ctx.drawImage(ar.render(lm, res.worldLandmarks?.[0], W, H, light), 0, 0, W, H);
    if (mask) { // keep the shirt only over your body (slightly widened so sleeve edges aren't trimmed)
      const mw = mask.width, mh = mask.height, values = mask.getAsFloat32Array();
      if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh; }
      const img = mctx.createImageData(mw, mh);
      for (let i = 0; i < values.length; i++) img.data[i * 4 + 3] = Math.min(255, values[i] * 600);
      mctx.putImageData(img, 0, 0);
      mask.close();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.filter = 'blur(5px)';
      ctx.drawImage(maskCanvas, 0, 0, W, H);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
    }
    cutHeadAndNeck(ctx, lm, W, H);
  };
  loop();
}
// Clothes sit behind your head and neck: erase the shirt there (head oval down to the chin, then the neck).
function cutHeadAndNeck(ctx, lm, W, H) {
  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const nose = P(0), earL = P(7), earR = P(8), mouth = { x: (P(9).x + P(10).x) / 2, y: (P(9).y + P(10).y) / 2 };
  const eyes = (P(2).y + P(5).y) / 2, chin = mouth.y + (mouth.y - eyes) * 0.85;
  const headW = Math.hypot(earL.x - earR.x, earL.y - earR.y) * 0.62;
  const shoulderY = (P(11).y + P(12).y) / 2, shoulderPx = Math.hypot(P(11).x - P(12).x, P(11).y - P(12).y);
  const neckBottom = shoulderY - shoulderPx * 0.24;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(nose.x, (chin + 0) / 2 + (nose.y - chin) / 2, headW, Math.max(chin - nose.y, 10) * 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (neckBottom > chin) {
    const nw = headW * 0.8;
    ctx.beginPath();
    ctx.moveTo(mouth.x - nw, chin - 5);
    ctx.lineTo(mouth.x + nw, chin - 5);
    ctx.quadraticCurveTo(mouth.x + nw * 1.1, neckBottom, mouth.x, neckBottom + shoulderPx * 0.02);
    ctx.quadraticCurveTo(mouth.x - nw * 1.1, neckBottom, mouth.x - nw, chin - 5);
    ctx.fill();
  }
  ctx.restore();
}

// Realistic photo: capture a 3:4 frame (or an uploaded photo) and let the try-on AI dress you.
function captureFrame() {
  const v = $('video'), vw = v.videoWidth, vh = v.videoHeight;
  const targetRatio = 3 / 4;
  let sw = vw, sh = vh;
  if (vw / vh > targetRatio) sw = vh * targetRatio; else sh = vw / targetRatio;
  const c = document.createElement('canvas'); // full camera resolution: the server keeps it sharp outside the shirt
  c.width = Math.round(Math.min(sw, 1536)); c.height = Math.round(c.width / targetRatio);
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.scale(-1, 1); // keep the mirror view the customer saw
  ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}
async function countdown() {
  const el = $('countdown');
  el.hidden = false;
  for (const n of [3, 2, 1]) { el.textContent = n; await new Promise((r) => setTimeout(r, 800)); }
  el.hidden = true;
}
$('btnShoot').addEventListener('click', async () => {
  if (!stream) { toast('No camera — use “Upload a photo”.'); return; }
  if (mode === 'live') { // snapshot of the live preview (video + overlay)
    const v = $('video'), o = $('overlay'), c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0); ctx.drawImage(o, 0, 0);
    showTryResult(c.toDataURL('image/jpeg', 0.92));
    return;
  }
  await countdown();
  await realisticTryOn(captureFrame());
});
$('upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  setMode('photo');
  await realisticTryOn(data);
});
async function realisticTryOn(photo) {
  resetResult();
  $('tryWorking').hidden = false;
  $('btnShoot').disabled = true;
  const started = Date.now();
  const tick = setInterval(() => { $('tryTimer').textContent = `${Math.round((Date.now() - started) / 1000)}s — usually 30–60 seconds`; }, 1000);
  try {
    const r = await api('/api/tryon', { id: state.design.id, photo, garment: viewer?.snapshot('front') });
    showTryResult(r.url);
    addResultThumb(r.url);
  } catch (e) {
    toast(e.message);
  } finally {
    clearInterval(tick);
    $('tryWorking').hidden = true;
    $('btnShoot').disabled = false;
  }
}
function showTryResult(src) {
  $('tryResult').src = src;
  $('tryResult').hidden = false;
  $('saveTry').href = src;
  $('saveTry').hidden = false;
}
function addResultThumb(src) {
  const img = document.createElement('img');
  img.src = src;
  img.title = 'Your try-on';
  img.addEventListener('click', () => window.open(src, '_blank'));
  $('results').prepend(img);
}

// ---------- garments: the catalogue, your own types, and describing a new one ----------
const garmentName = () => state.garmentType?.name || 'T-shirt';
const sameGarment = (a, b) => a && b && a.id === b.id && a.name === b.name;
function myGarments() { try { return JSON.parse(localStorage.getItem('atelier-my-garments')) || []; } catch { return []; } }
function saveMyGarments(list) { try { localStorage.setItem('atelier-my-garments', JSON.stringify(list.slice(-12))); } catch {} }
function renderGarments() {
  if (!catalogue) return;
  const box = $('garments');
  box.innerHTML = '';
  const list = [...catalogue.garments, ...myGarments().map((g) => ({ ...g, mine: true }))];
  if (state.draft) list.push({ ...state.draft, draft: true });
  for (const g of list) {
    const b = document.createElement('button');
    b.className = `chip${sameGarment(g, state.garmentType) ? ' active' : ''}`;
    b.textContent = g.name;
    const tag = g.draft ? 'new' : g.mine ? 'yours' : g.author ? `by ${g.author}` : '';
    if (tag) { const t = document.createElement('small'); t.textContent = tag; b.append(t); }
    b.addEventListener('click', () => !g.draft && chooseGarment(g));
    box.append(b);
  }
  const add = document.createElement('button');
  add.className = 'chip new';
  add.textContent = '+ New type';
  add.addEventListener('click', () => { $('newType').hidden = false; $('ntText').focus(); });
  box.append(add);
}
// Put the current design (or, before there is one, a blank) on another garment.
async function chooseGarment(g) {
  const { mine, draft, ...recipe } = g;
  state.garmentType = recipe;
  renderGarments();
  if (state.design) {
    const d = await api('/api/design/garment-type', { id: state.design.id, garmentType: recipe });
    state.design = { ...state.design, ...d };
    await show3D(state.design);
  } else {
    viewer ||= new ShirtViewer($('viewer3d'));
    await viewer.setDesign(null, colorHex('white'), 'front-center', recipe);
    $('empty').hidden = true;
  }
}
$('ntClose').addEventListener('click', () => { $('newType').hidden = true; });
for (const b of document.querySelectorAll('#ntExamples .chip')) b.addEventListener('click', () => { $('ntText').value = b.textContent; });
$('ntGo').addEventListener('click', async () => {
  const description = $('ntText').value.trim();
  if (!description) { $('ntText').focus(); return; }
  $('ntGo').disabled = true; $('ntGo').textContent = 'Making it…';
  try {
    const { garmentType } = await api('/api/garment-type', { description });
    garmentType.id = `mine-${Math.random().toString(36).slice(2, 8)}`;
    state.before = state.draft ? state.before : state.garmentType;
    state.draft = garmentType;
    $('newType').hidden = true;
    await chooseGarment(garmentType);
    $('tdName').textContent = garmentType.name;
    $('tdFeatures').textContent = features(garmentType);
    $('tdNote').textContent = garmentType.note || '';
    $('tdNote').hidden = !garmentType.note;
    $('typeDecision').hidden = false;
  } catch (e) { toast(e.message); }
  finally { $('ntGo').disabled = false; $('ntGo').textContent = 'Create it'; }
});
function features(g) {
  return [g.sleeves === 'none' ? 'sleeveless' : `${g.sleeves.replace('-', ' ')} sleeves`, g.length !== 'regular' && `${g.length} length`,
    g.neck === 'v' && 'V-neck', g.hood && 'hood', g.zip && 'zip', g.pocket !== 'none' && `${g.pocket} pocket`, g.ribbed && 'ribbed', g.fabric].filter(Boolean).join(' · ');
}
function closeDecision() { state.draft = null; state.before = null; $('typeDecision').hidden = true; renderGarments(); }
$('tdPublish').addEventListener('click', async () => {
  try {
    const r = await api('/api/garment-type/publish', { garmentType: state.draft, author: $('tdAuthor').value });
    catalogue.garments = r.garments;
    closeDecision();
    await chooseGarment(r.garmentType);
    toast(`Published! “${r.garmentType.name}” is now in the catalogue for everyone.`);
  } catch (e) { toast(e.message); }
});
$('tdKeep').addEventListener('click', () => {
  const g = state.draft;
  saveMyGarments([...myGarments().filter((m) => m.id !== g.id), g]);
  closeDecision();
  toast(`“${g.name}” is saved in your garment list on this device. Only you can see it.`);
});
$('tdDiscard').addEventListener('click', async () => {
  const back = state.before || catalogue.garments[0];
  closeDecision();
  await chooseGarment(back);
});

// ---------- start ----------
addMessage('seller', "Hi! I'm Yanis 👋 Pick a garment under the 3D view (t-shirt, hoodie, sweatshirt… or describe a new one), then tell me the design you dream of — a theme, an animal, a phrase, colours… I'll design it for you. Or design it yourself: click ✨ Let'sDo it. below — it opens the design studio (the other site). When you finish there, come back to me and I'll tell you the price of your design!");

// Yanis's price list: garment base + print — a fixed rule, no AI needed, the same number every time.
// Prices are in dollars (the old dirham figures ÷10: about 10 dirhams = 1 dollar).
function priceOf(meta) {
  const name = String(meta.garmentType?.name || 't-shirt');
  const n = name.toLowerCase();
  const base = /hood/.test(n) ? 44.9 : /sweat/.test(n) ? 39.9 : /long/.test(n) ? 29.9 : /tank|sleeveless/.test(n) ? 15.9 : /dress/.test(n) ? 39.9 : 19.9;
  const print = /back|large/.test(String(meta.placement || '')) ? 8 : 5; // full-back / full-front print costs more ink
  return { name, base, print, total: Math.round((base + print) * 100) / 100 };
}
const money = (v) => `$${Number(v).toFixed(2)}`;

// Yanis announces the price in the language the customer has been using
// (remembered from the chat; ?lang=ar|fr|en overrides it for a direct link).
function priceGreeting(p, d) {
  const q = new URLSearchParams(location.search).get('lang');
  let lang = ['ar', 'fr', 'en'].includes(q) ? q : null;
  if (!lang) { try { lang = localStorage.getItem('yanisLang'); } catch { /* private mode */ } }
  if (!lang) lang = /[؀-ۿ]/.test(d.summary || '') ? 'ar' : 'en';
  const s = d.summary || 'your design';
  if (lang === 'ar') return `أهلاً بيك من جديد! حطيت «${s}» فالعرض ثلاثي الأبعاد باش تشوفو. التمن تاعي: ${money(p.total)} — يعني ${money(p.base)} لـ ${p.name} و ${money(p.print)} للطبعة. دير كليك على 🏬 Put it in the store وراح يتعلّق فالفيترين بالزربة.`;
  if (lang === 'fr') return `Content de te revoir ! J'ai mis « ${s} » sur la vue 3D pour toi. Mon prix : ${money(p.total)} — soit ${money(p.base)} pour le ${p.name} et ${money(p.print)} pour l'impression. Appuie sur 🏬 Put it in the store et ça pend dans la vitrine tout de suite.`;
  return `Welcome back! I put “${s}” on the 3D view for you. My price for it: ${money(p.total)} — that's ${money(p.base)} for the ${p.name} and ${money(p.print)} for the print. Press 🏬 Put it in the store and it hangs in the shop window right away.`;
}

// Reopen a saved design: index.html?design=<id>
const savedId = new URLSearchParams(location.search).get('design');
if (savedId && /^[a-f0-9]{10}$/.test(savedId)) {
  fetch(`/output/designs/${savedId}/meta.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Design not found'))))
    .then(async (meta) => {
      if (!catalogue) catalogue = await fetch('/api/catalogue').then((r) => r.json());
      const d = { ...meta, artwork: `/output/designs/${savedId}/artwork.png`, garment: `/output/designs/${savedId}/garment.jpg` };
      state.design = d;
      state.garmentType = d.garmentType || catalogue.garments[0];
      renderGarments();
      state.lastSpec = { prompt: d.prompt, shirtColor: d.shirtColor, placement: d.placement, summary: d.summary };
      window.__shown = true;
      if (new URLSearchParams(location.search).get('price') === '1') { // the studio loop: Yanis greets you back with the price
        addMessage('seller', priceGreeting(priceOf(d), d));
      }
      await show3D(d);
      $('summary').textContent = d.summary || '';
      for (const id of ['btnTry', 'btnPrint', 'btnAgain', 'btnPublish']) $(id).disabled = false;
      if (meta.engine === 'manual') { $('btnAgain').disabled = true; state.lastSpec = null; } // hand-made: no AI re-roll
    }).catch((e) => toast(e.message));
}
