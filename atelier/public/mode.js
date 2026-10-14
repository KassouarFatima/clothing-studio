// MODE front end: chat with Rin the stylist, who searches the collection (and makes new colourways when nothing fits),
// and see the whole look in 3D with professionally made garments (CLO / Marvelous Designer quality, CC-BY).
// No image AI and no try-on quota are used.
import { LookViewer, garmentCatalogue } from './wardrobe3d.js';
import { fitAdvice, avatarCatalogue, SIZES, STATUS } from './fit.js';

const $ = (id) => document.getElementById(id);
const state = { messages: [], look: null, busy: false, library: null };

function toast(text, ms = 4500) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), ms);
}
// Every request has a time limit and ends in a clear message: never an endless spinner.
async function api(path, body, timeoutMs = 80000) {
  let r;
  try {
    r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'No answer in time — the free AI may be busy. Please try again.'
      : 'Cannot reach the MODE server. Is it running? (npm start)');
  }
  const j = await r.json().catch(() => ({ error: `The server answered with an error (${r.status}).` }));
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// ---------- your body (kept on this device) ----------
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
// looks open on their own (invisible mannequin); the avatar appears when asked for
const fit = { gender: store.get('mode-gender', null), body: store.get('mode-body', null), sizes: {}, avatar: store.get('mode-avatar-v2', false), map: false, base: null };
const FIELDS = { height: 'mHeight', chest: 'mChest', waist: 'mWaist', hips: 'mHips' };
const genderFor = (look) => fit.gender || ((look?.pieces || []).some((p) => ['dress'].includes(p.slot) || /skirt|pumps|heels|short_jeans/.test(p.asset)) ? 'female' : 'male');
function bodyFor(gender) { return fit.body?.[gender] || { ...fit.base[gender].measurements }; }
async function initFit() {
  try { fit.base = await avatarCatalogue(); } catch { $('fitPanel').hidden = true; return; }
  $('showAvatar').checked = fit.avatar;
  $('fitLegend').innerHTML = Object.values(STATUS).map((v) => `<span><i style="background:${v.color}"></i>${v.label}</span>`).join('');
  for (const b of document.querySelectorAll('#gender button')) b.addEventListener('click', () => { fit.gender = b.dataset.g; store.set('mode-gender', fit.gender); wantAvatar(); syncFields(); refit(); });
  for (const [k, id] of Object.entries(FIELDS)) $(id).addEventListener('change', () => {
    const g = genderFor(state.look), v = Math.max(+$(id).min, Math.min(+$(id).max, +$(id).value || 0));
    fit.body = { ...(fit.body || {}), [g]: { ...bodyFor(g), [k]: v } }; store.set('mode-body', fit.body); wantAvatar(); refit();
  });
  $('showAvatar').addEventListener('change', () => { fit.avatar = $('showAvatar').checked; store.set('mode-avatar-v2', fit.avatar); refit(); });
  $('fitMap').addEventListener('change', () => { fit.map = $('fitMap').checked; if (fit.map) wantAvatar(); refit(); });
  syncFields();
}
// someone entering their body (gender, measurements) or asking for the fit map wants to see it on the avatar
function wantAvatar() { if (fit.avatar) return; fit.avatar = true; $('showAvatar').checked = true; store.set('mode-avatar-v2', true); }
function syncFields() {
  const g = genderFor(state.look), b = bodyFor(g);
  for (const btn of document.querySelectorAll('#gender button')) btn.classList.toggle('active', btn.dataset.g === g);
  for (const [k, id] of Object.entries(FIELDS)) $(id).value = Math.round(b[k]);
}
let refitTimer;
function refit() { clearTimeout(refitTimer); refitTimer = setTimeout(() => state.look && showLook(state.look), 150); }
// Size advice: the recommended size for each piece, how each zone fits, and a size picker to try another size.
function renderSizes(advice) {
  const box = $('sizes');
  box.innerHTML = '';
  for (const a of advice) {
    const row = document.createElement('div');
    row.className = 'sizeRow';
    if (!a.sized) { row.innerHTML = `<b></b><span class="muted">one size / no size chart</span>`; row.querySelector('b').textContent = a.name; box.append(row); continue; }
    row.innerHTML = `<b></b><select>${SIZES.map((z) => `<option${z === a.size ? ' selected' : ''}>${z}</option>`).join('')}</select>
      <span class="rec">${a.outOfRange ? 'Our largest size may be too small for you' : `We recommend ${a.recommended}`}</span>
      ${Object.entries(a.status).map(([z, st]) => `<span class="zone" style="background:${STATUS[st].color}">${z}: ${STATUS[st].label} (${a.ease[z] > 0 ? '+' : ''}${a.ease[z]} cm)</span>`).join('')}
      <span class="muted">${a.fit} cut</span>`;
    row.querySelector('b').textContent = a.name;
    row.querySelector('select').addEventListener('change', (e) => { fit.sizes[a.asset] = e.target.value; refit(); });
    box.append(row);
  }
}

