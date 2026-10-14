import { Color, RepeatWrapping, SRGBColorSpace } from 'three';

// Keep the GLB's UVs: front, back, sleeves and collar were unwrapped at
// the same fabric scale. The original AO and cotton normal map use this atlas.
export function createFabricTexture(source, anisotropy = 1) {
  const texture = source.clone();
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.center.set(0.5, 0.5);
  texture.anisotropy = Math.min(anisotropy, 8);
  texture.needsUpdate = true;
  return texture;
}

export function setFabricTransform(texture, { patternScale, patternRotation, patternOffsetX, patternOffsetY }) {
  const scale = Number.isFinite(patternScale) ? Math.max(0.5, Math.min(4, patternScale)) : 1;
  texture.repeat.set(scale, scale);
  texture.rotation = ((patternRotation || 0) * Math.PI) / 180;
  texture.offset.set(patternOffsetX || 0, patternOffsetY || 0);
  texture.updateMatrix();
}

export function createFabricMaterial(source) {
  const material = source.clone();
  const uniforms = {
    garmentTrimColor: { value: new Color('#121c32') },
    garmentTrimEnabled: { value: 1 },
  };

  material.color.set('#ffffff');
  material.roughness = 0.94;
  material.metalness = 0;
  material.aoMap = null;
  material.aoMapIntensity = 0;
  material.normalScale.set(0.48, 0.48);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 garmentUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\ngarmentUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 garmentUv;
        uniform vec3 garmentTrimColor;
        uniform float garmentTrimEnabled;
      `)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Native collar island is above .944; cuffs end at .937. Use raw UVs
        // so these sewn details stay fixed while the print is adjusted.
        float collar = step(0.941, garmentUv.y);
        float cuffs = smoothstep(0.916, 0.919, garmentUv.y)
          * (1.0 - step(0.941, garmentUv.y))
          * (1.0 - step(0.758, garmentUv.x));
        float trim = max(collar, cuffs) * garmentTrimEnabled;
        diffuseColor.rgb = mix(diffuseColor.rgb, garmentTrimColor, trim);
      `);
  };
  material.customProgramCacheKey = () => 'shirt-fabric-native-uv-trims-v1';
  return { material, uniforms };
}
