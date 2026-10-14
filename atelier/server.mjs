// Atelier clothing store server (t-shirts, hoodies, sweatshirts… and garment types customers describe).
// Serves the web app and does all AI work server-side, so API keys never reach the browser:
//   seller chat (Gemini, free tier) · design generation (FLUX on Hugging Face) · realistic try-on (IDM-VTON, Leffa fallback)
//   · print package (300 DPI PNG, SVG, PDF spec sheet, mockups) as a zip.
import { tailorSheet, tailorPdf } from './tailor.mjs';
import * as storage from './storage.mjs';
import { limited, remaining } from './limits.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, handle_file } from '@gradio/client';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { ZipArchive } from 'archiver';
import ImageTracer from 'imagetracerjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8792);
// keys: the .env file on a computer, the project's environment variables when hosted (Vercel)
const env = {
  ...Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split('\n')
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])),
  ...process.env,
};
const GEMINI_KEY = env.GEMINI_API_KEY;

// ---------- LangSmith tracing (eu.smith.langchain.com) ----------
// Every customer request becomes one trace; each AI call inside it (Groq, Gemini, FLUX, try-on) is a child run,
// so the dashboard shows what was asked, what each model answered, timings and errors. Sent in the background:
// if LangSmith is down, the shop is unaffected.
const traceCtx = new AsyncLocalStorage();
const lsQueue = { post: [], patch: [] };
const lsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', '000Z');
function lsFlush() {
  if (!lsQueue.post.length && !lsQueue.patch.length) return;
  const body = JSON.stringify({ post: lsQueue.post.splice(0), patch: lsQueue.patch.splice(0) });
  fetch(`${env.LANGSMITH_ENDPOINT || 'https://eu.api.smith.langchain.com'}/runs/batch`, {
    method: 'POST', headers: { 'x-api-key': env.LANGSMITH_API_KEY, 'content-type': 'application/json' }, body,
  }).then((r) => { if (!r.ok) console.warn('LangSmith:', r.status); }).catch((e) => console.warn('LangSmith:', e.message));
}
if (env.LANGSMITH_API_KEY) setInterval(lsFlush, 1500).unref();
function lsSafe(v, depth = 0) { // keep traces readable: no images or huge blobs
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Buffer.isBuffer(v)) return `<binary ${v.length} bytes>`;
  if (typeof v === 'string') return v.startsWith('data:') ? `<${v.slice(5, v.indexOf(';'))} ${v.length} chars>` : v.length > 6000 ? `${v.slice(0, 6000)}…` : v;
  if (depth > 6) return '…';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => lsSafe(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lsSafe(x, depth + 1)]));
  return String(v);
}
async function traced(name, runType, inputs, fn, metadata = {}) {
  if (!env.LANGSMITH_API_KEY) return fn();
  const parent = traceCtx.getStore(), id = crypto.randomUUID(), start = new Date();
  const run = { id, trace_id: parent ? parent.trace_id : id, dotted_order: `${parent ? `${parent.dotted_order}.` : ''}${lsStamp(start)}${id}`,
    ...(parent ? { parent_run_id: parent.id } : {}) };
  lsQueue.post.push({ ...run, name, run_type: runType, inputs: lsSafe(inputs), start_time: start.toISOString(),
    session_name: env.LANGSMITH_PROJECT || 'atelier-city', extra: { metadata } });
  try {
    const out = await traceCtx.run(run, fn);
    lsQueue.patch.push({ ...run, end_time: new Date().toISOString(), outputs: lsSafe(typeof out === 'object' && out && !Buffer.isBuffer(out) ? out : { output: out }) });
    return out;
  } catch (e) {
    lsQueue.patch.push({ ...run, end_time: new Date().toISOString(), error: String(e?.message || e) });
    throw e;
  }
}
const HF_TOKEN = env.HF_TOKEN || undefined; // optional: a free Hugging Face token raises the free GPU quota
// What customers make and share, kept by storage.mjs (output/ on a computer, Vercel Blob when hosted). The shared lists
// are read at the start of every request, so every server instance sees the same store.
const docs = { 'garment-types': [], 'fashion-created': [], 'fashion-looks': [], store: [], 'studio-push': {} };
async function loadDocs() { await Promise.all(Object.keys(docs).map(async (k) => { docs[k] = await storage.getJSON(`${k}.json`, k === 'studio-push' ? {} : []); })); }
const saveDoc = (k) => storage.putJSON(`${k}.json`, docs[k]);

// ---------- catalogue ----------
export const COLORS = {
  white: { hex: '#f2f1ee', name: 'White' },
  black: { hex: '#141414', name: 'Black' },
  navy: { hex: '#1b2340', name: 'Navy blue' },
  grey: { hex: '#7d8085', name: 'Heather grey' },
  red: { hex: '#9b1c1f', name: 'Deep red' },
  green: { hex: '#2e4a36', name: 'Forest green' },
  beige: { hex: '#d8c6a5', name: 'Sand beige' },
};
// Print width in cm and distance below the collar, per placement.
const PLACEMENTS = {
  // mockupWidth is a share of the chest width (a real adult tee is ~50 cm across the chest).
  'front-center': { name: 'Front, centre', widthCm: 28, fromCollarCm: 8, mockupWidth: 0.55, mockupTop: 0.2 },
  'front-large': { name: 'Front, full', widthCm: 33, fromCollarCm: 7, mockupWidth: 0.68, mockupTop: 0.18 },
  'chest-left': { name: 'Left chest', widthCm: 10, fromCollarCm: 9, mockupWidth: 0.2, mockupTop: 0.22, offsetX: 0.22 },
  back: { name: 'Back, full', widthCm: 33, fromCollarCm: 10, mockupWidth: 0.68, mockupTop: 0.18, back: true },
};

// Garment types: recipes for the 3D garment maker (public/garments.js), which reshapes the realistic t-shirt model.
// The built-in ones, plus the types customers described and chose to publish (output/garment-types.json).
const GARMENT_OPTIONS = { sleeves: ['none', 'short', 'three-quarter', 'long'], length: ['crop', 'regular', 'long', 'dress'], neck: ['crew', 'v'],
  pocket: ['none', 'kangaroo', 'chest'], fabric: ['jersey', 'fleece', 'sport'] };
