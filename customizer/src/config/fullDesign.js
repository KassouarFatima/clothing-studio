// Keep the existing prompt UI; infer fabric art direction from the description.
export function getFabricDirection(prompt) {
  if (/\b(botanical|floral|flowers?|leaves|foliage|tropical|jungle)\b/i.test(prompt)) return 'botanical';
  if (/\b(football|soccer|sport|jersey|barca|barça|barcelona|athletic|racing)\b/i.test(prompt)) return 'sport';
  if (/\b(minimal(?:ist)?|simple|monochrome|understated|pinstripes?)\b/i.test(prompt)) return 'minimal';
  return 'abstract';
}

// Choose a darkened dominant fabric color for coordinated sewn collar/cuff trim.
export function getFabricTrimColor(image) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const key = [data[i], data[i + 1], data[i + 2]].map(c => Math.floor(c / 32)).join(',');
      const bin = bins.get(key) || { count: 0, rgb: [0, 0, 0] };
      bin.count++;
      for (let c = 0; c < 3; c++) bin.rgb[c] += data[i + c];
      bins.set(key, bin);
    }
    const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (!dominant) return '#20232b';
    return '#' + dominant.rgb.map(c => Math.round(c / dominant.count * 0.5).toString(16).padStart(2, '0')).join('');
  } catch {
    return '#20232b';
  }
}
