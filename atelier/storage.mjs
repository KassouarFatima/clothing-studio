// Where Atelier keeps what customers make (designs, try-on photos, the store, saved looks…): the output/ folder when it
// runs on a computer, Vercel Blob when it is hosted on Vercel (serverless functions have no lasting disk).
// Keys are paths like "designs/ab12cd34ef/artwork.png" or "store.json".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output');
export const usesBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const blob = usesBlob ? await import('@vercel/blob') : null;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };
const typeOf = (key) => TYPES[path.extname(key)] || 'application/octet-stream';
const local = (key) => {
  const file = path.normalize(path.join(LOCAL, key));
  if (!file.startsWith(LOCAL)) throw new Error('Bad storage key');
  return file;
};

export async function put(key, data) {
  if (!usesBlob) { fs.mkdirSync(path.dirname(local(key)), { recursive: true }); fs.writeFileSync(local(key), data); return; }
  await blob.put(key, data, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: typeOf(key), cacheControlMaxAge: 60 });
}
// The blob's public address, versioned by its upload time so a file that was replaced is never served stale.
async function where(key) {
  try { const h = await blob.head(key); return `${h.url}?v=${new Date(h.uploadedAt).getTime()}`; } catch { return null; }
}
export async function get(key) {
  if (!usesBlob) { try { return fs.readFileSync(local(key)); } catch { return null; } }
  const url = await where(key);
  if (!url) return null;
  const r = await fetch(url, { cache: 'no-store' });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}
export async function exists(key) {
  if (!usesBlob) return fs.existsSync(local(key));
  return !!(await where(key));
}
// The names of the files directly under a folder ("designs/<id>/").
export async function list(prefix) {
  if (!usesBlob) { try { return fs.readdirSync(local(prefix)); } catch { return []; } }
  const out = []; let cursor;
  do {
    const r = await blob.list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map((b) => b.pathname.slice(prefix.length)).filter((n) => n && !n.includes('/')));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
export async function getJSON(key, fallback) {
  const b = await get(key);
  if (!b) return fallback;
  try { return JSON.parse(b.toString('utf8')); } catch { return fallback; }
}
export const putJSON = (key, value) => put(key, JSON.stringify(value, null, 1));
// For the browser: a local file is served by the app itself; a blob is sent to its (versioned) public address.
// Local files carry a Last-Modified validator, so a repeat visit gets a tiny 304 instead of the bytes again.
export function sendCached(req, res, file, type, cacheControl) {
  const st = fs.statSync(file);
  const headers = { 'content-type': type, 'cache-control': cacheControl, 'last-modified': st.mtime.toUTCString() };
  const ims = req.headers['if-modified-since'];
  if (ims && Date.parse(ims) >= Math.floor(st.mtime.getTime() / 1000) * 1000) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}
export async function serve(req, res, key) {
  if (usesBlob) {
    const url = await where(key);
    if (!url) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(302, { location: url, 'cache-control': 'no-store' });
    return res.end();
  }
  const file = local(key);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  return sendCached(req, res, file, typeOf(key), 'public, max-age=300');
}