function normalizeGarment(g = {}) {
  const pick = (k, d) => (GARMENT_OPTIONS[k].includes(g[k]) ? g[k] : d);
  const clean = (v, n) => String(v || '').replace(/[<>]/g, '').trim().slice(0, n);
  return { id: /^[a-z0-9-]{2,24}$/.test(g.id) ? g.id : 'custom', name: clean(g.name, 40) || 'Custom garment',
    sleeves: pick('sleeves', 'short'), length: pick('length', 'regular'), neck: pick('neck', 'crew'), hood: g.hood === true, zip: g.zip === true,
    pocket: pick('pocket', 'none'), ribbed: g.ribbed === true, fabric: pick('fabric', 'jersey'),
    ...(g.author ? { author: clean(g.author, 30) } : {}), ...(g.note ? { note: clean(g.note, 200) } : {}) };
}
const BUILTIN_GARMENTS = [
  { id: 'tshirt', name: 'T-shirt' },
  { id: 'longsleeve', name: 'Long-sleeve tee', sleeves: 'long' },
  { id: 'tank', name: 'Tank top', sleeves: 'none' },
  { id: 'sweatshirt', name: 'Sweatshirt', sleeves: 'long', ribbed: true, fabric: 'fleece' },
  { id: 'hoodie', name: 'Hoodie', sleeves: 'long', ribbed: true, fabric: 'fleece', hood: true, pocket: 'kangaroo' },
].map(normalizeGarment);
const publishedGarments = () => (docs['garment-types'] || []).map(normalizeGarment);
const garmentTypes = () => [...BUILTIN_GARMENTS, ...publishedGarments()];
// A design's garment: a catalogue id, or a full recipe (a customer's own type, published or not).
function resolveGarment(g) {
  if (typeof g === 'string') return garmentTypes().find((t) => t.id === g) || BUILTIN_GARMENTS[0];
  return g && typeof g === 'object' ? normalizeGarment(g) : BUILTIN_GARMENTS[0];
}
// "Hoodie: long sleeves, hood with drawstrings, kangaroo pocket, ribbed cuffs and waistband, fleece"
function garmentFeatures(g) {
  return [g.sleeves === 'none' ? 'sleeveless' : `${g.sleeves.replace('-', ' ')} sleeves`, g.length !== 'regular' && (g.length === 'dress' ? 'dress length' : `${g.length} length`),
    g.neck === 'v' && 'V-neck', g.hood && 'hood with drawstrings', g.zip && 'full front zip', g.pocket !== 'none' && `${g.pocket} pocket`,
    g.ribbed && 'ribbed collar, cuffs and waistband', { jersey: 'cotton jersey', fleece: 'brushed fleece', sport: 'sport polyester' }[g.fabric]].filter(Boolean).join(', ');
}
const GARMENT_DESIGNER = `You turn a customer's description of a piece of clothing into a recipe for Atelier's 3D garment maker.
The maker builds tops and dresses from one realistic t-shirt pattern, with these options:
- sleeves: none | short | three-quarter | long
- length: crop | regular | long (tunic, below the hips) | dress (knee length, flared)
- neck: crew | v
- hood: true | false (a hood lying down, with drawstrings)
- zip: true | false (a full-length front zip)
- pocket: none | kangaroo (big front pocket, hoodie style) | chest (small patch pocket)
- ribbed: true | false (ribbed collar, cuffs and waistband, like a sweatshirt)
- fabric: jersey (t-shirt cotton) | fleece (thick and soft, sweatshirt) | sport (smooth, slightly shiny)
Choose the closest combination. If the customer asks for something the maker can't do (trousers, buttons, a shirt collar,
shoes…), get as close as you can and say what is different in "note".
Reply with ONLY one JSON object: {"name": short product name in the customer's language (max 4 words), "sleeves", "length",
"neck", "hood", "zip", "pocket", "ribbed", "fabric", "note": one short sentence in the customer's language, "" if everything was possible}`;
function lastJsonObject(text) {
  try { return JSON.parse(text); } catch {}
  const end = text.lastIndexOf('}');
  for (let i = text.lastIndexOf('{', end); i >= 0; i = text.lastIndexOf('{', i - 1)) { try { return JSON.parse(text.slice(i, end + 1)); } catch {} }
  throw new Error('The garment maker gave an unreadable answer');
}
async function describeGarment(description) {
  description = String(description || '').trim().slice(0, 400);
  if (description.length < 3) throw httpError(400, 'Describe the garment first.');
  let recipe;
  try {
    recipe = lastJsonObject(await groq([{ role: 'system', content: GARMENT_DESIGNER }, { role: 'user', content: description }], { json: true, maxTokens: 400 }));
  } catch (e) {
    console.warn('Groq garment maker failed, using Gemini:', e.message);
    recipe = await gemini({ systemInstruction: { parts: [{ text: GARMENT_DESIGNER }] }, contents: [{ role: 'user', parts: [{ text: description }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }, lastJsonObject);
  }
  return { ...normalizeGarment({ ...recipe, id: 'custom' }), description };
}
async function publishGarment({ garmentType, author }) {
  const g = normalizeGarment({ ...garmentType, author: author || garmentType?.author });
  const list = publishedGarments(), key = (t) => JSON.stringify({ ...t, id: 0, author: 0, note: 0 });
  const same = list.find((t) => key(t) === key(g));
  if (same) return { garmentType: same, garments: garmentTypes() };
  g.id = `g-${crypto.randomBytes(3).toString('hex')}`;
  delete g.note;
  docs['garment-types'] = [...list, g].slice(-60); await saveDoc('garment-types');
  return { garmentType: g, garments: garmentTypes() };
}

// ---------- MODE, the fashion store: professionally made 3D garments, combined into looks by Rin the stylist ----------
// The garments (public/models/garments, CC-BY, prepared in Blender) come in colourways; the collection and ready-made
// looks ship with the app (data/wardrobe.json); new colourways Rin creates are added to output/fashion-created.json so
// they can be found again; looks customers save go to output/fashion-looks.json.
const GARMENTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'models', 'garments', 'garments.json'), 'utf8'));
const WARDROBE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wardrobe.json'), 'utf8'));
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
function normalizePiece(p = {}) {
  const g = GARMENTS[p.asset];
  if (!g) return null;
  const clean = (v, n) => String(v || '').replace(/[<>]/g, '').trim().slice(0, n);
  const out = { asset: p.asset, slot: g.slot, name: clean(p.name, 40) || g.name,
    tags: (Array.isArray(p.tags) ? p.tags : []).map((t) => clean(t, 20).toLowerCase()).filter(Boolean).slice(0, 6) };
  if (/^[a-z0-9-]{2,32}$/.test(p.id)) out.id = p.id;
  if (g.tint && hex(p.color)) out.color = hex(p.color);
  return out;
}
const allPieces = () => [...WARDROBE.pieces, ...(docs['fashion-created'] || [])].map((p) => ({ ...p, slot: GARMENTS[p.asset]?.slot })).filter((p) => p.slot);
function fashionLibrary() { return { pieces: allPieces(), looks: WARDROBE.looks, saved: (docs['fashion-looks'] || []).slice(0, 40) }; }
const STYLIST = `You are Rin, the stylist of "MODE", a fashion store on a 3D street. Customers describe a style, an occasion, a mood or
specific clothes, and you put together a complete look, shown in 3D with real garments. No prints here, only fashion.

How you work:
1. ALWAYS search the collection first (the list below: id | name | tags). Use existing pieces whenever they fit, and say so.
2. If the customer wants a colour we don't have, create a NEW colourway of one of our garment models that can be recoloured
   (marked "recolourable" below): {"asset": model, "color": "#rrggbb", "name": short name, "tags": [2–4 style words]}.
   Pick colours real fabric is dyed in (e.g. forest green #2e4a36, sage #8a9a7b, burgundy #5a1a24, camel #b88a5a,
   cobalt #2e5fa8), never neon or pure RGB colours unless the customer asks for neon.
3. We only have the garment models listed below. If the customer asks for something else (a dress, a coat, heels, a hat…),
   say kindly that we don't have it yet and offer the closest thing we have.
4. A look has at most one piece per slot (top, outer, bottom, dress, shoes, hat, bag). A dress replaces top and bottom; a
   suit is a jacket and trousers together (no other top, outer or bottom: it already has its jacket, so never put a coat
   over it — for a winter wedding suggest a coat with smart trousers, or the suit alone). Most looks: top + bottom + shoes (or a dress +
   shoes), plus an outer layer, a hat or a bag when they help. A zip hoodie is worn open: always put a top under it.
5. Style with colour: mix at least one colourful piece into every look, and never put together an all-black outfit
   unless the customer asks for black.
6. If the customer asks to change the current look ("make the hoodie green", "other shoes"), keep the rest and change only that.
7. Reply in the customer's language (English, French, Arabic — mirror them; Darija stays Darija — and it is ALGERIAN
   Darija: حاب، راني، لازمني، تاع، وين، شنيّة، التمن، بالزربة — never Moroccan wording), warmly, in 1–3 short
   sentences. If the request is unclear, propose a look anyway.
8. If the customer wants a custom print, artwork or their own design ON a piece (their picture, a logo, a phrase on a
   t-shirt…), tell them to click ✨ Let'sDo it. — the design studio (the other site) — where they can create it themselves,
   then bring it back to you.

Reply with ONLY one JSON object: {"reply": string, "look"?: {"name": short look name in the customer's language,
"pieces": [ "existing-piece-id" OR {new colourway}, … ]}}. Leave "look" out only if you are just answering a question.`;
function libraryBrief() {
  const models = Object.entries(GARMENTS).map(([k, g]) => `${k}: ${g.name} (${g.slot}${g.tint ? ', recolourable' : ''})`).join('\n');
  const pieces = allPieces().map((p) => `${p.id} | ${p.name} | ${p.slot} | ${p.tags.join(',')}`).join('\n');
  return `GARMENT MODELS\n${models}\n\nCOLLECTION\n${pieces}\n\nREADY-MADE LOOKS\n${WARDROBE.looks.map((l) => `${l.name} (${l.tags.join(',')}): ${l.pieces.join(', ')}`).join('\n')}`;
}
function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(httpError(504, message)), ms); })]).finally(() => clearTimeout(t));
}
async function stylistReply(messages, current) {
  const context = current?.pieces?.length ? `\n\nCURRENT LOOK: ${current.name || ''}: ${current.pieces.map((p) => p.id || JSON.stringify({ asset: p.asset, color: p.color })).join(', ')}` : '';
  const system = `${STYLIST}\n\n${libraryBrief()}${context}`;
  const convo = messages.slice(-12).map((m) => ({ role: m.role === 'stylist' ? 'assistant' : 'user', content: String(m.text).slice(0, 1500) }));
  let answer;
  try {
    answer = lastJsonObject(await groq([{ role: 'system', content: system }, ...convo], { json: true, maxTokens: 1500 }));
  } catch (e) {
    console.warn('Groq stylist failed, using Gemini:', e.message);
    answer = await gemini({ systemInstruction: { parts: [{ text: system }] }, contents: convo.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } }, lastJsonObject, 30000);
  }
  if (!answer || typeof answer.reply !== 'string') throw new Error('The stylist gave an unreadable answer. Please try again.');
  if (!answer.look?.pieces?.length) return { reply: answer.reply };
  const lib = new Map(allPieces().map((p) => [p.id, p])), created = (docs['fashion-created'] || []), pieces = [];
  for (const item of answer.look.pieces.slice(0, 6)) {
    if (typeof item === 'string') { if (lib.has(item)) pieces.push({ ...lib.get(item), source: 'library' }); continue; }
    const p = normalizePiece(item);
    if (!p) continue;
    const same = [...lib.values()].find((q) => q.asset === p.asset && q.color === p.color);
    if (same) { pieces.push({ ...same, source: 'library' }); continue; }
    p.id = `n-${crypto.randomBytes(3).toString('hex')}`;
    if (!p.tags.length) p.tags = ['new'];
    created.push(p);
    pieces.push({ ...p, source: 'new' });
  }
  // one piece per slot; a suit takes the place of top, outer and bottom
  const seen = new Set(), look = [];
  for (const p of pieces.reverse()) {
    const blocks = p.slot === 'suit' ? ['suit', 'top', 'outer', 'bottom'] : p.slot === 'dress' ? ['dress', 'top', 'bottom'] : [p.slot];
    if (blocks.some((b) => seen.has(b)) || (['top', 'outer', 'bottom'].includes(p.slot) && seen.has('suit')) || (['top', 'bottom'].includes(p.slot) && seen.has('dress'))) continue;
    blocks.forEach((b) => seen.add(b)); look.unshift(p);
  }
  // a jacket worn open (a zip hoodie) needs something under it
  const outer = look.find((p) => p.slot === 'outer');
  if (outer && !GARMENTS[outer.asset]?.closed && !seen.has('top') && !seen.has('dress') && !seen.has('suit')) {
    const tee = lib.get('tee-white');
    if (tee) look.splice(look.indexOf(outer) + 1, 0, { ...tee, slot: 'top', source: 'library' });
  }
  if (created.length > (docs['fashion-created'] || []).length) { docs['fashion-created'] = created.slice(-300); await saveDoc('fashion-created'); }
  return { reply: answer.reply, look: { name: String(answer.look.name || 'Your look').slice(0, 50), pieces: look } };
}
async function publishLook({ look, title, author }) {
  const pieces = (look?.pieces || []).map((p) => normalizePiece(p)).filter(Boolean);
  if (!pieces.length) throw httpError(400, 'Nothing to save yet: ask Rin for a look first.');
  const clean = (v, n) => String(v || '').replace(/[<>]/g, '').trim().slice(0, n);
  const entry = { id: crypto.randomBytes(5).toString('hex'), title: clean(title, 40) || clean(look.name, 40) || 'My look', author: clean(author, 30) || 'Anonymous',
    pieces, published: new Date().toISOString() };
  docs['fashion-looks'] = [entry, ...(docs['fashion-looks'] || [])].slice(0, 100); await saveDoc('fashion-looks');
  return { saved: (docs['fashion-looks'] || []).slice(0, 40) };
}

