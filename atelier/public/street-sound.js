// Street soundscape, synthesised live with Web Audio (no sound files):
// city hum, distant voices, birds, the "piyo piyo" crossing signal, footsteps, and soft music inside the shops.
const S = { ctx: null, on: true, step: 0, last: null };
try { S.on = localStorage.getItem('atelier-sound') !== 'off'; } catch {}

export function startSound() {
  if (S.ctx) { S.ctx.resume(); return; }
  const ctx = new AudioContext(), master = ctx.createGain();
  master.gain.value = S.on ? 0.9 : 0;
  master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const loop = (type, freq, q = 0.7) => {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
    src.connect(f).connect(g).connect(master); src.start();
    return { f, g };
  };
  const music = ctx.createGain(); music.gain.value = 0; music.connect(master);
  const echo = ctx.createDelay(); echo.delayTime.value = 0.38;
  const fb = ctx.createGain(); fb.gain.value = 0.3; echo.connect(fb).connect(echo); echo.connect(music);
  Object.assign(S, { ctx, master, noise, music, echo, hum: loop('lowpass', 220), voices: loop('bandpass', 900, 1.2), leaves: loop('highpass', 3500),
    nextBird: 0, nextSignal: 0, nextChord: 0, chord: 0 });
}
export function toggleSound() {
  S.on = !S.on;
  try { localStorage.setItem('atelier-sound', S.on ? 'on' : 'off'); } catch {}
  if (S.ctx) S.master.gain.setTargetAtTime(S.on ? 0.9 : 0, S.ctx.currentTime, 0.1);
  return S.on;
}

function tone(f, t0, { type = 'sine', vol = 0.1, attack = 0.01, dur = 0.3, to = S.master, pan = 0, glide } = {}) {
  const o = S.ctx.createOscillator(), g = S.ctx.createGain(), p = S.ctx.createStereoPanner();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (glide) for (const [gf, gt] of glide) o.frequency.exponentialRampToValueAtTime(gf, t0 + gt);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  p.pan.value = pan;
  o.connect(g).connect(p).connect(to); o.start(t0); o.stop(t0 + dur + 0.05);
}
function hit(t0, { type = 'lowpass', freq = 900, vol = 0.1, dur = 0.1 } = {}) {
  const s = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = S.ctx.createGain();
  s.buffer = S.noise; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(S.master); s.start(t0, Math.random() * 3, dur + 0.05);
}
// Shop music: the boutique plays mellow lo-fi chords, the café a jazzy progression.
const CHORDS = {
  boutique: [[220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 349.2], [164.8, 207.7, 246.9, 329.6]],
  cafe: [[146.8, 174.6, 220, 261.6], [196, 246.9, 293.7, 349.2], [130.8, 164.8, 196, 246.9], [220, 261.6, 329.6, 392]],
};

// where: 'street' | 'boutique' | 'cafe'
export function updateSound(dt, t, player, where) {
  if (!S.ctx || S.ctx.state !== 'running') return;
  const now = S.ctx.currentTime, inside = where !== 'street';
  // muffled city ambience indoors, open outdoors
  S.hum.g.gain.setTargetAtTime(inside ? 0.05 : 0.14, now, 0.4);
  S.hum.f.frequency.setTargetAtTime(inside ? 120 : 260, now, 0.4);
  S.voices.g.gain.setTargetAtTime(inside ? 0.004 : 0.03 * (0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 1.9)), now, 0.15);
  S.voices.f.frequency.setTargetAtTime(700 + 400 * Math.abs(Math.sin(t * 2.3)), now, 0.08);
  S.leaves.g.gain.setTargetAtTime(inside ? 0 : 0.012 * (0.5 + 0.5 * Math.sin(t * 0.4)), now, 0.5);
  S.music.gain.setTargetAtTime(inside ? 0.22 : 0, now, 0.6);
  if (!inside && now > S.nextBird) { // sparrows
    const base = 3000 + Math.random() * 1800, pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 2 + (Math.random() * 4 | 0); i++) tone(base, now + i * 0.11, { vol: 0.03, dur: 0.08, pan, glide: [[base * 1.4, 0.03], [base * 0.9, 0.07]] });
    S.nextBird = now + 1.5 + Math.random() * 4;
  }
  const nearCrossing = Math.hypot(player.x, player.z) < 18 && !inside;
  if (nearCrossing && now > S.nextSignal) { // Japanese pedestrian signal: "piyo... piyo-piyo"
    for (const [dt2, f] of [[0, 2600], [0.35, 2600], [0.5, 2400]]) tone(f, now + dt2, { vol: 0.025, dur: 0.12, glide: [[f * 0.75, 0.1]] });
    S.nextSignal = now + 1.6;
  }
  if (inside && now > S.nextChord) {
    const chords = CHORDS[where] || CHORDS.boutique, c = chords[S.chord++ % chords.length];
    for (const f of c) tone(f, now, { type: 'triangle', vol: 0.05, attack: 0.08, dur: 2.6, to: S.music });
    tone(c[0] / 2, now, { vol: 0.08, attack: 0.02, dur: 1.8, to: S.music });
    if (Math.random() < 0.7) tone(c[(Math.random() * 4) | 0] * 2, now + 0.9 + Math.random(), { vol: 0.035, dur: 1.2, to: S.echo });
    S.nextChord = now + 2.4;
  }
  // footsteps from how far you moved
  if (S.last) {
    const moved = Math.hypot(player.x - S.last.x, player.z - S.last.z);
    if (moved > 0.0005) {
      const before = Math.floor(S.step);
      S.step += moved / 0.75;
      if (Math.floor(S.step) !== before) hit(now, inside ? { type: 'bandpass', freq: 1300, vol: 0.12, dur: 0.07 } : { freq: 800, vol: 0.12, dur: 0.09 });
    }
  }
  S.last = { x: player.x, z: player.z };
}
