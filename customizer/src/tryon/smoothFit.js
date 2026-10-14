// Tracking a body from camera frames is always late: the frame is captured,
// downscaled, sent to the pose model, and only then drawn. A fixed smoother
// adds its own delay on top, which is why a garment trails behind you.
//
// This is the One Euro filter (Casiez, Roussel & Vogel, 2012), the standard
// answer in interactive tracking: it smooths hard while you hold still and
// lets go as soon as you move, so jitter disappears without adding lag. It
// also keeps the speed it measures, which is used to carry the fit forward to
// the moment the frame is actually shown.

const PI2 = Math.PI * 2;
const lowPassAlpha = (cutoff, dt) => 1 / (1 + 1 / (PI2 * cutoff) / dt);

// Pixels move in the hundreds per second, angles in single digits: each kind of
// channel needs its own sensitivity, or angles would never be allowed to move.
const DEFAULTS = {
  position: { minCutoff: 1.6, beta: 0.012, derivativeCutoff: 1 },
  angle: { minCutoff: 1.5, beta: 0.6, derivativeCutoff: 1 },
};
const CHANNELS = {
  x: DEFAULTS.position, y: DEFAULTS.position,
  scaleX: DEFAULTS.position, scaleY: DEFAULTS.position,
  rotation: DEFAULTS.angle, yaw: DEFAULTS.angle,
};

/**
 * Smooths the tracked fit and predicts it forward.
 * push(values, time) takes one pose sample, timed when its frame was captured.
 * predict(time) returns the fit for that moment, in seconds.
 * maxLead caps how far ahead it will guess, so a dropped frame cannot fling
 * the garment across the screen.
 */
export function createFitSmoother({ maxLead = 0.12, channels = CHANNELS } = {}) {
  const state = new Map();
  let lastTime = null;

  const reset = () => { state.clear(); lastTime = null; };

  const push = (values, time) => {
    if (!Number.isFinite(time)) return;
    const dt = lastTime === null ? null : time - lastTime;
    // Out-of-order or duplicate samples would divide by zero or by a negative.
    if (dt !== null && dt <= 0) return;
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) continue;
      const settings = channels[key] || DEFAULTS.position;
      const previous = state.get(key);
      if (!previous || dt === null) {
        state.set(key, { value, speed: 0 });
        continue;
      }
      const rawSpeed = (value - previous.value) / dt;
      const speed = previous.speed
        + (rawSpeed - previous.speed) * lowPassAlpha(settings.derivativeCutoff, dt);
      const cutoff = settings.minCutoff + settings.beta * Math.abs(speed);
      state.set(key, {
        value: previous.value + (value - previous.value) * lowPassAlpha(cutoff, dt),
        speed,
      });
    }
    lastTime = time;
  };

  const predict = time => {
    if (lastTime === null) return null;
    const lead = Math.min(Math.max(Number.isFinite(time) ? time - lastTime : 0, 0), maxLead);
    const fit = {};
    for (const [key, channel] of state) fit[key] = channel.value + channel.speed * lead;
    return fit;
  };

  return { push, predict, reset, get started() { return lastTime !== null; } };
}