// ---------- small helpers ----------
const newId = () => crypto.randomBytes(5).toString('hex');
const dirOf = (id) => {
  if (!/^[a-f0-9]{10}$/.test(id)) throw httpError(400, 'Bad design id');
  return `designs/${id}`; // its folder in storage
};
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
const spaces = new Map();
async function space(name) { // reuse connections to Hugging Face Spaces
  if (!spaces.has(name)) spaces.set(name, Client.connect(name, HF_TOKEN ? { hf_token: HF_TOKEN } : undefined));
  try { return await spaces.get(name); } catch (e) { spaces.delete(name); throw e; }
}
function friendly(e) {
  const m = String(e?.message || e);
  if (/quota|exceeded|ZeroGPU|429/i.test(m)) return 'The free AI service has reached its usage limit for now. Please try again in a few minutes.';
  if (/queue|busy|timeout/i.test(m)) return 'The free AI service is busy right now. Please try again in a moment.';
  return m.slice(0, 300);
}

// ---------- 1. the seller (Gemini) ----------
const SELLER = `You are Yanis, the friendly, stylish tailor of "Atelier", a small clothing shop in a 3D virtual world (t-shirts,
hoodies, sweatshirts, tank tops… all with custom prints).
Customers describe the print they want; you help them shape the idea, then order the design to be created.

Rules:
- Always reply in the customer's language (French, English, Arabic… mirror them). If they write in Arabic, answer in
  Arabic: Modern Standard Arabic for formal wording, Darija (Arabic script) when they write in Darija — and our customers
  speak ALGERIAN Darija (حاب، راني، لازمني، تاع، وين، شنيّة، التمن، بالزربة): answer in that same Algerian Darija, never Moroccan wording (بغيت، ديال، دوز، دغيا). Keep replies short and warm: 1–3 sentences.
- Don't make the customer wait with questions. As soon as you know the theme, design it right away (ready=true):
  use what they said, and pick good defaults for anything missing (shirt colour that suits the art, front centre).
  In your reply, say which colour and placement you chose and that they can ask to change them.
  Only ask a question first if the theme itself is unclear.
- Available shirt colours: white, black, navy, grey, red, green, beige. Placements: front centre, full front, small left chest, full back (great for big statement graphics).
- Prices are in US dollars ($): t-shirt $19.90, hoodie $44.90, sweatshirt $39.90, long-sleeve $29.90, tank top $15.90, dress $39.90 —
  the print adds $5, or $8 for full back / full front. Always quote prices with the $ sign; never dirhams or DH.
- design.prompt is an English prompt for an image AI that draws ONLY the artwork, e.g. "a golden roaring lion head, bold clean vector illustration, thick outlines".
  Never mention t-shirts, mockups, models or backgrounds in design.prompt. If the design has words, put the exact text in quotes and keep it short (max 3 words).
  Pick art colours that contrast with the shirt colour.
- If the customer asks to change the current design, keep what they liked and set ready=true with the updated prompt.
- design.summary: one short line in the customer's language describing the t-shirt.`;

const sellerSchema = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    ready: { type: 'BOOLEAN' },
    design: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING' },
        shirtColor: { type: 'STRING', enum: Object.keys(COLORS) },
        placement: { type: 'STRING', enum: Object.keys(PLACEMENTS) },
        summary: { type: 'STRING' },
        garmentId: { type: 'STRING' },
      },
      required: ['prompt', 'shirtColor', 'placement', 'summary'],
    },
  },
  required: ['reply', 'ready'],
};
// Free-tier models, tried in order. The free tier often answers "high demand" for a few seconds, so each pass
// walks the whole list and a second pass runs after a short pause.
const CHAT_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.5-flash-lite',
  'gemma-4-26b-a4b-it', 'gemma-4-31b-it']; // Gemma runs on separate capacity: the backup when every Gemini model is busy
// A model that doesn't answer within `timeoutMs` is skipped, so one stuck model can't freeze the shop.
async function gemini(body, parse, timeoutMs = 25000) {
  let lastError;
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise((r) => setTimeout(r, 2500));
    for (const model of CHAT_MODELS) {
      try {
        const text = await traced(model, 'llm', body, async () => {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST', headers: { 'x-goog-api-key': GEMINI_KEY, 'content-type': 'application/json' },
            body: JSON.stringify(model.startsWith('gemma') ? forGemma(body) : body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
          return j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        }, { ls_provider: 'google', ls_model_name: model });
        return parse(text);
      } catch (e) {
        lastError = e.name === 'TimeoutError' ? 'high demand (no answer in time)' : e.message;
        console.warn(`gemini ${model}: ${lastError.slice(0, 120)}`);
      }
    }
  }
  throw new Error(/demand|overloaded|unavailable/i.test(lastError) ? 'The seller is very busy right now (free AI is overloaded). Please try again in a moment.' : lastError);
}

// Gemma takes no system instruction or JSON schema: fold them into the first message as plain instructions.
function forGemma(body) {
  const b = structuredClone(body), cfg = b.generationConfig || {};
  const extra = [b.systemInstruction?.parts?.[0]?.text,
    cfg.responseSchema && `Reply with ONLY one JSON object matching this schema, nothing else: ${JSON.stringify(cfg.responseSchema)}`].filter(Boolean).join('\n\n');
  delete b.systemInstruction; delete cfg.responseSchema; delete cfg.responseMimeType;
  if (extra) b.contents[0].parts[0].text = `${extra}\n\n---\n\n${b.contents[0].parts[0].text}`;
  return b;
}
// The last valid JSON object in a text (Gemma may write its reasoning before the answer).
function extractJson(text) {
  try { return JSON.parse(text); } catch {}
  const end = text.lastIndexOf('}');
  for (let i = text.lastIndexOf('{', end); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    try { const v = JSON.parse(text.slice(i, end + 1)); if (v && typeof v === 'object' && 'reply' in v) return v; } catch {}
  }
  throw new Error('The seller gave an unreadable answer');
}

// Groq: very fast free inference (≈1 s). Tried first; Gemini/Gemma are the backup.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
async function groq(messages, { json = false, maxTokens = 1500 } = {}) {
  if (!env.GROQ_API_KEY) throw new Error('no Groq key');
  let lastError;
  for (const model of GROQ_MODELS) {
    try {
      return await traced(model, 'llm', { messages }, async () => {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages, max_completion_tokens: maxTokens, temperature: 0.8, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
        return j.choices[0].message.content;
      }, { ls_provider: 'groq', ls_model_name: model });
    } catch (e) { lastError = e.message; console.warn(`groq ${model}: ${lastError.slice(0, 120)}`); }
  }
  throw new Error(lastError);
}

// What the seller knows about the garments: the ones on offer and the one the customer has chosen.
function garmentBrief(current) {
  const g = resolveGarment(current);
  return `\n\nGarments on offer (garmentId: name): ${garmentTypes().map((t) => `${t.id}: ${t.name}`).join('; ')}.
The customer has currently chosen: ${g.name}${g.id === 'custom' ? ' (their own garment type)' : ''}. Say "${g.name.toLowerCase()}" rather than "t-shirt" when talking about it.
Set design.garmentId ONLY when the customer asks for a different garment than the current one; otherwise leave it out.
Customers can also describe a brand-new garment with the "+ New type" button under the 3D view.`;
}
async function sellerReply(messages, current) {
  const brief = garmentBrief(current);
  try {
    const text = await groq([
      { role: 'system', content: `${SELLER}${brief}\n\nReply with ONLY one JSON object: {"reply": string, "ready": boolean, "design"?: {"prompt": string, "shirtColor": one of ${Object.keys(COLORS).join('|')}, "placement": one of ${Object.keys(PLACEMENTS).join('|')}, "summary": string, "garmentId"?: one of ${garmentTypes().map((t) => t.id).join('|')}}}` },
      ...messages.slice(-20).map((m) => ({ role: m.role === 'seller' ? 'assistant' : 'user', content: String(m.text).slice(0, 2000) })),
    ], { json: true, maxTokens: 800 });
    const answer = extractJson(text);
    if (answer.design?.prompt) answer.design.prompt = cleanPrompt(answer.design.prompt);
    if (answer.ready && !answer.design?.prompt) answer.ready = false;
    return answer;
  } catch (e) { console.warn('Groq seller failed, using Gemini:', e.message); }
  const contents = messages.slice(-20).map((m) => ({ role: m.role === 'seller' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 2000) }] }));
  return gemini({
    systemInstruction: { parts: [{ text: SELLER + brief }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: sellerSchema, temperature: 0.8 },
  }, (text) => {
    const answer = extractJson(text);
    if (answer.design?.prompt) answer.design.prompt = cleanPrompt(answer.design.prompt);
    return answer;
  });
}
// The artwork must be drawn on white so it can be cut out cleanly; drop any background/shirt wording the seller adds.
function cleanPrompt(p) {
  const cleaned = p.replace(/,?\s*(isolated\s+)?(on|against)\s+(a\s+)?[\w\s-]*?background/gi, '')
    .replace(/,?\s*(on\s+)?(a\s+)?[\w\s-]*?(t-?shirt|mockup)\b/gi, '').replace(/\s+,/g, ',').trim();
  // the patterns above must never eat the whole request ("a golden tiger on a black t-shirt" -> keep it whole)
  return cleaned.length >= 3 ? cleaned : p.trim();
}

