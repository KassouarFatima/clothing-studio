// Last-resort artwork for the studio's AI tab: a deterministic textile pattern
// drawn with nothing but Node's built-in zlib — zero budget, zero dependencies,
// zero network. The tab can never dead-end again: whatever the free Hugging Face
// Space or Gemini answer, this local generator always returns a real PNG.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
    const name = Buffer.from(type, 'ascii');
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    name.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
    return out;
};

const encodePng = (width, height, pixels) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (1 + width * 4);
        raw[rowStart] = 0; // row filter: none
        pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};

// Deterministic PRNG: the same description always yields the same pattern
// (the tab's own promise — the seed stays meaningful even in the fallback).
const hashPrompt = (text) => {
    let h = 2166136261;
    for (const ch of text) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const mulberry32 = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const PALETTES = [
    ['#101a2e', '#f4b942', '#e8eef7', '#d1495b'],
    ['#0f2e26', '#8fd6bd', '#f2f2ef', '#e8a13a'],
    ['#241b2f', '#b892ff', '#f5f3ff', '#ff6b9d'],
    ['#1c2834', '#5ab9e8', '#eef6fb', '#f79e4a'],
    ['#2b1d1a', '#e07a5f', '#f4f1ea', '#81b29a'],
    ['#1a1a2e', '#e94560', '#f5f5f5', '#0f3460'],
];

const parseHex = (value) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? '').trim());
    if (!match) return null;
    const n = Number.parseInt(match[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const paint = (pixels, size, x, y, color, alpha = 1) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const i = (py * size + px) * 4;
    pixels[i] = Math.round(pixels[i] * (1 - alpha) + color[0] * alpha);
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - alpha) + color[1] * alpha);
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - alpha) + color[2] * alpha);
    pixels[i + 3] = 255;
};

const disc = (pixels, size, cx, cy, radius, color) => {
    for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) paint(pixels, size, x, y, color);
        }
    }
};

// mode "full": a seamless-feeling stripe-and-dot textile; anything else: a
// centered emblem on a light ground (the logo-mode spirit of the tab).
export const generateLocalArtwork = ({ prompt = '', palette, mode = 'full', size = 512 } = {}) => {
    const rand = mulberry32(hashPrompt(`${prompt}|${mode}`));
    const chosen = (Array.isArray(palette) && palette.length >= 2 ? palette : PALETTES[Math.floor(rand() * PALETTES.length)])
        .map(parseHex).filter(Boolean);
    const [first, second, third, fourth] = chosen;
    const colors = [first, second, third, fourth ?? third];

    const pixels = Buffer.alloc(size * size * 4);
    const background = mode === 'full' ? colors[0] : [246, 244, 239];
    for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = background[0];
        pixels[i + 1] = background[1];
        pixels[i + 2] = background[2];
        pixels[i + 3] = 255;
    }

    if (mode === 'full') {
        // diagonal stripe bands, edge-wrapped so the pattern tiles
        let cursor = -size;
        while (cursor < size * 2) {
            const width = 18 + Math.floor(rand() * 46);
            const color = colors[1 + Math.floor(rand() * (colors.length - 1))];
            for (let d = 0; d < width; d += 1) {
                for (let y = 0; y < size; y += 1) {
                    const x = cursor + d + y;
                    paint(pixels, size, ((x % size) + size) % size, y, color, 0.9);
                }
            }
            cursor += width + 26 + Math.floor(rand() * 70);
        }
        // dots + squares on a jittered grid
        const step = 64;
        for (let gy = 0; gy < size; gy += step) {
            for (let gx = 0; gx < size; gx += step) {
                const cx = gx + rand() * step * 0.7;
                const cy = gy + rand() * step * 0.7;
                const color = colors[1 + Math.floor(rand() * (colors.length - 1))];
                if (rand() < 0.6) {
                    disc(pixels, size, cx, cy, 5 + rand() * 9, color);
                } else {
                    const side = 8 + Math.floor(rand() * 14);
                    for (let y = 0; y < side; y += 1) {
                        for (let x = 0; x < side; x += 1) paint(pixels, size, cx + x, cy + y, color);
                    }
                }
            }
        }
    } else {
        const center = size / 2;
        disc(pixels, size, center, center, size * 0.34, colors[1]);
        disc(pixels, size, center, center, size * 0.26, background);
        for (let ray = 0; ray < 12; ray += 1) {
            const angle = (ray / 12) * Math.PI * 2;
            for (let r = size * 0.28; r < size * 0.38; r += 1) {
                paint(pixels, size, center + Math.cos(angle) * r, center + Math.sin(angle) * r, colors[2]);
            }
        }
        disc(pixels, size, center, center, size * 0.14, colors[2]);
        disc(pixels, size, center, center, size * 0.06, colors[3] ?? colors[1]);
    }

    return {
        photo: encodePng(size, size, pixels).toString('base64'),
        mimeType: 'image/png',
        seed: null,
        engine: 'local',
    };
};
