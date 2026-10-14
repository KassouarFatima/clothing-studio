import state from '../store';

const STORAGE_KEY = 'tshirt_design_history_v2';

const DEFAULT_HISTORY = [
  {
    id: 'demo-1',
    title: 'Studio Knit (Geometric)',
    fullDecal: '/samples/studio-knit.svg',
    color: '#30343a',
    trimColor: '#111f35',
    useTrim: true,
    patternScale: 1,
    isFullTexture: true,
    isLogoTexture: false,
    garment: 'tshirt',
    timestamp: Date.now() - 3600000,
  },
  {
    id: 'demo-2',
    title: 'Tiger Streetwear',
    fullDecal: '/samples/studio-knit.svg',
    logoDecal: '/samples/tiger.webp',
    logoScale: 0.22,
    logoPosition: [0, -0.02, 0.15],
    color: '#30343a',
    trimColor: '#111f35',
    useTrim: false,
    isFullTexture: false,
    isLogoTexture: true,
    removeLogoBackground: true,
    garment: 'tshirt',
    timestamp: Date.now() - 7200000,
  },
];

export function getDesignHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HISTORY;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_HISTORY;
  } catch {
    return DEFAULT_HISTORY;
  }
}

export function saveDesignHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('Could not save design history to localStorage:', err);
  }
}

export function addDesignToHistory(item) {
  const current = getDesignHistory();
  const newItem = {
    id: `design-${Date.now()}`,
    title: item.title || 'Custom Design',
    fullDecal: item.fullDecal || state.fullDecal,
    logoDecal: item.logoDecal || state.logoDecal,
    logoPosition: item.logoPosition || state.logoPosition,
    logoScale: item.logoScale || state.logoScale,
    color: item.color || state.color,
    trimColor: item.trimColor || state.trimColor,
    useTrim: item.useTrim ?? state.useTrim,
    patternScale: item.patternScale ?? state.patternScale ?? 1,
    isFullTexture: item.isFullTexture ?? state.isFullTexture,
    isLogoTexture: item.isLogoTexture ?? state.isLogoTexture,
    isTextTexture: item.isTextTexture ?? state.isTextTexture,
    textContent: item.textContent ?? state.textContent,
    textColor: item.textColor ?? state.textColor,
    textPosition: item.textPosition ?? state.textPosition,
    textScale: item.textScale ?? state.textScale,
    garment: item.garment || state.garment || 'tshirt',
    timestamp: Date.now(),
  };

  // Keep last 25 designs
  const updated = [newItem, ...current.filter((x) => x.id !== newItem.id)].slice(0, 25);
  saveDesignHistory(updated);
  return updated;
}

export function applyHistoryDesign(item) {
  if (!item) return;
  if (item.garment && item.garment !== state.garment) {
    state.garment = item.garment;
  }
  if (item.fullDecal) state.fullDecal = item.fullDecal;
  if (item.color) state.color = item.color;
  if (item.trimColor) state.trimColor = item.trimColor;
  if (item.useTrim !== undefined) state.useTrim = item.useTrim;
  if (item.patternScale !== undefined) state.patternScale = item.patternScale;
  if (item.isFullTexture !== undefined) state.isFullTexture = item.isFullTexture;
  if (item.isLogoTexture !== undefined) state.isLogoTexture = item.isLogoTexture;
  if (item.logoDecal) state.logoDecal = item.logoDecal;
  if (item.logoPosition) state.logoPosition = item.logoPosition;
  if (item.logoScale) state.logoScale = item.logoScale;
  if (item.isTextTexture !== undefined) state.isTextTexture = item.isTextTexture;
  if (item.textContent) state.textContent = item.textContent;
  if (item.textColor) state.textColor = item.textColor;
  if (item.textPosition) state.textPosition = item.textPosition;
  if (item.textScale) state.textScale = item.textScale;
}