// ---------- 2. design generation (FLUX) ----------
async function flux(prompt, width, height, seed) {
  // A placeholder/garbage HF_TOKEN poisons the connection and hangs it (the design would then die
  // on the 190 s outer limit): go straight to the vector design instead of waiting for nothing.
  if (HF_TOKEN && !String(HF_TOKEN).startsWith('hf_')) {
    throw new Error('HF_TOKEN in atelier/.env is not a real hf_ token (see README) — drawing a vector design');
  }
  return traced('FLUX.1-schnell', 'tool', { prompt, width, height, seed },
    () => withTimeout(fluxCall(prompt, width, height, seed), 60000, 'the free image AI did not answer within 60 s'));
}
async function fluxCall(prompt, width, height, seed) {
  const c = await space('black-forest-labs/FLUX.1-schnell');
  const r = await c.predict('/infer', { prompt, seed, randomize_seed: false, width, height, num_inference_steps: 4 });
  return download(r.data[0].url);
}

// Turns the white background around the artwork into transparency (soft edge), and trims it.
async function cutOut(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.min(data[i], data[i + 1], data[i + 2]);
    if (m > 238) data[i + 3] = 0;
    else if (m > 210) data[i + 3] = Math.round((238 - m) / 28 * 255);
  }
  return sharp(data, { raw: info }).trim({ threshold: 1 }).png().toBuffer();
}

// A plain photographed shirt per colour, generated once and cached. Light shirts are shot on dark grey, dark on white,
// so the shirt's outline can be found reliably.
async function blankShirt(color) {
  const file = `blanks/${color}.png`, cached = await storage.get(file);
  if (cached) return cached;
  const light = ['white', 'beige', 'grey'].includes(color);
  const bg = light ? 'plain dark charcoal grey seamless background' : 'plain pure white seamless background';
  try {
    const png = await flux(`product photo of a plain ${COLORS[color].name.toLowerCase()} crew neck cotton t-shirt, flat lay, front view, perfectly centered, symmetrical, no print, no logo, no tag, ${bg}, soft even studio lighting`, 768, 1024, 3);
    await storage.put(file, png);
    return png;
  } catch (e) { // no GPU quota left: a drawn, shaded shirt (not cached, so the photo is fetched once quota is back)
    console.warn('Using a drawn shirt for', color, '-', e.message);
    return drawnShirt(color);
  }
}
function drawnShirt(color) {
  const hex = COLORS[color].hex, light = ['white', 'beige', 'grey'].includes(color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
    <defs><radialGradient id="s" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient></defs>
    <rect width="768" height="1024" fill="${light ? '#3a3b3e' : '#ffffff'}"/>
    <path id="t" d="M262 222 Q384 272 506 222 L640 290 L690 450 L590 485 L572 410 L572 820 Q384 840 196 820 L196 410 L178 485 L78 450 L128 290 Z" fill="${hex}"/>
    <path d="M262 222 Q384 272 506 222 L640 290 L690 450 L590 485 L572 410 L572 820 Q384 840 196 820 L196 410 L178 485 L78 450 L128 290 Z" fill="url(#s)"/>
    <path d="M300 236 Q384 300 468 236" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="10"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
// Measures the shirt in the photo: its outline, the collar, and the width of the body (chest) without the sleeves,
// so prints are sized like on a real shirt rather than against the full sleeve-to-sleeve width.
async function shirtBox(png) {
  const { data, info } = await sharp(png).resize(192, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]], W = info.width, H = info.height;
  const isShirt = (x, y) => { const i = (y * W + x) * 3; return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 45; };
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isShirt(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const meta = await sharp(png).metadata(), sx = meta.width / W, sy = meta.height / H;
  if (x1 - x0 < W * 0.3) return { x: meta.width * 0.15, y: meta.height * 0.2, w: meta.width * 0.7, h: meta.height * 0.6, cx: meta.width / 2, chest: meta.width * 0.42 };
  // Body width: measured two-thirds of the way down, below where the sleeves end.
  const row = Math.round(y0 + (y1 - y0) * 0.68);
  let bx0 = x1, bx1 = x0;
  for (let x = x0; x <= x1; x++) if (isShirt(x, row)) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); }
  return { x: x0 * sx, y: y0 * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy, cx: (bx0 + bx1) / 2 * sx, chest: (bx1 - bx0) * sx };
}

// Prints the artwork into the fabric instead of pasting it on top: the shirt's own light, folds and weave are
// carried into the ink (so creases cross the print), edges are softened like ink in cotton, and a little grain is added.
async function inkOnFabric(blank, art, left, top, w, h) {
  const meta = await sharp(blank).metadata();
  const L = clamp(left, 0, meta.width - 2), T = clamp(top, 0, meta.height - 2);
  const W = Math.min(w, meta.width - L), H = Math.min(h, meta.height - T);
  const region = await sharp(blank).extract({ left: L, top: T, width: W, height: H }).greyscale().blur(1.2).raw().toBuffer();
  let mean = 0;
  for (const v of region) mean += v;
  mean = Math.max(mean / region.length, 8);
  const ink = await sharp(art).resize(w, h).extract({ left: 0, top: 0, width: W, height: H }).ensureAlpha().raw().toBuffer();
  for (let p = 0, i = 0; p < region.length; p++, i += 4) {
    if (!ink[i + 3]) continue;
    const shade = clamp(region[p] / mean, 0.55, 1.35), grain = (Math.random() - 0.5) * 9;
    for (let c = 0; c < 3; c++) ink[i + c] = clamp(ink[i + c] * shade + grain, 0, 255);
    ink[i + 3] = Math.round(ink[i + 3] * 0.96);
  }
  const print = await sharp(ink, { raw: { width: W, height: H, channels: 4 } }).blur(0.45).png().toBuffer();
  return { input: print, left: L, top: T };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The garment photo: the artwork printed on the blank shirt (also used as the try-on input and the shop mockup).
// allOver (a studio full-texture design): the print covers the whole shirt front, not just the chest box.
async function composeGarment(art, color, placement, allOver) {
  const blank = await blankShirt(color);
  if (PLACEMENTS[placement]?.back && !allOver) return sharp(blank).jpeg({ quality: 94 }).toBuffer(); // print is on the back
  const box = await shirtBox(blank), pl = PLACEMENTS[placement];
  const meta = await sharp(art).metadata();
  let w = box.chest * (allOver ? 0.95 : pl.mockupWidth), h = w * meta.height / meta.width;
  const maxH = box.h * (allOver ? 0.8 : placement === 'chest-left' ? 0.18 : 0.5); // tall artwork is shrunk to stay on the chest
  if (h > maxH) { w *= maxH / h; h = maxH; }
  w = Math.round(w); h = Math.round(h);
  const left = Math.round(box.cx - w / 2 + (pl.offsetX || 0) * box.chest), top = Math.round(box.y + box.h * (allOver ? 0.1 : pl.mockupTop));
  const layer = await inkOnFabric(blank, art, left, top, w, h);
  return sharp(blank).composite([layer]).jpeg({ quality: 94 }).toBuffer();
}

// Fallback artist: Gemini writes the artwork as SVG vector code. Free, unlimited by GPU quota, and ideal for printing.
async function geminiSvg(prompt, shirtColor, askOverride) {
  const ask = askOverride || `Create original t-shirt print artwork as one standalone SVG file.
Subject: ${prompt}
Requirements: viewBox="0 0 1024 1024"; NO background rectangle (the shirt shows through); bold flat vector style with
clean shapes and confident outlines; 3 to 7 solid colours chosen to stand out on a ${COLORS[shirtColor].name.toLowerCase()} shirt;
rich enough detail to look professional (layered shapes, highlights, shadows as flat shapes); any text must be large,
spelled exactly as given, in a bold font (font-family="Arial Black, Impact, sans-serif"). No scripts, no external images.
Reply with only the SVG code.`;
  const clean = (text) => {
    const svg = text.match(/<svg[\s\S]*<\/svg>/i)?.[0];
    if (!svg) throw new Error('The vector artist returned no drawing');
    return svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/(xlink:)?href="(?!#)[^"]*"/gi, '');
  };
  try { // Gemini draws far better artwork; Groq is only the backup when Gemini is overloaded
    return await gemini({ contents: [{ role: 'user', parts: [{ text: ask }] }], generationConfig: { temperature: 0.9 } }, clean, 60000);
  } catch (e) { console.warn('Gemini SVG failed, using Groq:', e.message); }
  return clean(await groq([{ role: 'user', content: ask }], { maxTokens: 8000 }));
}

