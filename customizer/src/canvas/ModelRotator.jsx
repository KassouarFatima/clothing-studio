import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import { useSnapshot } from 'valtio';
import state from '../store';

/**
 * Wraps the 3D garment model to allow smooth 360-degree rotation,
 * turntable auto-spin, and 180-degree front/back flipping without
 * distorting shadows or camera alignment.
 */
const ModelRotator = ({ children }) => {
  const group = useRef();
  const snap = useSnapshot(state);

  useFrame((_, delta) => {
    if (!group.current) return;

    if (snap.autoRotate) {
      state.shirtRotationY = ((state.shirtRotationY || 0) + delta * 0.75) % (Math.PI * 2);
    }

    const targetRotY = snap.shirtRotationY || 0;
    easing.dampE(group.current.rotation, [0, targetRotY, 0], 0.22, delta);
  });

  return <group ref={group}>{children}</group>;
};

export default ModelRotator;