// ---------- 3D ----------
let viewer = null;
// MODE shows the clothes only: the shoes part is never displayed (the avatar keeps its own feet)
const shownPieces = (pieces) => (pieces || []).filter((p) => p.slot !== 'shoes');
function stageError(text) { $('stageError').textContent = text; $('stageError').hidden = !text; }
async function showLook(look) {
  $('working').hidden = false;
  $('workingText').textContent = 'Dressing your avatar…';
  try {
    viewer ||= new LookViewer($('viewer3d'));
    const pieces = shownPieces(look?.pieces).map((p) => ({ asset: p.asset, color: p.color, name: p.name }));
    let opts = {};
    if (fit.base && pieces.length) {
      const cat = await garmentCatalogue(), gender = genderFor(look), body = bodyFor(gender), advice = fitAdvice(cat, pieces, body, fit.sizes);
      renderSizes(advice);
      syncFields();
      // looks open on their own, except those with bare legs: their legs are shown so the shoes aren't floating
      const bare = pieces.some((p) => cat[p.asset]?.barelegs);
      opts = { advice, avatar: fit.avatar ? { gender, body } : bare ? { gender, body, part: 'legs' } : null, fitmap: fit.map };
    }
    await viewer.setLook(pieces, opts);
    $('empty').hidden = true;
    stageError('');
  } catch (e) {
    console.error(e);
    stageError(`The 3D view could not be shown (${e.message}). Your look is listed below.`);
  } finally { $('working').hidden = true; }
}
function setLook(look) {
  if (look?.name !== state.look?.name) fit.sizes = {}; // a new look starts from the recommended sizes
  state.look = look;
  if (!look?.pieces?.length) $('sizes').innerHTML = '';
  $('lookName').textContent = look?.name || '';
  renderPieces();
  $('btnSave').disabled = $('btnClear').disabled = $('btnTailor').disabled = !look?.pieces?.length;
  return showLook(look);
}
const SLOT_NAMES = { top: 'Top', outer: 'Jacket / coat', bottom: 'Bottom', dress: 'Dress', shoes: 'Shoes', suit: 'Suit', hat: 'Hat', bag: 'Bag' };
function renderPieces() {
  const box = $('pieces');
  box.innerHTML = '';
  for (const [i, p] of (state.look?.pieces || []).entries()) {
    if (p.slot === 'shoes') continue; // the shoes part is not listed either (i is still the piece's real index)
    const el = document.createElement('div');
    el.className = `piece ${p.source === 'new' ? 'new' : ''}`;
    el.innerHTML = `<span class="dot"></span><span><small></small><b></b><em></em></span><button title="Remove">×</button>`;
    el.querySelector('.dot').style.background = p.color || 'conic-gradient(#3b5a85, #c8b48a, #9b1c1f, #3b5a85)'; // its own print or wash
    el.querySelector('small').textContent = SLOT_NAMES[p.slot] || p.slot;
    el.querySelector('b').textContent = p.name;
    el.querySelector('em').textContent = p.source === 'new' ? 'New colourway — made for you' : 'From the collection';
    el.querySelector('button').addEventListener('click', () => {
      const pieces = state.look.pieces.filter((_, k) => k !== i);
      setLook(pieces.length ? { ...state.look, pieces } : null);
      if (!pieces.length) { $('empty').hidden = false; viewer?.setLook([]); }
    });
    box.append(el);
  }
}