// Last-resort artist: no AI at all. Draws a clean typographic badge locally, so a design request
// NEVER comes back empty (FLUX, Gemini and Groq can all be unavailable at the same time).
function localSvgDesign(prompt, shirtColor) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ink = ['white', 'beige', 'grey'].includes(shirtColor) ? '#14151b' : '#ffffff';
  const words = String(prompt).replace(/[^a-zA-Z0-9 ']/g, ' ').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  for (const w of words) { // wrap the words into short lines that fit inside the badge
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= 9) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
    if (lines.length === 3) break;
  }
  const text = (lines.length ? lines : ['YOUR', 'DESIGN']).map((l, i) => {
    const size = Math.round(Math.min(96, 620 / (l.length * 0.72))); // shrink long words so nothing overflows
    return `<text x="512" y="${480 + i * 118}" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="${size}" fill="${ink}" text-anchor="middle">${esc(l.toUpperCase())}</text>`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <circle cx="512" cy="512" r="430" fill="none" stroke="${ink}" stroke-width="26"/>
  <circle cx="512" cy="512" r="386" fill="none" stroke="${ink}" stroke-width="6"/>
  <path d="M512 150 l30 70 76 7 -58 51 17 75 -65 -40 -65 40 17 -75 -58 -51 76 -7z" fill="${ink}"/>
  ${text}
  <rect x="352" y="${480 + Math.max(lines.length, 2) * 118 - 34}" width="320" height="14" fill="${ink}"/>
</svg>`;
}

// Artwork only, nothing saved: the studio's AI tab (the other site) asks for a picture when the
// free image APIs are quota-blocked. Same vector chain as createDesign; always answers.
// background = #RRGGBB composites the art onto a solid fabric colour (full-bleed textile use).
async function createArtwork(prompt, background) {
  const solid = /^#[0-9a-f]{6}$/i.test(String(background || ''));
  // Textile callers (the studio's AI tab) need a full-bleed repeating fabric pattern,
  // not a print floating on transparency — so they get their own brief.
  const ask = solid ? `Create a seamless repeating textile pattern as one standalone SVG file.
Subject: ${prompt}
Requirements: viewBox="0 0 1024 1024"; fill the ENTIRE canvas edge-to-edge — solid background colour ${background} under the motifs, nothing transparent; bold flat vector style, 3 to 7 solid colours; medium-scale motifs with deliberate breathing room and edges that match so the pattern tiles; any text must be large, spelled exactly as given, in a bold font (font-family="Arial Black, Impact, sans-serif"). No scripts, no external images.
Reply with only the SVG code.` : null;
  let svg, engine = 'Gemini vector';
  try { svg = await geminiSvg(prompt, 'white', ask); }
  catch (e) {
    console.warn('Gemini SVG unavailable for /api/art, drawing the local design instead:', e.message);
    svg = localSvgDesign(prompt, 'white');
    engine = 'Local design';
  }
  let art = await sharp(Buffer.from(svg), { density: 200 }).resize(1024, 1024, { fit: solid ? 'fill' : 'inside' }).png().toBuffer();
  if (solid) art = await sharp({ create: { width: 1024, height: 1024, channels: 4, background } }).composite([{ input: art }]).png().toBuffer();
  else art = await sharp(art).trim({ threshold: 1 }).png().toBuffer();
  return { artwork: `data:image/png;base64,${art.toString('base64')}`, engine };
}

async function createDesign({ prompt, shirtColor, placement, summary, garmentId, garmentType: chosen }) {
  // the seller names a catalogue garment only when the customer asked for another one; else the customer's choice stands
  const garmentType = resolveGarment(garmentTypes().some((t) => t.id === garmentId) ? garmentId : chosen);
  if (!COLORS[shirtColor]) shirtColor = 'black';
  if (!PLACEMENTS[placement]) placement = 'front-center';
  prompt = cleanPrompt(String(prompt));
  const id = newId(), dir = `designs/${id}`;
  const seed = Math.floor(Math.random() * 1e6);
  let art, engine;
  try { // photo-quality illustration first...
    const raw = await flux(`${prompt}, t-shirt print artwork, bold clean illustration, crisp edges, centered, isolated on a pure white background, no shirt, no mockup, no frame, no watermark`, 1024, 1024, seed);
    await storage.put(`${dir}/artwork-raw.png`, raw);
    art = await cutOut(raw);
    engine = 'FLUX';
  } catch (e) { // ...vector artwork if the free GPU quota is used up
    console.warn('FLUX unavailable, drawing a vector design instead:', e.message);
    let svg, via = 'Gemini vector';
    try { svg = await geminiSvg(prompt, shirtColor); }
    catch (e2) { // even the AI artists are down or overloaded: draw the badge locally, never fail the design
      console.warn('AI artists unavailable, drawing the local design instead:', e2.message);
      svg = localSvgDesign(prompt, shirtColor);
      via = 'Local design';
    }
    await storage.put(`${dir}/artwork.svg`, svg);
    art = await sharp(Buffer.from(svg), { density: 200 }).resize(1024, 1024, { fit: 'inside' }).png().toBuffer();
    art = await sharp(art).trim({ threshold: 1 }).png().toBuffer();
    engine = via;
  }
  const garment = await composeGarment(art, shirtColor, placement);
  await storage.put(`${dir}/artwork.png`, art);
  await storage.put(`${dir}/garment.jpg`, garment);
  const meta = { id, prompt, shirtColor, placement, summary, garmentType, seed, engine, created: new Date().toISOString() };
  await storage.put(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
  return { ...meta, artwork: `/output/designs/${id}/artwork.png`, garment: `/output/designs/${id}/garment.jpg` };
}

// Customer-made designs ("Design it yourself"): the browser sends the finished print artwork (transparent PNG whose
// canvas is the print area, so the customer's positioning is kept).
async function createManualDesign({ artwork, shirtColor, placement, summary, garmentType, allOver }) {
  if (!COLORS[shirtColor]) shirtColor = 'white';
  if (!PLACEMENTS[placement]) placement = 'front-center';
  const png = Buffer.from(String(artwork || '').replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (png.length < 500) throw httpError(400, 'The design is empty — add an image or some text first.');
  const art = await sharp(png).ensureAlpha().resize(1024, 1280, { fit: 'inside' }).png().toBuffer();
  const { channels } = await sharp(art).stats();
  if (channels[3]?.max === 0) throw httpError(400, 'The design is empty — add an image or some text first.');
  const id = newId(), dir = `designs/${id}`;
  await storage.put(`${dir}/artwork.png`, art);
  await storage.put(`${dir}/garment.jpg`, await composeGarment(art, shirtColor, placement, allOver));
  const meta = { id, prompt: 'customer design', shirtColor, placement, summary: String(summary || 'Custom design').slice(0, 120),
    garmentType: resolveGarment(garmentType), engine: 'manual', ...(allOver ? { allOver: true } : {}), created: new Date().toISOString() };
  await storage.put(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
  return { ...meta, artwork: `/output/designs/${id}/artwork.png`, garment: `/output/designs/${id}/garment.jpg` };
}

// Put a design on another garment (the print stays the same). Designs in the store are locked: they never change,
// so trying one on another garment makes a copy (e.g. the official Thirduni tee always stays a t-shirt).
const isPublished = (id) => (docs.store || []).some((e) => e.id === id);
async function setGarmentType({ id, garmentType }) {
  let dir = dirOf(id);
  let meta = await storage.getJSON(`${dir}/meta.json`);
  if (!meta) throw httpError(404, 'Design not found');
  if (isPublished(id)) {
    const copy = newId(), copyDir = `designs/${copy}`;
    for (const f of ['artwork.png', 'artwork.svg', 'garment.jpg']) { const b = await storage.get(`${dir}/${f}`); if (b) await storage.put(`${copyDir}/${f}`, b); }
    meta = { ...meta, id: copy, copiedFrom: id, created: new Date().toISOString() };
    id = copy; dir = copyDir;
  }
  meta.garmentType = resolveGarment(garmentType);
  await storage.put(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
  return { ...meta, artwork: `/output/designs/${id}/artwork.png`, garment: `/output/designs/${id}/garment.jpg` };
}

// ---------- the store: designs customers chose to publish (shown on the boutique walls) ----------
async function storeList() {
  const rows = await Promise.all((docs.store || []).map(async (e) => {
    const meta = await storage.getJSON(`designs/${e.id}/meta.json`);
    return meta && { ...e, shirtColor: meta.shirtColor, color: COLORS[meta.shirtColor]?.hex, placement: meta.placement, garmentType: resolveGarment(meta.garmentType),
      allOver: !!meta.allOver, artwork: `/output/designs/${e.id}/artwork.png` };
  }));
  return rows.filter(Boolean);
}
async function publish({ id, title, author }) {
  dirOf(id);
  if (!(await storage.exists(`designs/${id}/meta.json`))) throw httpError(404, 'Design not found');
  const clean = (v, n) => String(v || '').replace(/[<>]/g, '').trim().slice(0, n);
  const list = (docs.store || []).filter((e) => e.id !== id);
  list.unshift({ id, title: clean(title, 40) || 'Untitled', author: clean(author, 30) || 'Anonymous', published: new Date().toISOString() });
  docs.store = list.slice(0, 200); await saveDoc('store');
  return storeList();
}

// The studio's "Give to customer" (site 1) lands here: saved AND published in one step, with a
// stable key, so pushing the same design history again never fills the walls with duplicates —
// every design the customer made in the studio hangs on the boutique walls, not only the last.
async function studioPush({ artwork, shirtColor, placement, summary, garmentType, allOver, key, title, author }) {
  const map = docs['studio-push'] && !Array.isArray(docs['studio-push']) ? docs['studio-push'] : (docs['studio-push'] = {});
  if (key && map[key]) return { id: map[key], duplicate: true };
  const created = await createManualDesign({ artwork, shirtColor, placement, summary, garmentType, allOver });
  await publish({ id: created.id, title, author });
  if (key) {
    map[key] = created.id;
    const keys = Object.keys(map);
    if (keys.length > 200) delete map[keys[0]]; // the oldest key: its design stays, only the memory of it goes
    await saveDoc('studio-push');
  }
  return created;
}

// ---------- 3. realistic try-on ----------
async function tryOn(id, photoDataUrl, garmentDataUrl) {
  const dir = dirOf(id), meta = (await storage.getJSON(`${dir}/meta.json`));
  const photo = Buffer.from(String(photoDataUrl).replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (photo.length < 1000) throw httpError(400, 'No photo received');
  // Full-resolution original (kept for the final picture) and the 768x1024 copy the try-on AI works on.
  const original = await sharp(photo).rotate().resize(1536, 2048, { fit: 'cover', position: 'centre', withoutEnlargement: true }).jpeg({ quality: 95 }).toBuffer();
  const person = await sharp(original).resize(768, 1024, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer();
  // Prefer the 3D shirt render (real folds, print in the fabric) over the photo mockup.
  const garment = garmentDataUrl
    ? await sharp(Buffer.from(String(garmentDataUrl).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      .resize(768, 1024, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).jpeg({ quality: 94 }).toBuffer()
    : (await storage.get(`${dir}/garment.jpg`));
  const stamp = Date.now();
  // Hosted, the storage is public: a customer's photo (their face) is never kept there.
  if (!storage.usesBlob) await storage.put(`${dir}/person-${stamp}.jpg`, person);
  const g = resolveGarment(meta.garmentType);
  const desc = `${COLORS[meta.shirtColor].name.toLowerCase()} ${g.name.toLowerCase()} (${garmentFeatures(g)}) with a printed graphic`;
  // Free cloud try-on models: FitDiT (newest, sharper) first, then IDM-VTON.
  let result, engine, lastErr, clothMask = null;
  try {
    ({ image: result, mask: clothMask } = await fitDiT(original, garment, g.length === 'dress' ? 'Dresses' : 'Upper-body')); engine = 'FitDiT';
  } catch (e1) {
    lastErr = e1;
    console.warn('FitDiT failed:', String(e1.message).slice(0, 160));
    try {
      const r = await traced('IDM-VTON try-on', 'tool', { person, garment }, async () => (await space('yisol/IDM-VTON')).predict('/tryon', {
        dict: { background: handle_file(new Blob([person])), layers: [], composite: null },
        garm_img: handle_file(new Blob([garment])), garment_des: desc,
        is_checked: true, is_checked_crop: false, denoise_steps: 40, seed: 42,
      }));
      result = await download(r.data[0].url); engine = 'IDM-VTON';
      // Its second image shows the replaced area painted grey: turn that into the clothing mask.
      try {
        const { data, info } = await sharp(await download(r.data[1].url)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const src = await sharp(person).resize(info.width, info.height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
        const m = Buffer.alloc(info.width * info.height);
        for (let p = 0, i = 0; p < m.length; p++, i += 3) {
          const grey = Math.abs(data[i] - 128) < 14 && Math.abs(data[i + 1] - 128) < 14 && Math.abs(data[i + 2] - 128) < 14;
          // grey AND different from the original photo: a grey wall behind the person is not part of the mask
          const changed = Math.abs(src[i] - data[i]) + Math.abs(src[i + 1] - data[i + 1]) + Math.abs(src[i + 2] - data[i + 2]) > 30;
          if (grey && changed) m[p] = 255;
        }
        const near = await sharp(m, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(info.width / 40).threshold(25).extractChannel(0).raw().toBuffer();
        for (let p = 0, i = 0; p < m.length; p++, i += 3) {
          const grey = Math.abs(data[i] - 128) < 14 && Math.abs(data[i + 1] - 128) < 14 && Math.abs(data[i + 2] - 128) < 14;
          if (grey && near[p]) m[p] = 255; // grey right next to the garment is garment too (shadows of the old shirt)
        }
        clothMask = await sharp(m, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
      } catch (e) { console.warn('IDM-VTON mask unreadable:', e.message); }
    } catch (e2) { lastErr = e2; console.warn('IDM-VTON failed:', String(e2.message).slice(0, 160)); }
  }
  if (!result) {
    throw httpError(503, /quota|exceeded|ZeroGPU/i.test(String(lastErr?.message))
      ? "Today's free realistic photos are used up. The free limit resets every day — please try again tomorrow. (The 3D view and quick camera preview still work.)"
      : friendly(lastErr));
  }
  const out = `tryon-${stamp}.jpg`;
  let final = await keepOriginalSharp(original, result, clothMask);
  try { final = await reprint(final, (await storage.get(`${dir}/artwork.png`)), COLORS[meta.shirtColor].hex, clothMask) || final; }
  catch (e) { console.warn('re-print skipped:', e.message); }
  const jpg = await sharp(final).jpeg({ quality: 94 }).toBuffer();
  if (storage.usesBlob) return { url: `data:image/jpeg;base64,${jpg.toString('base64')}`, engine };   // straight back to the customer only
  await storage.put(`${dir}/${out}`, jpg);
  return { url: `/output/designs/${id}/${out}`, engine };
}

// FitDiT: first finds the clothing area on the person (also kept as a mask for the Mac fallback), then dresses them
// at 1152x1536.
async function fitDiT(original, garment, category = 'Upper-body') {
  return traced('FitDiT try-on', 'tool', { person: original, garment, category }, () => fitDiTCall(original, garment, category));
}
async function fitDiTCall(original, garment, category) {
  const c = await space('BoyuanJiang/FitDiT');
  const person = await sharp(original).resize(1152, 1536, { fit: 'cover' }).jpeg({ quality: 94 }).toBuffer();
  const m = await c.predict('/generate_mask', { vton_img: handle_file(new Blob([person])), category, offset_top: 0, offset_bottom: 0, offset_left: 0, offset_right: 0 });
  let mask = null;
  try { // the mask layer of the editor value: painted pixels = clothing area
    const layer = m.data[0]?.layers?.[0];
    if (layer?.url) {
      const { data, info } = await sharp(await download(layer.url)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const out = Buffer.alloc(info.width * info.height);
      for (let p = 0; p < out.length; p++) out[p] = data[p * 4 + 3] > 20 ? 255 : 0;
      mask = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
    }
  } catch (e) { console.warn('FitDiT mask unreadable:', e.message); }
  try {
    let r;
    for (const resolution of ['1152x1536', '768x1024']) {
      try {
        r = await c.predict('/process', { vton_img: handle_file(new Blob([person])), garm_img: handle_file(new Blob([garment])), pre_mask: m.data[0], pose_image: m.data[1], n_steps: 20, image_scale: 2, seed: 42, num_images_per_prompt: 1, resolution });
        break;
      } catch (e) { if (!/choices|resolution/i.test(e.message) || resolution === '768x1024') throw e; }
    }
    const item = r.data[0][0];
    return { image: await download(item.image?.url || item.url), mask };
  } catch (e) { e.mask = mask; throw e; }
}

// The try-on AI redraws the whole photo at 768x1024, softening the face. Keep the customer's original, sharp
// photo everywhere except where the AI actually changed something (the new t-shirt), blended with a soft edge.
// clothMask (optional): the try-on AI's own map of where the clothes are. When given, only that area (slightly grown)
// is taken from the AI, so a repainted background or face can never leak in.
async function keepOriginalSharp(original, result, clothMask) {
  const { width: W, height: H } = await sharp(original).metadata();
  const up = await sharp(result).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const orig = await sharp(original).removeAlpha().raw().toBuffer();
  let grown;
  if (clothMask) {
    grown = await sharp(clothMask).resize(W, H, { fit: 'fill' }).greyscale().blur(Math.max(4, W / 90)).threshold(20)
      .extractChannel(0).raw().toBuffer();
  } else {
    const a = await sharp(up, { raw: { width: W, height: H, channels: 3 } }).blur(3).raw().toBuffer();
    const b = await sharp(orig, { raw: { width: W, height: H, channels: 3 } }).blur(3).raw().toBuffer();
    const diff = Buffer.alloc(W * H);
    let changed = 0;
    for (let i = 0, p = 0; p < diff.length; p++, i += 3) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 36) { diff[p] = 255; changed++; }
    }
    // If the AI changed most of the picture (e.g. relit it), a cut-out would look wrong: use its image as it is.
    if (changed > diff.length * 0.6) return sharp(up, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    // Close small gaps, then fill every enclosed hole (e.g. white parts of the print that happen to match the old shirt),
    // so the whole new t-shirt is used; then feather the edge.
    grown = await sharp(diff, { raw: { width: W, height: H, channels: 1 } }).blur(14).threshold(30).extractChannel(0).raw().toBuffer();
    fillHoles(grown, W, H);
  }
  const mask = await sharp(grown, { raw: { width: W, height: H, channels: 1 } }).blur(4).extractChannel(0).raw().toBuffer();
  const out = Buffer.alloc(W * H * 3);
  for (let p = 0, i = 0; p < mask.length; p++, i += 3) {
    const m = mask[p] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = orig[i + c] * (1 - m) + up[i + c] * m;
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

// Try-on AIs redraw prints from memory, so text comes out garbled. Find where the print landed on the shirt and put
// the exact original artwork there, shaded by the fabric's own light. Skipped when the print can't be found clearly.
async function reprint(image, artPng, shirtHex, clothMask) {
  if (!clothMask) return null;
  const { width: W, height: H } = await sharp(image).metadata();
  const img = await sharp(image).removeAlpha().raw().toBuffer();
  const mask = await sharp(clothMask).resize(W, H, { fit: 'fill' }).greyscale().extractChannel(0).raw().toBuffer();
  const s = new THREE_Color(shirtHex);
  const isSkin = (r, g, b) => r > 95 && r > g && g > b && r - b > 35 && Math.abs(r - g) > 12;
  // only pixels that look like the artwork's own colours (and clearly not the shirt) count as the printed design
  const palette = (await mainColors(artPng, 6)).map(THREE_Color)
    .filter((c) => Math.abs(c.r - s.r) + Math.abs(c.g - s.g) + Math.abs(c.b - s.b) > 120);
  if (!palette.length) { console.warn('re-print: no artwork colour differs from the shirt'); return null; }
  const printPx = new Uint8Array(W * H);
  const xs = [], ys = [];
  for (let p = 0, i = 0; p < W * H; p++, i += 3) {
    if (mask[p] < 128) continue;
    const r = img[i], g = img[i + 1], b = img[i + 2];
    if (isSkin(r, g, b)) continue;
    if (palette.some((c) => Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b) < 120)) { printPx[p] = 1; xs.push(p % W); ys.push((p / W) | 0); }
  }
  if (xs.length < W * H * 0.002) { console.warn(`re-print: print not found (${xs.length} px)`); return null; }
  // Keep only the biggest cluster of print pixels (the design block), ignoring scattered bright spots elsewhere:
  // join nearby pixels on a coarse grid, then flood-fill the grid and pick the cluster holding the most print pixels.
  const G = Math.max(4, Math.round(W / 120)), gw = Math.ceil(W / G), gh = Math.ceil(H / G);
  const cell = new Uint16Array(gw * gh);
  for (let k = 0; k < xs.length; k++) cell[((ys[k] / G) | 0) * gw + ((xs[k] / G) | 0)]++;
  const on = (c) => cell[c] > G * G * 0.04;
  const comp = new Int32Array(gw * gh).fill(-1), sizes = [];
  for (let c = 0; c < gw * gh; c++) {
    if (!on(c) || comp[c] >= 0) continue;
    const id = sizes.length, stack = [c]; comp[c] = id; let total = 0;
    while (stack.length) {
      const k = stack.pop(), cx0 = k % gw, cy0 = (k / gw) | 0; total += cell[k];
      for (let dy = -6; dy <= 6; dy++) for (let dx = -3; dx <= 3; dx++) { // gaps between letters, and between a logo and its text lines, still join
        const nx = cx0 + dx, ny = cy0 + dy, n = ny * gw + nx;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && on(n) && comp[n] < 0) { comp[n] = id; stack.push(n); }
      }
    }
    sizes.push(total);
  }
  if (!sizes.length) return null;
  const best = sizes.indexOf(Math.max(...sizes));
  const q = (a, f) => { const t = Float64Array.from(a).sort(); return t[Math.floor(f * (t.length - 1))]; };
  const boxOf = (id) => { const bx = [], by = [];
    for (let k = 0; k < xs.length; k++) if (comp[((ys[k] / G) | 0) * gw + ((xs[k] / G) | 0)] === id) { bx.push(xs[k]); by.push(ys[k]); }
    return bx.length ? { x0: q(bx, 0.01), x1: q(bx, 0.99), y0: q(by, 0.01), y1: q(by, 0.99), n: bx.length } : null; };
  // a design is often a big word plus smaller lines (tagline, year) the AI drew apart: add the clusters stacked under or over it
  const main = boxOf(best);
  let { x0, x1, y0, y1 } = main;
  for (let id = 0; id < sizes.length; id++) {
    if (id === best || sizes[id] < sizes[best] * 0.03) continue;
    const b = boxOf(id), cx = (b.x0 + b.x1) / 2;
    if (cx < main.x0 || cx > main.x1 || b.x1 - b.x0 > (main.x1 - main.x0) * 1.1) continue;
    if (b.y0 > y1 + (main.x1 - main.x0) * 0.6 || b.y1 < y0 - (main.x1 - main.x0) * 0.6) continue;
    y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1);
  }
  // the artwork's own content box (inside its transparent print area)
  const art = await sharp(artPng).trim({ threshold: 1 }).png().toBuffer();
  const am = await sharp(art).metadata();
  const bw = x1 - x0, bh = y1 - y0, ratio = (bw / bh) / (am.width / am.height);
  console.warn(`re-print: box ${bw}x${bh}, aspect vs artwork ${ratio.toFixed(2)}, palette ${JSON.stringify(palette)}`);
  if (bw < 20 || bh < 10 || ratio < 0.4 || ratio > 2.5) return null; // print not found clearly: keep the AI's version
  // fit the artwork's aspect inside the found box, centred
  let w = bw, h = bw * am.height / am.width;
  if (h > bh * 1.6) { h = bh * 1.6; w = h * am.width / am.height; }
  const cx = (x0 + x1) / 2, cy = h > bh ? y0 + h / 2 : (y0 + y1) / 2; // a found box shorter than the art: its top is the art's top
  const ey0 = y0, ey1 = y1, ex0 = x0, ex1 = x1;
  x0 = Math.round(cx - w / 2); y0 = Math.round(cy - h / 2); w = Math.round(w); h = Math.round(h);
  // fabric light: brightness of the shirt around each point (print pixels excluded), relative to its median
  const lum = new Float32Array(W * H), wgt = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 3) if (mask[p] >= 128 && !printPx[p]) { lum[p] = (img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11); wgt[p] = 1; }
  const blurF = async (arr) => sharp(Buffer.from(Uint8Array.from(arr, (v) => Math.min(255, v))), { raw: { width: W, height: H, channels: 1 } }).blur(Math.max(6, W / 80)).extractChannel(0).raw().toBuffer();
  const [lumB, wB] = await Promise.all([blurF(lum.map((v) => v)), blurF(wgt.map((v) => v * 255))]);
  const local = (p) => (wB[p] > 8 ? lumB[p] * 255 / wB[p] : 0);
  const shirtL = Math.max(8, s.r * 0.3 + s.g * 0.59 + s.b * 0.11);
  // 1. erase the garbled print: paint those pixels back to shirt colour with the local fabric light
  const out = Buffer.from(img);
  const pad = Math.round(W / 60);
  const ry0 = Math.max(0, Math.min(ey0, y0) - pad), ry1 = Math.min(H, Math.max(ey1, y0 + h) + pad);
  const rx0 = Math.max(0, Math.min(ex0, x0) - pad), rx1 = Math.min(W, Math.max(ex1, x0 + w) + pad);
  const erase = new Uint8Array(W * H);
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const p = y * W + x, i = p * 3;
    if (mask[p] < 128 || isSkin(img[i], img[i + 1], img[i + 2])) continue;
    const L = img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11, f = local(p);
    if (printPx[p] || Math.abs(L - f) > Math.max(22, f * 0.35)) for (let d = -2; d <= 2; d++) { erase[p + d] = 1; erase[p + d * W] = 1; }
  }
  // the fabric's own colour around each erased pixel (old print excluded), so the patch blends into the folds
  const chan = [0, 1, 2].map(() => new Float32Array(W * H)), cw = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 3) if (mask[p] >= 128 && !erase[p] && !printPx[p]) { cw[p] = 255; for (let c = 0; c < 3; c++) chan[c][p] = img[i + c]; }
  const [cr, cg, cb, cwB] = await Promise.all([...chan, cw].map(blurF));
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    const p = y * W + x, i = p * 3;
    if (!erase[p] || mask[p] < 128 || isSkin(img[i], img[i + 1], img[i + 2])) continue;
    if (cwB[p] > 8) { const n = 255 / cwB[p]; out[i] = Math.min(255, cr[p] * n); out[i + 1] = Math.min(255, cg[p] * n); out[i + 2] = Math.min(255, cb[p] * n); }
    else { const k = Math.min(1.6, Math.max(0.4, local(p) / shirtL || 1)); out[i] = Math.min(255, s.r * k); out[i + 1] = Math.min(255, s.g * k); out[i + 2] = Math.min(255, s.b * k); }
  }
  // 2. print the real artwork, shaded by the same fabric light, never over skin (arms in front of the shirt)
  const { data: a } = await sharp(art).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const p = Y * W + X, i = p * 3, j = (y * w + x) * 4, al = a[j + 3] / 255 * 0.97;
    if (!al || mask[p] < 128 || isSkin(img[i], img[i + 1], img[i + 2])) continue;
    const k = Math.min(1.25, Math.max(0.55, local(p) / shirtL || 1));
    for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - al) + Math.min(255, a[j + c] * k) * al;
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}
function THREE_Color(hex) { const n = parseInt(hex.slice(1), 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 }; }

// Any background region not connected to the image border is a hole inside the mask: fill it.
function fillHoles(mask, W, H) {
  const outside = new Uint8Array(W * H), queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  const push = (p) => { if (!outside[p] && mask[p] < 128) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < W * (H - 1)) push(p + W);
  }
  for (let p = 0; p < mask.length; p++) if (!outside[p]) mask[p] = 255;
}

// ---------- 4. print package ----------
async function mainColors(art, n = 6) { // most common opaque colours, for the spec sheet
  const { data } = await sharp(art).resize(80, 80, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    const c = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += data[i]; c.g += data[i + 1]; c.b += data[i + 2];
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, n)
    .map((c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v / c.n).toString(16).padStart(2, '0')).join(''));
}
async function printPng(art, placement) { // 4500 x 5400 px = 38 x 45.7 cm at 300 DPI, artwork at its real print width
  const pl = PLACEMENTS[placement], meta = await sharp(art).metadata();
  const w = Math.round(pl.widthCm / 2.54 * 300), h = Math.round(w * meta.height / meta.width);
  const fit = Math.min(1, 5100 / h), W = Math.round(w * fit), H = Math.round(h * fit);
  const scaled = await sharp(art).resize(W, H, { kernel: 'lanczos3' }).toBuffer();
  return sharp({ create: { width: 4500, height: 5400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, left: Math.round((4500 - W) / 2), top: 150 }])
    .withMetadata({ density: 300 }).png({ compressionLevel: 9 }).toBuffer();
}
async function vectorSvg(art) {
  const { data, info } = await sharp(art).resize(900, 900, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return ImageTracer.imagedataToSVG({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
    { numberofcolors: 12, ltres: 0.5, qtres: 0.5, pathomit: 6, strokewidth: 0, viewbox: true, linefilter: true });
}
function specPdf({ meta, art, garment, tryon, colors, printSize }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 }), chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)));
    const pl = PLACEMENTS[meta.placement], col = COLORS[meta.shirtColor];
    doc.fontSize(22).font('Helvetica-Bold').text('ATELIER — Print order', { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(`Order ${meta.id}  ·  ${new Date(meta.created).toLocaleString('en-GB')}`).moveDown(0.6);
    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text('Product');
    const g = resolveGarment(meta.garmentType);
    doc.font('Helvetica').text(`${g.name} — ${col.name} (${col.hex})`).text(`Garment: ${garmentFeatures(g)}`);
    if (meta.summary) doc.text(`Description: ${meta.summary}`);
    doc.moveDown(0.5).font('Helvetica-Bold').text('Print');
    doc.font('Helvetica').text(`Placement: ${pl.name}`)
      .text(`Print size: ${printSize.wCm} cm wide × ${printSize.hCm} cm high`)
      .text(`Position: ${pl.back ? 'on the BACK, ' : ''}centred, top of print ${pl.fromCollarCm} cm below the ${pl.back ? 'back ' : ''}collar seam${pl.offsetX ? ' (wearer\'s left chest)' : ''}`)
      .text('Method: DTG or DTF (full colour). Use design-print.png (300 DPI, transparent background).')
      .text('Screen print / vinyl / embroidery: use design-vector.svg (vector version).');
    doc.moveDown(0.5).font('Helvetica-Bold').text('Main ink colours');
    const y = doc.y + 4;
    colors.forEach((c, i) => {
      doc.rect(40 + i * 82, y, 22, 22).fill(c).stroke();
      doc.fillColor('#000').fontSize(9).font('Helvetica').text(c, 66 + i * 82, y + 7);
    });
    doc.fontSize(12);
    const imgTop = y + 40;
    doc.rect(40, imgTop, 160, 160).fill(col.hex); // on the shirt's own colour, so light inks stay visible
    doc.image(art, 45, imgTop + 5, { fit: [150, 150], align: 'center', valign: 'center' });
    doc.image(garment, 215, imgTop, { fit: [150, 200] });
    if (tryon) doc.image(tryon, 380, imgTop, { fit: [150, 200] });
    doc.fillColor('#555').fontSize(9)
      .text('Artwork', 40, imgTop + 205).text('Mockup', 215, imgTop + 205);
    if (tryon) doc.text('Customer try-on', 380, imgTop + 205);
    doc.end();
  });
}
async function printPackage(id, res) {
  const dir = dirOf(id), meta = await storage.getJSON(`${dir}/meta.json`);
  if (!meta) throw httpError(404, 'Design not found');
  const art = await storage.get(`${dir}/artwork.png`), garment = (await storage.get(`${dir}/mockup-3d.jpg`)) || (await storage.get(`${dir}/garment.jpg`));
  const tryons = (await storage.list(`${dir}/`)).filter((f) => f.startsWith('tryon-')).sort();
  const tryon = tryons.length ? await storage.get(`${dir}/${tryons.at(-1)}`) : null;
  const svgOriginal = await storage.get(`${dir}/artwork.svg`); // designs drawn as vectors keep their original, perfect SVG
  const place = meta.allOver ? 'front-large' : meta.placement; // an all-over design prints at the full front width
  const [png, svg, colors, artMeta] = await Promise.all([printPng(art, place),
    svgOriginal ? svgOriginal.toString('utf8') : vectorSvg(art), mainColors(art), sharp(art).metadata()]);
  const wCm = PLACEMENTS[place].widthCm, hCm = Math.round(wCm * artMeta.height / artMeta.width * 10) / 10;
  const pdf = await specPdf({ meta: { ...meta, placement: place }, art, garment, tryon, colors, printSize: { wCm, hCm } });
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="atelier-${id}.zip"` });
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.pipe(res);
  zip.append(png, { name: 'design-print.png' });
  zip.append(svg, { name: 'design-vector.svg' });
  zip.append(pdf, { name: 'spec-sheet.pdf' });
  zip.append(garment, { name: 'mockup.jpg' });
  if (tryon) zip.append(tryon, { name: 'try-on.jpg' });
  zip.append(`ATELIER print order ${id}\n\nSend this whole folder to the print shop.\n- design-print.png : print file, 300 DPI, transparent background (DTG / DTF)\n- design-vector.svg : vector version (screen print, vinyl, embroidery)\n- spec-sheet.pdf : garment, colour, placement, size and ink colours\n- mockup.jpg / try-on.jpg : how it should look\n`, { name: 'README.txt' });
  await zip.finalize();
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream' };
async function readJson(req, limit = 15e6) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw httpError(413, 'Upload too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError(400, 'Invalid JSON'); }
}
function sendJson(res, status, obj) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
function serveFile(req, res, base, rel) { // the app's own files, when it runs on a computer (Vercel serves them itself)
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  const ext = path.extname(file).toLowerCase();
  // pages/scripts always revalidate (304 when unchanged, so fresh code shows up); models and pictures can sit in cache
  const cache = (ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css') ? 'no-cache' : 'public, max-age=300';
  return storage.sendCached(req, res, file, MIME[ext] || 'application/octet-stream', cache);
}

// The whole app as one request handler: run by the local server below, or as a Vercel function (api/index.mjs).
export async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (process.env.VERCEL && url.pathname === '/api/index' && url.searchParams.has('path')) { // Vercel: the original path rides along
    url.pathname = `/${url.searchParams.get('path')}`; url.searchParams.delete('path');
  }
  try {
    if (url.pathname.startsWith('/api/')) await loadDocs();
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const { messages = [], garmentType } = await readJson(req);
      const answer = await limited(req, 'chat', () => traced('Yanis chat', 'chain', { messages, garmentType }, () =>
        withTimeout(sellerReply(messages, garmentType), 70000, 'Yanis is taking too long (the free AI is busy). Please send your message again.')));
      return sendJson(res, 200, answer);
    }
    if (req.method === 'POST' && url.pathname === '/api/design') {
      const body = await readJson(req);
      if (!body.prompt) throw httpError(400, 'Missing design prompt');
      return sendJson(res, 200, await limited(req, 'design', () => traced('Design', 'chain', body, () =>
        withTimeout(createDesign(body), 190000, 'Designing took too long (the free image AI is busy). Please try again, or use "Design it yourself".'))));
    }
    if (req.method === 'POST' && url.pathname === '/api/art') { // the studio's AI tab, when the free image APIs are quota-blocked
      const { prompt, background } = await readJson(req);
      if (!prompt || typeof prompt !== 'string') throw httpError(400, 'Missing art prompt');
      return sendJson(res, 200, await limited(req, 'design', () => traced('Art (vector)', 'chain', { prompt }, () =>
        withTimeout(createArtwork(prompt.slice(0, 1500), background), 80000, 'The vector artist is taking too long. Please try again.'))));
    }
    if (req.method === 'POST' && url.pathname === '/api/design/manual') {
      const body = await readJson(req);
      return sendJson(res, 200, await limited(req, 'publish', () => traced('Design (manual)', 'chain', { ...body, artwork: body.artwork }, () => createManualDesign(body))));
    }
    if (req.method === 'POST' && url.pathname === '/api/studio/push') { // the studio's "Give to customer": save + publish, deduped by key
      const body = await readJson(req);
      return sendJson(res, 200, await limited(req, 'publish', () => studioPush(body)));
    }
    if (req.method === 'GET' && url.pathname === '/api/fashion/library') return sendJson(res, 200, fashionLibrary());
    if (req.method === 'POST' && url.pathname === '/api/fashion/chat') {
      const { messages = [], current } = await readJson(req);
      return sendJson(res, 200, await limited(req, 'chat', () => traced('Rin stylist', 'chain', { messages, current }, () =>
        withTimeout(stylistReply(messages, current), 70000, 'Rin is taking too long (the free AI is busy). Please send your message again.'))));
    }
    if (req.method === 'POST' && url.pathname === '/api/fashion/tailor') return sendJson(res, 200, { sheet: tailorSheet((await readJson(req)).look) });
    if (req.method === 'POST' && url.pathname === '/api/fashion/tailor.pdf') {
      const { look, image } = await readJson(req);
      const img = image ? Buffer.from(String(image).replace(/^data:image\/\w+;base64,/, ''), 'base64') : null;
      const pdf = await tailorPdf(look, img);
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="mode-tailor-sheet.pdf"' });
      return res.end(pdf);
    }
    if (req.method === 'POST' && url.pathname === '/api/fashion/looks/publish') return sendJson(res, 200, await limited(req, 'publish', async () => publishLook(await readJson(req))));
    if (req.method === 'POST' && url.pathname === '/api/design/garment-type') return sendJson(res, 200, await setGarmentType(await readJson(req)));
    if (req.method === 'POST' && url.pathname === '/api/garment-type') {
      const { description } = await readJson(req);
      return sendJson(res, 200, { garmentType: await limited(req, 'chat', () => traced('Describe a garment type', 'chain', { description }, () =>
        withTimeout(describeGarment(description), 60000, 'Making the garment took too long (the free AI is busy). Please try again.'))) });
    }
    if (req.method === 'POST' && url.pathname === '/api/garment-type/publish') return sendJson(res, 200, await limited(req, 'publish', async () => publishGarment(await readJson(req))));
    if (req.method === 'POST' && url.pathname === '/api/publish') return sendJson(res, 200, { designs: await limited(req, 'publish', async () => publish(await readJson(req))) });
    if (req.method === 'GET' && url.pathname === '/api/limits') return sendJson(res, 200, await remaining(req));
    if (req.method === 'GET' && url.pathname === '/api/store') return sendJson(res, 200, { designs: await storeList() });
    if (req.method === 'POST' && url.pathname === '/api/remock') { // rebuild a design's mockup (after mockup improvements)
      const { id } = await readJson(req), dir = dirOf(id), meta = await storage.getJSON(`${dir}/meta.json`);
      if (!meta) throw httpError(404, 'Design not found');
      await storage.put(`${dir}/garment.jpg`, await composeGarment((await storage.get(`${dir}/artwork.png`)), meta.shirtColor, meta.placement, meta.allOver));
      return sendJson(res, 200, { garment: `/output/designs/${id}/garment.jpg` });
    }
    if (req.method === 'POST' && url.pathname === '/api/tryon') {
      const { id, photo, garment } = await readJson(req);
      return sendJson(res, 200, await limited(req, 'tryon', () => traced('Realistic try-on', 'chain', { id, photo, garment }, () =>
        withTimeout(tryOn(id, photo, garment), 290000, 'The realistic photo took too long (the free try-on AI is busy). Please try again later — the 3D view still works.'))));
    }
    if (req.method === 'POST' && url.pathname === '/api/mockup') { // the browser's 3D render, kept as the official mockup
      const { id, image } = await readJson(req), dir = dirOf(id);
      const buf = Buffer.from(String(image).replace(/^data:image\/\w+;base64,/, ''), 'base64');
      if (buf.length < 1000) throw httpError(400, 'No image');
      if (isPublished(id) && (await storage.exists(`${dir}/mockup-3d.jpg`))) return sendJson(res, 200, { ok: true, locked: true }); // store designs keep theirs
      await storage.put(`${dir}/mockup-3d.jpg`, await sharp(buf).jpeg({ quality: 93 }).toBuffer());
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/print/')) return await printPackage(url.pathname.split('/').pop(), res);
    if (req.method === 'GET' && url.pathname === '/api/catalogue') return sendJson(res, 200, { colors: COLORS, placements: PLACEMENTS, garments: garmentTypes() });
    const out = url.pathname.match(/^\/output\/((?:designs\/[a-f0-9]{10}|blanks)\/[\w.-]+)$/);
    if (out) return storage.serve(req, res, out[1]);
    return serveFile(req, res, path.join(ROOT, 'public'), url.pathname === '/' ? 'street.html' : url.pathname); // '/' is the walkable street; the panel stays at /index.html
  } catch (e) {
    console.error(req.method, url.pathname, e.message);
    if (!res.headersSent) sendJson(res, e.status || 502, { error: e.status ? e.message : friendly(e) });
    else res.end();
  }
}
if (!process.env.VERCEL) http.createServer(handler).listen(PORT, () => console.log(`Atelier running at http://localhost:${PORT}`));
