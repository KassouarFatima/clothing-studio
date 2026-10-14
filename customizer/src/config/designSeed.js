/**
 * Deterministic design seed.
 *
 * The generation API uses a seed to decide the starting noise of the image.
 * When no seed is sent, the backend asks the Space to randomize it, so every
 * click produced a different design for the same prompt. Deriving the seed
 * from the prompt text means the same description always produces the same
 * design, while changing any word produces a new one.
 *
 * FNV-1a (32 bit) is tiny, dependency free and well distributed for this use.
 * The result is folded into the range the API accepts: 0 … 2147483647.
 */
export function promptSeed(input) {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // >>> 1 keeps the value a non-negative int inside the accepted seed range.
  return hash >>> 1;
}

export default promptSeed;