// ---------- chat ----------
function addMessage(role, text, cls = '') {
  const div = document.createElement('div');
  div.className = `msg ${role === 'stylist' ? 'seller' : 'user'} ${cls}`;
  div.textContent = text;
  if (/[؀-ۿ]/.test(text)) div.dir = 'rtl'; // Arabic reads right-to-left
  $('messages').append(div);
  $('messages').scrollTop = $('messages').scrollHeight;
  return div;
}
async function send(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  $('composer').querySelector('button').disabled = true;
  addMessage('user', text);
  state.messages.push({ role: 'user', text });
  const typing = addMessage('stylist', 'Rin is looking through the collection…', 'typing');
  const started = Date.now();
  const tick = setInterval(() => { typing.textContent = `Rin is looking through the collection… ${Math.round((Date.now() - started) / 1000)}s`; }, 1000);
  try {
    const a = await api('/api/fashion/chat', { messages: state.messages, current: state.look });
    typing.remove();
    addMessage('stylist', a.reply);
    state.messages.push({ role: 'stylist', text: a.reply });
    if (a.look) {
      const made = shownPieces(a.look.pieces).filter((p) => p.source === 'new').length;
      await setLook(a.look);
      if (made) toast(`${made} new piece${made > 1 ? 's' : ''} made for you and added to the collection.`);
    }
  } catch (e) {
    typing.remove();
    addMessage('stylist', `⚠️ ${e.message}`, 'error');
  } finally {
    clearInterval(tick);
    state.busy = false;
    $('composer').querySelector('button').disabled = false;
  }
}
$('composer').addEventListener('submit', (e) => { e.preventDefault(); const t = $('input').value; $('input').value = ''; send(t); });

// ---------- ready-made looks (instant, no AI) ----------
function renderLooks() {
  const box = $('looks');
  box.innerHTML = '';
  const byId = new Map(state.library.pieces.map((p) => [p.id, p]));
  const saved = state.library.saved.map((l) => ({ name: `${l.title} · by ${l.author}`, pieces: l.pieces }));
  const ready = state.library.looks.map((l) => ({ name: l.name, pieces: l.pieces.map((id) => byId.get(id)).filter(Boolean) }));
  for (const look of [...saved, ...ready]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = look.name;
    b.addEventListener('click', () => {
      setLook({ name: look.name, pieces: look.pieces.map((p) => ({ ...p, source: 'library' })) });
      addMessage('stylist', `Here is “${look.name}”. Tell me what you'd change — a colour, a piece, the mood…`);
    });
    box.append(b);
  }
}
async function loadLibrary() {
  try {
    state.library = await api('/api/fashion/library', null, 20000);
    renderLooks();
    // opened from a mannequin in the shop: show its look
    const want = new URLSearchParams(location.search).get('look');
    const saved = state.library.saved.find((l) => l.id === want), ready = state.library.looks.find((l) => l.id === want);
    if (saved || ready) {
      const byId = new Map(state.library.pieces.map((p) => [p.id, p]));
      const look = saved ? { name: saved.title, pieces: saved.pieces } : { name: ready.name, pieces: ready.pieces.map((id) => byId.get(id)).filter(Boolean) };
      await setLook({ name: look.name, pieces: look.pieces.map((p) => ({ ...p, source: 'library' })) });
      addMessage('stylist', `This is “${look.name}”. Want it in another colour, or with different pieces? Just tell me.`);
    }
  } catch (e) { $('looks').textContent = `⚠️ ${e.message}`; }
}

