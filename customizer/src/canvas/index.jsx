import { useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, Center } from '@react-three/drei'
import Garment from './Garment'
import { useSnapshot } from 'valtio'
import state from '../store'
import CameraRig from './CameraRig'
import BackDrop from './BackDrop'
import ModelRotator from './ModelRotator'

const CanvasModel = () => {
  const snap = useSnapshot(state);
  const isDraggingView = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      isDraggingView.current = false;
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, []);

  const handlePointerDown = (e) => {
    if (state.isDraggingText || state.isDraggingLogo) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.tagName === 'CANVAS') {
      isDraggingView.current = true;
      startX.current = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
      if (state.autoRotate) state.autoRotate = false;
    }
  };

  const handlePointerMove = (e) => {
    if (!isDraggingView.current || state.isDraggingText || state.isDraggingLogo) return;
    const curX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const deltaX = curX - startX.current;
    startX.current = curX;

    state.shirtRotationY = (state.shirtRotationY || 0) + deltaX * 0.009;
    const normalized = ((state.shirtRotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    state.isFlipped = normalized > Math.PI * 0.5 && normalized < Math.PI * 1.5;
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      className="w-full h-full cursor-grab active:cursor-grabbing select-none"
    >
      <Canvas
        frameloop={snap.wearItOpen ? 'never' : 'always'}
        shadows
        camera={{ position: [0, 0, 0], fov: 25 }}
        gl={{ preserveDrawingBuffer: true }}
        className="w-full max-w-full h-full transition-all ease-in"
      >
        <ambientLight intensity={0.5} />
        <Environment preset='city' />
        <CameraRig>
          <BackDrop key={`shadow-${snap.garment}`} />
          <Center key={`model-${snap.garment}`}>
            <ModelRotator>
              <Garment />
            </ModelRotator>
          </Center>
        </CameraRig>
      </Canvas>
    </div>
  )
}

export default CanvasModel
