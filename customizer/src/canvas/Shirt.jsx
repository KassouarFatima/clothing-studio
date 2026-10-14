import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Decal, useGLTF, useTexture } from '@react-three/drei';
import { SRGBColorSpace } from 'three';
import { easing } from 'maath';
import { useSnapshot } from 'valtio';
import { createFabricMaterial, createFabricTexture, setFabricTransform } from '../config/fabricTexture';
import { createLogoBackgroundMask } from '../config/logoMask';
import { createTextTextureHolder, drawTextOnCanvas } from '../config/textTexture';
import state from '../store';

const Shirt = () => {
  const snap = useSnapshot(state);
  const meshRef = useRef();
  const isDragging = useRef(false);
  const { nodes, materials } = useGLTF('/shirt_baked.glb');
  const sourceTexture = useTexture(snap.fullDecal);
  const logoTexture = useTexture(snap.logoDecal);
  const renderer = useThree(scene => scene.gl);
  const fabricTexture = useMemo(
    () => createFabricTexture(sourceTexture, renderer.capabilities.getMaxAnisotropy()),
    [sourceTexture, renderer]
  );
  const { material, uniforms } = useMemo(() => createFabricMaterial(materials.lambert1), [materials.lambert1]);
  const backgroundMask = useMemo(
    () => snap.removeLogoBackground ? createLogoBackgroundMask(logoTexture) : null,
    [logoTexture, snap.removeLogoBackground]
  );

  // Dynamic canvas texture for custom text
  const { canvas: textCanvas, texture: textTexture } = useMemo(() => createTextTextureHolder(), []);

  useEffect(() => {
    drawTextOnCanvas(textCanvas, {
      text: snap.textContent,
      font: snap.textFont,
      textColor: snap.textColor,
      textSize: snap.textSize,
      isUppercase: snap.textUppercase,
      isCurved: snap.textCurved,
      curveRadius: snap.textCurveRadius,
      hasOutline: snap.textBorder,
      outlineColor: snap.textBorderColor,
      outlineWidth: snap.textBorderWidth,
      hasShadow: snap.textShadow,
      shadowColor: snap.textShadowColor,
      printStyle: snap.textPrintStyle,
    });
    textTexture.needsUpdate = true;
  }, [
    textCanvas,
    textTexture,
    snap.isTextTexture,
    snap.textContent,
    snap.textFont,
    snap.textColor,
    snap.textSize,
    snap.textUppercase,
    snap.textCurved,
    snap.textCurveRadius,
    snap.textBorder,
    snap.textBorderColor,
    snap.textBorderWidth,
    snap.textShadow,
    snap.textShadowColor,
    snap.textPrintStyle,
  ]);

  useEffect(() => {
    logoTexture.colorSpace = SRGBColorSpace;
    logoTexture.needsUpdate = true;
  }, [logoTexture]);

  useEffect(() => {
    setFabricTransform(fabricTexture, {
      patternScale: snap.patternScale, patternRotation: snap.patternRotation,
      patternOffsetX: snap.patternOffsetX, patternOffsetY: snap.patternOffsetY,
    });
  }, [fabricTexture, snap.patternScale, snap.patternRotation, snap.patternOffsetX, snap.patternOffsetY]);

  useEffect(() => {
    material.map = snap.isFullTexture ? fabricTexture : null;
    material.color.copy(materials.lambert1.color);
    material.roughness = snap.isFullTexture ? 0.94 : 1;
    material.aoMap = null;
    material.aoMapIntensity = 0;
    material.normalScale.copy(materials.lambert1.normalScale).multiplyScalar(snap.isFullTexture ? 0.48 : 1);
    material.needsUpdate = true;
  }, [material, materials, fabricTexture, snap.isFullTexture]);

  useEffect(() => {
    uniforms.garmentTrimColor.value.set(snap.trimColor);
    uniforms.garmentTrimEnabled.value = snap.isFullTexture && snap.useTrim ? 1 : 0;
  }, [uniforms, snap.trimColor, snap.useTrim, snap.isFullTexture]);

  useFrame((_, delta) => easing.dampC(material.color, snap.isFullTexture ? '#ffffff' : snap.color, 0.25, delta));

  // Global pointer release listener
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        state.isDraggingText = false;
      }
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, []);

  useEffect(() => () => fabricTexture.dispose(), [fabricTexture]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => backgroundMask?.dispose(), [backgroundMask]);
  useEffect(() => () => textTexture.dispose(), [textTexture]);

  // Direct 3D mesh interaction: drag or click to position text or logo
  const dragTarget = useRef('text'); // 'logo' | 'text'

  const updateHitPosition = (e) => {
    if (!meshRef.current) return;
    const local = meshRef.current.worldToLocal(e.point.clone());
    const clampedX = Math.max(-0.21, Math.min(0.21, local.x));
    const clampedY = Math.max(-0.26, Math.min(0.22, local.y));
    const clampedZ = Math.max(0.12, local.z + 0.005);

    if (dragTarget.current === 'logo') {
      state.logoPosition = [clampedX, clampedY, clampedZ];
      if (!state.isLogoTexture) state.isLogoTexture = true;
    } else {
      state.textPosition = [clampedX, clampedY, clampedZ];
      if (!state.isTextTexture) state.isTextTexture = true;
    }
  };

  const handleMeshPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;

    let target = null;
    if (snap.activeEditorTab === 'filepicker') {
      target = 'logo';
    } else if (snap.activeEditorTab === 'textpicker') {
      target = 'text';
    } else if (snap.isLogoTexture && !snap.isTextTexture) {
      target = 'logo';
    } else if (!snap.isLogoTexture && snap.isTextTexture) {
      target = 'text';
    } else if (snap.isLogoTexture && snap.isTextTexture) {
      const local = meshRef.current.worldToLocal(e.point.clone());
      const logoPos = snap.logoPosition || [0, 0.04, 0.15];
      const textPos = snap.textPosition || [0, 0.04, 0.15];
      const distLogo = Math.hypot(local.x - logoPos[0], local.y - logoPos[1]);
      const distText = Math.hypot(local.x - textPos[0], local.y - textPos[1]);
      target = distLogo <= distText ? 'logo' : 'text';
    }

    if (target) {
      e.stopPropagation();
      isDragging.current = true;
      dragTarget.current = target;
      if (target === 'logo') {
        state.isDraggingLogo = true;
      } else {
        state.isDraggingText = true;
      }
      updateHitPosition(e);
    }
  };

  const handleMeshPointerMove = (e) => {
    if (isDragging.current) {
      e.stopPropagation();
      updateHitPosition(e);
    }
  };

  const handleMeshPointerUp = (e) => {
    if (isDragging.current) {
      e.stopPropagation();
      isDragging.current = false;
      state.isDraggingLogo = false;
      state.isDraggingText = false;
    }
  };

  const textScaleX = (snap.textScale || 0.16) * 2;
  const textScaleY = snap.textScale || 0.16;
  const textScaleZ = 0.15;
  const textRotRad = ((snap.textRotation || 0) * Math.PI) / 180;
  const logoRotRad = ((snap.logoRotation || 0) * Math.PI) / 180;

  const isInteractiveDecalTab = snap.activeEditorTab === 'filepicker' || snap.activeEditorTab === 'textpicker';
  const isAnyDragging = snap.isDraggingText || snap.isDraggingLogo;

  return <group>
    <mesh
      ref={meshRef}
      castShadow
      geometry={nodes.T_Shirt_male.geometry}
      material={material}
      dispose={null}
      onPointerDown={handleMeshPointerDown}
      onPointerMove={handleMeshPointerMove}
      onPointerUp={handleMeshPointerUp}
      style={{ cursor: isInteractiveDecalTab ? (isAnyDragging ? 'grabbing' : 'grab') : 'default' }}
    >
      {snap.isLogoTexture && (
        <Decal
          position={snap.logoPosition || [0, 0.04, 0.15]}
          rotation={[0, 0, logoRotRad]}
          scale={snap.logoScale}
          map={logoTexture}
          depthTest
          polygonOffsetFactor={-2}
        >
          <meshStandardMaterial
            map={logoTexture}
            alphaMap={backgroundMask}
            transparent
            alphaTest={0.05}
            roughness={1}
            metalness={0}
            depthTest
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-1}
          />
        </Decal>
      )}

      {snap.isTextTexture && snap.textContent && (
        <Decal
          position={snap.textPosition || [0, 0.04, 0.15]}
          rotation={[0, 0, textRotRad]}
          scale={[textScaleX, textScaleY, textScaleZ]}
          map={textTexture}
          depthTest
          polygonOffsetFactor={-2}
        >
          <meshStandardMaterial
            map={textTexture}
            transparent
            alphaTest={0.01}
            roughness={0.92}
            metalness={0.04}
            normalMap={materials.lambert1.normalMap}
            normalScale={[0.22, 0.22]}
            depthTest
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-1}
          />
        </Decal>
      )}
    </mesh>
  </group>;
};

export default Shirt;