// ---------- save to the window ----------
$('btnSave').addEventListener('click', () => { $('pubTitle').value = state.look?.name || ''; $('publish').hidden = false; });
$('pubClose').addEventListener('click', () => { $('publish').hidden = true; });
$('pubGo').addEventListener('click', async () => {
  $('pubGo').disabled = true;
  try {
    const r = await api('/api/fashion/looks/publish', { look: state.look, title: $('pubTitle').value, author: $('pubAuthor').value }, 20000);
    state.library.saved = r.saved;
    renderLooks();
    $('publish').hidden = true;
    toast('Saved! Your look is now on a mannequin in the MODE window.');
    window.parent?.postMessage({ type: 'mode-looks-updated' }, location.origin);
  } catch (e) { toast(`⚠️ ${e.message}`); }
  finally { $('pubGo').disabled = false; }
});
// ---------- how to make it: the tailor's sheet ----------
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('btnTailor').addEventListener('click', async () => {
  $('tailorBody').innerHTML = '<p class="muted">Preparing the sheet…</p>';
  $('tailor').hidden = false;
  try {
    const { sheet } = await api('/api/fashion/tailor', { look: state.look }, 20000);
    $('tailorBody').innerHTML = `
      <div class="tsGrid"><div><h4>Measurements to take</h4><ul>${sheet.measurements.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>
      <div><h4>General</h4><ul>${sheet.general.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div></div>
      ${sheet.pieces.map((p) => `<section class="tsPiece"><h3>${esc(p.name)} <small>${esc(p.slot)} · ${esc(p.colour)}</small></h3>
        ${p.buy ? `<p>${esc(p.note)}</p>` : `
        <p><b>Fabric:</b> ${esc(p.fabric.name)}, ${esc(p.fabric.spec)}. <b>Buy ${p.metres} m</b> (150 cm wide, size M).</p>
        ${p.patternNote ? `<p>${esc(p.patternNote)}</p>` : ''}${p.fit ? `<p><b>Fit:</b> ${esc(p.fit)}</p>` : ''}
        <p><b>Cut:</b></p><ul>${p.cut.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        <p><b>Sew, in this order:</b></p><ol>${p.steps.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
        <p><b>Notions:</b> ${p.notions.map(esc).join(' · ')}</p>
        <p><b>Seams:</b> ${esc(p.fabric.seams)}. Needle: ${esc(p.fabric.needle)}. ${esc(p.fabric.care)}.</p>`}</section>`).join('')}`;
  } catch (e) { $('tailorBody').innerHTML = `<p class="msg error">⚠️ ${esc(e.message)}</p>`; }
});
$('tailorClose').addEventListener('click', () => { $('tailor').hidden = true; });
$('tailorPdf').addEventListener('click', async () => {
  $('tailorPdf').disabled = true; $('tailorPdf').textContent = 'Making the PDF…';
  try {
    const r = await fetch('/api/fashion/tailor.pdf', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ look: state.look, image: viewer?.snapshot(600, 800) }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `${(state.look?.name || 'look').replace(/[^\w-]+/g, '-')}-tailor-sheet.pdf` });
    a.click();
    toast('Downloaded — send this PDF to your tailor.');
  } catch (e) { toast(`⚠️ ${e.name === 'TimeoutError' ? 'The PDF took too long. Please try again.' : e.message}`); }
  finally { $('tailorPdf').disabled = false; $('tailorPdf').textContent = 'Download the PDF for your tailor'; }
});
$('btnClear').addEventListener('click', () => { setLook(null); $('empty').hidden = false; viewer?.setLook([]); });
$('btnLetsDoIt').addEventListener('click', () => window.open('http://localhost:5173/', '_blank')); // clothing-studio: open the "Let'sDo it." studio (site 1)

// Credits: the garment models are CC-BY, so every author is named.
garmentCatalogue().then((cat) => {
  $('credits').innerHTML = '3D garments: ' + Object.values(cat).map((g) => `<a href="${g.credit.url}" target="_blank" rel="noopener">${g.credit.title}</a> by ${g.credit.author}`).join(' · ') + ' — CC BY 4.0, prepared for MODE (resized, recoloured).';
}).catch(() => {});

addMessage('stylist', "Hi, I'm Rin ✨ Tell me the style you're after — an occasion, a mood, a colour, or exact pieces. I'll put together a whole look from our collection, and make a new colourway if we don't have the colour you want. Want a print or artwork on a piece? Click ✨ Let'sDo it. below — it opens the design studio (the other site), and you come back to me with it.");
initFit().then(loadLibrary);
window.__modeReady = true;
