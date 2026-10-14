import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('node_modules/@mediapipe/tasks-vision/', root);
const target = new URL('public/tryon/', root);
await mkdir(new URL('wasm/', target), { recursive: true });
for (const file of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.wasm']) {
  await copyFile(new URL(file, source), new URL(file, target));
}
console.log(`Copied pinned MediaPipe runtime to ${fileURLToPath(target)}`);
