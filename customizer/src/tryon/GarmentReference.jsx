import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Center } from '@react-three/drei';
import { useSnapshot } from 'valtio';
import Garment from '../canvas/Garment';
import state from '../store';

const PREVIEW_SIZE = 160;
const IMAGE_SIZE = 1024;

class ReferenceBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() {
    this.props.onError('The selected clothing could not be loaded. Please try again.');
  }

  componentDidUpdate(previous) {
    if (previous.revision !== this.props.revision && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Capture({ revision, onReady, onError }) {
  const { gl, scene, camera, setFrameloop } = useThree();
  const capture = useRef(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };

  useEffect(() => {
    const current = { elapsed: 0, frames: 0, started: false, cancelled: false };
    capture.current = current;
    setFrameloop('always');
    return () => { current.cancelled = true; };
  }, [revision, setFrameloop]);

  // Positive priority renders after the garment's color-animation callback.
  // Suspense mounts this only when the model and all its textures are ready.
  useFrame((_, delta) => {
    gl.render(scene, camera);
    const current = capture.current;
    if (!current || current.started || current.cancelled) return;
    current.elapsed += Math.min(delta, 0.1);
    current.frames += 1;
    if (current.frames < 3 || current.elapsed < 1.8) return;
    current.started = true;

    try {
      gl.domElement.toBlob(blob => {
        if (current.cancelled || capture.current !== current) return;
        setFrameloop('demand');
        if (blob) callbacks.current.onReady(blob);
        else callbacks.current.onError('The clothing reference could not be captured. Please try again.');
      }, 'image/png');
    } catch {
      setFrameloop('demand');
      callbacks.current.onError('The clothing reference could not be captured. Please try again.');
    }
  }, 1);

  return null;
}

/** A garment-only product image. This canvas never receives camera frames. */
export default function GarmentReference({ onReady, onError, onLoading, revisionKey }) {
  const snap = useSnapshot(state);
  const [status, setStatus] = useState('Preparing clothing…');
  const callbacks = useRef({ onReady, onError, onLoading });
  callbacks.current = { onReady, onError, onLoading };
  const logoPosition = JSON.stringify(snap.logoPosition);
  const logoScale = JSON.stringify(snap.logoScale);
  const revision = useMemo(() => ({
    revisionKey, garment: snap.garment, color: snap.color,
    isFullTexture: snap.isFullTexture, fullDecal: snap.fullDecal,
    isLogoTexture: snap.isLogoTexture, logoDecal: snap.logoDecal, logoPosition, logoScale,
    removeLogoBackground: snap.removeLogoBackground,
    patternScale: snap.patternScale, patternRotation: snap.patternRotation,
    patternOffsetX: snap.patternOffsetX, patternOffsetY: snap.patternOffsetY,
    trimColor: snap.trimColor, useTrim: snap.useTrim,
  }), [
    revisionKey, snap.garment, snap.color, snap.isFullTexture, snap.fullDecal,
    snap.isLogoTexture, snap.logoDecal, logoPosition, logoScale,
    snap.removeLogoBackground, snap.patternScale, snap.patternRotation,
    snap.patternOffsetX, snap.patternOffsetY, snap.trimColor, snap.useTrim,
  ]);
  const readyRevision = useRef(null);

  useEffect(() => {
    readyRevision.current = null;
    setStatus('Preparing clothing…');
    callbacks.current.onLoading?.();
    const timeout = window.setTimeout(() => {
      if (readyRevision.current === revision) return;
      const message = 'The clothing is taking too long to load. Please try again.';
      setStatus(message);
      callbacks.current.onError?.(message);
    }, 30000);
    return () => window.clearTimeout(timeout);
  }, [revision]);

  const handleReady = blob => {
    readyRevision.current = revision;
    setStatus('Your selected clothing');
    callbacks.current.onReady?.(blob);
  };

  const handleError = message => {
    readyRevision.current = revision;
    setStatus(message);
    callbacks.current.onError?.(message);
  };

  return <figure style={{ margin: 0 }}>
    <div style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
      <ReferenceBoundary revision={revision} onError={handleError}>
        <Canvas
          dpr={IMAGE_SIZE / PREVIEW_SIZE}
          camera={{ position: [0, 0, 2], fov: 26 }}
          gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
          aria-label="Selected clothing reference"
        >
          <color attach="background" args={['#ffffff']} />
          <ambientLight intensity={1.3} />
          <hemisphereLight args={['#ffffff', '#9299a1', 1]} />
          <directionalLight position={[2, 3, 4]} intensity={2.5} />
          <directionalLight position={[-3, 1, 2]} intensity={1} />
          <Suspense fallback={null}>
            <Center key={snap.garment}>
              <group scale={snap.garment === 'tshirt' ? 1.18 : 1}><Garment /></group>
            </Center>
            <Capture revision={revision} onReady={handleReady} onError={handleError} />
          </Suspense>
        </Canvas>
      </ReferenceBoundary>
    </div>
    <figcaption aria-live="polite" style={{ fontSize: 12, marginTop: 7, maxWidth: PREVIEW_SIZE }}>{status}</figcaption>
  </figure>;
}
