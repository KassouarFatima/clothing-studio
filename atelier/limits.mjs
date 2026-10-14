// Daily limits, so a public site can't use up the free AI limits (and the owner's API keys) before everyone has had a go:
// each visitor gets a few of each costly thing a day, and everybody together gets a bigger daily cap. Counters live in
// the storage (output/limits/<day>.json, or Vercel Blob when hosted); visitors are only a salted hash of their address.
// On a computer there are no limits, unless LIMITS=on.
import crypto from 'node:crypto';
import * as storage from './storage.mjs';

const ON = storage.usesBlob || process.env.LIMITS === 'on';
const SALT = process.env.LIMIT_SALT || process.env.GROQ_API_KEY || 'atelier';
// each: per visitor and day; all: for everybody together
export const LIMITS = {
  chat: { each: 40, all: 900, what: 'messages to the stylists' },
  design: { each: 6, all: 90, what: 'AI designs' },
  tryon: { each: 3, all: 30, what: 'realistic try-on photos' },
  publish: { each: 10, all: 250, what: 'items put in the store' },
};
const tooMany = (message) => Object.assign(new Error(message), { status: 429 });
const who = (req, day) => {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(`${SALT}|${day}|${ip}`).digest('hex').slice(0, 12);
};
const today = () => new Date().toISOString().slice(0, 10);
const empty = () => ({ total: {}, by: {} });

// Runs `work` if the visitor and the site still have some of `kind` left today; a try that fails because the AI was busy
// (not the visitor's fault) is given back.
export async function limited(req, kind, work) {
  if (!ON) return work();
  const L = LIMITS[kind], day = today(), key = `limits/${day}.json`, me = who(req, day);
  const doc = await storage.getJSON(key, empty());
  const mine = (doc.by[me] ||= {});
  if ((doc.total[kind] || 0) >= L.all) throw tooMany(`The free ${L.what} for today are used up (the site shares a daily limit). They come back tomorrow — everything else still works.`);
  if ((mine[kind] || 0) >= L.each) throw tooMany(`You have used today's ${L.each} free ${L.what}. They come back tomorrow — everything else still works.`);
  mine[kind] = (mine[kind] || 0) + 1; doc.total[kind] = (doc.total[kind] || 0) + 1;
  await storage.putJSON(key, doc);
  try { return await work(); }
  catch (e) {
    try {
      const d = await storage.getJSON(key, empty());
      if (d.by[me]?.[kind] > 0) { d.by[me][kind]--; d.total[kind] = Math.max(0, (d.total[kind] || 1) - 1); await storage.putJSON(key, d); }
    } catch {}
    throw e;
  }
}
// What this visitor has left today (for showing in the pages).
export async function remaining(req) {
  const day = today(), doc = ON ? await storage.getJSON(`limits/${day}.json`, empty()) : empty(), mine = doc.by[who(req, day)] || {};
  return Object.fromEntries(Object.entries(LIMITS).map(([k, L]) => [k, ON ? Math.max(0, Math.min(L.each - (mine[k] || 0), L.all - (doc.total[k] || 0))) : null]));
}
