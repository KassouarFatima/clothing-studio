import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * High-definition dynamic canvas renderer for 3D garment text customization.
 * Renders crisp, screen-printed or embroidered typography onto a 2D canvas
 * which is bound to a Three.js CanvasTexture for real-time 3D decal mapping.
 */

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;

export const AVAILABLE_FONTS = [
  { id: 'Impact', name: 'Impact', family: 'Impact, sans-serif', style: 'Bold Streetwear' },
  { id: 'Bebas Neue', name: 'Bebas Neue', family: '"Bebas Neue", sans-serif', style: 'Athletic / Display' },
  { id: 'Montserrat', name: 'Montserrat', family: '"Montserrat", sans-serif', style: 'Clean Geometric' },
  { id: 'Playfair Display', name: 'Playfair', family: '"Playfair Display", serif', style: 'Luxury Serif' },
  { id: 'Pacifico', name: 'Pacifico', family: '"Pacifico", cursive', style: 'Vintage Script' },
  { id: 'Anton', name: 'Anton', family: '"Anton", sans-serif', style: 'Heavy Poster' },
  { id: 'Space Grotesk', name: 'Space', family: '"Space Grotesk", sans-serif', style: 'Futuristic Tech' },
  { id: 'Permanent Marker', name: 'Marker', family: '"Permanent Marker", cursive', style: 'Graffiti / Grunge' },
];

export const COLOR_PRESETS = [
  '#ffffff', // Clean White
  '#111827', // Deep Carbon
  '#f59e0b', // Amber Gold
  '#ef4444', // Crimson Red
  '#10b981', // Emerald Green
  '#3b82f6', // Royal Blue
  '#8b5cf6', // Violet
  '#ec4899', // Hot Pink
  '#fde047', // Vintage Cream
  '#94a3b8', // Heather Slate
];

export const POSITION_PRESETS = [
  { label: 'Chest Center', pos: [0, 0.04, 0.15], icon: '👕' },
  { label: 'Left Pocket', pos: [-0.08, 0.08, 0.14], icon: '🏷️' },
  { label: 'Right Chest', pos: [0.08, 0.08, 0.14], icon: '🏷️' },
  { label: 'Upper Collar', pos: [0, 0.16, 0.13], icon: '⬆️' },
  { label: 'Lower Stomach', pos: [0, -0.14, 0.15], icon: '⬇️' },
];

/**
 * Draws text onto a 2D canvas with realistic screenprint or clean styling.
 */
export function drawTextOnCanvas(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const {
    text = 'YOUR TEXT',
    font = 'Impact',
    textColor = '#ffffff',
    textSize = 1,
    isUppercase = true,
    isCurved = false,
    curveRadius = 260,
    hasOutline = false,
    outlineColor = '#000000',
    outlineWidth = 6,
    hasShadow = true,
    shadowColor = 'rgba(0,0,0,0.4)',
    printStyle = 'screenprint', // 'screenprint', 'clean', 'vintage'
    letterSpacing = 2,
  } = options;

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const rawText = (text || '').trim();
  if (!rawText) return;

  const processedText = isUppercase ? rawText.toUpperCase() : rawText;
  const lines = processedText.split('\n').filter(Boolean);
  if (!lines.length) return;

  const fontConfig = AVAILABLE_FONTS.find(f => f.id === font) || AVAILABLE_FONTS[0];
  const baseFontSize = Math.round(92 * (textSize || 1));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (isCurved && lines.length === 1) {
    // Vintage varsity arched text along a circle arc
    const str = lines[0];
    const r = Math.max(120, curveRadius);
    ctx.font = `bold ${baseFontSize}px ${fontConfig.family}`;

    // Measure total width
    let charWidths = [];
    let totalW = 0;
    for (let i = 0; i < str.length; i++) {
      const w = ctx.measureText(str[i]).width + letterSpacing * 3;
      charWidths.push(w);
      totalW += w;
    }

    const totalAngle = totalW / r;
    let currentAngle = -totalAngle / 2;
    const centerX = CANVAS_WIDTH / 2;
    const centerY = CANVAS_HEIGHT / 2 + r * 0.55;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const charAngle = (charWidths[i] / totalW) * totalAngle;
      const midAngle = currentAngle + charAngle / 2;

      ctx.save();
      const x = centerX + r * Math.sin(midAngle);
      const y = centerY - r * Math.cos(midAngle);

      ctx.translate(x, y);
      ctx.rotate(midAngle);

      if (hasShadow) {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
      }

      if (hasOutline) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(char, 0, 0);
      }

      ctx.fillStyle = textColor;
      ctx.fillText(char, 0, 0);
      ctx.restore();

      currentAngle += charAngle;
    }
  } else {
    // Multi-line or flat text layout
    const lineHeight = baseFontSize * 1.15;
    const totalBlockHeight = lines.length * lineHeight;
    const startY = (CANVAS_HEIGHT - totalBlockHeight) / 2 + lineHeight / 2;

    lines.forEach((line, index) => {
      const y = startY + index * lineHeight;
      const x = CANVAS_WIDTH / 2;

      ctx.font = `bold ${baseFontSize}px ${fontConfig.family}`;

      if (hasShadow) {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
      }

      if (hasOutline) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, y);
      }

      ctx.fillStyle = textColor;
      ctx.fillText(line, x, y);
    });
  }

  // Realistic ink stipple / screenprint texture effect
  if (printStyle === 'screenprint' || printStyle === 'vintage') {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const numSpecks = printStyle === 'vintage' ? 240 : 80;
    for (let i = 0; i < numSpecks; i++) {
      const rx = Math.random() * CANVAS_WIDTH;
      const ry = Math.random() * CANVAS_HEIGHT;
      const rad = 0.6 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 0, 0, ${printStyle === 'vintage' ? 0.35 : 0.18})`;
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Creates a reusable Canvas and THREE.CanvasTexture instance.
 */
export function createTextTextureHolder() {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return { canvas, texture };
}
