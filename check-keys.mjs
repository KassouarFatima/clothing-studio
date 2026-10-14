// Check the AI keys in atelier/.env without printing them.
// Run:  node check-keys.mjs      (after pasting new keys, before restarting)
import fs from 'node:fs';

const file = new URL('./atelier/.env', import.meta.url);
const env = Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));

function hygiene(name, value) {
  const bad = [];
  if (!value) bad.push('EMPTY');
  if (/[^ -~]/.test(value)) bad.push(`non-ASCII character (U+${value.match(/[^ -~]/)[0].codePointAt(0).toString(16).toUpperCase()}) at position ${[...value].findIndex((c) => /[^ -~]/.test(c))}`);
  if (value !== value.trim()) bad.push('leading/trailing spaces');
  if (value.length < 20) bad.push('too short');
  return bad.length ? 'BAD: ' + bad.join('; ') : `shape ok (${value.length} chars, starts "${value.slice(0, 6)}…")`;
}

async function probe(name, value, url, headers) {
  const shape = hygiene(name, value);
  if (shape.startsWith('BAD')) { console.log(`${name}: ${shape}`); return; }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    console.log(`${name}: ${r.ok ? 'VALID' : 'REJECTED (HTTP ' + r.status + ')'} — ${shape}`);
    if (!r.ok) console.log('        ' + (await r.text()).slice(0, 110).replace(/\s+/g, ' '));
  } catch (e) { console.log(`${name}: ERROR ${e.message} — ${shape}`); }
}

console.log('Checking ' + file.pathname.replace(/^\/([A-Za-z]:)/, '$1') + ' ...');
await probe('GROQ_API_KEY  ', env.GROQ_API_KEY, 'https://api.groq.com/openai/v1/models', { Authorization: 'Bearer ' + env.GROQ_API_KEY });
await probe('GEMINI_API_KEY', env.GEMINI_API_KEY, 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(env.GEMINI_API_KEY), {});
await probe('HF_TOKEN      ', env.HF_TOKEN, 'https://huggingface.co/api/whoami-v2', { Authorization: 'Bearer ' + env.HF_TOKEN });
console.log('\nGet fresh free keys:  Groq https://console.groq.com/keys   Gemini https://aistudio.google.com/apikey   HF https://huggingface.co/settings/tokens (read role)');
console.log('After VALID: run  powershell -ExecutionPolicy Bypass -File .\\start-all.ps1');
