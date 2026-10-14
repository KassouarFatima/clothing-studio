import { CanvasTexture, NoColorSpace } from 'three';

// Mask only near-white pixels connected to the image border. Enclosed white
// artwork and cream colors remain visible, and the original texture is untouched.
export const createLogoBackgroundMask = (texture) => {
  const source = texture?.image;
  if (!source || typeof document === 'undefined') return null;

  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  if (!width || !height) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(source, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const background = new Uint8Array(width * height);
    const queue = new Uint32Array(width * height);
    let head = 0;
    let tail = 0;

    const enqueue = (index) => {
      if (background[index]) return;
      const offset = index * 4;
      const min = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      const max = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      if (pixels[offset + 3] !== 0 && (min < 240 || max - min > 16)) return;
      background[index] = 1;
      queue[tail++] = index;
    };

    for (let x = 0; x < width; x++) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      if (x > 0) enqueue(index - 1);
      if (x < width - 1) enqueue(index + 1);
      if (index >= width) enqueue(index - width);
      if (index < width * (height - 1)) enqueue(index + width);
    }
    if (!tail) return null;

    for (let index = 0; index < background.length; index++) {
      const offset = index * 4;
      const alpha = background[index] ? 0 : 255;
      pixels[offset] = alpha;
      pixels[offset + 1] = alpha;
      pixels[offset + 2] = alpha;
      pixels[offset + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);

    const mask = new CanvasTexture(canvas);
    mask.colorSpace = NoColorSpace;
    mask.flipY = texture.flipY;
    mask.wrapS = texture.wrapS;
    mask.wrapT = texture.wrapT;
    mask.minFilter = texture.minFilter;
    mask.magFilter = texture.magFilter;
    mask.anisotropy = texture.anisotropy;
    mask.channel = texture.channel;
    mask.offset.copy(texture.offset);
    mask.repeat.copy(texture.repeat);
    mask.center.copy(texture.center);
    mask.rotation = texture.rotation;
    return mask;
  } catch {
    // Cross-origin images may be displayable but disallow reading their pixels.
    return null;
  }
};
